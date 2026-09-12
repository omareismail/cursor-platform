#!/usr/bin/env node
/**
 * project.test.mjs — Project Command Center model, CLI, readiness, ideas, recs.
 */

import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fixture, check, report, section, REPO, runTool, put, gitInit } from "../_harness.mjs";

const model = await import(new URL(`file:///${join(REPO, ".cursor", "tools", "_project-model.mjs").replace(/\\/g, "/")}`));
const dash = await import(new URL(`file:///${join(REPO, ".cursor", "tools", "dashboard.mjs").replace(/\\/g, "/")}`));

const parse = (r) => { try { return JSON.parse(r.out); } catch { return null; } };

function mockRes() {
  let resolve;
  const done = new Promise((r) => { resolve = r; });
  const res = {
    statusCode: 0, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    writeHead(s, h) { this.statusCode = s; Object.assign(this.headers, h || {}); },
    end(buf) { this.body = buf; resolve(this); },
  };
  return { res, done };
}

async function http(method, url, host = "127.0.0.1:7777") {
  const { res, done } = mockRes();
  const ret = dash.onRequest({ method, url, headers: { host } }, res);
  await Promise.resolve(ret);
  if (res.body == null) await done;
  const text = Buffer.isBuffer(res.body) ? res.body.toString("utf8") : String(res.body || "");
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.statusCode, text, json };
}

section("ids, idea transitions, objective progress");
{
  check("nextId pads and increments", model.nextId([{ id: "IDEA-002" }], "IDEA") === "IDEA-003", model.nextId([{ id: "IDEA-002" }], "IDEA"));
  check("approved → implementing allowed", model.canTransitionIdea("APPROVED", "IMPLEMENTING"), "");
  check("released is terminal", model.canTransitionIdea("RELEASED", "APPROVED") === false, "");
  const unknown = model.objectiveProgress([{ status: "UNKNOWN" }, { status: "UNKNOWN" }]);
  check("unknown objectives have no ratio", unknown.ratio === null && /Insufficient|unmeasured|No objectives/.test(unknown.label), JSON.stringify(unknown));
  const mixed = model.objectiveProgress([{ status: "COMPLETE" }, { status: "INCOMPLETE" }, { status: "UNKNOWN" }]);
  check("mixed unknown suppresses percentage", mixed.ratio === null && mixed.complete === 1, JSON.stringify(mixed));
  const known = model.objectiveProgress([{ status: "COMPLETE" }, { status: "COMPLETE" }, { status: "INCOMPLETE" }]);
  check("all-known yields ratio", known.ratio === 2 / 3, JSON.stringify(known));
}

section("delivery defaults and readiness");
{
  const d = model.buildDefaultDelivery({ existing: true });
  check("eight default phases", d.phases.length === 8, String(d.phases.length));
  check("brownfield is NEEDS_REVIEW not COMPLETED", d.phases.every((p) => p.status === "NEEDS_REVIEW") && d.checkpoints.every((c) => c.status === "NOT_STARTED"), d.phases[0].status);
  check("stable PHASE/CHK ids", d.phases[0].id === "PHASE-000" && d.checkpoints[0].id === "CHK-001", d.checkpoints[0].id);
  const phase = d.phases.find((p) => p.slug === "integration");
  phase.status = "IN_PROGRESS";
  const r = model.phaseReadiness(phase, d);
  check("required unfinished checkpoints block ready", r.ready === false && r.reasons.some((x) => /Checkpoint/.test(x)), r.reasons[0]);
  const chks = d.checkpoints.filter((c) => c.phaseId === phase.id);
  for (const c of chks) {
    if (c.required !== false) {
      c.status = "PASSED";
      c.evidence = [{ id: "EV-001", kind: "manual", ref: "test", ok: true, valid: true }];
    }
  }
  for (const o of phase.objectives) o.status = "COMPLETE";
  const pred = d.phases.find((p) => p.id === phase.dependencies[0]);
  if (pred) pred.status = "COMPLETED";
  const r2 = model.phaseReadiness(phase, d);
  check("passed+evidenced+complete objectives is ready", r2.ready === true, JSON.stringify(r2.reasons));
  const bad = chks.find((c) => c.required !== false);
  bad.status = "PASSED";
  bad.evidence = [];
  const r3 = model.phaseReadiness(phase, d);
  check("PASSED without evidence is not ready", r3.ready === false && r3.reasons.some((x) => /without evidence/.test(x)), JSON.stringify(r3.reasons));
}

section("recommendations are explainable");
{
  const d = model.buildDefaultDelivery();
  d.phases[3].status = "IN_PROGRESS";
  const recs = model.recommend({
    phases: d.phases,
    checkpoints: d.checkpoints,
    ideas: [{ id: "IDEA-001", title: "X", status: "APPROVED", featureIds: [], value: "HIGH" }],
    features: [],
    requirements: [{ id: "FR-1", file: "docs/product/prd.md" }],
    ac: { acs: 4, covered: 1, uncovered: 3, uncoveredIds: ["S-1/AC-2"] },
    currentDeliveryPhaseId: "PHASE-003",
    dispositions: {},
  });
  const rules = recs.map((r) => r.rule);
  check("approved idea without feature", rules.includes("approved-idea-without-feature"), rules.join(","));
  check("unlinked requirement", rules.includes("unlinked-requirement"), rules.join(","));
  check("ac coverage", rules.includes("incomplete-ac-coverage"), rules.join(","));
  check("every rec has why and source", recs.every((r) => r.why && r.what && r.source && r.nextAction), JSON.stringify(recs[0]));
  const dismissed = model.recommend({
    phases: d.phases, checkpoints: d.checkpoints, ideas: [], features: [], requirements: [],
    dispositions: { "unlinked-requirement": { status: "DISMISSED" } },
  });
  check("dismissed rule is omitted", !dismissed.some((r) => r.rule === "unlinked-requirement"), dismissed.map((r) => r.rule).join(","));
}

section("graph, matrix, blockers");
{
  const d = model.buildDefaultDelivery();
  const g = model.buildGraph({
    project: { id: "PROJ-001", name: "Demo" },
    phases: d.phases,
    checkpoints: d.checkpoints.slice(0, 3),
    ideas: [{ id: "IDEA-001", title: "T", status: "CAPTURED", featureIds: ["feat-a"], phaseId: "PHASE-000" }],
    features: [{ id: "feat-a", name: "A", projectStatus: "PLANNED", phaseIds: ["PHASE-000"] }],
  });
  check("graph has project and idea nodes", g.nodes.some((n) => n.id === "PROJ-001") && g.nodes.some((n) => n.id === "IDEA-001"), String(g.nodes.length));
  check("became edge idea → feature", g.edges.some((e) => e.from === "IDEA-001" && e.to === "feat-a" && e.kind === "became"), JSON.stringify(g.edges.filter((e) => e.kind === "became")));
  const mx = model.checkpointMatrix(d.phases, d.checkpoints);
  check("matrix has types and phases", mx.types.length > 0 && mx.phases.length === 8, String(mx.types.length));
  d.checkpoints[0].status = "FAILED";
  const bl = model.blockers({ checkpoints: d.checkpoints, phases: d.phases });
  check("failed checkpoint is a blocker", bl.some((b) => b.checkpointId === d.checkpoints[0].id), JSON.stringify(bl[0]));
}

section("CLI init / idea / delivery / checkpoint on a fixture");
{
  const root = fixture("pcc-init");
  gitInit(root);
  put(root, "README.md", "# Fixture product\n\nEnough text to look like a real readme for discovery.\n");
  const init = runTool("project.mjs", ["init", "--name", "fixture-app"], root);
  check("init exits 0", init.exit === 0, `${init.exit} ${init.err} ${init.out}`);
  check("wrote project json", existsSync(join(root, "project", "project.json")) && existsSync(join(root, "project", "delivery.json")), "");
  const ident = JSON.parse(readFileSync(join(root, "project", "project.json"), "utf8"));
  check("identity confirmed name", ident.name === "fixture-app" && ident.identity.name.confidence === "confirmed", JSON.stringify(ident.identity.name));
  const st = parse(runTool("project.mjs", ["status", "--json"], root));
  check("status snapshot adopted", st?.adopted === true && st.delivery?.active, String(st?.identity?.name));
  const add = runTool("project.mjs", ["idea", "add", "--title", "Batch export", "--value", "HIGH"], root);
  check("idea add", add.exit === 0 && /IDEA-001/.test(add.out), add.out);
  const ev = runTool("project.mjs", ["idea", "evaluate", "IDEA-001"], root);
  check("idea evaluate", ev.exit === 0, ev.err);
  const ap = runTool("project.mjs", ["idea", "approve", "IDEA-001"], root);
  check("idea approve", ap.exit === 0, ap.err);
  const specified = runTool("project.mjs", ["idea", "specify", "IDEA-001"], root);
  check("idea specified is reachable through CLI", specified.exit === 0, specified.err);
  const impl = runTool("project.mjs", ["idea", "implement", "IDEA-001", "--feature", "FEAT-009"], root);
  check("idea implement binds overlay", impl.exit === 0, impl.err);
  const delivery = JSON.parse(readFileSync(join(root, "project", "delivery.json"), "utf8"));
  check("feature binding recorded", delivery.featureBindings.some((b) => b.featureId === "FEAT-009" && b.ideaId === "IDEA-001"), JSON.stringify(delivery.featureBindings));
  const show = parse(runTool("project.mjs", ["idea", "show", "IDEA-001", "--json"], root));
  check("idea trace has feature", show?.trace?.features?.some((f) => f.id === "FEAT-009"), JSON.stringify(show?.trace));
  const chk = delivery.checkpoints[0];
  const passNoEv = runTool("project.mjs", ["checkpoint", "pass", chk.id], root);
  check("pass without evidence refused", passNoEv.exit === 1, `${passNoEv.exit} ${passNoEv.err}`);
  const pass = runTool("project.mjs", ["checkpoint", "pass", chk.id, "--evidence", "docs/note.md", "--reviewer", "qa"], root);
  check("nonexistent evidence is refused", pass.exit === 1, pass.err);
  put(root, "docs/note.md", "Reviewed requirements and recorded the result.\n");
  const realPass = runTool("project.mjs", ["checkpoint", "pass", chk.id, "--evidence", "docs/note.md", "--reviewer", "qa"], root);
  check("pass with existing evidence", realPass.exit === 0, realPass.err);
  const after = JSON.parse(readFileSync(join(root, "project", "delivery.json"), "utf8"));
  const saved = after.checkpoints.find((c) => c.id === chk.id);
  check("history recorded", saved.status === "PASSED" && saved.history.length >= 2 && saved.evidence.length >= 1, JSON.stringify(saved.history));
  const complete = runTool("project.mjs", ["delivery", "complete", "PHASE-000"], root);
  check("complete refused while other required checkpoints open", complete.exit === 1, `${complete.exit} ${complete.out}`);
  const recs = parse(runTool("project.mjs", ["recommend", "list", "--json"], root));
  check("recommend list is an array", Array.isArray(recs) && recs.every((r) => r.rule && r.why), String(recs?.length));
  const existing = fixture("pcc-existing");
  gitInit(existing);
  runTool("project.mjs", ["init", "--name", "old", "--existing"], existing);
  const del = JSON.parse(readFileSync(join(existing, "project", "delivery.json"), "utf8"));
  check("existing does not guess a current phase", del.phases.every((p) => p.status === "NEEDS_REVIEW") && JSON.parse(readFileSync(join(existing, "project/project.json"))).currentDeliveryPhaseId === null, del.phases.map((p) => p.status).join(","));
  put(root, ".cursor/cache/repo-map.json", JSON.stringify({ projects: [{ name: "X" }], databaseProviders: ["PostgreSQL"] }));
  const scanned = parse(runTool("project.mjs", ["scan", "--json"], root));
  check("discover reads repo-map under .cursor/cache", scanned?.counts?.databases === 1 && scanned?.counts?.dotnetProjects === 1, JSON.stringify(scanned?.counts));
}

section("dashboard routes and command center page");
{
  const page = await http("GET", "/");
  check("page is command center", page.status === 200 && /Command Center/.test(page.text) && /Skip to content/.test(page.text), page.text.slice(0, 200));
  check("nav has ideas and checkpoints", /data-panel="ideas"/.test(page.text) && /data-panel="checkpoints"/.test(page.text), "");
  const proj = await http("GET", "/api/project");
  check("GET /api/project is 200 object", proj.status === 200 && proj.json && typeof proj.json === "object", JSON.stringify(proj.json)?.slice(0, 200));
  const ideas = await http("GET", "/api/ideas");
  check("GET /api/ideas", ideas.status === 200 && ("ideas" in (ideas.json || {}) || ideas.json?.empty), JSON.stringify(ideas.json)?.slice(0, 200));
  const rec = await http("GET", "/api/recommendations");
  check("GET /api/recommendations", rec.status === 200 && Array.isArray(rec.json?.items), JSON.stringify(rec.json)?.slice(0, 200));
  const graph = await http("GET", "/api/graph");
  check("GET /api/graph has nodes/edges", graph.status === 200 && Array.isArray(graph.json?.nodes) && Array.isArray(graph.json?.edges), JSON.stringify(graph.json)?.slice(0, 200));
  const post = await http("POST", "/api/project");
  check("POST still 405", post.status === 405, JSON.stringify(post.json));
}

section("relation validation");
{
  const errs = model.validateRelations({
    phases: [{ id: "PHASE-000" }],
    checkpoints: [{ id: "CHK-001", phaseId: "PHASE-999" }],
    ideas: [{ id: "IDEA-001", phaseId: "PHASE-000" }],
    featureBindings: [],
  });
  check("dangling phase ref is an error", errs.some((e) => /CHK-001/.test(e)), errs.join("; "));
}

section("readiness cannot turn missing facts into completion");
{
  const p = { id: "PHASE-001", status: "IN_PROGRESS", objectives: [{ id: "OBJ-1", title: "User journey", status: "UNKNOWN" }] };
  check("unknown required objective blocks readiness", !model.phaseReadiness(p).ready, "");
  p.objectives[0].status = "COMPLETE";
  p.dependencies = ["PHASE-404"];
  check("missing dependency blocks readiness", !model.phaseReadiness(p).ready, "");
  p.dependencies = [];
  p.riskIds = ["R-404"];
  check("unresolved risk blocks readiness", !model.phaseReadiness(p).ready, "");
  p.riskIds = [];
  const ctx = { checkpoints: [{ id: "CHK-1", phaseId: p.id, name: "Tests", status: "PASSED", evidence: [{ kind: "tool", ok: false, ref: "failed test" }] }] };
  check("failed evidence blocks readiness", !model.phaseReadiness(p, ctx).ready, "");
  check("health does not count failed evidence as passed", model.healthView(ctx).metrics.find((m) => m.id === "checkpoints").value.startsWith("0 /"), "");
  const bindings = { featureBindings: [{ featureId: "F-1", phaseId: p.id, required: true }], features: [{ id: "F-1", projectStatus: "IMPLEMENTED" }] };
  check("implemented feature is not verified", !model.phaseReadiness(p, bindings).ready, "");
  bindings.features[0].projectStatus = "VERIFIED";
  check("verified feature satisfies feature requirement", model.phaseReadiness(p, bindings).ready, "");
  p.exitCriteria = [{ id: "EXIT-1", title: "Latency measured", status: "UNKNOWN" }];
  check("unmeasured exit criterion blocks readiness", !model.phaseReadiness(p, bindings).ready, "");
}

section("recommendation identity survives changes in other findings");
{
  const ctx = { ideas: [{ id: "IDEA-001", title: "Export", status: "APPROVED" }], requirements: [{ id: "FR-1", file: "prd.md" }] };
  const before = model.recommend(ctx);
  const req = before.find((r) => r.rule === "unlinked-requirement");
  const after = model.recommend({ ...ctx, ideas: [] });
  check("same finding keeps same id", after.find((r) => r.rule === req.rule)?.id === req.id, JSON.stringify({ before, after }));
  const dismissed = model.recommend({ ...ctx, ideas: [], dispositions: { [req.id]: { status: "DISMISSED" } } });
  check("dismissal follows its finding", !dismissed.some((r) => r.rule === req.rule), JSON.stringify(dismissed));
}

section("CLI rejects unsupported verification and incomplete state");
{
  const root = fixture("pcc-negative");
  gitInit(root);
  runTool("project.mjs", ["init", "--name", "Negative cases"], root);
  runTool("project.mjs", ["checkpoint", "add", "--phase", "PHASE-000", "--type", "testing"], root);
  const testingId = JSON.parse(readFileSync(join(root, "project/delivery.json"))).checkpoints.at(-1).id;
  const verify = runTool("project.mjs", ["checkpoint", "verify", testingId], root);
  check("skipped or empty verifier cannot report success", verify.exit !== 0, verify.out);
  const pass = runTool("project.mjs", ["checkpoint", "pass", testingId], root);
  check("failed/skipped verify cannot be passed without fresh evidence", pass.exit === 1, pass.out);
  runTool("project.mjs", ["idea", "add", "--title", "Unproven idea"], root);
  runTool("project.mjs", ["idea", "evaluate", "IDEA-001"], root);
  runTool("project.mjs", ["idea", "approve", "IDEA-001"], root);
  const badPhase = runTool("project.mjs", ["idea", "implement", "IDEA-001", "--phase", "PHASE-404", "--feature", "F-1"], root);
  check("invalid implementation phase refused before any write", badPhase.exit === 1 && JSON.parse(readFileSync(join(root, "project/ideas.json"))).ideas[0].status === "APPROVED", badPhase.out);
  runTool("project.mjs", ["idea", "implement", "IDEA-001", "--feature", "F-1"], root);
  const unproven = runTool("project.mjs", ["idea", "verify", "IDEA-001"], root);
  check("idea verify needs verification evidence", unproven.exit === 1, unproven.out);
  put(root, "docs/verification.md", "Reviewed the acceptance criteria against test output.\n");
  const proven = runTool("project.mjs", ["idea", "verify", "IDEA-001", "--evidence", "docs/verification.md"], root);
  check("idea verify records real review evidence", proven.exit === 0, proven.err);
  const noRelease = runTool("project.mjs", ["idea", "release", "IDEA-001", "--release", "v99.0.0"], root);
  check("idea release requires an existing signed release", noRelease.exit === 1 && JSON.parse(readFileSync(join(root, "project/ideas.json"))).ideas[0].status === "VERIFIED", noRelease.err);
  const checkpointPass = runTool("project.mjs", ["checkpoint", "pass", "CHK-001", "--evidence", "docs/verification.md"], root);
  check("manual checkpoint evidence accepted", checkpointPass.exit === 0, checkpointPass.err);
  put(root, "docs/verification.md", "The result was changed after the review.\n");
  const stalePass = runTool("project.mjs", ["checkpoint", "pass", "CHK-001"], root);
  check("edited evidence must be reviewed again", stalePass.exit === 1, stalePass.err);
  const staleSnapshot = parse(runTool("project.mjs", ["snapshot"], root));
  check("snapshot flags edited evidence", staleSnapshot?.delivery?.checkpoints.find((c) => c.id === "CHK-001")?.evidence.at(-1).valid === false, "");
  const outside = runTool("project.mjs", ["checkpoint", "pass", "CHK-001", "--evidence", "../outside.md"], root);
  check("evidence outside the repo is refused", outside.exit === 1, outside.err);
  const ideasBefore = readFileSync(join(root, "project/ideas.json"), "utf8");
  const invalidLink = runTool("project.mjs", ["idea", "add", "--title", "Broken link", "--checkpoint", "CHK-404"], root);
  check("invalid relationship refused without partial write", invalidLink.exit === 1 && readFileSync(join(root, "project/ideas.json"), "utf8") === ideasBefore, invalidLink.err);
  put(root, "project/ideas.json", "{broken");
  const broken = runTool("project.mjs", ["status", "--json"], root);
  check("corrupt state reports failure", broken.exit === 1, broken.err);
}

section("duplicate identities and malformed state");
{
  const d = model.buildDefaultDelivery();
  const i = model.emptyIdentity({ name: "Shapes" });
  const ideas = model.emptyIdeas();
  check("default state validates", model.validateState(i, d, ideas).length === 0, "");
  d.phases[0].dependencies = [d.phases[1].id];
  check("dependency cycles are diagnosed", model.validateState(i, d, ideas).some((e) => /cycle/.test(e)), "");
  d.phases[0].dependencies = [];
  d.phases[0].status = "MADE_UP";
  check("invalid enum is rejected", model.validateState(i, d, ideas).some((e) => /status/.test(e)), "");
  const projected = model.projectFeatures({ features: {} }, { featureBindings: [{ featureId: "F-1", phaseId: "PHASE-001", ideaId: "IDEA-001" }, { featureId: "F-1", phaseId: "PHASE-002", ideaId: "IDEA-002" }] });
  check("one feature retains all overlay relationships", projected.length === 1 && projected[0].phaseIds.length === 2 && projected[0].ideaIds.length === 2, JSON.stringify(projected));
}

section("multi-file writes recover as one transaction");
{
  const txn = await import(new URL(`file:///${join(REPO, ".cursor", "tools", "_project-txn.mjs").replace(/\\/g, "/")}`));
  const root = fixture("pcc-txn");
  const dir = join(root, "project");
  const ident = { schemaVersion: 1, revision: 0, id: "PROJ-001", name: "Txn" };
  const delivery = { schemaVersion: 1, revision: 0, phases: [], checkpoints: [] };
  const ideas = { schemaVersion: 1, revision: 0, ideas: [{ id: "IDEA-001", status: "APPROVED" }] };
  txn.commitDocuments(dir, { "project.json": ident, "delivery.json": { ...delivery }, "ideas.json": { ...ideas } });
  check("init-like write leaves no journal", !existsSync(join(dir, ".txn.json")), "");
  const ident2 = JSON.parse(readFileSync(join(dir, "project.json"), "utf8"));
  const delivery2 = JSON.parse(readFileSync(join(dir, "delivery.json"), "utf8"));
  const ideas2 = JSON.parse(readFileSync(join(dir, "ideas.json"), "utf8"));
  ideas2.ideas[0].status = "IMPLEMENTING";
  delivery2.featureBindings = [{ featureId: "F-1", ideaId: "IDEA-001" }];
  let crash = null;
  try {
    txn.commitDocuments(dir, { "project.json": ident2, "delivery.json": delivery2, "ideas.json": ideas2 }, { crashAfter: "delivery.json" });
  } catch (e) { crash = e; }
  check("injected crash after the first payload file", crash?.code === "ECRASH", String(crash));
  check("journal remains for recovery", existsSync(join(dir, ".txn.json")), "");
  check("ideas not yet moved when crash is after delivery", JSON.parse(readFileSync(join(dir, "ideas.json"), "utf8")).ideas[0].status === "APPROVED", "");
  txn.recoverDocuments(dir);
  check("recovery completes the idea write", JSON.parse(readFileSync(join(dir, "ideas.json"), "utf8")).ideas[0].status === "IMPLEMENTING", "");
  check("journal is removed after recovery", !existsSync(join(dir, ".txn.json")), "");
  const stale = JSON.parse(readFileSync(join(dir, "ideas.json"), "utf8"));
  stale.ideas[0].title = "stale writer";
  JSON.parse(readFileSync(join(dir, "ideas.json"), "utf8"));
  const fresh = JSON.parse(readFileSync(join(dir, "ideas.json"), "utf8"));
  fresh.ideas[0].title = "first writer";
  txn.commitDocuments(dir, { "ideas.json": fresh });
  let conflict = null;
  try { txn.commitDocuments(dir, { "ideas.json": stale }); } catch (e) { conflict = e; }
  check("second writer holding an old revision is ECONFLICT", conflict?.code === "ECONFLICT", String(conflict));
}

section("CLI crash after delivery.json does not leave a split idea/delivery state");
{
  const root = fixture("pcc-txn-cli");
  gitInit(root);
  runTool("project.mjs", ["init", "--name", "Txn CLI"], root);
  runTool("project.mjs", ["idea", "add", "--title", "Atomic implement"], root);
  runTool("project.mjs", ["idea", "evaluate", "IDEA-001"], root);
  runTool("project.mjs", ["idea", "approve", "IDEA-001"], root);
  const crashed = runTool("project.mjs", ["idea", "implement", "IDEA-001", "--feature", "F-99"], root, { PROJECT_TXN_CRASH: "delivery.json" });
  check("CLI crash is visible", crashed.exit !== 0, `${crashed.exit} ${crashed.err}`);
  const midIdeas = JSON.parse(readFileSync(join(root, "project/ideas.json"), "utf8"));
  const midDelivery = JSON.parse(readFileSync(join(root, "project/delivery.json"), "utf8"));
  const split = midIdeas.ideas[0].status !== "IMPLEMENTING" && midDelivery.featureBindings.some((b) => b.featureId === "F-99");
  check("partial implement is visible on disk before recovery", split, JSON.stringify({ status: midIdeas.ideas[0].status, bindings: midDelivery.featureBindings }));
  const recovered = runTool("project.mjs", ["idea", "show", "IDEA-001", "--json"], root);
  const shown = parse(recovered);
  check("next command recovers the idea transition", recovered.exit === 0 && shown?.idea?.status === "IMPLEMENTING", recovered.err + recovered.out);
  check("binding and idea agree after recovery", JSON.parse(readFileSync(join(root, "project/delivery.json"), "utf8")).featureBindings.some((b) => b.ideaId === "IDEA-001") && JSON.parse(readFileSync(join(root, "project/ideas.json"), "utf8")).ideas[0].status === "IMPLEMENTING", "");
  check("journal gone after recovered command", !existsSync(join(root, "project/.txn.json")), "");
}

section("catalog preview refuses fabricated completion and preserves ids");
{
  const d = model.buildDefaultDelivery();
  const catalog = model.exportCatalog(d);
  const ok = model.previewCatalog(d, catalog);
  check("exported catalog previews cleanly", ok.ok === true, ok.errors.join("; "));
  const forged = { schemaVersion: 1, phases: catalog.phases.map((p, i) => i === 0 ? { ...p, status: "COMPLETED" } : p) };
  const bad = model.previewCatalog(d, forged);
  check("imported COMPLETED is refused", !bad.ok && bad.errors.some((e) => /COMPLETED/.test(e)), bad.errors.join("; "));
  const withEvidence = { schemaVersion: 1, phases: catalog.phases, checkpoints: [{ id: "CHK-001", status: "PASSED", evidence: [{ ok: true }] }] };
  const ev = model.previewCatalog(d, withEvidence);
  check("imported checkpoint evidence is refused", !ev.ok && ev.errors.some((e) => /evidence|PASSED/.test(e)), ev.errors.join("; "));
  catalog.phases.push({ slug: "beta", name: "Beta", order: 8, dependencies: ["PHASE-007"], checkpointTypes: ["testing"] });
  const applied = model.applyCatalog(d, catalog);
  check("new phase keeps existing PHASE-000", applied.delivery.phases[0].id === "PHASE-000" && applied.delivery.phases.some((p) => p.slug === "beta" && p.status === "PLANNED"), applied.delivery.phases.map((p) => p.id).join(","));
  check("new checkpoint starts NOT_STARTED", applied.delivery.checkpoints.filter((c) => c.phaseId === applied.delivery.phases.find((p) => p.slug === "beta").id).every((c) => c.status === "NOT_STARTED"), "");
  const root = fixture("pcc-catalog");
  gitInit(root);
  runTool("project.mjs", ["init", "--name", "Catalog"], root);
  put(root, "docs/catalog.json", JSON.stringify({ schemaVersion: 1, phases: [{ id: "PHASE-000", slug: "discovery", name: "Discovery", status: "COMPLETED" }] }));
  const apply = runTool("project.mjs", ["delivery", "catalog", "apply", "--file", "docs/catalog.json"], root);
  check("CLI apply refuses fabricated phase completion", apply.exit === 1 && /COMPLETED/.test(apply.err + apply.out), apply.err + apply.out);
  const exported = parse(runTool("project.mjs", ["delivery", "catalog", "export"], root));
  exported.phases[0].name = "Discovery renamed";
  put(root, "docs/catalog.json", JSON.stringify(exported));
  const goodApply = runTool("project.mjs", ["delivery", "catalog", "apply", "--file", "docs/catalog.json"], root);
  check("CLI apply keeps history and renames", goodApply.exit === 0 && JSON.parse(readFileSync(join(root, "project/delivery.json"), "utf8")).phases[0].name === "Discovery renamed" && JSON.parse(readFileSync(join(root, "project/delivery.json"), "utf8")).phases[0].status === "IN_PROGRESS", goodApply.err);
}

section("risk register feeds readiness, blockers and health");
{
  const parsed = model.parseRiskRegister(`
| ID | Risk | Cat | L | I | Owner | Retire in | Mitigation |
|---|---|---|---|---|---|---|---|
| R-04 | Gateway timeout unhandled | Integration | H | H | sara | PHASE-003 | Circuit breaker |
| R-05 | Accepted residual | Ops | H | H | lee | Never | Accepted by ops |
`);
  check("parses register ids and owners", parsed.risks.length === 2 && parsed.risks[0].owner === "sara" && parsed.risks[0].severity === "HIGH", JSON.stringify(parsed.risks));
  check("Never + Accepted is ACCEPTED not OPEN", parsed.risks[1].status === "ACCEPTED", parsed.risks[1].status);
  const d = model.buildDefaultDelivery();
  model.linkRisksToDelivery(parsed.risks, d.phases);
  check("Retire in PHASE-003 links to that phase", parsed.risks[0].phaseId === "PHASE-003", parsed.risks[0].phaseId);
  d.phases[3].status = "IN_PROGRESS";
  const blocked = model.phaseReadiness(d.phases[3], { ...d, risks: parsed.risks, currentDeliveryPhaseId: "PHASE-003" });
  check("open HIGH register risk blocks the retiring phase", blocked.ready === false && blocked.reasons.some((r) => /R-04/.test(r)), blocked.reasons.join("; "));
  const bl = model.blockers({ phases: d.phases, checkpoints: [], risks: parsed.risks, currentDeliveryPhaseId: "PHASE-003" });
  check("unresolved register risk is a blocker", bl.some((b) => b.riskIds?.includes("R-04")), JSON.stringify(bl));
  const health = model.healthView({ risks: parsed.risks, openRisks: model.openRiskCount(parsed.risks) });
  check("health counts open register risks", health.metrics.find((m) => m.id === "risks").value === "1", JSON.stringify(health.metrics.find((m) => m.id === "risks")));
  const root = fixture("pcc-risks");
  gitInit(root);
  runTool("project.mjs", ["init", "--name", "Risks"], root);
  put(root, "docs/analysis/risks.md", `| ID | Risk | Cat | L | I | Owner | Retire in | Mitigation |\n|---|---|---|---|---|---|---|---|\n| R-01 | Unowned cutover | Ops | H | H | | Discovery | |\n`);
  const snap = parse(runTool("project.mjs", ["snapshot"], root));
  check("snapshot loads the register", snap?.risks?.available === true && snap.risks.items.some((r) => r.id === "R-01"), JSON.stringify(snap?.risks));
  check("unlinked HIGH risk blocks current discovery", snap.delivery.phases.find((p) => p.id === "PHASE-000").readiness.reasons.some((r) => /R-01/.test(r)), JSON.stringify(snap.delivery.phases[0].readiness.reasons));
}

section("trace labels missing hops; idea VERIFIED is not feature VERIFIED");
{
  const traced = model.traceQuery("IDEA-001", {
    ideas: [{ id: "IDEA-001", title: "X", status: "VERIFIED", featureIds: ["F-1"], requirementIds: ["FR-9"] }],
    features: [{ id: "F-1", projectStatus: "IMPLEMENTED", source: "project-overlay" }],
    phases: [], checkpoints: [], requirements: [{ id: "FR-1" }],
    requirementIdsKnown: true,
  });
  check("unknown requirement is a missing hop", traced.missing.some((m) => m.kind === "requirement" && m.to === "FR-9"), JSON.stringify(traced.missing));
  check("verified idea does not verify an implemented feature", traced.missing.some((m) => m.kind === "feature-verification"), JSON.stringify(traced.missing));
  const recs = model.recommend({
    ideas: [{ id: "IDEA-001", title: "X", status: "VERIFIED", featureIds: ["F-1"] }],
    features: [{ id: "F-1", projectStatus: "IMPLEMENTED" }],
  });
  check("recommendation names the verification gap", recs.some((r) => r.rule === "idea-verified-feature-not"), recs.map((r) => r.rule).join(","));
  const refs = model.validateCanonicalRefs(
    { ideas: { ideas: [{ id: "IDEA-001", requirementIds: ["FR-9"], releaseId: "v9.9.9" }] }, delivery: { phases: [], checkpoints: [] } },
    { requirements: [{ id: "FR-1" }], requirementsAvailable: true, releases: [{ version: "v1.0.0" }], releasesAvailable: true },
  );
  check("canonical ref check names unknown requirement and release", refs.some((e) => /FR-9/.test(e)) && refs.some((e) => /v9.9.9/.test(e)), refs.join("; "));
}

section("identity confirm and dashboard risk/trace slices");
{
  const root = fixture("pcc-identity");
  gitInit(root);
  runTool("project.mjs", ["init", "--name", "Ident"], root);
  const conf = runTool("project.mjs", ["identity", "confirm", "--field", "languages", "--value", "JavaScript"], root);
  check("identity confirm writes confirmed field", conf.exit === 0 && JSON.parse(readFileSync(join(root, "project/project.json"), "utf8")).identity.languages.confidence === "confirmed", conf.err);
  const risks = await http("GET", "/api/risks");
  check("GET /api/risks", risks.status === 200 && Array.isArray(risks.json?.items), JSON.stringify(risks.json)?.slice(0, 200));
  const tr = await http("GET", "/api/trace?id=IDEA-001");
  check("GET /api/trace returns an object", tr.status === 200 || tr.status === 404, `${tr.status} ${JSON.stringify(tr.json)?.slice(0, 200)}`);
}

section("published schemas cover identity, delivery, ideas and evidence");
{
  const names = ["project.schema.json", "delivery.schema.json", "ideas.schema.json", "evidence.schema.json", "delivery-catalog.schema.json"];
  for (const name of names) {
    const p = join(REPO, "schemas", name);
    check(`${name} is parseable JSON Schema`, existsSync(p) && JSON.parse(readFileSync(p, "utf8")).$id.includes(name.replace(".schema.json", "")), p);
  }
}

section("discovery sources, scan limits and stack classification");
{
  const root = fixture("pcc-g06");
  gitInit(root);
  put(root, "package.json", JSON.stringify({ name: "dual", dependencies: { react: "18.2.0" } }, null, 2));
  put(root, "src/App.tsx", "export default function App() { return null; }\n");
  put(root, "src/Api.csproj", "<Project Sdk=\"Microsoft.NET.Sdk.Web\"></Project>\n");
  runTool("project.mjs", ["init", "--name", "Dual stack"], root);
  const scanned = parse(runTool("project.mjs", ["scan", "--json"], root));
  check("detections include source paths", Array.isArray(scanned?.detections) && scanned.detections.some((d) => (d.sources || []).some((s) => s.path)), JSON.stringify(scanned?.detections?.slice(0, 3)));
  check("stack class is fullstack", scanned?.classification?.id === "fullstack", JSON.stringify(scanned?.classification));
  check("React apps counted from manifests not tsx", scanned?.counts?.reactApps === 1, JSON.stringify(scanned?.counts));
  const lang = scanned.detections.find((d) => d.field === "languages" && d.value === "C#");
  const conf = runTool("project.mjs", ["identity", "confirm", "--detection", lang.id], root);
  check("identity confirm --detection", conf.exit === 0 && JSON.parse(readFileSync(join(root, "project/project.json"), "utf8")).identity.languages.confidence === "confirmed", conf.err + conf.out);
  const limited = parse(runTool("project.mjs", ["scan", "--json", "--max-files", "1"], root));
  check("max-files is reported", limited?.limits?.maxFiles === 1, JSON.stringify(limited?.limits));
}

section("graph/roadmap include tasks, evidence, milestones and releases");
{
  const g = model.buildGraph({
    project: { id: "PROJ-001", name: "Demo" },
    phases: [{ id: "PHASE-000", name: "Discovery", status: "IN_PROGRESS", order: 0, targetDate: "2026-10-01" }],
    checkpoints: [{ id: "CHK-001", name: "Req", phaseId: "PHASE-000", status: "PASSED", evidence: [{ id: "EV-001", ref: "docs/note.md", ok: true, valid: true }] }],
    ideas: [{
      id: "IDEA-001", title: "Slice", status: "IMPLEMENTING", featureIds: ["feat-a"], phaseId: "PHASE-000",
      taskIds: ["T-01"], implementationRefs: ["src/app.mjs"], testRefs: ["tests/app.test.mjs"],
      decisionId: "ADR-0001", requirementIds: ["FR-1"],
    }],
    features: [{ id: "feat-a", name: "A", projectStatus: "IN_PROGRESS", phaseIds: ["PHASE-000"], requirementIds: ["FR-1"], fileRefs: ["src/app.mjs"], testRefs: ["tests/app.test.mjs"] }],
    tasks: [{ id: "T-01", title: "Implement slice", file: "specs/plans/slice.md" }],
    releases: [{ version: "v1.0.0", signature: { by: "lee" } }],
    risks: [{ id: "R-01", title: "Cutover", status: "OPEN", phaseId: "PHASE-000", source: "docs/analysis/risks.md" }],
    milestones: [{ id: "MS-001", title: "Slice 1", date: "2026-10-01", phaseId: "PHASE-000", featureIds: ["feat-a"] }],
  });
  const kinds = [...new Set(g.nodes.map((n) => n.kind))].sort();
  check("connected journey has task/code/test/evidence/milestone", ["task", "code", "test", "evidence", "milestone"].every((k) => kinds.includes(k)), kinds.join(","));
  check("idea became feature and scheduled task", g.edges.some((e) => e.from === "IDEA-001" && e.to === "feat-a") && g.edges.some((e) => e.from === "IDEA-001" && e.to === "T-01"), JSON.stringify(g.edges.filter((e) => e.from === "IDEA-001")));
  check("checkpoint evidenced-by EV-001", g.edges.some((e) => e.from === "CHK-001" && e.to === "EV-001"), JSON.stringify(g.edges.filter((e) => e.kind === "evidenced-by")));
  const road = model.roadmap({
    phases: [{ id: "PHASE-000", name: "Discovery", status: "IN_PROGRESS", order: 0, targetDate: "2026-10-01", objectives: [] }],
    ideas: [{ id: "IDEA-001", title: "Slice", status: "APPROVED" }],
    features: [{ id: "feat-a", name: "A", projectStatus: "PLANNED", phaseIds: ["PHASE-000"] }],
    releases: [{ version: "v1.0.0", signature: { by: "lee" } }],
    milestones: [{ id: "MS-001", title: "Slice 1", date: "2026-10-01", phaseId: "PHASE-000" }],
    featureBindings: [{ featureId: "feat-a", releaseId: "v1.0.0" }],
  });
  check("roadmap has milestone and signed release membership", road.milestones.some((m) => m.id === "MS-001") && road.releases[0].signed && road.releases[0].features.includes("feat-a"), JSON.stringify(road.releases));
}

section("health adapters and extra recommendation rules");
{
  const health = model.healthView({
    adapters: {
      security: { available: false, reason: "no threat-model" },
      performance: { available: true, ok: true, summary: "1 performance checkpoint evidenced", counts: { block: 0 } },
      observability: { available: true, ok: false, summary: "2 blocking", counts: { block: 2 }, source: "failure-modes.mjs" },
      debt: { available: false, reason: "flag-debt skipped" },
      release: { available: true, ok: false, summary: "0 signed, 1 unsigned", counts: { block: 1 } },
    },
  });
  const by = Object.fromEntries(health.metrics.map((m) => [m.id, m]));
  check("security stays unknown when adapter unavailable", by.security?.kind === "unknown", JSON.stringify(by.security));
  check("observability reports blocking", by.observability?.kind === "bad" && /2 blocking/.test(by.observability.value), JSON.stringify(by.observability));
  check("release adapter is measured", by.release?.kind === "bad", JSON.stringify(by.release));
  const recs = model.recommend({
    phases: [{ id: "PHASE-004", name: "Hardening", slug: "hardening", status: "IN_PROGRESS" }],
    checkpoints: [],
    currentDeliveryPhaseId: "PHASE-004",
    adapters: {
      security: { available: false, reason: "no threat-model" },
      observability: { available: true, ok: false, summary: "timeout missing", counts: { block: 1 } },
      debt: { available: true, ok: false, summary: "expired flags", counts: { block: 1 } },
      release: { available: true, ok: false, summary: "unsigned", counts: { block: 1 } },
      performance: { available: false, reason: "no load tests" },
    },
    ideas: [{ id: "IDEA-001", title: "X", status: "APPROVED", decision: { verdict: "Approved" } }],
  });
  const rules = recs.map((r) => r.rule);
  check("security/performance/observability gap rules fire", ["security-adapter-unavailable", "performance-checkpoint-missing", "observability-verification-gap", "flag-debt-expired", "unsigned-release-evidence", "canonical-decision-missing"].every((r) => rules.includes(r)), rules.join(","));
}

section("verification contract, cancellation and waivers");
{
  const cancelled = model.phaseReadiness(
    { id: "PHASE-001", status: "IN_PROGRESS", objectives: [{ id: "OBJ-1", title: "Go", status: "COMPLETE" }], dependencies: ["PHASE-000"] },
    { phases: [{ id: "PHASE-000", status: "CANCELLED" }], checkpoints: [] },
  );
  check("cancelled dependency does not satisfy readiness", cancelled.ready === false && cancelled.reasons.some((r) => /CANCELLED/.test(r)), cancelled.reasons.join("; "));
  const contract = model.contractFindings({
    checkpoints: [{ id: "CHK-001", status: "WAIVED", notes: "", reviewer: "" }],
    ideas: [{ id: "IDEA-001", status: "RELEASED", decision: { verdict: "Approved" }, featureIds: ["F-1"] }],
    features: [{ id: "F-1", projectStatus: "IMPLEMENTED" }],
    featureBindings: [{ featureId: "F-1", ideaId: "IDEA-001" }],
    decisions: [{ id: "ADR-1" }],
  });
  const codes = contract.map((f) => f.code);
  check("contract names waiver, membership and unverified feature", ["waiver-without-reason", "released-without-membership", "released-idea-feature-unverified"].every((c) => codes.includes(c)), codes.join(","));
  const root = fixture("pcc-g10");
  gitInit(root);
  runTool("project.mjs", ["init", "--name", "Contract"], root);
  const waive = runTool("project.mjs", ["checkpoint", "waive", "CHK-001", "--reason", "accepted residual"], root);
  check("waive without --by is refused", waive.exit !== 0, waive.err + waive.out);
  const named = runTool("project.mjs", ["checkpoint", "waive", "CHK-001", "--reason", "accepted residual", "--by", "lee"], root);
  check("named waiver is recorded", named.exit === 0 && JSON.parse(readFileSync(join(root, "project/delivery.json"), "utf8")).checkpoints[0].status === "WAIVED", named.err);
  const cancel = runTool("project.mjs", ["delivery", "cancel", "PHASE-001", "--reason", "out of scope"], root);
  check("phase cancel requires a reason and records CANCELLED", cancel.exit === 0 && JSON.parse(readFileSync(join(root, "project/delivery.json"), "utf8")).phases.find((p) => p.id === "PHASE-001").status === "CANCELLED", cancel.err + cancel.out);
  const setChk = runTool("project.mjs", ["checkpoint", "set", "CHK-002", "--owner", "sara", "--notes", "follow-up"], root);
  check("checkpoint set updates metadata without status", setChk.exit === 0 && JSON.parse(readFileSync(join(root, "project/delivery.json"), "utf8")).checkpoints.find((c) => c.id === "CHK-002").owner === "sara", setChk.err);
  const ms = runTool("project.mjs", ["roadmap", "milestone", "--title", "Slice 1", "--date", "2026-10-01", "--phase", "PHASE-000"], root);
  check("roadmap milestone is authored", ms.exit === 0 && (JSON.parse(readFileSync(join(root, "project/delivery.json"), "utf8")).milestones || []).some((m) => m.title === "Slice 1"), ms.err + ms.out);
}

section("risk register status variants and alternate path");
{
  const parsed = model.parseRiskRegister(`
| ID | Risk | Status | Owner | Retire in |
|---|---|---|---|---|
| R-10 | In flight | In Progress | ada | Discovery |
| R-11 | Residual | Won't fix | lee | Never |
`);
  check("In Progress maps to OPEN", parsed.risks.find((r) => r.id === "R-10")?.status === "OPEN", JSON.stringify(parsed.risks));
  check("Won't fix maps to ACCEPTED", parsed.risks.find((r) => r.id === "R-11")?.status === "ACCEPTED", JSON.stringify(parsed.risks));
  const root = fixture("pcc-risk-alt");
  gitInit(root);
  runTool("project.mjs", ["init", "--name", "Alt risks"], root);
  put(root, "docs/risks.md", `| ID | Risk | Cat | L | I | Owner | Status |\n|---|---|---|---|---|---|---|\n| R-22 | Alternate register | Ops | H | H | moe | Open |\n`);
  const snap = parse(runTool("project.mjs", ["snapshot"], root));
  check("alternate docs/risks.md is parsed", snap?.risks?.available === true && snap.risks.items.some((r) => r.id === "R-22"), JSON.stringify(snap?.risks));
}

section("two OS writers cannot split the journal");
{
  const root = fixture("pcc-two-writers");
  gitInit(root);
  runTool("project.mjs", ["init", "--name", "Writers"], root);
  const bin = join(root, ".cursor", "tools", "project.mjs");
  const run = (title) => new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, "idea", "add", "--title", title], {
      cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, windowsHide: true,
    });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => resolve({ exit: code, out, err }));
  });
  const [a, b] = await Promise.all([run("Writer A"), run("Writer B")]);
  const ideas = JSON.parse(readFileSync(join(root, "project/ideas.json"), "utf8")).ideas;
  const ok = [a, b].filter((r) => r.exit === 0).length;
  const conflicted = [a, b].some((r) => r.exit !== 0);
  check("at least one concurrent writer succeeds", ok >= 1, JSON.stringify({ a, b, ideas: ideas.map((i) => i.title) }));
  check("ideas.json remains valid JSON with unique ids", ideas.length >= 1 && new Set(ideas.map((i) => i.id)).size === ideas.length, JSON.stringify(ideas));
  check("loser is conflict or lock, not a silent overwrite", conflicted || ideas.length === 2, `${ok} ok, conflicted=${conflicted}`);
}

report();
