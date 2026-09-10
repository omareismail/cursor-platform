#!/usr/bin/env node
/**
 * dashboard.mjs — read-only localhost view of a project's platform state.
 *
 * WHY THIS EXISTS
 *
 * The platform already answers every question a status board would ask, as
 * JSON, from seventeen validators. Nothing assembled those answers into one
 * screen a human can keep open while they work. This file is that screen. It
 * computes nothing of its own: every panel is a collector over a tool or a
 * file that already exists. If a panel looks wrong, the fix is in the tool
 * that owns the data, not here.
 *
 * READ-ONLY BY CONSTRUCTION
 *
 * GET only. Never writes lifecycle/state.json, never records a gate, never
 * mutates a cache. The router is a fixed table of paths — no file is served
 * from a URL, so path traversal is not a possible bug. Subprocess arguments
 * are a hardcoded array. Bind address is 127.0.0.1, never 0.0.0.0.
 * Host must be localhost / 127.0.0.1 / [::1] (with optional port); anything
 * else is 400, so a DNS-rebound Host header does not get a response.
 *
 * The Actions panel is a command composer, not an executor. It builds the
 * exact CLI a human pastes into their terminal and pre-flights it against
 * the same refusal function `approve` uses. Nothing mutating originates
 * from a web request — that is how rule 11 stays true.
 *
 * Usage:
 *   node .cursor/tools/dashboard.mjs serve [--port 7777] [--no-open]
 *   node .cursor/tools/dashboard.mjs snapshot [--json]
 *
 * Exit codes:  0 = ok   2 = usage
 */

import { createServer } from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, normalize, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.CLAUDE_PROJECT_DIR || repoRoot() || process.cwd();
process.env.CLAUDE_PROJECT_DIR = ROOT;

const lifecycle = await import(new URL("./lifecycle.mjs", import.meta.url));
lifecycle.setRoot(ROOT);
const {
  readState, deriveAll, derivePhase, governance, gateMeta, gateVersion, gateFile,
  PHASES, CLEARED, RELEASE_CLEARED, approveRefusals,
} = lifecycle;

const artifacts = await import(new URL("./artifact-schema.mjs", import.meta.url));
// The memory bank's two tiers, its template convention and its staleness
// threshold are owned by memory-bank.mjs. This file used to restate all four,
// and its TIER1 (8 files) already disagreed with session-start.mjs's (4) - two
// different answers to "is the memory bank fresh?". Its TIER2 was a second copy
// of the list guard-write.mjs enforces, which meant this board could paint a
// padlock on a file nothing actually protected.
const memoryBank = await import(new URL("./memory-bank.mjs", import.meta.url));
memoryBank.setRoot(ROOT);
const { PLACEHOLDER, isUnfilled, STALE_DAYS } = memoryBank;
const acTrace = await import(new URL("./ac-trace.mjs", import.meta.url));

const HOST = "127.0.0.1";
const DEFAULT_PORT = 7777;
const CACHE_MS = 30_000;
const BLOCKED_FILE = /(\.env)|appsettings.*\.json$|\.pfx$|\.p12$|id_rsa$|settings\.local\.json$/i;

/**
 * DNS-rebinding / Host-header check. The socket is 127.0.0.1, but a browser
 * that was pointed at a public name resolving to loopback still sends that
 * name as Host. Answer only localhost spellings.
 */
export function hostAllowed(header) {
  const raw = String(header || "").trim().toLowerCase();
  return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(raw);
}


const cache = new Map();

function repoRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch { return null; }
}

function empty(hint, command) {
  return { empty: true, hint, command };
}


function underRoot(abs) {
  const root = normalize(ROOT).toLowerCase();
  const target = normalize(abs).toLowerCase();
  return target === root || target.startsWith(root + sep);
}

function safeRead(rel, { json = false, max = 200_000 } = {}) {
  if (!rel || rel.includes("\0") || BLOCKED_FILE.test(rel)) {
    return { ok: false, reason: "blocked" };
  }
  const abs = join(ROOT, ...String(rel).split("/"));
  if (!underRoot(abs) || !existsSync(abs)) return { ok: false, reason: "missing" };
  try {
    if (statSync(abs).isDirectory()) return { ok: false, reason: "directory" };
    const body = readFileSync(abs, "utf8");
    if (body.length > max) return { ok: true, body: body.slice(0, max), truncated: true };
    if (json) {
      try { return { ok: true, data: JSON.parse(body) }; }
      catch { return { ok: false, reason: "invalid json" }; }
    }
    return { ok: true, body };
  } catch { return { ok: false, reason: "unreadable" }; }
}

function listJsonDir(rel) {
  const abs = join(ROOT, ...rel.split("/"));
  if (!existsSync(abs) || !underRoot(abs)) return [];
  try {
    return readdirSync(abs).filter((f) => f.endsWith(".json")).map((f) => {
      const r = safeRead(`${rel}/${f}`, { json: true });
      return r.ok ? r.data : null;
    }).filter(Boolean);
  } catch { return []; }
}

/**
 * Run a sibling tool with a FIXED argument array. No shell, no interpolation,
 * no query parameter ever reaches argv. Exit 1 (findings) is not a failure
 * here — many validators print JSON and then exit 1.
 */
function runTool(name, args, { timeout = 25_000 } = {}) {
  if (!/^[a-z0-9-]+\.mjs$/.test(name)) {
    return { ok: false, ...empty(`Refused to run '${name}'.`, null) };
  }
  const script = join(TOOLS_DIR, name);
  if (!existsSync(script)) {
    return { ok: false, ...empty(`Tool ${name} is not installed.`, null) };
  }
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      cwd: ROOT,
      env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
      encoding: "utf8",
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return parseToolOut(stdout, 0);
  } catch (e) {
    const out = String(e.stdout || "");
    const parsed = parseToolOut(out, e.status ?? 1);
    if (parsed.ok || parsed.report) return parsed;
    const err = String(e.stderr || e.message || "").slice(0, 400);
    return {
      ok: false,
      ...empty(err || `${name} produced no JSON.`, `node .cursor/tools/${name} ${args.join(" ")}`),
    };
  }
}

function parseToolOut(stdout, exit) {
  const t = String(stdout || "").trim();
  if (!t) return { ok: false, empty: true };
  const start = t.startsWith("{") || t.startsWith("[") ? t
    : t.slice(Math.max(t.indexOf("{"), t.indexOf("[")));
  try {
    const parsed = JSON.parse(t.startsWith("{") || t.startsWith("[") ? t : start);
    // The finding-report envelope (schemas/finding.schema.json): the tool's own
    // shape is under `data`, so every renderer written against that shape keeps
    // working, and the normalised findings ride alongside for the Findings panel.
    // A skipped tool (nothing to check) has no data, and the empty-box hint is the
    // right thing to show for it.
    if (parsed && typeof parsed === "object" && parsed.schema === "finding-report/1" && Array.isArray(parsed.findings)) {
      if (parsed.data === null || parsed.data === undefined) return { ok: false, empty: true, hint: parsed.summary, report: parsed };
      return { ok: true, data: parsed.data, exit, report: parsed };
    }
    return { ok: true, data: parsed, exit };
  } catch { return { ok: false, empty: true }; }
}

function fileStatus(rel) {
  const r = safeRead(rel);
  if (!r.ok) return { file: rel, status: "missing", ageDays: null };
  const trimmed = r.body.trim();
  if (!trimmed || trimmed.length < 60 || PLACEHOLDER.test(trimmed) || isUnfilled(trimmed)) {
    return { file: rel, status: "template", ageDays: ageDays(rel) };
  }
  const age = ageDays(rel);
  return { file: rel, status: age !== null && age > STALE_DAYS ? "stale" : "filled", ageDays: age };
}

function ageDays(rel) {
  try {
    const st = statSync(join(ROOT, ...rel.split("/")));
    return (Date.now() - st.mtimeMs) / 86400000;
  } catch { return null; }
}

function clipFilled(rel, n = 800) {
  const st = fileStatus(rel);
  if (st.status === "missing" || st.status === "template") return null;
  const r = safeRead(rel);
  if (!r.ok) return null;
  const t = r.body.trim();
  return t.length > n ? t.slice(0, n) + "\n…" : t;
}

/* ------------------------------------------------------------------ collectors */

function collectOverview() {
  const s = readState();
  const meta = runTool("platform-metadata.mjs", ["show"], { timeout: 10_000 });
  let integrations = [];
  const mcp = safeRead(".mcp.json", { json: true });
  if (mcp.ok && mcp.data?.mcpServers) integrations = Object.keys(mcp.data.mcpServers);

  const counts = meta.ok ? meta.data.counts : null;
  if (!s) {
    return {
      adopted: false,
      product: null,
      root: ROOT,
      integrations,
      counts,
      stack: clipFilled("memory-bank/technologyStack.md"),
      ...empty(
        "This repo has not adopted the product lifecycle. That is valid — the dashboard still shows memory-bank, platform health and whatever caches exist.",
        'node .cursor/tools/lifecycle.mjs init --name "<product>"',
      ),
    };
  }
  const derived = deriveAll(s);
  const g = governance();
  return {
    adopted: true,
    empty: false,
    product: s.product,
    mode: s.mode,
    phase: s.phase,
    phaseStatus: derived[s.phase]?.status || null,
    updated: s.updated,
    root: ROOT,
    derived,
    governance: {
      money: g.money.length > 0,
      pii: g.pii.length > 0,
      auth: g.auth.length > 0,
      regimes: [...(g.regimes?.keys?.() || [])],
      sources: g.read,
    },
    integrations,
    counts,
    stack: clipFilled("memory-bank/technologyStack.md"),
  };
}

function collectLifecycle() {
  const s = readState();
  if (!s) {
    return empty(
      "No lifecycle/state.json — this repo has not adopted the six-phase lifecycle.",
      'node .cursor/tools/lifecycle.mjs init --name "<product>"            # greenfield\nnode .cursor/tools/lifecycle.mjs init --name "<product>" --existing  # brownfield',
    );
  }
  const derived = deriveAll(s);
  const checks = {};
  for (const p of PHASES) {
    const r = runTool("lifecycle.mjs", ["check", p, "--json"], { timeout: 15_000 });
    checks[p] = r.ok ? r.data : { phase: p, ok: false, artifacts: [] };
  }
  const phases = PHASES.map((p) => {
    const meta = gateMeta(p);
    const ph = s.phases?.[p] || {};
    return {
      name: p,
      current: p === s.phase,
      derived: derived[p],
      mechanical: ph.mechanical || null,
      judgement: ph.judgement || null,
      human: ph.human || null,
      override: ph.override || null,
      inherited: !!ph.inherited,
      authors: meta.authors || [],
      reviewer: meta.reviewer || null,
      artifacts: checks[p]?.artifacts || [],
      artifactsOk: !!checks[p]?.ok,
    };
  });
  const crs = listJsonDir("lifecycle/changes").filter((c) => c.status === "OPEN");
  const overrides = phases.filter((p) => p.override && Date.parse(p.override.expiresAt) > Date.now());
  return {
    empty: false,
    product: s.product,
    mode: s.mode,
    phase: s.phase,
    updated: s.updated,
    phases,
    openChangeRequests: crs.map((c) => ({ id: c.id, reason: c.reason, risk: c.risk, by: c.by })),
    activeOverrides: overrides.map((p) => ({ phase: p.name, ...p.override })),
  };
}

function sanitizeImpactFile(s) {
  if (!s) return null;
  const n = String(s).replace(/\\/g, "/").trim();
  if (!n || n.includes("\0") || n.includes("..") || n.startsWith("/") || /^[A-Za-z]:/.test(n)) return null;
  if (!/^[A-Za-z0-9._/@-]+$/.test(n)) return null;
  return n;
}

function sanitizeImpactObject(s) {
  if (!s) return null;
  const n = String(s).trim();
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(n)) return null;
  return n;
}

async function collectImpact(file, object) {
  const safeFile = sanitizeImpactFile(file);
  const safeObj = sanitizeImpactObject(object);
  if ((file || object) && !safeFile && !safeObj) {
    return {
      empty: true,
      coverage: "insufficient",
      hint: "The file or object query was refused (unsafe path or id).",
      command: "node .cursor/tools/feature-map.mjs impact --file <path> --json",
      features: [], objects: [], tests: [], edges: [],
      uninspected: "Query rejected before the map was read.",
    };
  }
  if (!safeFile && !safeObj) {
    return {
      empty: true,
      coverage: "insufficient",
      hint: "Select a source file or database object. An empty result means tracing is incomplete, not that nothing is affected.",
      command: "node .cursor/tools/feature-map.mjs impact --file <path> --json",
      features: [], objects: [], tests: [], edges: [],
      uninspected: "No file or object selected.",
    };
  }
  const fm = await import(new URL("./feature-map.mjs", import.meta.url));
  const m = fm.loadFeatureMap({ required: false }) || fm.emptyMap();
  return fm.impactOf(m, { file: safeFile, object: safeObj });
}

function collectFeatures() {
  const mapFile = safeRead(".cursor/cache/feature-map.json", { json: true });
  const repoFile = safeRead(".cursor/cache/repo-map.json", { json: true });
  const listed = runTool("feature-map.mjs", ["list", "--json"], { timeout: 20_000 });

  const repo = repoFile.ok ? summariseRepo(repoFile.data) : null;
  if (!mapFile.ok && !listed.ok) {
    return {
      ...empty(
        "No feature-map.json. Trace a capability before this panel has anything to show.",
        "node .cursor/tools/feature-map.mjs init\n/feature-inventory full\n/feature-trace \"<name>\"",
      ),
      repo,
    };
  }
  const features = listed.ok && Array.isArray(listed.data) ? listed.data : [];
  if (!features.length) {
    return {
      empty: true,
      hint: "The feature map exists but no features have been traced yet.",
      command: '/feature-trace "<feature name>"',
      repo,
      features: [],
    };
  }
  return { empty: false, features, repo, generatedAt: mapFile.data?.generatedAt || null };
}

function summariseRepo(m) {
  if (!m || typeof m !== "object") return null;
  return {
    generatedAt: m.generatedAt || null,
    projects: (m.projects || []).map((p) => ({
      name: p.name, layer: p.layer, targetFramework: p.targetFramework,
    })),
    cycles: m.dependencyGraph?.cycles || [],
    databaseProviders: m.databaseProviders || [],
    efCoreContexts: m.dataAccess?.efCoreContexts || [],
    dapperRepositories: m.dataAccess?.dapperRepositories || [],
    entryPoints: m.entryPoints || m.frontendModules || [],
  };
}

function collectTraceability() {
  let graph;
  try { graph = artifacts.buildGraph(); }
  catch (e) {
    return empty("Could not build the id graph: " + String(e.message || e).slice(0, 200),
      "node .cursor/tools/artifact-schema.mjs graph --json");
  }
  if (!graph.byId.size) {
    return empty(
      "No FR/S/UC/EP ids found. Run the phase 1–3 skills so the documents exist and carry ids.",
      "/product-requirements\n/user-story-map\n/use-case-gen\n/api-contract-design",
    );
  }
  const ids = [...graph.byId.values()].map((v) => ({ id: v.id, file: v.file, prefix: v.prefix }));
  const counts = {};
  for (const v of ids) counts[v.prefix] = (counts[v.prefix] || 0) + 1;
  const checked = runTool("artifact-schema.mjs", ["check", "--json"], { timeout: 20_000 });
  const ready = runTool("artifact-schema.mjs", ["ready", "--json"], { timeout: 20_000 });
  const findings = checked.ok ? checked.data : { dangling: [], misplaced: [], unlinked: [], duplicate: graph.duplicates };
  const stories = Array.isArray(ready.data) ? ready.data.map((r) => ({
    id: r.id,
    missing: !!r.missing,
    ready: !r.missing && (r.checks || []).every((c) => c.ok || c.warn),
    failed: (r.checks || []).filter((c) => !c.ok && !c.warn).map((c) => c.label),
    title: (r.story?.text || "").replace(/^#+\s*/, "").replace(/^[A-Z]{1,4}-\d+\s*[—–-]\s*/, "").slice(0, 80),
  })) : [];
  return {
    empty: false,
    total: ids.length,
    counts,
    files: graph.files,
    findings,
    stories,
  };
}

function collectQuality() {
  let ac = null;
  try {
    const loaded = acTrace.load([]);
    const a = acTrace.analyse(loaded.acs, loaded.claims);
    ac = {
      acs: loaded.acs.size,
      claims: loaded.claims.length,
      covered: a.covered.length,
      uncovered: a.uncovered.length,
      skippedOnly: a.skippedOnly.length,
      vacuous: a.vacuous.length,
      weak: a.weak.length,
      orphans: a.orphans.length,
      uncoveredIds: a.uncovered.slice(0, 20).map((x) => x.id || x.ac || x),
    };
    if (!loaded.acs.size) {
      ac.empty = true;
      ac.hint = "No acceptance criteria found. Number them AC-1, AC-2 in the spec; tests should carry a matching // AC-N: comment.";
      ac.command = "node .cursor/tools/ac-trace.mjs check --json";
    }
  } catch (e) {
    ac = empty("AC trace could not run: " + String(e.message || e).slice(0, 200),
      "node .cursor/tools/ac-trace.mjs check --json");
  }

  const risk = runTool("risk-profile.mjs", ["check", "--json"], { timeout: 25_000 });
  const fit = runTool("fitness.mjs", ["check", "--json"], { timeout: 25_000 });
  const fail = runTool("failure-modes.mjs", ["check", "--json"], { timeout: 25_000 });

  return {
    empty: false,
    ac,
    risk: risk.ok ? summariseRisk(risk.data) : empty("No risk profile yet — needs a spec with acceptance criteria.", "node .cursor/tools/risk-profile.mjs check --json"),
    fitness: fit.ok ? fit.data : empty("Architecture fitness has nothing to check (un-promoted architecture.md is skipped, not a violation).", "node .cursor/tools/fitness.mjs check --json"),
    failureModes: fail.ok ? fail.data : empty("No dependency registrations found, or the scanner produced no JSON.", "node .cursor/tools/failure-modes.mjs check --json"),
  };
}

function summariseRisk(d) {
  if (!d || d.empty) return d;
  const rows = d.rows || d.criteria || [];
  const gaps = d.gaps || [];
  const byTier = {};
  for (const r of rows) {
    const t = r.tier || r.T || "?";
    byTier[t] = (byTier[t] || 0) + 1;
  }
  return {
    empty: !rows.length && !gaps.length,
    hint: rows.length ? null : "No criteria ranked yet.",
    command: rows.length ? null : "node .cursor/tools/risk-profile.mjs profile --json",
    byTier,
    gaps: gaps.length,
    t1gaps: (d.t1gaps || []).length,
    centralityNote: d.centralityNote || null,
    sample: rows.slice(0, 15).map((r) => ({
      id: r.id || r.ac, tier: r.tier, reason: r.reason || r.rule,
    })),
  };
}

function collectDelivery() {
  const metrics = runTool("delivery-metrics.mjs", ["report", "--days", "90", "--json"], { timeout: 55_000 });
  const incidents = runTool("incidents.mjs", ["check", "--json"], { timeout: 20_000 });
  const flags = runTool("flag-debt.mjs", ["scan", "--json"], { timeout: 25_000 });
  const releases = listJsonDir("lifecycle/releases").map((r) => ({
    version: r.version,
    at: r.at,
    signed: !!r.signature,
    product: r.product,
    commitCount: r.contents?.commitCount,
    phase: r.lifecycle?.phase,
  }));
  const noReleases = !releases.length;
  return {
    empty: false,
    metrics: metrics.ok ? summariseDora(metrics.data) : empty("Could not compute DORA metrics from git.", "node .cursor/tools/delivery-metrics.mjs report --days 90 --json"),
    releases: noReleases
      ? { ...empty("No release records yet.", "node .cursor/tools/release-evidence.mjs cut --version v0.1.0"), items: [] }
      : { empty: false, items: releases },
    incidents: incidents.ok ? incidents.data : empty("No incidents recorded.", "node .cursor/tools/incidents.mjs check --json"),
    flags: flags.ok ? flags.data : empty("Flag scan produced no JSON (or no source to scan).", "node .cursor/tools/flag-debt.mjs scan --json"),
  };
}

function summariseDora(m) {
  if (!m || m.empty) return m;
  const band = (x) => Array.isArray(x?.band) ? x.band[0] : "";
  const cards = [];
  if (m.deploymentFrequency) {
    cards.push({
      label: "Deploy frequency",
      value: `${Number(m.deploymentFrequency.perWeek || 0).toFixed(1)}/week`,
      kind: m.deploymentFrequency.method,
      note: band(m.deploymentFrequency),
    });
  }
  if (m.leadTime) {
    cards.push({
      label: "Lead time",
      value: `median ${Number(m.leadTime.medianHours || 0).toFixed(1)}h`,
      kind: m.leadTime.method,
      note: band(m.leadTime),
    });
  }
  if (m.changeFailureRate) {
    cards.push({
      label: "Change fail rate",
      value: `${Number(m.changeFailureRate.pct || 0).toFixed(1)}%`,
      kind: m.changeFailureRate.method,
      note: band(m.changeFailureRate),
    });
  }
  if (m.mttr) {
    cards.push({
      label: "MTTR",
      value: `median ${Number(m.mttr.medianHours || 0).toFixed(1)}h`,
      kind: m.mttr.method,
      note: band(m.mttr),
    });
  }
  if (m.reworkRate) {
    cards.push({
      label: "Rework",
      value: `${Number(m.reworkRate.pct || 0).toFixed(1)}%`,
      kind: m.reworkRate.method,
      note: `${m.reworkRate.reworkCommits}/${m.reworkRate.totalCommits} commits`,
    });
  }
  return { empty: false, window: m.window, cards, methodNote: "PROXY numbers are inferred from git, not observed deployments." };
}

/**
 * Asks memory-bank.mjs rather than walking the files. `state` becomes `status`
 * here and nowhere else: the panel's vocabulary is this file's business, the
 * list and the convention are not.
 */
function collectMemory() {
  const res = runTool("memory-bank.mjs", ["status", "--json"], { timeout: 10_000 });
  if (!res.ok) {
    return {
      empty: true,
      reason: res.reason || "memory-bank.mjs did not answer.",
      command: "node .cursor/tools/memory-bank.mjs status",
    };
  }
  const map = (rows) => rows.map((f) => ({ file: f.file, status: f.state, ageDays: f.ageDays }));
  const tier1 = map(res.data.tier1 || []);
  const tier2 = map(res.data.tier2 || []);
  const filled = (rows) => rows.filter((r) => r.status === "filled" || r.status === "stale").length;
  return {
    empty: false,
    staleDays: res.data.staleDays,
    digest: res.data.digest,
    tier1: { filled: filled(tier1), total: tier1.length, files: tier1 },
    tier2: { filled: filled(tier2), total: tier2.length, files: tier2 },
    hint: filled(tier1) === 0
      ? "Tier 1 is still the shipped template. On an application repo run /repo-discovery full then /context-sync."
      : null,
    command: filled(tier1) === 0 ? "/repo-discovery full\n/context-sync" : null,
  };
}

function collectPlatform() {
  const docs = runTool("docs-lint.mjs", ["check", "--json"], { timeout: 20_000 });
  const wiring = runTool("self-audit.mjs", ["wiring", "--json"], { timeout: 20_000 });
  const meta = runTool("platform-metadata.mjs", ["show"], { timeout: 10_000 });
  return {
    empty: false,
    docs: docs.ok ? docs.data : empty("docs-lint produced no JSON.", "node .cursor/tools/docs-lint.mjs check --json"),
    wiring: wiring.ok ? wiring.data : empty("self-audit wiring produced no JSON.", "node .cursor/tools/self-audit.mjs wiring --json"),
    metadata: meta.ok ? meta.data : empty("platform-metadata.mjs show failed.", "node .cursor/tools/platform-metadata.mjs show"),
  };
}

const RISK = ["LOW", "MED", "HIGH"];
const VERDICT = ["GO", "NO-GO"];
const DETECTED = ["alert", "monitoring", "customer", "reconciliation", "manual"];
const VERSION_RE = "^v?\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.]+)?$";
const ID_RE = "^[A-Za-z]{1,4}-\\d+$";

function field(name, kind, extra = {}) {
  return { name, kind, required: extra.required !== false, ...extra };
}

function recordGatePreflight(phase, by) {
  const refusals = [];
  const s = readState();
  if (!s) refusals.push("No lifecycle/state.json. Run init first.");
  const gv = gateVersion(phase);
  if (!gv) refusals.push(`No gate definition for ${phase}. Cannot record a verdict against nothing.`);
  const meta = gateMeta(phase);
  if (meta.reviewer && by && by !== meta.reviewer) {
    const authored = (meta.authors || []).includes(by);
    refusals.push(`${phase} is judged by \`${meta.reviewer}\`, not "${by}".` +
      (authored ? ` \`${by}\` authored these artifacts — an author signing twice is one consent.` : ""));
  }
  return { ok: refusals.length === 0, refusals, reviewer: meta.reviewer, authors: meta.authors || [] };
}

function gitPorcelain() {
  try {
    const out = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out ? out.split("\n").filter(Boolean) : [];
  } catch {
    return null;
  }
}

function cutPreflight() {
  const refusals = [];
  const unchecked = ["record hash integrity is only checked when you sign"];
  const s = readState();
  if (!s) refusals.push("No lifecycle/state.json. This repo never adopted the lifecycle.");
  const dirty = gitPorcelain();
  if (dirty === null) refusals.push("No git repository here, or git status failed.");
  else if (dirty.length) refusals.push(`${dirty.length} tracked file(s) modified and not committed.`);
  if (s) {
    const derived = deriveAll(s);
    for (const p of ["DEVELOPMENT", "TESTING"]) {
      if (!RELEASE_CLEARED.has(derived[p]?.status)) {
        refusals.push(`${p} is ${derived[p]?.status || "unknown"}, not cleared.`);
      }
    }
    const devAt = s.phases?.DEVELOPMENT?.human?.at;
    const tstAt = s.phases?.TESTING?.human?.at;
    if (devAt && tstAt && Date.parse(tstAt) < Date.parse(devAt)) {
      refusals.push("TESTING was approved before DEVELOPMENT — re-review TESTING.");
    }
  }
  return { ok: refusals.length === 0, refusals, unchecked };
}

function signPreflight(version) {
  const refusals = [];
  const unchecked = ["record hash integrity — the CLI recomputes it at sign time"];
  const s = readState();
  if (!s) refusals.push("No lifecycle/state.json.");
  if (version) {
    const rec = safeRead(`lifecycle/releases/${version}.json`, { json: true });
    if (!rec.ok) refusals.push(`No record for ${version}. Cut it first.`);
    else if (rec.data?.signature) {
      refusals.push(`${version} was already signed by ${rec.data.signature.by}.`);
    }
  }
  if (s) {
    const derived = deriveAll(s);
    for (const p of ["DEVELOPMENT", "TESTING", "PRODUCTION"]) {
      if (!RELEASE_CLEARED.has(derived[p]?.status)) {
        refusals.push(`${p} is ${derived[p]?.status || "unknown"}, not cleared.`);
      }
    }
    const unverified = PHASES.filter((p) => derived[p]?.status === "INHERITED_UNVERIFIED");
    if (unverified.length) {
      refusals.push(`${unverified.length} inherited phase(s) nobody has verified must be accepted with --accept-inherited: ${unverified.join(", ")}`);
    }
    const now = Date.now();
    const ovs = PHASES.map((p) => s.phases?.[p]?.override)
      .filter((o) => o && (!o.expiresAt || Date.parse(o.expiresAt) > now));
    if (ovs.length) {
      refusals.push(`${ovs.length} active override(s) must be named with --accept-override: ${ovs.map((o) => o.id).join(", ")}`);
    }
  }
  return { ok: refusals.length === 0, refusals, unchecked };
}

// Async because approveRefusals() is: it runs the traceability graph and the
// phase's computed checks, exactly as the CLI does, so the composer's green
// light and the CLI's refusal come from one function rather than two copies.
async function collectActions() {
  const s = readState();
  const knownIds = [];
  try {
    const g = artifacts.buildGraph();
    for (const v of g.byId.values()) knownIds.push(v.id);
  } catch { /* no id convention */ }

  const unsigned = listJsonDir("lifecycle/releases")
    .filter((r) => r.version && !r.signature)
    .map((r) => r.version);

  const openCrs = listJsonDir("lifecycle/changes")
    .filter((c) => c.status === "OPEN")
    .map((c) => ({ id: c.id, reason: c.reason, risk: c.risk }));

  const actions = [];

  if (!s) {
    actions.push({
      id: "init",
      tool: "lifecycle.mjs",
      command: "init",
      group: "lifecycle",
      title: "Initialise lifecycle",
      description: "Create lifecycle/state.json. Greenfield starts at REQUIREMENTS; --existing marks phases 1–3 INHERITED (by whom, checked by whom).",
      fields: [
        field("--name", "text", { required: false, placeholder: "product name" }),
        field("--existing", "flag", { required: false, hint: "Brownfield: phases 1–3 inherited, start at DEVELOPMENT. Needs --by; refuses an empty repo." }),
        field("--by", "text", { required: false, placeholder: "who claims phases 1–3 happened (required with --existing)" }),
        field("--review-by", "text", { required: false, placeholder: "who checked that claim — without it the phases are INHERITED_UNVERIFIED" }),
      ],
      preflight: {
        ok: true,
        refusals: [],
        hint: "This repo has not adopted the lifecycle. That is valid until you decide it has.",
      },
    });
  }

  const byPhase = {};
  for (const p of PHASES) {
    const meta = gateMeta(p);
    const approve = s ? await approveRefusals(s, p, "") : { refusals: ["No lifecycle/state.json."], reapproval: false, override: null };
    const rec = recordGatePreflight(p, meta.reviewer);
    byPhase[p] = {
      reviewer: meta.reviewer,
      authors: meta.authors || [],
      gateFile: gateFile(p),
      gateVersion: gateVersion(p),
      judgementBy: s?.phases?.[p]?.judgement?.by || null,
      judgementVerdict: s?.phases?.[p]?.judgement?.verdict || null,
      recordGate: rec,
      approve: {
        ok: approve.refusals.length === 0,
        refusals: approve.refusals,
        reapproval: !!approve.reapproval,
        override: approve.override,
      },
    };
  }

  if (s) {
    actions.push({
      id: "record-gate",
      tool: "lifecycle.mjs",
      command: "record-gate",
      group: "lifecycle",
      title: "Record gate verdict",
      description: "Judgement consent. --by must be the reviewer the gate file names.",
      fields: [
        field("PHASE", "enum", { options: PHASES, positional: true }),
        field("--verdict", "enum", { options: VERDICT }),
        field("--by", "text", { lockedTo: "reviewer", hint: "Must match the gate's Reviewed by role. Any other value is refused." }),
        field("--criteria", "text", { required: false, placeholder: "7/8", hint: "Stored verbatim; the CLI does not parse it." }),
        field("--note", "text", { required: false }),
      ],
    });
    actions.push({
      id: "approve",
      tool: "lifecycle.mjs",
      command: "approve",
      group: "lifecycle",
      title: "Approve a phase",
      description: "Human consent. Must differ from whoever recorded the verdict. The UI never runs this.",
      fields: [
        field("PHASE", "enum", { options: PHASES, positional: true }),
        field("--by", "text", { hint: "A different party from the recorded verdict. Same name is one consent." }),
        field("--accept-check", "text", { required: false, repeatable: true, placeholder: "ac-trace.mjs", hint: "Take a FAILED computed check on by name (TESTING runs ac-trace)." }),
        field("--note", "text", { required: false }),
      ],
    });

    const cur = derivePhase(s, s.phase);
    const nxt = PHASES[PHASES.indexOf(s.phase) + 1] || null;
    const advRefusals = [];
    if (!CLEARED.has(cur.status)) advRefusals.push(`${s.phase} is ${cur.status}.` + (cur.reasons[0] ? ` ${cur.reasons[0]}` : ""));
    if (!nxt) advRefusals.push(`${s.phase} is the final phase. Nothing to advance to.`);
    actions.push({
      id: "advance",
      tool: "lifecycle.mjs",
      command: "advance",
      group: "lifecycle",
      title: "Advance to next phase",
      description: nxt ? `Move from ${s.phase} to ${nxt}.` : "Already at PRODUCTION.",
      fields: [],
      preflight: { ok: advRefusals.length === 0, refusals: advRefusals, next: nxt },
    });

    actions.push({
      id: "rollback",
      tool: "lifecycle.mjs",
      command: "rollback",
      group: "lifecycle",
      title: "Rollback a phase",
      description: "Reopens the phase and clears every later one. Needs a reason.",
      fields: [
        field("PHASE", "enum", { options: PHASES, positional: true }),
        field("--reason", "text"),
      ],
      preflight: { ok: true, refusals: [], hint: "Always succeeds if the phase and --reason are present. Later phases reset." },
    });

    actions.push({
      id: "override",
      tool: "lifecycle.mjs",
      command: "override",
      group: "lifecycle",
      title: "Record an override",
      description: "Auditable, expiring bypass. A permanent override is a deleted gate.",
      fields: [
        field("PHASE", "enum", { options: PHASES, positional: true }),
        field("--reason", "text"),
        field("--risk", "enum", { options: RISK }),
        field("--by", "text"),
        field("--expires", "int", { min: 1, max: 90, hint: "Days, 1–90." }),
      ],
      preflight: { ok: true, refusals: [], hint: "Succeeds when the flags are valid. Expiry is the control." },
    });

    actions.push({
      id: "cut",
      tool: "release-evidence.mjs",
      command: "cut",
      group: "release",
      title: "Cut a release record",
      description: "Derive what shipped. Refuses a dirty tree or uncleared DEVELOPMENT/TESTING.",
      fields: [
        field("--version", "text", { pattern: VERSION_RE, placeholder: "v1.2.0" }),
        field("--note", "text", { required: false }),
      ],
      preflight: cutPreflight(),
    });

    actions.push({
      id: "sign",
      tool: "release-evidence.mjs",
      command: "sign",
      group: "release",
      title: "Sign a release",
      description: "Authorise a cut record. Name every active override.",
      fields: [
        field("VERSION", "text", { positional: true, pattern: VERSION_RE, placeholder: unsigned[0] || "v1.2.0", options: unsigned.length ? unsigned : undefined }),
        field("--by", "text"),
        field("--accept-override", "text", { required: false, repeatable: true, placeholder: "OV-XXXX" }),
        field("--accept-inherited", "enum", { required: false, repeatable: true, options: PHASES, hint: "Accept, by name, an inherited phase nobody verified." }),
        field("--note", "text", { required: false }),
      ],
      preflight: signPreflight(unsigned[0] || ""),
      unsigned,
    });
  }

  actions.push({
    id: "change-open",
    tool: "change-request.mjs",
    command: "open",
    group: "change",
    title: "Open a change request",
    description: "Forecast first (read-only impact), then open. Unknown ids are recorded, not refused.",
    fields: [
      field("--changes", "text", { placeholder: "BR-4,FR-2", hint: "Comma-separated ids from the grammar." }),
      field("--reason", "text"),
      field("--by", "text"),
      field("--risk", "enum", { options: RISK, required: false, defaultValue: "MED" }),
    ],
    preflight: {
      ok: true,
      refusals: knownIds.length ? [] : ["Id graph is empty — open will exit 1 until phase 1–3 documents exist."],
      hint: "Run impact on the same ids before you open. Missing ids warn; they do not refuse.",
    },
    impactCommand: "node .cursor/tools/change-request.mjs impact",
    knownIds: knownIds.slice(0, 80),
  });

  if (openCrs.length) {
    actions.push({
      id: "change-close",
      tool: "change-request.mjs",
      command: "close",
      group: "change",
      title: "Close a change request",
      description: "Marks a CR closed. Needs the id.",
      fields: [
        field("CR", "enum", { positional: true, options: openCrs.map((c) => c.id) }),
        field("--note", "text", { required: false }),
      ],
      preflight: { ok: true, refusals: [] },
      openChangeRequests: openCrs,
    });
  }

  actions.push({
    id: "incident-open",
    tool: "incidents.mjs",
    command: "open",
    group: "incident",
    title: "Open an incident",
    description: "Requires --guard path[#needle] or --unmechanisable, not both empty.",
    fields: [
      field("--title", "text"),
      field("--detected", "enum", { options: DETECTED }),
      field("--by", "text"),
      field("--guard", "text", { required: false, placeholder: "templates/dotnet/BannedSymbols.txt#DateTime.Now", hint: "path or path#needle. XOR with --unmechanisable." }),
      field("--unmechanisable", "text", { required: false, hint: "Required if --guard is empty." }),
      field("--falsifies", "text", { required: false, placeholder: "NFR-3" }),
      field("--impact", "text", { required: false }),
      field("--postmortem", "text", { required: false }),
      field("--note", "text", { required: false }),
    ],
    xor: ["--guard", "--unmechanisable"],
    preflight: { ok: true, refusals: [], hint: "Recurrence is detected at write time against prior incidents." },
  });

  actions.push({
    id: "fitness-baseline",
    tool: "fitness.mjs",
    command: "baseline",
    group: "quality",
    title: "Accept fitness baseline",
    description: "--accept writes the ratchet. --accept-new is required if the violation set grew.",
    fields: [
      field("--accept", "flag", { required: false, defaultValue: true, hint: "Without this the CLI only reports." }),
      field("--accept-new", "flag", { required: false, hint: "Required if new violations appeared since the last baseline." }),
      field("--by", "text", { required: false }),
    ],
    preflight: {
      ok: true,
      refusals: [],
      unchecked: ["whether new violations exist — run fitness.mjs check, or read the Quality panel"],
    },
  });

  return {
    empty: false,
    adopted: !!s,
    product: s?.product || null,
    phase: s?.phase || null,
    byPhase,
    knownIds: knownIds.slice(0, 80),
    unsignedReleases: unsigned,
    openChangeRequests: openCrs,
    actions,
  };
}

/**
 * Every checker, one list. Each tool's --json is a finding report
 * (schemas/finding.schema.json), so this does not know eight shapes - it knows
 * one, and a ninth tool joins by emitting it. Tools that are not installed or
 * produce no report are listed as such rather than dropped: "not run" is a
 * different fact from "clean".
 */
const FINDING_TOOLS = [
  ["ac-trace.mjs", ["check", "--json"]],
  ["risk-profile.mjs", ["check", "--json"]],
  ["fitness.mjs", ["check", "--json"]],
  ["failure-modes.mjs", ["check", "--json"]],
  ["incidents.mjs", ["check", "--json"]],
  ["flag-debt.mjs", ["scan", "--json"]],
  ["artifact-schema.mjs", ["check", "--json"]],
  ["docs-lint.mjs", ["check", "--json"]],
  ["self-audit.mjs", ["integrity", "--json"]],
];

function collectFindings() {
  const reports = [], findings = [];
  for (const [tool, args] of FINDING_TOOLS) {
    const r = runTool(tool, args, { timeout: 30_000 });
    const rep = r.report;
    if (!rep) { reports.push({ tool, command: args[0], ran: false, hint: r.hint || `no finding report from ${tool}`, commandLine: `node .cursor/tools/${tool} ${args.join(" ")}` }); continue; }
    reports.push({ tool, command: rep.command, ran: true, ok: rep.ok, skipped: !!rep.skipped, exit: rep.exit, summary: rep.summary, counts: rep.counts, at: rep.at });
    for (const f of rep.findings) findings.push({ tool, ...f });
  }
  const order = { block: 0, warn: 1, info: 2 };
  findings.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9) || a.tool.localeCompare(b.tool));
  const counts = { block: 0, warn: 0, info: 0 };
  for (const f of findings) if (counts[f.severity] !== undefined) counts[f.severity]++;
  return { schema: "finding-report/1", reports, counts, findings, ok: counts.block === 0 };
}

const COLLECTORS = {
  overview: collectOverview,
  lifecycle: collectLifecycle,
  features: collectFeatures,
  traceability: collectTraceability,
  quality: collectQuality,
  delivery: collectDelivery,
  findings: collectFindings,
  memory: collectMemory,
  platform: collectPlatform,
  actions: collectActions,
  impact: () => collectImpact(null, null),
};

// Collectors may be sync or async; awaiting a plain value is a no-op, so every
// one of them is awaited and none has to care which kind it is.
async function cached(name, fresh) {
  if (!fresh) {
    const hit = cache.get(name);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  }
  const value = await COLLECTORS[name]();
  cache.set(name, { at: Date.now(), value });
  return value;
}

async function snapshot() {
  const out = { generatedAt: new Date().toISOString(), root: ROOT };
  for (const name of Object.keys(COLLECTORS)) out[name] = await COLLECTORS[name]();
  return out;
}

/* ------------------------------------------------------------------ HTTP */

function send(res, status, body, type) {
  const buf = Buffer.from(body);
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": buf.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(buf);
}

function json(res, status, obj) {
  send(res, status, JSON.stringify(obj), "application/json; charset=utf-8");
}

const API = {
  "/api/overview": "overview",
  "/api/lifecycle": "lifecycle",
  "/api/features": "features",
  "/api/traceability": "traceability",
  "/api/quality": "quality",
  "/api/delivery": "delivery",
  "/api/findings": "findings",
  "/api/memory": "memory",
  "/api/platform": "platform",
  "/api/actions": "actions",
};

function onRequest(req, res) {
  if (!hostAllowed(req.headers.host)) {
    return json(res, 400, { error: "Refused Host header. This dashboard is localhost-only." });
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { error: "GET only — this dashboard is read-only." });
  }
  const u = new URL(req.url || "/", `http://${HOST}`);
  const path = u.pathname;
  const fresh = u.searchParams.get("fresh") === "1";
  if (path === "/" || path === "/index.html") return send(res, 200, PAGE, "text/html; charset=utf-8");
  // Both routes are wrapped for the same reason: a collector that throws must
  // cost you one panel, not the server. An unwrapped throw in a request handler
  // takes the whole process down, and a status board that dies when one number
  // is unavailable is worse than one that says the number is unavailable.
  const fail = (e) => json(res, 500, { error: String(e.message || e).slice(0, 400) });
  if (path === "/api/snapshot") {
    return snapshot().then((d) => json(res, 200, d)).catch(fail);
  }
  if (path === "/api/impact") {
    return Promise.resolve(collectImpact(u.searchParams.get("file"), u.searchParams.get("object")))
      .then((d) => json(res, 200, d)).catch(fail);
  }
  if (path === "/api/simulate") {
    const proposed = u.searchParams.get("proposed");
    return Promise.resolve().then(() => {
      const policyPath = proposed && !proposed.includes("..") && !proposed.startsWith("/")
        ? join(ROOT, proposed)
        : join(ROOT, ".cursor", "lifecycle", "write-policy.json");
      let proposedPol;
      try { proposedPol = JSON.parse(readFileSync(policyPath, "utf8")); }
      catch { return json(res, 400, { error: "cannot read proposed policy" }); }
      const current = JSON.parse(readFileSync(join(ROOT, ".cursor", "lifecycle", "write-policy.json"), "utf8"));
      return import(new URL("./_policy.mjs", import.meta.url)).then((p) => json(res, 200, p.comparePolicies(current, proposedPol)));
    }).catch(fail);
  }
  const name = API[path];
  if (!name) return json(res, 404, { error: "Unknown route." });
  return cached(name, fresh).then((d) => json(res, 200, d)).catch(fail);
}

function openBrowser(url) {
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch { /* opening the browser is best-effort */ }
}

function serve(args) {
  const pi = args.indexOf("--port");
  const port = pi >= 0 ? Number(args[pi + 1]) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error("Invalid --port. Use an integer 1–65535.");
    process.exit(2);
  }
  const url = `http://${HOST}:${port}/`;
  const server = createServer(onRequest);
  server.listen(port, HOST, () => {
    console.log(`cursor-platform dashboard (GET only — composer, not executor)`);
    console.log(`  ${url}`);
    console.log(`  root  ${ROOT}`);
    console.log(`  Actions compose a command you paste. Nothing is written. Ctrl+C to stop.`);
    if (!args.includes("--no-open")) openBrowser(url);
  });
  server.on("error", (e) => {
    console.error(e.code === "EADDRINUSE"
      ? `Port ${port} is in use. Try --port ${port + 1}.`
      : e.message);
    process.exit(2);
  });
}

/* ------------------------------------------------------------------ UI */

const PAGE = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>cursor-platform</title>
<style>
:root {
  --bg:#0e141b; --panel:#17202a; --panel2:#1e2a36; --line:#2a3a4c;
  --text:#e7eef7; --muted:#8aa0b8; --accent:#4aa3f0; --ok:#3ecf8e;
  --warn:#e6b84d; --bad:#e45c5c; --here:#4aa3f0;
  font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
html, body { margin:0; height:100%; background:var(--bg); color:var(--text); }
.app { display:grid; grid-template-columns: 220px 1fr; height:100%; }
nav {
  background:#0b1016; border-inline-end:1px solid var(--line);
  padding:20px 12px; display:flex; flex-direction:column; gap:4px;
}
nav h1 { font-size:13px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); margin:0 8px 16px; font-weight:600; }
nav button {
  appearance:none; background:transparent; border:0; color:var(--muted);
  text-align:start; padding:9px 12px; border-radius:8px; cursor:pointer; font:inherit;
}
nav button:hover { background:var(--panel2); color:var(--text); }
nav button.active { background:var(--panel2); color:var(--text); outline:1px solid var(--line); }
main { overflow:auto; padding:28px 32px 64px; }
header.top { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; margin-bottom:24px; }
header.top h2 { margin:0 0 4px; font-size:22px; font-weight:600; }
header.top p { margin:0; color:var(--muted); font-size:13px; }
.grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:12px; margin-bottom:20px; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
.card h3 { margin:0 0 6px; font-size:12px; color:var(--muted); font-weight:600; letter-spacing:.04em; text-transform:uppercase; }
.card .v { font-size:22px; font-weight:650; }
.ladder { display:grid; gap:10px; }
.phase {
  background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px 16px;
  display:grid; grid-template-columns: 160px 1fr; gap:16px;
}
.phase.current { border-color:var(--accent); }
.phase .name { font-weight:650; }
.consents { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0; }
.badge {
  display:inline-flex; align-items:center; padding:2px 8px; border-radius:999px;
  font-size:11px; font-weight:650; letter-spacing:.03em; text-transform:uppercase;
  background:var(--panel2); color:var(--muted); border:1px solid var(--line);
}
.badge.ok { color:var(--ok); border-color:transparent; background:rgba(62,207,142,.12); }
.badge.warn { color:var(--warn); border-color:transparent; background:rgba(230,184,77,.12); }
.badge.bad { color:var(--bad); border-color:transparent; background:rgba(228,92,92,.12); }
.badge.info { color:var(--accent); border-color:transparent; background:rgba(74,163,240,.12); }
table { width:100%; border-collapse:collapse; font-size:13px; }
th, td { text-align:start; padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
th { color:var(--muted); font-weight:600; font-size:11px; letter-spacing:.04em; text-transform:uppercase; }
.empty { background:var(--panel); border:1px dashed var(--line); border-radius:12px; padding:20px; color:var(--muted); }
.empty p { margin:0 0 10px; color:var(--text); }
pre.cmd {
  margin:0; background:#0b1016; border:1px solid var(--line); border-radius:8px;
  padding:12px 14px; overflow:auto; color:#d5e4f5; font-size:12px; line-height:1.45;
}
.row { display:flex; flex-wrap:wrap; gap:8px; margin:8px 0 16px; }
.muted { color:var(--muted); font-size:13px; }
.err { color:var(--bad); }
.list { margin:0; padding:0; list-style:none; }
.list li { padding:6px 0; border-bottom:1px solid var(--line); font-size:13px; }
.art { font-size:12px; color:var(--muted); }
.art span { margin-inline-end:10px; }
nav .spacer { flex:1; }
.btn, button.act {
  appearance:none; background:var(--panel2); border:1px solid var(--line);
  color:var(--text); padding:6px 10px; border-radius:6px; cursor:pointer;
  font:inherit; font-size:12px;
}
button.act:hover, .btn:hover { border-color:var(--accent); color:var(--accent); }
.acts { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
#drawer[hidden] { display:none !important; }
#drawer { position:fixed; inset:0; z-index:20; display:block; }
.drawer-scrim { position:absolute; inset:0; background:rgba(0,0,0,.45); }
.drawer {
  position:absolute; inset-block:0; inset-inline-end:0; width:min(520px,100%);
  background:var(--panel); border-inline-start:1px solid var(--line);
  padding:20px; overflow:auto; display:flex; flex-direction:column; gap:10px;
}
.drawer h3 { margin:0; }
.drawer .muted { margin:0; }
.drawer label { display:block; font-size:12px; color:var(--muted); margin-top:8px; }
.drawer input, .drawer select, .drawer textarea {
  width:100%; margin-top:4px; padding:8px; border-radius:6px;
  background:var(--bg); color:var(--text); border:1px solid var(--line); font:inherit;
}
.drawer textarea { min-height:64px; }
.verdict { padding:10px 12px; border-radius:8px; border:1px solid var(--line); }
.verdict.ok { border-color:var(--ok); }
.verdict.bad { border-color:var(--bad); }
.verdict.warn { border-color:var(--warn); }
.verdict ul { margin:8px 0 0; padding-inline-start:18px; font-size:13px; }
.cmdbox { width:100%; min-height:96px; font-family:ui-monospace,Consolas,monospace; font-size:12px; }
.shell-toggle { display:flex; gap:10px; align-items:center; font-size:12px; color:var(--muted); }
.alist { display:flex; flex-direction:column; gap:8px; }
.alist button {
  text-align:start; padding:12px; border-radius:8px; border:1px solid var(--line);
  background:var(--panel2); color:var(--text); cursor:pointer; font:inherit;
}
.alist button:hover { border-color:var(--accent); }
.alist button strong { display:block; }
.alist button span { font-size:12px; color:var(--muted); }
.impact-form { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:16px; }
.impact-form input {
  width:min(280px,100%); padding:8px; border-radius:6px;
  background:var(--bg); color:var(--text); border:1px solid var(--line); font:inherit;
}
.skip {
  position:absolute; inset-inline-start:8px; top:8px;
  clip:rect(0 0 0 0); clip-path:inset(50%); width:1px; height:1px; overflow:hidden;
}
.skip:focus {
  clip:auto; clip-path:none; width:auto; height:auto; z-index:40;
  background:var(--panel); color:var(--text); padding:8px 12px; border-radius:6px;
}
html[dir="rtl"] .app { direction:rtl; }
@media (max-width: 720px) {
  .app { grid-template-columns: 1fr; }
  nav { border-inline-end:0; border-block-end:1px solid var(--line); }
}
</style>
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<div class="app">
  <nav>
    <h1>cursor-platform</h1>
    <button data-panel="overview" class="active">Overview</button>
    <button data-panel="lifecycle">Lifecycle</button>
    <button data-panel="features">Features</button>
    <button data-panel="impact">Impact</button>
    <button data-panel="traceability">Traceability</button>
    <button data-panel="quality">Quality</button>
    <button data-panel="delivery">Delivery</button>
    <button data-panel="findings">Findings</button>
    <button data-panel="memory">Memory-bank</button>
    <button data-panel="platform">Platform</button>
    <button data-panel="actions">Actions</button>
    <div class="spacer"></div>
    <button type="button" id="refresh" class="btn">Refresh</button>
  </nav>
  <main>
    <header class="top">
      <div>
        <h2 id="title">Loading</h2>
        <p id="subtitle">GET only. Actions compose a command you paste — this page never writes a file or approves a gate.</p>
      </div>
      <div id="head-badges"></div>
    </header>
    <div id="content"></div>
  </main>
</div>
<div id="drawer" hidden>
  <div class="drawer-scrim" id="drawer-scrim"></div>
  <aside class="drawer" id="drawer-panel"></aside>
</div>
<script>
(function () {
  var content = document.getElementById("content");
  var title = document.getElementById("title");
  var subtitle = document.getElementById("subtitle");
  var headBadges = document.getElementById("head-badges");
  var current = "overview";

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) {
      if (c == null) return;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }
  function badge(text, kind) {
    return el("span", { class: "badge " + (kind || "") }, [String(text || "—")]);
  }
  function statusKind(s) {
    s = String(s || "").toUpperCase();
    if (/APPROVED|PASS|OK|FRESH|FILLED|READY|SIGNED/.test(s)) return "ok";
    if (/STALE|WARN|INHERITED|IN_PROGRESS|TEMPLATE|AGED/.test(s)) return "warn";
    if (/FAIL|BLOCKED|NOT_STARTED|MISSING|EMPTY|NO-GO/.test(s)) return "bad";
    return "info";
  }
  function emptyBox(d) {
    var box = el("div", { class: "empty" });
    box.appendChild(el("p", { text: (d && d.hint) || "Nothing to show yet." }));
    if (d && d.command) box.appendChild(el("pre", { class: "cmd", text: d.command }));
    return box;
  }
  function card(label, value, kind) {
    var c = el("div", { class: "card" });
    c.appendChild(el("h3", { text: label }));
    if (kind) c.appendChild(badge(value, kind));
    else c.appendChild(el("div", { class: "v", text: value == null ? "—" : String(value) }));
    return c;
  }
  function table(headers, rows) {
    var t = el("table");
    var thead = el("thead");
    var trh = el("tr");
    headers.forEach(function (h) { trh.appendChild(el("th", { text: h })); });
    thead.appendChild(trh);
    t.appendChild(thead);
    var tb = el("tbody");
    rows.forEach(function (r) {
      var tr = el("tr");
      r.forEach(function (cell) {
        var td = el("td");
        if (cell && cell.nodeType) td.appendChild(cell);
        else td.textContent = cell == null ? "" : String(cell);
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    return t;
  }
  function actBtn(id, label, phase, version) {
    var attrs = { class: "act", type: "button", "data-action": id, text: label };
    if (phase) attrs["data-phase"] = phase;
    if (version) attrs["data-version"] = version;
    var b = el("button", attrs);
    b.addEventListener("click", function (ev) {
      ev.preventDefault();
      openComposer(id, { PHASE: phase || null, VERSION: version || null });
    });
    return b;
  }
  function actsRow(items) {
    var row = el("div", { class: "acts" });
    items.forEach(function (it) { row.appendChild(actBtn(it[0], it[1], it[2], it[3])); });
    return row;
  }

  function renderOverview(d) {
    title.textContent = d.product || "This repository";
    subtitle.textContent = d.adopted
      ? (d.mode + " · phase " + d.phase + " · " + (d.phaseStatus || ""))
      : (d.hint || "Lifecycle not adopted.");
    headBadges.innerHTML = "";
    if (d.phaseStatus) headBadges.appendChild(badge(d.phaseStatus, statusKind(d.phaseStatus)));
    if (d.governance) {
      ["money", "pii", "auth"].forEach(function (k) {
        headBadges.appendChild(badge(k, d.governance[k] ? "warn" : ""));
      });
    }
    var frag = document.createDocumentFragment();
    var g = el("div", { class: "grid" });
    g.appendChild(card("Product", d.product || "—"));
    g.appendChild(card("Phase", d.phase || "not adopted", d.phase ? statusKind(d.phaseStatus) : "warn"));
    g.appendChild(card("Integrations", (d.integrations || []).length));
    if (d.counts) g.appendChild(card("Skills", d.counts.skills));
    frag.appendChild(g);
    if (d.governance && d.adopted) {
      frag.appendChild(el("h3", { text: "Governance flags" }));
      var row = el("div", { class: "row" });
      row.appendChild(badge("money " + (d.governance.money ? "ON" : "off"), d.governance.money ? "warn" : ""));
      row.appendChild(badge("PII " + (d.governance.pii ? "ON" : "off"), d.governance.pii ? "warn" : ""));
      row.appendChild(badge("auth " + (d.governance.auth ? "ON" : "off"), d.governance.auth ? "warn" : ""));
      (d.governance.regimes || []).forEach(function (r) { row.appendChild(badge(r, "warn")); });
      frag.appendChild(row);
      if (d.governance.sources && d.governance.sources.length) {
        frag.appendChild(el("p", { class: "muted", text: "Derived from: " + d.governance.sources.join(", ") }));
      }
    }
    if (d.integrations && d.integrations.length) {
      frag.appendChild(el("p", { class: "muted", text: "MCP: " + d.integrations.join(", ") }));
    }
    if (d.stack) {
      frag.appendChild(el("h3", { text: "technologyStack.md" }));
      frag.appendChild(el("pre", { class: "cmd", text: d.stack }));
    }
    if (d.empty && !d.adopted) {
      frag.appendChild(emptyBox(d));
      frag.appendChild(actsRow([["init", "Initialise lifecycle", null]]));
    }
    return frag;
  }

  function renderLifecycle(d) {
    title.textContent = "Lifecycle";
    subtitle.textContent = d.empty ? "Not adopted." : (d.product + " · " + d.mode + " · current " + d.phase);
    headBadges.innerHTML = "";
    if (d.empty) return emptyBox(d);
    var frag = document.createDocumentFragment();
    var ladder = el("div", { class: "ladder" });
    (d.phases || []).forEach(function (p) {
      var st = (p.derived && p.derived.status) || "NOT_STARTED";
      var box = el("div", { class: "phase" + (p.current ? " current" : "") });
      var left = el("div");
      left.appendChild(el("div", { class: "name", text: p.name }));
      left.appendChild(badge(st, statusKind(st)));
      if (p.current) left.appendChild(badge("current", "info"));
      left.appendChild(el("p", { class: "muted", text: "reviewer: " + (p.reviewer || "—") }));
      left.appendChild(el("p", { class: "muted", text: "authors: " + ((p.authors || []).join(", ") || "—") }));
      var right = el("div");
      var cons = el("div", { class: "consents" });
      cons.appendChild(badge("mechanical " + ((p.mechanical && p.mechanical.status) || "—"), statusKind(p.mechanical && p.mechanical.status)));
      cons.appendChild(badge("judgement " + ((p.judgement && p.judgement.verdict) || "—"), statusKind(p.judgement && p.judgement.verdict)));
      cons.appendChild(badge("human " + ((p.human && p.human.status) || "—"), statusKind(p.human && p.human.status)));
      right.appendChild(cons);
      if (p.derived && p.derived.reasons && p.derived.reasons.length) {
        right.appendChild(el("p", { class: "muted", text: p.derived.reasons.join("; ") }));
      }
      var arts = el("div", { class: "art" });
      (p.artifacts || []).forEach(function (a) {
        arts.appendChild(el("span", null, [
          badge(a.ok ? "ok" : "missing", a.ok ? "ok" : "bad"),
          " " + a.artifact,
        ]));
        arts.appendChild(el("br"));
      });
      right.appendChild(arts);
      right.appendChild(actsRow([
        ["record-gate", "Record verdict", p.name],
        ["approve", "Approve", p.name],
        ["rollback", "Rollback", p.name],
        ["override", "Override", p.name],
      ]));
      box.appendChild(left);
      box.appendChild(right);
      ladder.appendChild(box);
    });
    frag.appendChild(ladder);
    frag.appendChild(actsRow([["advance", "Advance to next phase", null]]));
    if (d.openChangeRequests && d.openChangeRequests.length) {
      frag.appendChild(el("h3", { text: "Open change requests" }));
      frag.appendChild(table(["ID", "Risk", "By", "Reason"],
        d.openChangeRequests.map(function (c) { return [c.id, c.risk, c.by, c.reason]; })));
    }
    if (d.activeOverrides && d.activeOverrides.length) {
      frag.appendChild(el("h3", { text: "Active overrides" }));
      frag.appendChild(table(["Phase", "Risk", "By", "Expires"],
        d.activeOverrides.map(function (o) { return [o.phase, o.risk, o.by, (o.expiresAt || "").slice(0, 10)]; })));
    }
    return frag;
  }

  function renderFeatures(d) {
    title.textContent = "Features";
    subtitle.textContent = "Behavioural map from /feature-trace and /feature-inventory.";
    headBadges.innerHTML = "";
    var frag = document.createDocumentFragment();
    if (d.repo) {
      var g = el("div", { class: "grid" });
      g.appendChild(card("Projects", (d.repo.projects || []).length));
      g.appendChild(card("EF contexts", (d.repo.efCoreContexts || []).length));
      g.appendChild(card("Providers", (d.repo.databaseProviders || []).join(", ") || "—"));
      g.appendChild(card("Cycles", (d.repo.cycles || []).length, (d.repo.cycles || []).length ? "bad" : "ok"));
      frag.appendChild(g);
      if (d.repo.projects && d.repo.projects.length) {
        frag.appendChild(table(["Project", "Layer", "TFM"],
          d.repo.projects.map(function (p) { return [p.name, p.layer || "", p.targetFramework || ""]; })));
      }
    }
    if (d.empty) {
      frag.appendChild(emptyBox(d));
      return frag;
    }
    headBadges.appendChild(badge((d.features || []).length + " features", "info"));
    frag.appendChild(table(["ID", "Name", "Status", "Conf", "Files", "Freshness"],
      (d.features || []).map(function (f) {
        var fresh = f.stale ? "STALE" : "fresh";
        return [f.id, f.name, f.status, f.confidence, f.files, badge(fresh, f.stale ? "warn" : "ok")];
      })));
    return frag;
  }

  function renderTrace(d) {
    title.textContent = "Traceability";
    subtitle.textContent = "FR → S → UC → EP, from artifact-schema.mjs.";
    if (d.empty) return emptyBox(d);
    var frag = document.createDocumentFragment();
    var g = el("div", { class: "grid" });
    g.appendChild(card("Ids", d.total));
    Object.keys(d.counts || {}).forEach(function (k) { g.appendChild(card(k, d.counts[k])); });
    frag.appendChild(g);
    var f = d.findings || {};
    var row = el("div", { class: "row" });
    row.appendChild(badge("dangling " + (f.dangling || []).length, (f.dangling || []).length ? "bad" : "ok"));
    row.appendChild(badge("unlinked " + (f.unlinked || []).length, (f.unlinked || []).length ? "bad" : "ok"));
    row.appendChild(badge("misplaced " + (f.misplaced || []).length, (f.misplaced || []).length ? "warn" : "ok"));
    row.appendChild(badge("duplicate " + (f.duplicate || []).length, (f.duplicate || []).length ? "bad" : "ok"));
    frag.appendChild(row);
    frag.appendChild(actsRow([["change-open", "Open a change request", null]]));
    if (d.stories && d.stories.length) {
      frag.appendChild(el("h3", { text: "Definition of Ready" }));
      frag.appendChild(table(["Story", "Title", "Ready", "Failed checks"],
        d.stories.map(function (s) {
          return [s.id, s.title, badge(s.ready ? "ready" : "not ready", s.ready ? "ok" : "bad"), (s.failed || []).join(", ")];
        })));
    }
    var issues = [].concat(
      (f.dangling || []).map(function (x) { return ["dangling", x.id, x.file]; }),
      (f.unlinked || []).map(function (x) { return ["unlinked", x.id, x.file]; }),
      (f.duplicate || []).map(function (x) { return ["duplicate", x.id, (x.first || "") + " / " + (x.again || "")]; })
    ).slice(0, 40);
    if (issues.length) {
      frag.appendChild(el("h3", { text: "Findings" }));
      frag.appendChild(table(["Kind", "Id", "Where"], issues));
    }
    return frag;
  }

  function renderQuality(d) {
    title.textContent = "Quality";
    subtitle.textContent = "AC coverage, risk tiers, architecture fitness, unprotected dependencies.";
    var frag = document.createDocumentFragment();
    var ac = d.ac || {};
    if (ac.empty) frag.appendChild(emptyBox(ac));
    else {
      var g = el("div", { class: "grid" });
      g.appendChild(card("ACs", ac.acs));
      g.appendChild(card("Covered", ac.covered, ac.uncovered ? "warn" : "ok"));
      g.appendChild(card("Uncovered", ac.uncovered, ac.uncovered ? "bad" : "ok"));
      g.appendChild(card("Vacuous tests", ac.vacuous, ac.vacuous ? "bad" : "ok"));
      g.appendChild(card("Weak asserts", ac.weak, ac.weak ? "warn" : "ok"));
      frag.appendChild(g);
    }
    frag.appendChild(el("h3", { text: "Risk profile" }));
    if (d.risk && d.risk.empty) frag.appendChild(emptyBox(d.risk));
    else if (d.risk) {
      var r = el("div", { class: "row" });
      Object.keys(d.risk.byTier || {}).forEach(function (t) {
        r.appendChild(badge("T" + t + " " + d.risk.byTier[t], t === "3" ? "bad" : t === "2" ? "warn" : "info"));
      });
      r.appendChild(badge("gaps " + (d.risk.gaps || 0), d.risk.gaps ? "bad" : "ok"));
      frag.appendChild(r);
    }
    frag.appendChild(el("h3", { text: "Fitness" }));
    if (d.fitness && d.fitness.empty) frag.appendChild(emptyBox(d.fitness));
    else if (d.fitness) {
      var fg = el("div", { class: "grid" });
      var neu = Array.isArray(d.fitness.new) ? d.fitness.new.length : d.fitness.new;
      var fixn = Array.isArray(d.fitness.fixed) ? d.fitness.fixed.length : d.fitness.fixed;
      fg.appendChild(card("Total", Array.isArray(d.fitness.total) ? d.fitness.total.length : d.fitness.total));
      fg.appendChild(card("New", neu, neu ? "bad" : "ok"));
      fg.appendChild(card("Fixed", fixn, "ok"));
      frag.appendChild(fg);
    }
    frag.appendChild(actsRow([["fitness-baseline", "Accept fitness baseline", null]]));
    frag.appendChild(el("h3", { text: "Failure modes" }));
    if (d.failureModes && d.failureModes.empty) frag.appendChild(emptyBox(d.failureModes));
    else if (d.failureModes) {
      frag.appendChild(card("Dependencies", d.failureModes.dependencies || (d.failureModes.deps || []).length));
      if (d.failureModes.failing) frag.appendChild(badge("failing " + d.failureModes.failing, "bad"));
    }
    return frag;
  }

  function renderDelivery(d) {
    title.textContent = "Delivery & ops";
    subtitle.textContent = "DORA, releases, incidents, expired flags. Loaded on demand (git).";
    var frag = document.createDocumentFragment();
    frag.appendChild(el("h3", { text: "DORA (90 days)" }));
    if (d.metrics && d.metrics.empty) frag.appendChild(emptyBox(d.metrics));
    else if (d.metrics && d.metrics.cards) {
      var g = el("div", { class: "grid" });
      d.metrics.cards.forEach(function (c) {
        var box = card(c.label, c.value);
        if (c.kind) box.appendChild(badge(c.kind, c.kind === "MEASURED" ? "ok" : "warn"));
        if (c.note) box.appendChild(el("p", { class: "muted", text: c.note }));
        g.appendChild(box);
      });
      frag.appendChild(g);
      if (d.metrics.methodNote) frag.appendChild(el("p", { class: "muted", text: d.metrics.methodNote }));
    }
    frag.appendChild(el("h3", { text: "Releases" }));
    frag.appendChild(actsRow([["cut", "Cut a release", null]]));
    if (d.releases && d.releases.empty) frag.appendChild(emptyBox(d.releases));
    else if (d.releases && d.releases.items) {
      frag.appendChild(table(["Version", "When", "Signed", "Commits", "Phase", ""],
        d.releases.items.map(function (r) {
          return [
            r.version, (r.at || "").slice(0, 10),
            badge(r.signed ? "signed" : "unsigned", r.signed ? "ok" : "warn"),
            r.commitCount, r.phase,
            r.signed ? "" : actBtn("sign", "Sign", null, r.version),
          ];
        })));
    }
    frag.appendChild(el("h3", { text: "Incidents" }));
    frag.appendChild(actsRow([["incident-open", "Open an incident", null]]));
    if (d.incidents && d.incidents.empty) frag.appendChild(emptyBox(d.incidents));
    else if (d.incidents) {
      frag.appendChild(el("pre", { class: "cmd", text: JSON.stringify(d.incidents, null, 2).slice(0, 2000) }));
    }
    frag.appendChild(el("h3", { text: "Feature flags" }));
    if (d.flags && d.flags.empty) frag.appendChild(emptyBox(d.flags));
    else if (d.flags) {
      var fg = el("div", { class: "grid" });
      fg.appendChild(card("Declared", (d.flags.declared || []).length));
      fg.appendChild(card("Expired", (d.flags.expired || []).length, (d.flags.expired || []).length ? "bad" : "ok"));
      fg.appendChild(card("Expiring", (d.flags.expiringSoon || []).length, (d.flags.expiringSoon || []).length ? "warn" : "ok"));
      fg.appendChild(card("Undeclared", (d.flags.undeclared || []).length, (d.flags.undeclared || []).length ? "warn" : "ok"));
      frag.appendChild(fg);
    }
    return frag;
  }

  function renderFindings(d) {
    title.textContent = "Findings";
    subtitle.textContent = "Every checker, one list, one shape (schemas/finding.schema.json). Loaded on demand; runs nine tools.";
    var frag = document.createDocumentFragment();
    var c = d.counts || { block: 0, warn: 0, info: 0 };
    var g = el("div", { class: "grid" });
    g.appendChild(card("Blocking", c.block, c.block ? "bad" : "ok"));
    g.appendChild(card("Warnings", c.warn, c.warn ? "warn" : "ok"));
    g.appendChild(card("Info", c.info));
    frag.appendChild(g);

    frag.appendChild(el("h3", { text: "Tools" }));
    frag.appendChild(table(["Tool", "Result", "Summary"], (d.reports || []).map(function (r) {
      var verdict = !r.ran ? badge("not run", "") : r.skipped ? badge("skipped", "") : r.ok ? badge("ok", "ok") : badge("FAIL", "bad");
      return [r.tool + " " + (r.command || ""), verdict, r.ran ? (r.summary || "") : (r.hint || "")];
    })));

    frag.appendChild(el("h3", { text: "Findings" }));
    var list = d.findings || [];
    if (!list.length) frag.appendChild(el("p", { class: "muted", text: "No findings from any tool that ran." }));
    else {
      frag.appendChild(table(["Severity", "Tool", "Code", "Where", "Message"], list.slice(0, 200).map(function (f) {
        var where = f.file ? f.file + (f.line ? ":" + f.line : "") : (f.ref || "");
        return [badge(f.severity, f.severity === "block" ? "bad" : f.severity === "warn" ? "warn" : ""), f.tool, f.code, where, f.message];
      })));
      if (list.length > 200) frag.appendChild(el("p", { class: "muted", text: "… and " + (list.length - 200) + " more. Run the tool for the full list." }));
    }
    return frag;
  }

  function renderMemory(d) {
    title.textContent = "Memory-bank";
    subtitle.textContent = "Tier 1 is regenerated; Tier 2 is human-authored. Templates are flagged, not trusted.";
    var frag = document.createDocumentFragment();
    // The panel no longer walks the files itself, so it now has a way to have
    // no answer at all: the memory-bank.mjs subprocess can fail or time out.
    // Say so, rather than throwing on an undefined group and blanking the board.
    if (d.empty) return emptyBox(d);
    if (d.hint) frag.appendChild(emptyBox(d));
    function block(label, group) {
      frag.appendChild(el("h3", { text: label + " · " + group.filled + "/" + group.total + " filled" }));
      frag.appendChild(table(["File", "Status", "Age (days)"],
        group.files.map(function (f) {
          return [f.file, badge(f.status, statusKind(f.status)), f.ageDays == null ? "—" : f.ageDays.toFixed(1)];
        })));
    }
    block("Tier 1", d.tier1);
    block("Tier 2", d.tier2);
    return frag;
  }

  function renderPlatform(d) {
    title.textContent = "Platform health";
    subtitle.textContent = "docs-lint, self-audit wiring, stated counts.";
    var frag = document.createDocumentFragment();
    if (d.metadata && d.metadata.counts) {
      var g = el("div", { class: "grid" });
      var c = d.metadata.counts;
      Object.keys(c).forEach(function (k) { g.appendChild(card(k, c[k])); });
      frag.appendChild(g);
    }
    frag.appendChild(el("h3", { text: "docs-lint" }));
    if (d.docs && d.docs.empty) frag.appendChild(emptyBox(d.docs));
    else if (d.docs) {
      var row = el("div", { class: "row" });
      row.appendChild(badge("errors " + (d.docs.errors || []).length, (d.docs.errors || []).length ? "bad" : "ok"));
      row.appendChild(badge("warnings " + (d.docs.warnings || []).length, (d.docs.warnings || []).length ? "warn" : "ok"));
      frag.appendChild(row);
      var errs = (d.docs.errors || []).slice(0, 25);
      if (errs.length) {
        frag.appendChild(table(["Kind", "Where"], errs.map(function (e) {
          return [e.kind || e.type || "error", e.file || e.path || JSON.stringify(e).slice(0, 120)];
        })));
      }
    }
    frag.appendChild(el("h3", { text: "self-audit wiring" }));
    if (d.wiring && d.wiring.empty) frag.appendChild(emptyBox(d.wiring));
    else if (d.wiring) {
      var findings = Array.isArray(d.wiring) ? d.wiring : (d.wiring.findings || d.wiring);
      if (Array.isArray(findings) && findings.length) {
        frag.appendChild(table(["Finding"], findings.slice(0, 30).map(function (x) {
          return [typeof x === "string" ? x : JSON.stringify(x).slice(0, 200)];
        })));
      } else {
        frag.appendChild(el("p", { class: "muted", text: "No wiring findings." }));
      }
    }
    return frag;
  }

  function renderActions(d) {
    title.textContent = "Actions";
    subtitle.textContent = "Composer only. Copy the command, paste it in your terminal. This page never runs it.";
    headBadges.innerHTML = "";
    if (d.phase) headBadges.appendChild(badge("current " + d.phase, "info"));
    var frag = document.createDocumentFragment();
    frag.appendChild(el("p", { class: "muted", text: d.adopted
      ? "Each card pre-flights the same checks the CLI will apply. A READY verdict is still something you paste — not a click that writes state."
      : "Lifecycle is not adopted. Initialise it, or open an incident / change request / fitness baseline without one." }));
    var list = el("div", { class: "alist" });
    (d.actions || []).forEach(function (a) {
      var pf = a.preflight || {};
      var ready = pf.ok !== false && !(pf.refusals && pf.refusals.length);
      var b = el("button", { type: "button" });
      b.appendChild(el("strong", { text: a.title }));
      b.appendChild(el("span", { text: a.description || "" }));
      b.appendChild(badge(ready ? "preflight ok" : "would be refused", ready ? "ok" : "bad"));
      b.addEventListener("click", function () { openComposer(a.id, { PHASE: d.phase }); });
      list.appendChild(b);
    });
    frag.appendChild(list);
    return frag;
  }

  function renderImpact(d) {
    title.textContent = "Impact explorer";
    subtitle.textContent = "What a file or database object touches. Empty means tracing is incomplete, not that nothing is affected.";
    var frag = document.createDocumentFragment();
    var form = el("div", { class: "impact-form" });
    var fileIn = el("input", { type: "text", placeholder: "src/Pay/Handler.cs", value: d.file || "" });
    var objIn = el("input", { type: "text", placeholder: "dbo.usp_Pay", value: d.object || "" });
    var go = el("button", { class: "act", type: "button", text: "Inspect" });
    form.appendChild(fileIn);
    form.appendChild(objIn);
    form.appendChild(go);
    frag.appendChild(form);
    function paint(data) {
      var body = el("div");
      body.appendChild(badge("coverage " + (data.coverage || "insufficient"), data.coverage === "traced" ? "ok" : "warn"));
      if (data.uninspected) body.appendChild(el("p", { class: "muted", text: data.uninspected }));
      if (data.hint && data.empty) body.appendChild(emptyBox(data));
      var g = el("div", { class: "grid" });
      g.appendChild(card("Features", (data.features || []).length));
      g.appendChild(card("Objects", (data.objects || []).length));
      g.appendChild(card("Tests", (data.tests || []).length));
      g.appendChild(card("Edges", (data.edges || []).length));
      body.appendChild(g);
      if ((data.tests || []).length) {
        body.appendChild(el("h3", { text: "Affected tests" }));
        body.appendChild(table(["Path"], data.tests.map(function (t) { return [t]; })));
      }
      if ((data.features || []).length) {
        body.appendChild(el("h3", { text: "Features" }));
        body.appendChild(table(["Id"], data.features.map(function (f) { return [f]; })));
      }
      if ((data.objects || []).length) {
        body.appendChild(el("h3", { text: "Objects" }));
        body.appendChild(table(["Id"], data.objects.map(function (o) { return [o]; })));
      }
      if ((data.edges || []).length) {
        body.appendChild(el("h3", { text: "Evidence" }));
        body.appendChild(table(["Kind", "From", "To", "Source", "Stale"], data.edges.map(function (e) {
          return [e.kind, e.from, e.to || e.raw || "", e.dataSource || "", e.stale ? "stale" : "fresh"];
        })));
      }
      return body;
    }
    var result = paint(d);
    frag.appendChild(result);
    go.addEventListener("click", function () {
      var q = [];
      if (fileIn.value.trim()) q.push("file=" + encodeURIComponent(fileIn.value.trim()));
      if (objIn.value.trim()) q.push("object=" + encodeURIComponent(objIn.value.trim()));
      fetch("/api/impact?" + q.join("&")).then(function (r) { return r.json(); }).then(function (next) {
        var fresh = renderImpact(next);
        content.innerHTML = "";
        content.appendChild(fresh);
      });
    });
    return frag;
  }

  var RENDER = {
    overview: renderOverview,
    lifecycle: renderLifecycle,
    features: renderFeatures,
    impact: renderImpact,
    traceability: renderTrace,
    quality: renderQuality,
    delivery: renderDelivery,
    findings: renderFindings,
    memory: renderMemory,
    platform: renderPlatform,
    actions: renderActions,
  };

  var actionsCatalog = null;
  var drawer = document.getElementById("drawer");
  var drawerPanel = document.getElementById("drawer-panel");
  var shellKind = /Win/i.test(navigator.userAgent) ? "powershell" : "bash";

  function loadActions(force) {
    if (actionsCatalog && !force) return Promise.resolve(actionsCatalog);
    return fetch("/api/actions?fresh=1").then(function (r) { return r.json(); }).then(function (d) {
      actionsCatalog = d;
      return d;
    });
  }

  /**
   * Windows PowerShell hands a native command a raw command line, so a value
   * has to survive two parsers: PowerShell's, then the C runtime's. A quote
   * escaped only for PowerShell is dropped by the CRT, and an unescaped $ is
   * expanded before node ever sees it - $(...) would run on paste. Both make
   * the composed command do something other than what this drawer promised,
   * which is the one failure the composer exists to prevent.
   */
  function quotePs(s) {
    s = String(s);
    if (/^[A-Za-z0-9._:/-]+$/.test(s)) return s;
    var BS = String.fromCharCode(92), TICK = String.fromCharCode(96);
    var out = "", run = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === BS) { run++; out += c; continue; }
      if (c === '"') { out += new Array(run + 1).join(BS) + BS + TICK + '"'; run = 0; continue; }
      run = 0;
      if (c === TICK) { out += TICK + TICK; continue; }
      if (c === "$") { out += TICK + "$"; continue; }
      out += c;
    }
    return '"' + out + new Array(run + 1).join(BS) + '"';
  }
  function quoteBash(s) {
    s = String(s);
    if (/^[A-Za-z0-9._:/-]+$/.test(s)) return s;
    return "'" + s.replace(/'/g, "'\\\\''") + "'";
  }
  function composeCmd(action, values, shell) {
    var q = shell === "powershell" ? quotePs : quoteBash;
    var parts = ["node", ".cursor/tools/" + action.tool, action.command];
    (action.fields || []).forEach(function (f) {
      var v = values[f.name];
      if (f.kind === "flag") {
        if (v) parts.push(f.name);
        return;
      }
      if (v == null || v === "") return;
      if (f.positional) parts.push(q(v));
      else { parts.push(f.name); parts.push(q(v)); }
    });
    return parts.join(" ");
  }

  function fieldValue(form, f) {
    if (f.kind === "flag") {
      var box = form.querySelector('[name="' + f.name + '"]');
      return box && box.checked;
    }
    var n = form.querySelector('[name="' + f.name + '"]');
    return n ? n.value.trim() : "";
  }

  function clientRefusals(action, values, catalog) {
    var out = [];
    (action.fields || []).forEach(function (f) {
      var v = values[f.name];
      if (f.required !== false && f.kind !== "flag" && (v == null || v === "")) out.push(f.name + " is required.");
      if (f.kind === "enum" && v && f.options && f.options.indexOf(v) < 0) out.push(f.name + " must be one of " + f.options.join(", ") + ".");
      if (f.pattern && v && !(new RegExp(f.pattern)).test(v)) out.push(f.name + " does not match the required format.");
      if (f.kind === "int" && v !== "") {
        var n = Number(v);
        if (!Number.isInteger(n)) out.push(f.name + " must be an integer.");
        else {
          if (f.min != null && n < f.min) out.push(f.name + " must be ≥ " + f.min + ".");
          if (f.max != null && n > f.max) out.push(f.name + " must be ≤ " + f.max + ".");
        }
      }
    });
    if (action.xor) {
      var filled = action.xor.filter(function (n) { return values[n]; });
      if (!filled.length) out.push("Provide " + action.xor.join(" or ") + ".");
    }
    var phase = values.PHASE;
    var bp = catalog && catalog.byPhase && phase ? catalog.byPhase[phase] : null;
    if (action.id === "record-gate" && bp) {
      if (values["--by"] && bp.reviewer && values["--by"] !== bp.reviewer) {
        out.push(phase + ' is judged by ' + bp.reviewer + ', not "' + values['--by'] + '".');
      }
      (bp.recordGate.refusals || []).forEach(function (r) {
        if (out.indexOf(r) < 0 && r.indexOf('not "') < 0) out.push(r);
      });
    }
    if (action.id === "approve" && bp) {
      (bp.approve.refusals || []).forEach(function (r) { out.push(r); });
      if (values['--by'] && bp.judgementBy && values['--by'].toLowerCase() === String(bp.judgementBy).toLowerCase()) {
        out.push('The verdict was recorded by "' + bp.judgementBy + '" and you are signing as the same party. Two consents held by one signature is one consent.');
      }
    }
    if (action.id === "sign" && catalog) {
      var pf = action.preflight || {};
      (pf.refusals || []).forEach(function (r) {
        if (r.indexOf("No record for") === 0 && values.VERSION) return;
        out.push(r);
      });
    }
    return out;
  }

  function readForm(action, form) {
    var values = {};
    (action.fields || []).forEach(function (f) { values[f.name] = fieldValue(form, f); });
    return values;
  }

  function paintComposer(action, catalog, presets) {
    drawerPanel.innerHTML = "";
    drawerPanel.appendChild(el("h3", { text: action.title }));
    drawerPanel.appendChild(el("p", { class: "muted", text: action.description || "" }));
    drawerPanel.appendChild(el("p", { class: "muted", text: "This drawer builds a command. It does not run it." }));

    var form = el("form");
    form.addEventListener("submit", function (e) { e.preventDefault(); });
    (action.fields || []).forEach(function (f) {
      var lab = el("label");
      lab.appendChild(document.createTextNode(f.name + (f.required === false ? " (optional)" : "")));
      if (f.hint) lab.appendChild(el("span", { class: "muted", text: " — " + f.hint }));
      var input;
      var preset = presets[f.name] || f.defaultValue || "";
      if (f.kind === "flag") {
        input = el("input", { type: "checkbox", name: f.name });
        if (preset === true || preset === "true") input.checked = true;
      } else if (f.kind === "enum" || (f.options && f.options.length)) {
        input = el("select", { name: f.name });
        if (f.required === false) input.appendChild(el("option", { value: "", text: "—" }));
        (f.options || []).forEach(function (o) {
          var opt = el("option", { value: o, text: o });
          if (o === preset) opt.selected = true;
          input.appendChild(opt);
        });
      } else if (f.kind === "int") {
        input = el("input", { type: "number", name: f.name, min: String(f.min || 1), max: String(f.max || 90), value: preset || "" });
      } else {
        input = el("input", { type: "text", name: f.name, value: String(preset || ""), placeholder: f.placeholder || "" });
        if (f.pattern) input.setAttribute("pattern", f.pattern);
      }
      if (f.lockedTo === "reviewer") {
        input.addEventListener("focus", function () { /* lock applied in refreshLock */ });
      }
      lab.appendChild(input);
      form.appendChild(lab);
    });
    drawerPanel.appendChild(form);

    var verdict = el("div", { class: "verdict" });
    drawerPanel.appendChild(verdict);

    var toggle = el("div", { class: "shell-toggle" });
    ["powershell", "bash"].forEach(function (k) {
      var id = "shell-" + k;
      var lab = el("label");
      var radio = el("input", { type: "radio", name: "shell", value: k });
      if (k === shellKind) radio.checked = true;
      radio.addEventListener("change", function () { shellKind = k; refresh(); });
      lab.appendChild(radio);
      lab.appendChild(document.createTextNode(" " + k));
      toggle.appendChild(lab);
    });
    drawerPanel.appendChild(toggle);

    var cmd = el("textarea", { class: "cmdbox", readonly: "readonly" });
    drawerPanel.appendChild(cmd);
    var copy = el("button", { class: "btn", type: "button", text: "Copy command" });
    copy.addEventListener("click", function () {
      cmd.focus();
      cmd.select();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(cmd.value).catch(function () {});
      } else {
        try { document.execCommand("copy"); } catch (e) { /* fallback is the selected text */ }
      }
    });
    drawerPanel.appendChild(copy);
    drawerPanel.appendChild(el("button", { class: "btn", type: "button", text: "Close" }));
    drawerPanel.lastChild.addEventListener("click", closeComposer);

    function refreshLock() {
      var phaseSel = form.querySelector('[name="PHASE"]');
      var phase = phaseSel ? phaseSel.value : presets.PHASE;
      var bp = catalog.byPhase && phase ? catalog.byPhase[phase] : null;
      var by = form.querySelector('[name="--by"]');
      if (action.id === "record-gate" && by && bp && bp.reviewer) {
        by.value = bp.reviewer;
        by.readOnly = true;
        by.title = "Locked to the gate reviewer — any other value is refused.";
      }
      return { phase: phase, bp: bp };
    }

    function refresh() {
      refreshLock();
      var values = readForm(action, form);
      var extra = clientRefusals(action, values, catalog);
      var server = action.preflight || {};
      var refusals = extra.slice();
      if (action.id !== "record-gate" && action.id !== "approve" && action.id !== "sign") {
        (server.refusals || []).forEach(function (r) { if (refusals.indexOf(r) < 0) refusals.push(r); });
      }
      var unchecked = server.unchecked || [];
      cmd.value = composeCmd(action, values, shellKind);
      verdict.className = "verdict " + (refusals.length ? "bad" : unchecked.length ? "warn" : "ok");
      verdict.innerHTML = "";
      verdict.appendChild(el("strong", { text: refusals.length ? "WOULD BE REFUSED" : unchecked.length ? "READY — some checks not run here" : "READY" }));
      if (refusals.length) {
        var ul = el("ul");
        refusals.forEach(function (r) { ul.appendChild(el("li", { text: r })); });
        verdict.appendChild(ul);
      } else if (server.hint) {
        verdict.appendChild(el("p", { class: "muted", text: server.hint }));
      }
      if (unchecked.length) {
        var u = el("ul");
        unchecked.forEach(function (r) { u.appendChild(el("li", { text: "Not checked here: " + r })); });
        verdict.appendChild(u);
      }
      if (action.id === "change-open" && values["--changes"] && action.impactCommand) {
        verdict.appendChild(el("p", { class: "muted", text: "Forecast first: " + action.impactCommand + " " + values["--changes"].split(",").map(function (s) { return s.trim(); }).filter(Boolean).join(" ") }));
      }
    }

    form.addEventListener("input", refresh);
    form.addEventListener("change", refresh);
    if (presets.PHASE && form.querySelector('[name="PHASE"]')) form.querySelector('[name="PHASE"]').value = presets.PHASE;
    if (presets.VERSION && form.querySelector('[name="VERSION"]')) form.querySelector('[name="VERSION"]').value = presets.VERSION;
    refresh();
  }

  function openComposer(id, presets) {
    loadActions(false).then(function (catalog) {
      var action = (catalog.actions || []).find(function (a) { return a.id === id; });
      if (!action) {
        drawerPanel.innerHTML = "";
        drawerPanel.appendChild(el("p", { class: "err", text: "Action '" + id + "' is not available in this repo (usually because the lifecycle is not adopted)." }));
        drawerPanel.appendChild(el("button", { class: "btn", type: "button", text: "Close" }));
        drawerPanel.lastChild.addEventListener("click", closeComposer);
        drawer.hidden = false;
        return;
      }
      paintComposer(action, catalog, presets || {});
      drawer.hidden = false;
    }).catch(function (e) {
      drawerPanel.innerHTML = "";
      drawerPanel.appendChild(el("p", { class: "err", text: String(e) }));
      drawer.hidden = false;
    });
  }

  function closeComposer() { drawer.hidden = true; }
  document.getElementById("drawer-scrim").addEventListener("click", closeComposer);

  function show(name) {
    current = name;
    document.querySelectorAll("nav > button[data-panel]").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-panel") === name);
    });
    content.innerHTML = "";
    content.appendChild(el("p", { class: "muted", text: "Loading…" }));
    fetch("/api/" + name + "?fresh=1").then(function (r) { return r.json(); }).then(function (d) {
      if (name === "actions") actionsCatalog = d;
      content.innerHTML = "";
      var node = RENDER[name](d);
      content.appendChild(node);
    }).catch(function (e) {
      content.innerHTML = "";
      content.appendChild(el("p", { class: "err", text: String(e) }));
    });
  }

  document.querySelectorAll("nav > button[data-panel]").forEach(function (b) {
    b.addEventListener("click", function () { show(b.getAttribute("data-panel")); });
  });
  document.getElementById("refresh").addEventListener("click", function () {
    actionsCatalog = null;
    show(current);
  });
  show("overview");
})();
</script>
</body>
</html>
`;

/* ------------------------------------------------------------------ CLI */

function usage() {
  console.log(`Usage:
  node .cursor/tools/dashboard.mjs serve [--port 7777] [--no-open]
  node .cursor/tools/dashboard.mjs snapshot [--json]

GET only. Binds 127.0.0.1 only. Host must be localhost. Never writes lifecycle state or caches.
The Actions panel composes a command; you paste it. The server never runs it.
Exit codes:  0 = ok   2 = usage`);
}

function main() {
  const args = process.argv.slice(3);
  const cmd = process.argv[2];
  if (!cmd || cmd === "--help" || cmd === "-h") { usage(); process.exit(cmd ? 0 : 2); }
  if (cmd === "serve") return serve(args);
  if (cmd === "snapshot") {
    return snapshot().then((data) => console.log(JSON.stringify(data, null, 2)));
  }
  usage();
  process.exit(2);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly || process.env.DASHBOARD_FORCE_CLI) main();

// For the test suite: the envelope reader and the one collector built on it.
export { parseToolOut, collectFindings, FINDING_TOOLS, onRequest };
