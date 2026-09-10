#!/usr/bin/env node
/**
 * doctor.test.mjs — idea 3 first useful: read-only diagnose + copy preview.
 */

import { join } from "node:path";
import { mkdirSync, existsSync, readdirSync, cpSync } from "node:fs";
import { fixture, runTool, put, check, report, section, REPO } from "../_harness.mjs";

const parse = (r) => { try { return JSON.parse(r.out); } catch { return null; } };

function snapshot(root) {
  const out = [];
  const walk = (d, rel = "") => {
    let names;
    try { names = readdirSync(d); } catch { return; }
    for (const n of names.sort()) {
      const p = join(d, n);
      const r = rel ? `${rel}/${n}` : n;
      out.push(r);
      try {
        if (readdirSync(p)) walk(p, r);
      } catch { /* file */ }
    }
  };
  walk(root);
  return out.join("\n");
}

section("doctor.mjs diagnose — copy install, no writes");
{
  const root = fixture("doc-copy");
  mkdirSync(join(root, "src"), { recursive: true });
  const before = snapshot(root);
  const r = runTool("doctor.mjs", ["diagnose", "--json"], root);
  const body = parse(r);
  const after = snapshot(root);
  check("diagnose exits 0 on a copy fixture", r.exit === 0, `${r.exit} ${r.err.slice(0, 400)}`);
  check("install mode is copy", body?.data?.mode === "copy", JSON.stringify(body?.data));
  check("reports a finding-report schema", body?.schema === "finding-report/1" && body?.tool === "doctor.mjs", JSON.stringify(body)?.slice(0, 200));
  check("detects src as covered", body?.data?.layout?.covered?.includes("src"), JSON.stringify(body?.data?.layout));
  check("diagnose does not write files", before === after, `before ${before.length} after ${after.length}`);
}

section("doctor.mjs diagnose — unknown install, missing tools are not a block");
{
  const root = fixture("doc-unknown", { withTools: false });
  mkdirSync(join(root, ".cursor", "tools"), { recursive: true });
  for (const t of ["doctor.mjs", "_policy.mjs", "_findings.mjs", "_skills-index.mjs", "stack-profile.mjs"]) {
    cpSync(join(REPO, ".cursor", "tools", t), join(root, ".cursor", "tools", t));
  }
  const r = runTool("doctor.mjs", ["diagnose", "--json"], root);
  const body = parse(r);
  check("mode is unknown without lifecycle.mjs", body?.data?.mode === "unknown", JSON.stringify(body?.data));
  check("does not block when lifecycle is not adopted", r.exit === 0, `${r.exit} ${JSON.stringify(body?.findings?.map((f) => f.code))}`);
}

section("doctor.mjs preview — would-copy vs conflict, never copies");
{
  const root = fixture("doc-preview");
  put(root, "AGENTS.md", "local overlay\n");
  const before = snapshot(root);
  const r = runTool("doctor.mjs", ["preview", "--from", REPO, "--json"], root);
  const body = parse(r);
  const after = snapshot(root);
  check("preview exits 0", r.exit === 0, `${r.exit} ${r.err.slice(0, 300)}`);
  const entries = body?.data?.entries || [];
  const agents = entries.find((e) => e.path === "AGENTS.md");
  const schemas = entries.find((e) => e.path === "schemas");
  check("AGENTS.md that differs is a conflict", agents?.status === "conflict", JSON.stringify(agents));
  check("schemas missing is would-copy", schemas?.status === "would-copy", JSON.stringify(schemas));
  check("preview does not copy or write", before === after && !existsSync(join(root, "schemas")), `wrote schemas? ${existsSync(join(root, "schemas"))}`);
}

section("doctor.mjs usage");
{
  const root = fixture("doc-usage");
  const r = runTool("doctor.mjs", ["repair"], root);
  check("unknown command is usage exit 2", r.exit === 2 && /Usage/.test(r.err), `${r.exit} ${r.err.slice(0, 200)}`);
}

report("Doctor diagnoses and previews without writing.");
