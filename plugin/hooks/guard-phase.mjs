#!/usr/bin/env node
// Claude Code: PreToolUse (Write/Edit)   |   Cursor: preToolUse
//
// Enforces the lifecycle's write policy: which artifacts may be written in which
// phase.
//
// The first version of this hook asked one question - is the DESIGN gate
// cleared? - and gated `src/` on the answer. That was the expensive case, and it
// left everything else open: nothing stopped an agent writing production
// Terraform during REQUIREMENTS, or a Kubernetes manifest before a single test
// existed. Both are artifacts that outrun the decisions they depend on, which is
// what this layer exists to prevent.
//
// So the question is now general and the answer is data, in
// .cursor/lifecycle/write-policy.json. `earliest: X` means the phase BEFORE X
// must be cleared, which makes the original rule a special case rather than a
// thing that got replaced: source still needs DESIGN cleared, and still goes
// back to blocked the moment an approved design document changes.
//
// Deliberately narrow. Tests, specs, docs and memory-bank are never blocked -
// writing a test or a spec early is good practice, not a violation.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readPayload, projectDir, relPath, targetPath, isReadTool, block, ok, fileUrlPath } from "./_lib.mjs";

const p = await readPayload();
if (isReadTool(p)) ok();
const file = relPath(targetPath(p));
if (!file) ok();

// A repo that has not adopted the lifecycle is not in violation of it. Absent
// state means absent opinion — never break a workspace that never opted in.
const root = projectDir();
if (!existsSync(join(root, "lifecycle", "state.json"))) ok();

// Documented escape, mirroring CLAUDE_ALLOW_TIER2_EDIT in guard-write.mjs.
// A spike, a prototype, a hotfix at 3am — all legitimate. What is not legitimate
// is doing it silently, so the variable has to be set on purpose.
if (process.env.LIFECYCLE_OVERRIDE) ok();

/* ------------------------------------------------------------------- policy */

// The project's own policy wins; the copy shipped beside this hook is the
// fallback for a plugin install. Without the second, a plugin wires a guard that
// then finds no policy and governs nothing — a silent no-op this repo has been
// bitten by more than once.
const POLICY_PATHS = [
  join(root, ".cursor", "lifecycle", "write-policy.json"),
  fileUrlPath(new URL("../lifecycle/write-policy.json", import.meta.url)),
];

/**
 * Shared evaluator lives in `_policy.mjs`. The relative path differs between
 * layouts, same as lifecycle.mjs below. A missing module must not open the
 * gate — keep the original built-in as last resort.
 */
let policyMod = null;
for (const rel of ["../../.cursor/tools/_policy.mjs", "../tools/_policy.mjs"]) {
  try { policyMod = await import(new URL(rel, import.meta.url).href); break; } catch { /* other layout */ }
}
const BUILTIN = policyMod?.BUILTIN_WRITE_POLICY || {
  version: 0,
  alwaysAllow: ["docs/**", "specs/**", "memory-bank/**", "lifecycle/**", "templates/**",
                "scripts/**", "tests/**", "test/**", "e2e/**", ".cursor/**", ".claude/**", ".github/**", "*.md"],
  rules: [{
    id: "application-source",
    match: ["src/**", "backend/**", "frontend/**", "client/**", "server/**", "app/**", "apps/**", "api/**", "web/**", "lib/**", "packages/**", "services/**"],
    extensions: [".cs", ".csproj", ".sln", ".fs", ".vb", ".ts", ".tsx", ".js", ".jsx", ".vue", ".svelte", ".razor", ".cshtml", ".sql"],
    earliest: "DEVELOPMENT",
    why: "Code written before the design gate implements a design nobody approved.",
  }],
};

let policy = BUILTIN, policySource = "built-in fallback";
for (const c of POLICY_PATHS) {
  try {
    if (!existsSync(c)) continue;
    policy = JSON.parse(readFileSync(c, "utf8"));
    policySource = relPath(c) || c;
    break;
  } catch { /* malformed policy: keep the built-in rather than opening the gate */ }
}

/* -------------------------------------------------------------------- match */

/** Minimal glob: `**` spans separators, `*` does not, `?` is one character. */
function glob(pattern, s) {
  if (policyMod?.policyGlob) return policyMod.policyGlob(pattern, s);
  const rx = pattern
    .split(/(\*\*\/|\*\*|\*|\?)/)
    .map((part) => {
      if (part === "**/") return "(?:.*/)?";
      if (part === "**") return ".*";
      if (part === "*") return "[^/]*";
      if (part === "?") return "[^/]";
      return part.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return new RegExp(`^${rx}$`, "i").test(s);
}
const anyGlob = (patterns, s) => (patterns || []).some((g) => glob(g, s));

if (anyGlob(policy.alwaysAllow, file)) ok();

const rule = (policy.rules || []).find((r) =>
  anyGlob(r.match, file) &&
  (!r.extensions?.length || r.extensions.some((e) => file.toLowerCase().endsWith(e.toLowerCase()))));
if (!rule) ok();

/* ------------------------------------------------------------------ verdict */

// The status logic lives in lifecycle.mjs and is imported rather than copied —
// two implementations of "is this still approved?" would eventually disagree,
// and the one in the hook is the one nobody would think to update.
//
// The relative path differs between the two layouts this file ships in:
//   repo    .claude/hooks/  ->  ../../.cursor/tools/lifecycle.mjs
//   plugin  plugin/hooks/   ->  ../tools/lifecycle.mjs
let lc = null;
for (const rel of ["../../.cursor/tools/lifecycle.mjs", "../tools/lifecycle.mjs"]) {
  try { lc = await import(new URL(rel, import.meta.url).href); break; } catch { /* other layout */ }
}

let phase = "UNKNOWN", product = "unnamed", detail = "", required = null, cleared;

/**
 * A state file that exists and cannot be read is not "no lifecycle". It is a
 * lifecycle whose phase nobody can see, and the write being asked for is one
 * the policy says depends on that phase. Corrupt state used to open the gate;
 * now it closes it, and says which file.
 */
function corruptState(why) {
  block(`BLOCKED: ${file} is gated by the lifecycle phase, and lifecycle/state.json cannot be read.

  ${why}

Run \`node .cursor/tools/lifecycle.mjs status\` to see the error. Fix the file
through the tool; do not delete or rewrite it to clear this - a phase-gated
write with an unreadable phase is refused on purpose.`);
}

if (lc) {
  lc.setRoot(root);
  const info = lc.readStateInfo ? lc.readStateInfo() : null;
  const state = info ? info.state : lc.readState();
  if (!state) corruptState(info?.error ? `${info.status}: ${info.error}` : "state.json exists but did not parse as the lifecycle state");
  phase = state.phase || "UNKNOWN";
  product = state.product || "unnamed";

  const i = lc.PHASES.indexOf(rule.earliest);
  required = i > 0 ? lc.PHASES[i - 1] : null;
  if (!required) ok();                       // earliest is the first phase: no prerequisite

  const d = lc.derivePhase(state, required);
  cleared = lc.CLEARED.has(d.status);
  detail = `${d.status}${d.reasons.length ? " — " + d.reasons[0] : ""}`;
} else {
  // Degraded: the state machine could not be loaded, so staleness cannot be
  // computed. Honour a recorded human approval rather than blocking every write
  // on an infrastructure problem, and say so.
  process.stderr.write("guard-phase: could not load lifecycle.mjs; staleness not checked.\n");
  try {
    const ORDER = ["REQUIREMENTS", "ANALYSIS", "DESIGN", "DEVELOPMENT", "TESTING", "PRODUCTION"];
    const s = JSON.parse(readFileSync(join(root, "lifecycle", "state.json"), "utf8"));
    const i = ORDER.indexOf(rule.earliest);
    required = i > 0 ? ORDER[i - 1] : null;
    if (!required) ok();
    const ph = s.phases?.[required] || {};
    cleared = ph.inherited === true || ph.human?.status === "APPROVED";
    phase = s.phase || "UNKNOWN";
    product = s.product || "unnamed";
    detail = "unverified (degraded mode)";
  } catch (e) { corruptState(`degraded mode, and the file did not parse: ${e.message}`); }
}

if (cleared) ok();

block(`BLOCKED: ${file} may not be written yet.

  Product:      ${product}
  Phase now:    ${phase}
  Rule:         ${rule.id} — earliest phase ${rule.earliest}
  Waiting on:   ${required} is ${detail}
  Policy:       ${policySource}

${rule.why}

A gate needs three consents, and 'approve' refuses without all three:
  node .cursor/tools/lifecycle.mjs check ${required}
  /lifecycle-gate ${required}
  node .cursor/tools/lifecycle.mjs record-gate ${required} --verdict GO --by "lifecycle-gate"
  node .cursor/tools/lifecycle.mjs approve ${required} --by "<name>"

If ${required} says STALE, an approved document changed after it was approved.
Re-review it — do not re-approve without looking.

Tests, specs, docs and memory-bank are never blocked. Write those now if it helps.

If this is a deliberate spike, set LIFECYCLE_OVERRIDE=1 for the command and say
so to the user. Do not route around this block with a different tool.`);
