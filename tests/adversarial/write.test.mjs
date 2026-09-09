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
    "lifecycle/integrity.json", "lifecycle/index.jsonl",
    ".cursor/tools/_state.mjs", ".cursor/tools/_evidence.mjs", ".cursor/tools/self-audit.mjs", ".cursor/tools/release-evidence.mjs",
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

  denies("Delete of integrity.json is refused", runHook(H, { ...write(join(root, "lifecycle/integrity.json")), tool_name: "Delete" }, root), "enforcement surface");
  denies("Delete of _evidence.mjs is refused", runHook(H, { ...write(join(root, ".cursor/tools/_evidence.mjs")), tool_name: "Delete" }, root), "enforcement surface");

  const noPolicy = install(fixture("gw-fallback", { writePolicy: false }));
  denies("with write-policy.json absent the fallback still protects a hook", runHook(H, write(join(noPolicy, ".claude/hooks/guard-mcp.mjs")), noPolicy), "enforcement surface");
  denies("with write-policy.json absent the fallback still protects integrity.json", runHook(H, write(join(noPolicy, "lifecycle/integrity.json")), noPolicy), "enforcement surface");
  denies("with write-policy.json absent the fallback still protects _evidence.mjs", runHook(H, write(join(noPolicy, ".cursor/tools/_evidence.mjs")), noPolicy), "enforcement surface");
}

section("guard-write.mjs — reading is not writing");
{
  // Cursor fires preToolUse for EVERY tool, and a Read payload carries the same
  // file_path a Write does. Without a read-tool exemption the hook refused to let
  // an agent read the very standards rule 00 tells it to read, and - after the
  // protected list landed - refused to let it read lifecycle.mjs at all.
  const root = install(fixture("gw-read"));
  const read = (file, tool = "Read") => ({ hook_event_name: "preToolUse", cursor_version: "1", workspace_roots: [root], tool_name: tool, tool_input: { file_path: file } });
  cursorAllows("Cursor: Read of a protected file is allowed", runHook(H, read(join(root, ".cursor/tools/lifecycle.mjs")), root));
  cursorAllows("Cursor: Read of a hook is allowed", runHook(H, read(join(root, ".claude/hooks/guard-mcp.mjs")), root));
  cursorAllows("Cursor: Read of a Tier 2 standard is allowed", runHook(H, read(join(root, "memory-bank/architecture.md")), root));
  cursorAllows("Cursor: Grep with a path is allowed", runHook(H, read(join(root, ".cursor/mcp-policy.json"), "Grep"), root));
  cursorAllows("Cursor: ReadLints with a path is allowed", runHook(H, read(join(root, ".cursor/mcp-policy.json"), "ReadLints"), root));
  allows("Claude Code: Read of a Tier 2 standard is allowed", runHook(H, { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: join(root, "memory-bank/architecture.md") } }, root));
  cursorDenies("...but an unknown tool carrying a file_path is still treated as a write", runHook(H, read(join(root, ".cursor/mcp-policy.json"), "Frobnicate"), root), "enforcement surface");
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

  // The answer must arrive EVERY time. `stdout.write(); exit()` lost the body
  // now and then on Windows pipes, and under failClosed a lost body is a denial
  // - the same call refused twice, then allowed unchanged. _lib.emit() writes
  // synchronously and exits after; this runs the allow path enough times that
  // the old race had a real chance to show.
  let silent = 0;
  const big = "x".repeat(4000);
  for (let i = 0; i < 40; i++) {
    const r = runHook(H, { ...cursorWrite(root, join(root, `docs/n${i}.md`)), tool_input: { file_path: join(root, `docs/n${i}.md`), content: big } }, root);
    if (!/"permission":"allow"/.test(r.out)) silent++;
  }
  check("Cursor: 40 consecutive allows, none silent", silent === 0, `${silent} of 40 answered with nothing on stdout`);
}

report("guard-write keeps the enforcement surface out of the agent's hands, and says allow out loud.");
