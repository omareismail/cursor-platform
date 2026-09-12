#!/usr/bin/env node
/**
 * project.mjs — Project Command Center CLI.
 *
 * Canonical authored state lives under project/. This tool is the writer.
 * The dashboard, graph, roadmap and recommendations are projections.
 *
 * Usage:
 *   node .cursor/tools/project.mjs init [--name N] [--existing] [--owner N] [--description T]
 *   node .cursor/tools/project.mjs status [--json]
 *   node .cursor/tools/project.mjs scan [--json]
 *   node .cursor/tools/project.mjs snapshot [--json]
 *   node .cursor/tools/project.mjs map [--json]
 *   node .cursor/tools/project.mjs dashboard [--port 7777]
 *
 *   node .cursor/tools/project.mjs delivery list|show [ID]|start ID|complete ID
 *   node .cursor/tools/project.mjs delivery objective PHASE OBJ --status COMPLETE|INCOMPLETE|UNKNOWN
 *
 *   node .cursor/tools/project.mjs checkpoint list|show ID|verify ID|pass ID|fail ID|waive ID
 *   node .cursor/tools/project.mjs checkpoint add --phase ID --type TYPE
 *
 *   node .cursor/tools/project.mjs idea add --title T | list | show ID
 *   node .cursor/tools/project.mjs idea evaluate|approve|reject|park|implement|verify ID
 *
 *   node .cursor/tools/project.mjs recommend list|show ID|accept ID|dismiss ID
 *   node .cursor/tools/project.mjs roadmap show|add --idea ID --phase ID
 *
 * Exit: 0 ok  1 not ready / missing  2 usage
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, realpathSync } from "node:fs";
import { join, dirname, resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeAtomic, actor } from "./_state.mjs";
import { commitDocuments, recoverDocuments } from "./_project-txn.mjs";
import * as model from "./_project-model.mjs";

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
let ROOT = process.env.CLAUDE_PROJECT_DIR || repoRoot() || process.cwd();
export function setRoot(p) { if (p) ROOT = p; }

function repoRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch { return null; }
}

model.setFs({ join, readdirSync, statSync, existsSync, readFileSync });

const DIR = () => join(ROOT, "project");
const P_IDENTITY = () => join(DIR(), "project.json");
const P_DELIVERY = () => join(DIR(), "delivery.json");
const P_IDEAS = () => join(DIR(), "ideas.json");

const out = (s = "") => process.stdout.write(s + (s.endsWith("\n") ? "" : "\n"));
const die = (m, c = 2) => { process.stderr.write(m + "\n"); process.exit(c); };
const valueOf = (a, f) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : null; };
const flag = (a, f) => a.includes(f);
const jsonMode = (a) => a.includes("--json");

function readJson(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (e) { throw new Error(`${path} is not valid JSON: ${e.message}. Repair or restore it; refusing to overwrite.`); }
}

function recoverIfNeeded() {
  if (!existsSync(DIR())) return;
  recoverDocuments(DIR());
}

function crashOpts() {
  const after = process.env.PROJECT_TXN_CRASH;
  return after ? { crashAfter: after } : {};
}

function saveProject({ ident, delivery, ideas } = {}) {
  recoverIfNeeded();
  const docs = {};
  if (ident) docs["project.json"] = ident;
  if (delivery) docs["delivery.json"] = delivery;
  if (ideas) docs["ideas.json"] = ideas;
  if (!Object.keys(docs).length) return;
  try { return commitDocuments(DIR(), docs, crashOpts()); }
  catch (e) {
    if (e.code === "ECONFLICT" || e.code === "ELOCKED" || e.code === "ECORRUPT") die(e.message, 1);
    throw e;
  }
}

function loadIdentity() { recoverIfNeeded(); return readJson(P_IDENTITY()); }
function loadDelivery() { recoverIfNeeded(); return readJson(P_DELIVERY()); }
function loadIdeas() {
  recoverIfNeeded();
  const doc = readJson(P_IDEAS());
  if (!doc && existsSync(P_IDENTITY())) throw new Error("Missing project/ideas.json. Restore it from version control; refusing to replace lost ideas with an empty list.");
  return doc || model.emptyIdeas();
}

function requireAdopted() {
  const ident = loadIdentity();
  if (!ident) die("No project/project.json. Run: node .cursor/tools/project.mjs init --name \"<product>\"", 1);
  const delivery = loadDelivery();
  if (!delivery) die("No project/delivery.json. Restore the missing state from version control; init will not overwrite existing project state.", 1);
  const ideas = loadIdeas();
  validateState(ident, delivery, ideas);
  return { ident, delivery, ideas };
}

function appendHistory(delivery, event, detail, extra = {}) {
  delivery.history = delivery.history || [];
  delivery.history.push({ at: model.nowIso(), event, detail, ...extra });
}

function evidenceFile(ref) {
  if (!ref || isAbsolute(ref) || /^[a-z]+:/i.test(ref)) throw new Error("Evidence must name an existing file relative to the project root.");
  const path = realpathSync(resolve(ROOT, ref));
  const rel = relative(realpathSync(ROOT), path);
  if (rel === ".." || rel.startsWith("..\\") || rel.startsWith("../") || isAbsolute(rel) || !statSync(path).isFile()) {
    throw new Error("Evidence must stay inside the project root and name a file.");
  }
  return { ref: rel.replace(/\\/g, "/"), hash: createHash("sha256").update(readFileSync(path)).digest("hex") };
}

function manualEvidence(ref, reviewer, note) {
  return { kind: "manual", ...evidenceFile(ref), ok: true, valid: true, summary: note || "", at: model.nowIso(), by: reviewer || actor(ROOT).git || actor(ROOT).os };
}

// Bind an automated result to the checked worktree, including dirty/untracked
// inputs. Authored project state is excluded so recording the result itself
// does not immediately make that result stale.
function inputDigest() {
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    .split("\0").filter((p) => p && !p.startsWith("project/")).sort();
  const hash = createHash("sha256");
  for (const file of [...new Set(files)]) {
    hash.update(file).update("\0");
    try { hash.update(readFileSync(join(ROOT, file))); } catch { hash.update("<missing>"); }
    hash.update("\0");
  }
  return hash.digest("hex");
}

function validateEvidence(records) {
  let digest;
  return (records || []).map((record) => {
    const evidence = (record.evidence || []).map((e) => {
      let valid = false;
      try {
        if (e.kind === "manual" && e.hash) valid = evidenceFile(e.ref).hash === e.hash;
        if (e.kind === "tool" && e.inputDigest) valid = e.inputDigest === (digest ??= inputDigest());
      } catch { /* Missing or changed inputs are not valid evidence. */ }
      return { ...e, valid };
    });
    return { ...record, evidence };
  });
}

function validateState(ident, delivery, ideas) {
  const errors = model.validateState(ident, delivery, ideas);
  if (errors.length) throw new Error(`Invalid project state:\n${errors.join("\n")}\nRestore or repair the affected file; no state was written.`);
}

function writeReadme() {
  const body = `# project/

Canonical **authored** state for the Project Command Center. The dashboard
never writes here. \`project.mjs\` is the writer.

| File | Owns | Derived from elsewhere |
|---|---|---|
| \`project.json\` | Identity, current delivery pointers, recommendation dispositions | Stack/languages may be *detected* by \`scan\` until confirmed |
| \`delivery.json\` | Delivery phases, checkpoints, overlay feature bindings, history | Lifecycle phase is \`lifecycle/state.json\`. Releases are \`lifecycle/releases/\` |
| \`ideas.json\` | Ideas and their status transitions | Features they became live in \`.cursor/cache/feature-map.json\` |

Do not store a second copy of a traced feature, a gate approval, or an ADR.
Link by id.

Detected vs confirmed: identity fields carry \`{ value, confidence }\` where
confidence is \`detected\`, \`confirmed\`, or \`unknown\`. Discovery is not
the same as a human saying the stack is X.

Init does not mark delivery phases COMPLETE. On \`--existing\` they start as
\`NEEDS_REVIEW\`.

Multi-file writes use \`project/.txn.json\` as a write-ahead journal. That file
is ephemeral: a crash after it is fsynced completes on the next command.
`;
  mkdirSync(DIR(), { recursive: true });
  writeAtomic(join(DIR(), "README.md"), body);
}

/* ------------------------------------------------------------------ assemble */

function tryRead(rel, json = true) {
  const abs = join(ROOT, ...rel.split("/"));
  if (!existsSync(abs)) return null;
  try {
    const t = readFileSync(abs, "utf8");
    return json ? JSON.parse(t) : t;
  } catch { return null; }
}

function listJson(rel) {
  const abs = join(ROOT, ...rel.split("/"));
  if (!existsSync(abs)) return [];
  try {
    return readdirSync(abs).filter((f) => f.endsWith(".json")).map((f) => {
      try { return JSON.parse(readFileSync(join(abs, f), "utf8")); }
      catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

async function loadLifecycle() {
  try {
    const lc = await import(new URL("./lifecycle.mjs", import.meta.url));
    if (typeof lc.setRoot === "function") lc.setRoot(ROOT);
    const s = lc.readState();
    if (!s) return { adopted: false, phase: null, phaseStatus: null, phases: [], history: [] };
    const derived = lc.deriveAll(s);
    return {
      adopted: true,
      product: s.product,
      mode: s.mode,
      phase: s.phase,
      phaseStatus: derived[s.phase]?.status || null,
      updated: s.updated,
      phases: (lc.PHASES || []).map((p) => ({
        name: p,
        status: derived[p]?.status,
        current: p === s.phase,
        reasons: derived[p]?.reasons || [],
      })),
      history: s.history || [],
    };
  } catch {
    return { adopted: false, phase: null, phaseStatus: null, phases: [], history: [] };
  }
}

async function loadFeatureMapSafe() {
  try {
    const fm = await import(new URL("./feature-map.mjs", import.meta.url));
    return fm.loadFeatureMap({ required: false });
  } catch { return null; }
}

async function loadAc() {
  try {
    const acTrace = await import(new URL("./ac-trace.mjs", import.meta.url));
    const loaded = acTrace.load([]);
    const a = acTrace.analyse(loaded.acs, loaded.claims);
    return {
      acs: loaded.acs.size,
      claims: loaded.claims.length,
      covered: a.covered.length,
      uncovered: a.uncovered.length + a.skippedOnly.length + a.vacuousOnly.length,
      uncoveredIds: [...a.uncovered, ...a.skippedOnly, ...a.vacuousOnly].slice(0, 20).map((x) => x.id || x.ac || x),
    };
  } catch { return null; }
}

async function loadRequirements() {
  try {
    const artifacts = await import(new URL("./artifact-schema.mjs", import.meta.url));
    const graph = artifacts.buildGraph();
    const reqs = [];
    let dangling = 0;
    for (const v of graph.byId.values()) {
      if (v.prefix === "FR" || v.prefix === "NFR") reqs.push({ id: v.id, file: v.file, prefix: v.prefix });
    }
    for (const refs of graph.refsByFile.values()) for (const id of refs) if (!graph.byId.has(id)) dangling++;
    return { requirements: reqs, dangling, total: graph.byId.size };
  } catch { return { requirements: [], dangling: null, total: 0 }; }
}

async function loadDecisions() {
  try {
    const dm = await import(new URL("./decision-memory.mjs", import.meta.url));
    return dm.indexDecisions(ROOT);
  } catch { return []; }
}

function parseFindingStdout(stdout, fallback) {
  try { return JSON.parse(String(stdout || "").trim() || "null"); }
  catch { return fallback; }
}

function loadAdapter(tool, args, label) {
  const script = join(TOOLS_DIR, tool);
  if (!existsSync(script)) return { available: false, reason: `${tool} is not in this install`, source: tool };
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      cwd: ROOT, env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
      encoding: "utf8", timeout: 20_000, maxBuffer: 4 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    const parsed = parseFindingStdout(stdout, null);
    if (parsed?.skipped) return { available: false, skipped: true, reason: parsed.summary || `${label} skipped`, source: tool, summary: parsed.summary };
    return {
      available: true,
      ok: parsed?.ok !== false && (parsed?.counts?.block ?? 0) === 0,
      skipped: false,
      summary: parsed?.summary || label,
      counts: parsed?.counts || null,
      findings: Array.isArray(parsed?.findings) ? parsed.findings.slice(0, 20) : [],
      source: tool,
    };
  } catch (e) {
    const parsed = parseFindingStdout(e.stdout, null);
    if (e.status === 2 && (parsed?.skipped || !parsed)) {
      return { available: false, skipped: true, reason: parsed?.summary || `${label} has nothing to check`, source: tool, summary: parsed?.summary };
    }
    if (parsed && parsed.schema === "finding-report/1") {
      return {
        available: true,
        ok: parsed.ok === true && (parsed.counts?.block ?? 0) === 0,
        summary: parsed.summary,
        counts: parsed.counts,
        findings: (parsed.findings || []).slice(0, 20),
        source: tool,
      };
    }
    return { available: false, reason: `${label} did not return a finding report`, source: tool };
  }
}

function securityAdapter(incidents) {
  const docs = ["docs/design/security-design.md", "docs/design/threat-model.md", "docs/security/threat-model.md"]
    .filter((p) => existsSync(join(ROOT, p)));
  if (incidents?.available) {
    return {
      ...incidents,
      summary: incidents.summary || (docs.length ? `${incidents.summary || "incidents check"} · docs ${docs.join(", ")}` : incidents.summary),
    };
  }
  if (docs.length) {
    return {
      available: true,
      ok: true,
      summary: `Security design documents present (${docs.join(", ")}). Not a penetration result.`,
      counts: { block: 0 },
      source: docs[0],
    };
  }
  return { available: false, reason: "No incidents check result and no security-design/threat-model document" };
}

function performanceAdapter(checkpoints) {
  const evidenced = (checkpoints || []).filter((c) => c.type === "performance" && model.checkpointEvidenceReady(c));
  const paths = ["docs/perf", "tests/load", "load"].filter((p) => existsSync(join(ROOT, p)));
  if (evidenced.length) {
    return { available: true, ok: true, summary: `${evidenced.length} performance checkpoint(s) evidenced`, source: "checkpoints", counts: { block: 0 } };
  }
  if (paths.length) {
    return { available: true, ok: true, summary: `Load/perf paths present (${paths.join(", ")}); no evidenced performance checkpoint`, source: paths[0], counts: { block: 0 } };
  }
  return { available: false, reason: "No performance checkpoint evidence and no load-test path" };
}

function releaseAdapter(releases) {
  if (!releases.length) return { available: false, reason: "No lifecycle/releases records" };
  const signed = releases.filter((r) => r.signature);
  const unsigned = releases.filter((r) => !r.signature);
  return {
    available: true,
    ok: unsigned.length === 0,
    summary: `${signed.length} signed, ${unsigned.length} unsigned`,
    counts: { block: unsigned.length },
    source: "lifecycle/releases",
  };
}

function collectTasks(ideas, features, fmap) {
  const out = [];
  const seen = new Set();
  const add = (id, title, file) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ id, title: title || id, file: file || null });
  };
  for (const i of ideas || []) for (const tid of i.taskIds || []) add(tid, tid, null);
  for (const f of features || []) for (const tid of f.taskIds || []) add(tid, tid, null);
  for (const f of Object.values(fmap?.features || {})) {
    for (const t of f.tasks || []) add(t.id || t, t.title || t.id || t, t.file || t.path || null);
  }
  return out;
}

function loadRisks(delivery) {
  const found = [];
  for (const rel of model.RISK_REGISTER_CANDIDATES) {
    const abs = join(ROOT, ...rel.split("/"));
    if (existsSync(abs)) found.push(rel);
  }
  if (!found.length) return { risks: [], source: model.RISK_REGISTER_CANDIDATES[0], available: false, parsed: false, candidates: model.RISK_REGISTER_CANDIDATES };
  const rel = found[0];
  let markdown;
  try { markdown = readFileSync(join(ROOT, ...rel.split("/")), "utf8"); }
  catch { return { risks: [], source: rel, available: false, parsed: false, reason: "unreadable", candidates: found }; }
  const parsed = model.parseRiskRegister(markdown, rel);
  model.linkRisksToDelivery(parsed.risks, delivery?.phases || []);
  return { ...parsed, available: true, candidates: found, secondary: found.slice(1) };
}

function repoFile(ref, label = "File") {
  if (!ref || isAbsolute(ref) || /^[a-z]+:/i.test(ref)) throw new Error(`${label} must name an existing file relative to the project root.`);
  const path = realpathSync(resolve(ROOT, ref));
  const rel = relative(realpathSync(ROOT), path);
  if (rel === ".." || rel.startsWith("..\\") || rel.startsWith("../") || isAbsolute(rel) || !statSync(path).isFile()) {
    throw new Error(`${label} must stay inside the project root and name a file.`);
  }
  return { ref: rel.replace(/\\/g, "/"), path };
}

function enrichFeatures(raw, delivery) {
  const listed = model.projectFeatures(raw || { features: {} }, delivery);
  if (!raw?.features) return listed;
  for (const row of listed) {
    const f = raw.features[row.id];
    if (!f) continue;
    row.tests = (f.tests || f.testFiles || []).length;
    row.fileRefs = [];
    if (Array.isArray(f.files)) {
      row.fileRefs = f.files.map((x) => typeof x === "string" ? x : x.path).filter(Boolean);
    }
    row.testRefs = (f.tests || f.testFiles || []).map((x) => typeof x === "string" ? x : x.path || x.file).filter(Boolean);
  }
  return listed;
}

export async function assemble() {
  const ident = loadIdentity();
  const delivery = loadDelivery();
  const ideasDoc = ident ? loadIdeas() : model.emptyIdeas();
  const adopted = !!ident;
  if (adopted) validateState(ident, delivery, ideasDoc);

  // Existing source readers bind their root at module import. Isolate them in a
  // worker with the selected root; dashboard.setRoot must not mix repositories.
  const { lifecycle, fmap, ac, reqs, decisions, adapters: loadedAdapters } = JSON.parse(execFileSync(process.execPath, [join(TOOLS_DIR, "project.mjs"), "sources"], {
    cwd: ROOT, env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT, PROJECT_FORCE_CLI: "" }, encoding: "utf8", timeout: 90_000, maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  }));

  const phases = delivery?.phases || [];
  const checkpoints = validateEvidence(delivery?.checkpoints);
  const ideas = validateEvidence(ideasDoc.ideas);
  const features = enrichFeatures(fmap, delivery || { featureBindings: [] });
  const register = loadRisks(delivery);
  const releases = listJson("lifecycle/releases");
  const tasks = collectTasks(ideas, features, fmap);
  const adapters = {
    security: securityAdapter(loadedAdapters?.incidents),
    observability: loadedAdapters?.observability || { available: false, reason: "failure-modes.mjs was not run" },
    debt: loadedAdapters?.debt || { available: false, reason: "flag-debt.mjs was not run" },
    performance: performanceAdapter(checkpoints),
    release: releaseAdapter(releases),
  };
  const ctx = {
    project: ident,
    phases,
    checkpoints,
    ideas,
    features,
    featureBindings: delivery?.featureBindings || [],
    requirements: reqs.requirements,
    ac,
    dispositions: ident?.recommendationDispositions || {},
    currentDeliveryPhaseId: ident?.currentDeliveryPhaseId,
    risks: register.risks,
    decisions,
    lifecyclePhases: lifecycle.phases,
    releases,
    requirementIdsKnown: reqs.total > 0,
    tasks,
    adapters,
    milestones: delivery?.milestones || [],
  };

  const active = phases.find((p) => p.id === ident?.currentDeliveryPhaseId)
    || phases.find((p) => p.status === "IN_PROGRESS")
    || null;
  const readiness = active ? model.phaseReadiness(active, ctx) : null;
  const recs = adopted ? model.recommend(ctx) : [];
  const health = model.healthView({
    ...ctx,
    lifecycle,
    phases,
    checkpoints,
    features,
    ideas,
    ac,
    traceDangling: reqs.dangling,
    openRisks: register.available ? model.openRiskCount(register.risks) : undefined,
    adapters,
  });

  const discovery = adopted ? ident.identity : null;
  const timeline = model.buildTimeline([
    ...(lifecycle.history || []).map((h) => ({ at: h.at, kind: "lifecycle", title: h.event || "lifecycle", detail: h.detail, ref: h.phase })),
    ...(delivery?.history || []).map((h) => ({ at: h.at, kind: "delivery", title: h.event, detail: h.detail, ref: h.phaseId || h.checkpointId })),
    ...ideas.flatMap((i) => (i.history || []).map((h) => ({ at: h.at, kind: "idea", title: `${i.id} ${h.status || h.event}`, detail: h.detail || i.title, ref: i.id }))),
    ...checkpoints.flatMap((c) => (c.history || []).map((h) => ({ at: h.at, kind: "checkpoint", title: `${c.name} ${h.status}`, detail: h.detail, ref: c.id }))),
    ...listJson("lifecycle/releases").map((r) => ({ at: r.at, kind: "release", title: `Release ${r.version}`, detail: r.signature ? `signed by ${r.signature.by}` : "unsigned", ref: r.version })),
    ...listJson("lifecycle/changes").map((c) => ({ at: c.at || c.openedAt, kind: "change", title: `${c.id} ${c.status}`, detail: c.reason, ref: c.id })),
    ...listJson("lifecycle/incidents").map((i) => ({ at: i.at || i.openedAt, kind: "incident", title: i.id, detail: i.title, ref: i.id })),
    ...decisions.filter((d) => d.date).map((d) => ({ at: d.date, kind: "decision", title: d.id, detail: d.title, ref: d.id })),
  ]);

  const graph = model.buildGraph({
    project: ident,
    phases,
    checkpoints,
    ideas,
    features,
    lifecyclePhases: lifecycle.phases,
    releases: ctx.releases,
    risks: ctx.risks,
    tasks,
    milestones: ctx.milestones,
  });

  return {
    adopted,
    empty: !adopted,
    hint: adopted ? null : "This repo has no project/ directory yet. Init creates identity, default delivery phases and checkpoints without fabricating completion.",
    command: 'node .cursor/tools/project.mjs init --name "<product>"',
    generatedAt: model.nowIso(),
    root: ROOT,
    identity: ident,
    lifecycle,
    delivery: adopted ? {
      phases: phases.map((p) => ({ ...p, readiness: model.phaseReadiness(p, ctx) })),
      checkpoints,
      matrix: model.checkpointMatrix(phases, checkpoints),
      active,
      readiness,
      blockers: model.blockers(ctx),
    } : null,
    features,
    ideas: ideas.map((i) => ({ ...i, trace: model.ideaTrace(i, ctx) })),
    recommendations: recs,
    health,
    timeline,
    graph,
    roadmap: model.roadmap(ctx),
    decisions: decisions.slice(0, 40),
    discovery,
    traceability: { total: reqs.total, requirements: reqs.requirements.length, dangling: reqs.dangling },
    ac,
    requirements: reqs.requirements,
    risks: {
      available: register.available,
      source: register.source,
      items: register.risks,
      open: register.available ? model.openRiskCount(register.risks) : null,
      candidates: register.candidates || [],
    },
    contract: adopted ? model.contractFindings(ctx) : [],
    adapters,
    relationErrors: adopted ? [
      ...model.validateRelations({ phases, checkpoints, ideas, featureBindings: delivery?.featureBindings }),
      ...model.validateCanonicalRefs({ identity: ident, delivery: { phases, checkpoints }, ideas: { ideas } }, {
        requirements: reqs.requirements,
        requirementsAvailable: reqs.total > 0,
        decisions,
        decisionsAvailable: Array.isArray(decisions),
        releases,
        releasesAvailable: true,
        risks: register.risks,
        risksAvailable: register.available,
      }),
    ] : [],
  };
}

export async function snapshot() {
  return assemble();
}

/* ------------------------------------------------------------------ commands */

function printStatus(snap, asJson) {
  if (asJson) { out(JSON.stringify(snap, null, 2)); return 0; }
  if (!snap.adopted) {
    out("Project Command Center is not initialised.");
    out(snap.command);
    return 1;
  }
  const id = snap.identity;
  out(`PROJECT  ${id.name}  (${id.id})`);
  out(`Status   ${id.status}`);
  if (snap.lifecycle.adopted) {
    const ladder = snap.lifecycle.phases.map((p) => {
      const mark = p.status === "APPROVED" || p.status === "INHERITED" ? "✓"
        : p.current ? "●" : "○";
      return `${p.name} ${mark}`;
    }).join(" → ");
    out(`Lifecycle  ${ladder}`);
    out(`           current ${snap.lifecycle.phase} · ${snap.lifecycle.phaseStatus}`);
  } else {
    out("Lifecycle  not adopted (valid).");
  }
  const d = snap.delivery;
  if (d?.active) {
    const r = d.readiness;
    out(`Delivery   ${d.active.name} · ${r.derived}`);
    out(`           ${r.progress.label}`);
    if (!r.ready) out(`           not ready: ${r.reasons[0] || ""}`);
  }
  const ch = (d?.checkpoints || []).filter((c) => c.phaseId === d?.active?.id);
  if (ch.length) {
    out("Checkpoints");
    for (const c of ch) out(`  ${model.matrixGlyph(c.status)} ${c.name}`);
  }
  const blk = d?.blockers || [];
  if (blk.length) {
    out("Blockers");
    for (const b of blk) out(`  ${b.id}  ${b.title}`);
  }
  out(`Features  ${snap.features.length}   Ideas  ${snap.ideas.length}   Recs  ${snap.recommendations.length}`);
  return d?.readiness && !d.readiness.ready ? 1 : 0;
}

const CMDS = {
  async sources() {
    const [lifecycle, fmap, ac, reqs, decisions] = await Promise.all([loadLifecycle(), loadFeatureMapSafe(), loadAc(), loadRequirements(), loadDecisions()]);
    if (fmap) {
      try {
        const rows = JSON.parse(execFileSync(process.execPath, [join(TOOLS_DIR, "feature-map.mjs"), "list", "--json"], { cwd: ROOT, env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT }, encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }));
        for (const row of rows) if (fmap.features[row.id]) fmap.features[row.id].stale = row.stale;
      } catch { /* Freshness remains unknown; never invent fresh=false. */ }
    }
    const adapters = {
      incidents: loadAdapter("incidents.mjs", ["check", "--json"], "Incident guards"),
      observability: loadAdapter("failure-modes.mjs", ["check", "--json"], "Failure modes"),
      debt: loadAdapter("flag-debt.mjs", ["scan", "--json"], "Flag debt"),
    };
    out(JSON.stringify({ lifecycle, fmap, ac, reqs, decisions, adapters }));
    return 0;
  },
  init(args) {
    if (existsSync(P_IDENTITY())) {
      out("project/project.json already exists. Use scan --write to refresh detection.");
      return 0;
    }
    const name = valueOf(args, "--name") || inferName();
    const existing = flag(args, "--existing");
    const owner = valueOf(args, "--owner");
    const description = valueOf(args, "--description") || "";
    mkdirSync(DIR(), { recursive: true });
    const ident = model.emptyIdentity({ name, description, owner, existing });
    ident.repositoryPath = ROOT;
    const scanned = model.discover(ROOT);
    const merged = model.mergeIdentity(ident, scanned);
    merged.identity.name = model.field(name, "confirmed");
    if (description) merged.identity.description = model.field(description, "confirmed");
    if (owner) merged.identity.owner = model.field(owner, "confirmed");
    const delivery = model.buildDefaultDelivery({ existing });
    if (existing) {
      merged.currentDeliveryPhaseId = null;
    } else {
      const first = delivery.phases.find((p) => p.id === "PHASE-000");
      if (first) first.status = "IN_PROGRESS";
      merged.currentDeliveryPhaseId = "PHASE-000";
    }
    const ideas = model.emptyIdeas();
    saveProject({ ident: merged, delivery, ideas });
    writeReadme();
    out(`Initialised project/ for ${merged.name}`);
    out(`  identity   ${P_IDENTITY()}`);
    out(`  delivery   ${delivery.phases.length} phases, ${delivery.checkpoints.length} checkpoints`);
    out(`  current    ${merged.currentDeliveryPhaseId || "unknown — choose with delivery start <phase-id>"}`);
    if (scanned.needsReview.length) {
      out("Needs review:");
      for (const n of scanned.needsReview) out(`  - ${n}`);
    }
    out("Detected stack:");
    out(`  languages   ${(merged.identity.languages.value || []).join(", ") || "unknown"} (${merged.identity.languages.confidence})`);
    out(`  frameworks  ${(merged.identity.frameworks.value || []).join(", ") || "unknown"} (${merged.identity.frameworks.confidence})`);
    return 0;
  },

  async status(args) {
    const snap = await assemble();
    return printStatus(snap, jsonMode(args));
  },

  scan(args) {
    const ident = loadIdentity();
    const limits = {
      maxDepth: Number(valueOf(args, "--max-depth")) || undefined,
      maxFiles: Number(valueOf(args, "--max-files")) || undefined,
      maxHits: Number(valueOf(args, "--max-hits")) || undefined,
    };
    const scanned = model.discover(ROOT, undefined, limits);
    if (ident && flag(args, "--write")) {
      const merged = model.mergeIdentity(ident, scanned);
      saveProject({ ident: merged });
    }
    const body = {
      ...scanned,
      written: !!(ident && flag(args, "--write")),
      confirmed: ident?.identity || null,
    };
    if (jsonMode(args)) { out(JSON.stringify(body, null, 2)); return 0; }
    out(`Detected`);
    out(`  languages      ${(scanned.languages.value || []).join(", ") || "—"} (${scanned.languages.confidence})`);
    out(`  frameworks     ${(scanned.frameworks.value || []).join(", ") || "—"} (${scanned.frameworks.confidence})`);
    out(`  stack          ${scanned.classification?.label || "—"} (${scanned.classification?.confidence || "unknown"})`);
    const c = scanned.counts || {};
    out(`  .NET projects  ${c.dotnetProjects ?? "—"}`);
    out(`  React apps     ${c.reactApps ?? "—"}`);
    out(`  Databases      ${c.databases ?? "—"}`);
    out(`  API endpoints  ${c.apiEndpoints ?? "—"}`);
    out(`  Tests          ${c.tests ?? "—"}`);
    if (scanned.limits?.truncated) out(`  limits         truncated after ${scanned.limits.filesVisited} files (maxFiles=${scanned.limits.maxFiles})`);
    if ((scanned.detections || []).length) {
      out("Detections (confirm with identity confirm --detection ID):");
      for (const d of scanned.detections.slice(0, 20)) {
        const src = (d.sources || []).slice(0, 2).map((s) => s.path).join(", ");
        out(`  ${d.id}  ${d.field}=${typeof d.value === "object" ? d.value.label || d.value.id : d.value}  ${src}`);
      }
    }
    if (scanned.needsReview.length) {
      out("Needs review:");
      for (const n of scanned.needsReview) out(`  - ${n}`);
    }
    out("Confidence is categorical (detected / confirmed / unknown), not a percentage.");
    return scanned.needsReview.length ? 1 : 0;
  },

  async snapshot(args) {
    const snap = await assemble();
    out(JSON.stringify(snap, null, 2));
    return snap.adopted ? 0 : 1;
  },

  async map(args) {
    const snap = await assemble();
    if (jsonMode(args) || true) {
      out(JSON.stringify(snap.graph, null, 2));
    }
    return snap.adopted ? 0 : 1;
  },

  dashboard(args) {
    const script = join(TOOLS_DIR, "dashboard.mjs");
    const extra = args.filter((a) => a !== "--json");
    const child = spawn(process.execPath, [script, "serve", ...extra], {
      cwd: ROOT,
      env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("exit", (c) => process.exit(c ?? 0));
    return undefined;
  },
};

function inferName() {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    if (pkg.name) return pkg.name;
  } catch { /* none */ }
  try {
    const plug = JSON.parse(readFileSync(join(ROOT, ".claude-plugin", "plugin.json"), "utf8"));
    if (plug.name) return plug.name;
  } catch { /* none */ }
  return ROOT.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "untitled";
}

/* delivery / checkpoint / idea / recommend / roadmap */

function findPhase(delivery, id) {
  const p = delivery.phases.find((x) => x.id === id || x.slug === id);
  if (!p) die(`Unknown phase ${id}.`, 1);
  return p;
}
function findChk(delivery, id) {
  const c = delivery.checkpoints.find((x) => x.id === id);
  if (!c) die(`Unknown checkpoint ${id}.`, 1);
  return c;
}
function findIdea(ideas, id) {
  const i = ideas.ideas.find((x) => x.id === id);
  if (!i) die(`Unknown idea ${id}.`, 1);
  return i;
}

function setCheckpointStatus(chk, status, { by, detail, evidence } = {}) {
  chk.status = status;
  chk.history = chk.history || [];
  chk.history.push({ at: model.nowIso(), status, by: by || actor(ROOT).git || actor(ROOT).os, detail });
  if (status === "PASSED" || status === "WAIVED" || status === "FAILED") chk.completedAt = model.nowIso();
  if (evidence) {
    chk.evidence = chk.evidence || [];
    chk.evidence.push(evidence);
  }
}

CMDS.delivery = async function delivery(args) {
  const { ident, delivery, ideas } = requireAdopted();
  const sub = args[0];
  const rest = args.slice(1);
  const snap = ["list", "show", "complete"].includes(sub) ? await assemble() : null;
  const readinessFor = (p) => snap.delivery.phases.find((phase) => phase.id === p.id).readiness;
  if (sub === "list") {
    if (jsonMode(args)) { out(JSON.stringify(delivery.phases, null, 2)); return 0; }
    for (const p of delivery.phases) {
      const r = readinessFor(p);
      out(`${p.id.padEnd(10)} ${p.status.padEnd(14)} ${p.name}  ${r.progress.label}`);
    }
    return 0;
  }
  if (sub === "show") {
    const p = findPhase(delivery, rest[0] || ident.currentDeliveryPhaseId);
    const r = readinessFor(p);
    if (jsonMode(args)) { out(JSON.stringify({ ...p, readiness: r }, null, 2)); return 0; }
    out(`${p.id}  ${p.name}  ${p.status}  derived=${r.derived}`);
    out(p.description || "");
    out(`Ready: ${r.ready}`);
    for (const c of r.checks) {
      const mark = c.kind === "checkpoint" ? model.matrixGlyph(c.status) : (c.ok ? "✓" : "✗");
      out(`  ${mark} ${c.kind} ${c.label} (${c.status})`);
    }
    if (r.reasons.length) { out("Reasons:"); for (const x of r.reasons) out(`  - ${x}`); }
    return r.ready ? 0 : 1;
  }
  if (sub === "start") {
    const p = findPhase(delivery, rest[0]);
    if (["COMPLETED", "CANCELLED"].includes(p.status)) die(`Cannot start a ${p.status} phase. Create the next delivery increment instead.`, 1);
    const inflight = delivery.phases.filter((x) => x.status === "IN_PROGRESS" && x.id !== p.id);
    for (const o of inflight) o.status = "PLANNED";
    p.status = "IN_PROGRESS";
    p.startDate = p.startDate || model.nowIso().slice(0, 10);
    ident.currentDeliveryPhaseId = p.id;
    ident.updatedAt = model.nowIso();
    appendHistory(delivery, "delivery-start", p.id, { phaseId: p.id });
    delivery.updatedAt = model.nowIso();
    saveProject({ ident, delivery });
    out(`Started ${p.id} ${p.name}`);
    return 0;
  }
  if (sub === "complete") {
    const p = findPhase(delivery, rest[0]);
    if (!["IN_PROGRESS", "READY"].includes(p.status)) die("Start the phase before completing it.", 1);
    const r = readinessFor(p);
    if (!r.ready) {
      out(`${p.id} is not ready:`);
      for (const x of r.reasons) out(`  ✗ ${x}`);
      die("Refusing to complete. Pass required checkpoints or waive them by name.", 1);
    }
    p.status = "COMPLETED";
    p.completedAt = model.nowIso();
    appendHistory(delivery, "delivery-complete", p.id, { phaseId: p.id });
    const next = delivery.phases.filter((x) => x.order > p.order && !["COMPLETED", "CANCELLED"].includes(x.status)).sort((a, b) => a.order - b.order)[0];
    if (next && next.status === "PLANNED") next.status = "READY";
    delivery.updatedAt = model.nowIso();
    ident.updatedAt = model.nowIso();
    ident.currentDeliveryPhaseId = next?.id || null;
    saveProject({ ident, delivery });
    out(`Completed ${p.id}${next ? ` · next ${next.id}` : ""}`);
    return 0;
  }
  if (sub === "cancel") {
    const p = findPhase(delivery, rest[0]);
    const reason = valueOf(args, "--reason");
    if (!reason) die("delivery cancel requires --reason", 2);
    if (p.status === "COMPLETED") die("Cannot cancel a COMPLETED phase.", 1);
    p.status = "CANCELLED";
    p.notes = reason;
    appendHistory(delivery, "delivery-cancel", `${p.id} ${reason}`, { phaseId: p.id, by: valueOf(args, "--by") || actor(ROOT).git || actor(ROOT).os });
    delivery.updatedAt = model.nowIso();
    if (ident.currentDeliveryPhaseId === p.id) ident.currentDeliveryPhaseId = null;
    ident.updatedAt = model.nowIso();
    saveProject({ ident, delivery });
    out(`Cancelled ${p.id}. Cancellation does not satisfy dependents.`);
    return 0;
  }
  if (sub === "objective") {
    const p = findPhase(delivery, rest[0]);
    const oid = rest[1];
    const status = valueOf(rest, "--status") || rest[2];
    if (!model.OBJECTIVE_STATUSES.includes(status)) die(`--status must be ${model.OBJECTIVE_STATUSES.join("|")}`, 2);
    const obj = (p.objectives || []).find((o) => o.id === oid);
    if (!obj) die(`Unknown objective ${oid} on ${p.id}`, 1);
    obj.status = status;
    appendHistory(delivery, "objective", `${p.id} ${oid} ${status}`, { phaseId: p.id });
    delivery.updatedAt = model.nowIso();
    saveProject({ delivery });
    out(`${oid} → ${status}`);
    return 0;
  }
  if (sub === "catalog") {
    const action = rest[0];
    if (action === "export") {
      const catalog = model.exportCatalog(delivery);
      if (jsonMode(args) || true) out(JSON.stringify(catalog, null, 2));
      return 0;
    }
    const file = valueOf(args, "--file");
    if (!file) die("delivery catalog preview|apply requires --file <repo-relative.json>", 2);
    const { path } = repoFile(file, "Catalog");
    let catalog;
    try { catalog = JSON.parse(readFileSync(path, "utf8")); }
    catch (e) { die(`Catalog is not valid JSON: ${e.message}`, 1); }
    const preview = model.previewCatalog(delivery, catalog);
    if (action === "preview") {
      if (jsonMode(args)) { out(JSON.stringify(preview, null, 2)); return preview.ok ? 0 : 1; }
      out(preview.ok ? "Catalog is valid." : "Catalog is not valid:");
      for (const e of preview.errors) out(`  ✗ ${e}`);
      out("Changes:");
      for (const c of preview.changes) out(`  ${c.kind}  ${c.id || c.phaseId || ""} ${c.slug || c.type || (c.fields || []).join(",")}`);
      return preview.ok ? 0 : 1;
    }
    if (action === "apply") {
      if (!preview.ok) die(`Refusing to apply:\n${preview.errors.map((e) => `  ✗ ${e}`).join("\n")}`, 1);
      const applied = model.applyCatalog(delivery, catalog);
      validateState(ident, applied.delivery, ideas);
      saveProject({ delivery: applied.delivery });
      out(`Applied catalog from ${file}`);
      for (const c of applied.preview.changes.filter((x) => x.kind !== "keep-phase")) {
        out(`  ${c.kind}  ${c.id || c.phaseId || ""} ${c.slug || c.type || ""}`);
      }
      return 0;
    }
    die("Usage: project.mjs delivery catalog export|preview|apply --file FILE", 2);
  }
  if (sub === "phase") {
    const action = rest[0];
    if (action === "add") {
      const name = valueOf(args, "--name");
      const slug = valueOf(args, "--slug");
      if (!name || !slug) die("delivery phase add requires --name and --slug", 2);
      if (delivery.phases.some((p) => p.slug === slug)) die(`Slug ${slug} already exists.`, 1);
      const after = valueOf(args, "--after");
      const predecessor = after ? findPhase(delivery, after) : [...delivery.phases].sort((a, b) => a.order - b.order).at(-1);
      const phase = {
        id: model.nextId(delivery.phases, "PHASE"),
        slug, name,
        description: valueOf(args, "--description") || "",
        status: "PLANNED",
        order: predecessor ? predecessor.order + 1 : 0,
        owner: valueOf(args, "--owner") || null,
        startDate: null,
        targetDate: valueOf(args, "--target-date") || null,
        completedAt: null,
        objectives: [],
        entryCriteria: predecessor ? [`${predecessor.name} completed or waived`] : ["Project identity exists"],
        exitCriteria: [],
        featureIds: [], requirementIds: [], taskIds: [], riskIds: [], evidence: [],
        dependencies: predecessor ? [predecessor.id] : [],
        releaseId: null,
      };
      for (const p of delivery.phases) if (p.order >= phase.order && p.id !== phase.id) p.order += 1;
      delivery.phases.push(phase);
      const types = csv(valueOf(args, "--checkpoints"));
      for (const type of types) delivery.checkpoints.push(model.newCheckpoint(delivery, phase, type));
      appendHistory(delivery, "phase-add", phase.id, { phaseId: phase.id });
      delivery.updatedAt = model.nowIso();
      validateState(ident, delivery, ideas);
      saveProject({ delivery });
      out(`Added ${phase.id} ${phase.name}`);
      return 0;
    }
    if (action === "set") {
      const p = findPhase(delivery, rest[1]);
      if (valueOf(args, "--status")) die("Phase status changes go through delivery start|complete, not phase set.", 2);
      if (valueOf(args, "--name")) p.name = valueOf(args, "--name");
      if (valueOf(args, "--description")) p.description = valueOf(args, "--description");
      if (valueOf(args, "--owner") !== null && args.includes("--owner")) p.owner = valueOf(args, "--owner");
      if (valueOf(args, "--target-date") !== null && args.includes("--target-date")) p.targetDate = valueOf(args, "--target-date");
      appendHistory(delivery, "phase-set", p.id, { phaseId: p.id });
      delivery.updatedAt = model.nowIso();
      saveProject({ delivery });
      out(`Updated ${p.id}`);
      return 0;
    }
    die("Usage: project.mjs delivery phase add|set", 2);
  }
  die("Usage: project.mjs delivery list|show|start|complete|cancel|objective|catalog|phase", 2);
};

CMDS.checkpoint = function checkpoint(args) {
  const { ident, delivery } = requireAdopted();
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === "list") {
    const phase = valueOf(args, "--phase");
    const rows = delivery.checkpoints.filter((c) => !phase || c.phaseId === phase || findPhase(delivery, phase).id === c.phaseId);
    if (jsonMode(args)) { out(JSON.stringify(rows, null, 2)); return 0; }
    for (const c of rows) out(`${c.id.padEnd(8)} ${c.status.padEnd(16)} ${c.phaseId}  ${model.matrixGlyph(c.status)} ${c.name}`);
    return 0;
  }
  if (sub === "show") {
    const c = findChk(delivery, rest[0]);
    if (jsonMode(args)) { out(JSON.stringify(c, null, 2)); return 0; }
    out(`${c.id}  ${c.name}  ${c.status}  mode=${c.verificationMode}`);
    out(c.description || "");
    out(`Phase ${c.phaseId}  required=${c.required !== false}  evidenceRequired=${c.evidenceRequired !== false}`);
    for (const e of c.evidence || []) out(`  evidence  ${e.id || ""} ${e.ref || e.summary || JSON.stringify(e)}`);
    out("History:");
    for (const h of c.history || []) out(`  ${(h.at || "").slice(0, 10)}  ${h.status}  ${h.by || ""}`);
    return 0;
  }
  if (sub === "add") {
    const phase = findPhase(delivery, valueOf(args, "--phase"));
    const type = valueOf(args, "--type");
    if (!type) die("--type is required", 2);
    const meta = model.CHECKPOINT_TYPES.find((t) => t.type === type) || { type, name: type };
    const chk = {
      id: model.nextId(delivery.checkpoints, "CHK"),
      name: valueOf(args, "--name") || meta.name,
      description: valueOf(args, "--description") || "",
      type, phaseId: phase.id, status: "NOT_STARTED",
      required: !flag(args, "--optional"),
      owner: valueOf(args, "--owner"),
      evidence: [], featureIds: [], requirementIds: [], riskIds: [], blockers: [],
      verificationMode: model.AUTOMATED_VERIFY[type] ? "HYBRID" : "MANUAL",
      evidenceRequired: ident.config?.evidenceRequiredDefault !== false,
      history: [{ at: model.nowIso(), status: "NOT_STARTED", by: "cli" }],
    };
    delivery.checkpoints.push(chk);
    appendHistory(delivery, "checkpoint-add", chk.id, { checkpointId: chk.id, phaseId: phase.id });
    saveProject({ delivery });
    out(`Added ${chk.id} ${chk.name} on ${phase.id}`);
    return 0;
  }
  if (sub === "set") {
    const c = findChk(delivery, rest[0]);
    if (valueOf(args, "--status")) die("Checkpoint status changes go through pass|fail|waive|verify, not set.", 2);
    if (args.includes("--name")) c.name = valueOf(args, "--name");
    if (args.includes("--description")) c.description = valueOf(args, "--description");
    if (args.includes("--owner")) c.owner = valueOf(args, "--owner");
    if (args.includes("--due")) c.dueDate = valueOf(args, "--due");
    if (args.includes("--notes")) c.notes = valueOf(args, "--notes");
    appendHistory(delivery, "checkpoint-set", c.id, { checkpointId: c.id });
    delivery.updatedAt = model.nowIso();
    saveProject({ delivery });
    out(`Updated ${c.id}`);
    return 0;
  }
  if (sub === "verify") {
    const c = findChk(delivery, rest[0]);
    const spec = model.AUTOMATED_VERIFY[c.type];
    if (!spec || c.verificationMode === "MANUAL") {
      out(`${c.id} is ${c.verificationMode}. No automated verifier mapped. Record evidence and pass/fail by hand.`);
      return 1;
    }
    const script = join(TOOLS_DIR, spec.tool);
    let result;
    const beforeDigest = inputDigest();
    try {
      const stdout = execFileSync(process.execPath, [script, ...spec.args], {
        cwd: ROOT, env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
        encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"],
      });
      result = { ok: true, exit: 0, stdout };
    } catch (e) {
      result = { ok: false, exit: e.status ?? 1, stdout: String(e.stdout || ""), stderr: String(e.stderr || "") };
    }
    let parsed = null;
    try { parsed = JSON.parse(String(result.stdout || "").trim() || "null"); } catch { /* text */ }
    const ev = {
      id: model.nextId(c.evidence || [], "EV"),
      kind: "tool",
      ref: `${spec.tool} ${spec.args.join(" ")}`,
      summary: spec.summary,
      ok: result.ok && parsed?.ok === true && parsed?.skipped !== true && parsed?.schema === "finding-report/1" && parsed?.counts?.block === 0 && inputDigest() === beforeDigest,
      skipped: parsed?.skipped === true,
      inputDigest: beforeDigest,
      valid: true,
      resultSummary: parsed?.summary || String(result.stderr || result.stdout).slice(0, 1000),
      exit: result.exit,
      at: model.nowIso(),
    };
    c.evidence = c.evidence || [];
    c.evidence.push(ev);
    if (c.status === "NOT_STARTED") c.status = "IN_PROGRESS";
    setCheckpointStatus(c, ev.ok ? "READY_FOR_REVIEW" : "FAILED", { detail: `verify exit ${ev.exit}`, evidence: null });
    appendHistory(delivery, "checkpoint-verify", `${c.id} exit=${ev.exit}`, { checkpointId: c.id });
    saveProject({ delivery });
    out(`${c.id} verify ${ev.ok ? "ok" : "FAIL"} (exit ${ev.exit}) → ${c.status}`);
    out(`Evidence ${ev.id} ${ev.ref}`);
    return ev.ok ? 0 : 1;
  }
  if (sub === "pass" || sub === "fail" || sub === "waive") {
    const c = findChk(delivery, rest[0]);
    const evidenceRef = valueOf(args, "--evidence");
    const reviewer = valueOf(args, "--reviewer") || valueOf(args, "--by");
    const note = valueOf(args, "--note") || valueOf(args, "--reason");
    if (sub === "waive" && !note) die("waive requires --reason", 2);
    if (sub === "waive" && !reviewer) die("waive requires --by or --reviewer — a waiver is a named exception.", 2);
    const status = sub === "pass" ? "PASSED" : sub === "fail" ? "FAILED" : "WAIVED";
    const evidence = evidenceRef ? { id: model.nextId(c.evidence || [], "EV"), ...manualEvidence(evidenceRef, reviewer, note) } : null;
    const candidate = validateEvidence([{ ...c, evidence: [...(c.evidence || []), ...(evidence ? [evidence] : [])] }])[0];
    if (sub === "pass" && !model.checkpointEvidenceReady(candidate)) {
      die("This checkpoint requires successful, current evidence. Supply --evidence <existing-repo-file> or run a supported verifier successfully. Failed, skipped or stale results do not qualify.", 1);
    }
    setCheckpointStatus(c, status, { by: reviewer, detail: note, evidence });
    c.reviewer = reviewer || c.reviewer;
    c.notes = note || c.notes;
    appendHistory(delivery, `checkpoint-${sub}`, c.id, { checkpointId: c.id });
    ident.currentCheckpointId = c.id;
    ident.updatedAt = model.nowIso();
    saveProject({ ident, delivery });
    out(`${c.id} ${status}`);
    return 0;
  }
  die("Usage: project.mjs checkpoint list|show|add|set|verify|pass|fail|waive", 2);
};

CMDS.idea = function idea(args) {
  const { ident, delivery } = requireAdopted();
  const ideas = loadIdeas();
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === "add") {
    const title = valueOf(args, "--title");
    if (!title) die("idea add requires --title", 2);
    const item = {
      id: model.nextId(ideas.ideas, "IDEA"),
      title,
      description: valueOf(args, "--description") || "",
      reason: valueOf(args, "--reason") || "",
      value: valueOf(args, "--value") || "UNKNOWN",
      priority: valueOf(args, "--priority") || "MED",
      effort: valueOf(args, "--effort") || "UNKNOWN",
      risk: valueOf(args, "--risk") || "UNKNOWN",
      status: "CAPTURED",
      createdAt: model.nowIso(),
      updatedAt: model.nowIso(),
      author: valueOf(args, "--author") || actor(ROOT).git || actor(ROOT).os,
      requirementIds: csv(valueOf(args, "--requirement")),
      featureIds: csv(valueOf(args, "--feature")),
      phaseId: valueOf(args, "--phase"),
      checkpointIds: csv(valueOf(args, "--checkpoint")),
      taskIds: [],
      evidence: [],
      decision: null,
      decisionId: valueOf(args, "--decision"),
      implementationRefs: [],
      testRefs: [],
      releaseId: null,
      history: [{ at: model.nowIso(), status: "CAPTURED", by: "cli" }],
    };
    if (item.phaseId) findPhase(delivery, item.phaseId);
    if (item.phaseId) item.phaseId = findPhase(delivery, item.phaseId).id;
    ideas.ideas.push(item);
    validateState(ident, delivery, ideas);
    ideas.updatedAt = model.nowIso();
    saveProject({ ideas });
    out(`${item.id} captured: ${item.title}`);
    return 0;
  }
  if (sub === "list") {
    if (jsonMode(args)) { out(JSON.stringify(ideas.ideas, null, 2)); return 0; }
    for (const i of ideas.ideas) out(`${i.id.padEnd(9)} ${i.status.padEnd(14)} ${(i.value || "").padEnd(8)} ${i.title}`);
    return 0;
  }
  if (sub === "show") {
    const i = findIdea(ideas, rest[0]);
    const snapFeatures = model.projectFeatures(tryRead(".cursor/cache/feature-map.json") || { features: {} }, delivery);
    const trace = model.ideaTrace(i, { features: snapFeatures, phases: delivery.phases, checkpoints: delivery.checkpoints });
    if (jsonMode(args)) { out(JSON.stringify({ idea: i, trace }, null, 2)); return 0; }
    out(`${i.id}  ${i.title}`);
    out(`Status   ${i.status}`);
    out(`Value    ${i.value}  priority ${i.priority}  effort ${i.effort}`);
    if (trace.phase) out(`Delivery ${trace.phase.id} ${trace.phase.name}`);
    if (trace.decision) {
      const d = trace.decision;
      out(`Decision ${typeof d === "string" ? d : [d.verdict, d.reason].filter(Boolean).join(" — ")}`);
    }
    if (trace.features.length) out(`Features ${trace.features.map((f) => f.id).join(", ")}`);
    if (trace.requirements.length) out(`Reqs     ${trace.requirements.join(", ")}`);
    if (trace.checkpoints.length) out(`Checks   ${trace.checkpoints.map((c) => `${c.name} ${c.status}`).join("; ")}`);
    if (trace.release) out(`Release  ${trace.release}`);
    return 0;
  }
  const verbs = { evaluate: "EVALUATING", approve: "APPROVED", reject: "REJECTED", park: "PARKED", specify: "SPECIFIED", implement: "IMPLEMENTING", verify: "VERIFIED", release: "RELEASED" };
  if (verbs[sub]) {
    const i = findIdea(ideas, rest[0]);
    const to = verbs[sub];
    if (!model.canTransitionIdea(i.status, to)) {
      die(`Cannot move ${i.id} from ${i.status} to ${to}. Allowed: ${(model.IDEA_TRANSITIONS[i.status] || []).join(", ") || "none"}`, 1);
    }
    const requestedPhase = sub === "implement" ? valueOf(args, "--phase") || i.phaseId || ident.currentDeliveryPhaseId : null;
    const implementationPhase = sub === "implement" ? findPhase(delivery, requestedPhase).id : null;
    if (sub === "implement" && !valueOf(args, "--feature") && !(i.featureIds || []).length) die("Implementation requires a linked feature (--feature <id>).", 1);
    if (sub === "verify") {
      const ref = valueOf(args, "--evidence");
      if (!ref || !(i.featureIds || []).length) die("Idea verification requires a linked feature and --evidence <existing-repo-file> documenting the verification result.", 1);
      i.evidence = [...(i.evidence || []), { id: model.nextId(i.evidence || [], "EV"), ...manualEvidence(ref, valueOf(args, "--reviewer"), valueOf(args, "--note")) }];
    }
    if (sub === "release") {
      const releaseId = valueOf(args, "--release");
      const record = listJson("lifecycle/releases").find((r) => r.version === releaseId || r.id === releaseId);
      if (!record?.signature) die("Release requires --release <version> referencing a signed lifecycle release.", 1);
      const result = execFileSync(process.execPath, [join(TOOLS_DIR, "release-evidence.mjs"), "verify", releaseId, "--require-signed"], { cwd: ROOT, env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT }, encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      void result;
      i.releaseId = releaseId;
      delivery.featureBindings = (delivery.featureBindings || []).map((b) => (
        b.ideaId === i.id ? { ...b, status: "RELEASED", releaseId } : b
      ));
    }
    i.status = to;
    i.updatedAt = model.nowIso();
    i.history = i.history || [];
    i.history.push({ at: i.updatedAt, status: to, by: valueOf(args, "--by") || "cli", detail: valueOf(args, "--note") });
    if (sub === "approve") {
      i.decision = { verdict: "Approved", at: i.updatedAt, by: valueOf(args, "--by"), reason: valueOf(args, "--reason") || i.reason };
    }
    if (sub === "reject") {
      i.decision = { verdict: "Rejected", at: i.updatedAt, by: valueOf(args, "--by"), reason: valueOf(args, "--reason") };
    }
    if (sub === "implement") {
      const fid = valueOf(args, "--feature");
      if (fid && !(i.featureIds || []).includes(fid)) i.featureIds = [...(i.featureIds || []), fid];
      const phaseId = implementationPhase;
      i.phaseId = phaseId;
      for (const tid of csv(valueOf(args, "--task"))) {
        if (!(i.taskIds || []).includes(tid)) i.taskIds = [...(i.taskIds || []), tid];
      }
      for (const ref of csv(valueOf(args, "--code"))) {
        if (!(i.implementationRefs || []).includes(ref)) i.implementationRefs = [...(i.implementationRefs || []), ref];
      }
      for (const ref of csv(valueOf(args, "--test"))) {
        if (!(i.testRefs || []).includes(ref)) i.testRefs = [...(i.testRefs || []), ref];
      }
      if (fid) {
        delivery.featureBindings = delivery.featureBindings || [];
        if (!delivery.featureBindings.some((b) => b.featureId === fid && b.ideaId === i.id)) {
          delivery.featureBindings.push({ featureId: fid, ideaId: i.id, phaseId, status: "IN_PROGRESS" });
        }
      }
    }
    if (valueOf(args, "--decision")) i.decisionId = valueOf(args, "--decision");
    validateState(ident, delivery, ideas);
    ideas.updatedAt = model.nowIso();
    saveProject((sub === "implement" || sub === "release") ? { ident, delivery, ideas } : { ideas });
    out(`${i.id} → ${to}`);
    return 0;
  }
  die("Usage: project.mjs idea add|list|show|evaluate|approve|reject|park|specify|implement|verify|release", 2);
};

CMDS.recommend = async function recommend(args) {
  const { ident } = requireAdopted();
  const snap = await assemble();
  const sub = args[0] || "list";
  if (sub === "list") {
    if (jsonMode(args)) { out(JSON.stringify(snap.recommendations, null, 2)); return 0; }
    for (const r of snap.recommendations) {
      out(`${r.id.padEnd(9)} ${r.category.padEnd(12)} ${r.rule.padEnd(32)} ${r.what}`);
    }
    if (!snap.recommendations.length) out("No open recommendations.");
    return 0;
  }
  if (sub === "show") {
    const r = snap.recommendations.find((x) => x.id === args[1]) || (await assemble()).recommendations.find((x) => x.rule === args[1]);
    if (!r) die(`Unknown recommendation ${args[1]}`, 1);
    if (jsonMode(args)) { out(JSON.stringify(r, null, 2)); return 0; }
    out(`${r.id}  [${r.category}]  ${r.rule}  (${r.source})`);
    out(`WHAT   ${r.what}`);
    out(`WHY    ${r.why}`);
    out(`IMPACT ${r.impact}  EFFORT ${r.effort}  RISK ${r.risk}`);
    out(`NEXT   ${r.nextAction}`);
    for (const e of r.evidence || []) out(`  evidence  ${e.text || e.ref || JSON.stringify(e)}`);
    return 0;
  }
  if (sub === "accept" || sub === "dismiss") {
    const id = args[1];
    if (!id) die("recommend accept|dismiss requires an id (REC-001) or a rule name", 2);
    const recommendation = snap.recommendations.find((r) => r.id === id);
    const matches = recommendation ? [recommendation] : snap.recommendations.filter((r) => r.rule === id);
    if (!matches.length) die(`Unknown current recommendation ${id}. List recommendations and use its stable id.`, 1);
    ident.recommendationDispositions ||= {};
    for (const match of matches) ident.recommendationDispositions[match.id] = {
      status: sub === "accept" ? "ACCEPTED" : "DISMISSED",
      at: model.nowIso(),
      note: valueOf(args, "--note"),
    };
    ident.updatedAt = model.nowIso();
    saveProject({ ident });
    out(`${id} ${sub === "accept" ? "ACCEPTED" : "DISMISSED"}`);
    return 0;
  }
  die("Usage: project.mjs recommend list|show|accept|dismiss", 2);
};

CMDS.roadmap = function roadmapCmd(args) {
  const { delivery } = requireAdopted();
  const ideas = loadIdeas();
  const sub = args[0] || "show";
  if (sub === "show") {
    const body = model.roadmap({
      phases: delivery.phases,
      ideas: ideas.ideas,
      features: model.projectFeatures({ features: {} }, delivery),
      releases: listJson("lifecycle/releases"),
      milestones: delivery.milestones || [],
      featureBindings: delivery.featureBindings || [],
    });
    if (jsonMode(args)) { out(JSON.stringify(body, null, 2)); return 0; }
    out("NOW");
    for (const p of body.now) out(`  ${p.id}  ${p.name}  ${p.progress.label}`);
    out("NEXT");
    for (const p of body.next) out(`  ${p.id}  ${p.name}  ${p.status}`);
    out("MILESTONES");
    for (const m of body.milestones || []) out(`  ${m.id}  ${m.date || ""}  ${m.title}  ${m.phaseId || ""}`);
    out("RELEASES");
    for (const r of body.releases || []) out(`  ${r.id}  ${r.signed ? "signed" : "unsigned"}  ideas ${(r.ideas || []).join(",") || "—"}`);
    out("FEATURES");
    for (const f of body.features || []) out(`  ${f.id}  ${f.status}  ${(f.phaseIds || []).join(",")}`);
    out("PLANNED IDEAS");
    for (const i of body.planned) out(`  ${i.id}  ${i.title}  ${i.status}`);
    out("FUTURE");
    for (const i of body.future) out(`  ${i.id}  ${i.title}`);
    return 0;
  }
  if (sub === "add") {
    const ideaId = valueOf(args, "--idea");
    const phaseId = valueOf(args, "--phase");
    if (!ideaId || !phaseId) die("roadmap add requires --idea and --phase", 2);
    const i = findIdea(ideas, ideaId);
    i.phaseId = findPhase(delivery, phaseId).id;
    i.updatedAt = model.nowIso();
    i.history ||= [];
    i.history.push({ at: i.updatedAt, event: "scheduled", detail: i.phaseId, by: actor(ROOT).git || actor(ROOT).os });
    ideas.updatedAt = i.updatedAt;
    saveProject({ ideas });
    out(`${i.id} scheduled on ${phaseId}`);
    return 0;
  }
  if (sub === "milestone") {
    const title = valueOf(args, "--title");
    const date = valueOf(args, "--date");
    if (!title || !date) die("roadmap milestone requires --title and --date", 2);
    const phaseId = valueOf(args, "--phase") ? findPhase(delivery, valueOf(args, "--phase")).id : null;
    delivery.milestones = delivery.milestones || [];
    const ms = {
      id: model.nextId(delivery.milestones, "MS"),
      title,
      date,
      phaseId,
      featureIds: csv(valueOf(args, "--feature")),
      releaseId: valueOf(args, "--release"),
      status: "PLANNED",
    };
    delivery.milestones.push(ms);
    appendHistory(delivery, "milestone-add", ms.id, { phaseId });
    delivery.updatedAt = model.nowIso();
    saveProject({ delivery });
    out(`${ms.id} ${ms.title} on ${date}`);
    return 0;
  }
  if (sub === "feature") {
    const fid = valueOf(args, "--feature");
    const phaseId = valueOf(args, "--phase");
    if (!fid || !phaseId) die("roadmap feature requires --feature and --phase", 2);
    const phase = findPhase(delivery, phaseId);
    delivery.featureBindings = delivery.featureBindings || [];
    if (!delivery.featureBindings.some((b) => b.featureId === fid && b.phaseId === phase.id)) {
      delivery.featureBindings.push({ featureId: fid, phaseId: phase.id, status: "PLANNED" });
    }
    delivery.updatedAt = model.nowIso();
    saveProject({ delivery });
    out(`${fid} scheduled on ${phase.id}`);
    return 0;
  }
  die("Usage: project.mjs roadmap show|add|milestone|feature", 2);
};

CMDS.identity = function identityCmd(args) {
  const { ident } = requireAdopted();
  const sub = args[0] || "show";
  if (sub === "show") {
    if (jsonMode(args)) { out(JSON.stringify(ident.identity, null, 2)); return 0; }
    out(`${ident.id}  ${ident.name}`);
    for (const [k, v] of Object.entries(ident.identity || {})) {
      const value = Array.isArray(v?.value) ? v.value.join(", ") : (v?.value ?? "—");
      out(`  ${k.padEnd(16)} ${(v?.confidence || "unknown").padEnd(10)} ${value || "—"}`);
    }
    return 0;
  }
  if (sub === "confirm" || sub === "reject") {
    const detectionId = valueOf(args, "--detection");
    if (detectionId) {
      const scanned = ident.detections?.length ? ident : { detections: model.discover(ROOT).detections };
      const detection = (scanned.detections || ident.detections || []).find((d) => d.id === detectionId);
      if (!detection) die(`Unknown detection ${detectionId}. Run scan --json and use a DET- id.`, 1);
      const next = model.applyDetection(ident, detection, sub);
      saveProject({ ident: next });
      out(`${detection.field} ${sub === "confirm" ? "confirmed" : "rejected"} via ${detectionId}`);
      return 0;
    }
    const fieldName = valueOf(args, "--field");
    if (!fieldName) die("identity confirm|reject requires --field or --detection", 2);
    ident.identity = ident.identity || {};
    if (sub === "reject") {
      ident.identity[fieldName] = model.field(null, "unknown");
    } else {
      let raw = valueOf(args, "--value");
      if (raw == null) {
        const current = ident.identity[fieldName];
        if (current?.confidence === "detected" && current.value != null) raw = Array.isArray(current.value) ? current.value.join(",") : String(current.value);
        else die("identity confirm requires --value, a detected field, or --detection", 2);
      }
      const arrays = new Set(["languages", "frameworks", "databases", "infrastructure", "stack"]);
      const value = arrays.has(fieldName) ? csv(raw) : raw;
      ident.identity[fieldName] = model.field(value, "confirmed");
      if (fieldName === "name") ident.name = Array.isArray(value) ? value[0] : value;
      if (fieldName === "owner") ident.owner = Array.isArray(value) ? value[0] : value;
      if (fieldName === "description") ident.description = Array.isArray(value) ? value.join(", ") : value;
    }
    ident.updatedAt = model.nowIso();
    saveProject({ ident });
    out(`${fieldName} ${sub === "confirm" ? "confirmed" : "rejected"}`);
    return 0;
  }
  die("Usage: project.mjs identity show|confirm|reject", 2);
};

CMDS.trace = async function traceCmd(args) {
  const id = args.find((a) => !a.startsWith("--"));
  if (!id) die("Usage: project.mjs trace ID [--json]", 2);
  const snap = await assemble();
  if (!snap.adopted) die(snap.hint, 1);
  const traced = model.traceQuery(id, {
    ideas: snap.ideas,
    features: snap.features,
    phases: snap.delivery.phases,
    checkpoints: snap.delivery.checkpoints,
    requirements: snap.requirements || [],
    risks: snap.risks?.items || [],
    releases: (snap.graph?.nodes || []).filter((n) => n.kind === "release"),
    decisions: snap.decisions || [],
    requirementIdsKnown: (snap.traceability?.total || 0) > 0,
  });
  if (jsonMode(args)) { out(JSON.stringify(traced, null, 2)); return traced.complete ? 0 : 1; }
  out(`${traced.id}  (${traced.kind || "unknown"})`);
  if (traced.reason) out(traced.reason);
  for (const h of traced.hops) {
    const mark = h.status === "present" ? "✓" : "✗";
    out(`  ${mark} ${h.kind.padEnd(22)} ${h.from} → ${h.to || "(missing)"}  [${h.source}]${h.note ? `  ${h.note}` : ""}`);
  }
  if (traced.missing.length) {
    out("Missing:");
    for (const m of traced.missing) out(`  - ${m.kind} ${m.from} → ${m.to || ""} ${m.note || ""}`.trim());
  }
  return traced.complete ? 0 : 1;
};

CMDS.check = async function checkCmd(args) {
  const snap = await assemble();
  if (!snap.adopted) die(snap.hint, 1);
  const errors = snap.relationErrors || [];
  const contract = (snap.contract || []).filter((f) => f.severity === "block");
  if (jsonMode(args)) {
    out(JSON.stringify({ ok: errors.length === 0 && contract.length === 0, errors, contract: snap.contract || [] }, null, 2));
    return errors.length || contract.length ? 1 : 0;
  }
  if (!errors.length && !contract.length) { out("Project relations hold."); return 0; }
  if (errors.length) {
    out("Relation errors:");
    for (const e of errors) out(`  ✗ ${e}`);
  }
  if ((snap.contract || []).length) {
    out("Contract:");
    for (const f of snap.contract) out(`  ${f.severity === "block" ? "✗" : "·"} ${f.code}  ${f.message}`);
  }
  return errors.length || contract.length ? 1 : 0;
};

function csv(s) {
  if (!s) return [];
  return String(s).split(",").map((x) => x.trim()).filter(Boolean);
}

function usage() {
  out(`Usage:
  node .cursor/tools/project.mjs init [--name N] [--existing] [--owner N]
  node .cursor/tools/project.mjs status|scan|snapshot|map|check [--json]
  node .cursor/tools/project.mjs dashboard [--port 7777]
  node .cursor/tools/project.mjs identity show|confirm|reject
  node .cursor/tools/project.mjs delivery list|show|start|complete|cancel|objective
  node .cursor/tools/project.mjs delivery catalog export|preview|apply --file FILE
  node .cursor/tools/project.mjs delivery phase add|set
  node .cursor/tools/project.mjs checkpoint list|show|add|set|verify|pass|fail|waive
  node .cursor/tools/project.mjs idea add|list|show|evaluate|approve|reject|park|specify|implement|verify|release
  node .cursor/tools/project.mjs trace ID
  node .cursor/tools/project.mjs recommend list|show|accept|dismiss
  node .cursor/tools/project.mjs roadmap show|add|milestone|feature

project/ is canonical. The dashboard is a projection. Multi-file writes are journaled.
Exit 0 ok, 1 not ready, 2 usage.`);
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = argv.slice(1);
  if (!cmd || cmd === "--help" || cmd === "-h") { usage(); process.exit(cmd ? 0 : 2); }
  const fn = CMDS[cmd];
  if (!fn) { usage(); process.exit(2); }
  let ret;
  try { ret = await fn(args); }
  catch (e) { process.stderr.write(`${e.message}\n`); process.exit(1); }
  if (ret && typeof ret.then === "function") {
    return ret.then((c) => { if (c !== undefined) process.exit(c); }).catch((e) => {
      process.stderr.write(String(e.stack || e) + "\n");
      process.exit(1);
    });
  }
  if (ret !== undefined) process.exit(ret);
}

function invokedAsCli() {
  if (!process.argv[1]) return false;
  const norm = (p) => String(p || "")
    .replace(/\\/g, "/")
    .replace(/^file:\/\//i, "")
    .replace(/^\/([A-Za-z]:)/, "$1")
    .toLowerCase();
  try {
    const a = norm(import.meta.url);
    const b = norm(pathToFileURL(process.argv[1]).href);
    return a === b || a.endsWith(b) || b.endsWith(a);
  } catch {
    return true;
  }
}
if (invokedAsCli() || process.env.PROJECT_FORCE_CLI) main();

export { loadIdentity, loadDelivery, loadIdeas, requireAdopted, saveProject };
