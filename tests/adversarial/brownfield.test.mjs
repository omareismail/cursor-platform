#!/usr/bin/env node
/**
 * brownfield.test.mjs — Phase E (E-22, E-23).
 *
 * E-22: feature-map schema v2 must load a v1 map, accept catalog objects
 * without files[], and walk lineage feature → proc → table → other feature.
 *
 * E-23: guard-phase must treat packages/, lib/, apps/, services/ as
 * application-source. status must name a detected root that no rule matches.
 */

import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fixture, runTool, runHook, put, gitInit, check, denies, allows, report, section, write } from "../_harness.mjs";

const ANALYSIS = {
  product: "fixture",
  mode: "new",
  phase: "ANALYSIS",
  schemaVersion: 3,
  revision: 0,
  phases: {},
  updated: "2026-01-01T00:00:00Z",
};

const parse = (r) => { try { return JSON.parse(r.out); } catch { return null; } };

function mapPath(root) {
  return join(root, ".cursor", "cache", "feature-map.json");
}

function stripSourceGlobs(root, match = ["src/**"]) {
  const p = join(root, ".cursor", "lifecycle", "write-policy.json");
  const policy = JSON.parse(readFileSync(p, "utf8"));
  const rule = (policy.rules || []).find((r) => r.id === "application-source");
  check("fixture has an application-source rule to strip", !!rule, JSON.stringify(policy.rules?.map((r) => r.id)));
  rule.match = match;
  writeFileSync(p, JSON.stringify(policy, null, 2));
}

section("feature-map.mjs — v1 maps still load; v2 objects upsert without files[]");
{
  const root = fixture("e22-v1");
  put(root, "src/Payments/Handler.cs", "public class Handler { }\n");
  gitInit(root);
  let r = runTool("feature-map.mjs", ["init"], root);
  check("init", r.exit === 0, r.err + r.out);
  put(root, "trace.json", JSON.stringify({
    id: "payments",
    name: "Payments",
    files: [{ path: "src/Payments/Handler.cs", role: "handler" }],
    dataTouched: { tables: ["Payments"] },
  }));
  r = runTool("feature-map.mjs", ["upsert", "trace.json"], root);
  check("v2 upsert of a feature", r.exit === 0, r.err + r.out);

  const m = JSON.parse(readFileSync(mapPath(root), "utf8"));
  m.version = 1;
  m.$schema = "cursor-platform/feature-map@1";
  delete m.dataObjects;
  if (m.index) delete m.index.byObject;
  writeFileSync(mapPath(root), JSON.stringify(m, null, 2));

  r = runTool("feature-map.mjs", ["list"], root);
  check("v1 map still lists the feature", r.exit === 0 && /payments/.test(r.out), `${r.exit} ${r.out} ${r.err}`);

  put(root, "objects.json", JSON.stringify({
    dataObjects: {
      "dbo.usp_Settle": {
        kind: "procedure",
        schema: "dbo",
        name: "usp_Settle",
        provider: "sqlserver",
        tables: ["Payments"],
        features: ["payments"],
      },
    },
  }));
  r = runTool("feature-map.mjs", ["upsert", "objects.json"], root);
  check("objects-only upsert (no files[]) succeeds", r.exit === 0 && /1 data object/.test(r.out), `${r.exit} ${r.out} ${r.err}`);
  const saved = JSON.parse(readFileSync(mapPath(root), "utf8"));
  check("save persists schema v2", saved.version === 2 && saved.dataObjects["dbo.usp_Settle"]?.kind === "procedure", JSON.stringify(saved.dataObjects));

  r = runTool("feature-map.mjs", ["query", "--object", "usp_Settle", "--json"], root);
  const hits = parse(r);
  check("query --object finds the proc and the feature", r.exit === 0 && Array.isArray(hits) && hits.includes("dbo.usp_Settle") && hits.includes("payments"), JSON.stringify(hits));
}

section("feature-map.mjs — lineage walks feature → proc → table → other feature");
{
  const root = fixture("e22-lin");
  put(root, "src/Settle/Handler.cs", "class SettleHandler {}\n");
  put(root, "src/Reports/Payout.cs", "class PayoutReport {}\n");
  gitInit(root);
  runTool("feature-map.mjs", ["init"], root);
  put(root, "settle.json", JSON.stringify({
    id: "settlement",
    name: "Settlement",
    files: [{ path: "src/Settle/Handler.cs", role: "handler" }],
    dataTouched: { tables: ["Payments"], objects: ["dbo.usp_Settle"] },
    lineage: { writes: ["Payments"], calls: ["dbo.usp_Settle"] },
  }));
  put(root, "report.json", JSON.stringify({
    id: "payout-report",
    name: "Payout report",
    files: [{ path: "src/Reports/Payout.cs", role: "handler" }],
    dataTouched: { tables: ["Payments"] },
  }));
  put(root, "catalog.json", JSON.stringify({
    dataObjects: {
      "dbo.usp_Settle": {
        kind: "procedure", schema: "dbo", name: "usp_Settle",
        tables: ["Payments"], features: ["settlement"],
      },
      "dbo.trg_Payments_Audit": {
        kind: "trigger", schema: "dbo", name: "trg_Payments_Audit",
        on: "Payments", tables: ["AuditLog"],
      },
    },
  }));
  check("upsert settlement", runTool("feature-map.mjs", ["upsert", "settle.json"], root).exit === 0, "");
  check("upsert payout-report", runTool("feature-map.mjs", ["upsert", "report.json"], root).exit === 0, "");
  check("upsert catalog objects", runTool("feature-map.mjs", ["upsert", "catalog.json"], root).exit === 0, "");

  const fromFeat = parse(runTool("feature-map.mjs", ["lineage", "settlement", "--json"], root));
  check("lineage from feature reaches the other feature via the table",
    fromFeat && fromFeat.features.includes("settlement") && fromFeat.features.includes("payout-report"),
    JSON.stringify(fromFeat));
  check("...and the proc and the trigger on that table",
    fromFeat && fromFeat.objects.includes("dbo.usp_Settle") && fromFeat.objects.includes("dbo.trg_Payments_Audit") && fromFeat.tables.includes("Payments"),
    JSON.stringify(fromFeat));

  const fromProc = parse(runTool("feature-map.mjs", ["lineage", "dbo.usp_Settle", "--json"], root));
  check("lineage from the proc reaches both features",
    fromProc && fromProc.features.includes("settlement") && fromProc.features.includes("payout-report"),
    JSON.stringify(fromProc));

  const fromTable = parse(runTool("feature-map.mjs", ["lineage", "Payments", "--json"], root));
  check("lineage from the table name reaches both features and the proc",
    fromTable && fromTable.features.includes("payout-report") && fromTable.objects.includes("dbo.usp_Settle"),
    JSON.stringify(fromTable));
}

section("feature-map.mjs — one-sided links and definition-file freshness");
{
  const root = fixture("e22-oneside");
  put(root, "src/Settle/Handler.cs", "class SettleHandler {}\n");
  put(root, "db/settle.sql", "CREATE PROC usp_Settle AS SELECT 1 FROM Payments;\n");
  gitInit(root);
  runTool("feature-map.mjs", ["init"], root);
  put(root, "settle.json", JSON.stringify({
    id: "settlement",
    name: "Settlement",
    files: [{ path: "src/Settle/Handler.cs", role: "handler" }],
    lineage: { calls: ["dbo.usp_Settle"] },
  }));
  put(root, "catalog.json", JSON.stringify({
    dataObjects: {
      "dbo.usp_Settle": {
        kind: "procedure", schema: "dbo", name: "usp_Settle",
        tables: ["Payments"],
        definitionFiles: ["db/settle.sql"],
      },
    },
  }));
  check("upsert caller without duplicating tables", runTool("feature-map.mjs", ["upsert", "settle.json"], root).exit === 0, "");
  check("upsert catalog without duplicating features[]", runTool("feature-map.mjs", ["upsert", "catalog.json"], root).exit === 0, "");

  const qObj = parse(runTool("feature-map.mjs", ["query", "--object", "dbo.usp_Settle", "--json"], root));
  check("query --object still finds the caller", Array.isArray(qObj) && qObj.includes("settlement"), JSON.stringify(qObj));
  const fromProc = parse(runTool("feature-map.mjs", ["lineage", "dbo.usp_Settle", "--json"], root));
  check("lineage from proc reaches the caller without a duplicate features[]",
    fromProc && fromProc.features.includes("settlement") && fromProc.tables.includes("Payments"),
    JSON.stringify(fromProc));
  const fromTable = parse(runTool("feature-map.mjs", ["lineage", "Payments", "--json"], root));
  check("lineage from catalog table reaches the proc and its caller",
    fromTable && fromTable.objects.includes("dbo.usp_Settle") && fromTable.features.includes("settlement"),
    JSON.stringify(fromTable));

  let v = runTool("feature-map.mjs", ["verify"], root);
  check("verify is fresh before the definition changes", v.exit === 0 && /fresh/.test(v.out), v.out + v.err);

  put(root, "db/settle.sql", "CREATE PROC usp_Settle AS SELECT 1 FROM OtherAccounts;\n");
  v = runTool("feature-map.mjs", ["verify"], root);
  check("changing the proc definition stales the consumer", v.exit === 1 && /STALE/.test(v.out) && /settlement/.test(v.out) && /settle\.sql/.test(v.out), v.out + v.err);

  const byFile = parse(runTool("feature-map.mjs", ["query", "--file", "db/settle.sql", "--json"], root));
  check("query --file hits the object and the caller",
    Array.isArray(byFile) && byFile.includes("dbo.usp_Settle") && byFile.includes("settlement"),
    JSON.stringify(byFile));
}

section("feature-map.mjs — short-name callers reverse to the canonical object");
{
  const root = fixture("e22-alias");
  put(root, "src/Settle/Handler.cs", "class SettleHandler {}\n");
  gitInit(root);
  runTool("feature-map.mjs", ["init"], root);
  put(root, "settle.json", JSON.stringify({
    id: "settlement",
    name: "Settlement",
    files: [{ path: "src/Settle/Handler.cs", role: "handler" }],
    lineage: { calls: ["usp_Settle"] },
  }));
  put(root, "catalog.json", JSON.stringify({
    dataObjects: {
      "dbo.usp_Settle": {
        kind: "procedure", schema: "dbo", name: "usp_Settle",
        tables: ["Payments"],
      },
    },
  }));
  check("upsert short-name caller", runTool("feature-map.mjs", ["upsert", "settle.json"], root).exit === 0, "");
  check("upsert unique catalog object", runTool("feature-map.mjs", ["upsert", "catalog.json"], root).exit === 0, "");

  const fromShort = parse(runTool("feature-map.mjs", ["lineage", "usp_Settle", "--json"], root));
  check("forward lineage from the short name reaches the proc and caller",
    fromShort && fromShort.features.includes("settlement") && fromShort.objects.includes("dbo.usp_Settle"),
    JSON.stringify(fromShort));
  const fromCanon = parse(runTool("feature-map.mjs", ["lineage", "dbo.usp_Settle", "--json"], root));
  check("reverse lineage from the canonical id reaches the short-name caller",
    fromCanon && fromCanon.features.includes("settlement") && fromCanon.objects.includes("dbo.usp_Settle"),
    JSON.stringify(fromCanon));
  const qCanon = parse(runTool("feature-map.mjs", ["query", "--object", "dbo.usp_Settle", "--json"], root));
  check("query --object canonical id includes the short-name caller",
    Array.isArray(qCanon) && qCanon.includes("settlement") && qCanon.includes("dbo.usp_Settle"),
    JSON.stringify(qCanon));
}

section("feature-map.mjs — ambiguous short names are refused");
{
  const root = fixture("e22-ambig");
  put(root, "src/Settle/Handler.cs", "class SettleHandler {}\n");
  gitInit(root);
  runTool("feature-map.mjs", ["init"], root);
  put(root, "catalog.json", JSON.stringify({
    dataObjects: {
      "dbo.usp_Settle": { kind: "procedure", schema: "dbo", name: "usp_Settle" },
      "other.usp_Settle": { kind: "procedure", schema: "other", name: "usp_Settle" },
    },
  }));
  check("two same-name objects upsert", runTool("feature-map.mjs", ["upsert", "catalog.json"], root).exit === 0, "");
  put(root, "settle.json", JSON.stringify({
    id: "settlement",
    name: "Settlement",
    files: [{ path: "src/Settle/Handler.cs", role: "handler" }],
    lineage: { calls: ["usp_Settle"] },
  }));
  const r = runTool("feature-map.mjs", ["upsert", "settle.json"], root);
  check("ambiguous short name is refused",
    r.exit === 2 && /schema-qualified/.test(r.err) && /dbo\.usp_Settle/.test(r.err) && /other\.usp_Settle/.test(r.err),
    `${r.exit} ${r.out} ${r.err}`);
  const fromCanon = parse(runTool("feature-map.mjs", ["lineage", "dbo.usp_Settle", "--json"], root));
  check("refused upsert did not index the caller under one schema",
    !fromCanon?.features?.includes("settlement"),
    JSON.stringify(fromCanon));
}

section("guard-phase.mjs — monorepo roots are application-source");
{
  const adopted = fixture("e23-roots", { state: ANALYSIS });
  for (const rel of ["packages/pkg/A.cs", "lib/Foo.ts", "apps/web/App.tsx", "services/api/H.cs"]) {
    denies(`denies ${rel} before DESIGN`, runHook("guard-phase.mjs", write(join(adopted, rel)), adopted), "BLOCKED");
  }
  allows("docs are still not gated", runHook("guard-phase.mjs", write(join(adopted, "docs/analysis.md")), adopted));

  const builtin = fixture("e23-builtin", { state: ANALYSIS, writePolicy: false });
  denies("BUILTIN fallback denies packages/ when write-policy.json is absent",
    runHook("guard-phase.mjs", write(join(builtin, "packages/pkg/A.cs")), builtin), "BLOCKED");
}

section("lifecycle.mjs status — layout hint when a root is unguarded");
{
  const uncovered = fixture("e23-hint", { state: ANALYSIS });
  mkdirSync(join(uncovered, "packages"), { recursive: true });
  mkdirSync(join(uncovered, "src"), { recursive: true });
  stripSourceGlobs(uncovered, ["src/**"]);
  let r = runTool("lifecycle.mjs", ["status", "--json"], uncovered);
  let body = parse(r);
  check("status --json includes layout", r.exit === 0 && body?.layout, `${r.exit} ${r.out.slice(0, 300)}`);
  check("packages is detected and uncovered under a src-only policy",
    body.layout.detected.includes("packages") && body.layout.uncovered.includes("packages") && body.layout.covered.includes("src"),
    JSON.stringify(body?.layout));
  r = runTool("lifecycle.mjs", ["status"], uncovered);
  check("text status names the unguarded root", /packages/.test(r.out) && /not phase-gated/.test(r.out), r.out.slice(0, 800));

  const covered = fixture("e23-covered", { state: ANALYSIS });
  mkdirSync(join(covered, "packages"), { recursive: true });
  mkdirSync(join(covered, "src"), { recursive: true });
  r = runTool("lifecycle.mjs", ["status", "--json"], covered);
  body = parse(r);
  check("default policy covers packages", r.exit === 0 && body.layout.detected.includes("packages") && !body.layout.uncovered.includes("packages") && body.layout.covered.includes("packages"),
    JSON.stringify(body?.layout));

  const exempted = fixture("e23-exempt", { state: ANALYSIS });
  mkdirSync(join(exempted, "packages"), { recursive: true });
  const polPath = join(exempted, ".cursor", "lifecycle", "write-policy.json");
  const pol = JSON.parse(readFileSync(polPath, "utf8"));
  pol.alwaysAllow = [...(pol.alwaysAllow || []), "packages/**"];
  writeFileSync(polPath, JSON.stringify(pol, null, 2));
  r = runTool("lifecycle.mjs", ["status", "--json"], exempted);
  body = parse(r);
  check("alwaysAllow packages is exempt, not gated",
    body?.layout?.exempt?.includes("packages") && !body.layout.covered.includes("packages"),
    JSON.stringify(body?.layout));
  allows("hook allows packages write when alwaysAllow lists it",
    runHook("guard-phase.mjs", write(join(exempted, "packages/pkg/A.cs")), exempted));

  const noPol = fixture("e23-nopol", { state: ANALYSIS, writePolicy: false });
  mkdirSync(join(noPol, "packages"), { recursive: true });
  r = runTool("lifecycle.mjs", ["status", "--json"], noPol);
  body = parse(r);
  check("missing local policy still treats packages as gated (builtin)",
    body?.layout?.covered?.includes("packages") && !body.layout.uncovered.includes("packages"),
    JSON.stringify(body?.layout));
}

section("lifecycle.mjs check — a packages-only tree is application source");
{
  const root = fixture("e23-pkg-only", { state: { ...ANALYSIS, phase: "DEVELOPMENT" } });
  put(root, "packages/api/main.ts", "export const x = 1;\n");
  gitInit(root);
  const r = runTool("lifecycle.mjs", ["check", "DEVELOPMENT", "--json"], root);
  const body = parse(r);
  const src = (body?.artifacts || []).find((a) => a.type === "source-tree");
  check("packages-only source-tree is present",
    src && src.ok && Array.isArray(src.resolved) && src.resolved.includes("packages"),
    JSON.stringify(src || body));
}

report("Phase E: v1 maps load, lineage walks objects, monorepo roots are gated.");
