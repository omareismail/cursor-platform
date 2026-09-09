#!/usr/bin/env node
/**
 * run.mjs — every suite under tests/, in one command, one exit code.
 *
 * Suites are `*.test.mjs` files, found by walking tests/ so a new suite (or a new
 * folder of them, like tests/adversarial/) is picked up without touching CI. Each
 * runs in its own process, because a suite that calls process.exit must not take
 * the others with it, and a hang in one must not hide the rest.
 *
 * Usage:  node tests/run.mjs [--verbose] [filter]
 *         filter is a substring of the suite path, e.g. `adversarial` or `mcp`
 */

import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(HERE);
const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const filter = args.find((a) => !a.startsWith("--")) || "";

function suites(dir, out = []) {
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (!f.startsWith("_") && f !== "node_modules") suites(p, out); continue; }
    if (f.endsWith(".test.mjs")) out.push(p);
  }
  return out;
}

const all = suites(HERE).filter((p) => !filter || relative(REPO, p).replace(/\\/g, "/").includes(filter));
if (!all.length) { console.log(`no suites match ${JSON.stringify(filter)}`); process.exit(1); }

let failed = 0;
for (const s of all) {
  const rel = relative(REPO, s).replace(/\\/g, "/");
  console.log(`\n=== ${rel} ===`);
  const r = spawnSync(process.execPath, [s, ...(verbose ? ["--verbose"] : [])], { cwd: REPO, encoding: "utf8", stdio: "inherit", timeout: 300_000 });
  if (r.status !== 0) { failed++; console.log(`--- ${rel}: exit ${r.status}`); }
}

console.log(`\n${all.length} suite(s), ${failed} failed.`);
process.exit(failed ? 1 : 0);
