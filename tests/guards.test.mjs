#!/usr/bin/env node
/**
 * guards.test.mjs — do the guards actually refuse?
 *
 * WHY THIS EXISTS
 *
 * `self-audit.mjs` answers whether every control is REACHABLE: wired in both
 * hosts, present in the built plugin, pointing at a file that exists. It is a
 * static reader, and that is the right shape for it. But "wired" and "refuses"
 * are two different claims, and nothing checked the second one. Every guard in
 * this repository has only ever been tested by a human running it once, by
 * hand, on the day it was written.
 *
 * That is the same defect the platform exists to name, one level in. The guards
 * are this repository's product. A regex that stops matching is silent: the
 * hook still runs, still exits 0, and the thing it was written to stop now goes
 * through. Nothing prints. Nothing fails. The wiring audit still says PASS.
 *
 * WHAT IT COVERS, AND WHAT IT DOES NOT
 *
 * The cases here are the ones where a failure is both silent and expensive:
 *
 *   - the refusals themselves (Tier 2 writes, source before DESIGN, package
 *     installs, destructive git)
 *   - the EXEMPTIONS, because `--force-with-lease` is where a tightened regex
 *     quietly starts blocking legitimate work. (`npm ci` and a bare
 *     `npm install` are asserted as allowed too, but note that they never reach
 *     that rule's `exempt` at all — the main pattern does not match them. The
 *     exemption for them is dead code. Left in place because deleting a safety
 *     net to tidy up is how the net stops being there when the pattern widens.)
 *   - the FAIL-CLOSED path: guard-write still refuses when memory-bank.mjs
 *     cannot be imported at all
 *   - the DUAL-HOST output contract: Claude Code reads exit 2 and stderr,
 *     Cursor reads exit 0 and a JSON body. A guard that denies for one editor
 *     and not the other is invisible from inside either one.
 *
 * Not covered, deliberately: post-edit-verify.mjs and stop-memory-check.mjs,
 * which advise rather than refuse. Their failure mode is a missing suggestion,
 * not an unguarded write. Listing them here as untested is more honest than
 * writing a shallow assertion and calling the suite complete. guard-mcp.mjs has
 * its own suite, tests/adversarial/mcp.test.mjs, built around its policy file.
 *
 * HOW THIS SUITE WAS CHECKED
 *
 * By breaking each guard on purpose and confirming the suite went red: the
 * Tier 2 fallback losing a file, the npm rule reverted to its pre-fix form,
 * guard-phase no longer matching `src/`, the force-push exemption removed. The
 * first version of this file passed all of those — every hook was being run
 * from the real repository, so its imports reached the real tools and the
 * fail-closed case never actually occurred. A suite that cannot go red is a
 * green light wired to nothing.
 *
 * The bypass cases - the SQL that hid a DELETE in a CTE, the camelCase write
 * the MCP guard let through, the shell redirect into a policy file - live in
 * tests/adversarial/, one suite per guard, each case a regression test for a
 * confirmed hole.
 *
 * Usage:  node tests/guards.test.mjs [--verbose]     or   node tests/run.mjs
 * Exit:   0 = every guard refused what it should and allowed what it should
 *         1 = a guard did not
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// The fixture and the assertions live in _harness.mjs, shared with the
// adversarial suites. The hook is still run from INSIDE the fixture, never from
// this repository - see the harness for why.
import { fixture, runHook, write, bash, check, denies, allows, cursorAllows, report } from "./_harness.mjs";

/* --------------------------------------------------------- guard-write */

console.log("guard-write.mjs — Tier 2 is human-authored and agent-writable only on purpose");
{
  const root = fixture("gw");
  denies("Tier 2 write is refused", runHook("guard-write.mjs", write(join(root, "memory-bank/architecture.md")), root), "BLOCKED");
  allows("Tier 1 write is allowed", runHook("guard-write.mjs", write(join(root, "memory-bank/activeContext.md")), root));
  allows("source write is not this hook's business", runHook("guard-write.mjs", write(join(root, "src/Foo.cs")), root));

  // The escape hatch has to work, or the only way past the guard is to delete it.
  const esc = spawnSync(process.execPath, [join(root, ".claude", "hooks", "guard-write.mjs")], {
    input: JSON.stringify(write(join(root, "memory-bank/architecture.md"))),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_ALLOW_TIER2_EDIT: "1" },
    timeout: 20_000,
  });
  check("CLAUDE_ALLOW_TIER2_EDIT opens it deliberately", esc.status === 0,
    `expected exit 0 with the env var set; got ${esc.status}`);
}

console.log("\nguard-write.mjs — fail-closed when its canonical list is unreachable");
{
  // memory-bank.mjs owns the Tier 2 list; the hook keeps a hardcoded copy so a
  // broken import cannot turn the guard off. self-audit A9 checks the two agree;
  // this checks the fallback actually fires.
  const root = fixture("gw-noowner", { withTools: false });
  denies("still refuses with memory-bank.mjs absent", runHook("guard-write.mjs", write(join(root, "memory-bank/architecture.md")), root), "BLOCKED");
}

console.log("\nguard-write.mjs — the same refusal reaches Cursor");
{
  const root = fixture("gw-cursor");
  const res = runHook("guard-write.mjs", { ...write(join(root, "memory-bank/architecture.md")), cursor_version: "1.0.0", workspace_roots: [root] }, root);
  let body = null;
  try { body = JSON.parse(res.out); } catch { /* reported below */ }
  check("Cursor gets exit 0 and a deny body",
    res.exit === 0 && body && body.permission === "deny",
    `expected exit 0 with {"permission":"deny"} on stdout; got exit ${res.exit}, stdout ${JSON.stringify(res.out.slice(0, 160))}`);
}

/* --------------------------------------------------------- guard-phase */

console.log("\nguard-phase.mjs — source may not exist before the design gate clears");
{
  const notAdopted = fixture("gp-clean");
  allows("a repo with no lifecycle/state.json is not gated", runHook("guard-phase.mjs", write(join(notAdopted, "src/Payments/Handler.cs")), notAdopted));

  const adopted = fixture("gp-adopted");
  mkdirSync(join(adopted, "lifecycle"), { recursive: true });
  writeFileSync(join(adopted, "lifecycle", "state.json"), JSON.stringify({
    product: "fixture", mode: "new", phase: "ANALYSIS", approvals: {}, verdicts: {},
  }, null, 2));
  denies("source before DESIGN is refused", runHook("guard-phase.mjs", write(join(adopted, "src/Payments/Handler.cs")), adopted), "BLOCKED");
  allows("a document is not source", runHook("guard-phase.mjs", write(join(adopted, "docs/analysis.md")), adopted));
  const readSrc = { hook_event_name: "preToolUse", cursor_version: "1", workspace_roots: [adopted], tool_name: "Read", tool_input: { file_path: join(adopted, "src/Payments/Handler.cs") } };
  cursorAllows("Cursor: Read of src during REQUIREMENTS is not a write", runHook("guard-phase.mjs", readSrc, adopted));
  cursorAllows("...and guard-write agrees on the same payload", runHook("guard-write.mjs", readSrc, adopted));
}

/* ---------------------------------------------------------- guard-bash */

console.log("\nguard-bash.mjs — the refusals, and the exemptions that make them usable");
{
  const root = fixture("gb");
  const cases = [
    ["npm install lodash",                 true,  "a new npm package"],
    ["npm install --save lodash",           true,  "an install behind --save"],
    ["npm install -D typescript",           true,  "a dev dependency behind -D"],
    ["npm i --save-dev jest",               true,  "a dev dependency behind --save-dev"],
    ["yarn add -D vite",                    true,  "a yarn dev dependency"],
    ["pnpm add -w zod",                     true,  "a pnpm workspace dependency"],
    ["npm install --legacy-peer-deps",      false, "a flagged lockfile restore"],
    ["npm ci",                             false, "restoring the lockfile"],
    ["npm install",                        false, "install with no package named"],
    ["dotnet add package Serilog",         true,  "a new NuGet package"],
    ["dotnet ef database update",          true,  "a live database migration"],
    ["git push --force origin main",       true,  "a force push"],
    ["git push --force-with-lease origin main", false, "force-with-lease"],
    ["git push --force --force-with-lease origin main", true, "force plus force-with-lease"],
    ["git push origin +main",             true,  "a plus refspec"],
    ['git push origin "+main:main"',     true,  "a quoted plus refspec"],
    ["git push origin main --force",       true,  "force flag after the ref"],
    ['sh -c "git push --force origin main"', true, "nested sh -c force push"],
    ["git reset --hard HEAD~1",            true,  "a destructive reset"],
    ["dotnet build",                       false, "an ordinary build"],
  ];
  for (const [cmd, shouldBlock, why] of cases) {
    const res = runHook("guard-bash.mjs", bash(cmd), root);
    if (shouldBlock) denies(`blocks ${why}: ${cmd}`, res, "BLOCKED");
    else allows(`allows ${why}: ${cmd}`, res);
  }
}

/* -------------------------------------------------------------- report */

report();
