#!/usr/bin/env node
/**
 * inherited.test.mjs — what a brownfield claim is worth.
 *
 * `init --existing` used to write `inherited: true` three times and nothing
 * else: no name, no basis, no reviewer, and it did so happily in an empty
 * directory. That flag then cleared the design gate for every source write and
 * carried every release. Each case here is one of those, now refused or named.
 */

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fixture, runHook, runTool, write, put, gitInit, DOC, check, denies, allows, report, section, REPO } from "../_harness.mjs";

const lc = await import(new URL(`file:///${join(REPO, ".cursor", "tools", "lifecycle.mjs").replace(/\\/g, "/")}`));
const readState = (root) => JSON.parse(readFileSync(join(root, "lifecycle", "state.json"), "utf8"));
const derived = (root) => JSON.parse(runTool("lifecycle.mjs", ["status", "--json"], root).out).derived;

section("init --existing — a claim needs a claimant and something to be about");
{
  const empty = fixture("in-empty", { gates: true });
  let r = runTool("lifecycle.mjs", ["init", "--existing", "--name", "legacy"], empty);
  check("without --by: refused, exit 2", r.exit === 2 && /needs --by/.test(r.err), `${r.exit} ${r.err.slice(0, 200)}`);
  r = runTool("lifecycle.mjs", ["init", "--existing", "--name", "legacy", "--by", "sara"], empty);
  check("on an empty directory: refused, nothing to inherit", r.exit === 1 && /nothing here to inherit/.test(r.err), `${r.exit} ${r.err.slice(0, 200)}`);
  check("...and points at the greenfield command instead", /init --name/.test(r.err), r.err.slice(0, 400));
  r = runTool("lifecycle.mjs", ["init", "--existing", "--name", "legacy", "--by", "sara", "--review-by", "Sara"], empty);
  check("--by and --review-by the same person (case-insensitive): refused", r.exit === 2 && /different person/.test(r.err), `${r.exit} ${r.err.slice(0, 200)}`);
}

section("init --existing — unverified when nobody reviewed the claim");
{
  const root = fixture("in-unverified", { gates: true });
  put(root, "src/Payments/Handler.cs", "public class Handler {}\n");
  put(root, "src/Payments/Repo.cs", "public class Repo {}\n");
  gitInit(root);
  const r = runTool("lifecycle.mjs", ["init", "--existing", "--name", "legacy", "--by", "sara"], root);
  check("with source and a commit: accepted", r.exit === 0, r.err);
  check("...and says so: INHERITED_UNVERIFIED, reviewed by nobody", /INHERITED_UNVERIFIED/.test(r.out) && /reviewed by nobody/.test(r.out), r.out.slice(0, 400));
  const st = readState(root);
  const inh = st.phases.REQUIREMENTS.inherited;
  check("the record carries the claimant and what was there", inh.by === "sara" && inh.reviewBy === null && inh.evidence.sourceFiles === 2 && inh.evidence.commits >= 1 && typeof inh.evidence.head === "string", JSON.stringify(inh));
  const d = derived(root);
  check("phases 1-3 derive INHERITED_UNVERIFIED", ["REQUIREMENTS", "ANALYSIS", "DESIGN"].every((p) => d[p].status === "INHERITED_UNVERIFIED"), JSON.stringify(d));
  check("...with the reason naming who is missing", /nobody|reviewBy|reviewed/i.test(d.DESIGN.reasons.join()), JSON.stringify(d.DESIGN));
  check("the product starts in DEVELOPMENT", st.phase === "DEVELOPMENT", st.phase);
  allows("source writes are OPEN on an unverified inheritance - work on a live system is not blocked", runHook("guard-phase.mjs", write(join(root, "src/New.cs")), root));
}

section("init --existing — verified when a second person is named");
{
  const root = fixture("in-verified", { gates: true });
  put(root, "backend/Api.cs", "public class Api {}\n");
  gitInit(root);
  const r = runTool("lifecycle.mjs", ["init", "--existing", "--name", "legacy", "--by", "sara", "--review-by", "omar"], root);
  check("accepted", r.exit === 0, r.err);
  check("...and says INHERITED, claimed by sara, reviewed by omar", /INHERITED —/.test(r.out) && /claimed by sara, reviewed by omar/.test(r.out), r.out.slice(0, 400));
  const d = derived(root);
  check("phases 1-3 derive INHERITED", ["REQUIREMENTS", "ANALYSIS", "DESIGN"].every((p) => d[p].status === "INHERITED"), JSON.stringify(d));
  allows("source writes are open", runHook("guard-phase.mjs", write(join(root, "backend/New.cs")), root));
}

section("legacy state — a bare `inherited: true` is UNVERIFIED, not INHERITED");
{
  const root = fixture("in-legacy", { state: { schemaVersion: 2, product: "old", mode: "existing", phase: "DEVELOPMENT", updated: "2026-01-01T00:00:00Z", phases: { REQUIREMENTS: { inherited: true }, ANALYSIS: { inherited: true }, DESIGN: { inherited: true } }, history: [] } });
  const d = derived(root);
  check("a v2 boolean derives INHERITED_UNVERIFIED", d.DESIGN.status === "INHERITED_UNVERIFIED", JSON.stringify(d.DESIGN));
  check("...and the reason says it predates the record", /before|legacy|nobody/i.test(d.DESIGN.reasons.join()), JSON.stringify(d.DESIGN));
  const r = runTool("lifecycle.mjs", ["status"], root);
  check("status marks it [u] and explains the migration", /\[u\]/.test(r.out) && /INHERITED_UNVERIFIED until somebody is named/.test(r.out), r.out.slice(0, 600));
  allows("guard-phase still clears source on the legacy flag (the upgrade blocks nobody)", runHook("guard-phase.mjs", write(join(root, "src/A.cs")), root));
}

section("release-evidence.mjs sign — a release cannot rest on an unverified claim silently");
{
  const root = fixture("in-release", { gates: true });
  put(root, "src/Payments/Handler.cs", "public class Handler {}\n");
  put(root, "specs/features/payments.md", DOC("Payments spec"));
  put(root, "memory-bank/progress.md", DOC("Progress") + "\n| T-1 | Handler | Done |\n");
  put(root, "docs/testing/strategy.md", DOC("Test strategy"));
  put(root, "tests/PaymentsTests.cs", "public class PaymentsTests { [Fact] public void X() {} }\n");
  put(root, ".github/workflows/ci.yml", "name: ci\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps: []\n");
  put(root, ".gitignore", "lifecycle/*.lock\n");
  lc.setRoot(root);
  const approved = (paths) => {
    const artifacts = {};
    for (const p of paths) artifacts[p] = lc.artifactHash(p);
    return {
      mechanical: { status: "PASS", at: "2026-01-02T00:00:00Z", artifacts },
      judgement: { verdict: "GO", by: "reviewer", at: "2026-01-02T00:00:00Z" },
      human: { status: "APPROVED", by: "sara", at: "2026-01-02T00:00:00Z" },
    };
  };
  const phases = {
    REQUIREMENTS: { inherited: { basis: "brownfield", by: "sara", reviewBy: null } },
    ANALYSIS: { inherited: { basis: "brownfield", by: "sara", reviewBy: null } },
    DESIGN: { inherited: { basis: "brownfield", by: "sara", reviewBy: null } },
    DEVELOPMENT: approved(["src", "specs/features", "memory-bank/progress.md"]),
    TESTING: { ...approved(["docs/testing/strategy.md", "tests"]), human: { status: "APPROVED", by: "sara", at: "2026-01-03T00:00:00Z" } },
    PRODUCTION: approved([".github/workflows"]),
  };
  put(root, "lifecycle/state.json", JSON.stringify({ schemaVersion: 3, revision: 0, product: "legacy", mode: "brownfield", phase: "PRODUCTION", updated: "2026-01-03T00:00:00Z", phases, history: [] }, null, 2));
  gitInit(root);
  const d = derived(root);
  check("fixture: DEV/TEST/PROD APPROVED, 1-3 INHERITED_UNVERIFIED", ["DEVELOPMENT", "TESTING", "PRODUCTION"].every((p) => d[p].status === "APPROVED") && d.DESIGN.status === "INHERITED_UNVERIFIED", JSON.stringify(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.status]))));

  let r = runTool("release-evidence.mjs", ["cut", "--version", "v1.0.0"], root);
  check("cut succeeds - the release depends on DEV and TEST, which stand", r.exit === 0, r.err + r.out.slice(0, 300));
  const rec = JSON.parse(readFileSync(join(root, "lifecycle", "releases", "v1.0.0.json"), "utf8"));
  check("the record says who cut it", rec.cutBy && "git" in rec.cutBy, JSON.stringify(rec.cutBy));
  check("the record carries the inherited claim as it stands", rec.lifecycle.phases.REQUIREMENTS.inherited.by === "sara" && rec.lifecycle.phases.REQUIREMENTS.inherited.reviewBy === null && rec.lifecycle.phases.REQUIREMENTS.status === "INHERITED_UNVERIFIED", JSON.stringify(rec.lifecycle.phases.REQUIREMENTS));

  r = runTool("release-evidence.mjs", ["sign", "v1.0.0", "--by", "omar"], root);
  check("sign REFUSES: three phases are INHERITED_UNVERIFIED", r.exit === 1 && /rests on 3 phase\(s\) that are INHERITED_UNVERIFIED/.test(r.err), `${r.exit} ${r.err.slice(0, 400)}`);
  check("...and prints the exact command that accepts them by name", /--accept-inherited REQUIREMENTS --accept-inherited ANALYSIS --accept-inherited DESIGN/.test(r.err), r.err.slice(0, 600));
  r = runTool("release-evidence.mjs", ["sign", "v1.0.0", "--by", "omar", "--accept-inherited", "REQUIREMENTS"], root);
  check("accepting ONE of three is still refused, naming the other two", r.exit === 1 && /ANALYSIS/.test(r.err) && /DESIGN/.test(r.err) && !/--accept-inherited REQUIREMENTS/.test(r.err), r.err.slice(0, 600));
  r = runTool("release-evidence.mjs", ["sign", "v1.0.0", "--by", "omar", "--accept-inherited", "requirements", "--accept-inherited", "ANALYSIS", "--accept-inherited", "DESIGN"], root);
  check("accepting all three (case-insensitive) signs", r.exit === 0 && /signed by omar/.test(r.out), r.err + r.out.slice(0, 300));
  check("...and says out loud what was accepted", /Accepted 3 unverified inherited phase\(s\)/.test(r.out), r.out);
  const signed = JSON.parse(readFileSync(join(root, "lifecycle", "releases", "v1.0.0.json"), "utf8"));
  check("the signature records the accepted phases and the signer's environment", signed.signature.acceptedInherited.length === 3 && signed.signature.by === "omar" && signed.signature.recordedBy && "os" in signed.signature.recordedBy, JSON.stringify(signed.signature));
}

section("release-evidence.mjs — a VERIFIED inheritance needs no acceptance");
{
  const root = fixture("in-release-ok", { gates: true });
  put(root, "src/A.cs", "class A {}\n");
  put(root, "specs/features/a.md", DOC("A"));
  put(root, "memory-bank/progress.md", DOC("Progress"));
  put(root, "docs/testing/strategy.md", DOC("Test strategy"));
  put(root, "tests/ATests.cs", "class ATests {}\n");
  put(root, ".github/workflows/ci.yml", "jobs:\n  b:\n    steps: []\n");
  put(root, ".gitignore", "lifecycle/*.lock\n");
  lc.setRoot(root);
  const approved = (paths, at) => {
    const artifacts = {};
    for (const p of paths) artifacts[p] = lc.artifactHash(p);
    return { mechanical: { status: "PASS", at, artifacts }, judgement: { verdict: "GO", by: "r", at }, human: { status: "APPROVED", by: "sara", at } };
  };
  const inh = { inherited: { basis: "brownfield", by: "sara", reviewBy: "omar" } };
  put(root, "lifecycle/state.json", JSON.stringify({ schemaVersion: 3, revision: 0, product: "p", mode: "brownfield", phase: "PRODUCTION", updated: "2026-01-03T00:00:00Z", phases: { REQUIREMENTS: inh, ANALYSIS: inh, DESIGN: inh, DEVELOPMENT: approved(["src", "specs/features", "memory-bank/progress.md"], "2026-01-02T00:00:00Z"), TESTING: approved(["docs/testing/strategy.md", "tests"], "2026-01-03T00:00:00Z"), PRODUCTION: approved([".github/workflows"], "2026-01-03T00:00:00Z") }, history: [] }));
  gitInit(root);
  let r = runTool("release-evidence.mjs", ["cut", "--version", "v1.0.0"], root);
  check("cut", r.exit === 0, r.err);
  r = runTool("release-evidence.mjs", ["sign", "v1.0.0", "--by", "omar"], root);
  check("sign passes with no --accept-inherited: the claim already has a reviewer's name", r.exit === 0, r.err + r.out.slice(0, 300));
}

section("actor capture — the name on the record and the account at the keyboard");
{
  const root = fixture("in-actor", { gates: true });
  for (const f of ["brief", "prd", "personas", "story-map", "scope", "nfr"]) put(root, `docs/product/${f}.md`, DOC(f));
  gitInit(root); // git user.name = "fixture"
  runTool("lifecycle.mjs", ["init", "--name", "fx"], root);
  runTool("lifecycle.mjs", ["record-gate", "REQUIREMENTS", "--verdict", "GO", "--by", "business-analyst"], root);
  let r = runTool("lifecycle.mjs", ["approve", "REQUIREMENTS", "--by", "Somebody Else"], root, { USER: "fixture", USERNAME: "fixture" });
  check("approve as a name the environment does not know: succeeds, WARNS", r.exit === 0 && /WARN\s+signing as "Somebody Else"/.test(r.err) && /git: fixture/.test(r.err), r.err.slice(0, 400));
  const st = readState(root);
  check("...and the mismatch is IN the record, not only on the terminal", st.phases.REQUIREMENTS.human.by === "Somebody Else" && st.phases.REQUIREMENTS.human.recordedBy.git === "fixture", JSON.stringify(st.phases.REQUIREMENTS.human));

  const root2 = fixture("in-actor-match", { gates: true });
  for (const f of ["brief", "prd", "personas", "story-map", "scope", "nfr"]) put(root2, `docs/product/${f}.md`, DOC(f));
  gitInit(root2);
  runTool("lifecycle.mjs", ["init", "--name", "fx"], root2);
  runTool("lifecycle.mjs", ["record-gate", "REQUIREMENTS", "--verdict", "GO", "--by", "business-analyst"], root2);
  r = runTool("lifecycle.mjs", ["approve", "REQUIREMENTS", "--by", "fixture"], root2);
  check("approve as the git user: no warning", r.exit === 0 && !/WARN\s+signing/.test(r.err), r.err.slice(0, 300));

  r = runTool("lifecycle.mjs", ["override", "REQUIREMENTS", "--reason", "test", "--risk", "LOW", "--by", "ops-bot", "--expires", "1"], root2, { USER: "fixture", USERNAME: "fixture" });
  check("override records who typed it and warns on a mismatch too", /WARN\s+signing as "ops-bot"/.test(r.err) && readState(root2).phases.REQUIREMENTS.override?.recordedBy?.git === "fixture", r.err.slice(0, 300) + JSON.stringify(readState(root2).phases.REQUIREMENTS.override));
}

section("session-start.mjs — the digest says what lifecycle.mjs derives");
{
  const ok = fixture("in-ss-ok", { gates: true });
  put(ok, "src/A.cs", "class A {}\n");
  gitInit(ok);
  runTool("lifecycle.mjs", ["init", "--existing", "--name", "legacy", "--by", "sara"], ok);
  let r = runHook("session-start.mjs", { hook_event_name: "SessionStart" }, ok);
  check("an unverified inheritance is shown as `u` and explained", r.exit === 0 && /u REQUIREMENTS/.test(r.out) && /nobody named as having checked/.test(r.out), r.out.slice(0, 800));
  check("...and the DESIGN gate is reported as passed (no false block warning)", !/DESIGN gate has not passed/.test(r.out), r.out.slice(0, 800));

  const corrupt = fixture("in-ss-corrupt", { state: "{ not json" });
  r = runHook("session-start.mjs", { hook_event_name: "SessionStart" }, corrupt);
  check("a corrupt state is named as CLOSED, not skipped", /cannot be read/.test(r.out) && /CLOSED design gate/.test(r.out) && /Do not run `init` over it/.test(r.out), r.out.slice(0, 800));

  const early = fixture("in-ss-early", { state: { schemaVersion: 3, revision: 0, product: "fx", mode: "greenfield", phase: "ANALYSIS", phases: {}, history: [] } });
  r = runHook("session-start.mjs", { hook_event_name: "SessionStart" }, early);
  check("an unpassed DESIGN gate is warned about, with its derived status", /DESIGN gate has not passed/.test(r.out) && /BLOCKED|NOT_STARTED/.test(r.out), r.out.slice(0, 800));

  const none = fixture("in-ss-none");
  r = runHook("session-start.mjs", { hook_event_name: "SessionStart" }, none);
  check("no state file: no lifecycle line at all", r.exit === 0 && !/Lifecycle:/.test(r.out), r.out.slice(0, 400));
}

report("An inherited phase is a claim with a claimant, a basis and - when it is to carry a release - a second name.");
