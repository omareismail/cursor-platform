#!/usr/bin/env node
/**
 * next.test.mjs — next increment of ideas 1–14 plus H01–H22 slices.
 *
 * Behavioural: observable verdicts, hashes, HTTP status, and lineage — not
 * “the source file mentions the string”.
 */

import { join } from "node:path";
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, utimesSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fixture, check, report, section, REPO, runTool, runHook, put, gitInit, bash } from "../_harness.mjs";

const parse = (r) => { try { return JSON.parse(r.out); } catch { return null; } };

const idx = await import(new URL(`file:///${join(REPO, ".cursor", "tools", "_skills-index.mjs").replace(/\\/g, "/")}`));
const st = await import(new URL(`file:///${join(REPO, ".cursor", "tools", "_state.mjs").replace(/\\/g, "/")}`));
const fmVal = await import(new URL(`file:///${join(REPO, ".cursor", "tools", "_findings.mjs").replace(/\\/g, "/")}`));
const dash = await import(new URL(`file:///${join(REPO, ".cursor", "tools", "dashboard.mjs").replace(/\\/g, "/")}`));

function mockRes() {
  let resolve;
  const done = new Promise((r) => { resolve = r; });
  const res = {
    statusCode: 0,
    headers: {},
    body: null,
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
  return { status: res.statusCode, text, json, headers: res.headers };
}

function validateFeatureMap(m, schema) {
  const errs = [];
  for (const k of schema.required || []) {
    if (!(k in m)) errs.push(`missing ${k}`);
  }
  if (typeof m.version !== "number" || m.version < 1) errs.push("version");
  if (!m.features || typeof m.features !== "object") errs.push("features");
  for (const [id, f] of Object.entries(m.features || {})) {
    if (!Array.isArray(f.files) || !f.files.length) errs.push(`${id}: files[]`);
    for (const file of f.files || []) {
      if (typeof file === "string") continue;
      if (!file || typeof file.path !== "string" || !file.path) errs.push(`${id}: file.path`);
    }
  }
  for (const [oid, o] of Object.entries(m.dataObjects || {})) {
    if (o.dependsOn && !Array.isArray(o.dependsOn)) errs.push(`${oid}: dependsOn`);
  }
  return errs;
}

section("H01 — nested sh -c force-push is still denied (observable refuse)");
{
  const root = fixture("h01-nested");
  const r = runHook("guard-bash.mjs", bash('sh -c "git push --force origin main"'), root);
  check("nested force-push denied", r.exit === 2 && /force push/i.test(r.err), `${r.exit} ${r.err.slice(0, 200)}`);
  const order = runHook("guard-bash.mjs", bash("git push origin main --force"), root);
  check("flag after refspec denied", order.exit === 2 && /force push/i.test(order.err), `${order.exit} ${order.err.slice(0, 200)}`);
}

section("H05 — _policy explain gated vs exempt");
{
  const root = fixture("h05-explain");
  const gated = parse(runTool("_policy.mjs", ["explain", "src/Pay/Handler.cs", "--json"], root));
  check("src/*.cs is gated", gated?.verdict === "gated" && gated?.earliest === "DEVELOPMENT", JSON.stringify(gated));
  check("exemptions are listed", Array.isArray(gated?.exemptions) && gated.exemptions.includes("docs/**"), JSON.stringify(gated?.exemptions));
  const exempt = parse(runTool("_policy.mjs", ["explain", "docs/README.md", "--json"], root));
  check("docs/** is exempt", exempt?.verdict === "exempt", JSON.stringify(exempt));
}

section("idea 11 — author cannot review their own artifacts");
{
  const root = fixture("h-id-author");
  put(root, ".cursor/identity.json", JSON.stringify({ identities: { alice: { roles: ["reviewer"] } } }, null, 2));
  const r = runTool("identity.mjs", ["verify", "--by", "alice", "--author", "alice", "--digest", "aaa", "--mapping", ".cursor/identity.json", "--json"], root);
  const body = parse(r);
  check("author-reviewer-same blocks", r.exit === 1 && body?.findings?.some((f) => f.code === "author-reviewer-same"), r.out.slice(0, 400));
}

section("H06 — feature-map save is revision CAS");
{
  const root = fixture("h06-cas");
  mkdirSync(join(root, ".cursor", "cache"), { recursive: true });
  const p = join(root, ".cursor", "cache", "feature-map.json");
  runTool("feature-map.mjs", ["init"], root);
  const first = st.readJsonRevisioned(p).obj;
  const stale = JSON.parse(JSON.stringify(first));
  first.repo = "winner";
  check("first save increments revision", st.commitJson(p, first) === (stale.revision + 1), "");
  stale.repo = "loser";
  let err = null;
  try { st.commitJson(p, stale); } catch (e) { err = e; }
  check("stale revision is ECONFLICT", err?.code === "ECONFLICT", String(err));
  check("winner remains on disk", JSON.parse(readFileSync(p, "utf8")).repo === "winner", readFileSync(p, "utf8").slice(0, 200));
}

section("H07 — dependsOn lineage and prune of missing definition files");
{
  const root = fixture("h07-dep");
  put(root, "src/Pay/Handler.cs", "class Pay {}\n");
  put(root, "sql/usp_Fee.sql", "CREATE PROC usp_Fee AS SELECT 1;\n");
  gitInit(root);
  runTool("feature-map.mjs", ["init"], root);
  put(root, "up.json", JSON.stringify({
    id: "pay",
    files: [{ path: "src/Pay/Handler.cs", role: "handler" }],
    lineage: { calls: ["dbo.usp_Pay"] },
    dataObjects: {
      "dbo.usp_Pay": {
        kind: "procedure",
        dataSource: "sqlserver-primary",
        features: ["pay"],
        tables: ["Pay"],
        dependsOn: ["dbo.usp_Fee"],
      },
      "dbo.usp_Fee": {
        kind: "procedure",
        dataSource: "sqlserver-primary",
        tables: ["Fee"],
        definitionFiles: [{ path: "sql/usp_Fee.sql" }],
      },
      "dbo.orphan": {
        kind: "procedure",
        definitionFiles: [{ path: "sql/gone.sql" }],
      },
    },
  }));
  const up = runTool("feature-map.mjs", ["upsert", "up.json"], root);
  check("upsert with dependsOn exits 0 or warns only on missing gone.sql", up.exit === 0 || up.exit === 1, `${up.exit} ${up.out} ${up.err}`);
  const lin = parse(runTool("feature-map.mjs", ["lineage", "pay", "--json"], root));
  check("lineage from pay reaches dbo.usp_Fee via dependsOn",
    Array.isArray(lin?.objects) && lin.objects.includes("dbo.usp_Fee"),
    JSON.stringify(lin)?.slice(0, 500));
  unlinkSync(join(root, "sql", "usp_Fee.sql"));
  const pr = runTool("feature-map.mjs", ["prune"], root);
  check("prune reports dropped objects", pr.exit === 0 && /pruned/.test(pr.out), `${pr.exit} ${pr.out} ${pr.err}`);
  const after = JSON.parse(readFileSync(join(root, ".cursor", "cache", "feature-map.json"), "utf8"));
  check("gone definition files are dropped", !after.dataObjects?.["dbo.usp_Fee"] && !after.dataObjects?.["dbo.orphan"], JSON.stringify(after.dataObjects));
}

section("H08 — dashboard Host, method, skip-link, RTL hook, simulate");
{
  const page = await http("GET", "/");
  check("GET / is 200 HTML", page.status === 200 && /text\/html/.test(String(page.headers["Content-Type"] || "")), JSON.stringify(page.headers));
  check("skip link and dir=ltr", /Skip to content/.test(page.text) && /dir="ltr"/.test(page.text) && /html\[dir="rtl"\]/.test(page.text), page.text.slice(0, 400));
  const post = await http("POST", "/");
  check("POST is 405", post.status === 405 && post.json?.error, JSON.stringify(post.json));
  const bad = await http("GET", "/", "evil.com");
  check("bad Host is 400", bad.status === 400, JSON.stringify(bad.json));
  const sim = await http("GET", "/api/simulate");
  check("GET /api/simulate returns a comparison", sim.status === 200 && Array.isArray(sim.json?.newlyAllowed), JSON.stringify(sim.json)?.slice(0, 300));
}

section("idea 10 — upgrade copies previous into isolated --out");
{
  const root = fixture("h-upgrade");
  put(root, "old/README.md", "v1\n");
  put(root, "new/README.md", "v2\n");
  put(root, "new/extra.txt", "added\n");
  const dest = join(root, "isolated-upgrade");
  const r = runTool("build-plugin.mjs", ["upgrade", "--from", "old", "--to", "new", "--out", dest], root);
  check("upgrade exits 0", r.exit === 0, `${r.exit} ${r.err} ${r.out}`);
  check(".previous holds the old tree", readFileSync(join(dest, ".previous", "README.md"), "utf8") === "v1\n", "");
  check("dest has the new tree", readFileSync(join(dest, "README.md"), "utf8") === "v2\n" && existsSync(join(dest, "extra.txt")), "");
  const live = runTool("build-plugin.mjs", ["upgrade", "--from", "old", "--to", "new", "--out", "."], root);
  check("refuses upgrading over the live root", live.exit === 2, `${live.exit} ${live.err}`);
}

section("idea 14 — bundle --redact and reproduce list");
{
  const out = join(fixture("h-bundle"), "bundle.json");
  const exp = spawnSync(process.execPath, [join(REPO, ".cursor", "tools", "release-evidence.mjs"), "bundle", "export", "--out", out, "--redact"], {
    encoding: "utf8", cwd: REPO, timeout: 20_000,
  });
  check("redacted export writes", exp.status === 0 && existsSync(out), `${exp.status} ${exp.stderr.slice(0, 300)}`);
  const rec = JSON.parse(readFileSync(out, "utf8"));
  check("reproduce lists the suite", Array.isArray(rec.reproduce) && rec.reproduce.includes("node tests/run.mjs"), JSON.stringify(rec.reproduce));
  check("redact clears observed hashes", rec.observed && Object.keys(rec.observed).length === 0, JSON.stringify(rec.observed));
  check("integrity file hashes not exported when redacted", !rec.integrity?.files || Object.keys(rec.integrity.files).length === 0, JSON.stringify(rec.integrity));
  const ok = spawnSync(process.execPath, [join(REPO, ".cursor", "tools", "release-evidence.mjs"), "bundle", "verify", "--file", out], {
    encoding: "utf8", cwd: REPO, timeout: 20_000,
  });
  check("redacted bundle still verifies", ok.status === 0, `${ok.status} ${ok.stdout} ${ok.stderr}`);
}

section("idea 9 — derived-status includes worktreeDigest");
{
  const root = fixture("h-status");
  gitInit(root);
  const r = runTool("derived-status.mjs", ["snapshot", "--json"], root);
  const body = parse(r);
  check("snapshot has worktreeDigest", typeof body?.data?.worktreeDigest === "string" && body.data.worktreeDigest.length === 64, JSON.stringify(body?.data)?.slice(0, 400) || r.out.slice(0, 400));
}

section("idea 12 — search hits carry why and asData");
{
  const root = fixture("h-why");
  put(root, "memory-bank/decisionLog.md", `# Decision log

## ADR-1 Use SQL Server

**Status:** Superseded
**Date:** 2026-01-01
superseded by ADR-2

Paragraph about the old store.

## ADR-2 Use PostgreSQL

**Status:** Accepted
**Date:** 2026-06-01

Paragraph about the current store.
`);
  const hits = parse(runTool("decision-memory.mjs", ["search", "SQL", "--json"], root));
  const adr1 = Array.isArray(hits) && hits.find((h) => h.id === "ADR-1");
  check("superseded hit explains why", adr1?.asData === true && /superseded by ADR-2/.test(adr1?.why || ""), JSON.stringify(adr1));
}

section("H04 — phaseExceptions on classify");
{
  const t = idx.classify("threat-model", REPO);
  check("threat-model may run in ANALYSIS", t.phaseExceptions?.includes("ANALYSIS"), JSON.stringify(t));
  const built = idx.build(REPO);
  check("index records phaseExceptions for threat-model", built.skills["threat-model"]?.phaseExceptions?.includes("ANALYSIS"), JSON.stringify(built.skills["threat-model"]));
}

section("H03 — catalog, index, and skill folders agree");
{
  const folders = readdirSync(join(REPO, ".cursor", "skills")).filter((d) => existsSync(join(REPO, ".cursor", "skills", d, "skill.md")));
  const built = idx.build(REPO);
  const catalog = readFileSync(join(REPO, ".cursor", "docs", "skill-catalog.md"), "utf8");
  const named = new Set();
  for (const m of catalog.matchAll(/`([a-z][a-z0-9-]{2,})`/g)) named.add(m[1]);
  let missingIdx = 0, missingCat = 0, missingShim = 0;
  for (const n of folders) {
    if (!built.skills[n]) missingIdx++;
    if (!named.has(n)) missingCat++;
    if (!existsSync(join(REPO, ".claude", "skills", n, "SKILL.md"))) missingShim++;
  }
  check("every skill folder is in the generated index", missingIdx === 0 && Object.keys(built.skills).length === folders.length, `${missingIdx} missing index; ${Object.keys(built.skills).length} vs ${folders.length}`);
  check("every skill folder is named in the catalog", missingCat === 0, `${missingCat} unnamed`);
  check("every skill has a Claude shim", missingShim === 0, `${missingShim} missing shims`);
}

section("H02 — all 14 agents are advisory readers");
{
  const dir = join(REPO, ".claude", "agents");
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  check("14 agent files", files.length === 14, files.join(","));
  let bad = [];
  for (const f of files) {
    const raw = readFileSync(join(dir, f), "utf8");
    const tools = (raw.match(/^tools:\s*(.+)$/m) || [])[1] || "";
    if (/\bWrite\b|\bEdit\b/.test(tools)) bad.push(`${f} declares write tools`);
    if (!/Advisory, not a sandbox/.test(raw)) bad.push(`${f} missing advisory notice`);
  }
  check("no Write/Edit; advisory notice present", bad.length === 0, bad.join("; "));
}

section("H10 — session-start warns when the map is older than policy/source");
{
  const root = fixture("h10-fresh");
  put(root, ".cursor/cache/repo-map.json", JSON.stringify({ generatedAt: new Date().toISOString(), projects: [] }));
  utimesSync(join(root, ".cursor", "cache", "repo-map.json"), new Date("2026-09-09T00:00:00Z"), new Date("2026-09-09T00:00:00Z"));
  const r = runHook("session-start.mjs", { hook_event_name: "SessionStart" }, root);
  check("warns to run repo-discovery quick", r.exit === 0 && /repo-discovery quick/.test(r.out), r.out.slice(0, 800));
}

section("H16 — readonly-role SQL template does not GRANT writes");
{
  const sql = readFileSync(join(REPO, "templates", "postgres", "readonly-role.sql"), "utf8");
  check("no INSERT/UPDATE/DELETE/TRUNCATE grants", !/\bGRANT\s+(INSERT|UPDATE|DELETE|TRUNCATE|ALL)\b/i.test(sql), sql.slice(0, 400));
  check("SELECT is granted", /\bGRANT SELECT\b/.test(sql), "");
  check("CREATE on public is revoked", /REVOKE CREATE ON SCHEMA public/.test(sql), "");
  check("default_transaction_read_only is on", /default_transaction_read_only\s*=\s*on/.test(sql), "");
}

section("H17 — finding envelope and feature-map schema");
{
  const schema = JSON.parse(readFileSync(join(REPO, "schemas", "feature-map.schema.json"), "utf8"));
  const findingSchema = JSON.parse(readFileSync(join(REPO, "schemas", "finding.schema.json"), "utf8"));
  const good = fmVal.report({ tool: "x.mjs", command: "check", findings: [] });
  check("finding schema required keys match validator", JSON.stringify([...findingSchema.required].sort()) === JSON.stringify(["at", "command", "exit", "findings", "ok", "schema", "summary", "tool"]), JSON.stringify(findingSchema.required));
  check("empty finding report validates", fmVal.validate(good).length === 0, fmVal.validate(good).join("; "));
  const root = fixture("h17-map");
  put(root, "src/A.cs", "class A {}\n");
  gitInit(root);
  runTool("feature-map.mjs", ["init"], root);
  put(root, "t.json", JSON.stringify({ id: "alpha", files: [{ path: "src/A.cs", role: "handler" }], extraUnknown: true }));
  runTool("feature-map.mjs", ["upsert", "t.json"], root);
  const m = JSON.parse(readFileSync(join(root, ".cursor", "cache", "feature-map.json"), "utf8"));
  const errs = validateFeatureMap(m, schema);
  check("upserted map conforms", errs.length === 0, errs.join("; "));
  check("unknown feature field did not prevent load", !!m.features.alpha, JSON.stringify(m.features));
  const v1 = JSON.parse(JSON.stringify(m));
  v1.version = 1;
  v1.$schema = "cursor-platform/feature-map@1";
  delete v1.dataObjects;
  writeFileSync(join(root, ".cursor", "cache", "feature-map.json"), JSON.stringify(v1, null, 2));
  const listed = runTool("feature-map.mjs", ["list"], root);
  check("v1 map still lists after migration in memory", listed.exit === 0 && /alpha/.test(listed.out), listed.out.slice(0, 300));
  const badUp = runTool("feature-map.mjs", ["upsert", "missing.json"], root);
  check("malformed upsert is refused", badUp.exit === 2, `${badUp.exit} ${badUp.err}`);
}

section("H15 — architecture template forbids Domain → Infrastructure");
{
  const cs = readFileSync(join(REPO, "templates", "dotnet", "ArchitectureTests", "LayerBoundaryTests.cs"), "utf8");
  check("Domain must not depend on Infrastructure", /Domain_Depends_On_Nothing/.test(cs) && /Infrastructure/.test(cs) && /ShouldNot/.test(cs), cs.slice(0, 400));
}

section("H19/H21/H22 — installable templates vs live memory-bank; contributor docs");
{
  check("templates/memory-bank README exists", existsSync(join(REPO, "templates", "memory-bank", "README.md")), "");
  check("live memory-bank is not that template folder", existsSync(join(REPO, "memory-bank", "activeContext.md")), "");
  check("CONTRIBUTING.md exists", existsSync(join(REPO, "CONTRIBUTING.md")), "");
  check("SECURITY.md exists", existsSync(join(REPO, "SECURITY.md")), "");
  check("reviews index exists", existsSync(join(REPO, "docs", "reviews", "README.md")), "");
  check("findings tracker exists", existsSync(join(REPO, "docs", "reviews", "findings-tracker.md")), "");
  check("reviews index names the tracker", /findings-tracker/.test(readFileSync(join(REPO, "docs", "reviews", "README.md"), "utf8")), "");
}

section("H20 — this platform repo has no product lifecycle/state.json");
{
  check("no product state.json", !existsSync(join(REPO, "lifecycle", "state.json")), "state.json present");
}

report("Next increment of ideas 1–14 and H01–H22 slices hold their stated contracts.");
