#!/usr/bin/env node
// PreToolUse: Write | Edit | MultiEdit | NotebookEdit
// Turns the design gate from prose into a block.
//
// The most expensive failure mode of an agent platform is not bad code — it is
// code written before anyone decided what the product was. `01-specify-rules`
// already says implementation may not start without a spec; that is advisory
// text the model is asked to honour. This is the same claim with an exit code.
//
// Deliberately narrow. It asks exactly one question: is the DESIGN phase
// cleared? Everything else — which phase, which artifacts, whether they are any
// good — belongs to lifecycle.mjs and /lifecycle-gate, which have room to
// explain themselves.
//
// "Cleared" is COMPUTED, not read. Since v2 the state file stores evidence
// (mechanical hashes, the /lifecycle-gate verdict, the human approval) and
// lifecycle.mjs derives the status from it. So editing an approved design
// document re-blocks source writes on the very next tool call, with no sweeper
// and nothing to invalidate — which is the entire point of hashing the
// artifacts at approval time.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { readPayload, projectDir, relPath, targetPath, block, ok } from "./_lib.mjs";

const p = await readPayload();
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

// What counts as production source. Tests, specs, docs and platform config are
// all fine before design — writing a test or a spec early is good practice, and
// blocking `.cursor/` would make the platform unable to configure itself.
const lower = file.toLowerCase();
const SOURCE_ROOT = /^(src|backend|frontend|client|server|app|api|web)\//;
const SOURCE_EXT = /\.(cs|csproj|sln|fs|vb|tsx?|jsx?|vue|svelte|razor|cshtml|sql)$/;
const EXEMPT = /^(tests?|e2e|specs|docs|memory-bank|lifecycle|templates|scripts|\.cursor|\.claude|\.github)\//;
if (!(SOURCE_ROOT.test(lower) && SOURCE_EXT.test(lower) && !EXEMPT.test(lower))) ok();

// The status logic lives in lifecycle.mjs and is imported rather than copied —
// two implementations of "is this still approved?" would eventually disagree,
// and the one in the hook is the one nobody would think to update.
//
// The relative path differs between the two layouts this file ships in:
//   repo    .claude/hooks/  ->  ../../.cursor/tools/lifecycle.mjs
//   plugin  plugin/hooks/   ->  ../tools/lifecycle.mjs
// so both are tried. build-plugin.mjs copies tools/ and hooks/ side by side.
let lc = null;
for (const rel of ["../../.cursor/tools/lifecycle.mjs", "../tools/lifecycle.mjs"]) {
  try { lc = await import(new URL(rel, import.meta.url).href); break; } catch { /* try the other layout */ }
}

let cleared, phase = "UNKNOWN", product = "unnamed", detail = "";
if (lc) {
  // The tool resolves its own root from CLAUDE_PROJECT_DIR, which Cursor does
  // not set. Hand it the root our host actually gave us, or it reads a
  // different repo's state file, finds none, and opens the gate silently.
  lc.setRoot(root);
  const state = lc.readState();
  if (!state) ok();
  phase = state.phase || "UNKNOWN";
  product = state.product || "unnamed";
  const d = lc.derivePhase(state, "DESIGN");
  cleared = lc.CLEARED.has(d.status);
  detail = `${d.status}${d.reasons.length ? " — " + d.reasons[0] : ""}`;
} else {
  // Degraded: the state machine could not be loaded, so staleness cannot be
  // computed. Honour a recorded human approval rather than blocking every write
  // on an infrastructure problem, and say so.
  process.stderr.write("guard-phase: could not load lifecycle.mjs; staleness not checked.\n");
  try {
    const { readFileSync } = await import("node:fs");
    const s = JSON.parse(readFileSync(join(root, "lifecycle", "state.json"), "utf8"));
    const dp = s.phases?.DESIGN || {};
    cleared = dp.inherited === true || dp.human?.status === "APPROVED" || dp.status === "APPROVED" || dp.status === "INHERITED";
    phase = s.phase || "UNKNOWN";
    product = s.product || "unnamed";
    detail = "unverified (degraded mode)";
  } catch { ok(); }
}

if (cleared) ok();

block(`BLOCKED: ${file} is production source and the DESIGN gate is not cleared.

  Product:      ${product}
  Phase now:    ${phase}
  DESIGN gate:  ${detail}

Nothing under src/, backend/ or frontend/ may be written until the design gate
holds. This is .cursor/rules/11-lifecycle-gate.mdc, enforced.

A gate needs three consents, and 'approve' refuses without all three:
  node .cursor/tools/lifecycle.mjs check DESIGN                    # 1 artifacts exist
  /lifecycle-gate DESIGN                                           # 2 they are any good
  node .cursor/tools/lifecycle.mjs record-gate DESIGN --verdict GO --by "lifecycle-gate"
  node .cursor/tools/lifecycle.mjs approve DESIGN --by "<name>"    # 3 a human

If the gate says STALE, an approved design document changed after it was
approved. Re-review it — do not re-approve without looking.

Tests, specs, docs and memory-bank are NOT blocked — write those now if it helps.

If this is a deliberate spike, set LIFECYCLE_OVERRIDE=1 for the command and say
so to the user. Do not route around this block with a different tool.`);
