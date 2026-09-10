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
 *               stamped with the gate definition's own hash, filed under the
 *               reviewer role that gate file names — which is never one of the
 *               roles that wrote the artifacts, and never the human who signs.
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
 *   node .cursor/tools/lifecycle.mjs init [--name "X"] [--existing --by "<name>" [--review-by "<name>"]]
 *   node .cursor/tools/lifecycle.mjs status [--json]
 *   node .cursor/tools/lifecycle.mjs check [PHASE] [--json]
 *   node .cursor/tools/lifecycle.mjs record-gate PHASE --verdict GO|NO-GO --by "<reviewer>" [--criteria "7/7"] [--note "..."]
 *   node .cursor/tools/lifecycle.mjs approve PHASE --by "<name>" [--note "..."] [--accept-check <tool.mjs>]
 *   node .cursor/tools/lifecycle.mjs advance
 *   node .cursor/tools/lifecycle.mjs rollback PHASE --reason "..."
 *   node .cursor/tools/lifecycle.mjs override PHASE --reason "..." --risk LOW|MED|HIGH --by "<name>" --expires <days>
 *   node .cursor/tools/lifecycle.mjs gate [PHASE]
 *
 * Exit codes:  0 = ok   1 = gate not satisfied / refused   2 = usage
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { commitJson, writeJsonAtomic, actor, actorWarning } from "./_state.mjs";
import { recordFile, verifyChain, formatChainFindings, reseal, INDEX_REL, assertIndexedUnchanged } from "./_evidence.mjs";
import {
  SOURCE_ROOTS,
  sourceLayout as sourceLayoutAt,
} from "./_policy.mjs";

export { SOURCE_ROOTS };

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
/**
 * v3: `revision` for compare-and-swap writes, `inherited` as a record rather than
 * a boolean, and directory artifacts hashed by content. v2 files read fine and are
 * rewritten on the next mutating command; see migrate().
 */
const SCHEMA_VERSION = 3;

function repoRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { return null; }
}

/* ------------------------------------------------------------------ phases */

export const PHASES = ["REQUIREMENTS", "ANALYSIS", "DESIGN", "DEVELOPMENT", "TESTING", "PRODUCTION"];

/** Conventional application-source roots live in `_policy.mjs` so status, CI
 *  and (later) the phase hook share one list. Re-exported here so existing
 *  `import { SOURCE_ROOTS } from "./lifecycle.mjs"` callers keep working. */

/**
 * Required artifacts per phase. Presence is checked mechanically; quality is
 * the gate file's problem. Paths are relative to the repo root.
 *
 * `anyOf` means at least one of the listed paths must exist — used where a
 * project may legitimately organise the same content differently.
 *
 * `type` says what kind of thing has to be there, because "exists" was doing
 * the work of "is one". `docs/design/adr` passed as a directory holding a
 * .gitkeep; `specs/features` passed with a README in it; `tests/` passed with a
 * fixture folder and no test. Each type has a validator in artifactState() and
 * the reason it gives names the type, so a FAIL says what was expected rather
 * than only what was found.
 *
 *   document      a written artifact: real length, no template markers or slots
 *   adr-set       a directory with at least one ADR that is itself a document
 *   spec-set      a directory with at least one feature spec that is a document
 *   source-tree   a directory containing at least one source file
 *   test-suite    a directory containing at least one file that IS a test
 *   task-board    a document with no task row left "In Progress"
 *   pipeline      a CI definition: a workflow directory with a job, or one file
 */
const REQUIRED = {
  REQUIREMENTS: [
    { path: "docs/product/brief.md", type: "document", what: "Problem statement, actors, success measures, explicit anti-scope" },
    { path: "docs/product/prd.md", type: "document", what: "Product requirements — problem, users, goals, functional + non-functional" },
    { path: "docs/product/personas.md", type: "document", what: "Personas and jobs-to-be-done" },
    { path: "docs/product/story-map.md", type: "document", what: "User story map with Given/When/Then acceptance criteria" },
    { path: "docs/product/scope.md", type: "document", what: "MVP scope AND an explicit out-of-scope list" },
    { path: "docs/product/nfr.md", type: "document", what: "Quantified non-functional requirements" },
  ],
  ANALYSIS: [
    { path: "docs/analysis/domain-model.md", type: "document", what: "Entities, aggregates, invariants, ERD" },
    { path: "docs/analysis/use-cases.md", type: "document", what: "Actors and use cases, each tracing to a story" },
    { path: "docs/analysis/workflows.md", type: "document", what: "End-to-end business workflows" },
    { path: "docs/analysis/business-rules.md", type: "document", what: "Numbered rule catalogue, ready for promotion into memory-bank" },
    { path: "docs/analysis/risks.md", type: "document", what: "Risk register with owner and mitigation per high risk" },
  ],
  DESIGN: [
    { path: "docs/design/architecture.md", type: "document", what: "Chosen architecture + the variants it was chosen over" },
    { path: "docs/design/api-design.md", type: "document", what: "Endpoint catalogue covering every use case" },
    { path: "docs/design/database-design.md", type: "document", what: "Physical schema, indexes, provider roles" },
    { path: "docs/design/security-design.md", type: "document", what: "Authn/authz, data classification, threat-model output" },
    { path: "docs/design/ux/screen-inventory.md", type: "document", what: "Screens, their endpoints, RTL/i18n treatment" },
    { path: "docs/design/adr", type: "adr-set", what: "Architecture decision records — gate 3 criterion 10" },
  ],
  DEVELOPMENT: [
    { anyOf: SOURCE_ROOTS, type: "source-tree", what: "Application source" },
    { path: "specs/features", type: "spec-set", what: "At least one merged feature spec" },
    { path: "memory-bank/progress.md", type: "task-board", what: "Task board with no task left In Progress" },
  ],
  TESTING: [
    { path: "docs/testing/strategy.md", type: "document", what: "Test strategy: layers, coverage targets, environments" },
    { anyOf: ["tests", "test", "e2e"], type: "test-suite", what: "Test suites" },
  ],
  PRODUCTION: [
    { anyOf: [".github/workflows", "azure-pipelines.yml", ".gitlab-ci.yml"], type: "pipeline", what: "CI/CD pipeline" },
  ],
};

/** The declared type of a required path, or `document` for a path nothing declares. */
function typeOf(rel) {
  for (const reqs of Object.values(REQUIRED)) {
    for (const r of reqs) {
      if (r.path === rel || r.anyOf?.includes(rel)) return r.type || "document";
    }
  }
  return "document";
}

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
 * Directories that are never part of an artifact: build output, dependencies,
 * editor state. Skipped by the content hash and by every validator that walks,
 * so a `dotnet build` does not make TESTING stale and a 40,000-file node_modules
 * is never read. Anything git ignores is skipped too, when git is available.
 */
const SKIP_DIRS = new Set([".git", "node_modules", "bin", "obj", "dist", "build", "out", "coverage", "TestResults",
                           ".vs", ".idea", ".next", ".turbo", ".cache", "target", "__pycache__", ".pytest_cache", "vendor", "packages"]);
const WALK_CAP = 20_000;

/** Every regular file under `absDir`, as sorted repo-relative posix paths, honouring SKIP_DIRS and .gitignore. */
function walkFiles(absDir) {
  const out = [];
  const stack = [absDir];
  while (stack.length && out.length < WALK_CAP) {
    const d = stack.pop();
    let entries = [];
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;   // entries inside; the root itself may be a dot-dir (.github/workflows)
      const abs = join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) stack.push(abs); }
      else if (e.isFile()) out.push(abs);
    }
  }
  const rels = out.map((a) => a.slice(ROOT.length + 1).split("\\").join("/")).sort();
  return gitUnignored(rels);
}

/** Drop whatever .gitignore says is not part of the repo. One git call, not one per file. */
function gitUnignored(rels) {
  if (!rels.length) return rels;
  try {
    const res = execFileSync("git", ["check-ignore", "--stdin", "-z", "--no-index"], {
      cwd: ROOT, input: rels.join("\0") + "\0", encoding: "utf8", stdio: ["pipe", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024,
    });
    const ignored = new Set(res.split("\0").filter(Boolean));
    return rels.filter((r) => !ignored.has(r));
  } catch (e) {
    // exit 1 = nothing ignored; anything else = no git here. Both mean "keep them all".
    if (e && e.status === 1 && typeof e.stdout === "string") {
      const ignored = new Set(e.stdout.split("\0").filter(Boolean));
      return rels.filter((r) => !ignored.has(r));
    }
    return rels;
  }
}

/**
 * Hash of a required artifact.
 *
 *   file:  <sha of the bytes>
 *   dir2:  <sha over every file's path and content, recursively>
 *   dir:   <sha of the top-level entry names>  - the v2 algorithm, kept only to
 *          COMPARE against hashes recorded under it
 *
 * The first version hashed a directory by its entry names, on the argument that
 * rewriting one test should not stale the testing gate. It meant the opposite
 * too: every test could be gutted, every source file rewritten, and DEVELOPMENT
 * and TESTING stayed APPROVED as long as the file names held. An approval that
 * survives the approved thing being replaced is not an approval of the thing.
 *
 * `like` is a hash recorded earlier; when it carries the old prefix the old
 * algorithm is used so that the comparison is between like and like. A phase
 * approved under v2 therefore does not flip STALE from the upgrade itself; it
 * picks up content hashing the next time somebody approves it.
 */
export function artifactHash(rel, like = null) {
  const abs = join(ROOT, rel);
  try {
    const st = statSync(abs);
    if (!st.isDirectory()) return "file:" + sha(readFileSync(abs));
    if (typeof like === "string" && like.startsWith("dir:")) {
      return "dir:" + sha(readdirSync(abs).filter((f) => !f.startsWith(".")).sort().join("\n"));
    }
    const h = createHash("sha256");
    for (const r of walkFiles(abs)) {
      let body; try { body = readFileSync(join(ROOT, r)); } catch { continue; }
      h.update(r).update("\0").update(createHash("sha256").update(body).digest()).update("\n");
    }
    return "dir2:" + h.digest("hex").slice(0, 16);
  } catch { return null; }
}

/** Is the artifact at `rel` still what `was` recorded? Compares under the algorithm `was` used. */
export function artifactUnchanged(rel, was) {
  const now = artifactHash(rel, was);
  return { exists: now !== null, same: now === was, now };
}

/* ------------------------------------------------------- typed validators */

const SOURCE_RE = /\.(cs|csproj|fsproj|vb|ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|rs|rb|php|sql|vue|svelte)$/i;
const TEST_RE = /(\.(test|spec)\.[cm]?[jt]sx?$)|(Tests?\.cs$)|(_test\.(py|go)$)|(^|\/)test_[^/]+\.py$|(\.feature$)|(Spec\.cs$)|(\.Tests?\/)|(\.e2e\.[cm]?[jt]sx?$)|(\.cy\.[cm]?[jt]sx?$)/i;
const PIPELINE_RE = /^\s*(jobs|stages|steps|pipelines|workflows|on)\s*:/m;

function documentState(abs) {
  let body = "";
  try { body = readFileSync(abs, "utf8").trim(); } catch { return { ok: false, reason: "unreadable" }; }
  if (body.length < 120) return { ok: false, reason: "too short to be real content" };
  if (PLACEHOLDER.test(body)) return { ok: false, reason: "still a template (EXAMPLE/TODO marker)" };
  if (isUnfilled(body)) return { ok: false, reason: "still a template (unfilled [slots])" };
  return { ok: true, body };
}

/** Files under a directory that are documents by the same rule a single document is held to. */
function documentsUnder(abs, re = /\.md$/i) {
  return walkFiles(abs).filter((r) => re.test(r)).filter((r) => documentState(join(ROOT, r)).ok);
}

const VALIDATORS = {
  document(abs, isDir) {
    if (isDir) return { ok: false, reason: "expected a document, found a directory" };
    return documentState(abs);
  },
  "adr-set"(abs, isDir) {
    if (!isDir) return { ok: false, reason: "expected a directory of ADRs, found a file" };
    const n = documentsUnder(abs).length;
    return n ? { ok: true } : { ok: false, reason: "no ADR that is a real document (a .gitkeep or a template does not count)" };
  },
  "spec-set"(abs, isDir) {
    if (!isDir) return { ok: false, reason: "expected a directory of feature specs, found a file" };
    const n = documentsUnder(abs).filter((r) => !/(^|\/)readme\.md$/i.test(r)).length;
    return n ? { ok: true } : { ok: false, reason: "no feature spec that is a real document (a README does not count)" };
  },
  "source-tree"(abs, isDir) {
    if (!isDir) return { ok: false, reason: "expected a source directory, found a file" };
    const n = walkFiles(abs).filter((r) => SOURCE_RE.test(r)).length;
    return n ? { ok: true } : { ok: false, reason: "no source file in it" };
  },
  "test-suite"(abs, isDir) {
    if (!isDir) return { ok: false, reason: "expected a test directory, found a file" };
    const files = walkFiles(abs);
    const tests = files.filter((r) => TEST_RE.test(r));
    if (tests.length) return { ok: true };
    return { ok: false, reason: files.length ? `${files.length} file(s), none of them a test (*.test.*, *.spec.*, *Tests.cs, test_*.py, *_test.go, *.feature)` : "empty directory" };
  },
  "task-board"(abs, isDir) {
    if (isDir) return { ok: false, reason: "expected a task board document, found a directory" };
    const d = documentState(abs);
    if (!d.ok) return d;
    const open = d.body.split("\n").filter((l) => /^\s*\|/.test(l) && /\bIn[\s-]Progress\b/i.test(l) && !/^\s*\|[\s|:-]*$/.test(l));
    return open.length ? { ok: false, reason: `${open.length} task row(s) still In Progress` } : { ok: true };
  },
  pipeline(abs, isDir) {
    if (isDir) {
      const ymls = walkFiles(abs).filter((r) => /\.ya?ml$/i.test(r));
      const withJobs = ymls.filter((r) => { try { return PIPELINE_RE.test(readFileSync(join(ROOT, r), "utf8")); } catch { return false; } });
      return withJobs.length ? { ok: true } : { ok: false, reason: ymls.length ? "workflow file(s) present but none defines a job" : "no workflow file" };
    }
    let body = ""; try { body = readFileSync(abs, "utf8"); } catch { return { ok: false, reason: "unreadable" }; }
    return PIPELINE_RE.test(body) ? { ok: true } : { ok: false, reason: "pipeline file defines no jobs/stages/steps" };
  },
};

/**
 * Is the thing at `rel` a valid artifact of the kind the gate requires?
 *
 * Every FAIL reason names what was expected, because a reviewer who reads
 * "empty directory" for `docs/design/adr` has to know that ADRs are documents
 * and a .gitkeep is not one; the validator knows, so it should say.
 */
function artifactState(rel, type = typeOf(rel)) {
  const abs = join(ROOT, rel);
  let st;
  try { st = statSync(abs); } catch { return { ok: false, reason: "missing" }; }
  const v = VALIDATORS[type] || VALIDATORS.document;
  const r = v(abs, st.isDirectory());
  return r.ok ? { ok: true, type } : { ok: false, type, reason: r.reason };
}

/**
 * Which concrete paths a phase's requirements resolve to right now. EVERY
 * present `anyOf` alternative, not the first: a repo with both `backend/` and
 * `frontend/` used to have only `backend/` hashed, so the frontend could be
 * rewritten under an APPROVED development gate without the gate noticing.
 */
function resolvedPaths(phase) {
  const out = [];
  for (const r of REQUIRED[phase] || []) {
    if (r.anyOf) { for (const p of r.anyOf) if (artifactState(p, r.type).ok) out.push(p); }
    else out.push(r.path);
  }
  return out;
}

export const gateFile = (p) => `${String(PHASES.indexOf(p) + 1).padStart(2, "0")}-${p.toLowerCase()}.gate.md`;

/**
 * Where a gate definition actually lives — the project's copy first, the copy
 * shipped beside this tool second.
 *
 * The plugin used to carry lifecycle.mjs, guard-phase.mjs, write-policy.json and
 * every document describing six gates, and no gate definitions. So on a plugin
 * install `record-gate` died with "cannot record a verdict against nothing", no
 * judgement consent could ever exist, `approve` refused forever, and the entire
 * six-phase layer was unusable while every document said it worked. That is the
 * guard-phase defect one level out: the engine shipped and the fuel did not.
 *
 * Project-first, not plugin-first: gate criteria are meant to be tightened per
 * product, and a criterion that can only be edited inside a read-only install is
 * not a criterion anybody owns. The fallback sets the default; copying the file
 * into `.cursor/lifecycle/gates/` takes it over. `gate` prints which one it read,
 * because a team that edited the wrong copy is a new way to be wrong.
 */
export function gatePath(phase) {
  const own = join(GATES(), gateFile(phase));
  if (existsSync(own)) return { path: own, source: "project" };
  const shipped = new URL(`../lifecycle/gates/${gateFile(phase)}`, import.meta.url);
  try { if (existsSync(shipped)) return { path: shipped, source: "shipped with the plugin" }; } catch { /* not a file URL */ }
  return { path: own, source: null };
}

/**
 * The gate definition's own version. Tighten a criterion and every approval
 * granted against the looser version stops counting — which is the whole point
 * of writing criteria down.
 */
export function gateVersion(phase) {
  try { return sha(readFileSync(gatePath(phase).path, "utf8")); } catch { return null; }
}

/**
 * WHO MAY JUDGE THIS GATE.
 *
 * Every phase owner used to review its own phase: product-manager both wrote
 * the requirements and judged gate 1, solution-architect both chose the
 * architecture and judged gate 3. That is not a reviewer, it is an author
 * reading its own work back with all of the author's reasons still in context.
 * It never finds the thing it did not think of the first time.
 *
 * The assignment lives in the gate file, not here, so it is versioned with the
 * criteria: change the reviewer and gateVersion changes, so verdicts recorded
 * under the old assignment lapse. That is correct - a different reviewer is a
 * different review.
 *
 *   **Authored by:** `product-manager`, `ux-bridge`
 *   **Reviewed by:** `business-analyst`
 *
 * What this proves and what it does not: it proves the verdict was filed under
 * a role that did not write the artifacts. It cannot prove the reviewer read
 * anything, and nothing here can. Independence comes from launching that role
 * as a fresh subagent with no memory of the authoring; this check only makes
 * skipping that step something you have to do on purpose.
 */
export function gateMeta(phase) {
  let src = "";
  try { src = readFileSync(gatePath(phase).path, "utf8"); } catch { return { reviewer: null, authors: [] }; }
  const roles = (label) => {
    const m = src.match(new RegExp(`^\\*\\*${label}:\\*\\*(.+)$`, "mi"));
    return m ? [...m[1].matchAll(/`([a-z0-9-]+)`/g)].map((x) => x[1]) : [];
  };
  return { reviewer: roles("Reviewed by")[0] || null, authors: roles("Authored by") };
}

/* --------------------------------------------------------- status derivation */

/**
 * Which statuses let the NEXT phase proceed and open the source gate.
 *
 * INHERITED_UNVERIFIED is in here on purpose. It is what a v2 `inherited: true`
 * becomes, and what `init --existing` produces when nobody has yet put a name to
 * the claim that phases 1-3 happened. Blocking every source write on a live
 * brownfield repo because a flag was upgraded would be the platform punishing
 * its own users for adopting it; the status is reported everywhere, and a
 * RELEASE refuses to rest on it (RELEASE_CLEARED) until someone accepts it by
 * name. That is the difference between letting work continue and letting a
 * release claim a review that never happened.
 */
export const CLEARED = new Set(["APPROVED", "INHERITED", "INHERITED_UNVERIFIED"]);
/** What a release record may cite as a cleared gate without the signer naming it. */
export const RELEASE_CLEARED = new Set(["APPROVED", "INHERITED"]);

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

  if (p.inherited) {
    // A record says who claimed it and who, if anyone, looked. A boolean - the
    // v2 shape, or a hand-written one - says only that somebody typed `true`.
    const inh = typeof p.inherited === "object" ? p.inherited : { legacy: true };
    if (inh.by && inh.reviewBy) {
      return { status: "INHERITED", reasons: [`brownfield: ${inh.basis || "done informally before the lifecycle was adopted"}; claimed by ${inh.by}, reviewed by ${inh.reviewBy}`] };
    }
    return {
      status: "INHERITED_UNVERIFIED",
      reasons: [inh.legacy
        ? "brownfield: recorded as inherited before anyone had to say by whom - a release cannot rest on this until it is accepted by name (release-evidence sign --accept-inherited)"
        : `brownfield: claimed by ${inh.by || "nobody named"}, reviewed by nobody - a release cannot rest on this until it is accepted by name`],
    };
  }

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
    const r = artifactUnchanged(rel, was);
    if (!r.exists) reasons.push(`${rel} no longer exists`);
    else if (!r.same) reasons.push(`${rel} changed since approval`);
  }
  // checkPhase() hashes every present anyOf alternative. derive used to look
  // only at the recorded map, so a project approved against `src/` that later
  // grew `frontend/` stayed APPROVED — the new root was never in that map.
  for (const rel of resolvedPaths(phase)) {
    if (!(rel in recorded)) reasons.push(`${rel} appeared since approval and was never hashed`);
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

/**
 * What an existing codebase has to show before it may claim phases 1-3 were
 * done. `init --existing` on an empty directory used to produce a product in
 * DEVELOPMENT with the design gate open and nothing designed - the greenfield
 * gates, skipped by typing one flag.
 */
function inheritanceEvidence() {
  let commits = 0, head = null;
  try { commits = parseInt(execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(), 10) || 0; } catch { /* no git or no commits */ }
  try { head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* none */ }
  const roots = SOURCE_ROOTS
    .filter((d) => { try { return statSync(join(ROOT, d)).isDirectory(); } catch { return false; } });
  let sourceFiles = 0;
  for (const d of roots) sourceFiles += walkFiles(join(ROOT, d)).filter((r) => SOURCE_RE.test(r)).length;
  if (!roots.length) {
    // No conventional root. Anything at the top level that is source still counts.
    try { sourceFiles = readdirSync(ROOT).filter((f) => SOURCE_RE.test(f)).length; } catch { /* unreadable */ }
  }
  return { commits, head, sourceRoots: roots, sourceFiles };
}

/**
 * Write-policy glob, built-in fallback, and source-root layout live in
 * `_policy.mjs` so lifecycle status and adopter CI cannot drift. This file
 * must not import guard-phase.mjs: the hook already imports lifecycle.mjs.
 */
function sourceLayout() {
  return sourceLayoutAt(ROOT, { importMetaUrl: import.meta.url });
}

function blankState(name, mode, { by = null, reviewBy = null, evidence = null } = {}) {
  const phases = {};
  const at = new Date().toISOString();
  for (const p of PHASES) phases[p] = {};
  if (mode === "brownfield") {
    // An existing codebase did not skip phases 1-3 — it did them informally,
    // years ago, in people's heads. Recording that honestly as INHERITED is
    // better than either pretending they were approved or blocking all work.
    // The record says WHO claims that and, when given, who reviewed the claim;
    // without a reviewer it derives as INHERITED_UNVERIFIED.
    for (const p of ["REQUIREMENTS", "ANALYSIS", "DESIGN"]) {
      phases[p] = { inherited: { basis: "init --existing", by, reviewBy, at, evidence } };
    }
    phases.DEVELOPMENT = { startedAt: at };
  } else {
    phases.REQUIREMENTS = { startedAt: at };
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    product: name || "unnamed",
    mode,
    phase: mode === "brownfield" ? "DEVELOPMENT" : "REQUIREMENTS",
    updated: at,
    phases,
    history: [{ at, event: "init", detail: `mode=${mode}${by ? ` by ${by}` : ""}` }],
  };
}

export function readState() {
  return readStateInfo().state;
}

/**
 * The state file with its condition named, because "null" used to mean both
 * "never adopted the lifecycle" and "adopted it, and the file is now
 * unreadable" - and those two deserve opposite treatment. A hook that sees
 * `missing` has no opinion; a hook that sees `corrupt` refuses the write, and
 * `status` says which file failed to parse instead of suggesting `init` over
 * the top of a product's history.
 *
 *   { status: "missing" }                               no file
 *   { status: "corrupt", error }                        exists, not JSON / not an object
 *   { status: "ok", state }                             readable, migrated if v1
 */
export function readStateInfo() {
  if (!existsSync(STATE())) return { status: "missing", state: null };
  let s;
  try { s = JSON.parse(readFileSync(STATE(), "utf8")); }
  catch (e) { return { status: "corrupt", state: null, error: `not valid JSON: ${e.message}` }; }
  if (!s || typeof s !== "object" || Array.isArray(s)) return { status: "corrupt", state: null, error: "not a JSON object" };
  if (s.phases !== undefined && (typeof s.phases !== "object" || s.phases === null)) return { status: "corrupt", state: null, error: '"phases" is not an object' };
  if (s.phase !== undefined && !PHASES.includes(s.phase)) return { status: "corrupt", state: null, error: `"phase" is ${JSON.stringify(s.phase)}, not one of ${PHASES.join("/")}` };
  if (!Number.isInteger(s.revision)) s.revision = 0;   // pre-v3 file: the CAS treats "no counter" as revision 0
  return { status: "ok", state: (s.schemaVersion || 1) < SCHEMA_VERSION ? migrate(s) : s };
}

/**
 * v1 recorded `{status, approved:{by,at,note}}` per phase — a human consent with
 * no mechanical hashes and no judgement record. Those approvals cannot be
 * upgraded, only reported: derivePhase() returns STALE for them, which is the
 * honest answer to "was this reviewed?" — nobody knows.
 *
 * v2 recorded `inherited: true`. v3 wants to know by whom, and the answer for a
 * v2 file is "nobody said": it becomes `{legacy: true}` and derives as
 * INHERITED_UNVERIFIED. Nothing else about a v2 file changes; its `dir:` hashes
 * are compared under the algorithm that produced them (see artifactHash).
 *
 * Migration is in memory. The file is rewritten in the new shape by the next
 * command that writes anyway, so a read-only command never touches the disk.
 */
function migrate(s) {
  const from = s.schemaVersion || 1;
  let out = s;
  if (from < 2) {
    const phases = {};
    for (const p of PHASES) {
      const old = s.phases?.[p] || {};
      const n = {};
      if (old.status === "INHERITED") n.inherited = true;
      if (old.approved) n.human = { status: "APPROVED", by: old.approved.by, at: old.approved.at, note: old.approved.note || "" };
      if (old.status === "IN_PROGRESS") n.startedAt = s.updated || new Date().toISOString();
      phases[p] = n;
    }
    out = { ...s, phases };
  }
  if (from < 3) {
    const phases = {};
    for (const p of PHASES) {
      const ph = { ...(out.phases?.[p] || {}) };
      if (ph.inherited === true) ph.inherited = { legacy: true, at: ph.at || out.updated || null };
      phases[p] = ph;
    }
    out = { ...out, phases, revision: Number.isInteger(out.revision) ? out.revision : 0 };
  }
  return { ...out, schemaVersion: SCHEMA_VERSION, migratedFrom: from };
}

/**
 * Persist the state. Atomic (temp file + rename) and conditional: the file must
 * still be at the revision this process read, or the write is refused and the
 * command exits 1 without having changed anything. Two sessions approving two
 * different phases against the same stale read used to be one silent overwrite.
 */
function writeState(s) {
  s.updated = new Date().toISOString();
  const last = (s.history || [])[s.history.length - 1];
  try {
    commitJson(STATE(), s, {
      onTakeover: () => console.error(`WARN  a stale lock on lifecycle/state.json was taken over - a previous command did not exit cleanly.`),
      beforeWrite: () => assertIndexedUnchanged(ROOT, "lifecycle/state.json"),
      afterWrite: () => chain("lifecycle/state.json", "state", { revision: s.revision, event: last ? `${last.event}: ${last.detail}` : null }),
    });
  } catch (e) {
    if (e.code === "ECONFLICT" || e.code === "ELOCKED" || e.code === "ECORRUPT" || e.code === "ECHANGED" || e.code === "EUNINDEXED") die(`REFUSED: ${e.message}\nNothing was written.`, 1);
    throw e;
  }
}

/**
 * Add a record that was just written to lifecycle/index.jsonl. The record is on
 * disk either way; if the index cannot be appended, `evidence` will report the
 * record as CHANGED or UNINDEXED and a human reseals - so say it now, loudly,
 * rather than let the next `approve` be the first to notice.
 */
function chain(relPath, kind, meta) {
  try { return recordFile(ROOT, relPath, kind, meta); }
  catch (e) {
    console.error(`WARN  ${relPath} was written but could not be added to ${INDEX_REL}: ${e.message}`);
    console.error(`      \`lifecycle.mjs evidence\` will report it until a human reseals the chain.`);
    return null;
  }
}

/* ------------------------------------------------------------------ commands */

export function checkPhase(phase) {
  const reqs = REQUIRED[phase] || [];
  const rows = reqs.map((r) => {
    const type = r.type || "document";
    if (r.anyOf) {
      const states = r.anyOf.map((p) => ({ p, ...artifactState(p, type) }));
      const hits = states.filter((x) => x.ok);
      // Say WHY the present candidates failed, not only that none passed: a
      // `tests/` holding fixtures and no test is a different problem from no `tests/`.
      const present = states.filter((x) => x.reason !== "missing");
      const reason = hits.length ? "" : present.length ? present.map((x) => `${x.p}: ${x.reason}`).join("; ") : "none present";
      return { artifact: r.anyOf.join(" | "), type, what: r.what, ok: hits.length > 0, reason, resolved: hits.map((x) => x.p) };
    }
    const st = artifactState(r.path, type);
    return { artifact: r.path, type, what: r.what, ok: st.ok, reason: st.reason || "" };
  });
  return { phase, ok: rows.every((r) => r.ok), artifacts: rows };
}

function cmdInit(args) {
  const info = readStateInfo();
  if (info.status === "corrupt") die(`lifecycle/state.json exists but cannot be read: ${info.error}\nRefusing to init over a product's history. Restore it from git or repair it with the user.`, 1);
  if (info.status === "ok") die(`lifecycle/state.json already exists — use 'status', or delete it deliberately.`, 1);
  const mode = args.includes("--existing") ? "brownfield" : "greenfield";

  let s;
  if (mode === "brownfield") {
    // INHERITED is a claim about the past. A claim has a claimant, and it has
    // to be about something: an empty directory did not do phases 1-3 informally.
    const by = valueOf(args, "--by");
    const reviewBy = valueOf(args, "--review-by");
    if (!by) die(`init --existing needs --by "<name>".\n\nIt records that phases 1-3 happened informally before this repo adopted the\nlifecycle. That is a claim, and a claim with nobody's name on it is a flag\nsomebody typed. Add --review-by "<name>" for whoever checked the claim (not the\nsame person) and the phases derive INHERITED; without it they derive\nINHERITED_UNVERIFIED - source writes still open, but a release cannot rest on\nthem until a signer accepts them by name.`, 2);
    if (reviewBy && reviewBy.trim().toLowerCase() === by.trim().toLowerCase()) die(`--review-by must be a different person from --by. One name twice is one consent.`, 2);
    const ev = inheritanceEvidence();
    if (!ev.commits && !ev.sourceFiles) {
      die(`REFUSED: nothing here to inherit.\n\n  commits:      ${ev.commits}\n  source files: ${ev.sourceFiles}${ev.sourceRoots.length ? ` under ${ev.sourceRoots.join(", ")}` : " (no src/, backend/, frontend/, client/, app/, lib/ ...)"}\n\n--existing says a system already exists and its requirements, analysis and\ndesign were done informally. An empty repository did none of that. Use\n\`init --name "<product>"\` and start at REQUIREMENTS.`, 1);
    }
    s = blankState(valueOf(args, "--name"), mode, { by, reviewBy: reviewBy || null, evidence: { commits: ev.commits, head: ev.head, sourceRoots: ev.sourceRoots, sourceFiles: ev.sourceFiles } });
    const w = actorWarning(by, actor(ROOT));
    if (w) console.error(w);
  } else {
    s = blankState(valueOf(args, "--name"), mode);
  }
  writeState(s);
  console.log(`Initialised ${mode} lifecycle for "${s.product}".`);
  console.log(`Current phase: ${s.phase}`);
  if (mode === "brownfield") {
    const inh = s.phases.REQUIREMENTS.inherited;
    console.log(inh.reviewBy
      ? `Phases 1-3 marked INHERITED — claimed by ${inh.by}, reviewed by ${inh.reviewBy}; ${inh.evidence.commits} commit(s), ${inh.evidence.sourceFiles} source file(s) behind the claim.`
      : `Phases 1-3 marked INHERITED_UNVERIFIED — claimed by ${inh.by}, reviewed by nobody yet.\nSource writes are open. A release cannot cite these phases until the signer\nnames them: release-evidence.mjs sign <v> --accept-inherited REQUIREMENTS ...`);
    console.log(`Run /feature-inventory and /context-sync to give them real artifacts if you want them APPROVED.`);
  }
}

function cmdStatus(args) {
  const s = mustState();
  const d = deriveAll(s);
  const layout = sourceLayout();
  if (args.includes("--json")) return console.log(JSON.stringify({ ...s, derived: d, layout }, null, 2));

  console.log(`Product:  ${s.product}   (${s.mode})`);
  console.log(`Phase:    ${s.phase}`);
  console.log(`Updated:  ${s.updated}`);
  if (s.migratedFrom) console.log(`Migrated: from schema v${s.migratedFrom} — ${s.migratedFrom < 2 ? "approvals without evidence read as STALE" : "inherited phases read as INHERITED_UNVERIFIED until somebody is named"}.`);
  console.log("");

  const MARK = { APPROVED: "[x]", INHERITED: "[i]", INHERITED_UNVERIFIED: "[u]", IN_PROGRESS: "[~]", STALE: "[!]", BLOCKED: "[-]", NOT_STARTED: "[ ]" };
  for (const [i, p] of PHASES.entries()) {
    const st = d[p];
    const here = p === s.phase ? "->" : "  ";
    const ph = s.phases[p] || {};
    const consents = [
      ph.mechanical?.status === "PASS" ? "M" : "·",
      ph.judgement?.verdict === "GO" ? "J" : "·",
      ph.human?.status === "APPROVED" ? "H" : "·",
    ].join("");
    console.log(`${here} ${MARK[st.status] || "[?]"} ${i + 1}. ${p.padEnd(12)} ${st.status.padEnd(20)} ${consents}`);
    for (const r of st.reasons) console.log(`         ${r}`);
  }
  console.log("");
  console.log(`Consents: M=mechanical  J=judgement (/lifecycle-gate)  H=human`);
  console.log("");
  console.log(designCleared(s)
    ? "Design gate cleared — phase-gated source writes are allowed."
    : "Design gate NOT cleared — guard-phase.mjs will block writes matching write-policy application-source.");
  if (layout.uncovered.length) {
    console.log(`Layout:   ${layout.uncovered.join(", ")} exist(s) but no write-policy rule matches. Writes there are not phase-gated.`);
  }
  if (layout.exempt.length) {
    console.log(`Layout:   ${layout.exempt.join(", ")} exist(s) but alwaysAllow exempts them. Writes there are not phase-gated.`);
  }
  if (layout.detected.length && !layout.uncovered.length && !layout.exempt.length) {
    console.log(`Layout:   source roots ${layout.detected.join(", ")} are covered by write-policy.`);
  }
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
 *
 * A link is judged when its far end is DUE, not before. Checking REQUIREMENTS
 * used to demand that every story reach a use case - a phase 2 document - so
 * gate 1 could not pass on any repo that used ids until phase 2 was written,
 * and nobody noticed because `approve` never ran this. The chain is cumulative:
 * at phase P every id defined in phases <= P must reach every target whose
 * phase is <= P. S -> UC is asked at ANALYSIS; NFR -> ADR at DESIGN.
 */
async function traceability(phase) {
  try {
    const as = await import(new URL("./artifact-schema.mjs", import.meta.url).href);
    const g = as.buildGraph();
    if (!g.byId.size) return null;
    const pi = PHASES.indexOf(phase);
    const phaseOf = (prefix) => PHASES.indexOf(g.grammar[prefix]?.phase);
    const due = (prefix) => { const i = phaseOf(prefix); return i >= 0 && i <= pi; };
    const prefixOf = (id) => id.replace(/^.*\//, "").split("-")[0];
    const dangling = [];
    for (const [file, refs] of g.refsByFile) {
      for (const id of refs) if (!g.byId.has(id) && due(prefixOf(id))) dangling.push({ id, file });
    }
    const unlinked = [];
    for (const v of g.byId.values()) {
      if (!due(v.prefix)) continue;
      const targets = (g.grammar[v.prefix]?.tracesTo || []).filter(due);
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
    console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.artifact}  (${r.type})`);
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
    ? `Mechanical check passes. That is one consent of three.\nNext: /lifecycle-gate ${phase} — presence is not quality. Criteria: ${gateLabel(phase)}`
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
  if (!gv) die(`No gate definition at ${rel(join(GATES(), gateFile(phase)))}, and none shipped beside this tool.\nCannot record a verdict against nothing.`, 1);

  // --- separation of duties. The author may not sign off the author. --------
  const meta = gateMeta(phase);
  const gpath = gateLabel(phase);
  if (meta.reviewer && by !== meta.reviewer) {
    const authored = meta.authors.includes(by);
    die(`REFUSED: ${phase} is judged by \`${meta.reviewer}\`, not "${by}".\n\n` +
        (authored
          ? `  \`${by}\` wrote these documents. An author re-reading their own work is not\n` +
            `  a second consent — it is the first one signed twice.\n\n`
          : "") +
        `  ${gpath} names the reviewer and says why it is that one.\n` +
        `  Launch \`${meta.reviewer}\` as a fresh subagent — it must reach the criteria\n` +
        `  through the documents, not through the conversation that produced them.`, 2);
  }
  if (!meta.reviewer) {
    console.error(`WARN  ${gpath} names no reviewer (no "**Reviewed by:**" line).`);
    console.error(`      This verdict is recorded, but nothing here can tell whether it came`);
    console.error(`      from someone other than the author. Add the line.\n`);
  }

  // The verdict is about THIS content. Hashing it here is what lets `approve`
  // refuse a signature collected on an earlier draft.
  const judgedArtifacts = {};
  for (const p of resolvedPaths(phase)) { const h = artifactHash(p); if (h) judgedArtifacts[p] = h; }

  const attempt = (s.history || []).filter((h) => h.event === "gate" && String(h.detail || "").startsWith(phase + " ")).length + 1;

  const rec = {
    verdict, by,
    at: new Date().toISOString(),
    gateVersion: gv,
    reviewerRole: meta.reviewer || null,
    attempt,
    artifacts: judgedArtifacts,
    criteria: valueOf(args, "--criteria") || "",
    note: valueOf(args, "--note") || "",
    // Who the environment says typed this. A reviewer role is a name like
    // "security-auditor", so it never matches and no warning is printed here;
    // the record still says which account and machine filed the verdict.
    recordedBy: actor(ROOT),
  };
  s.phases[phase] = { ...(s.phases[phase] || {}), judgement: rec };
  s.history.push({ at: rec.at, event: "gate", detail: `${phase} ${verdict} by ${by}` });
  writeState(s);

  // Evidence on disk, not only in state. "Why was this allowed?" should be
  // answerable months later without reading a chat log.
  const ev = join(EVIDENCE(), `${phase.toLowerCase()}-${rec.at.replace(/[:.]/g, "-")}.json`);
  writeJsonAtomic(ev, { phase, ...rec, gateFile: gateFile(phase), mechanical: checkPhase(phase) });
  chain(rel(ev), "gate-verdict", { phase, verdict, by, attempt });

  console.log(`${phase} judgement recorded: ${verdict} by ${by}${attempt > 1 ? `  (attempt ${attempt})` : ""}`);
  const nh = Object.keys(judgedArtifacts).length;
  console.log(nh
    ? `${nh} artifact(s) hashed — editing any of them before approval voids this verdict.`
    : `No ${phase} artifact exists yet, so this verdict is bound to nothing. It will not carry an approval.`);
  console.log(`Evidence: ${rel(ev)}`);
  if (verdict === "GO") console.log(`Next: node .cursor/tools/lifecycle.mjs approve ${phase} --by "<name>"`);
  else { console.log(`NO-GO recorded. The phase cannot be approved until a GO replaces it.`); process.exit(1); }
}

/**
 * Run one of the sibling checkers and record that it ran, its exit code and its
 * last line. Output is not parsed: a record that breaks when a tool reformats a
 * table is a record that stops being written. Exit 2 from these tools means
 * "nothing to check" (no specs, no tests), which is reported and not counted as
 * a failure - a gate must not fail on its own absence.
 */
function ranCheck(tool, args) {
  // A path, not a URL: `node file:///...` is "Cannot find module", and the
  // check would report that stack trace's last line as the tool's verdict.
  let abs = null;
  try { abs = fileURLToPath(new URL(`./${tool}`, import.meta.url)); } catch { /* not a file URL */ }
  if (!abs || !existsSync(abs)) return { tool, ran: false, why: "not present beside lifecycle.mjs" };
  const lastLine = (s) => (String(s).split("\n").map((l) => l.trim()).filter(Boolean).pop() || "").slice(0, 300);
  try {
    const out = execFileSync(process.execPath, [abs, ...args], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024, timeout: 120_000 });
    return { tool, args, ran: true, ok: true, exit: 0, summary: lastLine(out) };
  } catch (e) {
    const exit = typeof e.status === "number" ? e.status : null;
    return { tool, args, ran: true, ok: exit === 2, skipped: exit === 2, exit, summary: lastLine(String(e.stdout || "") + String(e.stderr || "")) };
  }
}

/**
 * The computed checks a phase's mechanical consent includes beyond artifact
 * presence. TESTING runs ac-trace: a test suite whose tests do not assert the
 * acceptance criteria is present and not evidence, and the gate file said so
 * as a criterion for a reviewer to judge while nothing computed it.
 */
const PHASE_CHECKS = {
  TESTING: [["ac-trace.mjs", ["check"]]],
};

/**
 * The refusal conditions `approve` applies, computed without writing. The
 * dashboard composer imports this so a green light and a CLI refusal cannot
 * silently disagree.
 *
 * `acceptChecks` names checks whose FAIL the signer takes on by name
 * (`--accept-check ac-trace.mjs`); the acceptance goes into the record.
 *
 * Returns { refusals, reapproval, override, mechanical, traceability, checks }.
 * Writes nothing. Async because the traceability graph and the checks are.
 */
export async function approveRefusals(state, phase, by, { acceptChecks = [] } = {}) {
  const refusals = [];

  // --- order. A phase approved out of turn is a gate that gates nothing.
  //
  // With one exception, and it is the case that actually happens: release 2. A
  // feature lands, `specs/features/` moves, DEVELOPMENT derives to STALE while
  // the product sits in PRODUCTION. Re-approving it is not skipping ahead — it
  // is refreshing an approval that already exists, and it is the whole loop
  // between phases 4 and 5. The alternative was `rollback DEVELOPMENT`, which
  // also resets TESTING and PRODUCTION and throws away two approvals that are
  // still true. Nobody does that twice; they route around the lifecycle instead.
  const reapproval = PHASES.indexOf(phase) < PHASES.indexOf(state.phase) && !!state.phases[phase]?.human;
  if (phase !== state.phase && !reapproval) {
    refusals.push(`${phase} is not the current phase (${state.phase}). Approving out of order defeats the sequence.`);
  }
  const prev = PHASES[PHASES.indexOf(phase) - 1];
  if (prev) {
    const pd = derivePhase(state, prev);
    if (!CLEARED.has(pd.status)) refusals.push(`${prev} is ${pd.status}, not approved. ${pd.reasons[0] || ""}`.trim());
  }

  // --- mechanical. Recomputed now, never trusted from an earlier run. --------
  const mech = checkPhase(phase);
  if (!mech.ok) {
    refusals.push(`Mechanical check fails:`);
    for (const r of mech.artifacts.filter((x) => !x.ok)) refusals.push(`    - ${r.artifact} (${r.reason})`);
  }

  // --- traceability is part of the mechanical consent, so `approve` runs it.
  // `check` ran it and `approve` did not, which meant the one command that
  // mattered was the one that skipped it.
  const tr = await traceability(phase);
  if (tr?.broken) {
    refusals.push(`Traceability could not run (${tr.broken}). The mechanical consent cannot be computed - fix the checker before approving.`);
  } else if (tr) {
    for (const d of tr.dangling) refusals.push(`${d.id} is cited in ${d.file} and defined nowhere.`);
    for (const u of tr.unlinked) refusals.push(`${u.id} (${u.file}) reaches no ${u.targets.join(" or ")}. A chain that stops is a decision nobody carried forward.`);
  }

  // --- computed checks for this phase. A FAIL is a refusal unless accepted by name.
  const checks = (PHASE_CHECKS[phase] || []).map(([tool, cargs]) => {
    const r = ranCheck(tool, cargs);
    r.accepted = !r.ok && acceptChecks.includes(tool);
    return r;
  });
  for (const c of checks) {
    if (!c.ran || c.ok || c.accepted) continue;
    refusals.push(`${c.tool} ${c.args.join(" ")} exited ${c.exit}: ${c.summary || "(no output)"}`);
    refusals.push(`    A signer who wants to proceed anyway says so by name: --accept-check ${c.tool}`);
  }

  // --- judgement. The consent the first version of this file forgot. --------
  const j = state.phases[phase]?.judgement;
  const gv = gateVersion(phase);
  if (!j) {
    refusals.push(`No /lifecycle-gate verdict recorded. Run the gate, then:`);
    refusals.push(`    node .cursor/tools/lifecycle.mjs record-gate ${phase} --verdict GO --by "lifecycle-gate"`);
  } else if (j.verdict !== "GO") {
    refusals.push(`The recorded verdict is ${j.verdict} (by ${j.by}, ${j.at.slice(0, 10)}). Never soften a NO-GO.`);
  } else if (gv && j.gateVersion !== gv) {
    refusals.push(`The verdict was recorded against an older ${gateFile(phase)}. Re-run /lifecycle-gate against the current criteria.`);
  }

  // --- the verdict must bind to the words it was given. Editing an artifact
  // between the review and the signature is the same failure as editing one
  // after it, and it was the only one this file did not catch: the GO carried
  // over to content nobody had read.
  if (j?.verdict === "GO" && j.artifacts) {
    for (const [p, was] of Object.entries(j.artifacts)) {
      const r = artifactUnchanged(p, was);
      if (!r.exists) refusals.push(`${p} was reviewed on ${j.at.slice(0, 10)} and no longer exists.`);
      else if (!r.same) refusals.push(`${p} changed after ${j.by} judged it on ${j.at.slice(0, 10)}. The GO is on an older draft.`);
    }
    for (const p of resolvedPaths(phase)) {
      if (!(p in j.artifacts)) refusals.push(`${p} appeared after the verdict — no reviewer has seen it.`);
    }
  }

  // --- and the two consents must be two parties. -----------------------------
  if (j && by && String(j.by).trim().toLowerCase() === String(by).trim().toLowerCase()) {
    refusals.push(`The verdict was recorded by "${j.by}" and you are signing as the same party. Two consents held by one signature is one consent.`);
  }

  // --- the chain. Listed with the refusals so the dashboard shows it in the same
  // place; `approve` itself treats it as the one refusal no override reaches.
  const chained = verifyChain(ROOT);
  if (!chained.ok) refusals.push(`evidence chain: ${chained.findings.length} finding(s) in ${INDEX_REL} - ${chained.findings.map((f) => f.code).filter((c, i, a) => a.indexOf(c) === i).join(", ")}. Not overridable; see \`lifecycle.mjs evidence\`.`);

  return { refusals, reapproval, override: activeOverride(state, phase), mechanical: mech, traceability: tr, checks, chain: chained };
}

/* ----------------------------------------------------------------- evidence */

/**
 * `evidence`          walk lifecycle/index.jsonl and say whether every record
 *                     is the one that was written, in the order it was written
 * `evidence reseal`   human-only: archive the chain, start a new one, by name
 */
function cmdEvidence(args) {
  const sub = args[0] && !args[0].startsWith("--") ? args[0] : null;
  if (sub === "reseal") {
    const by = valueOf(args, "--by"), reason = valueOf(args, "--reason");
    let r;
    try { r = reseal(ROOT, { by, reason }); }
    catch (e) { die(`REFUSED: ${e.message}`, 2); }
    console.log(`Evidence chain resealed by ${by}.`);
    console.log(r.archived ? `  archived: ${r.archived} (${r.accepted} finding(s) accepted by name)` : `  no previous chain to archive`);
    console.log(`  adopted:  ${r.adopted} record(s) under the new first line`);
    console.log(`\nThe archive is a record too. Commit both files.`);
    return;
  }
  if (sub && sub !== "verify") die(`evidence: unknown subcommand "${sub}". Use \`evidence\`, \`evidence verify\` or \`evidence reseal --by --reason\`.`, 2);

  const v = verifyChain(ROOT);
  if (args.includes("--json")) {
    console.log(JSON.stringify({ exists: v.exists, ok: v.ok, entries: v.entries.length, records: v.latest.size, archives: v.archives, findings: v.findings }, null, 2));
    process.exit(v.ok ? 0 : 1);
  }
  if (!v.exists) {
    console.log(`No evidence chain yet (${INDEX_REL}). It starts with the first record the`);
    console.log(`lifecycle writes; everything already under lifecycle/ is adopted at that moment.`);
    if (v.archives.length) console.log(`Archived chains: ${v.archives.join(", ")}`);
    return;
  }
  const kinds = {};
  for (const e of v.entries) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
  console.log(`Evidence chain: ${v.entries.length} entr${v.entries.length === 1 ? "y" : "ies"} over ${v.latest.size} record(s)`);
  console.log(`  ${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  const head = v.entries[v.entries.length - 1];
  if (head) console.log(`  head: #${head.seq} ${head.kind} ${head.ref} at ${String(head.at).slice(0, 19)}  ${String(head.entry).slice(0, 12)}`);
  if (v.archives.length) console.log(`  archived chains: ${v.archives.length} (${v.archives[v.archives.length - 1]})`);
  const genesis = v.entries[0];
  if (genesis && genesis.kind === "reseal") console.log(`  resealed by ${genesis.meta?.by} on ${String(genesis.at).slice(0, 10)}: ${genesis.meta?.reason}`);
  console.log("");
  if (v.ok) { console.log(`OK: every record is the one that was written, in the order it was written.`); return; }
  console.log(formatChainFindings(v));
  console.log(`\nFAILED: ${v.findings.length} finding(s). \`approve\` and \`release-evidence sign\` refuse until`);
  console.log(`this is understood. If it is acceptable, a human reseals the chain by name:`);
  console.log(`  node .cursor/tools/lifecycle.mjs evidence reseal --by "<name>" --reason "..."`);
  process.exit(1);
}

async function cmdApprove(args) {
  const s = mustState();
  const phase = (args.find((a) => PHASES.includes(a.toUpperCase())) || "").toUpperCase();
  if (!phase) die(`approve needs a phase: approve DESIGN --by "name"`, 2);
  const by = valueOf(args, "--by");
  if (!by) die(`approve needs --by "name" — a gate with no named approver is a form, not a control.`, 2);
  const acceptChecks = args.reduce((acc, a, i) => (a === "--accept-check" ? [...acc, args[i + 1]] : acc), []);

  const { refusals, reapproval, override: ov, mechanical: mech, traceability: tr, checks, chain: ch } = await approveRefusals(s, phase, by, { acceptChecks });

  // Not a refusal an override can bypass. An override is a decision about ONE
  // phase's gate; a broken chain says the record of every decision is not what
  // was written, and a signature on top of that would be signing the unknown.
  if (ch && !ch.ok) {
    console.error(`REFUSED: the evidence chain (${INDEX_REL}) does not verify.\n`);
    console.error(formatChainFindings(ch));
    console.error(`\nNothing here can be overridden: every record under lifecycle/ is in question,`);
    console.error(`not this gate. Find out what changed. If it is acceptable, a human reseals:`);
    console.error(`  node .cursor/tools/lifecycle.mjs evidence reseal --by "<name>" --reason "..."`);
    process.exit(1);
  }

  if (refusals.length) {
    const ov = activeOverride(s, phase);
    if (!ov) {
      console.error(`REFUSED: ${phase} cannot be approved.\n`);
      for (const r of refusals) console.error(`  ${r}`);
      const missing = countMissing(s, phase, mech);
      console.error(missing
        ? `\nA gate needs three consents: mechanical, judgement, human. This has ${3 - missing}.`
        : `\nAll three consents exist — they just do not agree with each other. Every line`
          + `\nabove is a mismatch rather than an absence: the review and the signature are`
          + `\nabout different content. Re-run the gate against what is on disk now.`);
      console.error(`If this must proceed anyway, record an override — it expires and it is auditable:`);
      console.error(`  node .cursor/tools/lifecycle.mjs override ${phase} --reason "..." --risk HIGH --by "<name>" --expires 14`);
      process.exit(1);
    }
    console.error(`PROCEEDING UNDER OVERRIDE ${ov.id} (granted by ${ov.by}, expires ${ov.expiresAt.slice(0, 10)}).`);
    for (const r of refusals) console.error(`  bypassed: ${r}`);
  }

  // What the person signing should not have to go looking for. Not a refusal —
  // a phase can legitimately fail twice and then be fixed. But "it passed on
  // the third try" is a different fact from "it passed", and the signature
  // covers whichever one this is.
  const priors = (s.history || []).filter((h) => h.event === "gate" && String(h.detail || "").startsWith(phase + " "));
  const nogos = priors.filter((h) => String(h.detail).includes(" NO-GO"));
  if (nogos.length) {
    console.log(`Before you sign — ${phase} was judged NO-GO ${nogos.length} time(s) first:`);
    for (const n of nogos) console.log(`  ${n.at.slice(0, 10)}  ${n.detail}`);
    console.log(`  Something was fixed between then and now, or the question was asked`);
    console.log(`  differently. Your name goes on whichever it was.\n`);
  }

  const who = actor(ROOT);
  const w = actorWarning(by, who);
  if (w) console.error(w + "\n");

  const at = new Date().toISOString();
  const artifacts = {};
  for (const p of resolvedPaths(phase)) { const h = artifactHash(p); if (h) artifacts[p] = h; }

  s.phases[phase] = {
    ...(s.phases[phase] || {}),
    mechanical: {
      status: mech.ok ? "PASS" : "BYPASSED", at, artifacts,
      // What the consent was computed from, so "PASS" can be read back as a
      // list of facts rather than a word. Types say what each hash is a hash OF.
      types: Object.fromEntries(Object.keys(artifacts).map((p) => [p, typeOf(p)])),
      traceability: tr && !tr.broken ? { ids: tr.total, dangling: tr.dangling.length, unlinked: tr.unlinked.length } : tr ? { broken: tr.broken } : null,
      checks: checks.map(({ tool, args: a, ran, ok, skipped, exit, summary, accepted }) => ({ tool, args: a, ran, ok, skipped: !!skipped, exit, summary, accepted: !!accepted })),
    },
    human: { status: "APPROVED", by, at, note: valueOf(args, "--note") || "", recordedBy: who, acceptedChecks: checks.filter((c) => c.accepted).map((c) => c.tool) },
  };
  s.history.push({ at, event: "approve", detail: `${phase} by ${by}${refusals.length ? " (UNDER OVERRIDE)" : ""}${checks.some((c) => c.accepted) ? " (CHECK FAIL ACCEPTED)" : ""}` });
  writeState(s);

  console.log(`${phase} ${reapproval ? "re-approved" : "approved"} by ${by}.`);
  console.log(`${Object.keys(artifacts).length} artifact(s) hashed by content — editing any of them makes this phase STALE.`);
  for (const c of checks) {
    if (!c.ran) continue;
    console.log(`  ${c.skipped ? "----" : c.ok ? "PASS" : c.accepted ? "FAIL (accepted by name)" : "FAIL"}  ${c.tool} ${c.args.join(" ")}${c.summary ? `  - ${c.summary}` : ""}`);
  }
  if (phase === "DESIGN") console.log(`Design gate cleared — writes under src/** are now allowed.`);
  if (reapproval) {
    console.log(`The product stays in ${s.phase}; this refreshed an approval that had gone stale.`);
    console.log(`Next: node .cursor/tools/release-evidence.mjs cut --version <v>`);
  } else {
    const nxt = PHASES[PHASES.indexOf(phase) + 1];
    if (nxt) console.log(`Next: node .cursor/tools/lifecycle.mjs advance   (-> ${nxt})`);
  }
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

  const who = actor(ROOT);
  const w = actorWarning(by, who);
  if (w) console.error(w + "\n");

  const at = new Date().toISOString();
  const ov = {
    id: `OV-${sha(phase + at).slice(0, 6).toUpperCase()}`,
    phase, reason, risk, by, at,
    expiresAt: new Date(Date.now() + days * 86_400_000).toISOString(),
    bypassed: checkPhase(phase).artifacts.filter((a) => !a.ok).map((a) => a.artifact),
    recordedBy: who,
  };
  s.phases[phase] = { ...(s.phases[phase] || {}), override: ov };
  s.history.push({ at, event: "override", detail: `${ov.id} ${phase} risk=${risk} by ${by} until ${ov.expiresAt.slice(0, 10)}` });
  writeState(s);

  writeJsonAtomic(join(ROOT, "lifecycle", "overrides", `${ov.id}.json`), ov);
  chain(`lifecycle/overrides/${ov.id}.json`, "override", { id: ov.id, phase, risk, by });

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

/* ------------------------------------------------------------ the briefing */

/**
 * What an agent needs to know about this product in one screen.
 *
 * The obvious way to build this is a hand-written product.yaml listing the name,
 * the stack, the phase and the integrations. That would be a FOURTH copy of
 * facts that already have owners - state.json holds the phase,
 * technologyStack.md the stack, .mcp.json the integrations - and a copy is a
 * thing that goes wrong quietly. So nothing here is declared: every line is read
 * from whatever already owns it, and says where it came from.
 *
 * The part that genuinely had no home is the governance profile. "This product
 * touches money" is prose scattered through the PRD today, yet it decides
 * whether rule 07 is strict, whether /threat-model is mandatory at gate 3, and
 * whether /compliance-audit applies at all. Derived here from the documents the
 * phase 1 skills already write, and printed with what each flag turns on.
 */
const REGIMES = [
  ["SAMA", "Saudi Central Bank"],
  ["ZATCA", "e-invoicing"],
  ["mada", "domestic card scheme"],
  ["PCI-DSS", "card data"],
  ["GDPR", "EU personal data"],
  ["HIPAA", "health data"],
];

function readDoc(rel) {
  try {
    const body = readFileSync(join(ROOT, rel), "utf8");
    return body.trim().length >= 120 && !PLACEHOLDER.test(body) ? body : null;
  } catch { return null; }
}

export function governance() {
  const sources = ["docs/product/prd.md", "docs/product/nfr.md", "docs/product/brief.md",
                   "docs/product/story-map.md", "docs/analysis/business-rules.md"];
  const found = { money: [], pii: [], auth: [], regimes: new Map(), read: [] };

  for (const rel of sources) {
    const body = readDoc(rel);
    if (!body) continue;
    found.read.push(rel);
    // Match the words, not a column, so a flag survives being written in prose.
    for (const [key, re] of [
      ["money", /\b(money|premium|payment|invoice|refund|SAR|USD|EUR)\b|decimal\(\d+,\d+\)/i],
      ["pii", /\b(PII|personal data|national id|iqama|passport|phone number|email address)\b/i],
      ["auth", /\b(authn|authz|login|sign-?in|JWT|OAuth)\b/i],
    ]) if (re.test(body)) found[key].push(rel);
    for (const [name, what] of REGIMES) {
      if (new RegExp(`\\b${name.replace(/[-\s]/g, "[-\\s]?")}\\b`, "i").test(body)) found.regimes.set(name, what);
    }
  }
  return found;
}

async function cmdProduct(args) {
  const s = mustState();
  const d = deriveAll(s);
  const g = governance();

  let servers = [];
  try { servers = Object.keys(JSON.parse(readFileSync(join(ROOT, ".mcp.json"), "utf8")).mcpServers || {}); } catch { /* none */ }

  let ids = null;
  try {
    const as = await import(new URL("./artifact-schema.mjs", import.meta.url).href);
    const graph = as.buildGraph();
    if (graph.byId.size) ids = graph.byId.size;
  } catch { /* id convention not adopted */ }

  let crs = [];
  try {
    crs = readdirSync(join(ROOT, "lifecycle", "changes")).filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(ROOT, "lifecycle", "changes", f), "utf8")))
      .filter((c) => c.status === "OPEN");
  } catch { /* none */ }

  const overrides = Object.entries(s.phases || {})
    .filter(([, v]) => v.override && Date.parse(v.override.expiresAt) > Date.now())
    .map(([p, v]) => ({ phase: p, ...v.override }));

  if (args.includes("--json")) {
    return console.log(JSON.stringify({
      product: s.product, mode: s.mode, phase: s.phase, derived: d,
      governance: { money: g.money.length > 0, pii: g.pii.length > 0, auth: g.auth.length > 0,
                    regimes: [...g.regimes.keys()], sources: g.read },
      integrations: servers, ids, openChangeRequests: crs.map((c) => c.id),
      activeOverrides: overrides.map((o) => o.id),
    }, null, 2));
  }

  const MARK = { APPROVED: "x", INHERITED: "i", IN_PROGRESS: "~", STALE: "!", BLOCKED: "-", NOT_STARTED: " " };
  console.log(`Product briefing - ${s.product}\n`);
  console.log(`  Mode         ${s.mode}`);
  console.log(`  Phase        ${s.phase} (${d[s.phase]?.status})`);
  console.log(`  Gates        ${PHASES.map((p) => `[${MARK[d[p].status] || "?"}] ${p.slice(0, 4)}`).join("  ")}`);
  if (ids) console.log(`  Traced       ${ids} ids across the lifecycle documents`);

  console.log(`\n  Governance   derived, not declared - every flag below was read from a document`);
  const line = (label, on, effect) =>
    console.log(`    ${label.padEnd(11)}${(on ? "YES" : "no").padEnd(6)}${on ? effect : ""}`);
  line("money", g.money.length > 0, "rule 07 strict, decimal enforced, audit trail required");
  line("PII", g.pii.length > 0, "/threat-model mandatory at gate 3, data classification required");
  line("auth", g.auth.length > 0, "authn/authz must be designed, not named");
  if (g.regimes.size) {
    console.log(`    regulated  YES   /compliance-audit applies`);
    for (const [n, w] of g.regimes) console.log(`                     ${n} - ${w}`);
  } else {
    console.log(`    regulated  no`);
  }
  console.log(g.read.length
    ? `    sources:   ${g.read.join(", ")}`
    : `    (no phase 1 document is readable yet - flags cannot be derived)`);

  console.log(`\n  Stack        memory-bank/technologyStack.md ${readDoc("memory-bank/technologyStack.md") ? "(populated)" : "- STILL A TEMPLATE, run /context-sync"}`);
  console.log(`  Integrations ${servers.join(", ") || "none declared in .mcp.json"}`);

  console.log(`\n  Phase owners`);
  const OWNERS = [["REQUIREMENTS", "product-manager"], ["ANALYSIS", "business-analyst"],
                  ["DESIGN", "solution-architect, ux-bridge"], ["DEVELOPMENT", "main thread"],
                  ["TESTING", "test-engineer"], ["PRODUCTION", "ops-reviewer"]];
  for (const [p, o] of OWNERS) console.log(`    ${p.padEnd(14)}${o}${p === s.phase ? "   <- here" : ""}`);

  if (crs.length) {
    console.log(`\n  Open change requests`);
    for (const c of crs) console.log(`    ${c.id}  risk ${c.risk}  ${c.reason.slice(0, 58)}`);
  }
  if (overrides.length) {
    console.log(`\n  ACTIVE OVERRIDES - a gate is being bypassed`);
    for (const o of overrides) console.log(`    ${o.id}  ${o.phase}  risk ${o.risk}  by ${o.by}  expires ${o.expiresAt.slice(0, 10)}`);
  }
}

function cmdGate(args) {
  const s = readState();
  const phase = (args.find((a) => PHASES.includes(a.toUpperCase())) || s?.phase || "").toUpperCase();
  if (!phase) die("gate needs a phase.", 2);
  const meta = gateMeta(phase);
  const g = gatePath(phase);
  if (args.includes("--json")) return console.log(JSON.stringify({ phase, file: gateFile(phase), source: g.source, ...meta, version: gateVersion(phase) }, null, 2));
  console.log(gateLabel(phase));
  if (g.source === "shipped with the plugin")
    console.log(`  (read from the plugin's own copy — no ${rel(join(GATES(), gateFile(phase)))} in this project.\n   Copy it there to tighten a criterion; the project's copy wins.)`);
  if (meta.authors.length) console.log(`Authored by:  ${meta.authors.join(", ")}`);
  console.log(meta.reviewer
    ? `Reviewed by:  ${meta.reviewer}   <- launch this one fresh; it may not be an author`
    : `Reviewed by:  (not declared — independence is unverified)`);
}

/* ------------------------------------------------------------------- helpers */

const rel = (p) => p.slice(ROOT.length + 1).split("\\").join("/");
/** A gate's path as a human should see it, saying so when it is the shipped copy. */
const gateLabel = (phase) => {
  const g = gatePath(phase);
  return g.source === "project" || !g.source
    ? rel(join(GATES(), gateFile(phase)))
    : `${gateFile(phase)} (shipped with the plugin)`;
};
const valueOf = (args, flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
function die(msg, code) { console.error(msg); process.exit(code); }
function mustState() {
  const info = readStateInfo();
  if (info.status === "corrupt") {
    die(`lifecycle/state.json exists but cannot be read: ${info.error}\n` +
        `This is a product's lifecycle history, not a missing file - do not run 'init' over it.\n` +
        `Restore it from git (git log -- lifecycle/state.json) or repair the JSON by hand with the user.`, 1);
  }
  if (!info.state) die(`No lifecycle/state.json. Run: node .cursor/tools/lifecycle.mjs init --name "<product>"\n(or --existing on a codebase that already exists)`, 1);
  return info.state;
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
  case "approve": await cmdApprove(args); break;
  case "override": cmdOverride(args); break;
  case "advance": cmdAdvance(); break;
  case "rollback": cmdRollback(args); break;
  case "product": await cmdProduct(args); break;
  case "gate": cmdGate(args); break;
  case "evidence": cmdEvidence(args); break;
  default:
    console.error(`lifecycle.mjs — product lifecycle state machine

  init [--name "X"]                     create lifecycle/state.json, greenfield
  init --existing --by "<name>" [--review-by "<name>"]
                                        brownfield: phases 1-3 inherited, by whom, checked by whom
  status [--json]                       where are we, and are the approvals still true
  check [PHASE] [--json]                consent 1: do the artifacts exist, and are they the right kind
  record-gate PHASE --verdict GO|NO-GO --by "<reviewer>" [--criteria] [--note]
                                        consent 2: the /lifecycle-gate verdict
  approve PHASE --by "name" [--note] [--accept-check <tool.mjs>]
                                        consent 3: the human. Refuses without 1 and 2.
  override PHASE --reason --risk --by --expires <days>
                                        auditable, expiring bypass
  advance                               move to the next phase
  rollback PHASE --reason "..."         reopen a phase, reset every later one
  gate [PHASE] [--json]                 the gate definition, and who may judge it
  evidence [--json]                     walk lifecycle/index.jsonl: is every record the one
                                        that was written, in the order it was written
  evidence reseal --by "<name>" --reason "..."
                                        human-only: archive a broken chain, start a new one

Phases: ${PHASES.join(" -> ")}
Statuses: NOT_STARTED IN_PROGRESS APPROVED INHERITED INHERITED_UNVERIFIED STALE BLOCKED`);
    process.exit(2);
}
}
