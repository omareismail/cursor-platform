#!/usr/bin/env node
/**
 * hash.test.mjs — what an approval is actually bound to.
 *
 * v2 hashed a directory by its entry NAMES. Every file under src/ and tests/
 * could be replaced while DEVELOPMENT and TESTING stayed APPROVED, because the
 * names held. And "the artifact exists" was the whole mechanical check, so
 * docs/design/adr/.gitkeep was an ADR set and a tests/ full of fixtures was a
 * test suite. Each case below is one of those, now refused.
 */

import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { fixture, runTool, put, gitInit, DOC, check, report, section, REPO } from "../_harness.mjs";

const lc = await import(new URL(`file:///${join(REPO, ".cursor", "tools", "lifecycle.mjs").replace(/\\/g, "/")}`));
const statusOf = (root, phase) => JSON.parse(runTool("lifecycle.mjs", ["status", "--json"], root).out).derived[phase];
const checkOf = (root, phase) => JSON.parse(runTool("lifecycle.mjs", ["check", phase, "--json"], root).out);
const row = (res, artifact) => res.artifacts.find((a) => a.artifact === artifact);

/** A phase hand-approved with the hashes lifecycle.mjs itself computes right now. */
function approvedState(root, phase, paths, { like = null } = {}) {
  lc.setRoot(root);
  const artifacts = {};
  for (const p of paths) artifacts[p] = lc.artifactHash(p, like);
  const phases = {};
  for (const p of lc.PHASES) phases[p] = {};
  const idx = lc.PHASES.indexOf(phase);
  for (const p of lc.PHASES.slice(0, idx)) phases[p] = { inherited: { basis: "test", by: "a", reviewBy: "b" } };
  phases[phase] = {
    mechanical: { status: "PASS", at: "2026-01-01T00:00:00Z", artifacts },
    judgement: { verdict: "GO", by: "reviewer", at: "2026-01-01T00:00:00Z" },
    human: { status: "APPROVED", by: "sara", at: "2026-01-01T00:00:00Z" },
  };
  return { schemaVersion: 3, revision: 0, product: "fx", mode: "greenfield", phase, updated: "2026-01-01T00:00:00Z", phases, history: [] };
}

section("artifactHash — content, not names");
{
  const root = fixture("h-content");
  put(root, "src/A.cs", "class A {}\n");
  put(root, "src/B.cs", "class B {}\n");
  lc.setRoot(root);
  const h1 = lc.artifactHash("src");
  check("directory hash carries the dir2 prefix", h1.startsWith("dir2:"), h1);
  writeFileSync(join(root, "src", "A.cs"), "class A { int x; }\n");
  const h2 = lc.artifactHash("src");
  check("changing one file's CONTENT changes the directory hash", h1 !== h2, `${h1} vs ${h2}`);
  put(root, "src/Sub/C.cs", "class C {}\n");
  const h3 = lc.artifactHash("src");
  check("adding a file in a SUBDIRECTORY changes it (recursive)", h2 !== h3, `${h2} vs ${h3}`);
  put(root, "src/bin/Debug/A.dll", "binary");
  check("build output under bin/ is not part of the artifact", lc.artifactHash("src") === h3, "bin/ changed the hash");
  put(root, "src/.DS_Store", "junk");
  check("dotfiles are not part of the artifact", lc.artifactHash("src") === h3, ".DS_Store changed the hash");

  // The old algorithm, on request only, so recorded v2 hashes still compare.
  const old = lc.artifactHash("src", "dir:whatever");
  check("a recorded dir: hash is compared with the v2 algorithm", old.startsWith("dir:"), old);
  writeFileSync(join(root, "src", "A.cs"), "class A { int y; }\n");
  check("...which is blind to content, as it always was", lc.artifactHash("src", "dir:whatever") === old, "v2 algorithm saw a content change");
  check("...while the new one is not", lc.artifactHash("src") !== h3, "dir2 missed a content change");

  put(root, "src/generated.tmp", "x");
  put(root, ".gitignore", "*.tmp\n");
  gitInit(root);
  const g1 = lc.artifactHash("src");
  writeFileSync(join(root, "src", "generated.tmp"), "y");
  check("a git-ignored file does not move the hash", lc.artifactHash("src") === g1, "ignored file changed the hash");
}

section("derivePhase — an approved directory goes STALE when its contents change");
{
  const root = fixture("h-stale");
  put(root, "src/A.cs", "class A {}\n");
  put(root, "specs/features/pay.md", DOC("Payments spec"));
  put(root, "memory-bank/progress.md", DOC("Progress") + "\n| T-1 | Done |\n");
  const st = approvedState(root, "DEVELOPMENT", ["src", "specs/features", "memory-bank/progress.md"]);
  put(root, "lifecycle/state.json", JSON.stringify(st));
  check("approved with matching content hashes reads APPROVED", statusOf(root, "DEVELOPMENT").status === "APPROVED", JSON.stringify(statusOf(root, "DEVELOPMENT")));
  writeFileSync(join(root, "src", "A.cs"), "class A { /* rewritten */ }\n");
  const d = statusOf(root, "DEVELOPMENT");
  check("rewriting a source file makes DEVELOPMENT STALE", d.status === "STALE" && /src changed/.test(d.reasons.join()), JSON.stringify(d));
}

section("derivePhase — a v2 approval keeps its v2 semantics until re-approved");
{
  const root = fixture("h-v2");
  put(root, "src/A.cs", "class A {}\n");
  put(root, "specs/features/pay.md", DOC("Payments spec"));
  put(root, "memory-bank/progress.md", DOC("Progress"));
  const st = approvedState(root, "DEVELOPMENT", ["src", "specs/features", "memory-bank/progress.md"], { like: "dir:" });
  st.schemaVersion = 2; delete st.revision;
  put(root, "lifecycle/state.json", JSON.stringify(st));
  check("v2 file with dir: hashes reads APPROVED after the upgrade", statusOf(root, "DEVELOPMENT").status === "APPROVED", JSON.stringify(statusOf(root, "DEVELOPMENT")));
  writeFileSync(join(root, "src", "A.cs"), "class A { int x; }\n");
  check("...and stays APPROVED on a content change, as v2 would have (the upgrade itself flips nothing)", statusOf(root, "DEVELOPMENT").status === "APPROVED", JSON.stringify(statusOf(root, "DEVELOPMENT")));
  put(root, "src/New.cs", "class New {}\n");
  check("...but a new entry name still stales it, as v2 did", statusOf(root, "DEVELOPMENT").status === "STALE", JSON.stringify(statusOf(root, "DEVELOPMENT")));
}

section("resolvedPaths — every present alternative is hashed, not the first");
{
  const root = fixture("h-anyof");
  put(root, "backend/Api.cs", "class Api {}\n");
  put(root, "frontend/App.tsx", "export const App = () => null;\n");
  put(root, "specs/features/pay.md", DOC("Payments spec"));
  put(root, "memory-bank/progress.md", DOC("Progress"));
  const st = approvedState(root, "DEVELOPMENT", ["backend", "frontend", "specs/features", "memory-bank/progress.md"]);
  put(root, "lifecycle/state.json", JSON.stringify(st));
  check("both source roots pass the check", checkOf(root, "DEVELOPMENT").artifacts[0].resolved.length === 2, JSON.stringify(checkOf(root, "DEVELOPMENT").artifacts[0]));
  writeFileSync(join(root, "frontend", "App.tsx"), "export const App = () => <div/>;\n");
  const d = statusOf(root, "DEVELOPMENT");
  check("rewriting the SECOND root (frontend/) stales the phase", d.status === "STALE" && /frontend/.test(d.reasons.join()), JSON.stringify(d));
}

section("derivePhase — a newly added anyOf alternative stales an existing approval");
{
  const root = fixture("h-newroot");
  put(root, "src/A.cs", "class A {}\n");
  put(root, "specs/features/pay.md", DOC("Payments spec"));
  put(root, "memory-bank/progress.md", DOC("Progress") + "\n| T-1 | Done |\n");
  const st = approvedState(root, "DEVELOPMENT", ["src", "specs/features", "memory-bank/progress.md"]);
  put(root, "lifecycle/state.json", JSON.stringify(st));
  check("approved against src/ only reads APPROVED", statusOf(root, "DEVELOPMENT").status === "APPROVED", JSON.stringify(statusOf(root, "DEVELOPMENT")));
  put(root, "frontend/NewClient.ts", "export const App = () => null;\n");
  const d = statusOf(root, "DEVELOPMENT");
  check("adding frontend/ after approval makes DEVELOPMENT STALE", d.status === "STALE" && /frontend/.test(d.reasons.join()), JSON.stringify(d));

  const tRoot = fixture("h-newe2e");
  put(tRoot, "docs/testing/strategy.md", DOC("Test strategy"));
  put(tRoot, "tests/Pay.test.mjs", "it('x', () => { expect(1).toBe(1); });\n");
  const tst = approvedState(tRoot, "TESTING", ["docs/testing/strategy.md", "tests"]);
  put(tRoot, "lifecycle/state.json", JSON.stringify(tst));
  check("TESTING approved against tests/ reads APPROVED", statusOf(tRoot, "TESTING").status === "APPROVED", JSON.stringify(statusOf(tRoot, "TESTING")));
  put(tRoot, "e2e/app.spec.ts", "it('loads', () => { expect(1).toBe(1); });\n");
  const td = statusOf(tRoot, "TESTING");
  check("adding e2e/ after approval makes TESTING STALE", td.status === "STALE" && /e2e/.test(td.reasons.join()), JSON.stringify(td));
}

section("typed artifacts — existing is not the same as being one");
{
  const root = fixture("h-typed", { state: { schemaVersion: 3, revision: 0, product: "fx", mode: "greenfield", phase: "DESIGN", phases: {}, history: [] } });
  put(root, "docs/design/adr/.gitkeep", "");
  let r = row(checkOf(root, "DESIGN"), "docs/design/adr");
  check("adr-set: a directory holding only .gitkeep FAILS", !r.ok && /no ADR/.test(r.reason), JSON.stringify(r));
  put(root, "docs/design/adr/0001-db.md", "# ADR 1\n\nTODO\n");
  r = row(checkOf(root, "DESIGN"), "docs/design/adr");
  check("adr-set: a template ADR does not count", !r.ok, JSON.stringify(r));
  put(root, "docs/design/adr/0001-db.md", DOC("ADR 0001 - PostgreSQL over SQL Server"));
  r = row(checkOf(root, "DESIGN"), "docs/design/adr");
  check("adr-set: one real ADR passes", r.ok && r.type === "adr-set", JSON.stringify(r));

  put(root, "specs/features/README.md", DOC("How specs are organised"));
  r = row(checkOf(root, "DEVELOPMENT"), "specs/features");
  check("spec-set: a README alone is not a feature spec", !r.ok && /README/.test(r.reason), JSON.stringify(r));
  put(root, "specs/features/payments.md", DOC("Payments feature spec"));
  check("spec-set: a real spec passes", row(checkOf(root, "DEVELOPMENT"), "specs/features").ok, "");

  put(root, "src/README.md", DOC("Source layout"));
  r = row(checkOf(root, "DEVELOPMENT"), "src | backend | frontend | client");
  check("source-tree: a directory with no source file FAILS, naming the reason", !r.ok && /src: no source file/.test(r.reason), JSON.stringify(r));
  put(root, "src/Program.cs", "class P {}\n");
  check("source-tree: one source file passes", row(checkOf(root, "DEVELOPMENT"), "src | backend | frontend | client").ok, "");

  put(root, "memory-bank/progress.md", DOC("Progress") + "\n| ID | Task | Status |\n|---|---|---|\n| T-1 | Handler | Done |\n| T-2 | Endpoint | In Progress |\n");
  r = row(checkOf(root, "DEVELOPMENT"), "memory-bank/progress.md");
  check("task-board: a row still In Progress FAILS", !r.ok && /1 task row/.test(r.reason), JSON.stringify(r));
  put(root, "memory-bank/progress.md", DOC("Progress") + "\n| ID | Task | Status |\n|---|---|---|\n| T-1 | Handler | Done |\n| T-2 | Endpoint | Done |\n");
  check("task-board: all Done passes", row(checkOf(root, "DEVELOPMENT"), "memory-bank/progress.md").ok, "");

  put(root, "tests/fixtures/sample.json", "{}");
  put(root, "tests/helpers.mjs", "export const x = 1;\n");
  put(root, "docs/testing/strategy.md", DOC("Test strategy"));
  r = row(checkOf(root, "TESTING"), "tests | test | e2e");
  check("test-suite: fixtures and helpers are not tests", !r.ok && /none of them a test/.test(r.reason), JSON.stringify(r));
  put(root, "tests/Payments.test.mjs", "test('x', () => {});\n");
  check("test-suite: one *.test.* file passes", row(checkOf(root, "TESTING"), "tests | test | e2e").ok, "");

  put(root, ".github/workflows/ci.yml", "name: ci\n");
  r = row(checkOf(root, "PRODUCTION"), ".github/workflows | azure-pipelines.yml | .gitlab-ci.yml");
  check("pipeline: a workflow file with no job FAILS", !r.ok && /none defines a job/.test(r.reason), JSON.stringify(r));
  put(root, ".github/workflows/ci.yml", "name: ci\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps: []\n");
  check("pipeline: a workflow with a job passes", row(checkOf(root, "PRODUCTION"), ".github/workflows | azure-pipelines.yml | .gitlab-ci.yml").ok, "");
}

section("approve — traceability is part of the mechanical consent");
{
  const root = fixture("h-trace", { gates: true });
  for (const f of ["brief", "prd", "personas", "story-map", "scope", "nfr"]) put(root, `docs/product/${f}.md`, DOC(f));
  put(root, "docs/product/prd.md", DOC("PRD") + "\n### FR-1 — Issue a policy\n\nThe broker can issue a policy.\n");
  gitInit(root);
  let r = runTool("lifecycle.mjs", ["init", "--name", "fx"], root);
  check("greenfield init", r.exit === 0, r.err);
  r = runTool("lifecycle.mjs", ["record-gate", "REQUIREMENTS", "--verdict", "GO", "--by", "business-analyst"], root);
  check("record-gate GO by the named reviewer", r.exit === 0, r.err + r.out);
  r = runTool("lifecycle.mjs", ["approve", "REQUIREMENTS", "--by", "sara"], root);
  check("approve REFUSES: FR-1 reaches no story", r.exit === 1 && /FR-1 .*reaches no S/.test(r.err), r.err.slice(0, 400));

  put(root, "docs/product/story-map.md", DOC("Story map") + "\n### S-1 — Issue policy\n\n**Requirement:** FR-1\n\n- **AC-1** Given a quote, when issued, then a policy exists.\n");
  r = runTool("lifecycle.mjs", ["record-gate", "REQUIREMENTS", "--verdict", "GO", "--by", "business-analyst"], root);
  r = runTool("lifecycle.mjs", ["approve", "REQUIREMENTS", "--by", "sara"], root);
  check("approve passes once the chain is complete (S-1 -> UC is not due until ANALYSIS)", r.exit === 0, r.err + r.out.slice(0, 300));
  const st = JSON.parse(readFileSync(join(root, "lifecycle", "state.json"), "utf8"));
  check("the record says what the consent was computed from", st.phases.REQUIREMENTS.mechanical.traceability?.ids >= 2 && st.phases.REQUIREMENTS.mechanical.types["docs/product/prd.md"] === "document", JSON.stringify(st.phases.REQUIREMENTS.mechanical).slice(0, 300));
  check("revision advanced once per write (init, gate, gate, approve — the refused approve wrote nothing)", st.revision === 4, `revision ${st.revision}`);
  check("who typed it is recorded beside --by", !!st.phases.REQUIREMENTS.human.recordedBy && "git" in st.phases.REQUIREMENTS.human.recordedBy, JSON.stringify(st.phases.REQUIREMENTS.human));
}

section("approve — TESTING runs ac-trace and records it");
{
  const root = fixture("h-actrace", { gates: true });
  put(root, "docs/testing/strategy.md", DOC("Test strategy"));
  put(root, "tests/a.test.mjs", "test('x', () => { expect(1).toBe(1); });\n");
  const phases = {};
  for (const p of lc.PHASES) phases[p] = {};
  for (const p of ["REQUIREMENTS", "ANALYSIS", "DESIGN", "DEVELOPMENT"]) phases[p] = { inherited: { basis: "test", by: "a", reviewBy: "b" } };
  put(root, "lifecycle/state.json", JSON.stringify({ schemaVersion: 3, revision: 0, product: "fx", mode: "greenfield", phase: "TESTING", updated: "2026-01-01T00:00:00Z", phases, history: [] }));
  gitInit(root);
  let r = runTool("lifecycle.mjs", ["record-gate", "TESTING", "--verdict", "GO", "--by", "product-manager"], root);
  check("record-gate TESTING", r.exit === 0, r.err);
  r = runTool("lifecycle.mjs", ["approve", "TESTING", "--by", "sara"], root);
  check("approve TESTING runs ac-trace", r.exit === 0 && /ac-trace\.mjs check/.test(r.out), r.err + r.out.slice(0, 400));
  const st = JSON.parse(readFileSync(join(root, "lifecycle", "state.json"), "utf8"));
  const c = st.phases.TESTING.mechanical.checks?.[0];
  check("...and records the run (no specs -> skipped, not failed)", c && c.tool === "ac-trace.mjs" && c.ran && (c.ok || c.skipped), JSON.stringify(c));
}

section("approve — a FAILED check is a refusal until accepted by name");
{
  const root = fixture("h-accept", { gates: true });
  put(root, "docs/testing/strategy.md", DOC("Test strategy"));
  put(root, "tests/a.test.mjs", "test('x', () => { expect(1).toBe(1); });\n");
  // A spec with an AC nobody tests: ac-trace exits 1.
  put(root, "specs/features/pay.md", "# Payments\n\n## Acceptance criteria\n\n- **AC-1** Given a quote, when issued, then a policy exists.\n- **AC-2** Given no quote, when issued, then it is refused.\n");
  const phases = {};
  for (const p of lc.PHASES) phases[p] = {};
  for (const p of ["REQUIREMENTS", "ANALYSIS", "DESIGN", "DEVELOPMENT"]) phases[p] = { inherited: { basis: "test", by: "a", reviewBy: "b" } };
  put(root, "lifecycle/state.json", JSON.stringify({ schemaVersion: 3, revision: 0, product: "fx", mode: "greenfield", phase: "TESTING", updated: "2026-01-01T00:00:00Z", phases, history: [] }));
  gitInit(root);
  const probe = runTool("ac-trace.mjs", ["check"], root);
  if (probe.exit === 1) {
    runTool("lifecycle.mjs", ["record-gate", "TESTING", "--verdict", "GO", "--by", "product-manager"], root);
    let r = runTool("lifecycle.mjs", ["approve", "TESTING", "--by", "sara"], root);
    check("approve REFUSES on ac-trace exit 1", r.exit === 1 && /ac-trace\.mjs check exited 1/.test(r.err), r.err.slice(0, 400));
    check("...and names the way through", /--accept-check ac-trace\.mjs/.test(r.err), r.err.slice(0, 400));
    r = runTool("lifecycle.mjs", ["approve", "TESTING", "--by", "sara", "--accept-check", "ac-trace.mjs"], root);
    check("--accept-check ac-trace.mjs lets it through", r.exit === 0, r.err + r.out.slice(0, 300));
    const st = JSON.parse(readFileSync(join(root, "lifecycle", "state.json"), "utf8"));
    check("the acceptance is in the record, by name", st.phases.TESTING.human.acceptedChecks?.includes("ac-trace.mjs") && st.phases.TESTING.mechanical.checks[0].accepted === true, JSON.stringify(st.phases.TESTING.human));
    check("...and in the history line", /CHECK FAIL ACCEPTED/.test(st.history.map((h) => h.detail).join()), JSON.stringify(st.history));
  } else {
    check("ac-trace fixture produces a gap (exit 1)", false, `ac-trace exited ${probe.exit}: ${(probe.out + probe.err).slice(0, 300)}`);
  }
}

report("An approval is bound to the content it approved, and a present artifact has to be the kind of thing the gate asked for.");
