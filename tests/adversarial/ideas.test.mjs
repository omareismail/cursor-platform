#!/usr/bin/env node
/**
 * ideas.test.mjs — first-useful slices of ideas 4–14 (and leftovers of 2–3, 6–9).
 */

import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fixture, check, report, section, REPO, runTool, runHook, put, write, denies } from "../_harness.mjs";

const parse = (r) => { try { return JSON.parse(r.out); } catch { return null; } };
const gitSha = (root, rel) => spawnSync("git", ["hash-object", rel], { cwd: root, encoding: "utf8" }).stdout.trim();

section("_policy.mjs simulate — newly-allowed / newly-refused");
{
  const root = fixture("idea-sim");
  const policy = await import(new URL(`file:///${join(REPO, ".cursor", "tools", "_policy.mjs").replace(/\\/g, "/")}`));
  const proposed = JSON.parse(JSON.stringify(policy.BUILTIN_WRITE_POLICY));
  proposed.rules[0].match = proposed.rules[0].match.filter((g) => g !== "packages/**");
  put(root, "proposed.json", JSON.stringify(proposed, null, 2));
  const r = runTool("_policy.mjs", ["simulate", "--proposed", "proposed.json", "--json"], root);
  const body = parse(r);
  check("simulate exits 0", r.exit === 0, `${r.exit} ${r.err.slice(0, 300)}`);
  check("dropping packages/** is newly-allowed for packages/Lib/A.cs",
    body?.newlyAllowed?.some((row) => row.path === "packages/Lib/A.cs"),
    JSON.stringify(body?.newlyAllowed));
  const tighten = JSON.parse(JSON.stringify(policy.BUILTIN_WRITE_POLICY));
  tighten.alwaysAllow = (tighten.alwaysAllow || []).filter((g) => g !== "tests/**");
  tighten.rules[0].match.push("tests/**");
  tighten.rules[0].extensions = [...(tighten.rules[0].extensions || []), ".mjs"];
  put(root, "tighten.json", JSON.stringify(tighten, null, 2));
  const t = runTool("_policy.mjs", ["simulate", "--proposed", "tighten.json", "--json"], root);
  const tb = parse(t);
  check("gating tests/** is newly-refused for tests/foo.test.mjs",
    tb?.newlyRefused?.some((row) => row.path === "tests/foo.test.mjs"),
    JSON.stringify(tb?.newlyRefused));
}

section("feature-map edges both directions + stale when the file hash moves");
{
  const root = fixture("idea-edges");
  put(root, "src/Pay/Handler.cs", "class PayHandler {}\n");
  put(root, "tests/Pay.Tests.cs", "class PayTests {}\n");
  const sha = gitSha(root, "src/Pay/Handler.cs");
  const map = {
    $schema: "cursor-platform/feature-map@2",
    version: 2,
    features: {
      pay: {
        id: "pay",
        files: [
          { path: "src/Pay/Handler.cs", sha, role: "handler" },
          { path: "tests/Pay.Tests.cs", sha: gitSha(root, "tests/Pay.Tests.cs"), role: "test" },
        ],
        lineage: { calls: ["dbo.usp_Pay"] },
        tracedAt: new Date().toISOString(),
      },
    },
    dataObjects: {
      "dbo.usp_Pay": {
        kind: "procedure",
        dataSource: "sqlserver-primary",
        features: ["pay"],
        tables: ["Pay"],
      },
    },
    index: {
      byFile: { "src/Pay/Handler.cs": ["pay"], "tests/Pay.Tests.cs": ["pay"] },
      byObject: { "dbo.usp_Pay": ["pay"] },
      byTable: {}, byEndpoint: {}, byFlag: {},
    },
  };
  put(root, ".cursor/cache/feature-map.json", JSON.stringify(map, null, 2));
  const edges = runTool("feature-map.mjs", ["edges", "--json"], root);
  const elist = parse(edges);
  check("forward feature-calls edge exists", Array.isArray(elist) && elist.some((e) => e.kind === "feature-calls" && e.from === "pay" && e.to === "dbo.usp_Pay"), edges.out.slice(0, 400));
  check("reverse object-called-by edge exists", Array.isArray(elist) && elist.some((e) => e.kind === "object-called-by" && e.from === "dbo.usp_Pay" && e.to === "pay"), edges.out.slice(0, 400));
  const impact = runTool("feature-map.mjs", ["impact", "--file", "src/Pay/Handler.cs", "--json"], root);
  const ib = parse(impact);
  check("impact traces the feature and names the test", ib?.coverage === "traced" && ib?.tests?.includes("tests/Pay.Tests.cs"), impact.out.slice(0, 400));
  put(root, "src/Pay/Handler.cs", "class PayHandler { /* changed */ }\n");
  const stale = parse(runTool("feature-map.mjs", ["edges", "--json"], root));
  check("changed file marks the feature-calls edge stale",
    Array.isArray(stale) && stale.some((e) => e.kind === "feature-calls" && e.stale === true),
    JSON.stringify(stale)?.slice(0, 400));
}

section("identity.mjs — digest mismatch and unauthorized identity");
{
  const root = fixture("idea-id");
  put(root, ".cursor/identity.json", JSON.stringify({ identities: { alice: { roles: ["reviewer"] } } }, null, 2));
  const mismatch = runTool("identity.mjs", ["verify", "--by", "alice", "--digest", "aaa", "--expect", "bbb", "--mapping", ".cursor/identity.json", "--json"], root);
  const mb = parse(mismatch);
  check("digest mismatch is a block", mismatch.exit === 1 && mb?.findings?.some((f) => f.code === "digest-mismatch"), mismatch.out.slice(0, 400));
  const unauth = runTool("identity.mjs", ["verify", "--by", "bob", "--digest", "aaa", "--mapping", ".cursor/identity.json", "--json"], root);
  const ub = parse(unauth);
  check("unknown identity is a block", unauth.exit === 1 && ub?.findings?.some((f) => f.code === "unauthorized-identity"), unauth.out.slice(0, 400));
}

section("repair.mjs apply + rollback in isolated --out");
{
  const root = fixture("idea-repair");
  const dest = join(root, "isolated");
  mkdirSync(dest, { recursive: true });
  const livePolicy = join(root, ".cursor", "lifecycle", "write-policy.json");
  const before = existsSync(livePolicy) ? readFileSync(livePolicy, "utf8") : null;
  const apply = runTool("repair.mjs", ["apply", "write-policy-missing", "--out", dest, "--json"], root);
  const ab = parse(apply);
  check("apply writes into --out", apply.exit === 0 && existsSync(join(dest, ".cursor", "lifecycle", "write-policy.json")), apply.out.slice(0, 400) + apply.err.slice(0, 200));
  check("apply refuses to mean the live root", ab?.ok === true && !String(ab?.out || dest).endsWith(root.replace(/\\/g, "/")), JSON.stringify(ab));
  check("live write-policy unchanged", before === null || readFileSync(livePolicy, "utf8") === before, "live policy mutated");
  const rb = runTool("repair.mjs", ["rollback", "--out", dest, "--json"], root);
  check("rollback exits 0", rb.exit === 0, rb.err.slice(0, 200));
  check("rollback removes the applied file when there was no prior copy",
    !existsSync(join(dest, ".cursor", "lifecycle", "write-policy.json")),
    "policy still present after rollback");
}

section("doctor.mjs repair detail + stack");
{
  const root = fixture("idea-doctor");
  put(root, ".cursor/lifecycle/write-policy.json", "{ not json");
  const r = runTool("doctor.mjs", ["diagnose", "--json"], root);
  const body = parse(r);
  const malformed = body?.findings?.find((f) => f.code === "policy-malformed");
  check("diagnose reports stack", !!body?.data?.stack?.id, JSON.stringify(body?.data?.stack));
  check("policy-malformed names a repair", typeof malformed?.detail?.repair === "string" && /repair\.mjs/.test(malformed.detail.repair), JSON.stringify(malformed));
}

section("change-verify.mjs names the full suite and does not auto-narrow");
{
  const root = fixture("idea-verify");
  const r = runTool("change-verify.mjs", ["recommend", "--json"], root);
  const body = parse(r);
  check("recommend exits 0", r.exit === 0, r.err.slice(0, 200));
  check("full suite is tests/run.mjs", body?.fullSuite === "node tests/run.mjs", JSON.stringify(body));
  check("automatic selection stays off", body?.compare?.automaticSelection === false, JSON.stringify(body?.compare));
}

section("derived-status.mjs propose does not write");
{
  const root = fixture("idea-status");
  put(root, "memory-bank/progress.md", "# Progress\n\nParagraph 1: real content about status so this is not a stub file.\n");
  const before = readFileSync(join(root, "memory-bank", "progress.md"), "utf8");
  const r = runTool("derived-status.mjs", ["propose"], root);
  const after = readFileSync(join(root, "memory-bank", "progress.md"), "utf8");
  check("propose prints a derived block", /derived-status/.test(r.out), r.out.slice(0, 300));
  check("propose does not write progress.md", before === after, "progress.md changed");
}

section("build-plugin.mjs upgrade-preview added/changed");
{
  const root = fixture("idea-upgrade");
  put(root, "old/README.md", "v1\n");
  put(root, "old/keep.txt", "same\n");
  put(root, "new/README.md", "v2\n");
  put(root, "new/keep.txt", "same\n");
  put(root, "new/extra.txt", "added\n");
  const r = runTool("build-plugin.mjs", ["upgrade-preview", "--from", "old", "--to", "new", "--json"], root);
  const body = parse(r);
  check("upgrade-preview exits 0", r.exit === 0, r.err.slice(0, 300));
  check("reports added extra.txt", body?.added?.includes("extra.txt"), JSON.stringify(body));
  check("reports changed README.md", body?.changed?.includes("README.md"), JSON.stringify(body));
}

section("release-evidence.mjs bundle export/verify");
{
  const root = fixture("idea-bundle");
  const out = join(root, "bundle.json");
  const exp = spawnSync(process.execPath, [join(REPO, ".cursor", "tools", "release-evidence.mjs"), "bundle", "export", "--out", out], {
    encoding: "utf8", cwd: REPO, timeout: 20_000,
  });
  check("bundle export writes a file", exp.status === 0 && existsSync(out), `${exp.status} ${exp.stderr.slice(0, 300)}`);
  const ok = spawnSync(process.execPath, [join(REPO, ".cursor", "tools", "release-evidence.mjs"), "bundle", "verify", "--file", out], {
    encoding: "utf8", cwd: REPO, timeout: 20_000,
  });
  check("bundle verify accepts an intact export", ok.status === 0 && /OK/.test(ok.stdout), `${ok.status} ${ok.stdout} ${ok.stderr}`);
  const rec = JSON.parse(readFileSync(out, "utf8"));
  rec.limitations = ["tampered"];
  writeFileSync(out, JSON.stringify(rec, null, 2));
  const bad = spawnSync(process.execPath, [join(REPO, ".cursor", "tools", "release-evidence.mjs"), "bundle", "verify", "--file", out], {
    encoding: "utf8", cwd: REPO, timeout: 20_000,
  });
  check("bundle verify detects an edited bundle", bad.status === 1 && /bundleHash mismatch/.test(bad.stderr + bad.stdout), `${bad.status} ${bad.stderr} ${bad.stdout}`);
}

section("decision-memory.mjs flags superseded entries");
{
  const root = fixture("idea-decisions");
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
  const r = runTool("decision-memory.mjs", ["search", "PostgreSQL", "--json"], root);
  const hits = parse(r);
  check("search finds ADR-2", Array.isArray(hits) && hits.some((h) => h.id === "ADR-2"), r.out.slice(0, 400));
  const listed = parse(runTool("decision-memory.mjs", ["list", "--json"], root));
  check("list flags ADR-1 as superseded", Array.isArray(listed) && listed.some((h) => h.id === "ADR-1" && h.supersededBy === "ADR-2"), JSON.stringify(listed)?.slice(0, 400));
}

section("guard-phase still gates packages/ via shared builtin");
{
  const ANALYSIS = {
    product: "fixture",
    mode: "new",
    phase: "ANALYSIS",
    schemaVersion: 3,
    revision: 0,
    phases: {},
    updated: "2026-01-01T00:00:00Z",
  };
  const root = fixture("idea-packages", { writePolicy: false, state: ANALYSIS });
  denies("builtin policy still blocks packages/*.cs before DESIGN",
    runHook("guard-phase.mjs", write(join(root, "packages", "pkg", "A.cs")), root), "BLOCKED");
}

report("First-useful slices of ideas 4–14 hold their stated contracts.");
