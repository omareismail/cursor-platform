#!/usr/bin/env node
/**
 * state.test.mjs — what the gates do when lifecycle/state.json is not what they expect.
 *
 * The previous behaviour treated a state file that would not parse exactly like
 * a state file that never existed: guard-phase allowed the write, guard-mcp
 * skipped the phase rule, and `lifecycle.mjs status` said "No lifecycle/state.json,
 * run init" over a product's whole history. A corrupt file is not an absent one.
 */

import { join } from "node:path";
import { fixture, runHook, runTool, write, check, denies, allows, report, section, REPO } from "../_harness.mjs";

const V2 = (phase, phases = {}) => ({ schemaVersion: 2, product: "fixture", mode: "new", phase, phases, updated: "2026-01-01T00:00:00Z" });

section("guard-phase.mjs — corrupt state closes the gate");
{
  const corrupt = fixture("st-corrupt", { state: "{ this is not json" });
  denies("phase-gated source write is refused on unparseable state", runHook("guard-phase.mjs", write(join(corrupt, "src/Payments/Handler.cs")), corrupt), "cannot be read");
  allows("a document is still not gated", runHook("guard-phase.mjs", write(join(corrupt, "docs/x.md")), corrupt));

  const array = fixture("st-array", { state: "[1,2,3]" });
  denies("a JSON array is not a state", runHook("guard-phase.mjs", write(join(array, "src/A.cs")), array), "cannot be read");

  const badPhase = fixture("st-badphase", { state: V2("SHIPPED") });
  denies("an unknown phase name is corrupt, not permissive", runHook("guard-phase.mjs", write(join(badPhase, "src/A.cs")), badPhase), "cannot be read");

  const degraded = fixture("st-degraded", { state: "{ nope", withTools: false });
  denies("degraded mode (no lifecycle.mjs) also refuses on corrupt state", runHook("guard-phase.mjs", write(join(degraded, "src/A.cs")), degraded), "cannot be read");

  const missing = fixture("st-missing");
  allows("no state file: never adopted, never gated", runHook("guard-phase.mjs", write(join(missing, "src/A.cs")), missing));
}

section("guard-phase.mjs — a real state still derives correctly");
{
  const early = fixture("st-early", { state: V2("ANALYSIS") });
  denies("source before DESIGN is refused", runHook("guard-phase.mjs", write(join(early, "src/A.cs")), early), "may not be written yet");

  const inherited = fixture("st-inherited", { state: V2("DEVELOPMENT", { REQUIREMENTS: { inherited: true }, ANALYSIS: { inherited: true }, DESIGN: { inherited: true } }) });
  allows("INHERITED design clears source", runHook("guard-phase.mjs", write(join(inherited, "src/A.cs")), inherited));

  const degradedOk = fixture("st-degraded-ok", { withTools: false, state: V2("DEVELOPMENT", { DESIGN: { inherited: true } }) });
  allows("degraded mode honours an inherited design", runHook("guard-phase.mjs", write(join(degradedOk, "src/A.cs")), degradedOk));
}

section("lifecycle.mjs — status names the corruption instead of suggesting init");
{
  const corrupt = fixture("st-tool-corrupt", { state: "{ this is not json" });
  const r = runTool("lifecycle.mjs", ["status"], corrupt);
  check("status exits non-zero on corrupt state", r.exit !== 0, `exit ${r.exit}`);
  check("...and says the file cannot be read", /cannot be read/i.test(r.err + r.out), `output: ${(r.err + r.out).slice(0, 200)}`);
  check("...and does not tell the agent to run init over it", !/Run: node .*init/i.test(r.err + r.out), `output: ${(r.err + r.out).slice(0, 200)}`);

  const missing = fixture("st-tool-missing");
  const m = runTool("lifecycle.mjs", ["status"], missing);
  check("status on a missing file still points at init", /init/.test(m.err + m.out), `output: ${(m.err + m.out).slice(0, 200)}`);
}

section("lifecycle.mjs — readStateInfo");
{
  const lc = await import(new URL(`file:///${join(REPO, ".cursor", "tools", "lifecycle.mjs").replace(/\\/g, "/")}`));
  const root = fixture("st-info", { state: V2("DESIGN") });
  lc.setRoot(root);
  check("ok on a good file", lc.readStateInfo().status === "ok", JSON.stringify(lc.readStateInfo()));
  check("readState still returns the state", lc.readState()?.phase === "DESIGN", "");
  lc.setRoot(fixture("st-info-missing"));
  check("missing on no file", lc.readStateInfo().status === "missing" && lc.readState() === null, "");
  lc.setRoot(fixture("st-info-corrupt", { state: "nope" }));
  const c = lc.readStateInfo();
  check("corrupt on bad JSON, with the error", c.status === "corrupt" && /JSON/.test(c.error) && lc.readState() === null, JSON.stringify(c));
  lc.setRoot(fixture("st-info-phases", { state: JSON.stringify({ schemaVersion: 2, phase: "DESIGN", phases: "yes" }) }));
  check("corrupt when phases is not an object", lc.readStateInfo().status === "corrupt", "");
}

report("Corrupt state closes the gates it used to open, and the tool says what is wrong.");
