#!/usr/bin/env node
/**
 * policy.test.mjs — idea 2 first useful: shared source-root evaluator.
 *
 * `_policy.mjs` is the list lifecycle status and adopter CI consume.
 * guard-phase.mjs keeps a copy this slice (attested); the match globs must
 * equal SOURCE_ROOTS so the copy cannot silently diverge.
 */

import { join } from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import { fixture, runTool, check, report, section, REPO } from "../_harness.mjs";

const policy = await import(new URL(`file:///${join(REPO, ".cursor", "tools", "_policy.mjs").replace(/\\/g, "/")}`));
const lifecycle = await import(new URL(`file:///${join(REPO, ".cursor", "tools", "lifecycle.mjs").replace(/\\/g, "/")}`));

section("_policy.mjs — SOURCE_ROOTS is the shared list");
{
  check("lifecycle re-exports the same SOURCE_ROOTS", JSON.stringify(lifecycle.SOURCE_ROOTS) === JSON.stringify(policy.SOURCE_ROOTS), JSON.stringify({ lifecycle: lifecycle.SOURCE_ROOTS, policy: policy.SOURCE_ROOTS }));
  check("includes packages", policy.SOURCE_ROOTS.includes("packages"), JSON.stringify(policy.SOURCE_ROOTS));
  check("builtin application-source match is SOURCE_ROOTS/**", JSON.stringify(policy.BUILTIN_WRITE_POLICY.rules[0].match) === JSON.stringify(policy.SOURCE_ROOTS.map((d) => `${d}/**`)), JSON.stringify(policy.BUILTIN_WRITE_POLICY.rules[0].match));
}

section("_policy.mjs — CLI roots / layout");
{
  const root = fixture("pol-cli");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "packages"), { recursive: true });
  const roots = runTool("_policy.mjs", ["roots"], root);
  check("roots prints src and packages", roots.exit === 0 && /src/.test(roots.out) && /packages/.test(roots.out), roots.out);
  const layout = runTool("_policy.mjs", ["layout", "--json"], root);
  let body = null;
  try { body = JSON.parse(layout.out); } catch { /* reported below */ }
  check("layout --json detects src and packages", layout.exit === 0 && body?.detected?.includes("src") && body?.detected?.includes("packages"), layout.out.slice(0, 400));
  check("default policy covers both", body?.covered?.includes("src") && body?.covered?.includes("packages"), JSON.stringify(body));
}

section("guard-phase.mjs built-in match globs equal SOURCE_ROOTS");
{
  const gp = readFileSync(join(REPO, ".claude", "hooks", "guard-phase.mjs"), "utf8");
  const block = gp.match(/rules:\s*\[\s*\{[\s\S]*?match:\s*\[([^\]]+)\]/);
  const globs = block ? [...block[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
  check("extracted application-source match from the hook", globs.length === policy.SOURCE_ROOTS.length, JSON.stringify(globs));
  check("hook match globs are SOURCE_ROOTS.map(d => d/**)", JSON.stringify(globs) === JSON.stringify(policy.SOURCE_ROOTS.map((d) => `${d}/**`)), JSON.stringify(globs));
}

report("One source-root list; the attested hook copy still matches it.");
