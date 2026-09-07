// Shared helpers for cursor-platform hooks.
// No dependencies. Node 18+. Cross-platform (Windows / macOS / Linux).
//
// HOST-AGNOSTIC BY DESIGN
//
// The same guard scripts run under Claude Code and under Cursor, which disagree
// on almost every detail of the hook contract: where the file path lives in the
// payload, where the shell command lives, how a hook says "deny", how it injects
// context, and how it learns the workspace root.
//
// Those differences are normalised here, once. A guard should express a rule -
// "no secrets in source", "no code before the design gate" - and never contain a
// branch on which editor is running it. Two copies of a rule, one per host, is
// how one of them silently stops being enforced.
//
//   concern          Claude Code                        Cursor
//   ---------------  ---------------------------------  ------------------------------
//   file path        tool_input.file_path               file_path (afterFileEdit)
//   shell command    tool_input.command                 command (beforeShellExecution)
//   deny             stderr + exit 2                    {permission:"deny", ...}
//   inject           hookSpecificOutput.additionalContext   additional_context
//   workspace root   $CLAUDE_PROJECT_DIR                workspace_roots[0]

import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

/** The payload, kept so projectDir() can reach workspace_roots without threading it through. */
let PAYLOAD = null;
let HOST = "claude";

/**
 * Which agent is running us. Cursor stamps `cursor_version` and
 * `workspace_roots` on every payload; its event names are camelCase
 * (`preToolUse`) where Claude Code's are PascalCase (`PreToolUse`). Any one of
 * those is enough, and all three are checked because a future payload may drop
 * one. Defaults to Claude Code, which is the stricter output contract - a hook
 * that guesses wrong and writes JSON where stderr was expected fails open.
 */
function detectHost(p) {
  if (p && (p.cursor_version || Array.isArray(p.workspace_roots))) return "cursor";
  if (p && typeof p.hook_event_name === "string" && /^[a-z]/.test(p.hook_event_name)) return "cursor";
  return "claude";
}

/** Read the hook payload the agent sends on stdin. Never throws. */
export async function readPayload() {
  try {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    PAYLOAD = raw ? JSON.parse(raw) : {};
  } catch {
    PAYLOAD = {};
  }
  HOST = detectHost(PAYLOAD);
  return PAYLOAD;
}

export const host = () => HOST;

/** Project root. Env var wins; then the host's own answer; then cwd. */
export function projectDir() {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  const roots = PAYLOAD?.workspace_roots;
  if (Array.isArray(roots) && roots.length && typeof roots[0] === "string") return roots[0];
  return process.cwd();
}

/** Normalise any path to forward slashes, relative to the project root. */
export function relPath(p) {
  if (!p) return "";
  const root = resolve(projectDir());
  const abs = resolve(p);
  const r = abs.startsWith(root) ? abs.slice(root.length) : abs;
  return r.split(sep).join("/").replace(/^\/+/, "");
}

export function readIfExists(p) {
  try { return existsSync(p) ? readFileSync(p, "utf8") : null; } catch { return null; }
}

export function ageInDays(p) {
  try { return (Date.now() - statSync(p).mtimeMs) / 86_400_000; } catch { return null; }
}

/**
 * Refuse the action.
 *
 * Cursor accepts exit 2 as a deny, but the JSON form carries two messages: one
 * for the person and one for the agent. The agent's copy is what stops it
 * retrying the same edit through a different tool, so it is worth the branch.
 */
export function block(reason) {
  const text = reason.trim();
  if (HOST === "cursor") {
    process.stdout.write(JSON.stringify({
      permission: "deny",
      user_message: text.split("\n")[0],
      agent_message: text,
    }));
    process.exit(0);
  }
  process.stderr.write(text + "\n");
  process.exit(2);
}

/**
 * Non-blocking note fed back to the agent after a tool ran.
 *
 * On Claude Code a PostToolUse/Stop hook surfaces this by exiting 2. Cursor's
 * `stop` hook has no advisory channel - its only output is `followup_message`,
 * which auto-submits a new user turn. Hijacking a person's session to deliver a
 * reminder is worse than the reminder being missed, so on Cursor this stays on
 * stderr and exits clean.
 */
export function warn(reason) {
  process.stderr.write(reason.trim() + "\n");
  process.exit(HOST === "cursor" ? 0 : 2);
}

/** Inject text into the session context (SessionStart / sessionStart). */
export function inject(hookEventName, additionalContext) {
  process.stdout.write(HOST === "cursor"
    ? JSON.stringify({ additional_context: additionalContext })
    : JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext } }));
  process.exit(0);
}

export const ok = () => process.exit(0);

/** The file a tool is about to write, or has just written. */
export function targetPath(payload) {
  const p = payload || PAYLOAD || {};
  const i = p.tool_input || {};
  return i.file_path || i.path || i.notebook_path || p.file_path || "";
}

/** The content being written, across every Write / Edit / MultiEdit / afterFileEdit shape. */
export function writtenContent(payload) {
  const p = payload || PAYLOAD || {};
  const i = p.tool_input || {};
  if (typeof i.content === "string") return i.content;
  if (typeof i.new_string === "string") return i.new_string;
  const edits = Array.isArray(i.edits) ? i.edits : Array.isArray(p.edits) ? p.edits : null;
  if (edits) return edits.map((e) => e.new_string || "").join("\n");
  return "";
}

/**
 * An MCP call, normalised to { server, tool, input }.
 *
 * The two hosts name the same call very differently:
 *   Claude Code   tool_name "mcp__postgres__query", tool_input an object
 *   Cursor        mcp_server_name "postgres", tool_name "query",
 *                 tool_input a JSON *string*
 *
 * Returns null when the payload is not an MCP call at all, which is the common
 * case on Claude Code - its PreToolUse fires for every tool, not just MCP.
 */
export function mcpCall(payload) {
  const p = payload || PAYLOAD || {};

  const parseInput = (v) => {
    if (typeof v !== "string") return v || {};
    try { return JSON.parse(v); } catch { return { _raw: v }; }
  };

  if (p.mcp_server_name) {
    return { server: p.mcp_server_name, tool: p.tool_name || "", input: parseInput(p.tool_input) };
  }

  // mcp__<server>__<tool>. Split rather than regex: server and tool names may
  // both contain single underscores, and only the double underscore separates.
  const parts = String(p.tool_name || "").split("__");
  if (parts.length >= 3 && parts[0] === "mcp") {
    return { server: parts[1], tool: parts.slice(2).join("__"), input: parseInput(p.tool_input) };
  }
  return null;
}

/** The shell command about to run. Claude nests it; Cursor puts it at the top level. */
export function shellCommand(payload) {
  const p = payload || PAYLOAD || {};
  return (p.tool_input?.command || p.command || "").trim();
}
