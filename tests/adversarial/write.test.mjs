#!/usr/bin/env node
/**
 * write.test.mjs — guard-write.mjs against edits to the enforcement surface.
 *
 * Every hook, both wiring files, both policy files, the state machine and every
 * lifecycle record used to be writable by the same Write tool the hooks govern.
 * `unlisted: "allow"` was one Edit away. These cases pin the protected list and
 * the one deliberate escape, and check that "allow" is said out loud on Cursor
 * because a fail-closed hook that exits silently is a hook that failed.
 *
 * The hook under test is taken from CANDIDATE when that env var is set, so a new
 * version can be proven before it is installed - once it is installed it guards
 * its own file, and the next fix has to come from a human's editor.
 */

import { join } from "node:path";
import { cpSync, existsSync } from "node:fs";
import { fixture, runHook, write, cursorWrite, check, denies, allows, cursorDenies, cursorAllows, report, section } from "../_harness.mjs";

const H = "guard-write.mjs";
const install = (root) => { if (process.env.CANDIDATE && existsSync(process.env.CANDIDATE)) cpSync(process.env.CANDIDATE, join(root, ".claude", "hooks", H)); return root; };

section("guard-write.mjs — the enforcement surface is not the agent's to edit");
{
  const root = install(fixture("gw-protected"));
  for (const f of [
    ".claude/hooks/guard-mcp.mjs", ".claude/hooks/_lib.mjs", ".claude/hooks/_sql.mjs", ".claude/hooks/new-hook.mjs",
    ".claude/settings.json", ".cursor/hooks.json",
    ".cursor/mcp-policy.json", ".cursor/lifecycle/write-policy.json", ".cursor/lifecycle/gates/design.md",
    ".cursor/tools/lifecycle.mjs", ".mcp.json",
    "lifecycle/evidence/design-2026.json", "lifecycle/releases/v1.0.0.json", "lifecycle/overrides/OV-0001.json",
    "lifecycle/incidents/INC-0001.json", "lifecycle/changes/CR-0001.json", "lifecycle/fitness-baseline.json",
  ]) denies(`refuses: ${f}`, runHook(H, write(join(root, f)), root), "enforcement surface");

  denies("machine-owned: state.json keeps its own message", runHook(H, write(join(root, "lifecycle/state.json")), root), "owned\nby .cursor/tools/lifecycle.mjs");
  denies("machine-owned: repo-map.json keeps its own message", runHook(H, write(join(root, ".cursor/cache/repo-map.json")), root), "/repo-discovery");
  denies("machine-owned: feature-map.json keeps its own message", runHook(H, write(join(root, ".cursor/cache/feature-map.json")), root), "feature-map.mjs upsert");

  for (const f of ["docs/design/architecture.md", "specs/features/x.md", "src/Foo.cs", "tests/x.test.mjs", ".cursor/skills/foo/skill.md",
    ".cursor/rules/12-new.mdc", ".cursor/tools/other-tool.mjs", "memory-bank/activeContext.md", "README.md", "lifecycle/README.md"])
    allows(`allows: ${f}`, runHook(H, write(join(root, f)), root));

  // Windows spelling of the same file
  denies("backslashes do not hide a protected file", runHook(H, write(root + "\\.cursor\\mcp-policy.json"), root), "enforcement surface");

  // Every tool that writes, not only Write.
  for (const tool of ["Edit", "MultiEdit", "NotebookEdit", "Delete"]) {
    denies(`${tool} on a hook is refused`, runHook(H, { ...write(join(root, ".claude/hooks/guard-bash.mjs")), tool_name: tool }, root), "enforcement surface");
  }
  cursorDenies("Cursor's Delete tool with a `path` key is refused",
    runHook(H, { hook_event_name: "preToolUse", cursor_version: "1", workspace_roots: [root], tool_name: "Delete", tool_input: { path: join(root, ".cursor/mcp-policy.json") } }, root), "enforcement surface");

  allows("CURSOR_PLATFORM_DEV=1 lets a platform developer edit a hook", runHook(H, write(join(root, ".claude/hooks/guard-mcp.mjs")), root, { CURSOR_PLATFORM_DEV: "1" }));
  denies("...but never the machine-owned state file", runHook(H, write(join(root, "lifecycle/state.json")), root, { CURSOR_PLATFORM_DEV: "1" }), "owned");
  denies("...and CLAUDE_ALLOW_TIER2_EDIT is not the same escape", runHook(H, write(join(root, ".claude/hooks/guard-mcp.mjs")), root, { CLAUDE_ALLOW_TIER2_EDIT: "1" }), "enforcement surface");

  const noPolicy = install(fixture("gw-fallback", { writePolicy: false }));
  denies("with write-policy.json absent the fallback still protects a hook", runHook(H, write(join(noPolicy, ".claude/hooks/guard-mcp.mjs")), noPolicy), "enforcement surface");
  denies("with write-policy.json absent the fallback still protects the MCP policy", runHook(H, write(join(noPolicy, ".cursor/mcp-policy.json")), noPolicy), "enforcement surface");
}

section("guard-write.mjs — Cursor: deny is a body, allow is said out loud");
{
  const root = install(fixture("gw-cursor-adv"));
  cursorDenies("Cursor: a hook edit is denied", runHook(H, cursorWrite(root, join(root, ".claude/hooks/guard-mcp.mjs")), root), "enforcement surface");
  cursorDenies("Cursor: Delete of a policy is denied", runHook(H, cursorWrite(root, join(root, ".cursor/mcp-policy.json"), "Delete"), root), "enforcement surface");
  cursorAllows("Cursor: an ordinary write answers {permission:\"allow\"}", runHook(H, cursorWrite(root, join(root, "docs/x.md")), root));
  cursorAllows("Cursor: a payload that is not a file write still answers allow", runHook(H, { hook_event_name: "preToolUse", cursor_version: "1", workspace_roots: [root], tool_name: "Shell", tool_input: { command: "ls" } }, root));
  const advisory = runHook(H, { hook_event_name: "afterFileEdit", cursor_version: "1", workspace_roots: [root], file_path: join(root, "docs/x.md") }, root);
  check("Cursor: an advisory event gets no permission body", advisory.exit === 0 && advisory.out.trim() === "", `stdout: ${advisory.out}`);
}

report("guard-write keeps the enforcement surface out of the agent's hands, and says allow out loud.");
