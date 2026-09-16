#!/usr/bin/env node
/**
 * omniroute.test.mjs — the adapter reads a session's environment, refuses a
 * gateway it should not talk to, and never spends a reviewer tier it protects.
 *
 * No case runs OmniRoute or needs it installed: the platform never does either,
 * and a suite that did would be testing OmniRoute. The gateway is a plain
 * http.createServer in a child process, serving a canned /v1/models — which is
 * the whole contract the adapter depends on.
 *
 * The protected tiers are derived from gate files and agent definitions, so
 * every fixture writes its own. A suite that leaned on this repository's six
 * real gates would pass for the wrong reason the day somebody adds a reviewer.
 *
 * ANTHROPIC_BASE_URL is set in the environment that runs this suite, and
 * runTool merges over process.env, so "not configured" is spelled as an empty
 * string. That is not a trick: an unset variable and one set to nothing are the
 * same session, and the tool has to agree.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fixture, runTool, put, gitInit, check, report, section, REPO } from "../_harness.mjs";

const fm = await import(new URL(`file:///${join(REPO, ".cursor", "tools", "_findings.mjs").replace(/\\/g, "/")}`));

const T = "omniroute.mjs";
const TOKEN = "sk-fixture-do-not-print";
const parse = (r) => { try { return JSON.parse(r.out); } catch { return null; } };
const codes = (rep) => (rep?.findings || []).map((f) => f.code);

/* ------------------------------------------------------------ the gateway */

const CATALOG = {
  data: [
    { id: "claude-opus-5", owned_by: "anthropic" },
    { id: "claude-sonnet-5", owned_by: "anthropic" },
    { id: "claude/glm/glm-5.2", owned_by: "zhipu" },
    { id: "gpt-5", owned_by: "openai" },
  ],
};

/**
 * The fake gateway runs in its OWN process, and this is not incidental: runTool
 * uses spawnSync, which blocks this process's event loop for the whole run, so a
 * server listening here would never accept the connection and every case would
 * pass or fail on "unreachable" regardless of what the tool does. The two
 * processes talk through files - a control file this one writes before each
 * case, a log the server appends to and this one reads after.
 */
const DIR = mkdtempSync(join(tmpdir(), "omniroute-gw-"));
const CONTROL = join(DIR, "control.json");
const LOG = join(DIR, "requests.jsonl");
const SCRIPT = join(DIR, "gateway.mjs");

const control = { mode: "ok", body: CATALOG };
const setControl = (patch = {}) => { Object.assign(control, patch); writeFileSync(CONTROL, JSON.stringify(control)); };
const requests = () => { try { return readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const hits = () => requests().length;
const last = () => requests().at(-1) || null;

setControl();
writeFileSync(LOG, "");
writeFileSync(SCRIPT, `
import { createServer } from "node:http";
import { appendFileSync, readFileSync } from "node:fs";
const [control, log] = process.argv.slice(2);
const read = () => JSON.parse(readFileSync(control, "utf8"));
createServer((req, res) => {
  const c = read();
  appendFileSync(log, JSON.stringify({ path: req.url, auth: req.headers.authorization || req.headers["x-api-key"] || null }) + "\\n");
  if (c.mode === "hang") return;
  if (c.mode === "unauthorized") { res.writeHead(401, { "content-type": "application/json" }); return res.end('{"error":"missing key"}'); }
  if (c.mode === "garbage") { res.writeHead(200, { "content-type": "text/html" }); return res.end("<html>dashboard</html>"); }
  if (c.mode === "empty") { res.writeHead(200, { "content-type": "application/json" }); return res.end('{"object":"list"}'); }
  res.writeHead(200, { "content-type": "application/json", "x-omniroute-version": "3.8.50" });
  res.end(JSON.stringify(c.body));
}).listen(0, "127.0.0.1", function () { process.stdout.write("PORT " + this.address().port + "\\n"); });
`);

const child = spawn(process.execPath, [SCRIPT, CONTROL, LOG], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error("the fixture gateway did not report a port")), 10_000);
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d;
    const m = /PORT (\d+)/.exec(buf);
    if (m) { clearTimeout(timer); done(Number(m[1])); }
  });
});
const BASE = `http://127.0.0.1:${PORT}`;
const shutdown = () => { try { child.kill(); } catch { /* already gone */ } };
process.on("exit", shutdown);

/* ------------------------------------------------------------- fixtures */

/** A repo whose gates name `judge-a` (opus) and `judge-b` (sonnet) as reviewers. */
function seeded(name, { gates = [["01-x", "judge-a"], ["02-y", "judge-b"]], agents = { "judge-a": "opus", "judge-b": "sonnet" } } = {}) {
  const root = fixture(name);
  for (const [file, reviewer] of gates) {
    put(root, `.cursor/lifecycle/gates/${file}.gate.md`, `# Gate\n\n**Authored by:** \`someone-else\`\n**Reviewed by:** \`${reviewer}\` — never an author of the artifacts above.\n\nCriteria.\n`);
  }
  for (const [name_, model] of Object.entries(agents)) {
    put(root, `.claude/agents/${name_}.md`, `---\nname: ${name_}\ndescription: A fixture reviewer.\ntools: Read, Grep\nmodel: ${model}\n---\n\nYou judge things.\n`);
  }
  gitInit(root);
  return root;
}

/** Baseline env: no gateway, no pins, no token. Each case overrides what it tests. */
const ENV = (over = {}) => ({
  ANTHROPIC_BASE_URL: "", ANTHROPIC_MODEL: "", ANTHROPIC_AUTH_TOKEN: "", ANTHROPIC_API_KEY: "",
  ANTHROPIC_DEFAULT_OPUS_MODEL: "", ANTHROPIC_DEFAULT_SONNET_MODEL: "", ANTHROPIC_DEFAULT_HAIKU_MODEL: "",
  CLAUDE_CODE_AUTO_COMPACT_WINDOW: "", ...over,
});
const at = (over = {}) => ENV({ ANTHROPIC_BASE_URL: BASE, ANTHROPIC_AUTH_TOKEN: TOKEN, ...over });

/* ------------------------------------------------------------------ 1 */

section("omniroute - no gateway: says so, checks nothing, asks nothing of the network");
{
  const root = seeded("or-absent");
  const before = hits();
  const s = runTool(T, ["status"], root, ENV());
  check("status exits 2 when there is nothing to check", s.exit === 2, `${s.exit} ${s.err}`);
  const j = parse(runTool(T, ["status", "--json"], root, ENV()));
  check("status --json is a valid skipped report", j && fm.validate(j).length === 0 && j.skipped === true && j.exit === 2, j ? fm.validate(j).join("; ") : "not JSON");
  const t = runTool(T, ["tiers", "--json"], root, ENV());
  const tj = parse(t);
  check("tiers exits 0 and reports direct mode", t.exit === 0 && tj?.mode === "direct", `${t.exit} ${tj?.mode}`);
  check("tiers names no gateway", tj?.gateway === null, JSON.stringify(tj?.gateway));
  const m = runTool(T, ["models"], root, ENV());
  check("models exits 2 with no gateway to list", m.exit === 2, `${m.exit} ${m.err}`);
  check("nothing reached the network", hits() === before, `${hits() - before} request(s)`);
  const plain = runTool(T, ["tiers"], root, ENV());
  check("an empty ANTHROPIC_BASE_URL is the same as unset", plain.exit === 0 && /unset/.test(plain.out), `${plain.exit} ${plain.out.slice(0, 120)}`);
  const blank = runTool(T, ["tiers"], root, ENV({ ANTHROPIC_BASE_URL: "   " }));
  check("and so is one set to whitespace", blank.exit === 0 && /unset/.test(blank.out), `${blank.exit} ${(blank.out + blank.err).slice(0, 160)}`);

  // Anthropic's own endpoint is the default written down, not a gateway.
  const direct = runTool(T, ["tiers"], root, ENV({ ANTHROPIC_BASE_URL: "https://api.anthropic.com" }));
  check("api.anthropic.com is direct, not a gateway", direct.exit === 0 && /directly/.test(direct.out), `${direct.exit} ${direct.out.slice(0, 120)}`);
  check("and it reached no network either", hits() === before, `${hits() - before} request(s)`);
  check("no file is written under the fixture", !existsSync(join(root, ".cursor", "cache")) || !readdirSync(join(root, ".cursor", "cache")).length, "cache dir has content");
}

/* ------------------------------------------------------------------ 2 */

section("omniroute - a gateway that is not on loopback is refused before a socket opens");
{
  const root = seeded("or-remote");
  const before = hits();
  const t0 = Date.now();
  const s = runTool(T, ["status", "--json"], root, ENV({ ANTHROPIC_BASE_URL: "http://gateway.invalid:20128" }));
  const elapsed = Date.now() - t0;
  const rep = parse(s);
  check("status exits 1", s.exit === 1, `${s.exit} ${s.err.slice(0, 160)}`);
  check("the finding is base-url-not-loopback, not unreachable", codes(rep).includes("base-url-not-loopback"), codes(rep).join(","));
  check("the refusal is a valid report", rep && fm.validate(rep).length === 0, rep ? fm.validate(rep).join("; ") : "not JSON");
  check("it says no request was made", /No request was made/.test(s.err), s.err.slice(0, 160));
  check("it returned without waiting on a connection", elapsed < 3000, `${elapsed} ms`);
  check("no request reached the fixture gateway", hits() === before, `${hits() - before} request(s)`);
  const t = parse(runTool(T, ["tiers", "--json"], root, ENV({ ANTHROPIC_BASE_URL: "http://gateway.invalid:20128" })));
  check("tiers still answers, and marks it not loopback", t?.mode === "gateway" && t?.loopback === false, JSON.stringify({ mode: t?.mode, loopback: t?.loopback }));
}

/* ------------------------------------------------------------------ 3 */

section("omniroute - a healthy loopback gateway: catalog read, nothing sent");
{
  const root = seeded("or-healthy");
  setControl({ mode: "ok" });
  const s = runTool(T, ["status", "--json"], root, at());
  const rep = parse(s);
  check("status exits 0", s.exit === 0, `${s.exit} ${s.err.slice(0, 200)}`);
  check("the report is valid", rep && fm.validate(rep).length === 0, rep ? fm.validate(rep).join("; ") : "not JSON");
  check("it identifies the gateway from its own header", rep?.data?.kind === "omniroute", JSON.stringify(rep?.data?.kind));
  check("it counted the catalog", rep?.data?.models === 4, JSON.stringify(rep?.data?.models));
  check("it asked for the catalog, not a completion", last()?.path === "/v1/models", String(last()?.path));
  check("no block or warn on a clean session", rep?.counts.block === 0 && rep?.counts.warn === 0, JSON.stringify(rep?.counts));

  const m = parse(runTool(T, ["models", "--json"], root, at()));
  check("models lists all four", m?.models?.length === 4, JSON.stringify(m?.models?.length));
  const native = Object.fromEntries((m?.models || []).map((x) => [x.id, x.native]));
  check("the claude/<provider>/<model> alias is not counted native", native["claude/glm/glm-5.2"] === false, JSON.stringify(native));
  check("Anthropic's own ids are", native["claude-opus-5"] === true && native["claude-sonnet-5"] === true, JSON.stringify(native));
  check("a third-party id is not", native["gpt-5"] === false, JSON.stringify(native));
  const f = parse(runTool(T, ["models", "--json", "--filter", "glm"], root, at()));
  check("--filter narrows the catalog", f?.models?.length === 1, JSON.stringify(f?.models?.length));
  const l = parse(runTool(T, ["models", "--json", "--limit", "2"], root, at()));
  check("--limit caps it and says how many it dropped", l?.models?.length === 2 && l?.omitted === 2, JSON.stringify({ n: l?.models?.length, omitted: l?.omitted }));
  check("models --json is bare, not a finding report", !("schema" in (l || {})), JSON.stringify(Object.keys(l || {})));

  put(root, ".mcp.json", JSON.stringify({ mcpServers: { omniroute: { type: "http", url: BASE } } }));
  const withMcp = parse(runTool(T, ["status", "--json"], root, at()));
  check("it notices when .mcp.json registers the gateway", withMcp?.data?.mcpRegistered === true, JSON.stringify(withMcp?.data?.mcpRegistered));
}

/* ------------------------------------------------------------------ 4 */

section("omniroute - protected tiers come from the gate files, and a remapped one blocks");
{
  const root = seeded("or-tiers");
  const t = parse(runTool(T, ["tiers", "--json"], root, at()));
  check("opus and sonnet are protected, derived from the gates", t?.source === "gates" && JSON.stringify(t?.protected) === '["opus","sonnet"]', JSON.stringify({ source: t?.source, p: t?.protected }));
  check("haiku is not protected: no reviewer runs on it", !t?.protected.includes("haiku"), JSON.stringify(t?.protected));

  const haiku = runTool(T, ["tiers"], root, at({ ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude/glm/glm-5.2" }));
  check("remapping haiku is allowed", haiku.exit === 0, `${haiku.exit} ${haiku.err.slice(0, 160)}`);
  const hs = parse(runTool(T, ["status", "--json"], root, at({ ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude/glm/glm-5.2" })));
  check("status says so as info, and exits 0", hs?.exit === 0 && codes(hs).includes("haiku-tier-remapped"), `${hs?.exit} ${codes(hs).join(",")}`);
  check("and warns the context window is unpinned", codes(hs).includes("compact-window-unset"), codes(hs).join(","));
  const hs2 = parse(runTool(T, ["status", "--json"], root, at({ ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude/glm/glm-5.2", CLAUDE_CODE_AUTO_COMPACT_WINDOW: "120000" })));
  check("setting the window clears that warning", !codes(hs2).includes("compact-window-unset"), codes(hs2).join(","));

  const alias = runTool(T, ["tiers", "--json"], root, at({ ANTHROPIC_DEFAULT_OPUS_MODEL: "claude/kimi/kimi-k2.6" }));
  const aj = parse(alias);
  check("a claude/<provider>/<model> alias on opus is a remap, not a pass", alias.exit === 1 && JSON.stringify(aj?.remapped) === '["opus"]', `${alias.exit} ${JSON.stringify(aj?.remapped)}`);
  const as = parse(runTool(T, ["status", "--json"], root, at({ ANTHROPIC_DEFAULT_OPUS_MODEL: "claude/kimi/kimi-k2.6" })));
  check("status blocks on it", as?.exit === 1 && codes(as).includes("reviewer-tier-remapped"), `${as?.exit} ${codes(as).join(",")}`);
  check("the block names the tier and the model", as?.findings.some((f) => f.code === "reviewer-tier-remapped" && f.detail?.tier === "opus" && f.detail?.model === "claude/kimi/kimi-k2.6"), JSON.stringify(as?.findings.map((f) => f.detail)));

  const native = runTool(T, ["tiers"], root, at({ ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-5" }));
  check("pinning sonnet to a real Claude id passes", native.exit === 0, `${native.exit} ${native.err.slice(0, 160)}`);
  const forced = runTool(T, ["tiers"], root, at({ ANTHROPIC_MODEL: "glm-5.2" }));
  check("ANTHROPIC_MODEL alone remaps every tier and blocks", forced.exit === 1, `${forced.exit} ${forced.out.slice(0, 200)}`);
  const beaten = runTool(T, ["tiers"], root, at({ ANTHROPIC_MODEL: "glm-5.2", ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-5", ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-5" }));
  check("an explicit tier pin beats ANTHROPIC_MODEL for that tier", beaten.exit === 0, `${beaten.exit} ${beaten.out.slice(0, 200)}`);

  // The tiers are data. A gate that names a haiku reviewer protects haiku.
  const hroot = seeded("or-tiers-haiku", { gates: [["01-x", "judge-c"]], agents: { "judge-c": "haiku" } });
  const h = runTool(T, ["tiers", "--json"], hroot, at({ ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude/glm/glm-5.2" }));
  check("a haiku reviewer makes haiku protected", h.exit === 1 && parse(h)?.protected.includes("haiku"), `${h.exit} ${JSON.stringify(parse(h)?.protected)}`);

  // And with nothing to derive from, it assumes the cautious pair and says so.
  const bare = fixture("or-tiers-bare");
  gitInit(bare);
  const b = parse(runTool(T, ["tiers", "--json"], bare, at({ ANTHROPIC_DEFAULT_OPUS_MODEL: "kimi/k2" })));
  check("no gate files: opus and sonnet are assumed, and labelled assumed", b?.source === "assumed" && JSON.stringify(b?.protected) === '["opus","sonnet"]', JSON.stringify({ s: b?.source, p: b?.protected }));
  check("and the assumed pair still blocks", JSON.stringify(b?.remapped) === '["opus"]', JSON.stringify(b?.remapped));
}

/* ------------------------------------------------------------------ 5 */

section("omniroute - the catalog contradicts the pin");
{
  const root = seeded("or-catalog");
  setControl({ mode: "ok" });
  const missing = parse(runTool(T, ["status", "--json"], root, at({ ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-9" })));
  check("a pinned id the gateway does not serve is a warning, not a block", missing?.exit === 0 && codes(missing).includes("unknown-model-id"), `${missing?.exit} ${codes(missing).join(",")}`);

  setControl({ body: { data: [{ id: "claude-sonnet-5", owned_by: "kimi" }, { id: "claude-opus-5", owned_by: "anthropic" }] } });
  const elsewhere = parse(runTool(T, ["status", "--json"], root, at({ ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-5" })));
  check("an Anthropic-looking id the gateway serves from elsewhere blocks", elsewhere?.exit === 1 && codes(elsewhere).includes("tier-served-elsewhere"), `${elsewhere?.exit} ${codes(elsewhere).join(",")}`);
  setControl({ body: CATALOG });
}

/* ------------------------------------------------------------------ 6 */

section("omniroute - a gateway that is down, locked, broken or silent");
{
  const root = seeded("or-sick");
  const dead = runTool(T, ["status", "--json"], root, at({ ANTHROPIC_BASE_URL: "http://127.0.0.1:1" }));
  check("a closed port is unreachable, exit 1", dead.exit === 1 && codes(parse(dead)).includes("unreachable"), `${dead.exit} ${codes(parse(dead)).join(",")}`);

  setControl({ mode: "unauthorized" });
  const un = runTool(T, ["status", "--json"], root, at());
  check("401 is reported as unauthorized, not as down", un.exit === 1 && codes(parse(un)).includes("unauthorized"), `${un.exit} ${codes(parse(un)).join(",")}`);

  setControl({ mode: "garbage" });
  const g = runTool(T, ["status", "--json"], root, at());
  check("a dashboard page where the catalog should be is malformed-models", g.exit === 1 && codes(parse(g)).includes("malformed-models"), `${g.exit} ${codes(parse(g)).join(",")}`);

  setControl({ mode: "empty" });
  const e = runTool(T, ["status", "--json"], root, at());
  check("JSON with no data[] is malformed too", e.exit === 1 && codes(parse(e)).includes("malformed-models"), `${e.exit} ${codes(parse(e)).join(",")}`);

  setControl({ mode: "hang" });
  const t0 = Date.now();
  const h = runTool(T, ["status", "--json"], root, at());
  const elapsed = Date.now() - t0;
  check("a gateway that never answers is bounded, not waited on", h.exit === 1 && codes(parse(h)).includes("unreachable"), `${h.exit} ${codes(parse(h)).join(",")}`);
  check("and it gave up inside four seconds", elapsed < 4000, `${elapsed} ms`);
  setControl({ mode: "ok" });

  // Every sick case still answers in the envelope a caller can parse.
  for (const [label, env] of [["closed port", at({ ANTHROPIC_BASE_URL: "http://127.0.0.1:1" })], ["remote", ENV({ ANTHROPIC_BASE_URL: "http://gateway.invalid:1" })]]) {
    const rep = parse(runTool(T, ["status", "--json"], root, env));
    check(`${label}: --json is still a valid report`, rep && fm.validate(rep).length === 0, rep ? fm.validate(rep).join("; ") : "not JSON");
  }
}

/* ------------------------------------------------------------------ 7 */

section("omniroute - the session token is sent to loopback and printed nowhere");
{
  const root = seeded("or-token");
  setControl({ mode: "ok" });
  for (const args of [["status"], ["status", "--json"], ["tiers", "--json"], ["models", "--json"]]) {
    const r = runTool(T, args, root, at());
    check(`${args.join(" ")}: the token value never appears in output`, !r.out.includes(TOKEN) && !r.err.includes(TOKEN), `${args.join(" ")} leaked it`);
  }
  check("it did reach the gateway as a bearer token", last()?.auth === `Bearer ${TOKEN}`, String(last()?.auth));

  // A credential in the URL is a credential: never echoed back.
  const creds = runTool(T, ["status"], root, ENV({ ANTHROPIC_BASE_URL: `http://user:hunter2@127.0.0.1:${PORT}` }));
  check("userinfo in ANTHROPIC_BASE_URL is not echoed", !creds.out.includes("hunter2") && !creds.err.includes("hunter2"), (creds.out + creds.err).slice(0, 200));

  const anon = runTool(T, ["status", "--json"], root, ENV({ ANTHROPIC_BASE_URL: BASE }));
  check("a session with no token still reads the catalog and says the token is unset", anon.exit === 0 && parse(anon)?.data?.tokenSet === false, `${anon.exit} ${JSON.stringify(parse(anon)?.data?.tokenSet)}`);
}

/* ------------------------------------------------------------------ 8 */

section("omniroute - usage");
{
  const root = seeded("or-usage");
  check("an unknown command exits 2", runTool(T, ["frobnicate"], root, ENV()).exit === 2, "");
  check("an unknown option exits 2", runTool(T, ["tiers", "--deep"], root, ENV()).exit === 2, "");
  check("a stray positional exits 2", runTool(T, ["status", "now"], root, ENV()).exit === 2, "");
  check("--limit 0 is refused", runTool(T, ["models", "--limit", "0"], root, at()).exit === 2, "");
  check("--filter with no value is refused", runTool(T, ["models", "--filter"], root, at()).exit === 2, "");
  const help = runTool(T, ["--help"], root, ENV());
  check("--help exits 0 and names all three commands", help.exit === 0 && /status/.test(help.out) && /tiers/.test(help.out) && /models/.test(help.out), `${help.exit}`);
  const bad = runTool(T, ["status"], root, ENV({ ANTHROPIC_BASE_URL: "not a url" }));
  check("a malformed base URL is a refusal, not a crash", bad.exit === 2, `${bad.exit} ${bad.err.slice(0, 120)}`);
}

/* ------------------------------------------------------------------ 9 */

section("omniroute - the adopter registration OMNIROUTE.md documents is the one failure-modes accepts");
{
  // The doc claims a gateway client must carry its own timeout, retry and
  // breaker, and that OmniRoute's own fallback does not count. A doc that claims
  // it and a scanner that disagrees is worse than neither, so the claim is run.
  const reg = (tail) => `public static class Reg {
  public static void Add(IServiceCollection services, IConfiguration cfg) {
    services.AddHttpClient<LlmGatewayClient>(c =>
    {
        c.BaseAddress = new Uri(cfg["Llm:GatewayUrl"]!);
        c.Timeout = TimeSpan.FromSeconds(60);
    })${tail};
  }
}
`;
  const scan = (name, body) => {
    const root = fixture(name);
    put(root, "src/Api/Startup.cs", body);
    gitInit(root);
    const r = runTool("failure-modes.mjs", ["scan", "--json"], root);
    let deps = null;
    try { deps = JSON.parse(r.out); } catch { /* reported by the caller */ }
    return (Array.isArray(deps) ? deps : []).find((d) => d.name === "LlmGatewayClient") || null;
  };

  const ok = scan("or-adopter-ok", reg(".AddStandardResilienceHandler()"));
  check("the documented registration is seen as an http dependency", ok?.kind === "http", JSON.stringify(ok));
  check("and counts as protected by timeout, retry and breaker", ok?.timeout === true && ok?.retry === true && ok?.breaker === true, JSON.stringify(ok && { t: ok.timeout, r: ok.retry, b: ok.breaker }));
  check("the doc is right that retry without an idempotency key is still flagged", (ok?.findings || []).some((f) => /idempotency/i.test(f.what)), JSON.stringify((ok?.findings || []).map((f) => f.what)));

  const bare = scan("or-adopter-bare", reg(""));
  check("the same client without the handler keeps only its timeout", bare && bare.timeout === true && bare.retry === false && bare.breaker === false, JSON.stringify(bare && { t: bare.timeout, r: bare.retry, b: bare.breaker }));

  // The comment is the trap: "OmniRoute retries for us" describes a protection
  // living in another process, and failure-modes strips comments for exactly
  // this reason. If this ever passes, the doc's claim has become false.
  const claimed = scan("or-adopter-comment", reg("").replace("services.AddHttpClient", "// OmniRoute adds retry, timeout and a circuit breaker for us\n    services.AddHttpClient"));
  check("gateway-side resilience described in a comment protects nothing", claimed && claimed.retry === false && claimed.breaker === false, JSON.stringify(claimed && { r: claimed.retry, b: claimed.breaker }));
}

shutdown();
report("The gateway adapter read the session, refused what it should, and spent no reviewer tier it protects.");
