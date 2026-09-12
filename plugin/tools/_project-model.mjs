/**
 * _project-model.mjs — canonical shapes and derived intelligence for the
 * Project Command Center.
 *
 * WHY THIS EXISTS
 *
 * Lifecycle answers "what engineering stage is the product in?". Feature-map
 * answers "what does the code do?". Neither answers "what outcome are we
 * delivering, which checkpoints block it, and what happened to that idea?".
 * This module holds those shapes and the deterministic engines (readiness,
 * recommendations, graph, timeline, health, discovery). It does not write
 * disk and it does not talk to an LLM.
 *
 * Canonical authored state lives under project/ (identity, delivery phases,
 * checkpoints, ideas). Everything else is a projection of files that already
 * have owners: lifecycle/state.json, feature-map.json, the id graph, AC
 * traces, releases, incidents, ADRs.
 */

import { createHash } from "node:crypto";

export const SCHEMA_VERSION = 1;

export const PHASE_STATUSES = ["PLANNED", "READY", "IN_PROGRESS", "BLOCKED", "COMPLETED", "CANCELLED", "NEEDS_REVIEW"];
export const CHECKPOINT_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "READY_FOR_REVIEW", "PASSED", "FAILED", "BLOCKED", "WAIVED", "NOT_APPLICABLE"];
export const IDEA_STATUSES = ["CAPTURED", "EVALUATING", "APPROVED", "SPECIFIED", "IMPLEMENTING", "VERIFIED", "RELEASED", "REJECTED", "PARKED"];
export const FEATURE_STATUSES = ["PLANNED", "IN_PROGRESS", "IMPLEMENTED", "VERIFYING", "VERIFIED", "RELEASED", "BLOCKED", "UNKNOWN"];
export const REC_CATEGORIES = ["missing", "enhancement", "risk", "opportunity"];
export const REC_SOURCES = ["rule", "detected-gap", "ai"];
export const VERIFY_MODES = ["AUTOMATED", "MANUAL", "HYBRID"];
export const CONFIDENCE = ["detected", "confirmed", "unknown"];
export const OBJECTIVE_STATUSES = ["COMPLETE", "INCOMPLETE", "UNKNOWN"];
export const DISCOVER_DEFAULTS = { maxDepth: 4, maxFiles: 4000, maxHits: 80 };
export const RISK_REGISTER_CANDIDATES = [
  "docs/analysis/risks.md",
  "docs/analysis/risk-register.md",
  "docs/risks.md",
];
export const VERIFICATION_CONTRACT = {
  manualEvidence: "A hashed in-repo file is a named assertion. It does not prove the reviewer's conclusion is true.",
  automatedEvidence: "Tool evidence binds to the worktree digest. It does not attest runtime, databases, or deployment.",
  ideaVerified: "Idea VERIFIED is a review of that idea. Bound features stay unverified until they are VERIFIED or RELEASED.",
  featureComplete: "A required feature satisfies a phase only at VERIFIED or RELEASED, not IMPLEMENTED or IN_PROGRESS.",
  waiver: "WAIVED is a named exception with --reason and --by. It is not PASSED and it is not silence.",
  cancellation: "CANCELLED on a dependency does not satisfy readiness. Only COMPLETED does.",
  releaseMembership: "RELEASED on an idea must cite a signed lifecycle release. Overlay feature bindings carry that membership; the idea status alone does not.",
  decisions: "Canonical decision ids live in docs/adr / decision-memory. idea.decision is an inline verdict note and does not replace decisionId.",
};

export const IDEA_TRANSITIONS = {
  CAPTURED: ["EVALUATING", "REJECTED", "PARKED"],
  EVALUATING: ["APPROVED", "REJECTED", "PARKED", "CAPTURED"],
  APPROVED: ["SPECIFIED", "IMPLEMENTING", "PARKED", "REJECTED"],
  SPECIFIED: ["IMPLEMENTING", "PARKED", "APPROVED"],
  IMPLEMENTING: ["VERIFIED", "PARKED", "SPECIFIED"],
  VERIFIED: ["RELEASED", "IMPLEMENTING"],
  RELEASED: [],
  REJECTED: ["EVALUATING"],
  PARKED: ["EVALUATING", "CAPTURED"],
};

export const DEFAULT_PHASE_DEFS = [
  { slug: "discovery", name: "Discovery", order: 0, description: "Understand the problem, users and anti-scope." },
  { slug: "foundation", name: "Foundation", order: 1, description: "Identity, architecture, repo wiring, first vertical slice." },
  { slug: "core", name: "Core Functionality", order: 2, description: "The capabilities the product is for." },
  { slug: "integration", name: "Integration", order: 3, description: "APIs, data, external systems, end-to-end paths." },
  { slug: "hardening", name: "Hardening", order: 4, description: "Security, performance, observability, failure modes." },
  { slug: "release-prep", name: "Release Preparation", order: 5, description: "Evidence, runbooks, flags, cut record." },
  { slug: "launch", name: "Production Launch", order: 6, description: "Cutover, abort criteria, first live verification." },
  { slug: "post-release", name: "Post-Release Improvement", order: 7, description: "What production taught, and the next increment." },
];

export const CHECKPOINT_TYPES = [
  { type: "requirements", name: "Requirements" },
  { type: "architecture", name: "Architecture" },
  { type: "api", name: "API" },
  { type: "database", name: "Database" },
  { type: "security", name: "Security" },
  { type: "ui", name: "UI" },
  { type: "integration", name: "Integration tests" },
  { type: "testing", name: "Testing" },
  { type: "performance", name: "Performance" },
  { type: "observability", name: "Observability" },
  { type: "documentation", name: "Documentation" },
  { type: "release-readiness", name: "Release readiness" },
  { type: "production-readiness", name: "Production readiness" },
];

/** Which checkpoint types apply to which default phase slug. `-` in the matrix is absence. */
export const PHASE_CHECKPOINT_TYPES = {
  discovery: ["requirements", "documentation"],
  foundation: ["requirements", "architecture", "documentation"],
  core: ["requirements", "architecture", "api", "database", "ui", "testing"],
  integration: ["api", "database", "security", "integration", "testing", "observability"],
  hardening: ["security", "testing", "performance", "observability"],
  "release-prep": ["testing", "performance", "observability", "documentation", "release-readiness"],
  launch: ["release-readiness", "production-readiness", "observability"],
  "post-release": ["observability", "documentation", "testing"],
};

/** Automated verify maps a checkpoint type onto a tool that already exists. */
export const AUTOMATED_VERIFY = {
  architecture: { tool: "fitness.mjs", args: ["check", "--json"], summary: "Architecture fitness check" },
  testing: { tool: "ac-trace.mjs", args: ["check", "--json"], summary: "Acceptance-criteria trace" },
  documentation: { tool: "docs-lint.mjs", args: ["check", "--json"], summary: "Documentation graph" },
  observability: { tool: "failure-modes.mjs", args: ["check", "--json"], summary: "Dependency failure-mode scan" },
  // Failure-mode scanning is not a security review. Release verification also
  // needs a named signed release; neither is a generic automated checkpoint.
};

const SKIP_DIRS = new Set(["node_modules", ".git", "plugin", "bin", "obj", "dist", "coverage", ".next", "tmp"]);

export function nextId(items, prefix, width = 3) {
  const re = new RegExp(`^${prefix}-(\\d+)$`, "i");
  let max = 0;
  for (const it of items || []) {
    const m = String(it.id || it).match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(width, "0")}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function field(value, confidence = "unknown") {
  return { value: value == null ? null : value, confidence };
}

export function defaultObjectives(slug) {
  const map = {
    discovery: ["Problem and anti-scope written", "Personas named", "Success looks like X, measured how"],
    foundation: ["Repo and lifecycle adopted", "Architecture chosen", "First vertical slice runs"],
    core: ["Primary user journey works", "Domain rules enforced", "Acceptance criteria exist"],
    integration: ["API contract held", "Data path proven", "External dependency has a timeout"],
    hardening: ["Security review of the new surface", "Failure modes named", "Performance targets evidenced or marked unknown"],
    "release-prep": ["Release record can be cut", "Runbook exists", "Flags have owners and expiry"],
    launch: ["Abort criteria written", "Rollback named", "First live check listed"],
    "post-release": ["Incidents have guards", "Next increment chosen", "Stale traces refreshed"],
  };
  return (map[slug] || ["Phase objective"]).map((title, i) => ({
    id: `OBJ-${slug}-${String(i + 1).padStart(2, "0")}`,
    title,
    required: true,
    status: "UNKNOWN",
  }));
}

export function buildDefaultDelivery({ existing = false, at = nowIso() } = {}) {
  const phases = DEFAULT_PHASE_DEFS.map((d, i) => ({
    id: `PHASE-${String(i).padStart(3, "0")}`,
    slug: d.slug,
    name: d.name,
    description: d.description,
    status: existing ? "NEEDS_REVIEW" : (i === 0 ? "IN_PROGRESS" : "PLANNED"),
    order: d.order,
    owner: null,
    startDate: null,
    targetDate: null,
    completedAt: null,
    objectives: defaultObjectives(d.slug),
    entryCriteria: i === 0 ? ["Project identity exists"] : [`${DEFAULT_PHASE_DEFS[i - 1].name} completed or waived`],
    exitCriteria: [], // Required objectives and checkpoints are always evaluated below.
    featureIds: [],
    requirementIds: [],
    taskIds: [],
    riskIds: [],
    evidence: [],
    dependencies: i === 0 ? [] : [`PHASE-${String(i - 1).padStart(3, "0")}`],
    releaseId: null,
  }));
  const checkpoints = [];
  for (const phase of phases) {
    const types = PHASE_CHECKPOINT_TYPES[phase.slug] || [];
    for (const type of types) {
      const meta = CHECKPOINT_TYPES.find((t) => t.type === type);
      const auto = AUTOMATED_VERIFY[type];
      checkpoints.push({
        id: nextId(checkpoints, "CHK"),
        name: meta?.name || type,
        description: `${meta?.name || type} checkpoint for ${phase.name}.`,
        type,
        phaseId: phase.id,
        status: existing ? "NOT_STARTED" : "NOT_STARTED",
        required: !["observability", "performance", "ui"].includes(type) || phase.slug === "hardening" || phase.slug === "launch",
        optional: false,
        owner: null,
        dueDate: null,
        entryCriteria: [],
        completionCriteria: [`${meta?.name || type} evidenced or waived by name`],
        evidence: [],
        requirementIds: [],
        featureIds: [],
        riskIds: [],
        blockers: [],
        completedAt: null,
        reviewer: null,
        notes: "",
        verificationMode: auto ? "HYBRID" : "MANUAL",
        evidenceRequired: true,
        history: [{ at, status: "NOT_STARTED", by: "init" }],
      });
    }
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    updatedAt: at,
    phases,
    checkpoints,
    featureBindings: [],
    milestones: [],
    history: [{ at, event: "init", detail: existing ? "Brownfield defaults; statuses are NEEDS_REVIEW, not completed." : "Greenfield defaults; Discovery is IN_PROGRESS." }],
  };
}

export function emptyIdentity({ name, description, owner, existing } = {}) {
  const at = nowIso();
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    id: "PROJ-001",
    name: name || "untitled",
    description: description || "",
    status: "ACTIVE",
    owner: owner || null,
    createdAt: at,
    updatedAt: at,
    repositoryPath: null,
    currentDeliveryPhaseId: existing ? null : "PHASE-000",
    currentCheckpointId: null,
    identity: {
      name: field(name || "untitled", name ? "confirmed" : "unknown"),
      description: field(description || "", description ? "confirmed" : "unknown"),
      owner: field(owner || null, owner ? "confirmed" : "unknown"),
      stack: field([], "unknown"),
      languages: field([], "unknown"),
      frameworks: field([], "unknown"),
      applications: field(null, "unknown"),
      services: field(null, "unknown"),
      databases: field([], "unknown"),
      apis: field(null, "unknown"),
      tests: field(null, "unknown"),
      infrastructure: field([], "unknown"),
    },
    recommendationDispositions: {},
    detections: [],
    rejectedDetections: [],
    config: {
      evidenceRequiredDefault: true,
      allowCompleteWithoutReady: false,
    },
  };
}

export function emptyIdeas(at = nowIso()) {
  return { schemaVersion: SCHEMA_VERSION, revision: 0, updatedAt: at, ideas: [] };
}

export function canTransitionIdea(from, to) {
  return (IDEA_TRANSITIONS[from] || []).includes(to);
}

/** HIGH/CRITICAL register risks that are not closed or explicitly accepted. */
export function riskIsOpenBlocking(risk) {
  if (!risk) return false;
  const severity = String(risk.severity || "").toUpperCase();
  const blocking = risk.blocking === true || severity === "HIGH" || severity === "CRITICAL";
  const open = risk.status !== "CLOSED" && risk.status !== "ACCEPTED";
  return blocking && open;
}

export function objectiveProgress(objectives) {
  const list = Array.isArray(objectives) ? objectives : [];
  const known = list.filter((o) => o.status === "COMPLETE" || o.status === "INCOMPLETE");
  const complete = known.filter((o) => o.status === "COMPLETE").length;
  const unknown = list.filter((o) => o.status === "UNKNOWN" || !o.status).length;
  if (!list.length) return { complete: 0, total: 0, known: 0, unknown: 0, ratio: null, label: "No objectives" };
  if (unknown && known.length === 0) {
    return { complete: 0, total: list.length, known: 0, unknown, ratio: null, label: "Insufficient evidence" };
  }
  if (unknown) {
    return {
      complete, total: list.length, known: known.length, unknown, ratio: null,
      label: `${complete} / ${known.length} known · ${unknown} unmeasured`,
    };
  }
  return {
    complete, total: list.length, known: known.length, unknown: 0,
    ratio: list.length ? complete / list.length : null,
    label: `${complete} / ${list.length}`,
  };
}

/**
 * Deterministic phase readiness. A phase is not complete while a required
 * checkpoint is unfinished, a required objective is unconfirmed, a dependency
 * is missing/open, or a blocking risk is unresolved. Unknown is not success.
 */
export function phaseReadiness(phase, ctx = {}) {
  const checkpoints = (ctx.checkpoints || []).filter((c) => c.phaseId === phase.id);
  const phases = ctx.phases || [];
  const bindings = (ctx.featureBindings || []).filter((b) => b.phaseId === phase.id);
  const reasons = [];
  const checks = [];

  for (const obj of phase.objectives || []) {
    const required = obj.required !== false;
    const ok = obj.status === "COMPLETE" || !required;
    if (!ok) reasons.push(`Required objective incomplete or unknown: ${obj.title || obj.id}`);
    checks.push({ kind: "objective", id: obj.id, ok, status: obj.status || "UNKNOWN", label: obj.title });
  }

  // Old defaults duplicated these built-in checks as prose. They stay readable
  // without treating arbitrary new prose as executable completion criteria.
  const legacyDefaults = new Set(["Required objectives complete or UNKNOWN-and-accepted", "Required checkpoints PASSED or WAIVED"]);
  for (const criterion of phase.exitCriteria || []) {
    if (typeof criterion === "string" && legacyDefaults.has(criterion)) continue;
    const ok = typeof criterion === "object" && criterion !== null && (criterion.required === false || criterion.status === "COMPLETE");
    const label = typeof criterion === "string" ? criterion : criterion?.title || criterion?.id || "unnamed criterion";
    if (!ok) reasons.push(`Exit criterion incomplete or unknown: ${label}`);
    checks.push({ kind: "exit-criterion", id: criterion?.id, ok, label, status: criterion?.status || "UNKNOWN" });
  }

  for (const c of checkpoints) {
    const passed = c.status === "PASSED" || c.status === "WAIVED" || c.status === "NOT_APPLICABLE";
    const required = c.required !== false && c.status !== "NOT_APPLICABLE";
    if (required && !passed) {
      reasons.push(`Checkpoint ${c.name} is ${c.status}`);
    }
    checks.push({ kind: "checkpoint", id: c.id, ok: !required || passed, status: c.status, label: c.name, required });
  }

  for (const depId of phase.dependencies || []) {
    const dep = phases.find((p) => p.id === depId);
    const ok = !!dep && dep.status === "COMPLETED";
    if (!ok) {
      reasons.push(dep?.status === "CANCELLED"
        ? `Depends on ${depId} which is CANCELLED — cancellation does not satisfy delivery`
        : `Depends on ${depId} (${dep?.status || "missing"})`);
    }
    checks.push({ kind: "dependency", id: depId, ok, status: dep?.status || "missing", label: dep?.name || depId });
  }

  for (const rid of phase.riskIds || []) {
    const risk = (ctx.risks || []).find((r) => r.id === rid);
    const blocking = riskIsOpenBlocking(risk);
    if (!risk || risk.status === "UNKNOWN" || blocking) reasons.push(`Blocking or unresolved risk ${rid}`);
    checks.push({ kind: "risk", id: rid, ok: !!risk && risk.status !== "UNKNOWN" && !blocking, status: risk?.status || "unknown", label: risk?.title || rid, source: risk?.source });
  }

  for (const risk of ctx.risks || []) {
    if ((phase.riskIds || []).includes(risk.id)) continue;
    if (!riskIsOpenBlocking(risk)) continue;
    const attached = risk.phaseId === phase.id;
    const unlinkedCurrent = !risk.phaseId && ctx.currentDeliveryPhaseId === phase.id;
    if (!attached && !unlinkedCurrent) continue;
    reasons.push(`Open register risk ${risk.id} (${risk.title || "untitled"}) is unresolved`);
    checks.push({ kind: "risk", id: risk.id, ok: false, status: risk.status, label: risk.title || risk.id, source: risk.source });
  }

  for (const c of checkpoints) {
    if (c.status === "PASSED" && !checkpointEvidenceReady(c)) {
      reasons.push(`Checkpoint ${c.name} is PASSED without evidence that is successful and current`);
      checks.push({ kind: "evidence", id: c.id, ok: false, status: "missing", label: `${c.name} evidence` });
    }
    if (c.required !== false && (c.blockers || []).length) reasons.push(`Checkpoint ${c.name} has unresolved blockers`);
  }

  const requiredFeatures = [...bindings.filter((b) => b.required), ...(phase.featureIds || []).map((featureId) => ({ featureId }))];
  for (const b of requiredFeatures) {
    const feat = (ctx.features || []).find((f) => f.id === b.featureId);
    const ok = feat && !feat.stale && ["VERIFIED", "RELEASED"].includes(feat.projectStatus || feat.status);
    if (!ok) reasons.push(`Required feature ${b.featureId} is not verified`);
    checks.push({ kind: "feature", id: b.featureId, ok: !!ok, status: feat?.projectStatus || feat?.status || "missing", label: feat?.name || b.featureId });
  }

  const failed = checkpoints.some((c) => c.required !== false && (c.status === "FAILED" || c.status === "BLOCKED"));
  const ready = reasons.length === 0;
  let derived = phase.status;
  if (phase.status === "COMPLETED" || phase.status === "CANCELLED") derived = phase.status;
  else if (failed) derived = "BLOCKED";
  else if (ready && phase.status === "IN_PROGRESS") derived = "READY";
  else derived = phase.status;

  return { ready, blocked: failed, reasons, checks, derived, progress: objectiveProgress(phase.objectives) };
}

/** Latest evidence controls the outcome: an older success cannot mask a failure. */
export function checkpointEvidenceReady(checkpoint) {
  const evidence = (checkpoint.evidence || []).at(-1);
  if (!evidence) return checkpoint.evidenceRequired === false;
  const failedAt = (checkpoint.history || []).filter((h) => h.status === "FAILED").at(-1)?.at;
  return evidence.ok === true && evidence.valid === true && !evidence.skipped
    && (!failedAt || (evidence.at && evidence.at > failedAt));
}

export function checkpointMatrix(phases, checkpoints) {
  const types = [];
  for (const t of CHECKPOINT_TYPES) {
    if (checkpoints.some((c) => c.type === t.type)) types.push(t);
  }
  const cells = types.map((t) => {
    const row = { type: t.type, name: t.name, byPhase: {} };
    for (const p of phases) {
      const c = checkpoints.find((x) => x.phaseId === p.id && x.type === t.type);
      row.byPhase[p.id] = c
        ? { id: c.id, status: c.status, required: c.required !== false }
        : { id: null, status: "NOT_APPLICABLE", required: false };
    }
    return row;
  });
  return { phases: phases.map((p) => ({ id: p.id, name: p.name, order: p.order })), types: cells };
}

export function matrixGlyph(status) {
  return ({
    PASSED: "✓",
    WAIVED: "✓",
    IN_PROGRESS: "●",
    READY_FOR_REVIEW: "●",
    NOT_STARTED: "○",
    FAILED: "✗",
    BLOCKED: "!",
    NOT_APPLICABLE: "-",
  })[status] || "?";
}

export function projectFeatures(featureMap, delivery) {
  const bindings = delivery?.featureBindings || [];
  const features = featureMap?.features || {};
  const out = [];
  const seen = new Set();
  for (const [id, f] of Object.entries(features)) {
    seen.add(id);
    const bind = bindings.filter((b) => b.featureId === id);
    out.push({
      id,
      name: f.name || id,
      description: f.description || "",
      mapStatus: f.status || "traced",
      projectStatus: bind[0]?.status || mapStatusToProject(f.status, f),
      confidence: f.confidence || "detected",
      stale: f.stale ?? null,
      phaseIds: bind.map((b) => b.phaseId).filter(Boolean),
      ideaIds: bind.map((b) => b.ideaId).filter(Boolean),
      requirementIds: f.requirementIds || bind.flatMap((b) => b.requirementIds || []),
      files: (f.files || []).length,
      tests: (f.tests || []).length,
      entryPoints: f.entryPoints || [],
      evidence: f.evidence || [],
      source: "feature-map",
    });
  }
  for (const b of bindings) {
    if (seen.has(b.featureId)) continue;
    seen.add(b.featureId);
    const related = bindings.filter((item) => item.featureId === b.featureId);
    out.push({
      id: b.featureId,
      name: b.title || b.featureId,
      description: b.description || "",
      mapStatus: null,
      projectStatus: b.status || "PLANNED",
      confidence: "confirmed",
      stale: false,
      phaseIds: [...new Set(related.map((item) => item.phaseId).filter(Boolean))],
      ideaIds: [...new Set(related.map((item) => item.ideaId).filter(Boolean))],
      requirementIds: b.requirementIds || [],
      files: 0,
      tests: 0,
      entryPoints: [],
      evidence: [],
      source: "project-overlay",
    });
  }
  return out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function mapStatusToProject(status) {
  const s = String(status || "").toLowerCase();
  if (s === "traced" || s === "implemented") return "IMPLEMENTED";
  if (s === "planned") return "PLANNED";
  return "UNKNOWN";
}

export function ideaTrace(idea, ctx = {}) {
  const features = (ctx.features || []).filter((f) => (idea.featureIds || []).includes(f.id) || (f.ideaIds || []).includes(idea.id));
  const phase = (ctx.phases || []).find((p) => p.id === idea.phaseId);
  const chks = (ctx.checkpoints || []).filter((c) => (idea.checkpointIds || []).includes(c.id) || (phase && c.phaseId === phase.id && (c.featureIds || []).some((id) => (idea.featureIds || []).includes(id))));
  return {
    id: idea.id,
    title: idea.title,
    status: idea.status,
    decision: idea.decision || null,
    phase: phase ? { id: phase.id, name: phase.name } : null,
    requirements: idea.requirementIds || [],
    features: features.map((f) => ({ id: f.id, name: f.name, status: f.projectStatus || f.status })),
    tasks: idea.taskIds || [],
    implementation: idea.implementationRefs || [],
    tests: idea.testRefs || [],
    checkpoints: chks.map((c) => ({ id: c.id, name: c.name, status: c.status })),
    evidence: idea.evidence || [],
    release: idea.releaseId || null,
    gaps: traceQuery(idea.id, { ...ctx, ideas: [idea, ...(ctx.ideas || []).filter((x) => x.id !== idea.id)] }).missing,
  };
}

function rec({ id, category, rule, what, why, evidence, impact, effort, risk, nextAction, entities, source = "rule" }) {
  return {
    id, category, rule, what, why,
    evidence: evidence || [],
    impact: impact || null,
    effort: effort || "UNKNOWN",
    risk: risk || "UNKNOWN",
    nextAction: nextAction || null,
    entities: entities || [],
    source,
    status: "OPEN",
  };
}

/**
 * Explainable recommendation engine. Every item names the rule that fired.
 * AI suggestions are out of scope here (source would be "ai").
 */
export function recommend(ctx = {}) {
  const out = [];
  const phases = ctx.phases || [];
  const checkpoints = ctx.checkpoints || [];
  const ideas = ctx.ideas || [];
  const features = ctx.features || [];
  const requirements = ctx.requirements || [];
  const ac = ctx.ac || null;
  const dispositions = ctx.dispositions || {};
  let n = 1;
  const id = () => `REC-${String(n++).padStart(3, "0")}`;

  const active = phases.find((p) => p.status === "IN_PROGRESS") || phases.find((p) => p.id === ctx.currentDeliveryPhaseId);
  if (active) {
    const r = phaseReadiness(active, ctx);
    if (!r.ready) {
      out.push(rec({
        id: id(), category: "missing", rule: "phase-exit-unsatisfied",
        what: `${active.name} is not ready to complete`,
        why: r.reasons.join("; ") || "Exit criteria unmet.",
        evidence: r.reasons.map((x) => ({ text: x })),
        impact: active.id, effort: "M", risk: r.blocked ? "HIGH" : "MED",
        nextAction: `Complete the missing conditions on ${active.id}, then: node .cursor/tools/project.mjs delivery complete ${active.id}`,
        entities: [active.id, ...r.checks.filter((c) => !c.ok).map((c) => c.id)],
      }));
    }
    for (const obj of active.objectives || []) {
      if (obj.required !== false && obj.status !== "COMPLETE") {
        out.push(rec({
          id: id(), category: "missing", rule: "incomplete-phase-objective",
          what: `Complete objective: ${obj.title}`,
          why: `${active.name} lists this as a required objective and it is ${obj.status || "UNKNOWN"}.`,
          evidence: [{ text: `${obj.id} status=${obj.status}` }],
          impact: active.id, effort: "S", risk: "MED",
          nextAction: `node .cursor/tools/project.mjs delivery objective ${active.id} ${obj.id} --status COMPLETE`,
          entities: [active.id, obj.id],
        }));
      }
    }
  }

  for (const c of checkpoints) {
    if (c.required !== false && (c.status === "BLOCKED" || c.status === "FAILED")) {
      const phase = phases.find((p) => p.id === c.phaseId);
      out.push(rec({
        id: id(), category: "risk", rule: "required-checkpoint-blocked",
        what: `Unblock checkpoint ${c.name}`,
        why: `${c.name} is ${c.status} and is required for ${phase?.name || c.phaseId}.`,
        evidence: (c.evidence || []).length ? c.evidence : [{ text: `status=${c.status}` }],
        impact: c.phaseId, effort: "M", risk: "HIGH",
        nextAction: `Inspect evidence on ${c.id}, fix the cause, then project.mjs checkpoint verify ${c.id}`,
        entities: [c.id, c.phaseId, ...(c.featureIds || [])],
      }));
    }
    if (c.status === "PASSED" && !checkpointEvidenceReady(c)) {
      out.push(rec({
        id: id(), category: "risk", rule: "passed-without-evidence",
        what: `Attach evidence to ${c.name}`,
        why: "A PASSED checkpoint with evidenceRequired cannot stand on a typed status alone.",
        evidence: [{ text: `${c.id} status=PASSED evidence=[]` }],
        impact: c.phaseId, effort: "S", risk: "MED",
        nextAction: `node .cursor/tools/project.mjs checkpoint pass ${c.id} --evidence <ref>`,
        entities: [c.id],
      }));
    }
  }

  for (const idea of ideas) {
    if (["APPROVED", "SPECIFIED"].includes(idea.status) && !(idea.featureIds || []).length) {
      out.push(rec({
        id: id(), category: "missing", rule: "approved-idea-without-feature",
        what: `Create or bind a feature for ${idea.id}`,
        why: `${idea.id} is ${idea.status} and has no feature id, so it cannot move through implementation.`,
        evidence: [{ text: `status=${idea.status} featureIds=[]` }],
        impact: idea.id, effort: "S", risk: "LOW",
        nextAction: `node .cursor/tools/project.mjs idea implement ${idea.id} --feature <id>`,
        entities: [idea.id],
      }));
    }
    if (idea.status === "PARKED" && (idea.value === "HIGH" || idea.priority === "HIGH")) {
      out.push(rec({
        id: id(), category: "opportunity", rule: "high-value-idea-parked",
        what: `Re-evaluate parked idea ${idea.id}`,
        why: `${idea.title} is HIGH value and PARKED.`,
        evidence: [{ text: `value=${idea.value || idea.priority} status=PARKED` }],
        impact: idea.id, effort: "S", risk: "LOW",
        nextAction: `node .cursor/tools/project.mjs idea evaluate ${idea.id}`,
        entities: [idea.id],
        source: "detected-gap",
      }));
    }
  }

  for (const req of requirements) {
    const linked = features.some((f) => (f.requirementIds || []).includes(req.id))
      || ideas.some((i) => (i.requirementIds || []).includes(req.id));
    if (!linked) {
      out.push(rec({
        id: id(), category: "missing", rule: "unlinked-requirement",
        what: `Plan a feature for ${req.id}`,
        why: "The requirement is in the id graph and no feature or idea cites it.",
        evidence: [{ text: `${req.id} in ${req.file || "id graph"}` }],
        impact: req.id, effort: "M", risk: "MED",
        nextAction: `Bind ${req.id} on a feature overlay or an idea (--requirement ${req.id}).`,
        entities: [req.id],
        source: "detected-gap",
      }));
    }
  }

  if (ac && typeof ac.uncovered === "number" && ac.acs > 0 && ac.uncovered > 0) {
    out.push(rec({
      id: id(), category: "enhancement", rule: "incomplete-ac-coverage",
      what: "Add tests for uncovered acceptance criteria",
      why: `${ac.uncovered} of ${ac.acs} acceptance criteria have no claiming test.`,
      evidence: (ac.uncoveredIds || []).slice(0, 8).map((x) => ({ text: String(x) })),
      impact: `${ac.uncovered} criteria`, effort: "M", risk: "MED",
      nextAction: "node .cursor/tools/ac-trace.mjs check --json",
      entities: ac.uncoveredIds || [],
    }));
  }

  for (const f of features) {
    if (f.source === "feature-map" && f.files > 0 && f.tests === 0 && f.projectStatus !== "PLANNED") {
      out.push(rec({
        id: id(), category: "missing", rule: "feature-without-tests",
        what: `Add tests for ${f.id}`,
        why: "The feature is traced in code and lists no tests in the feature map.",
        evidence: [{ text: `${f.id} files=${f.files} tests=0` }],
        impact: f.id, effort: "M", risk: "MED",
        nextAction: `/feature-trace "${f.name}" after adding tests, or overlay test refs.`,
        entities: [f.id],
        source: "detected-gap",
      }));
    }
    if (f.stale) {
      out.push(rec({
        id: id(), category: "risk", rule: "stale-feature-trace",
        what: `Refresh the trace for ${f.id}`,
        why: "feature-map.mjs reports this trace as stale — files moved underneath it.",
        evidence: [{ text: "stale=true" }],
        impact: f.id, effort: "S", risk: "MED",
        nextAction: `/feature-trace "${f.name}"`,
        entities: [f.id],
      }));
    }
  }

  for (const idea of ideas) {
    if (idea.status !== "VERIFIED" && idea.status !== "RELEASED") continue;
    for (const fid of idea.featureIds || []) {
      const feat = features.find((f) => f.id === fid);
      const status = feat?.projectStatus || feat?.status || "missing";
      if (!["VERIFIED", "RELEASED"].includes(status)) {
        out.push(rec({
          id: id(), category: "risk", rule: "idea-verified-feature-not",
          what: `${idea.id} is ${idea.status} but ${fid} is ${status}`,
          why: "Idea verification is a review of that idea; it does not verify the feature. Bind evidence on the feature before treating delivery as complete.",
          evidence: [{ text: `${idea.id} status=${idea.status} ${fid} status=${status}` }],
          impact: fid, effort: "M", risk: "HIGH",
          nextAction: `Inspect the feature trace and record feature verification separately from ${idea.id}.`,
          entities: [idea.id, fid],
          source: "detected-gap",
        }));
      }
    }
  }

  for (const risk of ctx.risks || []) {
    if (!riskIsOpenBlocking(risk)) continue;
    out.push(rec({
      id: id(), category: "risk", rule: "open-register-risk",
      what: `Resolve ${risk.id}: ${risk.title || "untitled risk"}`,
      why: risk.phaseId
        ? `${risk.id} is ${risk.status} and retires in ${risk.phaseId}.`
        : `${risk.id} is in the risk register and is not linked to a delivery phase.`,
      evidence: [{ text: `${risk.source || "docs/analysis/risks.md"} owner=${risk.owner || "unowned"} severity=${risk.severity}` }],
      impact: risk.phaseId || active?.id || risk.id, effort: "M", risk: risk.severity || "HIGH",
      nextAction: risk.phaseId
        ? `Retire or accept ${risk.id} before completing ${risk.phaseId}.`
        : `Link ${risk.id} to a delivery phase or close it in docs/analysis/risks.md.`,
      entities: [risk.id, risk.phaseId].filter(Boolean),
      source: "detected-gap",
    }));
  }

  if (active) {
    const hasSec = checkpoints.some((c) => c.phaseId === active.id && c.type === "security");
    if (["integration", "hardening", "launch"].includes(active.slug) && !hasSec) {
      out.push(rec({
        id: id(), category: "missing", rule: "security-checkpoint-missing",
        what: `Add a security checkpoint to ${active.name}`,
        why: "Integration/hardening/launch without a security checkpoint leaves the gate unnamed.",
        evidence: [{ text: `${active.id} slug=${active.slug}` }],
        impact: active.id, effort: "S", risk: "HIGH",
        nextAction: `node .cursor/tools/project.mjs checkpoint add --phase ${active.id} --type security`,
        entities: [active.id],
      }));
    }
    const hasPerf = checkpoints.some((c) => c.phaseId === active.id && c.type === "performance");
    if (["hardening", "release-prep"].includes(active.slug) && !hasPerf) {
      out.push(rec({
        id: id(), category: "missing", rule: "performance-checkpoint-missing",
        what: `Add a performance checkpoint to ${active.name}`,
        why: "Hardening/release-prep without a performance checkpoint leaves latency unowned.",
        evidence: [{ text: `${active.id} slug=${active.slug}` }],
        impact: active.id, effort: "S", risk: "MED",
        nextAction: `node .cursor/tools/project.mjs checkpoint add --phase ${active.id} --type performance`,
        entities: [active.id],
      }));
    }
    const hasObs = checkpoints.some((c) => c.phaseId === active.id && c.type === "observability");
    if (["hardening", "launch"].includes(active.slug) && !hasObs) {
      out.push(rec({
        id: id(), category: "missing", rule: "observability-checkpoint-missing",
        what: `Add an observability checkpoint to ${active.name}`,
        why: "Hardening/launch without an observability checkpoint leaves failure modes unnamed.",
        evidence: [{ text: `${active.id} slug=${active.slug}` }],
        impact: active.id, effort: "S", risk: "MED",
        nextAction: `node .cursor/tools/project.mjs checkpoint add --phase ${active.id} --type observability`,
        entities: [active.id],
      }));
    }
  }

  const adapters = ctx.adapters || {};
  if (adapters.security && adapters.security.available === false) {
    out.push(rec({
      id: id(), category: "missing", rule: "security-adapter-unavailable",
      what: "Record a security review or add a threat-model / security-design document",
      why: adapters.security.reason || "Security health has no canonical adapter result.",
      evidence: [{ text: adapters.security.reason || "unavailable" }],
      impact: active?.id || "security", effort: "M", risk: "HIGH",
      nextAction: "Add docs/design/security-design.md or docs/design/threat-model.md, or run incidents.mjs check after recording a guard.",
      entities: ["security"],
      source: "detected-gap",
    }));
  } else if (adapters.security?.available && adapters.security.ok === false) {
    out.push(rec({
      id: id(), category: "risk", rule: "security-verification-gap",
      what: "Resolve blocking security adapter findings",
      why: adapters.security.summary || "The security adapter reported blocking findings.",
      evidence: [{ text: adapters.security.summary || "security adapter" }],
      impact: "security", effort: "M", risk: "HIGH",
      nextAction: adapters.security.source ? `Inspect ${adapters.security.source}` : "Inspect the security adapter findings.",
      entities: ["security"],
      source: "detected-gap",
    }));
  }
  if (adapters.observability?.available && adapters.observability.ok === false) {
    out.push(rec({
      id: id(), category: "risk", rule: "observability-verification-gap",
      what: "Close blocking failure-mode findings",
      why: adapters.observability.summary || "failure-modes.mjs reported blocking findings.",
      evidence: [{ text: adapters.observability.summary || "failure-modes" }],
      impact: "observability", effort: "M", risk: "HIGH",
      nextAction: "node .cursor/tools/failure-modes.mjs check --json",
      entities: ["observability"],
      source: "detected-gap",
    }));
  }
  if (adapters.debt?.available && adapters.debt.ok === false) {
    out.push(rec({
      id: id(), category: "risk", rule: "flag-debt-expired",
      what: "Remove or re-date expired feature flags",
      why: adapters.debt.summary || "flag-debt.mjs reported expired or undeclared flags.",
      evidence: [{ text: adapters.debt.summary || "flag-debt" }],
      impact: "debt", effort: "S", risk: "MED",
      nextAction: "node .cursor/tools/flag-debt.mjs scan --json",
      entities: ["debt"],
      source: "detected-gap",
    }));
  }
  if (adapters.release?.available && adapters.release.ok === false) {
    out.push(rec({
      id: id(), category: "risk", rule: "unsigned-release-evidence",
      what: "Sign or drop unsigned release records",
      why: adapters.release.summary || "A release record exists without a signature.",
      evidence: [{ text: adapters.release.summary || "lifecycle/releases" }],
      impact: "release", effort: "S", risk: "HIGH",
      nextAction: "node .cursor/tools/release-evidence.mjs verify",
      entities: ["release"],
      source: "detected-gap",
    }));
  }
  if (adapters.performance && adapters.performance.available === false && active && ["hardening", "release-prep"].includes(active.slug)) {
    out.push(rec({
      id: id(), category: "missing", rule: "performance-evidence-missing",
      what: `Evidence a performance checkpoint on ${active.name}`,
      why: adapters.performance.reason || "No load-test path or evidenced performance checkpoint.",
      evidence: [{ text: adapters.performance.reason || "unavailable" }],
      impact: active.id, effort: "M", risk: "MED",
      nextAction: `Attach --evidence for a performance checkpoint on ${active.id}`,
      entities: [active.id, "performance"],
      source: "detected-gap",
    }));
  }

  for (const idea of ideas) {
    if (["APPROVED", "SPECIFIED", "IMPLEMENTING", "VERIFIED", "RELEASED"].includes(idea.status) && idea.decision && !idea.decisionId) {
      out.push(rec({
        id: id(), category: "missing", rule: "canonical-decision-missing",
        what: `Bind a canonical decision id on ${idea.id}`,
        why: VERIFICATION_CONTRACT.decisions,
        evidence: [{ text: `${idea.id} has inline decision but no decisionId` }],
        impact: idea.id, effort: "S", risk: "LOW",
        nextAction: `node .cursor/tools/project.mjs idea show ${idea.id} then re-run with --decision ADR-NNNN`,
        entities: [idea.id],
        source: "detected-gap",
      }));
    }
  }

  for (const r of out) {
    // Position-based REC-001 ids are unsafe to persist: resolving an earlier
    // finding would transfer its dismissal to a different entity.
    r.id = `REC-${createHash("sha256").update(JSON.stringify([r.rule, r.entities[0] || "project"])).digest("hex").slice(0, 16)}`;
    const d = dispositions[r.id] || dispositions[r.rule];
    if (d?.status) r.status = d.status;
    if (d?.note) r.dispositionNote = d.note;
  }
  return out.filter((r) => r.status !== "DISMISSED");
}

export function buildGraph(ctx = {}) {
  const nodes = [];
  const edges = [];
  const add = (n) => { if (!nodes.some((x) => x.id === n.id)) nodes.push(n); };
  const link = (from, to, kind) => { if (from && to) edges.push({ from, to, kind }); };

  const project = ctx.project;
  if (project) add({ id: project.id, kind: "project", label: project.name, href: "overview" });

  for (const p of ctx.lifecyclePhases || []) {
    add({ id: `LIFECYCLE:${p.name}`, kind: "lifecycle-phase", label: p.name, status: p.status });
    if (project) link(project.id, `LIFECYCLE:${p.name}`, "contains");
  }
  for (const p of ctx.phases || []) {
    add({ id: p.id, kind: "delivery-phase", label: p.name, status: p.status });
    if (project) link(project.id, p.id, "contains");
    for (const d of p.dependencies || []) link(d, p.id, "precedes");
  }
  for (const c of ctx.checkpoints || []) {
    add({ id: c.id, kind: "checkpoint", label: c.name, status: c.status });
    link(c.phaseId, c.id, "gated-by");
  }
  for (const f of ctx.features || []) {
    add({ id: f.id, kind: "feature", label: f.name || f.id, status: f.projectStatus || f.status, href: f.source || "features", source: f.source || null });
    for (const ph of f.phaseIds || []) link(ph, f.id, "delivers");
    for (const req of f.requirementIds || []) {
      add({ id: req, kind: "requirement", label: req, href: "traceability" });
      link(req, f.id, "traces-to");
    }
    for (const tid of f.taskIds || []) {
      const task = (ctx.tasks || []).find((t) => t.id === tid) || { id: tid };
      add({ id: tid, kind: "task", label: task.title || tid, href: task.file || "task-graph", source: task.file || null });
      link(f.id, tid, "implemented-by");
    }
    for (const ref of Array.isArray(f.fileRefs) ? f.fileRefs : []) {
      const nid = `code:${ref}`;
      add({ id: nid, kind: "code", label: ref, href: ref, source: ref });
      link(f.id, nid, "implemented-in");
    }
    for (const ref of Array.isArray(f.testRefs) ? f.testRefs : []) {
      const nid = `test:${ref}`;
      add({ id: nid, kind: "test", label: ref, href: ref, source: ref });
      link(f.id, nid, "verified-by");
    }
  }
  for (const idea of ctx.ideas || []) {
    add({ id: idea.id, kind: "idea", label: idea.title, status: idea.status, href: "ideas" });
    if (project) link(project.id, idea.id, "contains");
    if (idea.phaseId) link(idea.phaseId, idea.id, "schedules");
    for (const fid of idea.featureIds || []) link(idea.id, fid, "became");
    for (const req of idea.requirementIds || []) {
      add({ id: req, kind: "requirement", label: req, href: "traceability" });
      link(idea.id, req, "traces-to");
    }
    for (const tid of idea.taskIds || []) {
      const task = (ctx.tasks || []).find((t) => t.id === tid) || { id: tid };
      add({ id: tid, kind: "task", label: task.title || tid, href: task.file || "task-graph", source: task.file || null });
      link(idea.id, tid, "scheduled-as");
    }
    for (const ref of idea.implementationRefs || []) {
      const nid = `code:${ref}`;
      add({ id: nid, kind: "code", label: ref, href: ref, source: ref });
      link(idea.id, nid, "implemented-in");
    }
    for (const ref of idea.testRefs || []) {
      const nid = `test:${ref}`;
      add({ id: nid, kind: "test", label: ref, href: ref, source: ref });
      link(idea.id, nid, "verified-by");
    }
    if (idea.decisionId) {
      add({ id: idea.decisionId, kind: "decision", label: idea.decisionId, href: "decisions", source: "decision-memory" });
      link(idea.id, idea.decisionId, "decided-by");
    }
    if (idea.releaseId) {
      add({ id: idea.releaseId, kind: "release", label: idea.releaseId, href: "delivery" });
      link(idea.id, idea.releaseId, "released-in");
    }
    for (const ev of idea.evidence || []) {
      const eid = ev.id || `EV-${idea.id}`;
      add({ id: eid, kind: "evidence", label: ev.ref || ev.summary || eid, href: ev.ref || null, source: ev.ref || null, status: ev.valid === false ? "stale" : (ev.ok ? "ok" : "unknown") });
      link(idea.id, eid, "evidenced-by");
    }
  }
  for (const c of ctx.checkpoints || []) {
    for (const ev of c.evidence || []) {
      const eid = ev.id || `EV-${c.id}`;
      add({ id: eid, kind: "evidence", label: ev.ref || ev.summary || eid, href: ev.ref || null, source: ev.ref || ev.kind || null, status: ev.valid === false ? "stale" : (ev.ok ? "ok" : "unknown") });
      link(c.id, eid, "evidenced-by");
    }
  }
  for (const rel of ctx.releases || []) {
    add({ id: rel.version || rel.id, kind: "release", label: rel.version || rel.id, status: rel.signature ? "signed" : "unsigned", href: "delivery" });
  }
  for (const risk of ctx.risks || []) {
    add({ id: risk.id, kind: "risk", label: risk.title || risk.id, status: risk.status, href: risk.source, source: risk.source });
    if (risk.phaseId) link(risk.phaseId, risk.id, "retires");
    for (const cid of risk.checkpointIds || []) link(cid, risk.id, "mitigates");
  }
  for (const ms of ctx.milestones || []) {
    add({ id: ms.id, kind: "milestone", label: ms.title || ms.id, status: ms.status, href: "roadmap" });
    if (ms.phaseId) link(ms.phaseId, ms.id, "targets");
    if (ms.releaseId) link(ms.id, ms.releaseId, "ships-in");
    for (const fid of ms.featureIds || []) link(ms.id, fid, "includes");
  }
  for (const task of ctx.tasks || []) {
    add({ id: task.id, kind: "task", label: task.title || task.id, href: task.file || "task-graph", source: task.file || null });
  }
  return { nodes, edges };
}

export function buildTimeline(events) {
  const list = (events || []).filter((e) => e && e.at).slice();
  list.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return list;
}

export function healthView(ctx = {}) {
  const metrics = [];
  const push = (id, label, value, kind, note) => metrics.push({ id, label, value, kind, note });

  if (ctx.lifecycle) {
    push("lifecycle", "Lifecycle", ctx.lifecycle.phase || "not adopted",
      ctx.lifecycle.adopted ? "measured" : "unknown",
      ctx.lifecycle.phaseStatus || ctx.lifecycle.hint || null);
  } else {
    push("lifecycle", "Lifecycle", "Not measured", "unknown", "No lifecycle/state.json");
  }

  const active = (ctx.phases || []).find((p) => p.status === "IN_PROGRESS");
  if (active) {
    const r = phaseReadiness(active, ctx);
    push("delivery", "Delivery phase", `${active.name} · ${r.derived}`, r.blocked ? "bad" : "measured", r.reasons[0] || r.progress.label);
  } else if (!(ctx.phases || []).length) {
    push("delivery", "Delivery phase", "Not initialised", "unknown", "Run project.mjs init");
  } else {
    push("delivery", "Delivery phase", "No phase IN_PROGRESS", "measured", null);
  }

  const chks = ctx.checkpoints || [];
  const required = chks.filter((c) => c.required !== false && c.status !== "NOT_APPLICABLE");
  const passed = required.filter((c) => (c.status === "PASSED" && checkpointEvidenceReady(c)) || c.status === "WAIVED");
  if (required.length) {
    push("checkpoints", "Required checkpoints", `${passed.length} / ${required.length} passed`, "measured", null);
  } else {
    push("checkpoints", "Required checkpoints", "Not measured", "unknown", "No checkpoints in project/delivery.json");
  }

  if (ctx.ac && ctx.ac.acs) {
    push("ac", "AC coverage", `${ctx.ac.covered} / ${ctx.ac.acs} covered`, "measured", ctx.ac.uncovered ? `${ctx.ac.uncovered} uncovered` : null);
  } else {
    push("ac", "AC coverage", "Not measured", "unknown", "No AC-N criteria found");
  }

  const feats = ctx.features || [];
  if (feats.length) {
    const by = {};
    for (const f of feats) by[f.projectStatus || "UNKNOWN"] = (by[f.projectStatus || "UNKNOWN"] || 0) + 1;
    push("features", "Features", String(feats.length), "measured", Object.entries(by).map(([k, v]) => `${v} ${k}`).join(", "));
  } else {
    push("features", "Features", "Not measured", "unknown", "No feature-map.json and no overlay");
  }

  const ideas = ctx.ideas || [];
  if (ideas.length) {
    push("ideas", "Ideas", String(ideas.length), "measured",
      `${ideas.filter((i) => i.status === "APPROVED" || i.status === "IMPLEMENTING").length} in flight`);
  } else {
    push("ideas", "Ideas", "0", "measured", "None captured yet");
  }

  if (typeof ctx.traceDangling === "number") {
    push("traceability", "Dangling ids", String(ctx.traceDangling), ctx.traceDangling ? "bad" : "measured", null);
  } else {
    push("traceability", "Traceability", "Not measured", "unknown", "Id graph empty or unreadable");
  }

  if (typeof ctx.openRisks === "number") {
    push("risks", "Open risks", String(ctx.openRisks), ctx.openRisks ? "warn" : "measured", null);
  } else {
    push("risks", "Open risks", "Not measured", "unknown", "No risk register parsed");
  }

  const stale = feats.filter((f) => f.stale).length;
  if (feats.some((f) => f.source === "feature-map") && feats.filter((f) => f.source === "feature-map").every((f) => typeof f.stale === "boolean")) {
    push("stale", "Stale traces", String(stale), stale ? "warn" : "measured", null);
  } else {
    push("stale", "Stale traces", "Not measured", "unknown", "No traces");
  }

  if (ctx.securityFindings == null) {
    metrics.push(adapterMetric("security", "Security", ctx.adapters?.security));
  } else {
    push("security", "Security findings", String(ctx.securityFindings), ctx.securityFindings ? "bad" : "measured", null);
  }

  for (const [id, label] of [["performance", "Performance"], ["observability", "Observability"], ["debt", "Flag / debt"], ["release", "Release evidence"]]) {
    metrics.push(adapterMetric(id, label, ctx.adapters?.[id]));
  }

  return { metrics, fabricated: false };
}

/** Map a canonical tool/document adapter into a health metric. Unavailable stays unknown. */
export function adapterMetric(id, label, adapter) {
  if (!adapter || adapter.available === false) {
    return {
      id, label, value: "Not measured", kind: "unknown",
      note: adapter?.reason || `No canonical ${label.toLowerCase()} adapter result`,
    };
  }
  if (adapter.skipped) {
    return {
      id, label, value: "Not measured", kind: "unknown",
      note: adapter.summary || adapter.reason || `${label} skipped (nothing to check)`,
    };
  }
  const blocks = adapter.counts?.block;
  if (typeof blocks === "number") {
    return {
      id, label,
      value: blocks === 0 ? "no blocking findings" : `${blocks} blocking`,
      kind: blocks ? "bad" : "measured",
      note: adapter.summary || adapter.source || null,
    };
  }
  if (adapter.ok === true) {
    return { id, label, value: adapter.summary || "measured", kind: "measured", note: adapter.source || null };
  }
  if (adapter.ok === false) {
    return { id, label, value: adapter.summary || "failed", kind: "bad", note: adapter.source || null };
  }
  return { id, label, value: adapter.summary || "See adapter", kind: "measured", note: adapter.source || null };
}

export function blockers(ctx = {}) {
  const out = [];
  for (const c of ctx.checkpoints || []) {
    if (c.status === "FAILED" || c.status === "BLOCKED") {
      const phase = (ctx.phases || []).find((p) => p.id === c.phaseId);
      out.push({
        id: `BLOCKER-${c.id}`,
        title: `${c.name} ${c.status.toLowerCase()}`,
        severity: "HIGH",
        phaseId: c.phaseId,
        phaseName: phase?.name,
        checkpointId: c.id,
        featureIds: c.featureIds || [],
        requirementIds: c.requirementIds || [],
        riskIds: c.riskIds || [],
        evidence: c.evidence || [],
        reason: c.notes || `Checkpoint is ${c.status}.`,
        action: `Verify and re-run: node .cursor/tools/project.mjs checkpoint verify ${c.id}`,
      });
    }
  }
  for (const p of ctx.phases || []) {
    if (p.status === "BLOCKED") {
      out.push({
        id: `BLOCKER-${p.id}`,
        title: `${p.name} is BLOCKED`,
        severity: "HIGH",
        phaseId: p.id,
        phaseName: p.name,
        checkpointId: null,
        featureIds: p.featureIds || [],
        requirementIds: p.requirementIds || [],
        riskIds: p.riskIds || [],
        evidence: p.evidence || [],
        reason: "Phase status is BLOCKED.",
        action: `Inspect checkpoints for ${p.id}`,
      });
    }
  }
  for (const f of ctx.features || []) {
    if (f.projectStatus === "BLOCKED") {
      out.push({
        id: `BLOCKER-${f.id}`,
        title: `${f.id} blocked`,
        severity: "MED",
        phaseId: (f.phaseIds || [])[0] || null,
        featureIds: [f.id],
        requirementIds: f.requirementIds || [],
        riskIds: [],
        evidence: [],
        reason: "Feature overlay status is BLOCKED.",
        action: `Inspect ${f.id}`,
      });
    }
  }
  for (const risk of ctx.risks || []) {
    if (!riskIsOpenBlocking(risk)) continue;
    out.push({
      id: `BLOCKER-${risk.id}`,
      title: `${risk.id} ${risk.title || "open risk"}`,
      severity: risk.severity || "HIGH",
      phaseId: risk.phaseId || ctx.currentDeliveryPhaseId || null,
      phaseName: (ctx.phases || []).find((p) => p.id === risk.phaseId)?.name,
      checkpointId: (risk.checkpointIds || [])[0] || null,
      featureIds: risk.featureIds || [],
      requirementIds: risk.requirementIds || [],
      riskIds: [risk.id],
      evidence: [],
      reason: risk.phaseId
        ? `${risk.id} is ${risk.status} in the risk register (${risk.source || "docs/analysis/risks.md"}).`
        : `${risk.id} is an unlinked register risk; it is not attached to a delivery phase.`,
      action: risk.owner
        ? `Owner ${risk.owner} must retire or accept ${risk.id}.`
        : `Name an owner for ${risk.id} in the risk register.`,
    });
  }
  return out;
}

export function roadmap(ctx = {}) {
  const phases = [...(ctx.phases || [])].sort((a, b) => a.order - b.order);
  const ideas = ctx.ideas || [];
  const now = phases.filter((p) => p.status === "IN_PROGRESS" || p.status === "BLOCKED");
  const next = phases.filter((p) => p.status === "READY" || p.status === "PLANNED" || p.status === "NEEDS_REVIEW");
  const done = phases.filter((p) => p.status === "COMPLETED");
  const plannedIdeas = ideas.filter((i) => ["APPROVED", "SPECIFIED", "CAPTURED", "EVALUATING"].includes(i.status) && !now.some((p) => p.id === i.phaseId));
  const future = ideas.filter((i) => i.status === "PARKED");
  const features = (ctx.features || []).filter((f) => (f.phaseIds || []).length || f.projectStatus === "PLANNED");
  const releases = (ctx.releases || []).map((r) => ({
    id: r.version || r.id,
    signed: !!r.signature,
    at: r.at || r.signedAt || null,
    ideas: ideas.filter((i) => i.releaseId === (r.version || r.id)).map((i) => i.id),
    features: (ctx.featureBindings || []).filter((b) => b.releaseId === (r.version || r.id)).map((b) => b.featureId),
  }));
  const milestones = [
    ...(ctx.milestones || []),
    ...phases.filter((p) => p.targetDate).map((p) => ({
      id: `MS-${p.id}`,
      title: `${p.name} target`,
      date: p.targetDate,
      phaseId: p.id,
      featureIds: p.featureIds || [],
      releaseId: p.releaseId || null,
      status: p.status === "COMPLETED" ? "MET" : "PLANNED",
      derived: true,
    })),
  ];
  return {
    now: now.map((p) => ({ ...p, progress: objectiveProgress(p.objectives) })),
    next: next.slice(0, 3),
    done,
    planned: plannedIdeas,
    future,
    features: features.map((f) => ({ id: f.id, name: f.name || f.id, status: f.projectStatus || f.status, phaseIds: f.phaseIds || [] })),
    releases,
    milestones,
  };
}

function walkFiles(dir, { depth = 0, maxDepth = 4, ext = null, names = null, maxFiles = 4000, maxHits = 80, state } = {}, acc = []) {
  const tally = state || { files: 0, truncated: false, hitsTruncated: false };
  if (depth > maxDepth || tally.truncated) return acc;
  let entries;
  try { entries = ctxReaddir(dir); } catch { return acc; }
  for (const n of entries) {
    if (n.startsWith(".") || SKIP_DIRS.has(n) || n === "templates") continue;
    const p = joinPath(dir, n);
    let st;
    try { st = ctxStat(p); } catch { continue; }
    if (st.isDirectory()) {
      walkFiles(p, { depth: depth + 1, maxDepth, ext, names, maxFiles, maxHits, state: tally }, acc);
      if (tally.truncated) return acc;
      continue;
    }
    tally.files++;
    if (tally.files >= maxFiles) tally.truncated = true;
    const hit = (ext && n.toLowerCase().endsWith(ext)) || (names && names.has(n));
    if (!hit) continue;
    if (acc.length >= maxHits) tally.hitsTruncated = true;
    else acc.push(p);
  }
  return acc;
}

let fsApi = null;
function joinPath(...parts) { return fsApi.join(...parts); }
function ctxReaddir(d) { return fsApi.readdirSync(d); }
function ctxStat(p) { return fsApi.statSync(p); }
function ctxExists(p) { return fsApi.existsSync(p); }
function ctxRead(p) { return fsApi.readFileSync(p, "utf8"); }

/**
 * Inject fs/path in so tests do not need a real repo layout.
 */
export function setFs(api) { fsApi = api; }

function relToRoot(root, abs) {
  const prefix = String(root).replace(/\\/g, "/").replace(/\/$/, "");
  const path = String(abs).replace(/\\/g, "/");
  return path.startsWith(prefix + "/") ? path.slice(prefix.length + 1) : path;
}

export function detectionId(field, value) {
  return `DET-${createHash("sha256").update(JSON.stringify([field, value])).digest("hex").slice(0, 12)}`;
}

export function makeDetection(field, value, sources, extra = {}) {
  const list = (sources || []).map((s) => (typeof s === "string" ? { path: s, kind: "file" } : s));
  return {
    id: detectionId(field, value),
    field,
    value,
    confidence: "detected",
    sources: list.slice(0, 12),
    truncated: list.length > 12,
    ...extra,
  };
}

export function classifyStack({ languages = [], frameworks = [] } = {}) {
  const langs = new Set(languages);
  const fws = new Set(frameworks);
  const hasNet = langs.has("C#") || fws.has(".NET");
  const hasReact = fws.has("React");
  const hasNode = langs.has("JavaScript") || fws.has("Node.js ESM");
  if (hasNet && hasReact) {
    return { id: "fullstack", label: ".NET + React", members: [".NET", "React"], confidence: "detected", reason: "Both .NET project files and a React package manifest were found." };
  }
  if (hasNet) {
    return { id: "dotnet", label: ".NET", members: [".NET"], confidence: "detected", reason: "C# project files or repo-map .NET projects were found, and no React manifest was." };
  }
  if (hasReact) {
    return { id: "react", label: "React", members: ["React"], confidence: "detected", reason: "A package.json listing react was found, and no .NET project files were." };
  }
  if (hasNode) {
    return { id: "node-esm", label: "Node.js ESM", members: ["Node.js ESM"], confidence: "detected", reason: "JavaScript modules were found without .NET or React manifests." };
  }
  return { id: "unknown", label: "Unknown", members: [], confidence: "unknown", reason: "No classifiable stack evidence within scan limits." };
}

export function applyDetection(identityDoc, detection, action = "confirm") {
  if (!detection?.field) throw new Error("Detection is missing a field.");
  const idn = identityDoc.identity || {};
  const next = { ...identityDoc, identity: { ...idn }, updatedAt: nowIso() };
  next.rejectedDetections = Array.isArray(next.rejectedDetections) ? [...next.rejectedDetections] : [];
  const fieldName = detection.field;
  if (action === "reject") {
    const current = idn[fieldName];
    if (Array.isArray(current?.value) && detection.value != null && !Array.isArray(detection.value)) {
      next.identity[fieldName] = field(current.value.filter((v) => v !== detection.value), current.value.length > 1 ? current.confidence : "unknown");
    } else {
      next.identity[fieldName] = field(null, "unknown");
    }
    if (!next.rejectedDetections.includes(detection.id)) next.rejectedDetections.push(detection.id);
    return next;
  }
  const current = idn[fieldName];
  let value = detection.value;
  if (Array.isArray(current?.value) && value != null && !Array.isArray(value)) {
    value = [...new Set([...current.value, value])];
  }
  next.identity[fieldName] = {
    value,
    confidence: "confirmed",
    sources: detection.sources || current?.sources || [],
    detectionId: detection.id,
  };
  next.rejectedDetections = next.rejectedDetections.filter((id) => id !== detection.id);
  if (fieldName === "name") next.name = Array.isArray(value) ? value[0] : value;
  if (fieldName === "owner") next.owner = Array.isArray(value) ? value[0] : value;
  if (fieldName === "description") next.description = Array.isArray(value) ? value.join(", ") : value;
  if (fieldName === "stack" && value && typeof value === "object" && value.members) {
    next.identity.stack = { value: value.members, confidence: "confirmed", sources: detection.sources || [], detectionId: detection.id };
    next.identity.frameworks = { value: value.members, confidence: "confirmed", sources: detection.sources || [], detectionId: detection.id };
  }
  return next;
}

export function discover(root, io = fsApi, opts = {}) {
  if (!io) throw new Error("discover() needs setFs() or an io bag");
  const prev = fsApi;
  fsApi = io;
  try {
    const limits = {
      maxDepth: Number(opts.maxDepth) > 0 ? Number(opts.maxDepth) : DISCOVER_DEFAULTS.maxDepth,
      maxFiles: Number(opts.maxFiles) > 0 ? Number(opts.maxFiles) : DISCOVER_DEFAULTS.maxFiles,
      maxHits: Number(opts.maxHits) > 0 ? Number(opts.maxHits) : DISCOVER_DEFAULTS.maxHits,
    };
    const state = { files: 0, truncated: false, hitsTruncated: false };
    const walk = (dir, spec) => walkFiles(dir, { maxDepth: limits.maxDepth, maxFiles: limits.maxFiles, maxHits: limits.maxHits, state, ...spec });
    const src = (paths, kind = "file") => paths.slice(0, 8).map((p) => ({ path: relToRoot(root, p), kind }));

    const languages = [];
    const frameworks = [];
    const infrastructure = [];
    const needsReview = [];
    const detections = [];

    const csproj = walk(root, { ext: ".csproj", maxDepth: Math.min(3, limits.maxDepth) });
    const tsx = walk(root, { ext: ".tsx", maxDepth: Math.min(3, limits.maxDepth) });
    const mjs = walk(root, { ext: ".mjs", maxDepth: Math.min(2, limits.maxDepth) });
    const pkgFiles = walk(root, { names: new Set(["package.json"]), maxDepth: Math.min(3, limits.maxDepth) });
    const tf = walk(root, { ext: ".tf", maxDepth: Math.min(3, limits.maxDepth) });
    const bicep = walk(root, { ext: ".bicep", maxDepth: Math.min(3, limits.maxDepth) });
    const ymlCi = io.existsSync(joinPath(root, ".github")) ? walk(joinPath(root, ".github"), { ext: ".yml", maxDepth: 3 }) : [];
    const testFiles = [
      ...walk(root, { ext: ".test.mjs", maxDepth: limits.maxDepth }),
      ...walk(root, { ext: ".test.ts", maxDepth: Math.min(3, limits.maxDepth) }),
      ...walk(root, { ext: ".Tests.cs", maxDepth: Math.min(3, limits.maxDepth) }),
    ];

    if (csproj.length) {
      languages.push("C#");
      frameworks.push(".NET");
      detections.push(makeDetection("languages", "C#", src(csproj)));
      detections.push(makeDetection("frameworks", ".NET", src(csproj)));
    }
    const reactManifests = [];
    for (const p of pkgFiles) {
      try {
        const pkg = JSON.parse(ctxRead(p));
        if (pkg.dependencies?.react || pkg.devDependencies?.react) reactManifests.push(p);
      } catch { /* ignore */ }
    }
    if (tsx.length) {
      languages.push("TypeScript");
      detections.push(makeDetection("languages", "TypeScript", src(tsx)));
    }
    if (reactManifests.length) {
      frameworks.push("React");
      detections.push(makeDetection("frameworks", "React", src(reactManifests, "manifest")));
    } else if (tsx.length) {
      needsReview.push("TSX files found but no package.json lists react — not classified as a React app");
    }
    if (mjs.length && !csproj.length) {
      languages.push("JavaScript");
      frameworks.push("Node.js ESM");
      detections.push(makeDetection("languages", "JavaScript", src(mjs)));
      detections.push(makeDetection("frameworks", "Node.js ESM", src(mjs)));
    }
    if (tf.length) {
      infrastructure.push("Terraform");
      detections.push(makeDetection("infrastructure", "Terraform", src(tf)));
    }
    if (bicep.length) {
      infrastructure.push("Bicep");
      detections.push(makeDetection("infrastructure", "Bicep", src(bicep)));
    }
    if (ymlCi.length) {
      infrastructure.push("GitHub Actions");
      detections.push(makeDetection("infrastructure", "GitHub Actions", src(ymlCi)));
    }

    let repoMap = null;
    const repoMapPath = joinPath(root, ".cursor", "cache", "repo-map.json");
    if (ctxExists(repoMapPath)) {
      try { repoMap = JSON.parse(ctxRead(repoMapPath)); } catch { needsReview.push("repo-map.json is unreadable"); }
    }

    let featureMap = null;
    const fmPath = joinPath(root, ".cursor", "cache", "feature-map.json");
    if (ctxExists(fmPath)) {
      try { featureMap = JSON.parse(ctxRead(fmPath)); } catch { needsReview.push("feature-map.json is unreadable"); }
    }

    const projects = repoMap?.projects || [];
    const db = repoMap?.databaseProviders || [];
    const entryPoints = [];
    for (const f of Object.values(featureMap?.features || {})) {
      for (const e of f.entryPoints || []) if (e.ref) entryPoints.push(e.ref);
    }

    if (!repoMap) needsReview.push("No repo-map.json — run /repo-discovery");
    if (!featureMap || !Object.keys(featureMap.features || {}).length) needsReview.push("No traced features — run /feature-trace");
    if (csproj.length && projects.length === 0) needsReview.push("csproj files found but repo-map lists no projects");
    if (state.truncated) needsReview.push(`Scan hit maxFiles=${limits.maxFiles}; remaining files were not classified`);
    if (state.hitsTruncated) needsReview.push(`Scan hit maxHits=${limits.maxHits} for at least one file type`);

    for (const name of db) {
      detections.push(makeDetection("databases", name, [{ path: ".cursor/cache/repo-map.json", kind: "map", note: "databaseProviders" }]));
    }
    if (entryPoints.length) {
      detections.push(makeDetection("apis", entryPoints.length, src(entryPoints.slice(0, 8), "trace"), { note: "Traced entry points from feature-map, not an OpenAPI inventory" }));
    }

    const stack = classifyStack({ languages: [...new Set(languages)], frameworks: [...new Set(frameworks)] });
    detections.push(makeDetection("stack", stack, [
      ...(csproj.length ? src(csproj) : []),
      ...(reactManifests.length ? src(reactManifests, "manifest") : []),
      ...(mjs.length ? src(mjs.slice(0, 3)) : []),
    ], { note: stack.reason }));

    const applications = {
      value: {
        dotnetProjects: projects.length || csproj.length,
        reactApps: reactManifests.length,
        databases: db.length,
        apiEndpoints: entryPoints.length,
        tests: testFiles.length,
        infrastructure: infrastructure.slice(),
      },
      confidence: "detected",
      sources: [
        repoMap ? { path: ".cursor/cache/repo-map.json", kind: "map" } : null,
        ...src(csproj).slice(0, 4),
        ...src(reactManifests, "manifest"),
      ].filter(Boolean),
    };

    return {
      name: { value: null, confidence: "unknown" },
      languages: field([...new Set(languages)], languages.length ? "detected" : "unknown"),
      frameworks: field([...new Set(frameworks)], frameworks.length ? "detected" : "unknown"),
      stack: field(stack, stack.confidence),
      applications,
      databases: field(db, db.length ? "detected" : "unknown"),
      apis: field(entryPoints.length, entryPoints.length ? "detected" : "unknown"),
      tests: field(testFiles.length, "detected"),
      infrastructure: field(infrastructure, infrastructure.length ? "detected" : "unknown"),
      needsReview,
      counts: applications.value,
      detections,
      classification: stack,
      limits: { ...limits, filesVisited: state.files, truncated: state.truncated || state.hitsTruncated },
      source: {
        repoMap: !!repoMap,
        featureMap: !!featureMap,
      },
    };
  } finally {
    fsApi = prev;
  }
}

export function mergeIdentity(identityDoc, discovery, confirmed = {}) {
  const idn = identityDoc.identity || emptyIdentity().identity;
  const take = (key, discovered) => {
    if (confirmed[key] != null) return field(confirmed[key], "confirmed");
    if (idn[key]?.confidence === "confirmed") return idn[key];
    if (discovered && discovered.confidence !== "unknown") return discovered;
    return idn[key] || field(null, "unknown");
  };
  return {
    ...identityDoc,
    identity: {
      ...idn,
      stack: take("stack", discovery.stack || discovery.frameworks),
      languages: take("languages", discovery.languages),
      frameworks: take("frameworks", discovery.frameworks),
      applications: take("applications", discovery.applications),
      databases: take("databases", discovery.databases),
      apis: take("apis", discovery.apis),
      tests: take("tests", discovery.tests),
      infrastructure: take("infrastructure", discovery.infrastructure),
    },
    detections: discovery.detections || identityDoc.detections || [],
    updatedAt: nowIso(),
  };
}

export function validateRelations(model) {
  const errors = [];
  const phaseIds = new Set((model.phases || []).map((p) => p.id));
  const chkIds = new Set((model.checkpoints || []).map((c) => c.id));
  const ideaIds = new Set((model.ideas || []).map((i) => i.id));
  for (const p of model.phases || []) {
    for (const id of p.dependencies || []) if (!phaseIds.has(id)) errors.push(`${p.id} references missing dependency ${id}`);
  }
  const visited = new Set(), visiting = new Set();
  const visit = (id) => {
    if (visiting.has(id)) { errors.push(`Phase dependency cycle at ${id}`); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of (model.phases || []).find((p) => p.id === id)?.dependencies || []) visit(dep);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of phaseIds) visit(id);
  for (const c of model.checkpoints || []) {
    if (c.phaseId && !phaseIds.has(c.phaseId)) errors.push(`${c.id} references missing phase ${c.phaseId}`);
  }
  for (const i of model.ideas || []) {
    if (i.phaseId && !phaseIds.has(i.phaseId)) errors.push(`${i.id} references missing phase ${i.phaseId}`);
    for (const cid of i.checkpointIds || []) {
      if (!chkIds.has(cid)) errors.push(`${i.id} references missing checkpoint ${cid}`);
    }
  }
  for (const b of model.featureBindings || []) {
    if (b.phaseId && !phaseIds.has(b.phaseId)) errors.push(`binding ${b.featureId} references missing phase ${b.phaseId}`);
    if (b.ideaId && !ideaIds.has(b.ideaId)) errors.push(`binding ${b.featureId} references missing idea ${b.ideaId}`);
  }
  const seen = new Set();
  for (const collection of [model.phases, model.checkpoints, model.ideas]) {
    for (const it of collection || []) {
      if (seen.has(it.id)) errors.push(`duplicate id ${it.id}`);
      seen.add(it.id);
    }
  }
  return errors;
}

/** Validate persisted shapes before readers project them or writers mutate them. */
export function validateState(identity, delivery, ideas) {
  const errors = [];
  const object = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  for (const [name, doc] of [["project.json", identity], ["delivery.json", delivery], ["ideas.json", ideas]]) {
    if (!object(doc)) { errors.push(`${name}: missing or invalid document`); continue; }
    if (doc.schemaVersion !== SCHEMA_VERSION) errors.push(`${name}: unsupported schemaVersion ${doc.schemaVersion}`);
    if (!Number.isInteger(doc.revision) || doc.revision < 0) errors.push(`${name}: revision must be a nonnegative integer`);
  }
  if (errors.length) return errors;
  if (!/^PROJ-\d+$/.test(identity.id) || typeof identity.name !== "string" || !identity.name.trim()) errors.push("project.json: valid id and nonempty name required");
  const arrays = [[delivery, "phases"], [delivery, "checkpoints"], [delivery, "featureBindings"], [ideas, "ideas"]];
  for (const [doc, key] of arrays) if (!Array.isArray(doc[key])) errors.push(`${key} must be an array`);
  if (delivery.milestones !== undefined && !Array.isArray(delivery.milestones)) errors.push("milestones must be an array");
  if (errors.length) return errors;
  if (Array.isArray(delivery.milestones)) {
    const phaseIds = new Set(delivery.phases.map((p) => p.id));
    for (const ms of delivery.milestones) {
      if (!object(ms) || !ms.id || !ms.title) errors.push("milestone requires id and title");
      if (ms.phaseId && !phaseIds.has(ms.phaseId)) errors.push(`${ms.id} references missing phase ${ms.phaseId}`);
    }
  }
  for (const [list, states, label] of [[delivery.phases, PHASE_STATUSES, "phase"], [delivery.checkpoints, CHECKPOINT_STATUSES, "checkpoint"], [ideas.ideas, IDEA_STATUSES, "idea"]]) {
    for (const item of list) {
      if (!object(item)) { errors.push(`${label} must be an object`); continue; }
      if (typeof item.id !== "string" || !item.id.trim()) errors.push(`${label}: id required`);
      if (!states.includes(item.status)) errors.push(`${item.id}: invalid status ${item.status}`);
      for (const key of ["objectives", "dependencies", "evidence", "featureIds", "requirementIds", "taskIds", "riskIds", "checkpointIds", "blockers", "history", "entryCriteria", "exitCriteria"]) {
        if (item[key] !== undefined && !Array.isArray(item[key])) errors.push(`${item.id}.${key} must be an array`);
      }
      if (Array.isArray(item.objectives)) for (const o of item.objectives) {
        if (!object(o) || !o.id || !OBJECTIVE_STATUSES.includes(o.status)) errors.push(`${item.id}: invalid objective`);
      }
      if (label === "phase" && !Number.isFinite(item.order)) errors.push(`${item.id}: order required`);
      if (label === "checkpoint" && !item.phaseId) errors.push(`${item.id}: phaseId required`);
      if (label === "checkpoint" && !VERIFY_MODES.includes(item.verificationMode)) errors.push(`${item.id}: invalid verificationMode`);
    }
  }
  for (const b of delivery.featureBindings) {
    if (!object(b) || !b.featureId || (b.status && !FEATURE_STATUSES.includes(b.status))) errors.push("Invalid feature binding");
  }
  if (errors.length) return errors;
  if (identity.currentDeliveryPhaseId && !delivery.phases.some((p) => p.id === identity.currentDeliveryPhaseId)) errors.push("Current delivery phase does not exist");
  if (identity.currentCheckpointId && !delivery.checkpoints.some((c) => c.id === identity.currentCheckpointId)) errors.push("Current checkpoint does not exist");
  return [...errors, ...validateRelations({ ...delivery, ideas: ideas.ideas })];
}

function cell(row, index, names, headerIdx) {
  for (const n of names) {
    const i = headerIdx[n];
    if (i != null && row[i] != null && row[i] !== "") return row[i];
  }
  return index != null ? (row[index] || "") : "";
}

function severityFromScores(likelihood, impact, explicit) {
  if (explicit) {
    const s = String(explicit).toUpperCase();
    if (["LOW", "MED", "MEDIUM", "HIGH", "CRITICAL"].includes(s)) return s === "MEDIUM" ? "MED" : s;
  }
  const rank = (v) => ({ L: 1, LOW: 1, M: 2, MED: 2, MEDIUM: 2, H: 3, HIGH: 3, C: 4, CRITICAL: 4 })[String(v || "").toUpperCase()] || 0;
  const score = Math.max(rank(likelihood), rank(impact));
  return score >= 4 ? "CRITICAL" : score === 3 ? "HIGH" : score === 2 ? "MED" : score === 1 ? "LOW" : "UNKNOWN";
}

function statusFromRegister(raw, retireIn, mitigation) {
  const s = String(raw || "").trim().toUpperCase().replace(/[_-]+/g, " ");
  if (["CLOSED", "DONE", "RETIRED", "RESOLVED", "COMPLETE", "COMPLETED"].includes(s)) return "CLOSED";
  if (["ACCEPTED", "ACCEPT", "WONT FIX", "WON'T FIX", "RESIDUAL", "WON T FIX"].includes(s)) return "ACCEPTED";
  if (["MITIGATED", "TREATED"].includes(s)) return "CLOSED";
  if (["OPEN", "ACTIVE", "IN PROGRESS", "MONITORING", "NEW"].includes(s)) return "OPEN";
  if (s === "UNKNOWN") return "UNKNOWN";
  if (/^never$/i.test(String(retireIn || "").trim()) || /^\s*accepted\b/i.test(String(mitigation || ""))) return "ACCEPTED";
  return raw ? "UNKNOWN" : "OPEN";
}

/**
 * Parse the phase-2 register at docs/analysis/risks.md. Column names follow
 * /risk-register (ID, Risk, Cat, L, I, Owner, Retire in, Mitigation) plus an
 * optional Status column. Missing file is the caller's problem; empty text
 * is an empty register, not unknown.
 */
export function parseRiskRegister(markdown, source = "docs/analysis/risks.md") {
  const text = String(markdown || "");
  if (!text.trim()) return { risks: [], source, parsed: true, empty: true };
  const risks = [];
  let headerIdx = null;
  for (const line of text.split(/\r?\n/)) {
    if (!/^\s*\|/.test(line)) continue;
    const row = line.split("|").slice(1, -1).map((c) => c.trim());
    if (!row.length || row.every((c) => /^[-:\s]+$/.test(c))) continue;
    const keys = row.map((c) => c.toLowerCase());
    if (keys.some((c) => c === "id") && keys.some((c) => /risk|title/.test(c))) {
      headerIdx = {};
      keys.forEach((k, i) => { headerIdx[k] = i; });
      continue;
    }
    if (!headerIdx) continue;
    const id = cell(row, 0, ["id"], headerIdx);
    if (!id || !/^R(ISK)?[-_]?\d+/i.test(id)) continue;
    const title = cell(row, 1, ["risk", "title", "description"], headerIdx);
    const owner = cell(row, null, ["owner"], headerIdx) || null;
    const retireIn = cell(row, null, ["retire in", "retire", "phase", "retired in"], headerIdx);
    const mitigation = cell(row, null, ["mitigation", "treatment"], headerIdx);
    const likelihood = cell(row, null, ["l", "likelihood"], headerIdx);
    const impact = cell(row, null, ["i", "impact"], headerIdx);
    risks.push({
      id,
      title,
      category: cell(row, null, ["cat", "category"], headerIdx) || null,
      likelihood: likelihood || null,
      impact: impact || null,
      severity: severityFromScores(likelihood, impact, cell(row, null, ["severity"], headerIdx)),
      owner,
      retireIn: retireIn || null,
      mitigation: mitigation || null,
      status: statusFromRegister(cell(row, null, ["status"], headerIdx), retireIn, mitigation),
      source,
      phaseId: null,
      checkpointIds: [],
      featureIds: [],
      requirementIds: [],
      blocking: undefined,
    });
  }
  return { risks, source, parsed: true, empty: risks.length === 0 };
}

export function linkRisksToDelivery(risks, phases = []) {
  const byId = new Map(phases.map((p) => [p.id, p]));
  const bySlug = new Map(phases.map((p) => [String(p.slug || "").toLowerCase(), p]));
  const byName = new Map(phases.map((p) => [String(p.name || "").toLowerCase(), p]));
  for (const risk of risks) {
    const token = String(risk.retireIn || "").trim();
    if (!token) continue;
    const phase = byId.get(token)
      || bySlug.get(token.toLowerCase())
      || byName.get(token.toLowerCase())
      || phases.find((p) => token.toLowerCase().includes(String(p.slug || "").toLowerCase()) && p.slug)
      || phases.find((p) => token.toLowerCase().includes(String(p.name || "").toLowerCase()) && p.name);
    if (phase) risk.phaseId = phase.id;
  }
  return risks;
}

export function openRiskCount(risks = []) {
  return risks.filter((r) => r.status !== "CLOSED" && r.status !== "ACCEPTED").length;
}

const FABRICATED_STATUSES = new Set(["COMPLETED", "PASSED", "WAIVED", "FAILED", "VERIFIED", "RELEASED", "IN_PROGRESS", "BLOCKED", "READY_FOR_REVIEW"]);

function catalogRefusesFabrication(item, label) {
  const errors = [];
  if (item.status && FABRICATED_STATUSES.has(item.status)) errors.push(`${label}: catalog cannot import status ${item.status}`);
  if (Array.isArray(item.evidence) && item.evidence.length) errors.push(`${label}: catalog cannot import evidence`);
  if (item.history && Array.isArray(item.history) && item.history.some((h) => h.status && h.status !== "NOT_STARTED")) {
    errors.push(`${label}: catalog cannot import transition history`);
  }
  if (item.completedAt) errors.push(`${label}: catalog cannot import completedAt`);
  if (item.reviewer) errors.push(`${label}: catalog cannot import reviewer`);
  return errors;
}

/** Shape a delivery document can export and later preview/apply without losing IDs. */
export function exportCatalog(delivery) {
  return {
    schemaVersion: SCHEMA_VERSION,
    phases: (delivery.phases || []).map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description || "",
      order: p.order,
      owner: p.owner || null,
      objectives: (p.objectives || []).map((o) => ({
        id: o.id,
        title: o.title,
        required: o.required !== false,
      })),
      entryCriteria: [...(p.entryCriteria || [])],
      dependencies: [...(p.dependencies || [])],
      checkpointTypes: [...new Set((delivery.checkpoints || []).filter((c) => c.phaseId === p.id).map((c) => c.type))],
    })),
  };
}

export function newCheckpoint(delivery, phase, type, { at = nowIso(), required } = {}) {
  const meta = CHECKPOINT_TYPES.find((t) => t.type === type) || { type, name: type };
  const auto = AUTOMATED_VERIFY[type];
  return {
    id: nextId(delivery.checkpoints, "CHK"),
    name: meta.name || type,
    description: `${meta.name || type} checkpoint for ${phase.name}.`,
    type,
    phaseId: phase.id,
    status: "NOT_STARTED",
    required: required != null ? required : (!["observability", "performance", "ui"].includes(type) || phase.slug === "hardening" || phase.slug === "launch"),
    optional: false,
    owner: null,
    dueDate: null,
    entryCriteria: [],
    completionCriteria: [`${meta.name || type} evidenced or waived by name`],
    evidence: [],
    requirementIds: [],
    featureIds: [],
    riskIds: [],
    blockers: [],
    completedAt: null,
    reviewer: null,
    notes: "",
    verificationMode: auto ? "HYBRID" : "MANUAL",
    evidenceRequired: true,
    history: [{ at, status: "NOT_STARTED", by: "catalog" }],
  };
}

/**
 * Diff a catalog against current delivery. Never treats imported completion
 * as real: those fields are errors, not applies.
 */
export function previewCatalog(delivery, catalog) {
  const errors = [];
  const changes = [];
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    return { ok: false, errors: ["Catalog must be a JSON object"], changes };
  }
  if (catalog.schemaVersion != null && catalog.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`Unsupported catalog schemaVersion ${catalog.schemaVersion}`);
  }
  if (!Array.isArray(catalog.phases) || !catalog.phases.length) {
    errors.push("Catalog must list phases");
    return { ok: false, errors, changes };
  }
  errors.push(...catalogRefusesFabrication(catalog, "catalog"));
  if (Array.isArray(catalog.checkpoints)) {
    for (const c of catalog.checkpoints) errors.push(...catalogRefusesFabrication(c, c.id || c.type || "checkpoint"));
  }
  const currentIds = new Set((delivery.phases || []).map((p) => p.id));
  const catalogIds = new Set();
  const seenSlug = new Set();
  for (const p of catalog.phases) {
    if (!p || typeof p !== "object") { errors.push("Phase entry must be an object"); continue; }
    errors.push(...catalogRefusesFabrication(p, p.id || p.slug || "phase"));
    if (p.id) catalogIds.add(p.id);
    if (p.slug) {
      if (seenSlug.has(p.slug)) errors.push(`duplicate slug ${p.slug}`);
      seenSlug.add(p.slug);
    }
    if (Array.isArray(p.objectives)) {
      for (const o of p.objectives) {
        if (o.status && o.status !== "UNKNOWN" && o.status !== "INCOMPLETE") {
          errors.push(`${p.id || p.slug}: catalog cannot import objective status ${o.status}`);
        }
      }
    }
    if (Array.isArray(p.checkpoints)) {
      for (const c of p.checkpoints) errors.push(...catalogRefusesFabrication(c, c.id || c.type || "checkpoint"));
    }
    const existing = (delivery.phases || []).find((x) => x.id === p.id || (p.slug && x.slug === p.slug));
    if (existing) {
      const edits = [];
      for (const key of ["name", "description", "owner", "order"]) {
        if (p[key] != null && p[key] !== existing[key]) edits.push(key);
      }
      if (edits.length) changes.push({ kind: "edit-phase", id: existing.id, fields: edits });
      else changes.push({ kind: "keep-phase", id: existing.id });
    } else {
      changes.push({ kind: "add-phase", id: p.id || null, slug: p.slug, name: p.name });
    }
  }
  for (const id of currentIds) {
    if (![...catalog.phases].some((p) => p.id === id || (p.slug && (delivery.phases || []).find((x) => x.id === id)?.slug === p.slug))) {
      const phase = (delivery.phases || []).find((p) => p.id === id);
      const live = phase && !["PLANNED", "NEEDS_REVIEW", "READY"].includes(phase.status);
      const liveChk = (delivery.checkpoints || []).some((c) => c.phaseId === id && c.status !== "NOT_STARTED");
      errors.push(`${id} exists in delivery and is missing from the catalog${live || liveChk ? " (has history — refusing drop)" : " (list every existing phase id)"}`);
    }
  }
  const nextIds = new Set([
    ...currentIds,
    ...catalog.phases.map((p) => p.id).filter(Boolean),
  ]);
  for (const p of catalog.phases) {
    for (const dep of p.dependencies || []) {
      if (![...nextIds].includes(dep) && !(delivery.phases || []).some((x) => x.id === dep)) {
        errors.push(`${p.id || p.slug} depends on unknown ${dep}`);
      }
    }
  }
  for (const p of catalog.phases) {
    const existing = (delivery.phases || []).find((x) => x.id === p.id || (p.slug && x.slug === p.slug));
    const types = p.checkpointTypes || (p.checkpoints || []).map((c) => c.type).filter(Boolean);
    if (!existing || !types.length) continue;
    for (const type of types) {
      if (!(delivery.checkpoints || []).some((c) => c.phaseId === existing.id && c.type === type)) {
        changes.push({ kind: "add-checkpoint", phaseId: existing.id, type });
      }
    }
  }
  return { ok: errors.length === 0, errors, changes };
}

export function applyCatalog(delivery, catalog, { at = nowIso() } = {}) {
  const preview = previewCatalog(delivery, catalog);
  if (!preview.ok) {
    const err = new Error(`Invalid catalog:\n${preview.errors.join("\n")}`);
    err.code = "ECATALOG";
    err.errors = preview.errors;
    throw err;
  }
  const next = {
    ...delivery,
    phases: delivery.phases.map((p) => ({ ...p, objectives: (p.objectives || []).map((o) => ({ ...o })) })),
    checkpoints: delivery.checkpoints.map((c) => ({ ...c })),
    featureBindings: [...(delivery.featureBindings || [])],
    history: [...(delivery.history || [])],
  };
  const byId = new Map(next.phases.map((p) => [p.id, p]));
  for (const spec of catalog.phases) {
    let phase = spec.id ? byId.get(spec.id) : next.phases.find((p) => spec.slug && p.slug === spec.slug);
    if (!phase) {
      const order = Number.isFinite(spec.order) ? spec.order : next.phases.reduce((m, p) => Math.max(m, p.order), -1) + 1;
      phase = {
        id: spec.id || nextId(next.phases, "PHASE"),
        slug: spec.slug || `phase-${order}`,
        name: spec.name || spec.slug || "Untitled phase",
        description: spec.description || "",
        status: "PLANNED",
        order,
        owner: spec.owner || null,
        startDate: null,
        targetDate: spec.targetDate || null,
        completedAt: null,
        objectives: [],
        entryCriteria: spec.entryCriteria || [],
        exitCriteria: [],
        featureIds: [],
        requirementIds: [],
        taskIds: [],
        riskIds: [],
        evidence: [],
        dependencies: spec.dependencies || [],
        releaseId: null,
      };
      next.phases.push(phase);
      byId.set(phase.id, phase);
    } else {
      if (spec.name != null) phase.name = spec.name;
      if (spec.description != null) phase.description = spec.description;
      if (spec.owner !== undefined) phase.owner = spec.owner;
      if (Number.isFinite(spec.order)) phase.order = spec.order;
      if (spec.slug) phase.slug = spec.slug;
      if (spec.dependencies) phase.dependencies = [...spec.dependencies];
      if (spec.entryCriteria) phase.entryCriteria = [...spec.entryCriteria];
    }
    if (Array.isArray(spec.objectives)) {
      for (const o of spec.objectives) {
        const existing = (phase.objectives || []).find((x) => x.id === o.id);
        if (existing) {
          if (o.title) existing.title = o.title;
          if (o.required != null) existing.required = o.required;
        } else {
          phase.objectives = phase.objectives || [];
          phase.objectives.push({
            id: o.id || nextId(phase.objectives, "OBJ"),
            title: o.title || "Untitled objective",
            required: o.required !== false,
            status: "UNKNOWN",
          });
        }
      }
    }
    const types = spec.checkpointTypes || (spec.checkpoints || []).map((c) => c.type).filter(Boolean);
    for (const type of types) {
      if (!next.checkpoints.some((c) => c.phaseId === phase.id && c.type === type)) {
        next.checkpoints.push(newCheckpoint(next, phase, type, { at }));
      }
    }
  }
  next.updatedAt = at;
  next.history.push({ at, event: "catalog-apply", detail: `${catalog.phases.length} phases` });
  const relErr = validateRelations({ ...next, ideas: [] });
  if (relErr.length) {
    const err = new Error(`Catalog apply produced invalid relations:\n${relErr.join("\n")}`);
    err.code = "ECATALOG";
    err.errors = relErr;
    throw err;
  }
  return { delivery: next, preview };
}

/**
 * Walk every requested hop from an id and label each missing link. Idea
 * VERIFIED does not imply the bound feature is VERIFIED.
 */
export function traceQuery(id, ctx = {}) {
  if (!id) return { id: null, kind: null, hops: [], missing: [], complete: false, reason: "id required" };
  const ideas = ctx.ideas || [];
  const features = ctx.features || [];
  const phases = ctx.phases || [];
  const checkpoints = ctx.checkpoints || [];
  const requirements = ctx.requirements || [];
  const risks = ctx.risks || [];
  const releases = ctx.releases || [];
  const decisions = ctx.decisions || [];
  const hops = [];
  const missing = [];
  const present = (from, to, kind, target, source) => {
    hops.push({ from, to, kind, status: target ? "present" : "missing", source, target: target || null });
    if (!target) missing.push({ from, to, kind, source });
  };

  const idea = ideas.find((i) => i.id === id);
  const feature = features.find((f) => f.id === id);
  const phase = phases.find((p) => p.id === id);
  const checkpoint = checkpoints.find((c) => c.id === id);
  const requirement = requirements.find((r) => r.id === id);
  const risk = risks.find((r) => r.id === id);
  const release = releases.find((r) => r.version === id || r.id === id);
  const decision = decisions.find((d) => d.id === id);

  const kind = idea ? "idea" : feature ? "feature" : phase ? "delivery-phase" : checkpoint ? "checkpoint"
    : requirement ? "requirement" : risk ? "risk" : release ? "release" : decision ? "decision" : null;
  if (!kind) return { id, kind: null, hops, missing: [{ from: id, to: null, kind: "entity", source: "unknown" }], complete: false, reason: "Unknown id" };

  if (idea) {
    if (idea.phaseId || ["IMPLEMENTING", "VERIFIED", "RELEASED"].includes(idea.status)) {
      present(idea.id, idea.phaseId, "phase", idea.phaseId ? phases.find((p) => p.id === idea.phaseId) : null, "ideas.json");
    }
    for (const fid of idea.featureIds || []) {
      const feat = features.find((f) => f.id === fid);
      present(idea.id, fid, "feature", feat, feat?.source || "project-overlay");
      if (feat && ["VERIFIED", "RELEASED"].includes(idea.status) && !["VERIFIED", "RELEASED"].includes(feat.projectStatus || feat.status)) {
        missing.push({
          from: idea.id, to: fid, kind: "feature-verification",
          source: "derived",
          note: `${idea.id} is ${idea.status} but ${fid} is ${feat.projectStatus || feat.status}; idea verification does not verify the feature`,
        });
        hops.push({ from: idea.id, to: fid, kind: "feature-verification", status: "missing", source: "derived", target: feat });
      }
    }
    if (!(idea.featureIds || []).length && ["APPROVED", "SPECIFIED", "IMPLEMENTING", "VERIFIED", "RELEASED"].includes(idea.status)) {
      present(idea.id, null, "feature", null, "ideas.json");
    }
    for (const rid of idea.requirementIds || []) {
      present(idea.id, rid, "requirement", requirements.find((r) => r.id === rid) || (ctx.requirementIdsKnown === false ? { id: rid } : null), "id-graph");
    }
    for (const tid of idea.taskIds || []) present(idea.id, tid, "task", (ctx.tasks || []).find((t) => t.id === tid), "task-graph");
    for (const cid of idea.checkpointIds || []) present(idea.id, cid, "checkpoint", checkpoints.find((c) => c.id === cid), "delivery.json");
    for (const ref of idea.implementationRefs || []) present(idea.id, ref, "code", ref ? { id: ref } : null, "ideas.json");
    for (const ref of idea.testRefs || []) present(idea.id, ref, "test", ref ? { id: ref } : null, "ideas.json");
    if (idea.decisionId || idea.decision) {
      present(idea.id, idea.decisionId || "inline-decision", "decision", idea.decision || decisions.find((d) => d.id === idea.decisionId) || { id: idea.decisionId }, "ideas.json");
    }
    if (idea.status === "RELEASED" || idea.releaseId) {
      present(idea.id, idea.releaseId, "release", releases.find((r) => r.version === idea.releaseId || r.id === idea.releaseId), "lifecycle/releases");
    }
  }

  if (feature) {
    for (const ph of feature.phaseIds || []) present(feature.id, ph, "phase", phases.find((p) => p.id === ph), "feature-binding");
    for (const iid of feature.ideaIds || []) present(feature.id, iid, "idea", ideas.find((i) => i.id === iid), "feature-binding");
    for (const rid of feature.requirementIds || []) present(feature.id, rid, "requirement", requirements.find((r) => r.id === rid) || (ctx.requirementIdsKnown === false ? { id: rid } : null), "id-graph");
    const files = feature.fileRefs || feature.files;
    if (Array.isArray(files)) for (const f of files) present(feature.id, typeof f === "string" ? f : f.path, "code", f, "feature-map");
    if (feature.tests === 0 || (Array.isArray(feature.tests) && !feature.tests.length)) {
      if (feature.source === "feature-map" && feature.projectStatus !== "PLANNED") present(feature.id, null, "test", null, "feature-map");
    }
  }

  if (phase) {
    for (const dep of phase.dependencies || []) present(phase.id, dep, "dependency", phases.find((p) => p.id === dep), "delivery.json");
    for (const c of checkpoints.filter((c) => c.phaseId === phase.id)) present(phase.id, c.id, "checkpoint", c, "delivery.json");
    for (const rid of phase.riskIds || []) present(phase.id, rid, "risk", risks.find((r) => r.id === rid), "delivery.json");
    for (const r of risks.filter((r) => r.phaseId === phase.id)) present(phase.id, r.id, "risk", r, r.source);
  }

  if (checkpoint) {
    present(checkpoint.id, checkpoint.phaseId, "phase", phases.find((p) => p.id === checkpoint.phaseId), "delivery.json");
    if (checkpoint.status === "PASSED" || checkpoint.status === "WAIVED") {
      const latest = (checkpoint.evidence || []).at(-1);
      present(checkpoint.id, latest?.id || latest?.ref || null, "evidence", latest && latest.valid !== false ? latest : null, "delivery.json");
    }
    for (const rid of checkpoint.riskIds || []) present(checkpoint.id, rid, "risk", risks.find((r) => r.id === rid), "delivery.json");
  }

  if (risk) {
    present(risk.id, risk.phaseId, "phase", risk.phaseId ? phases.find((p) => p.id === risk.phaseId) : null, risk.source);
    present(risk.id, risk.owner, "owner", risk.owner ? { id: risk.owner } : null, risk.source);
  }

  if (requirement) {
    const linkedIdeas = ideas.filter((i) => (i.requirementIds || []).includes(requirement.id));
    const linkedFeats = features.filter((f) => (f.requirementIds || []).includes(requirement.id));
    if (!linkedIdeas.length && !linkedFeats.length) present(requirement.id, null, "feature", null, "id-graph");
    for (const i of linkedIdeas) present(requirement.id, i.id, "idea", i, "ideas.json");
    for (const f of linkedFeats) present(requirement.id, f.id, "feature", f, f.source);
  }

  return { id, kind, hops, missing, complete: missing.length === 0 };
}

/**
 * Cross-source referential checks. Local validateState stays the write gate;
 * this reports dangling requirement / decision / release / task ids when those
 * sources were actually loaded.
 */
export function validateCanonicalRefs(state, canonical = {}) {
  const errors = [];
  const ideas = state.ideas?.ideas || state.ideas || [];
  const delivery = state.delivery || state;
  const reqOk = canonical.requirementsAvailable === true;
  const reqIds = new Set((canonical.requirements || []).map((r) => r.id));
  const decisionIds = new Set((canonical.decisions || []).map((d) => d.id));
  const decisionsKnown = canonical.decisionsAvailable === true || (canonical.decisions || []).length > 0;
  const releaseIds = new Set((canonical.releases || []).map((r) => r.version || r.id));
  const releasesKnown = canonical.releasesAvailable === true || (canonical.releases || []).length > 0;
  const taskIds = new Set((canonical.tasks || []).map((t) => t.id));
  const tasksKnown = canonical.tasksAvailable === true;
  const riskIds = new Set((canonical.risks || []).map((r) => r.id));
  const risksKnown = canonical.risksAvailable === true;

  const check = (owner, ids, known, set, kind) => {
    if (!known) return;
    for (const id of ids || []) {
      if (id && !set.has(id)) errors.push(`${owner} references unknown ${kind} ${id}`);
    }
  };

  for (const idea of ideas) {
    check(idea.id, idea.requirementIds, reqOk, reqIds, "requirement");
    check(idea.id, idea.taskIds, tasksKnown, taskIds, "task");
    if (idea.decisionId) check(idea.id, [idea.decisionId], decisionsKnown, decisionIds, "decision");
    if (idea.releaseId) check(idea.id, [idea.releaseId], releasesKnown, releaseIds, "release");
  }
  for (const p of delivery.phases || []) {
    check(p.id, p.requirementIds, reqOk, reqIds, "requirement");
    check(p.id, p.taskIds, tasksKnown, taskIds, "task");
    check(p.id, p.riskIds, risksKnown, riskIds, "risk");
  }
  for (const c of delivery.checkpoints || []) {
    check(c.id, c.requirementIds, reqOk, reqIds, "requirement");
    check(c.id, c.riskIds, risksKnown, riskIds, "risk");
  }
  return errors;
}

/**
 * Explicit verification / decision / waiver / cancellation / release-membership
 * contract. Returned as findings so `project.mjs check` can print them.
 */
export function contractFindings(ctx = {}) {
  const findings = [];
  for (const c of ctx.checkpoints || []) {
    if (c.status === "WAIVED" && !String(c.notes || c.waiverReason || "").trim()) {
      findings.push({ code: "waiver-without-reason", severity: "block", message: `${c.id} is WAIVED without a recorded reason`, ref: c.id });
    }
    if (c.status === "WAIVED" && !String(c.reviewer || "").trim()) {
      findings.push({ code: "waiver-without-owner", severity: "warn", message: `${c.id} is WAIVED without --by / reviewer`, ref: c.id });
    }
  }
  for (const idea of ctx.ideas || []) {
    if (idea.decision && !idea.decisionId) {
      findings.push({
        code: "inline-decision-without-canonical-id",
        severity: (ctx.decisions || []).length ? "warn" : "info",
        message: `${idea.id} has an inline verdict but no decisionId`,
        ref: idea.id,
      });
    }
    if (idea.status === "RELEASED" && !idea.releaseId) {
      findings.push({ code: "released-without-membership", severity: "block", message: `${idea.id} is RELEASED without a signed release id`, ref: idea.id });
    }
    if (["VERIFIED", "RELEASED"].includes(idea.status) && !(idea.featureIds || []).length) {
      findings.push({ code: "verified-without-feature", severity: "block", message: `${idea.id} is ${idea.status} without a bound feature`, ref: idea.id });
    }
    if (idea.status === "RELEASED") {
      for (const fid of idea.featureIds || []) {
        const feat = (ctx.features || []).find((f) => f.id === fid);
        const bound = (ctx.featureBindings || []).find((b) => b.featureId === fid && b.ideaId === idea.id);
        if (bound && bound.releaseId !== idea.releaseId) {
          findings.push({ code: "feature-release-membership-mismatch", severity: "warn", message: `${fid} overlay is not a member of ${idea.releaseId}`, ref: fid });
        }
        if (feat && !["VERIFIED", "RELEASED"].includes(feat.projectStatus || feat.status)) {
          findings.push({ code: "released-idea-feature-unverified", severity: "warn", message: `${idea.id} is RELEASED but ${fid} is ${feat.projectStatus || feat.status}`, ref: idea.id });
        }
      }
    }
  }
  for (const p of ctx.phases || []) {
    for (const depId of p.dependencies || []) {
      const dep = (ctx.phases || []).find((x) => x.id === depId);
      if (dep?.status === "CANCELLED" && !["CANCELLED", "COMPLETED"].includes(p.status)) {
        findings.push({ code: "cancelled-dependency-unsatisfied", severity: "info", message: `${p.id} depends on cancelled ${depId}; cancellation does not satisfy delivery`, ref: p.id });
      }
    }
  }
  return findings;
}
