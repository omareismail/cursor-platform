#!/usr/bin/env node
/**
 * context-cost.test.mjs — the measurement says what is there, counts nothing
 * twice, and never guesses at what it could not read.
 *
 * Every fixture is ASCII, so a byte is a character and each expected total can
 * be written as an arithmetic expression over the strings the test itself
 * wrote. A test that re-derived the sum by calling the tool's own helpers would
 * pass whatever the tool did.
 *
 * The digest case runs the real SessionStart hook out of the fixture, because
 * the digest is not a file and a fixture that faked one would be testing the
 * fake. The hook is read-only; the last section proves the whole run is.
 */

import { join } from "node:path";
import { existsSync, readFileSync, rmSync, readdirSync, statSync } from "node:fs";
import { fixture, runTool, put, check, report, section, REPO } from "../_harness.mjs";

const fm = await import(new URL(`file:///${join(REPO, ".cursor", "tools", "_findings.mjs").replace(/\\/g, "/")}`));

const T = "context-cost.mjs";
const parse = (r) => { try { return JSON.parse(r.out); } catch { return null; } };
const B = (s) => Buffer.byteLength(s, "utf8");
const tok = (s) => Math.ceil(s.length / 4);
const FENCE = "```";

/** Fixed, known-size content. `pad` keeps the two skills far enough apart to order. */
const body = (title, n) => `# ${title}\n\n` + `Line of real content about ${title}.\n`.repeat(n);

const AGENTS = body("AGENTS", 10);
const RULE_ALWAYS = `---\ndescription: Always on\nalwaysApply: true\n---\n\n${body("always", 6)}`;
const RULE_GLOB = `---\ndescription: Only for C sharp\nalwaysApply: false\nglobs: ["**/*.cs"]\n---\n\n${body("glob", 4)}`;
// Named so that alphabetical order is the REVERSE of size order. With a `big-`
// and a `small-` the two orderings agree, and a tool that sorted by name would
// pass a test written to prove it sorts by size.
const BIG_SKILL = body("big skill", 40);
const SMALL_SKILL = body("small skill", 3);
const BIG_DIR = "zz-large";
const SMALL_DIR = "aa-small";
const SHIM_NAME = BIG_DIR;
const SHIM_DESC = "Does the big thing. Invoked as /zz-large.";
const SHIM = `---\nname: ${SHIM_NAME}\ndescription: ${SHIM_DESC}\n---\n\n${body("shim", 2)}`;
const AGENT_NAME = "scout";
const AGENT_DESC = "Finds the canonical example. Use PROACTIVELY before generating.";
const AGENT = `---\nname: ${AGENT_NAME}\ndescription: ${AGENT_DESC}\ntools: Read, Grep\n---\n\n${body("scout", 8)}`;
const MCP = JSON.stringify({ mcpServers: { alpha: { command: "x" }, beta: { command: "y" } } }, null, 2);

/** The whole repository shape the tool reads, with CLAUDE.md supplied per case. */
function seeded(name, claude = `# CLAUDE\n\n@AGENTS.md\n\n${body("claude", 20)}`, { agents = AGENTS, mcp = MCP } = {}) {
  const root = fixture(name);
  if (claude !== null) put(root, "CLAUDE.md", claude);
  if (agents !== null) put(root, "AGENTS.md", agents);
  put(root, ".cursor/rules/00-always.mdc", RULE_ALWAYS);
  put(root, ".cursor/rules/02-glob.mdc", RULE_GLOB);
  put(root, `.cursor/skills/${BIG_DIR}/skill.md`, BIG_SKILL);
  put(root, `.cursor/skills/${SMALL_DIR}/skill.md`, SMALL_SKILL);
  put(root, `.claude/skills/${BIG_DIR}/SKILL.md`, SHIM);
  put(root, ".claude/agents/scout.md", AGENT);
  if (mcp !== null) put(root, ".mcp.json", mcp);
  return root;
}

/** Every file under `dir` with its size, for the writes-nothing check. */
function snapshot(dir, base = dir, acc = new Map()) {
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) snapshot(p, base, acc);
    else acc.set(p.slice(base.length), st.size);
  }
  return acc;
}

section("context-cost - always on is the contract plus its imports, each counted once");
{
  const root = seeded("cc-basic");
  const r = runTool(T, ["report", "--json"], root);
  const rep = parse(r);
  const CLAUDE = readFileSync(join(root, "CLAUDE.md"), "utf8");

  check("--json is a valid finding report, exit 0", r.exit === 0 && rep && fm.validate(rep).length === 0 && rep.ok === true,
    rep ? `${r.exit} ${fm.validate(rep).join("; ")}` : r.out + r.err);

  const c = rep.data.hosts.claude, u = rep.data.hosts.cursor;
  check("Claude Code carries CLAUDE.md and its one import, listed once each",
    c.files.length === 2 && c.files[0].path === "CLAUDE.md" && c.files[0].role === "contract"
    && c.files[1].path === "AGENTS.md" && c.files[1].role === "import",
    JSON.stringify(c.files.map((f) => [f.path, f.role])));
  check("its file bytes are exactly CLAUDE.md + AGENTS.md", c.filesBytes === B(CLAUDE) + B(AGENTS),
    `${c.filesBytes} vs ${B(CLAUDE) + B(AGENTS)}`);
  check("Cursor carries AGENTS.md and the always-on rule, not CLAUDE.md",
    u.files.map((f) => f.path).join(",") === "AGENTS.md,.cursor/rules/00-always.mdc"
    && u.filesBytes === B(AGENTS) + B(RULE_ALWAYS), JSON.stringify(u.files.map((f) => f.path)));
  check("the glob-scoped rule is in neither host's always-on list",
    ![...c.files, ...u.files].some((f) => f.path.includes("02-glob")), JSON.stringify(u.files.map((f) => f.path)));
  check("...and appears once on demand, at its real size",
    rep.data.onDemand.globRules.count === 1 && rep.data.onDemand.globRules.items[0].bytes === B(RULE_GLOB),
    JSON.stringify(rep.data.onDemand.globRules));
  check("every row estimates tokens as ceil(chars/4)",
    [...c.files, ...u.files, ...rep.data.onDemand.skills.items].every((x) => x.tokens === Math.ceil(x.chars / 4)), "");
  check("the units say which number is measured and which is estimated",
    /measured/.test(rep.data.units.bytes) && /estimate/.test(rep.data.units.tokens), JSON.stringify(rep.data.units));
  check("it reports one always-on total per host and never a combined one",
    rep.findings.some((f) => f.code === "always-on-claude") && rep.findings.some((f) => f.code === "always-on-cursor")
    && !JSON.stringify(rep.data).includes("combined"), rep.findings.map((f) => f.code).join(","));
}

section("context-cost - the digest is measured by running the hook, and the totals are exact sums");
{
  const root = seeded("cc-digest");
  const rep = parse(runTool(T, ["report", "--json"], root));
  const d = rep.data.digest;
  const c = rep.data.hosts.claude, u = rep.data.hosts.cursor;

  check("the digest was produced by the fixture's own SessionStart hook",
    d && d.bytes > 0 && /\.claude\/hooks\/session-start\.mjs$/.test(d.hook), JSON.stringify(d));
  check("its bytes are the bytes of what the hook emitted", d && d.tokens === Math.ceil(d.chars / 4), JSON.stringify(d));
  check("the Claude total is files + catalog + digest, to the byte",
    c.total.bytes === c.filesBytes + c.catalog.skills.bytes + c.catalog.agents.bytes + c.digestBytes,
    `${c.total.bytes} vs ${c.filesBytes + c.catalog.skills.bytes + c.catalog.agents.bytes + c.digestBytes}`);
  check("the Cursor total is files + digest, to the byte", u.total.bytes === u.filesBytes + u.digestBytes,
    `${u.total.bytes} vs ${u.filesBytes + u.digestBytes}`);
  check("the two totals are different numbers, because they are different hosts",
    c.total.bytes !== u.total.bytes, `${c.total.bytes} ${u.total.bytes}`);

  const text = runTool(T, ["report"], root);
  check("the text report names the digest as its own line", /SessionStart digest/.test(text.out), text.out.slice(0, 300));
  check("the text report says bytes are measured and tokens estimated",
    /measured/.test(text.out) && /estimate/.test(text.out), "");
  check("the text report says nothing is scored", /[Nn]othing here is scored/.test(text.out), "");
}

section("context-cost - the catalog lines the host shows the model, counted and labelled an estimate");
{
  const root = seeded("cc-catalog");
  const rep = parse(runTool(T, ["report", "--json"], root));
  const cat = rep.data.hosts.claude.catalog;

  check("one skill shim, measured as its name and description", cat.skills.count === 1 && cat.skills.bytes === B(SHIM_NAME + SHIM_DESC),
    `${cat.skills.count} ${cat.skills.bytes} vs ${B(SHIM_NAME + SHIM_DESC)}`);
  check("one agent, likewise", cat.agents.count === 1 && cat.agents.bytes === B(AGENT_NAME + AGENT_DESC),
    `${cat.agents.count} ${cat.agents.bytes} vs ${B(AGENT_NAME + AGENT_DESC)}`);
  check("the shim's body is not counted as always-on", cat.skills.bytes < B(SHIM), `${cat.skills.bytes} vs ${B(SHIM)}`);
  const f = rep.findings.find((x) => x.code === "catalog-lines");
  check("the catalog finding calls itself an estimate and says why", f && f.severity === "info" && /estimate/.test(f.message)
    && /truncate/.test(f.message), JSON.stringify(f));
  check("Cursor's total does not include the catalog lines",
    rep.data.hosts.cursor.total.bytes === rep.data.hosts.cursor.filesBytes + rep.data.hosts.cursor.digestBytes, "");
}

section("context-cost - on demand is sorted by size, and --top only narrows what is printed");
{
  const root = seeded("cc-rank");
  const rep = parse(runTool(T, ["report", "--json"], root));
  const s = rep.data.onDemand.skills;
  check("skill bodies are listed largest first, not in name order",
    s.count === 2 && s.items[0].path.includes(BIG_DIR) && s.items[1].path.includes(SMALL_DIR),
    JSON.stringify(s.items.map((x) => x.path)));
  check("the group total is the sum of its members", s.bytes === B(BIG_SKILL) + B(SMALL_SKILL), `${s.bytes}`);

  const one = runTool(T, ["report", "--top", "1"], root);
  check("--top 1 prints the largest and not the smallest",
    new RegExp(BIG_DIR).test(one.out) && !new RegExp(`${SMALL_DIR}/skill\\.md`).test(one.out), one.out.slice(0, 400));
  check("...and says how many it is showing of how many there are", /\(1 of 2/.test(one.out), one.out.slice(0, 400));
  const all = parse(runTool(T, ["report", "--top", "1", "--json"], root));
  check("--top never narrows the JSON: a reader gets every row", all.data.onDemand.skills.items.length === 2, "");

  for (const [arg, why] of [["0", "zero"], ["x", "not a number"], ["-3", "negative"]]) {
    const bad = runTool(T, ["report", "--top", arg], root);
    check(`--top ${why} is refused with exit 2`, bad.exit === 2 && bad.err.includes("--top"), `${bad.exit} ${bad.err.slice(0, 120)}`);
  }
}

section("context-cost - an import it cannot read is reported, never estimated");
{
  const gone = seeded("cc-import-missing", `# CLAUDE\n\n@AGENTS.md\n\n@missing.md\n\n${body("claude", 5)}`);
  const rep = parse(runTool(T, ["report", "--json"], gone));
  const w = rep.findings.find((f) => f.code === "import-unresolved");
  check("a missing import warns, naming the file and the line", w && w.severity === "warn" && w.file === "CLAUDE.md" && w.line === 5,
    JSON.stringify(w));
  check("...and the run still succeeds: a warning is not a failure", rep.ok === true && rep.exit === 0, `${rep.ok} ${rep.exit}`);
  check("...and the missing file contributes nothing", rep.data.hosts.claude.files.length === 2, JSON.stringify(rep.data.hosts.claude.files));

  const home = seeded("cc-import-home", `# CLAUDE\n\n@~/global.md\n\n${body("claude", 5)}`);
  const hrep = parse(runTool(T, ["report", "--json"], home));
  check("a home-directory import is reported as outside the repository, not as missing",
    hrep.findings.some((f) => f.code === "home-import-skipped") && !hrep.findings.some((f) => f.code === "import-unresolved"),
    hrep.findings.map((f) => f.code).join(","));

  const nested = seeded("cc-import-nested", `# CLAUDE\n\n@AGENTS.md\n\n${body("claude", 5)}`,
    { agents: `# AGENTS\n\n@deeper.md\n\n${body("agents", 5)}` });
  put(nested, "deeper.md", body("deeper", 30));
  const nrep = parse(runTool(T, ["report", "--json"], nested));
  check("a second-level import is declared not followed", nrep.findings.some((f) => f.code === "nested-import-not-followed"),
    nrep.findings.map((f) => f.code).join(","));
  check("...and is not silently added to the total", !nrep.data.hosts.claude.files.some((f) => f.path === "deeper.md"),
    JSON.stringify(nrep.data.hosts.claude.files.map((f) => f.path)));

  // A contract file that names the same import in two sections is ordinary, and
  // is the only shape where counting once is distinguishable from counting each
  // time it is seen. Without this case the dedupe is untested.
  const twice = seeded("cc-import-twice", `# CLAUDE\n\n@AGENTS.md\n\n${body("claude", 5)}\n@AGENTS.md\n`);
  const trep = parse(runTool(T, ["report", "--json"], twice));
  const CLAUDE_TWICE = readFileSync(join(twice, "CLAUDE.md"), "utf8");
  check("a file imported twice is listed once", trep.data.hosts.claude.files.filter((f) => f.path === "AGENTS.md").length === 1,
    JSON.stringify(trep.data.hosts.claude.files.map((f) => f.path)));
  check("...and counted once, so the total is not inflated by a repeated line",
    trep.data.hosts.claude.filesBytes === B(CLAUDE_TWICE) + B(AGENTS),
    `${trep.data.hosts.claude.filesBytes} vs ${B(CLAUDE_TWICE) + B(AGENTS)}`);

  const fenced = seeded("cc-import-fenced", `# CLAUDE\n\n${FENCE}\n@example.md\n${FENCE}\n\n@AGENTS.md\n\n${body("claude", 5)}`);
  const frep = parse(runTool(T, ["report", "--json"], fenced));
  check("an @import inside a code fence is an example, not an import",
    !frep.findings.some((f) => f.code === "import-unresolved"), frep.findings.map((f) => f.code).join(","));
  check("...and the real import after the fence is still found, at the right line",
    frep.data.hosts.claude.files.some((f) => f.path === "AGENTS.md"), "");
}

section("context-cost - what it could not measure, it says, and excludes");
{
  const root = seeded("cc-no-hook");
  rmSync(join(root, ".claude", "hooks", "session-start.mjs"));
  const r = runTool(T, ["report", "--json"], root);
  const rep = parse(r);
  const w = rep.findings.find((f) => f.code === "digest-unmeasured");
  check("no hook: it warns rather than guessing the digest from its inputs", w && w.severity === "warn", JSON.stringify(w));
  check("...the digest is null, not zero-with-a-shrug", rep.data.digest === null && rep.data.digestIncluded === false,
    JSON.stringify(rep.data.digest));
  check("...the totals exclude it and the run still succeeds", rep.exit === 0 && rep.ok === true
    && rep.data.hosts.cursor.total.bytes === rep.data.hosts.cursor.filesBytes, "");
  const text = runTool(T, ["report"], root);
  check("...and the text total says out loud that it is short one measurement", /digest excluded/.test(text.out), text.out.slice(0, 600));
  check("...with the warning on stderr", /digest could not be measured/.test(text.err), text.err.slice(0, 200));
}

section("context-cost - nothing to measure is exit 2, not a total of zero");
{
  const root = fixture("cc-empty");
  const j = runTool(T, ["report", "--json"], root);
  const rep = parse(j);
  check("--json is a valid skipped report with exit 2",
    j.exit === 2 && rep && fm.validate(rep).length === 0 && rep.skipped === true && rep.exit === 2 && rep.data === null,
    rep ? fm.validate(rep).join("; ") : j.out + j.err);
  const t = runTool(T, ["report"], root);
  check("plain text exits 2 and says why on stderr", t.exit === 2 && /no CLAUDE\.md and no AGENTS\.md/.test(t.err),
    `${t.exit} ${t.err.slice(0, 200)}`);
  check("it prints no table it cannot fill", !/always on/.test(t.out), t.out.slice(0, 200));
}

section("context-cost - MCP is a count, and the editor's own config is never opened");
{
  const two = seeded("cc-mcp-two");
  const rep = parse(runTool(T, ["report", "--json"], two));
  check("servers are counted, not measured", rep.data.mcp.servers === 2 && rep.data.mcp.present === true, JSON.stringify(rep.data.mcp));
  check("the finding says the schema cost is real and unmeasurable here",
    rep.findings.some((f) => f.code === "mcp-servers" && /not measurable/.test(f.message)), "");

  const none = seeded("cc-mcp-none", undefined, { mcp: null });
  const nrep = parse(runTool(T, ["report", "--json"], none));
  check("no .mcp.json is zero servers, and still a clean run", nrep.data.mcp.servers === 0 && nrep.exit === 0, JSON.stringify(nrep.data.mcp));

  const bad = seeded("cc-mcp-bad", undefined, { mcp: "{ not json" });
  const brep = parse(runTool(T, ["report", "--json"], bad));
  check("a malformed .mcp.json counts zero rather than crashing", brep.exit === 0 && brep.data.mcp.servers === 0, `${brep.exit}`);

  const src = readFileSync(join(REPO, ".cursor", "tools", T), "utf8");
  check("the tool never reads settings.local.json, whose Read is denied by policy", !src.includes("settings.local"), "");
}

section("context-cost - a measurement that changed the thing it measured would be worthless");
{
  const root = seeded("cc-readonly");
  const before = snapshot(root);
  runTool(T, ["report"], root);
  runTool(T, ["report", "--json"], root);
  runTool(T, ["report", "--top", "1"], root);
  const after = snapshot(root);
  const added = [...after.keys()].filter((k) => !before.has(k));
  const changed = [...after.keys()].filter((k) => before.has(k) && before.get(k) !== after.get(k));
  const removed = [...before.keys()].filter((k) => !after.has(k));
  check("three runs add no file", added.length === 0, added.join(", "));
  check("...change no file", changed.length === 0, changed.join(", "));
  check("...and remove no file", removed.length === 0, removed.join(", "));
  check("no cache directory appears", !existsSync(join(root, ".cursor", "cache")), "");
}

section("context-cost - bytes are bytes: line endings are counted, and so is every byte of a character");
{
  // Line endings first. A carriage return is one byte AND one character, so the
  // thing to prove is not bytes-over-characters - it is that the file as checked
  // out is what was measured, rather than a copy someone normalised on the way in.
  const lf = `# CLAUDE\n\n@AGENTS.md\n\n${body("claude", 5)}`;
  const crlf = lf.replace(/\n/g, "\r\n");
  const newlines = (lf.match(/\n/g) || []).length;
  const claudeOf = (root) => parse(runTool(T, ["report", "--json"], root)).data.hosts.claude.files.find((f) => f.path === "CLAUDE.md");

  const asLf = claudeOf(seeded("cc-lf", lf));
  const asCrlf = claudeOf(seeded("cc-crlf", crlf));
  check("a CRLF checkout costs exactly one more byte per line than an LF one",
    asCrlf.bytes === asLf.bytes + newlines, `${asCrlf.bytes} vs ${asLf.bytes} + ${newlines}`);
  check("...and those bytes reach the estimate rather than being normalised away",
    asCrlf.tokens >= asLf.tokens, `${asCrlf.tokens} vs ${asLf.tokens}`);

  const crlfRep = parse(runTool(T, ["report", "--json"], seeded("cc-crlf-import", crlf)));
  check("the import is still found through the carriage returns",
    crlfRep.data.hosts.claude.files.some((f) => f.path === "AGENTS.md"),
    JSON.stringify(crlfRep.data.hosts.claude.files.map((f) => f.path)));

  // Then characters. An em dash is three bytes and one character, and this
  // repository's documents are full of them.
  const wide = `# CLAUDE\n\n@AGENTS.md\n\nAn em dash — costs three bytes and one character.\n`;
  const asWide = claudeOf(seeded("cc-utf8", wide));
  check("a multi-byte character reports more bytes than characters", asWide.bytes > asWide.chars,
    JSON.stringify(asWide));
  check("...and the token estimate counts characters, not bytes", asWide.tokens === Math.ceil(asWide.chars / 4),
    JSON.stringify(asWide));
}

report("context-cost.mjs");
