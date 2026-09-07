#!/usr/bin/env node
/**
 * lifecycle.mjs — the product lifecycle state machine.
 *
 * WHY THIS EXISTS
 *
 * `01-specify-rules.mdc` gates the FEATURE pipeline. What it cannot answer is
 * the product-level question: has anybody decided what this system IS, and did a
 * human agree to it, before the first endpoint got generated? Six phases, six
 * gates, one state file — so the answer is a fact on disk rather than a
 * recollection in a chat log.
 *
 * THREE CONSENTS, ACTUALLY ENFORCED
 *
 *   mechanical  do the required artifacts EXIST and have real content?
 *               Recomputed at approve time, never trusted from an earlier run.
 *   judgement   are they any GOOD? Recorded by /lifecycle-gate via `record-gate`,
 *               stamped with the gate definition's own hash.
 *   human       `approve --by "<name>"`. Nobody else may grant it.
 *
 * A phase reaches APPROVED only when all three are present and still valid. The
 * first version of this file documented that rule and enforced two thirds of it,
 * which is worse than documenting nothing.
 *
 * STATUS IS DERIVED, NOT STORED
 *
 * The three consents are evidence and get written down. `status` is computed
 * from them on every read, because a stored STALE would itself need a flag
 * saying whether it is still true. Change an approved artifact and the phase is
 * STALE on the very next command — no sweeper, no cache, nothing to invalidate.
 *
 * Usage:
 *   node .cursor/tools/lifecycle.mjs init [--name "X"] [--existing]
 *   node .cursor/tools/lifecycle.mjs status [--json]
 *   node .cursor/tools/lifecycle.mjs check [PHASE] [--json]
 *   node .cursor/tools/lifecycle.mjs record-gate PHASE --verdict GO|NO-GO --by "<reviewer>" [--criteria "7/7"] [--note "..."]
 *   node .cursor/tools/lifecycle.mjs approve PHASE --by "<name>" [--note "..."]
 *   node .cursor/tools/lifecycle.mjs advance
 *   node .cursor/tools/lifecycle.mjs rollback PHASE --reason "..."
 *   node .cursor/tools/lifecycle.mjs override PHASE --reason "..." --risk LOW|MED|HIGH --by "<name>" --expires <days>
 *   node .cursor/tools/lifecycle.mjs gate [PHASE]
 *
 * Exit codes:  0 = ok   1 = gate not satisfied / refused   2 = usage
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

/**
 * The root is mutable because this module is imported by hooks as well as run as
 * a CLI, and the two learn the workspace differently: Claude Code sets
 * CLAUDE_PROJECT_DIR, Cursor passes workspace_roots in the hook payload and sets
 * nothing. A hook calls setRoot() with whatever its host told it before asking
 * any question about state — without that, guard-phase under Cursor reads the
 * wrong repo's state file, finds nothing, and opens the design gate silently.
 */
let ROOT = process.env.CLAUDE_PROJECT_DIR || repoRoot() || process.cwd();
export function setRoot(p) { if (p) ROOT = p; }
export const root = () => ROOT;

const STATE = () => join(ROOT, "lifecycle", "state.json");
const EVIDENCE = () => join(ROOT, "lifecycle", "evidence");
const GATES = () => join(ROOT, ".cursor", "lifecycle", "gates");
const SCHEMA_VERSION = 2;

function repoRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { return null; }
}

/* ------------------------------------------------------------------ phases */

export const PHASES = ["REQUIREMENTS", "ANALYSIS", "DESIGN", "DEVELOPMENT", "TESTING", "PRODUCTION"];

/**
 * Required artifacts per phase. Presence is checked mechanically; quality is
 * the gate file's problem. Paths are relative to the repo root.
 *
 * `anyOf` means at least one of the listed paths must exist — used where a
 * project may legitimately organise the same content differently.
 */
const REQUIRED = {
  REQUIREMENTS: [
    { path: "docs/product/brief.md", what: "Problem statement, actors, success measures, explicit anti-scope" },
    { path: "docs/product/prd.md", what: "Product requirements — problem, users, goals, functional + non-functional" },
    { path: "docs/product/personas.md", what: "Personas and jobs-to-be-done" },
    { path: "docs/product/story-map.md", what: "User story map with Given/When/Then acceptance criteria" },
    { path: "docs/product/scope.md", what: "MVP scope AND an explicit out-of-scope list" },
    { path: "docs/product/nfr.md", what: "Quantified non-functional requirements" },
  ],
  ANALYSIS: [
    { path: "docs/analysis/domain-model.md", what: "Entities, aggregates, invariants, ERD" },
    { path: "docs/analysis/use-cases.md", what: "Actors and use cases, each tracing to a story" },
    { path: "docs/analysis/workflows.md", what: "End-to-end business workflows" },
    { path: "docs/analysis/business-rules.md", what: "Numbered rule catalogue, ready for promotion into memory-bank" },
    { path: "docs/analysis/risks.md", what: "Risk register with owner and mitigation per high risk" },
  ],
  DESIGN: [
    { path: "docs/design/architecture.md", what: "Chosen architecture + the variants it was chosen over" },
    { path: "docs/design/api-design.md", what: "Endpoint catalogue covering every use case" },
    { path: "docs/design/database-design.md", what: "Physical schema, indexes, provider roles" },
    { path: "docs/design/security-design.md", what: "Authn/authz, data classification, threat-model output" },
    { path: "docs/design/ux/screen-inventory.md", what: "Screens, their endpoints, RTL/i18n treatment" },
    { path: "docs/design/adr", what: "Architecture decision records — gate 3 criterion 10" },
  ],
  DEVELOPMENT: [
    { anyOf: ["src", "backend", "frontend", "client"], what: "Application source" },
    { path: "specs/features", what: "At least one merged feature spec" },
    { path: "memory-bank/progress.md", what: "Task board with no task left In Progress" },
  ],
  TESTING: [
    { path: "docs/testing/strategy.md", what: "Test strategy: layers, coverage targets, environments" },
    { anyOf: ["tests", "test", "e2e"], what: "Test suites" },
  ],
  PRODUCTION: [
    { anyOf: [".github/workflows", "azure-pipelines.yml", ".gitlab-ci.yml"], what: "CI/CD pipeline" },
  ],
};

/* ------------------------------------------------------- content + hashing */

/**
 * A file full of [square-bracket] slots is the unfilled template, not the
 * artifact. Counting it as present is how a gate passes on a document nobody
 * wrote. Same heuristic the SessionStart hook uses on the memory-bank.
 */
const PLACEHOLDER = /^\s*(>\s*)?(EXAMPLE|TODO|TBD|PLACEHOLDER|_?fill me in_?)/im;
function isUnfilled(body) {
  const lines = body.split("\n").filter((l) => l.trim());
  if (!lines.length) return true;
  const slots = lines.filter((l) => /\[[^\]]{3,}\]/.test(l) && !/\]\(/.test(l)).length;
  return slots / lines.length > 0.3;
}

const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/**
 * Hash of a required artifact. For a directory, hash the sorted list of entry
 * names rather than the contents — the gate asks "is there a test suite", and
 * rewriting one test should not invalidate the design gate. For a file, hash the
 * bytes: change what you promised and the promise lapses.
 */
function artifactHash(rel) {
  const abs = join(ROOT, rel);
  try {
    const st = statSync(abs);
    if (st.isDirectory()) return "dir:" + sha(readdirSync(abs).filter((f) => !f.startsWith(".")).sort().join("\n"));
    return "file:" + sha(readFileSync(abs, "utf8"));
  } catch { return null; }
}

function artifactState(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return { ok: false, reason: "missing" };
  let st;
  try { st = statSync(abs); } catch { return { ok: false, reason: "missing" }; }
  if (st.isDirectory()) {
    let n = 0;
    try { n = readdirSync(abs).filter((f) => !f.startsWith(".")).length; } catch { /* unreadable */ }
    return n ? { ok: true } : { ok: false, reason: "empty directory" };
  }
  let body = "";
  try { body = readFileSync(abs, "utf8").trim(); } catch { return { ok: false, reason: "unreadable" }; }
  if (body.length < 120) return { ok: false, reason: "too short to be real content" };
  if (PLACEHOLDER.test(body)) return { ok: false, reason: "still a template (EXAMPLE/TODO marker)" };
  if (isUnfilled(body)) return { ok: false, reason: "still a template (unfilled [slots])" };
  return { ok: true };
}

/** Which concrete paths a phase's requirements resolve to right now. */
function resolvedPaths(phase) {
  const out = [];
  for (const r of REQUIRED[phase] || []) {
    if (r.anyOf) { const hit = r.anyOf.find((p) => artifactState(p).ok); if (hit) out.push(hit); }
    else out.push(r.path);
  }
  return out;
}

export const gateFile = (p) => `${String(PHASES.indexOf(p) + 1).padStart(2, "0")}-${p.toLowerCase()}.gate.md`;

/**
 * The gate definition's own version. Tighten a criterion and every approval
 * granted against the looser version stops counting — which is the whole point
 * of writing criteria down.
 */
export function gateVersion(phase) {
  try { return sha(readFileSync(join(GATES(), gateFile(phase)), "utf8")); } catch { return null; }
}

/* --------------------------------------------------------- status derivation */

export const CLEARED = new Set(["APPROVED", "INHERITED"]);

/**
 * Compute a phase's status from its evidence. Nothing here is stored: change a
 * file and the next command sees STALE, with no sweeper and nothing to
 * invalidate.
 *
 * BLOCKED is about a phase's neighbours, not itself, so it is applied in
 * deriveAll() once every phase's own status is known.
 */
export function derivePhase(state, phase) {
  const p = state.phases?.[phase] || {};
  const reasons = [];

  if (p.inherited) return { status: "INHERITED", reasons: ["brownfield: done informally before the lifecycle was adopted"] };

  const human = p.human?.status === "APPROVED";
  const judged = p.judgement?.verdict === "GO";
  const mech = p.mechanical?.status === "PASS";

  if (!human) {
    const started = judged || mech || p.startedAt;
    return { status: started ? "IN_PROGRESS" : "NOT_STARTED", reasons };
  }

  // Approved once. Is it still true?
  const recorded = p.mechanical?.artifacts || {};
  for (const [rel, was] of Object.entries(recorded)) {
    const now = artifactHash(rel);
    if (now === null) reasons.push(`${rel} no longer exists`);
    else if (now !== was) reasons.push(`${rel} changed since approval`);
  }
  const gv = gateVersion(phase);
  if (gv && p.judgement?.gateVersion && gv !== p.judgement.gateVersion) {
    reasons.push(`gate definition ${gateFile(phase)} changed since the review`);
  }
  if (reasons.length) return { status: "STALE", reasons };

  if (!judged || !mech) {
    // A v1 state file, or one hand-built. Approved by a human with no evidence
    // behind it — report it rather than honouring it silently.
    return { status: "STALE", reasons: ["approved without a recorded /lifecycle-gate verdict (pre-v2 state)"] };
  }

  const ov = p.override;
  if (ov && ov.expiresAt && Date.parse(ov.expiresAt) < Date.now()) {
    return { status: "STALE", reasons: [`override granted by ${ov.by} expired on ${ov.expiresAt.slice(0, 10)}`] };
  }
  return { status: "APPROVED", reasons: [] };
}

/** Every phase's status, with BLOCKED applied downstream of the first problem. */
export function deriveAll(state) {
  const out = {};
  let blockedFrom = null;
  for (const ph of PHASES) {
    const d = derivePhase(state, ph);
    if (blockedFrom && !CLEARED.has(d.status) && d.status !== "STALE") {
      out[ph] = { status: "BLOCKED", reasons: [`${blockedFrom} is not cleared`] };
      continue;
    }
    out[ph] = d;
    if (!CLEARED.has(d.status)) blockedFrom ||= ph;
  }
  return out;
}

/** The one question guard-phase asks. */
export function designCleared(state) {
  if (!state) return false;
  return CLEARED.has(derivePhase(state, "DESIGN").status);
}

/* -------------------------------------------------------------------- state */

function blankState(name, mode) {
  const phases = {};
  for (const p of PHASES) phases[p] = {};
  if (mode === "brownfield") {
    // An existing codebase did not skip phases 1-3 — it did them informally,
    // years ago, in people's heads. Recording that honestly as INHERITED is
    // better than either pretending they were approved or blocking all work.
    for (const p of ["REQUIREMENTS", "ANALYSIS", "DESIGN"]) phases[p] = { inherited: true, at: new Date().toISOString() };
    phases.DEVELOPMENT = { startedAt: new Date().toISOString() };
  } else {
    phases.REQUIREMENTS = { startedAt: new Date().toISOString() };
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    product: name || "unnamed",
    mode,
    phase: mode === "brownfield" ? "DEVELOPMENT" : "REQUIREMENTS",
    updated: new Date().toISOString(),
    phases,
    history: [{ at: new Date().toISOString(), event: "init", detail: `mode=${mode}` }],
  };
}

export function readState() {
  if (!existsSync(STATE())) return null;
  let s;
  try { s = JSON.parse(readFileSync(STATE(), "utf8")); } catch { return null; }
  return (s.schemaVersion || 1) < SCHEMA_VERSION ? migrate(s) : s;
}

/**
 * v1 recorded `{status, approved:{by,at,note}}` per phase — a human consent with
 * no mechanical hashes and no judgement record. Those approvals cannot be
 * upgraded, only reported: derivePhase() returns STALE for them, which is the
 * honest answer to "was this reviewed?" — nobody knows.
 */
function migrate(s) {
  const phases = {};
  for (const p of PHASES) {
    const old = s.phases?.[p] || {};
    const n = {};
    if (old.status === "INHERITED") n.inherited = true;
    if (old.approved) n.human = { status: "APPROVED", by: old.approved.by, at: old.approved.at, note: old.approved.note || "" };
    if (old.status === "IN_PROGRESS") n.startedAt = s.updated || new Date().toISOString();
    phases[p] = n;
  }
  return { ...s, schemaVersion: SCHEMA_VERSION, phases, migratedFrom: s.schemaVersion || 1 };
}

function writeState(s) {
  s.updated = new Date().toISOString();
  mkdirSync(dirname(STATE()), { recursive: true });
  writeFileSync(STATE(), JSON.stringify(s, null, 2) + "\n", "utf8");
}

/* ------------------------------------------------------------------ commands */

function checkPhase(phase) {
  const reqs = REQUIRED[phase] || [];
  const rows = reqs.map((r) => {
    if (r.anyOf) {
      const hit = r.anyOf.find((p) => artifactState(p).ok);
      return { artifact: r.anyOf.join(" | "), what: r.what, ok: !!hit, reason: hit ? "" : "none present" };
    }
    const st = artifactState(r.path);
    return { artifact: r.path, what: r.what, ok: st.ok, reason: st.reason || "" };
  });
  return { phase, ok: rows.every((r) => r.ok), artifacts: rows };
}

function cmdInit(args) {
  if (existsSync(STATE())) die(`lifecycle/state.json already exists — use 'status', or delete it deliberately.`, 1);
  const mode = args.includes("--existing") ? "brownfield" : "greenfield";
  const s = blankState(valueOf(args, "--name"), mode);
  writeState(s);
  console.log(`Initialised ${mode} lifecycle for "${s.product}".`);
  console.log(`Current phase: ${s.phase}`);
  if (mode === "brownfield") {
    console.log(`Phases 1-3 marked INHERITED — done informally before this repo adopted the lifecycle.`);
    console.log(`Run /feature-inventory and /context-sync to give them real artifacts if you want them APPROVED.`);
  }
}

function cmdStatus(args) {
  const s = mustState();
  const d = deriveAll(s);
  if (args.includes("--json")) return console.log(JSON.stringify({ ...s, derived: d }, null, 2));

  console.log(`Product:  ${s.product}   (${s.mode})`);
  console.log(`Phase:    ${s.phase}`);
  console.log(`Updated:  ${s.updated}`);
  if (s.migratedFrom) console.log(`Migrated: from schema v${s.migratedFrom} — approvals without evidence read as STALE.`);
  console.log("");

  const MARK = { APPROVED: "[x]", INHERITED: "[i]", IN_PROGRESS: "[~]", STALE: "[!]", BLOCKED: "[-]", NOT_STARTED: "[ ]" };
  for (const [i, p] of PHASES.entries()) {
    const st = d[p];
    const here = p === s.phase ? "->" : "  ";
    const ph = s.phases[p] || {};
    const consents = [
      ph.mechanical?.status === "PASS" ? "M" : "·",
      ph.judgement?.verdict === "GO" ? "J" : "·",
      ph.human?.status === "APPROVED" ? "H" : "·",
    ].join("");
    console.log(`${here} ${MARK[st.status] || "[?]"} ${i + 1}. ${p.padEnd(12)} ${st.status.padEnd(12)} ${consents}`);
    for (const r of st.reasons) console.log(`         ${r}`);
  }
  console.log("");
  console.log(`Consents: M=mechanical  J=judgement (/lifecycle-gate)  H=human`);
  console.log("");
  console.log(designCleared(s)
    ? "Design gate cleared — writes under src/** are allowed."
    : "Design gate NOT cleared — guard-phase.mjs will block writes under src/**, frontend/**, backend/**.");
}

/**
 * Gate 1 criterion 3 and Gate 2 criterion 1 - "every story has acceptance
 * criteria", "every story traces to a use case" - were written as things a
 * reviewer reads and judges. They are computable, and a computed criterion
 * belongs in the mechanical consent where it cannot be argued with.
 *
 * Absent schemas/ or an unreadable graph is not a failure: a project may not
 * have adopted the id convention, and a check that breaks on its own absence
 * gets disabled.
 */
async function traceability(phase) {
  try {
    const as = await import(new URL("./artifact-schema.mjs", import.meta.url).href);
    const g = as.buildGraph();
    if (!g.byId.size) return null;
    const dangling = [];
    for (const [file, refs] of g.refsByFile) {
      for (const id of refs) if (!g.byId.has(id)) dangling.push({ id, file });
    }
    const unlinked = [];
    for (const v of g.byId.values()) {
      if (g.grammar[v.prefix]?.phase !== phase) continue;   // this phase's ids only
      const targets = g.grammar[v.prefix]?.tracesTo || [];
      if (!targets.length) continue;
      const reached = [...g.refsByFile].some(([f, r]) => r.has(v.id) && targets.some((t) => g.defsByFile.get(f)?.has(t)));
      if (!reached) unlinked.push({ id: v.id, file: v.file, targets });
    }
    return { total: g.byId.size, dangling, unlinked };
  } catch (e) {
    // Distinguish "this project has no id convention" (silence is correct) from
    // "the checker is broken" (silence is how a gate quietly stops gating).
    return { broken: String(e.message || e) };
  }
}

async function cmdCheck(args) {
  const s = mustState();
  const phase = (args.find((a) => PHASES.includes(a.toUpperCase())) || s.phase).toUpperCase();
  const res = checkPhase(phase);
  if (args.includes("--json")) return console.log(JSON.stringify(res, null, 2));
  console.log(`Gate check — ${phase}\n`);
  for (const r of res.artifacts) {
    console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.artifact}`);
    console.log(`        ${r.what}${r.ok ? "" : `  <-- ${r.reason}`}`);
  }
  const tr = await traceability(phase);
  let traceOk = true;
  if (tr?.broken) {
    console.log("");
    console.log(`  WARN  traceability could not run: ${tr.broken}`);
    console.log(`        The mechanical consent is weaker than it looks until this is fixed.`);
  } else if (tr) {
    console.log("");
    console.log(`  Traceability — ${tr.total} ids across the lifecycle documents`);
    if (tr.dangling.length) {
      traceOk = false;
      for (const d of tr.dangling) console.log(`  FAIL  ${d.id} cited in ${d.file}, defined nowhere`);
    }
    for (const u of tr.unlinked) {
      traceOk = false;
      console.log(`  FAIL  ${u.id} (${u.file}) reaches no ${u.targets.join(" or ")}`);
    }
    if (traceOk) console.log(`  PASS  every ${phase} id reaches its next link`);
  }

  console.log("");
  const ok = res.ok && traceOk;
  console.log(ok
    ? `Mechanical check passes. That is one consent of three.\nNext: /lifecycle-gate ${phase} — presence is not quality. Criteria: ${rel(join(GATES(), gateFile(phase)))}`
    : res.ok
      ? `Mechanical check FAILS on traceability. A chain that stops is a decision nobody carried forward.\nnode .cursor/tools/artifact-schema.mjs check   # the full picture`
      : `Mechanical check FAILS. Produce the missing artifacts before anything else.`);
  if (!ok) process.exit(1);
}

/**
 * The judgement consent. /lifecycle-gate calls this with its verdict; the gate
 * definition's hash is stamped in, so editing the criteria later invalidates
 * every approval that was granted under the old ones.
 */
function cmdRecordGate(args) {
  const s = mustState();
  const phase = (args.find((a) => PHASES.includes(a.toUpperCase())) || "").toUpperCase();
  if (!phase) die("record-gate needs a phase.", 2);
  const verdict = (valueOf(args, "--verdict") || "").toUpperCase();
  if (!["GO", "NO-GO"].includes(verdict)) die(`record-gate needs --verdict GO or NO-GO.`, 2);
  const by = valueOf(args, "--by");
  if (!by) die(`record-gate needs --by "<reviewer>" — an unattributed verdict is not evidence.`, 2);

  const gv = gateVersion(phase);
  if (!gv) die(`No gate definition at ${rel(join(GATES(), gateFile(phase)))}. Cannot record a verdict against nothing.`, 1);

  const rec = {
    verdict, by,
    at: new Date().toISOString(),
    gateVersion: gv,
    criteria: valueOf(args, "--criteria") || "",
    note: valueOf(args, "--note") || "",
  };
  s.phases[phase] = { ...(s.phases[phase] || {}), judgement: rec };
  s.history.push({ at: rec.at, event: "gate", detail: `${phase} ${verdict} by ${by}` });
  writeState(s);

  // Evidence on disk, not only in state. "Why was this allowed?" should be
  // answerable months later without reading a chat log.
  mkdirSync(EVIDENCE(), { recursive: true });
  const ev = join(EVIDENCE(), `${phase.toLowerCase()}-${rec.at.replace(/[:.]/g, "-")}.json`);
  writeFileSync(ev, JSON.stringify({ phase, ...rec, gateFile: gateFile(phase), mechanical: checkPhase(phase) }, null, 2) + "\n", "utf8");

  console.log(`${phase} judgement recorded: ${verdict} by ${by}`);
  console.log(`Evidence: ${rel(ev)}`);
  if (verdict === "GO") console.log(`Next: node .cursor/tools/lifecycle.mjs approve ${phase} --by "<name>"`);
  else { console.log(`NO-GO recorded. The phase cannot be approved until a GO replaces it.`); process.exit(1); }
}

function cmdApprove(args) {
  const s = mustState();
  const phase = (args.find((a) => PHASES.includes(a.toUpperCase())) || "").toUpperCase();
  if (!phase) die(`approve needs a phase: approve DESIGN --by "name"`, 2);
  const by = valueOf(args, "--by");
  if (!by) die(`approve needs --by "name" — a gate with no named approver is a form, not a control.`, 2);

  const refusals = [];

  // --- order. A phase approved out of turn is a gate that gates nothing. -----
  if (phase !== s.phase) {
    refusals.push(`${phase} is not the current phase (${s.phase}). Approving out of order defeats the sequence.`);
  }
  const prev = PHASES[PHASES.indexOf(phase) - 1];
  if (prev) {
    const pd = derivePhase(s, prev);
    if (!CLEARED.has(pd.status)) refusals.push(`${prev} is ${pd.status}, not approved. ${pd.reasons[0] || ""}`.trim());
  }

  // --- mechanical. Recomputed now, never trusted from an earlier run. --------
  const mech = checkPhase(phase);
  if (!mech.ok) {
    refusals.push(`Mechanical check fails:`);
    for (const r of mech.artifacts.filter((x) => !x.ok)) refusals.push(`    - ${r.artifact} (${r.reason})`);
  }

  // --- judgement. The consent the first version of this file forgot. --------
  const j = s.phases[phase]?.judgement;
  const gv = gateVersion(phase);
  if (!j) {
    refusals.push(`No /lifecycle-gate verdict recorded. Run the gate, then:`);
    refusals.push(`    node .cursor/tools/lifecycle.mjs record-gate ${phase} --verdict GO --by "lifecycle-gate"`);
  } else if (j.verdict !== "GO") {
    refusals.push(`The recorded verdict is ${j.verdict} (by ${j.by}, ${j.at.slice(0, 10)}). Never soften a NO-GO.`);
  } else if (gv && j.gateVersion !== gv) {
    refusals.push(`The verdict was recorded against an older ${gateFile(phase)}. Re-run /lifecycle-gate against the current criteria.`);
  }

  if (refusals.length) {
    const ov = activeOverride(s, phase);
    if (!ov) {
      console.error(`REFUSED: ${phase} cannot be approved.\n`);
      for (const r of refusals) console.error(`  ${r}`);
      console.error(`\nA gate needs three consents: mechanical, judgement, human. This has ${3 - countMissing(s, phase, mech)}.`);
      console.error(`If this must proceed anyway, record an override — it expires and it is auditable:`);
      console.error(`  node .cursor/tools/lifecycle.mjs override ${phase} --reason "..." --risk HIGH --by "<name>" --expires 14`);
      process.exit(1);
    }
    console.error(`PROCEEDING UNDER OVERRIDE ${ov.id} (granted by ${ov.by}, expires ${ov.expiresAt.slice(0, 10)}).`);
    for (const r of refusals) console.error(`  bypassed: ${r}`);
  }

  const at = new Date().toISOString();
  const artifacts = {};
  for (const p of resolvedPaths(phase)) { const h = artifactHash(p); if (h) artifacts[p] = h; }

  s.phases[phase] = {
    ...(s.phases[phase] || {}),
    mechanical: { status: mech.ok ? "PASS" : "BYPASSED", at, artifacts },
    human: { status: "APPROVED", by, at, note: valueOf(args, "--note") || "" },
  };
  s.history.push({ at, event: "approve", detail: `${phase} by ${by}${refusals.length ? " (UNDER OVERRIDE)" : ""}` });
  writeState(s);

  console.log(`${phase} approved by ${by}.`);
  console.log(`${Object.keys(artifacts).length} artifact(s) hashed — editing any of them makes this phase STALE.`);
  if (phase === "DESIGN") console.log(`Design gate cleared — writes under src/** are now allowed.`);
  const nxt = PHASES[PHASES.indexOf(phase) + 1];
  if (nxt) console.log(`Next: node .cursor/tools/lifecycle.mjs advance   (-> ${nxt})`);
}

const countMissing = (s, phase, mech) =>
  (mech.ok ? 0 : 1) + (s.phases[phase]?.judgement?.verdict === "GO" ? 0 : 1);

function activeOverride(s, phase) {
  const ov = s.phases?.[phase]?.override;
  if (!ov) return null;
  if (ov.expiresAt && Date.parse(ov.expiresAt) < Date.now()) return null;
  return ov;
}

/**
 * `--force` as a flag made bypassing a gate as cheap as passing one. An override
 * is a record: who, why, how risky, and when it lapses.
 */
function cmdOverride(args) {
  const s = mustState();
  const phase = (args.find((a) => PHASES.includes(a.toUpperCase())) || "").toUpperCase();
  const reason = valueOf(args, "--reason");
  const risk = (valueOf(args, "--risk") || "").toUpperCase();
  const by = valueOf(args, "--by");
  const days = Number(valueOf(args, "--expires") || 0);
  if (!phase) die("override needs a phase.", 2);
  if (!reason) die(`override needs --reason "..." — an unexplained bypass is indistinguishable from a mistake.`, 2);
  if (!["LOW", "MED", "HIGH"].includes(risk)) die("override needs --risk LOW | MED | HIGH.", 2);
  if (!by) die(`override needs --by "<name>" — someone owns this.`, 2);
  if (!days || days < 1 || days > 90) die("override needs --expires <1-90> days. A permanent override is a deleted gate.", 2);

  const at = new Date().toISOString();
  const ov = {
    id: `OV-${sha(phase + at).slice(0, 6).toUpperCase()}`,
    phase, reason, risk, by, at,
    expiresAt: new Date(Date.now() + days * 86_400_000).toISOString(),
    bypassed: checkPhase(phase).artifacts.filter((a) => !a.ok).map((a) => a.artifact),
  };
  s.phases[phase] = { ...(s.phases[phase] || {}), override: ov };
  s.history.push({ at, event: "override", detail: `${ov.id} ${phase} risk=${risk} by ${by} until ${ov.expiresAt.slice(0, 10)}` });
  writeState(s);

  mkdirSync(join(ROOT, "lifecycle", "overrides"), { recursive: true });
  writeFileSync(join(ROOT, "lifecycle", "overrides", `${ov.id}.json`), JSON.stringify(ov, null, 2) + "\n", "utf8");

  console.log(`Override ${ov.id} recorded for ${phase}.`);
  console.log(`  risk ${risk}, granted by ${by}, expires ${ov.expiresAt.slice(0, 10)}`);
  console.log(`  bypasses: ${ov.bypassed.join(", ") || "(nothing mechanical — a judgement or ordering bypass)"}`);
  console.log(`\nWhen it expires the phase becomes STALE on its own. That is intended.`);
}

function cmdAdvance() {
  const s = mustState();
  const cur = s.phase;
  const d = derivePhase(s, cur);
  if (!CLEARED.has(d.status)) {
    die(`REFUSED: ${cur} is ${d.status}.${d.reasons.length ? "\n  " + d.reasons.join("\n  ") : ""}\nRun 'check ${cur}', then /lifecycle-gate, then 'approve ${cur} --by "name"'.`, 1);
  }
  const nxt = PHASES[PHASES.indexOf(cur) + 1];
  if (!nxt) return console.log(`${cur} is the final phase. Nothing to advance to.`);
  s.phase = nxt;
  s.phases[nxt] = { ...(s.phases[nxt] || {}), startedAt: new Date().toISOString() };
  s.history.push({ at: new Date().toISOString(), event: "advance", detail: `${cur} -> ${nxt}` });
  writeState(s);
  console.log(`Advanced: ${cur} -> ${nxt}`);
}

function cmdRollback(args) {
  const s = mustState();
  const phase = (args.find((a) => PHASES.includes(a.toUpperCase())) || "").toUpperCase();
  const reason = valueOf(args, "--reason");
  if (!phase) die("rollback needs a phase.", 2);
  if (!reason) die("rollback needs --reason — an unexplained rollback is indistinguishable from a mistake.", 2);
  s.phases[phase] = { startedAt: new Date().toISOString() };
  for (const p of PHASES.slice(PHASES.indexOf(phase) + 1)) s.phases[p] = {};
  s.phase = phase;
  s.history.push({ at: new Date().toISOString(), event: "rollback", detail: `${phase}: ${reason}` });
  writeState(s);
  console.log(`Rolled back to ${phase}. Every later phase reset, and all three consents cleared.`);
  console.log(`Reason recorded: ${reason}`);
}

function cmdGate(args) {
  const s = readState();
  const phase = (args.find((a) => PHASES.includes(a.toUpperCase())) || s?.phase || "").toUpperCase();
  if (!phase) die("gate needs a phase.", 2);
  console.log(rel(join(GATES(), gateFile(phase))));
}

/* ------------------------------------------------------------------- helpers */

const rel = (p) => p.slice(ROOT.length + 1).split("\\").join("/");
const valueOf = (args, flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
function die(msg, code) { console.error(msg); process.exit(code); }
function mustState() {
  const s = readState();
  if (!s) die(`No lifecycle/state.json. Run: node .cursor/tools/lifecycle.mjs init --name "<product>"\n(or --existing on a codebase that already exists)`, 1);
  return s;
}

/* ---------------------------------------------------------------------- main */

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].split("\\").join("/")}`).href;
if (invokedDirectly || process.env.LIFECYCLE_FORCE_CLI) main();

async function main() {
const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case "init": cmdInit(args); break;
  case "status": cmdStatus(args); break;
  case "check": await cmdCheck(args); break;
  case "record-gate": cmdRecordGate(args); break;
  case "approve": cmdApprove(args); break;
  case "override": cmdOverride(args); break;
  case "advance": cmdAdvance(); break;
  case "rollback": cmdRollback(args); break;
  case "gate": cmdGate(args); break;
  default:
    console.error(`lifecycle.mjs — product lifecycle state machine

  init [--name "X"] [--existing]        create lifecycle/state.json
  status [--json]                       where are we, and are the approvals still true
  check [PHASE] [--json]                consent 1: do the artifacts exist
  record-gate PHASE --verdict GO|NO-GO --by "<reviewer>" [--criteria] [--note]
                                        consent 2: the /lifecycle-gate verdict
  approve PHASE --by "name" [--note]    consent 3: the human. Refuses without 1 and 2.
  override PHASE --reason --risk --by --expires <days>
                                        auditable, expiring bypass
  advance                               move to the next phase
  rollback PHASE --reason "..."         reopen a phase, reset every later one
  gate [PHASE]                          path to the gate definition

Phases: ${PHASES.join(" -> ")}
Statuses: NOT_STARTED IN_PROGRESS APPROVED INHERITED STALE BLOCKED`);
    process.exit(2);
}
}
