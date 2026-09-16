#!/usr/bin/env node
/**
 * omniroute.mjs — read what a session is pointed at; never run the gateway.
 *
 * OmniRoute (https://github.com/diegosouzapw/OmniRoute) is a third-party local
 * LLM gateway: one Anthropic-compatible endpoint that routes to hundreds of
 * providers with fallback, spend analytics and token compression. A human
 * installs it and runs it on their own machine. This platform never does, from
 * an agent or from CI, and never runs `omniroute configure` / `setup-claude`:
 * those write ~/.claude/profiles/<name>/settings.json, outside the enforcement
 * surface this repository reviews. `omniroute launch` injects two environment
 * variables into one process and writes nothing; that is the sanctioned way in.
 *
 * What it gives the platform is the answer to a question nothing else can ask.
 * ANTHROPIC_DEFAULT_OPUS_MODEL and its siblings remap what Claude Code's tiers
 * resolve to, and OmniRoute surfaces non-Claude models as `claude/<provider>/<model>`
 * aliases. Every lifecycle gate names a reviewer, every reviewer is an agent with
 * a declared model tier, and a verdict recorded by a small free model wearing a
 * Claude-shaped name is a form, not a control. `tiers` answers that from the
 * environment alone, and /lifecycle-gate stops before record-gate on exit 1.
 *
 * The protected tiers are derived, never hardcoded: the reviewer named by each
 * .cursor/lifecycle/gates/*.gate.md, resolved to the `model:` its agent declares.
 * Add a haiku reviewer and haiku becomes protected on the next run. With no gate
 * files it assumes opus and sonnet and says so.
 *
 * Native means Anthropic's own id shape, /^claude-[a-z0-9][a-z0-9.-]*$/ — no
 * slash. `claude/kimi/kimi-k2.6` is the trap this rule exists for, not a pass.
 *
 * One departure from graphify.mjs, which has no side effects at all: a live
 * service has no file to hash, so `status` and `models` make ONE request — GET
 * /v1/models, loopback host only, refused before the socket opens otherwise,
 * 1500 ms, no redirects, never a completion, nothing written. `tiers` makes
 * none, which is why it is the one the skills call.
 *
 * It verifies declared configuration and the catalog, not traffic. Which model
 * actually answered a given request is in OmniRoute's own headers, which reach
 * Claude Code and not this tool; and no check here can prove which upstream
 * credential the gateway routes `claude-*` to. That is a human's discipline:
 * API keys as providers, never a consumer subscription's OAuth.
 *
 * Usage:
 *   node .cursor/tools/omniroute.mjs status [--json]
 *   node .cursor/tools/omniroute.mjs tiers  [--json]
 *   node .cursor/tools/omniroute.mjs models [--filter <text>] [--limit N] [--json]
 *
 * Exit codes:
 *   status  0 = gateway reachable, reviewer tiers native   1 = a blocking finding   2 = no gateway configured, or usage
 *   tiers   0 = direct, or every protected tier native     1 = a protected tier remapped
 *   models  0 = catalog listed                             1 = configured but unreachable or malformed   2 = no gateway, or usage
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import https from "node:https";
import { report, emit, block, warn, info } from "./_findings.mjs";

const TOOL = "omniroute.mjs";
const ROOT = process.env.CLAUDE_PROJECT_DIR || findRepoRoot() || process.cwd();
const GATES_REL = ".cursor/lifecycle/gates";
const AGENTS_REL = ".claude/agents";
const MCP_REL = ".mcp.json";
const PROBE_MS = 1500;             // a governance check must never wait on a hung gateway
const DEFAULT_LIMIT = 60;
const TIERS = ["opus", "sonnet", "haiku"];
const ASSUMED = ["opus", "sonnet"];
// Anthropic's own id shape. No slash, so the claude/<provider>/<model> alias fails it.
const NATIVE = /^claude-[a-z0-9][a-z0-9.-]*$/i;
const ANTHROPIC_OWNERS = new Set(["anthropic", "claude", "claude-code", "claude_code", "anthropic-api"]);
// ANTHROPIC_BASE_URL set to Anthropic's own endpoint is not a gateway: it is the
// default written down. Claude Code sets it itself, so treating "set" as "behind
// a gateway" would have every ordinary session reporting a finding.
const ANTHROPIC_HOST = /(^|\.)anthropic\.com$/i;

const SETUP_HINT = [
  "ANTHROPIC_BASE_URL is not set: this session talks to Anthropic directly, and there is nothing to check.",
  "",
  "OmniRoute is a third-party gateway. A human installs and runs it (Docker on loopback is the recommended",
  "shape), then starts the session with `omniroute launch`, which injects ANTHROPIC_BASE_URL and",
  "ANTHROPIC_AUTH_TOKEN into that one process and writes no files.",
  "This platform never installs, starts or configures it. Do not run `omniroute configure` or",
  "`omniroute setup-claude` here: they write ~/.claude/profiles/<name>/settings.json, outside this",
  "repository's reviewed enforcement surface. Run the gateway with CLI_ALLOW_CONFIG_WRITES=false.",
  "",
  "The hardening checklist, the tier-pinning block and the rest: .cursor/docs/OMNIROUTE.md",
].join("\n");

const USAGE = `Usage:
  node .cursor/tools/omniroute.mjs status [--json]
  node .cursor/tools/omniroute.mjs tiers  [--json]
  node .cursor/tools/omniroute.mjs models [--filter <text>] [--limit N] [--json]

Reads this session's environment, and (status, models) makes one loopback GET /v1/models.
Never starts, configures or sends a completion to the gateway.

Exit codes:
  status  0 = reachable, reviewer tiers native   1 = a blocking finding   2 = no gateway configured, or usage
  tiers   0 = direct, or protected tiers native  1 = a protected tier remapped
  models  0 = catalog listed                     1 = configured but unreachable or malformed   2 = no gateway, or usage`;

// ---------------------------------------------------------------- helpers ---

function findRepoRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { stdio: "pipe" }).toString().trim();
  } catch { return null; }
}

const out = (s = "") => process.stdout.write(s + "\n");
const note = (s) => process.stderr.write(s + "\n");
const readIf = (rel) => { try { return readFileSync(join(ROOT, rel), "utf8"); } catch { return null; } };
const ls = (rel) => { try { return readdirSync(join(ROOT, rel)); } catch { return []; } };

/** A refusal carries its exit code and, for status --json, the finding code it reports as. */
class Refusal extends Error {
  constructor(message, exit, kind) { super(message); this.exit = exit; this.kind = kind; }
}
function refuse(message, exit = 2, kind = "usage") { throw new Refusal(message, exit, kind); }

/** An unset variable and one set to whitespace are the same thing: not configured. */
function envStr(key) {
  const v = process.env[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

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
    if (spec[a] === "str") {
      const v = args[++i];
      if (v === undefined || v.startsWith("--")) refuse(`${a} needs a value.`);
      o[a] = v;
      continue;
    }
    if (a.startsWith("--")) refuse(`Unknown option ${a}.\n\n${USAGE}`);
    o._.push(a);
  }
  return o;
}

// ------------------------------------------------------------ environment ---

const TIER_VAR = (tier) => `ANTHROPIC_DEFAULT_${tier.toUpperCase()}_MODEL`;

/**
 * Everything the session declares. The token is read for presence and for the
 * one loopback request; its value never reaches stdout, stderr or --json.
 */
function session() {
  const raw = envStr("ANTHROPIC_BASE_URL");
  const forced = envStr("ANTHROPIC_MODEL");
  const declared = {};
  for (const t of TIERS) declared[t] = envStr(TIER_VAR(t));
  const token = envStr("ANTHROPIC_AUTH_TOKEN");
  const apiKey = envStr("ANTHROPIC_API_KEY");
  const cfg = {
    raw, forced, declared, token, apiKey,
    compactWindow: envStr("CLAUDE_CODE_AUTO_COMPACT_WINDOW"),
    url: null, display: null, loopback: false, reach: "direct",
  };
  if (!raw) return cfg;
  let u;
  try { u = new URL(raw); } catch { refuse(`ANTHROPIC_BASE_URL is not a URL.\n\n${USAGE}`, 2, "base-url-malformed"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    refuse(`ANTHROPIC_BASE_URL is ${u.protocol}//…, which is not an HTTP endpoint.`, 1, "base-url-malformed");
  }
  cfg.url = u;
  // Never echo the variable back: userinfo in a URL is a credential.
  cfg.display = `${u.protocol}//${u.host}`;
  cfg.loopback = isLoopback(u.hostname);
  // Three cases, not two. Anthropic's own endpoint is the default written down,
  // loopback is the sanctioned gateway, and a third-party host somewhere else is
  // the one worth objecting to.
  cfg.reach = ANTHROPIC_HOST.test(u.hostname) ? "direct" : cfg.loopback ? "loopback" : "remote";
  return cfg;
}

function isLoopback(hostname) {
  const h = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  return /^127(?:\.\d{1,3}){3}$/.test(h);
}

// -------------------------------------------------------- reviewer tiers ---

/** `model: sonnet` or `model: claude-opus-5` -> the tier it spends on. */
function tierOf(model) {
  const m = String(model || "").toLowerCase();
  for (const t of TIERS) if (m.includes(t)) return t;
  return null;
}

/**
 * Which tiers a gate reviewer's judgement runs on, read from the gate files and
 * the agent definitions rather than written down here. Same two regexes
 * self-audit A5 uses, so a gate this cannot parse is one A5 already fails on.
 */
function reviewerTiers() {
  const agentModel = new Map();
  for (const f of ls(AGENTS_REL)) {
    if (!f.endsWith(".md")) continue;
    const src = readIf(`${AGENTS_REL}/${f}`) || "";
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(src);
    const m = /^model:\s*(.+)$/m.exec(fm ? fm[1] : "");
    if (m) agentModel.set(f.replace(/\.md$/, ""), m[1].trim());
  }
  const reviewers = [];
  for (const g of ls(GATES_REL)) {
    if (!g.endsWith(".gate.md")) continue;
    const src = readIf(`${GATES_REL}/${g}`) || "";
    const line = /^\*\*Reviewed by:\*\*(.+)$/mi.exec(src);
    const name = line ? ([...line[1].matchAll(/`([a-z0-9-]+)`/g)].map((x) => x[1])[0] || null) : null;
    if (!name) continue;
    const model = agentModel.get(name) || null;
    reviewers.push({ gate: g, reviewer: name, model, tier: tierOf(model) });
  }
  const derived = [...new Set(reviewers.map((r) => r.tier).filter(Boolean))];
  return derived.length
    ? { protectedTiers: TIERS.filter((t) => derived.includes(t)), source: "gates", reviewers }
    : { protectedTiers: [...ASSUMED], source: "assumed", reviewers };
}

/**
 * What each tier resolves to. An explicit tier variable wins for its tier;
 * ANTHROPIC_MODEL covers whatever is left; unset means Claude Code's own default,
 * which is Anthropic's.
 */
function tierTable(cfg) {
  const t = {};
  for (const tier of TIERS) {
    const effective = cfg.declared[tier] || cfg.forced || null;
    t[tier] = {
      declared: cfg.declared[tier],
      forced: !cfg.declared[tier] && cfg.forced ? cfg.forced : null,
      effective,
      native: effective === null ? true : NATIVE.test(effective),
    };
  }
  return t;
}

function tiersPayload() {
  const cfg = session();
  const rev = reviewerTiers();
  const table = tierTable(cfg);
  const remapped = rev.protectedTiers.filter((t) => !table[t].native);
  return {
    tool: TOOL,
    mode: cfg.reach === "direct" ? "direct" : "gateway",
    gateway: cfg.reach === "direct" ? null : cfg.display,
    loopback: cfg.raw ? cfg.loopback : null,
    source: rev.source,
    protected: rev.protectedTiers,
    reviewers: rev.reviewers.map((r) => ({ gate: r.gate, reviewer: r.reviewer, model: r.model, tier: r.tier })),
    tiers: table,
    remapped,
    compactWindow: cfg.compactWindow,
    cfg, rev,
  };
}

// ------------------------------------------------------------- the probe ---

/**
 * The only request this tool makes. Loopback is checked by the caller, before
 * anything opens a socket. No redirect is followed: a 3xx from a gateway that
 * should be answering with a catalog is not something to chase.
 */
function getModels(cfg) {
  const u = new URL(cfg.url.toString());
  const base = u.pathname.replace(/\/+$/, "");
  u.pathname = /\/v1$/.test(base) ? `${base}/models` : `${base}/v1/models`;
  const lib = u.protocol === "https:" ? https : http;
  const headers = { accept: "application/json", "user-agent": "cursor-platform/omniroute.mjs (read-only)" };
  if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;
  else if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;

  return new Promise((done) => {
    let settled = false;
    let req = null;
    // A socket timeout starts when the socket is assigned, so a connect that
    // hangs before that would wait past PROBE_MS. One wall-clock timer is the
    // only thing that bounds every case.
    const hard = setTimeout(() => { try { req?.destroy(); } catch { /* already gone */ } finish({ error: `no answer within ${PROBE_MS} ms` }); }, PROBE_MS);
    const finish = (v) => { if (settled) return; settled = true; clearTimeout(hard); done(v); };
    try {
      req = lib.request(u, { method: "GET", headers, timeout: PROBE_MS }, (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (c) => { size += c.length; if (size <= 4_000_000) chunks.push(c); });
        res.on("end", () => finish({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", (e) => finish({ error: e.message }));
      });
    } catch (e) { finish({ error: e.message }); return; }
    req.on("timeout", () => { req.destroy(); finish({ error: `no answer within ${PROBE_MS} ms` }); });
    req.on("error", (e) => finish({ error: e.code === "ECONNREFUSED" ? "connection refused" : e.message }));
    req.end();
  });
}

const providerOf = (m) => {
  const owner = typeof m.owned_by === "string" ? m.owned_by.trim() : "";
  if (owner) return owner;
  const id = String(m.id || "");
  return id.includes("/") ? id.slice(0, id.indexOf("/")) : null;
};

/** The catalog, or a refusal naming the first thing wrong with it. */
function parseCatalog(res) {
  if (res.error) refuse(`No answer from the gateway at ${res.display}: ${res.error}.`, 1, "unreachable");
  if (res.status === 401 || res.status === 403) {
    refuse([
      `The gateway answered ${res.status} for GET /v1/models.`,
      "REQUIRE_API_KEY is on and ANTHROPIC_AUTH_TOKEN is missing or not accepted.",
      "Start the session with `omniroute launch`, which injects it, or mint a key in the dashboard.",
    ].join("\n"), 1, "unauthorized");
  }
  if (res.status >= 300) refuse(`The gateway answered ${res.status} for GET /v1/models.`, 1, "unreachable");
  let body;
  try { body = JSON.parse(res.body); } catch { refuse("GET /v1/models did not return JSON.", 1, "malformed-models"); }
  const data = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : null;
  if (!data) refuse("GET /v1/models returned JSON with no data[] of models.", 1, "malformed-models");
  const models = data
    .map((m) => (typeof m === "string" ? { id: m } : m))
    .filter((m) => m && typeof m.id === "string" && m.id)
    .map((m) => ({ id: m.id, provider: providerOf(m), native: NATIVE.test(m.id) }));
  const kind = Object.keys(res.headers || {}).some((h) => /^x-omniroute-/i.test(h)) ? "omniroute" : "unknown";
  return { models, kind };
}

/**
 * The catalog, or null when there is no gateway to ask. Refuses only when a
 * gateway is configured and something about it is wrong.
 */
async function catalog(cfg) {
  if (cfg.reach === "direct") return null;
  // One classifier decides this, in session(). Re-deriving "is it loopback" here
  // would be a second answer to a question that already has one, and the two
  // would disagree the first time either moved.
  if (cfg.reach === "remote") {
    refuse([
      `ANTHROPIC_BASE_URL points at ${cfg.display}, which is not a loopback address. No request was made.`,
      "",
      "A gateway holding every provider key belongs on 127.0.0.1. `omniroute serve` binds 0.0.0.0 by",
      "default: set OMNIROUTE_SERVER_HOST=127.0.0.1, or publish the container as -p 127.0.0.1:20128:20128.",
      "If the gateway is genuinely remote and that is deliberate, this tool has nothing to say about it;",
      "`tiers` still checks the reviewer tiers, from the environment alone.",
    ].join("\n"), 1, "base-url-not-loopback");
  }
  const res = await getModels(cfg);
  res.display = cfg.display;
  return parseCatalog(res);
}

// --------------------------------------------------------------- commands ---

async function cmdStatus(args) {
  const opts = parseOpts(args, { "--json": "flag" });
  if (opts._.length) refuse(`status takes no arguments.\n\n${USAGE}`);
  const p = tiersPayload();
  const { cfg, rev, tiers: table } = p;
  const cat = await catalog(cfg);                  // null when direct; refuses on not-loopback / unreachable
  const byId = new Map((cat?.models || []).map((m) => [m.id, m]));

  const findings = [cat
    ? info("gateway", `${cfg.display} answered with ${cat.models.length} model(s); looks like ${cat.kind === "omniroute" ? "OmniRoute" : "an unidentified gateway"}; session token ${cfg.token || cfg.apiKey ? "set" : "NOT set"}`)
    : info("gateway", `no gateway: ${cfg.raw ? `ANTHROPIC_BASE_URL is Anthropic's own endpoint (${cfg.display})` : "ANTHROPIC_BASE_URL is unset"}, so this session reaches Anthropic directly`)];
  const mcp = (() => { try { return Object.keys(JSON.parse(readIf(MCP_REL) || "{}").mcpServers || {}); } catch { return []; } })();
  findings.push(info("mcp-server", mcp.includes("omniroute")
    ? `${MCP_REL} registers an "omniroute" MCP server; .cursor/mcp-policy.json governs what it may do`
    : `${MCP_REL} registers no "omniroute" MCP server; the gateway's own tools are not reachable from here`, { file: MCP_REL }));
  findings.push(info("reviewer-tiers", rev.source === "gates"
    ? `protected: ${rev.protectedTiers.join(", ")} — from ${rev.reviewers.length} gate reviewer(s): ${rev.reviewers.map((r) => `${r.reviewer}=${r.tier || "?"}`).join(", ")}`
    : `protected: ${rev.protectedTiers.join(", ")} — assumed; no gate file names a reviewer this tool could resolve to an agent model`));

  for (const tier of TIERS) {
    const row = table[tier];
    const guarded = rev.protectedTiers.includes(tier);
    if (!row.native && guarded) {
      findings.push(block("reviewer-tier-remapped", `the ${tier} tier resolves to "${row.effective}", which is not an Anthropic model id${row.forced ? " (via ANTHROPIC_MODEL)" : ""}. A gate reviewer runs on this tier.`, { detail: { tier, model: row.effective, via: row.forced ? "ANTHROPIC_MODEL" : TIER_VAR(tier) } }));
      continue;
    }
    if (!row.native) {
      findings.push(info("haiku-tier-remapped", `the ${tier} tier resolves to "${row.effective}". No gate reviewer runs on it, so this is allowed.`, { detail: { tier, model: row.effective } }));
      if (!cfg.compactWindow) {
        findings.push(warn("compact-window-unset", `CLAUDE_CODE_AUTO_COMPACT_WINDOW is unset and the ${tier} tier is remapped. Claude Code assumes 200K for an id it does not know, so it will compact at the wrong point.`));
      }
      continue;
    }
    if (!row.effective || !cat) continue;          // unset, or no catalog to compare against
    const hit = byId.get(row.effective);
    if (!hit) {
      findings.push(warn("unknown-model-id", `the ${tier} tier is pinned to "${row.effective}", which this gateway does not list. Requests on that tier will fail at the gateway, not here.`, { detail: { tier, model: row.effective } }));
      continue;
    }
    if (hit.provider && !ANTHROPIC_OWNERS.has(hit.provider.toLowerCase()) && guarded) {
      findings.push(block("tier-served-elsewhere", `the ${tier} tier is pinned to "${row.effective}", and this gateway serves that id from provider "${hit.provider}". A gate reviewer runs on this tier.`, { detail: { tier, model: row.effective, provider: hit.provider } }));
    }
  }

  const blocks = findings.filter((f) => f.severity === "block");
  // Direct and clean is nothing to check, not a pass: say so the way every other
  // checker says it, so a caller never reads "0 findings" as "the gateway is fine".
  const nothingToCheck = !cat && !blocks.length && !findings.some((f) => f.severity === "warn");
  const summary = blocks.length
    ? `${blocks.length} blocking finding(s): ${[...new Set(blocks.map((f) => f.code))].join(", ")}`
    : cat
      ? `gateway at ${cfg.display}, ${cat.models.length} model(s); protected tiers (${rev.protectedTiers.join(", ")}) are native`
      : `no gateway: this session reaches Anthropic directly, and the protected tiers (${rev.protectedTiers.join(", ")}) are native`;

  if (opts["--json"]) {
    return emit(report({
      tool: TOOL, command: "status", findings, skipped: nothingToCheck,
      exit: blocks.length ? 1 : nothingToCheck ? 2 : 0, summary,
      data: {
        mode: cfg.reach === "direct" ? "direct" : "gateway",
        gateway: cat ? cfg.display : null, loopback: cfg.raw ? cfg.loopback : null,
        kind: cat ? cat.kind : null, tokenSet: !!(cfg.token || cfg.apiKey),
        models: cat ? cat.models.length : null, mcpRegistered: mcp.includes("omniroute"),
        source: rev.source, protected: rev.protectedTiers, tiers: table,
        remapped: rev.protectedTiers.filter((t) => !table[t].native),
        compactWindow: cfg.compactWindow,
      },
    }));
  }

  out(cat
    ? `Gateway ${cfg.display} — ${cat.models.length} model(s), ${cat.kind === "omniroute" ? "identifies as OmniRoute" : "does not identify itself as OmniRoute"}, token ${cfg.token || cfg.apiKey ? "set" : "NOT set"}.`
    : `No gateway — ${cfg.raw ? `ANTHROPIC_BASE_URL is Anthropic's own endpoint (${cfg.display})` : "ANTHROPIC_BASE_URL is unset"}, so this session reaches Anthropic directly.`);
  out(`Protected tiers ${rev.protectedTiers.join(", ")} (${rev.source === "gates" ? `from ${rev.reviewers.length} gate reviewer(s)` : "assumed; no gate names a resolvable reviewer"}).`);
  out("");
  for (const tier of TIERS) {
    const row = table[tier];
    const mark = row.native ? "native" : "REMAPPED";
    const guarded = rev.protectedTiers.includes(tier) ? " [reviewer]" : "";
    out(`  ${tier.padEnd(8)}${(row.effective || "(Claude Code default)").padEnd(34)}${mark}${guarded}`);
  }
  out("");
  for (const f of findings) if (f.severity !== "info") note(`${f.severity}: ${f.message}`);
  if (!blocks.length) {
    out("OK — every tier a gate reviewer runs on resolves to an Anthropic model id.");
    return nothingToCheck ? 2 : 0;
  }
  out("BLOCKED — do not record a gate verdict from this session.");
  out("Pin the tier and relaunch, for example:");
  for (const f of blocks) {
    const t = f.detail?.tier;
    if (t) out(`  ${TIER_VAR(t)}=claude-<model>    # currently ${f.detail.model}`);
  }
  out("The tier block and the reasoning: .cursor/docs/OMNIROUTE.md");
  return 1;
}

function cmdTiers(args) {
  const opts = parseOpts(args, { "--json": "flag" });
  if (opts._.length) refuse(`tiers takes no arguments.\n\n${USAGE}`);
  const p = tiersPayload();
  const { cfg, rev, tiers: table, remapped } = p;

  if (opts["--json"]) {
    out(JSON.stringify({
      tool: TOOL, command: "tiers", mode: p.mode, gateway: p.gateway, loopback: p.loopback,
      source: rev.source, protected: rev.protectedTiers,
      reviewers: p.reviewers, tiers: table, remapped, compactWindow: cfg.compactWindow,
    }, null, 2));
    return remapped.length ? 1 : 0;
  }

  if (cfg.reach === "direct") {
    out(`Gateway: none — ${cfg.raw ? `ANTHROPIC_BASE_URL is Anthropic's own endpoint (${cfg.display})` : "ANTHROPIC_BASE_URL is unset"}, so this session talks to Anthropic directly.`);
    if (!remapped.length) return 0;
  } else out(`Gateway: ${cfg.display}${cfg.loopback ? "" : " (NOT loopback)"}`);
  out(`Protected tiers: ${rev.protectedTiers.join(", ")} (${rev.source === "gates" ? "derived from the gate files" : "assumed; no gate names a resolvable reviewer"})`);
  for (const tier of TIERS) {
    const row = table[tier];
    out(`  ${tier.padEnd(8)}${(row.effective || "(Claude Code default)").padEnd(34)}${row.native ? "native" : "REMAPPED"}${rev.protectedTiers.includes(tier) ? " [reviewer]" : ""}`);
  }
  if (!remapped.length) {
    out("Reviewer tiers are native. A gate verdict from this session names a Claude model.");
    return 0;
  }
  note(`REVIEWER TIER REMAPPED: ${remapped.map((t) => `${t} -> ${table[t].effective}`).join(", ")}`);
  out("Do not record a gate verdict. Pin the tier and relaunch:");
  for (const t of remapped) out(`  ${TIER_VAR(t)}=claude-<model>    # currently ${table[t].effective}`);
  return 1;
}

async function cmdModels(args) {
  const opts = parseOpts(args, { "--filter": "str", "--limit": "int", "--json": "flag" });
  if (opts._.length) refuse(`models takes no positional arguments.\n\n${USAGE}`);
  const limit = opts["--limit"] ?? DEFAULT_LIMIT;
  const needle = (opts["--filter"] || "").toLowerCase();
  const cfg = session();
  const cat = await catalog(cfg);
  if (!cat) refuse(SETUP_HINT, 2, "absent");
  const table = tierTable(cfg);
  const rows = cat.models.filter((m) => !needle || m.id.toLowerCase().includes(needle) || String(m.provider || "").toLowerCase().includes(needle));
  const byId = new Set(cat.models.map((m) => m.id));
  const pinned = TIERS
    .filter((t) => table[t].effective)
    .map((t) => ({ tier: t, model: table[t].effective, listed: byId.has(table[t].effective) }));

  if (opts["--json"]) {
    out(JSON.stringify({
      tool: TOOL, command: "models", gateway: cfg.display, kind: cat.kind,
      total: cat.models.length, filter: opts["--filter"] || null,
      models: rows.slice(0, limit), omitted: Math.max(0, rows.length - limit),
      pinned, missingPins: pinned.filter((x) => !x.listed).map((x) => x.model),
    }, null, 2));
    return rows.length ? 0 : 1;
  }

  out(`${cfg.display}: ${cat.models.length} model(s)${needle ? `, ${rows.length} matching "${opts["--filter"]}"` : ""}.`);
  if (!rows.length) { out("Nothing matches."); return 1; }
  const groups = new Map();
  for (const m of rows.slice(0, limit)) {
    const g = m.provider || "(no provider)";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(m);
  }
  for (const [g, ms] of [...groups].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
    out("");
    out(`${g} (${ms.length})`);
    for (const m of ms) out(`  ${m.id}${m.native ? "" : "   [not an Anthropic id]"}`);
  }
  if (rows.length > limit) out(`\n(+${rows.length - limit} more, capped at --limit ${limit})`);
  const missing = pinned.filter((x) => !x.listed);
  if (missing.length) note(`warning: pinned but not served here: ${missing.map((x) => `${x.tier}=${x.model}`).join(", ")}`);
  return 0;
}

const CMDS = { status: cmdStatus, tiers: cmdTiers, models: cmdModels };

async function main(argv) {
  const [cmd, ...args] = argv;
  if (!cmd || cmd === "--help" || cmd === "-h") { out(USAGE); return 0; }
  if (!CMDS[cmd]) { note(`Unknown command "${cmd}".\n\n${USAGE}`); return 2; }
  try {
    return (await CMDS[cmd](args)) ?? 0;
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    note(e.message);
    // status --json always answers in the finding envelope, so a caller parsing
    // it never has to tell "no gateway" from "the tool crashed" by reading stderr.
    if (cmd === "status" && args.includes("--json") && e.kind !== "usage") {
      const first = e.message.split("\n")[0];
      return emit(e.kind === "absent"
        ? report({ tool: TOOL, command: "status", skipped: true, data: null, summary: "ANTHROPIC_BASE_URL is unset: this session talks to Anthropic directly, and there is nothing to check" })
        : report({ tool: TOOL, command: "status", exit: e.exit, data: null, summary: first, findings: [block(e.kind, first)] }));
    }
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
if (invoked) process.exitCode = await main(process.argv.slice(2));
