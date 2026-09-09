/**
 * _harness.mjs — the fixture and assertion helpers every suite under tests/ shares.
 *
 * Every hook is run from INSIDE a throwaway fixture repository, never from this
 * one. A hook's imports (`../../.cursor/tools/lifecycle.mjs`, the policy files
 * beside it) resolve relative to its own location, so a hook executed from this
 * repo's `.claude/hooks/` would reach this repo's real tools and policies and
 * the fail-closed cases would never actually occur. That is the
 * fixture-built-to-match-the-code mistake, and it makes a green suite mean
 * nothing. The fixture copies in exactly what a real install has, and each case
 * decides what to leave out.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
export const VERBOSE = process.argv.includes("--verbose");

let pass = 0;
const failures = [];

/* ------------------------------------------------------------- fixtures */

const TMP = mkdtempSync(join(tmpdir(), "platform-tests-"));
process.on("exit", () => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });

const HOOKS = ["_lib.mjs", "_sql.mjs", "guard-write.mjs", "guard-phase.mjs", "guard-bash.mjs", "guard-mcp.mjs", "session-start.mjs"];
// lifecycle.mjs imports _state.mjs and lazily imports artifact-schema.mjs and
// ac-trace.mjs; release-evidence and change-request import lifecycle.mjs. A
// fixture that copied lifecycle.mjs alone would fail on the import and every
// state case would be testing the error path instead of the tool.
const TOOLS = ["memory-bank.mjs", "lifecycle.mjs", "_state.mjs", "_evidence.mjs", "_findings.mjs", "artifact-schema.mjs", "ac-trace.mjs", "release-evidence.mjs", "change-request.mjs", "incidents.mjs", "feature-map.mjs", "self-audit.mjs", "fitness.mjs", "failure-modes.mjs", "flag-debt.mjs", "risk-profile.mjs", "docs-lint.mjs", "_skills-index.mjs"];

/**
 * A project that has a memory bank, the hooks, and (by default) the tools and
 * policies they read.
 *
 *   withTools    copy the tools the hooks and each other import          (default true)
 *   mcpPolicy    object -> written as .cursor/mcp-policy.json
 *                "repo"  -> this repo's real policy               (default)
 *                "corrupt" -> a file that is not JSON
 *                null    -> no policy file at all
 *   writePolicy  copy .cursor/lifecycle/write-policy.json         (default true)
 *   gates        copy .cursor/lifecycle/gates/ and schemas/       (default false - record-gate needs them)
 *   state        object -> lifecycle/state.json; string -> written verbatim (for corrupt cases)
 */
export function fixture(name, { withTools = true, mcpPolicy = "repo", writePolicy = true, gates = false, state = undefined } = {}) {
  const root = join(TMP, name);
  mkdirSync(join(root, "memory-bank"), { recursive: true });
  mkdirSync(join(root, ".cursor", "tools"), { recursive: true });
  mkdirSync(join(root, ".cursor", "lifecycle"), { recursive: true });
  mkdirSync(join(root, ".claude", "hooks"), { recursive: true });
  for (const f of ["architecture.md", "activeContext.md"]) {
    writeFileSync(join(root, "memory-bank", f), "# " + f + "\n\nReal content, long enough to be more than a stub.\n");
  }
  for (const h of HOOKS) {
    const src = join(REPO, ".claude", "hooks", h);
    if (existsSync(src)) cpSync(src, join(root, ".claude", "hooks", h));
  }
  if (withTools) {
    for (const t of TOOLS) {
      const src = join(REPO, ".cursor", "tools", t);
      if (existsSync(src)) cpSync(src, join(root, ".cursor", "tools", t));
    }
  }
  if (gates) {
    cpSync(join(REPO, ".cursor", "lifecycle", "gates"), join(root, ".cursor", "lifecycle", "gates"), { recursive: true });
    cpSync(join(REPO, "schemas"), join(root, "schemas"), { recursive: true });
  }
  if (writePolicy) cpSync(join(REPO, ".cursor", "lifecycle", "write-policy.json"), join(root, ".cursor", "lifecycle", "write-policy.json"));
  if (mcpPolicy === "repo") cpSync(join(REPO, ".cursor", "mcp-policy.json"), join(root, ".cursor", "mcp-policy.json"));
  else if (mcpPolicy === "corrupt") writeFileSync(join(root, ".cursor", "mcp-policy.json"), "{ this is not json");
  else if (mcpPolicy && typeof mcpPolicy === "object") writeFileSync(join(root, ".cursor", "mcp-policy.json"), JSON.stringify(mcpPolicy, null, 2));
  if (state !== undefined) {
    mkdirSync(join(root, "lifecycle"), { recursive: true });
    writeFileSync(join(root, "lifecycle", "state.json"), typeof state === "string" ? state : JSON.stringify(state, null, 2));
  }
  return root;
}

/** This repo's real MCP policy, parsed, for cases that start from it and change one thing. */
export const repoMcpPolicy = () => JSON.parse(readFileSync(join(REPO, ".cursor", "mcp-policy.json"), "utf8"));

/* ---------------------------------------------------------------- running */

/**
 * Run one hook against one payload with `root` as the project. Extra env is
 * merged over a clean baseline that has every escape hatch unset, so a case has
 * to opt in to an escape to test it.
 */
export function runHook(hook, payload, root, env = {}) {
  const r = spawnSync(process.execPath, [join(root, ".claude", "hooks", hook)], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, LIFECYCLE_OVERRIDE: "", CLAUDE_ALLOW_TIER2_EDIT: "", CURSOR_PLATFORM_DEV: "", ...env },
    timeout: 20_000,
  });
  return { exit: r.status, out: r.stdout || "", err: r.stderr || "" };
}

/** Run a tool from the fixture's .cursor/tools/ with arguments. */
export function runTool(tool, args, root, env = {}) {
  const r = spawnSync(process.execPath, [join(root, ".cursor", "tools", tool), ...args], {
    encoding: "utf8", cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, ...env },
    timeout: 60_000,
  });
  return { exit: r.status, out: r.stdout || "", err: r.stderr || "" };
}

/** A real document: long enough, no template markers, no unfilled [slots]. */
export const DOC = (title) => `# ${title}\n\n` + Array.from({ length: 6 }, (_, i) => `Paragraph ${i + 1}: real content about ${title}, decided and written down so that a reviewer has something to judge.`).join("\n\n") + "\n";

/** Write a file under the fixture, creating directories. */
export function put(root, rel, content) {
  const abs = join(root, ...rel.split("/"));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

/** `git init` + one commit inside the fixture, so tools that read git have something to read. */
export function gitInit(root) {
  const g = (...a) => spawnSync("git", a, { cwd: root, encoding: "utf8" });
  g("init", "-q");
  g("config", "user.email", "fixture@test");
  g("config", "user.name", "fixture");
  g("add", "-A");
  g("commit", "-qm", "fixture", "--allow-empty");
}

/* -------------------------------------------------------------- payloads */

/** Claude Code shapes. */
export const write = (file, content = "") => ({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: file, content } });
export const bash = (command) => ({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });
export const mcp = (server, tool, input = {}) => ({ hook_event_name: "PreToolUse", tool_name: `mcp__${server}__${tool}`, tool_input: input });

/** Cursor shapes. tool_input on beforeMCPExecution is a JSON STRING. */
export const cursorWrite = (root, file, tool = "Write") => ({ hook_event_name: "preToolUse", cursor_version: "1.0.0", workspace_roots: [root], tool_name: tool, tool_input: { file_path: file } });
export const cursorBash = (root, command) => ({ hook_event_name: "beforeShellExecution", cursor_version: "1.0.0", workspace_roots: [root], command });
export const cursorMcp = (root, server, tool, input = {}) => ({ hook_event_name: "beforeMCPExecution", cursor_version: "1.0.0", workspace_roots: [root], mcp_server_name: server, tool_name: tool, tool_input: JSON.stringify(input) });

/* ------------------------------------------------------------ assertions */

export function check(name, cond, detail) {
  if (cond) { pass++; if (VERBOSE) console.log(`  ok    ${name}`); return; }
  failures.push({ name, detail });
  console.log(`  FAIL  ${name}\n        ${detail}`);
}

/** Claude Code's contract: a refusal is exit 2 with the reason on stderr. */
export function denies(name, res, needle = "BLOCKED") {
  check(name, res.exit === 2 && res.err.includes(needle),
    `expected exit 2 with ${JSON.stringify(needle)} on stderr; got exit ${res.exit}, stderr ${JSON.stringify(res.err.slice(0, 200))}`);
}
export function allows(name, res) {
  check(name, res.exit === 0,
    `expected exit 0 (allowed); got exit ${res.exit}, stderr ${JSON.stringify(res.err.slice(0, 200))}`);
}

/** Cursor's contract: exit 0 always; the verdict is a JSON body on stdout. */
export function cursorDenies(name, res, needle = "BLOCKED") {
  let body = null;
  try { body = JSON.parse(res.out); } catch { /* reported below */ }
  check(name, res.exit === 0 && body?.permission === "deny" && String(body.agent_message || "").includes(needle),
    `expected exit 0 with {"permission":"deny"} containing ${JSON.stringify(needle)}; got exit ${res.exit}, stdout ${JSON.stringify(res.out.slice(0, 200))}`);
}
export function cursorAllows(name, res) {
  let body = null;
  try { body = JSON.parse(res.out); } catch { /* reported below */ }
  check(name, res.exit === 0 && body?.permission === "allow",
    `expected exit 0 with {"permission":"allow"} - a fail-closed Cursor hook that says nothing is a hook that failed; got exit ${res.exit}, stdout ${JSON.stringify(res.out.slice(0, 200))}`);
}

export function section(title) { console.log(`\n${title}`); }

/** Print the summary and exit. */
export function report(what = "Every guard refused what it should and allowed what it should.") {
  console.log("");
  if (!failures.length) {
    console.log(`OK: ${pass} assertion(s). ${what}`);
    process.exit(0);
  }
  console.log(`FAILED: ${failures.length} of ${pass + failures.length} assertion(s).`);
  console.log(`A guard that is wired but does not refuse is worse than one that is missing:`);
  console.log(`the wiring audit still says PASS, and the thing it was written to stop goes through.`);
  process.exit(1);
}
