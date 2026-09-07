#!/usr/bin/env node
// Stop - the last line of defence for AGENTS.md "After significant work".
// If source files changed this session but memory-bank/activeContext.md did not,
// the next session starts blind. Nudge once, then allow the stop.

import { execFileSync } from "node:child_process";
import { readPayload, projectDir, ok } from "./_lib.mjs";

const p = await readPayload();
if (p.stop_hook_active) ok(); // already nudged once - do not loop

const git = (args) => {
  try {
    return execFileSync("git", args, { cwd: projectDir(), stdio: "pipe", timeout: 15_000 }).toString();
  } catch { return null; }
};

const status = git(["status", "--porcelain"]);
if (status === null) ok(); // not a git repo

const changed = status.split("\n").map(l => l.slice(3).trim()).filter(Boolean);
const SOURCE = /\.(cs|csproj|tsx?|jsx?|sql|razor|json|ya?ml)$/i;
const source = changed.filter(f => SOURCE.test(f) && !f.startsWith("memory-bank/") && !f.startsWith(".claude/"));
const memoryTouched = changed.some(f => /^memory-bank\/(activeContext|progress)\.md$/.test(f));

if (source.length >= 2 && !memoryTouched) {
  process.stderr.write(
`${source.length} source files changed this session but memory-bank/activeContext.md
and progress.md were not updated. AGENTS.md requires this - without it the next
session cannot see what you did.

Changed: ${source.slice(0, 8).join(", ")}${source.length > 8 ? `, +${source.length - 8} more` : ""}

Update memory-bank/activeContext.md (what changed, which files, next step) and
memory-bank/progress.md (status transitions, new blockers), then stop.
`);
  process.exit(2);
}
ok();
