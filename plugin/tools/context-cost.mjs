#!/usr/bin/env node
/**
 * context-cost.mjs — what a session carries before the first user word.
 *
 * WHY THIS EXISTS
 *
 * Two third-party token-reduction tools were assessed for this platform and
 * both were refused (docs/reviews/token-tools-assessment-2026-09-15.md). The
 * pitch for each was "your agent pays for everything it reads", and nothing in
 * this repository could say what it was already paying. A compression argument
 * settled on a guess is not settled.
 *
 * So: measure. Every session starts with a fixed body of text the user never
 * typed - the contract file and its imports, the rules that apply to every
 * turn, the SessionStart digest, and the name-and-description line of every
 * skill and agent, which the host puts in front of the model so it can route.
 * That last one is the reason this tool found something: forty-five kilobytes
 * of catalog rode into every Claude Code session and no document had counted
 * it, because it is generated from frontmatter and nobody reads frontmatter for
 * length.
 *
 * NOTHING HERE IS SCORED
 *
 * No budget, no threshold, no grade, for the reason delivery-intel.mjs gives:
 * a number reported as good becomes a number to hit, and the cheapest way to
 * hit a context budget is to delete the guidance that was doing work. This
 * prints what is there. What to do about it is a judgement with an owner.
 * Sorting the on-demand list by size is a sort, not a ranking of worth.
 *
 * PER HOST, AND NOT ADDABLE
 *
 * Claude Code reads CLAUDE.md, which restates the always-on rules inline, and
 * never reads .cursor/rules/. Cursor reads those rules and AGENTS.md, and never
 * reads CLAUDE.md. A single total over both double-counts the same guidance,
 * so there are two totals and they are never summed.
 *
 * MEASURED AND ESTIMATED ARE DIFFERENT WORDS
 *
 * Bytes are measured: the file as it is checked out, CRLF included. Tokens are
 * an estimate at four characters each - no host tokenizer is run here, and the
 * real figure depends on a tokenizer this repository does not ship. The catalog
 * lines are an estimate twice over: the host may truncate a long description,
 * and it wraps each one in framing this repository cannot observe.
 *
 * Usage:
 *   node .cursor/tools/context-cost.mjs report [--top N] [--json]
 *
 * Exit codes:  0 = measured   2 = nothing to measure, or usage
 */

import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { report, emit, warn, info } from "./_findings.mjs";

const TOOL = "context-cost.mjs";
const ROOT = process.env.CLAUDE_PROJECT_DIR || findRepoRoot() || process.cwd();
const CHARS_PER_TOKEN = 4;
const DEFAULT_TOP = 10;
const DIGEST_TIMEOUT_MS = 20_000;      // the SessionStart timeout in .claude/settings.json

const UNITS = {
  bytes: "measured: UTF-8 bytes of the file as checked out, CRLF included",
  tokens: `estimate: characters / ${CHARS_PER_TOKEN}; no host tokenizer is run`,
};

const USAGE = `Usage:
  node .cursor/tools/context-cost.mjs report [--top N] [--json]

Reports what a session carries before the first user word: the contract file and
its imports, the always-on rules, the SessionStart digest, and the skill and
agent description lines the host puts in front of the model. Per host, and the
two totals are never summed. Bytes measured; tokens estimated. Nothing is scored.

Exit codes:
  0 = something was measured   2 = no CLAUDE.md and no AGENTS.md, or usage`;

// ---------------------------------------------------------------- helpers ---

function findRepoRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { stdio: "pipe" }).toString().trim();
  } catch { return null; }
}

const out = (s = "") => process.stdout.write(s + "\n");
const note = (s) => process.stderr.write(s + "\n");
const slash = (p) => String(p).split("\\").join("/");
const abs = (rel) => join(ROOT, ...rel.split("/"));
// toLocaleString is locale-dependent, which makes output a machine cannot pin.
const num = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

class Refusal extends Error {
  constructor(message, exit = 2) { super(message); this.exit = exit; }
}
const refuse = (message, exit = 2) => { throw new Refusal(message, exit); };

function parseOpts(args, spec) {
  const o = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (spec[a] === "flag") { o[a] = true; continue; }
    if (spec[a] === "int") {
      const v = Number(args[++i]);
      if (!Number.isInteger(v) || v < 1) refuse(`${a} needs a whole number of 1 or more (got ${args[i] ?? "nothing"}).`);
      o[a] = v;
      continue;
    }
    if (a.startsWith("--")) refuse(`Unknown option ${a}.\n\n${USAGE}`);
    o._.push(a);
  }
  return o;
}

const tokens = (chars) => Math.ceil(chars / CHARS_PER_TOKEN);

/** Sizes of one repository-relative file, or null when it is not there. */
function measure(rel) {
  const p = abs(rel);
  let text;
  try {
    if (!statSync(p).isFile()) return null;
    text = readFileSync(p, "utf8");
  } catch { return null; }
  const chars = text.length;
  return { path: slash(rel), bytes: Buffer.byteLength(text, "utf8"), chars, tokens: tokens(chars), text };
}

/** Sizes of a string that is not a whole file - a description, the digest. */
const sizeOf = (text) => ({ bytes: Buffer.byteLength(text, "utf8"), chars: text.length, tokens: tokens(text.length) });

const ls = (rel) => { try { return readdirSync(abs(rel)).sort(); } catch { return []; } };

/** The frontmatter block of a document, or null. */
function frontmatter(text) {
  const m = String(text).replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : null;
}

/** One scalar from a frontmatter block. Values here are single-line by convention. */
function fmValue(fm, key) {
  if (!fm) return null;
  const m = fm.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"));
  if (!m) return null;
  return m[1].trim().replace(/^["']|["']$/g, "");
}

/**
 * The `@path` import lines of a document, with line numbers.
 *
 * Fenced blocks are blanked the way docs-lint.mjs does it - spaces, newlines
 * kept - so an example in a code block is not read as an import and every line
 * number still points at the right line.
 */
function importsOf(text) {
  const bare = String(text).replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, " "));
  const found = [];
  bare.split(/\r?\n/).forEach((line, i) => {
    const m = line.match(/^@(\S+)\s*$/);
    if (m) found.push({ spec: m[1], line: i + 1 });
  });
  return found;
}

// ------------------------------------------------------------- always on ---

/**
 * CLAUDE.md, the files it imports one level down, and nothing else.
 *
 * One level, not five: Claude Code follows a chain, and a tool that followed it
 * silently would report a number nobody could check against a file listing. A
 * nested import is reported as not followed instead of being guessed at.
 */
function claudeFiles(findings) {
  const files = [];
  const seen = new Set();
  const add = (m, role) => {
    if (!m || seen.has(m.path)) return false;
    seen.add(m.path);
    files.push({ path: m.path, role, bytes: m.bytes, chars: m.chars, tokens: m.tokens });
    return true;
  };

  for (const rel of ["CLAUDE.md", "CLAUDE.local.md", ".claude/CLAUDE.md"]) {
    const m = measure(rel);
    if (!m) continue;
    add(m, "contract");
    for (const imp of importsOf(m.text)) {
      if (imp.spec.startsWith("~")) {
        findings.push(info("home-import-skipped", `${m.path} imports ${imp.spec} from the home directory; it is outside this repository and is not measured`, { file: m.path, line: imp.line }));
        continue;
      }
      const target = measure(imp.spec.replace(/^\.\//, ""));
      if (!target) {
        findings.push(warn("import-unresolved", `${m.path} imports ${imp.spec}, which is not in this repository; the total excludes it`, { file: m.path, line: imp.line }));
        continue;
      }
      if (!add(target, "import")) continue;
      const nested = importsOf(target.text);
      if (nested.length) {
        findings.push(info("nested-import-not-followed", `${target.path} imports ${nested.length} file(s) of its own; this tool follows one level and does not count them`, { file: target.path, line: nested[0].line }));
      }
    }
  }
  return files;
}

/** AGENTS.md plus every rule that applies to every turn. */
function cursorFiles(findings) {
  const files = [];
  const agents = measure("AGENTS.md");
  if (agents) files.push({ path: agents.path, role: "contract", bytes: agents.bytes, chars: agents.chars, tokens: agents.tokens });
  for (const r of rules().always) files.push({ path: r.path, role: "rule", bytes: r.bytes, chars: r.chars, tokens: r.tokens });
  return files;
}

let RULES_CACHE = null;
/** .cursor/rules/*.mdc split by whether the frontmatter says alwaysApply: true. */
function rules() {
  if (RULES_CACHE) return RULES_CACHE;
  const always = [];
  const glob = [];
  for (const f of ls(".cursor/rules")) {
    if (!f.endsWith(".mdc")) continue;
    const m = measure(`.cursor/rules/${f}`);
    if (!m) continue;
    const row = { path: m.path, bytes: m.bytes, chars: m.chars, tokens: m.tokens };
    (/^true$/i.test(String(fmValue(frontmatter(m.text), "alwaysApply"))) ? always : glob).push(row);
  }
  RULES_CACHE = { always, glob };
  return RULES_CACHE;
}

/**
 * The catalog lines: what the host shows the model so it can route to a skill or
 * an agent without reading either. Measured as the name and description values
 * themselves, which is what carries the meaning; the host's own framing around
 * them is not observable from here, and it may truncate a long one. Hence
 * estimate, in both directions.
 */
function catalog(dir, file) {
  let bytes = 0, chars = 0, count = 0;
  const items = [];
  for (const entry of ls(dir)) {
    const rel = file ? `${dir}/${entry}/${file}` : `${dir}/${entry}`;
    if (!file && !entry.endsWith(".md")) continue;
    const m = measure(rel);
    if (!m) continue;
    const fm = frontmatter(m.text);
    const name = fmValue(fm, "name") || "";
    const description = fmValue(fm, "description") || "";
    if (!name && !description) continue;
    const s = sizeOf(`${name}${description}`);
    bytes += s.bytes; chars += s.chars; count++;
    items.push({ path: m.path, bytes: s.bytes, chars: s.chars, tokens: s.tokens });
  }
  return { count, bytes, chars, tokens: tokens(chars), items };
}

/**
 * The SessionStart digest, by RUNNING the hook.
 *
 * The digest is not a file. It is four memory-bank files clipped to a character
 * budget, plus derived lifecycle status, repo-map age and a fixed rules block.
 * Re-deriving that here would be the second copy session-start.mjs warns about
 * in its own header, and the two would disagree the first time either changed.
 * So spawn it, with `{}` on stdin, and measure what it emits.
 */
function digest(findings) {
  const candidates = [
    abs(".claude/hooks/session-start.mjs"),
    fileURLToPath(new URL("../../.claude/hooks/session-start.mjs", import.meta.url)),
    fileURLToPath(new URL("../hooks/session-start.mjs", import.meta.url)),   // installed plugin
  ];
  const hook = candidates.find((p) => { try { return statSync(p).isFile(); } catch { return false; } });
  const skip = (why) => {
    findings.push(warn("digest-unmeasured", `the SessionStart digest could not be measured (${why}); the totals below exclude it`));
    return null;
  };
  if (!hook) return skip("no session-start.mjs beside this tool or under .claude/hooks/");

  const r = spawnSync(process.execPath, [hook], {
    input: "{}", encoding: "utf8", cwd: ROOT,
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
    timeout: DIGEST_TIMEOUT_MS,
  });
  if (r.error?.code === "ETIMEDOUT") return skip(`it did not finish within ${DIGEST_TIMEOUT_MS / 1000}s`);
  if (r.error) return skip(r.error.message);
  let body;
  try { body = JSON.parse(r.stdout || ""); }
  catch { return skip(`it printed something this tool cannot parse as JSON (exit ${r.status})`); }
  const text = body?.hookSpecificOutput?.additionalContext ?? body?.additional_context;
  if (typeof text !== "string" || !text) return skip(`it answered without a context string (exit ${r.status})`);
  return { ...sizeOf(text), hook: slash(hook) };
}

// ------------------------------------------------------------- on demand ---

function onDemandGroup(rels) {
  const items = rels.map(measure).filter(Boolean)
    .map((m) => ({ path: m.path, bytes: m.bytes, chars: m.chars, tokens: m.tokens }))
    .sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
  return { count: items.length, bytes: items.reduce((n, x) => n + x.bytes, 0), items };
}

function onDemand() {
  const skills = onDemandGroup(ls(".cursor/skills").map((d) => `.cursor/skills/${d}/skill.md`));
  const agents = onDemandGroup(ls(".claude/agents").filter((f) => f.endsWith(".md")).map((f) => `.claude/agents/${f}`));
  const globRules = { ...onDemandGroup(rules().glob.map((r) => r.path)) };
  return { skills, agents, globRules };
}

function mcp() {
  const m = measure(".mcp.json");
  if (!m) return { file: ".mcp.json", servers: 0, present: false };
  let servers = 0;
  try { servers = Object.keys(JSON.parse(m.text).mcpServers || {}).length; } catch { /* malformed: 0 */ }
  return { file: m.path, servers, present: true };
}

// -------------------------------------------------------------- assembly ---

const sum = (rows, key) => rows.reduce((n, r) => n + r[key], 0);

function collect(findings) {
  const claude = claudeFiles(findings);
  const cursor = cursorFiles(findings);
  if (!claude.length && !cursor.length) return null;

  const skillCatalog = catalog(".claude/skills", "SKILL.md");
  const agentCatalog = catalog(".claude/agents", null);
  const d = digest(findings);
  const dBytes = d ? d.bytes : 0;
  const dChars = d ? d.chars : 0;

  const claudeTotal = {
    bytes: sum(claude, "bytes") + skillCatalog.bytes + agentCatalog.bytes + dBytes,
    chars: sum(claude, "chars") + skillCatalog.chars + agentCatalog.chars + dChars,
  };
  const cursorTotal = { bytes: sum(cursor, "bytes") + dBytes, chars: sum(cursor, "chars") + dChars };

  return {
    units: UNITS,
    digestIncluded: !!d,
    hosts: {
      claude: {
        files: claude, filesBytes: sum(claude, "bytes"),
        catalog: {
          skills: { count: skillCatalog.count, bytes: skillCatalog.bytes, tokens: skillCatalog.tokens },
          agents: { count: agentCatalog.count, bytes: agentCatalog.bytes, tokens: agentCatalog.tokens },
        },
        digestBytes: dBytes,
        total: { ...claudeTotal, tokens: tokens(claudeTotal.chars) },
      },
      cursor: {
        files: cursor, filesBytes: sum(cursor, "bytes"),
        digestBytes: dBytes,
        total: { ...cursorTotal, tokens: tokens(cursorTotal.chars) },
      },
    },
    digest: d ? { bytes: d.bytes, chars: d.chars, tokens: d.tokens, hook: d.hook } : null,
    onDemand: onDemand(),
    mcp: mcp(),
  };
}

// --------------------------------------------------------------- command ---

const W = 52;
function row(label, tag, bytes, tok) {
  out(`  ${String(label).slice(0, W).padEnd(W)}${String(tag).padEnd(9)}${num(bytes).padStart(10)} B   ~${num(tok).padStart(7)} tok`);
}

function cmdReport(args) {
  const opts = parseOpts(args, { "--top": "int", "--json": "flag" });
  if (opts._.length) refuse(`report takes no arguments.\n\n${USAGE}`);
  const top = opts["--top"] ?? DEFAULT_TOP;

  const findings = [];
  const data = collect(findings);

  if (!data) {
    const summary = "no CLAUDE.md and no AGENTS.md: there is no always-on context in this repository to measure";
    if (opts["--json"]) return emit(report({ tool: TOOL, command: "report", skipped: true, data: null, summary }));
    note(summary);
    return 2;
  }

  const c = data.hosts.claude;
  const u = data.hosts.cursor;
  findings.push(info("always-on-claude", `Claude Code carries ${num(c.total.bytes)} B (~${num(c.total.tokens)} estimated tokens) before the first user word`));
  findings.push(info("always-on-cursor", `Cursor carries ${num(u.total.bytes)} B (~${num(u.total.tokens)} estimated tokens) before the first user word`));
  findings.push(info("catalog-lines", `${c.catalog.skills.count} skill and ${c.catalog.agents.count} agent description lines are ${num(c.catalog.skills.bytes + c.catalog.agents.bytes)} B of that; an estimate either way, since the host may truncate a long one and adds framing this repository cannot see`));
  findings.push(info("on-demand", `${data.onDemand.skills.count} skill bodies (${num(data.onDemand.skills.bytes)} B) and ${data.onDemand.agents.count} agent bodies (${num(data.onDemand.agents.bytes)} B) load only when used`));
  findings.push(info("mcp-servers", data.mcp.present
    ? `${data.mcp.servers} MCP server(s) in ${data.mcp.file}; each injects its tool schema every turn, which is not measurable from this repository`
    : `no ${data.mcp.file}; any MCP server configured in the editor is not measurable from this repository`));

  if (opts["--json"]) {
    return emit(report({
      tool: TOOL, command: "report", ok: true, exit: 0, findings, data,
      summary: `Claude Code ~${num(c.total.tokens)} tokens, Cursor ~${num(u.total.tokens)} tokens always on (estimated)`,
    }));
  }

  out(`context-cost - what a session carries before the first user word.`);
  out();
  out(`  bytes   ${UNITS.bytes}`);
  out(`  tokens  ${UNITS.tokens}`);
  out(`  Per host, and never summed: Claude Code reads CLAUDE.md, which restates the`);
  out(`  always-on rules inline, and never reads .cursor/rules/. Cursor reads those`);
  out(`  rules and AGENTS.md, and never reads CLAUDE.md.`);
  out();

  out(`Claude Code, always on`);
  for (const f of c.files) row(f.path, f.role, f.bytes, f.tokens);
  if (c.catalog.skills.count) row(`${c.catalog.skills.count} skill description lines`, "catalog", c.catalog.skills.bytes, c.catalog.skills.tokens);
  if (c.catalog.agents.count) row(`${c.catalog.agents.count} agent description lines`, "catalog", c.catalog.agents.bytes, c.catalog.agents.tokens);
  if (data.digest) row("SessionStart digest", "hook", data.digest.bytes, data.digest.tokens);
  row("total" + (data.digest ? "" : " (digest excluded)"), "", c.total.bytes, c.total.tokens);
  out();

  out(`Cursor, always on`);
  for (const f of u.files) row(f.path, f.role, f.bytes, f.tokens);
  if (data.digest) row("SessionStart digest", "hook", data.digest.bytes, data.digest.tokens);
  row("total" + (data.digest ? "" : " (digest excluded)"), "", u.total.bytes, u.total.tokens);
  out();

  for (const [name, g] of [["skill bodies", data.onDemand.skills], ["agent bodies", data.onDemand.agents], ["glob-scoped rules", data.onDemand.globRules]]) {
    if (!g.count) continue;
    const shown = g.items.slice(0, top);
    out(`On demand - ${name}, largest first (${shown.length} of ${g.count}, ${num(g.bytes)} B in total)`);
    for (const x of shown) row(x.path, "", x.bytes, x.tokens);
    if (g.count > shown.length) out(`  (+${g.count - shown.length} more; --json lists every one)`);
    out();
  }

  for (const f of findings) if (f.severity === "warn") note(`warning: ${f.message}`);
  out(data.mcp.present
    ? `${data.mcp.servers} MCP server(s) in ${data.mcp.file}. Each injects its tool schema on every turn; that cost is real and is not measurable from this repository.`
    : `No ${data.mcp.file}. Any MCP server configured in the editor is not measurable from this repository.`);
  out(`Nothing here is scored. What to do about any of it is a judgement with an owner.`);
  return 0;
}

const CMDS = { report: cmdReport };

function main(argv) {
  const [cmd, ...args] = argv;
  if (!cmd || cmd === "--help" || cmd === "-h") { out(USAGE); return 0; }
  if (!CMDS[cmd]) { note(`Unknown command "${cmd}".\n\n${USAGE}`); return 2; }
  try {
    return CMDS[cmd](args) ?? 0;
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    note(e.message);
    return e.exit;
  }
}

// ------------------------------------------------------------------- main ---
const invoked = (() => {
  try {
    const self = fileURLToPath(import.meta.url);
    const arg = resolve(process.argv[1] || "");
    return self === arg || self.toLowerCase() === arg.toLowerCase();
  } catch { return false; }
})();
if (invoked) process.exitCode = main(process.argv.slice(2));
