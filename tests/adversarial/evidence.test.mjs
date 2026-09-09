#!/usr/bin/env node
/**
 * evidence.test.mjs — the hash chain over lifecycle/, and what refuses on it.
 *
 * Every record under lifecycle/ used to vouch for itself and nothing else: a
 * verdict file could be replaced, an override deleted, a state.json rewritten,
 * and every tool would read the result as history. lifecycle/index.jsonl links
 * each record to the one before it. Each case here is one way of rewriting the
 * past, and the line that now notices.
 */

import { join } from "node:path";
import { readFileSync, writeFileSync, unlinkSync, existsSync, readdirSync, cpSync, rmSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fixture, runHook, runTool, bash, put, gitInit, DOC, check, denies, report, section, REPO } from "../_harness.mjs";

const lc = await import(new URL(`file:///${join(REPO, ".cursor", "tools", "lifecycle.mjs").replace(/\\/g, "/")}`));
const ev = await import(new URL(`file:///${join(REPO, ".cursor", "tools", "_evidence.mjs").replace(/\\/g, "/")}`));

const INDEX = (root) => join(root, "lifecycle", "index.jsonl");
const lines = (root) => readFileSync(INDEX(root), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const evidence = (root, ...a) => runTool("lifecycle.mjs", ["evidence", ...a], root);
const evJson = (root) => JSON.parse(evidence(root, "--json").out);
const codes = (root) => evJson(root).findings.map((f) => f.code);

/** A greenfield product with REQUIREMENTS judged GO — three records on disk, all indexed. */
function judged(name) {
  const root = fixture(name, { gates: true });
  for (const f of ["brief", "prd", "personas", "story-map", "scope", "nfr"]) put(root, `docs/product/${f}.md`, DOC(f));
  put(root, "docs/product/prd.md", DOC("PRD") + "\n### FR-1 — Issue a policy\n\nThe broker can issue a policy.\n");
  put(root, "docs/product/story-map.md", DOC("Story map") + "\n### S-1 — Issue policy\n\n**Requirement:** FR-1\n\n- **AC-1** Given a quote, when issued, then a policy exists.\n");
  gitInit(root);
  let r = runTool("lifecycle.mjs", ["init", "--name", "fx"], root);
  check(`${name}: init`, r.exit === 0, r.err);
  r = runTool("lifecycle.mjs", ["record-gate", "REQUIREMENTS", "--verdict", "GO", "--by", "business-analyst"], root);
  check(`${name}: record-gate GO`, r.exit === 0, r.err + r.out);
  return root;
}

section("the chain starts with the first record and follows every write");
{
  const root = judged("ev-start");
  check("lifecycle/index.jsonl exists after init", existsSync(INDEX(root)), "");
  const L = lines(root);
  check("init wrote one state entry; record-gate wrote a state entry and a gate-verdict entry", L.length === 3 && L[0].kind === "state" && L[1].kind === "state" && L[2].kind === "gate-verdict", JSON.stringify(L.map((e) => e.kind)));
  check("sequence numbers are 1..n", L.every((e, i) => e.seq === i + 1), JSON.stringify(L.map((e) => e.seq)));
  check("the first line has no predecessor; every other line names the one before it", L[0].prev === null && L.slice(1).every((e, i) => e.prev === L[i].entry), "");
  check("every line's own hash checks out", L.every((e) => { const { entry, ...rest } = e; return entry && entry.length === 64; }), "");
  check("the gate entry carries what the verdict was", L[2].meta.phase === "REQUIREMENTS" && L[2].meta.verdict === "GO" && L[2].meta.by === "business-analyst" && /^lifecycle\/evidence\/requirements-.*\.json$/.test(L[2].ref), JSON.stringify(L[2]));
  check("the state entry says which revision and which event", L[1].meta.revision === 2 && /^gate:/.test(L[1].meta.event), JSON.stringify(L[1].meta));
  const r = evidence(root);
  check("`evidence` verifies clean", r.exit === 0 && /OK: every record is the one that was written/.test(r.out), r.out + r.err);
  const j = evJson(root);
  check("--json: ok, 3 entries over 2 records, no findings", j.ok && j.entries === 3 && j.records === 2 && j.findings.length === 0, JSON.stringify(j));
  const v = ev.verifyChain(root);
  check("verifyChain() agrees in-process", v.ok && v.exists && v.latest.has("lifecycle/state.json"), JSON.stringify(v.findings));
}

section("a record edited after it was written — CHANGED, and approve refuses past every override");
{
  const root = judged("ev-changed");
  const evDir = join(root, "lifecycle", "evidence");
  const file = join(evDir, readdirSync(evDir).find((f) => f.endsWith(".json")));
  const rec = JSON.parse(readFileSync(file, "utf8"));
  rec.verdict = "GO"; rec.note = "edited after the fact";
  writeFileSync(file, JSON.stringify(rec, null, 2) + "\n");
  let r = evidence(root);
  check("`evidence` FAILS", r.exit === 1 && /CHANGED/.test(r.out) && /FAILED: 1 finding/.test(r.out), r.out);
  check("...naming the file and the entry that recorded it", /lifecycle\/evidence\/requirements-.*is not the content entry 3 recorded/.test(r.out), r.out);
  check("...and pointing at the human repair, not at a flag", /evidence reseal --by/.test(r.out) && !/--force/.test(r.out), r.out);
  r = runTool("lifecycle.mjs", ["approve", "REQUIREMENTS", "--by", "sara"], root);
  check("approve REFUSES on the chain", r.exit === 1 && /evidence chain .*does not verify/.test(r.err) && /CHANGED/.test(r.err), r.err.slice(0, 500));
  check("...and says an override does not reach this", /Nothing here can be overridden/.test(r.err), r.err);
  const st = JSON.parse(readFileSync(join(root, "lifecycle", "state.json"), "utf8"));
  check("nothing was approved", !st.phases.REQUIREMENTS.human, JSON.stringify(st.phases.REQUIREMENTS.human));
  r = runTool("lifecycle.mjs", ["override", "REQUIREMENTS", "--reason", "try to route around", "--risk", "HIGH", "--by", "omar", "--expires", "7"], root);
  check("an override can still be recorded (it is a record like any other)", r.exit === 0, r.err);
  r = runTool("lifecycle.mjs", ["approve", "REQUIREMENTS", "--by", "sara"], root);
  check("approve under the override is STILL refused - the chain is not a gate finding", r.exit === 1 && /evidence chain .*does not verify/.test(r.err) && !/PROCEEDING UNDER OVERRIDE/.test(r.err), r.err.slice(0, 500));
}

section("a line removed from the index — LINK_BROKEN");
{
  const root = judged("ev-link");
  const raw = readFileSync(INDEX(root), "utf8").split("\n").filter(Boolean);
  writeFileSync(INDEX(root), [raw[0], raw[2]].join("\n") + "\n"); // drop the middle line
  const c = codes(root);
  check("LINK_BROKEN and SEQ_GAP reported", c.includes("LINK_BROKEN") && c.includes("SEQ_GAP"), JSON.stringify(c));
  const r = evidence(root);
  check("...in words: a line was removed, inserted or reordered", /a line was removed, inserted or reordered/.test(r.out), r.out);
}

section("a line edited in place — ENTRY_ALTERED");
{
  const root = judged("ev-altered");
  const raw = readFileSync(INDEX(root), "utf8").split("\n").filter(Boolean);
  const e = JSON.parse(raw[2]); e.meta.by = "somebody-else";
  raw[2] = JSON.stringify(e);
  writeFileSync(INDEX(root), raw.join("\n") + "\n");
  const c = codes(root);
  check("ENTRY_ALTERED reported (and only that - the links still hold)", c.includes("ENTRY_ALTERED") && !c.includes("LINK_BROKEN"), JSON.stringify(c));
}

section("a record deleted — MISSING; a record added by hand — UNINDEXED");
{
  const root = judged("ev-files");
  const evDir = join(root, "lifecycle", "evidence");
  unlinkSync(join(evDir, readdirSync(evDir).find((f) => f.endsWith(".json"))));
  put(root, "lifecycle/overrides/OV-FAKE01.json", JSON.stringify({ id: "OV-FAKE01", phase: "DESIGN", by: "nobody" }));
  const j = evJson(root);
  const c = j.findings.map((f) => f.code);
  check("MISSING for the deleted verdict, UNINDEXED for the planted override", c.includes("MISSING") && c.includes("UNINDEXED"), JSON.stringify(j.findings));
  check("each finding names its file", j.findings.every((f) => f.ref && f.ref.startsWith("lifecycle/")), JSON.stringify(j.findings));
  check("an unparseable line is a finding, not a crash", (() => { writeFileSync(INDEX(root), readFileSync(INDEX(root), "utf8") + "{not json\n"); return codes(root).includes("UNPARSEABLE"); })(), "");
}

section("reseal — human-only, archives the old chain, names who accepted what");
{
  const root = judged("ev-reseal");
  denies("guard-bash refuses `lifecycle.mjs evidence reseal` from the agent", runHook("guard-bash.mjs", bash(`node .cursor/tools/lifecycle.mjs evidence reseal --by "sara" --reason "x"`), root), "human");
  const evDir = join(root, "lifecycle", "evidence");
  const file = join(evDir, readdirSync(evDir).find((f) => f.endsWith(".json")));
  writeFileSync(file, readFileSync(file, "utf8").replace("business-analyst", "someone"));
  check("fixture: chain is broken", !evJson(root).ok, "");
  let r = evidence(root, "reseal", "--by", "sara");
  check("reseal without --reason is refused", r.exit === 2 && /needs --reason/.test(r.err), r.err);
  r = evidence(root, "reseal", "--reason", "restored from backup after disk loss");
  check("reseal without --by is refused", r.exit === 2 && /needs --by/.test(r.err), r.err);
  check("...and both refusals wrote nothing", lines(root).length === 3 && !ev.archives(root).length, "");
  r = evidence(root, "reseal", "--by", "sara", "--reason", "restored from backup after disk loss");
  check("reseal by name succeeds", r.exit === 0 && /resealed by sara/.test(r.out), r.err + r.out);
  const arch = ev.archives(root);
  check("the old chain is archived beside the new one, untouched", arch.length === 1 && readFileSync(join(root, ...arch[0].split("/")), "utf8").split("\n").filter(Boolean).length === 3, JSON.stringify(arch));
  const L = lines(root);
  check("the new chain's first line is the reseal, naming the archive, the person and the reason", L[0].kind === "reseal" && L[0].meta.by === "sara" && L[0].meta.reason.includes("backup") && L[0].ref === arch[0] && L[0].meta.archivedEntries === 3, JSON.stringify(L[0]));
  check("...and lists the findings it accepted", L[0].meta.accepted.length === 1 && L[0].meta.accepted[0].code === "CHANGED", JSON.stringify(L[0].meta.accepted));
  check("...and who typed it", L[0].meta.recordedBy && "os" in L[0].meta.recordedBy, JSON.stringify(L[0].meta.recordedBy));
  check("every record on disk is adopted under the new first line", L.slice(1).every((e) => e.kind === "adopted") && L.length === 3, JSON.stringify(L.map((e) => [e.kind, e.ref])));
  r = evidence(root);
  check("the new chain verifies, and says it was resealed", r.exit === 0 && /resealed by sara/.test(r.out) && /archived chains: 1/.test(r.out), r.out);
  r = runTool("lifecycle.mjs", ["approve", "REQUIREMENTS", "--by", "sara"], root);
  check("approve is possible again after the reseal", r.exit === 0, r.err.slice(0, 400));
  check("...and the approval was appended to the new chain", lines(root).slice(-1)[0].kind === "state" && /approve/.test(lines(root).slice(-1)[0].meta.event), JSON.stringify(lines(root).slice(-1)[0]));
}

section("adoption — records that predate the chain are indexed on the first write, then guarded");
{
  const root = fixture("ev-adopt", { gates: true, state: { schemaVersion: 3, revision: 0, product: "old", mode: "greenfield", phase: "REQUIREMENTS", updated: "2026-01-01T00:00:00Z", phases: {}, history: [] } });
  put(root, "lifecycle/incidents/INC-0001.json", JSON.stringify({ id: "INC-0001", title: "before the chain", at: "2026-01-01T00:00:00Z", guards: [] }));
  put(root, "docs/analysis/business-rules.md", DOC("Business rules") + "\n### BR-1 — Cooling-off period\n\nFourteen days.\n");
  check("fixture: no chain, and `evidence` says so without failing", !existsSync(INDEX(root)) && evidence(root).exit === 0 && /No evidence chain yet/.test(evidence(root).out), "");
  const r = runTool("change-request.mjs", ["open", "--changes", "BR-1", "--reason", "customer changed a rule", "--by", "omar"], root);
  check("a change request opens", r.exit === 0, r.err + r.out.slice(0, 300));
  const L = lines(root);
  check("the first write adopted state.json and the incident, then indexed the CR", L.length === 3 && L[0].kind === "adopted" && L[1].kind === "adopted" && L[2].kind === "change-request" && L[2].ref === "lifecycle/changes/CR-0001.json", JSON.stringify(L.map((e) => [e.kind, e.ref])));
  check("adopted entries say so", L[0].meta.note.includes("before the chain started"), JSON.stringify(L[0].meta));
  check("the chain verifies", evJson(root).ok, JSON.stringify(evJson(root).findings));
  writeFileSync(join(root, "lifecycle", "incidents", "INC-0001.json"), "{}");
  check("editing an ADOPTED record is now CHANGED - adoption is where the guard starts", codes(root).includes("CHANGED"), JSON.stringify(codes(root)));
  const r2 = runTool("change-request.mjs", ["close", "CR-0001"], root);
  check("close appends its own entry (the CR file has two entries; the latest hash is the one checked)", r2.exit === 0 && lines(root).slice(-1)[0].kind === "change-request-closed", JSON.stringify(lines(root).slice(-1)[0]));
}

section("close refuses to absorb a CHANGED change request");
{
  const root = fixture("ev-cr-absorb", { gates: true });
  put(root, "docs/analysis/business-rules.md", DOC("Business rules") + "\n### BR-1 — Cooling-off period\n\nFourteen days.\n");
  gitInit(root);
  let r = runTool("change-request.mjs", ["open", "--changes", "BR-1", "--reason", "customer changed a rule", "--by", "omar"], root);
  check("open", r.exit === 0, r.err + r.out.slice(0, 300));
  const crPath = join(root, "lifecycle", "changes", "CR-0001.json");
  const cr = JSON.parse(readFileSync(crPath, "utf8"));
  cr.reason = "tampered after it was indexed";
  writeFileSync(crPath, JSON.stringify(cr, null, 2) + "\n");
  check("fixture: evidence reports CHANGED", codes(root).includes("CHANGED"), JSON.stringify(codes(root)));
  r = runTool("change-request.mjs", ["close", "CR-0001"], root);
  check("close REFUSES rather than rewriting the hash", r.exit === 1 && /CHANGED/.test(r.err), r.err.slice(0, 500));
  check("...and the chain is still dirty", codes(root).includes("CHANGED"), JSON.stringify(codes(root)));
}

section("incidents.mjs open — indexed");
{
  const root = fixture("ev-inc", { gates: true });
  put(root, "src/A.cs", "class A {}\n");
  const r = runTool("incidents.mjs", ["open", "--title", "gateway timeout", "--detected", "reconciliation", "--guard", "src/A.cs#A", "--by", "omar"], root);
  check("incident opens", r.exit === 0, r.err + r.out.slice(0, 300));
  const L = lines(root);
  check("...and is the chain's first real entry", L.slice(-1)[0].kind === "incident" && L.slice(-1)[0].meta.id === "INC-0001" && L.slice(-1)[0].meta.by === "omar", JSON.stringify(L.slice(-1)[0]));
}

/* ------------------------------------------------------- release-evidence */

/** DEV/TEST/PROD approved by hand, phases 1-3 verified-inherited; an expired flag in src/ when `flagged` is set. */
function releasable(name, { flagged = false } = {}) {
  const root = fixture(name, { gates: true });
  put(root, "src/Payments/Handler.cs", flagged
    ? "// FLAG: old_checkout owner=@omar expires=2020-01-01\n// reason: retire after the new checkout ships\npublic class Handler { void X() { if (Flags.IsEnabled(\"old_checkout\")) {} } }\n"
    : "public class Handler {}\n");
  put(root, "specs/features/payments.md", DOC("Payments spec"));
  put(root, "memory-bank/progress.md", DOC("Progress") + "\n| T-1 | Handler | Done |\n");
  put(root, "docs/testing/strategy.md", DOC("Test strategy"));
  put(root, "tests/PaymentsTests.cs", "public class PaymentsTests { [Fact] public void X() {} }\n");
  put(root, ".github/workflows/ci.yml", "name: ci\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps: []\n");
  put(root, ".gitignore", "lifecycle/*.lock\n");
  lc.setRoot(root);
  const approved = (paths, at = "2026-01-02T00:00:00Z") => {
    const artifacts = {};
    for (const p of paths) artifacts[p] = lc.artifactHash(p);
    return { mechanical: { status: "PASS", at, artifacts }, judgement: { verdict: "GO", by: "reviewer", at }, human: { status: "APPROVED", by: "sara", at } };
  };
  const inh = { inherited: { basis: "brownfield", by: "sara", reviewBy: "omar" } };
  const phases = {
    REQUIREMENTS: inh, ANALYSIS: inh, DESIGN: inh,
    DEVELOPMENT: approved(["src", "specs/features", "memory-bank/progress.md"]),
    TESTING: approved(["docs/testing/strategy.md", "tests"], "2026-01-03T00:00:00Z"),
    PRODUCTION: approved([".github/workflows"]),
  };
  put(root, "lifecycle/state.json", JSON.stringify({ schemaVersion: 3, revision: 0, product: "legacy", mode: "brownfield", phase: "PRODUCTION", updated: "2026-01-03T00:00:00Z", phases, history: [] }, null, 2));
  gitInit(root);
  return root;
}

section("release-evidence.mjs — cut and sign are chained; sign refuses on a broken chain");
{
  const root = releasable("ev-rel");
  let r = runTool("release-evidence.mjs", ["cut", "--version", "v1.0.0"], root);
  check("cut succeeds", r.exit === 0, r.err + r.out.slice(0, 400));
  const rec = JSON.parse(readFileSync(join(root, "lifecycle", "releases", "v1.0.0.json"), "utf8"));
  const byTool = Object.fromEntries(rec.checks.map((c) => [c.tool, c]));
  check("a checker with nothing to check is recorded as skipped, not FAIL (fitness: no promoted architecture; risk-profile: no criteria)", byTool["fitness.mjs"].skipped === true && byTool["fitness.mjs"].ok === true && byTool["risk-profile.mjs"].skipped === true, JSON.stringify(rec.checks.map(({ tool, ok, skipped, exit }) => ({ tool, ok, skipped, exit }))));
  check("...and the cut output marks them ----", /----  fitness\.mjs/.test(r.out), r.out);
  check("no check was accepted, and the record says so", Array.isArray(rec.acceptedChecks) && rec.acceptedChecks.length === 0, JSON.stringify(rec.acceptedChecks));
  let L = lines(root);
  check("the cut adopted state.json and indexed the release record", L.length === 2 && L[0].kind === "adopted" && L[0].ref === "lifecycle/state.json" && L[1].kind === "release-cut" && L[1].ref === "lifecycle/releases/v1.0.0.json" && L[1].meta.version === "v1.0.0", JSON.stringify(L.map((e) => [e.kind, e.ref])));

  // Break the chain between cut and sign: rewrite state.json by hand.
  const stPath = join(root, "lifecycle", "state.json");
  const st = JSON.parse(readFileSync(stPath, "utf8"));
  st.phases.PRODUCTION.human.by = "someone-else";
  writeFileSync(stPath, JSON.stringify(st, null, 2));
  r = runTool("release-evidence.mjs", ["sign", "v1.0.0", "--by", "omar"], root);
  check("sign REFUSES: the chain says state.json is not what was written", r.exit === 1 && /evidence chain .*does not verify/.test(r.err) && /CHANGED\s+lifecycle\/state\.json/.test(r.err), r.err.slice(0, 500));
  check("...with no flag that accepts it", !/--accept/.test(r.err) && /evidence reseal --by/.test(r.err), r.err);
  const unsigned = JSON.parse(readFileSync(join(root, "lifecycle", "releases", "v1.0.0.json"), "utf8"));
  check("nothing was signed", unsigned.signature === null, JSON.stringify(unsigned.signature));

  // Put it back exactly, and sign.
  st.phases.PRODUCTION.human.by = "sara";
  writeFileSync(stPath, JSON.stringify(st, null, 2));
  check("restored byte-for-byte: chain verifies again", evJson(root).ok, JSON.stringify(evJson(root).findings));
  r = runTool("release-evidence.mjs", ["sign", "v1.0.0", "--by", "omar"], root);
  check("sign succeeds", r.exit === 0 && /signed by omar/.test(r.out), r.err + r.out.slice(0, 300));
  L = lines(root);
  check("...and appended release-signed; the release file's latest hash is the signed one", L.slice(-1)[0].kind === "release-signed" && L.slice(-1)[0].meta.by === "omar" && evJson(root).ok, JSON.stringify(L.slice(-1)[0]));
}

section("release-evidence.mjs cut --accept-check — a FAILED check refuses the cut until named");
{
  const root = releasable("ev-accept", { flagged: true });
  const fd = runTool("flag-debt.mjs", ["scan"], root);
  check("fixture: flag-debt FAILS on the expired flag", fd.exit === 1 && /EXPIRED/.test(fd.out), fd.out.slice(0, 300));
  let r = runTool("release-evidence.mjs", ["cut", "--version", "v2.0.0"], root);
  check("cut REFUSES", r.exit === 1 && /1 check\(s\) FAILED/.test(r.err) && /FAIL  flag-debt\.mjs/.test(r.err), r.err.slice(0, 500));
  check("...and prints the command that accepts it by name", /cut --version v2\.0\.0 --accept-check flag-debt\.mjs/.test(r.err), r.err);
  check("nothing was written", !existsSync(join(root, "lifecycle", "releases", "v2.0.0.json")) && !existsSync(INDEX(root)), "");
  r = runTool("release-evidence.mjs", ["cut", "--version", "v2.0.0", "--accept-check", "ac-trace.mjs"], root);
  check("accepting a DIFFERENT tool does not help", r.exit === 1 && /FAIL  flag-debt\.mjs/.test(r.err), r.err.slice(0, 300));
  r = runTool("release-evidence.mjs", ["cut", "--version", "v2.0.0", "--accept-check", "flag-debt.mjs", "--accept-check", "ac-trace.mjs"], root);
  check("accepting the failing tool cuts", r.exit === 0 && /FAIL \(accepted by name\)  flag-debt\.mjs/.test(r.out), r.err + r.out.slice(0, 400));
  check("...and says a tool that did not fail was not recorded as accepted", /NOTE  --accept-check named ac-trace\.mjs, which did not fail/.test(r.err), r.err);
  const rec = JSON.parse(readFileSync(join(root, "lifecycle", "releases", "v2.0.0.json"), "utf8"));
  check("the record carries the decision: acceptedChecks, and accepted:true on the check", rec.acceptedChecks.length === 1 && rec.acceptedChecks[0] === "flag-debt.mjs" && rec.checks.find((c) => c.tool === "flag-debt.mjs").accepted === true && !rec.checks.find((c) => c.tool === "ac-trace.mjs").accepted, JSON.stringify({ a: rec.acceptedChecks, c: rec.checks.map((c) => [c.tool, c.ok, c.accepted]) }));
  check("the chain entry for the cut names the accepted tool too", lines(root).slice(-1)[0].meta.acceptedChecks[0] === "flag-debt.mjs", JSON.stringify(lines(root).slice(-1)[0].meta));
  r = runTool("release-evidence.mjs", ["show", "v2.0.0"], root);
  check("show renders the acceptance", /FAIL \(accepted by name\)/.test(r.out), r.out.slice(0, 1200));
  r = runTool("release-evidence.mjs", ["sign", "v2.0.0", "--by", "omar"], root);
  check("sign tells the signer what they are covering", r.exit === 0 && /cut over 1 failing check\(s\) accepted by name: flag-debt\.mjs/.test(r.out), r.err + r.out);
}

section("writeState refuses to absorb a CHANGED state.json");
{
  const root = judged("ev-absorb");
  const stPath = join(root, "lifecycle", "state.json");
  const st = JSON.parse(readFileSync(stPath, "utf8"));
  st.product = "tampered";
  writeFileSync(stPath, JSON.stringify(st, null, 2));
  check("fixture: evidence reports CHANGED", codes(root).includes("CHANGED"), JSON.stringify(codes(root)));
  const r = runTool("lifecycle.mjs", ["record-gate", "REQUIREMENTS", "--verdict", "GO", "--by", "business-analyst"], root);
  check("record-gate REFUSES rather than rewriting the hash", r.exit === 1 && /CHANGED/.test(r.err), r.err.slice(0, 500));
  check("...and the chain is still dirty", codes(root).includes("CHANGED"), JSON.stringify(codes(root)));
}

section("release-evidence.mjs — untracked files under approved source refuse the cut");
{
  const root = releasable("ev-untracked");
  put(root, "src/Untracked.cs", "class Untracked {}\n");
  const r = runTool("release-evidence.mjs", ["cut", "--version", "v1.0.0"], root);
  check("cut REFUSES untracked source", r.exit === 1 && /untracked file\(s\) under an approved/.test(r.err) && /Untracked\.cs/.test(r.err), r.err.slice(0, 500));
  check("nothing was written", !existsSync(join(root, "lifecycle", "releases", "v1.0.0.json")), "");
}

section("release-evidence.mjs — plugin-only install still runs sibling checkers");
{
  const root = releasable("ev-plugin-only", { flagged: true });
  const plug = join(root, "plugin-install", "tools");
  mkdirSync(plug, { recursive: true });
  cpSync(join(root, ".cursor", "tools"), plug, { recursive: true });
  rmSync(join(root, ".cursor", "tools"), { recursive: true });
  // A plugin-only adopter never had `.cursor/tools` in git. The fixture copied
  // them so gitInit could hash a tree; commit the deletion so cut sees a clean
  // tree without local checkers, which is the case R3 is about.
  spawnSync("git", ["add", "-A"], { cwd: root, encoding: "utf8" });
  spawnSync("git", ["commit", "-qm", "plugin-only: tools live in the install"], { cwd: root, encoding: "utf8" });
  const r = spawnSync(process.execPath, [join(plug, "release-evidence.mjs"), "cut", "--version", "v1.0.0"], {
    cwd: root, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: root }, timeout: 60_000,
  });
  check("plugin-only cut sees flag-debt via sibling and REFUSES", r.status === 1 && /flag-debt\.mjs/.test(r.stderr || "") && /FAILED/.test(r.stderr || ""), (r.stderr || "").slice(0, 600) + (r.stdout || "").slice(0, 200));
}

report("Every rewrite of the record was noticed, and only a human could accept it.");
