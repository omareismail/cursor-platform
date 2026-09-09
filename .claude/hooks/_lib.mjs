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
import { resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";

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

/**
 * Normalise any path to forward slashes, relative to the project root.
 *
 * `path.relative`, not `startsWith`: the earlier prefix test treated
 * `D:\repos\cursor2\x` as inside `D:\repos\cursor`, and on Windows a drive
 * letter arriving as `c:` when the root said `C:` made every anchored pattern
 * (`^memory-bank/...`) miss, so a Tier 2 write went through. A path outside
 * the root comes back absolute (forward slashes) so a caller can see it is not
 * ours; it never comes back as a plausible-looking relative path.
 */
export function relPath(p) {
  if (!p) return "";
  const root = resolve(projectDir());
  const abs = resolve(p);
  const r = relative(root, abs);
  const outside = !r || r.startsWith("..") || isAbsolute(r);
  if (outside) {
    // Same drive, different case, is still the same tree on Windows.
    if (process.platform === "win32" && abs.toLowerCase().startsWith(root.toLowerCase() + sep)) {
      return abs.slice(root.length + 1).split(sep).join("/");
    }
    return abs.split(sep).join("/");
  }
  return r.split(sep).join("/");
}

/** Minimal glob: `**` spans separators, `*` does not, `?` is one character. Case-insensitive. */
export function globMatch(pattern, s) {
  const rx = pattern
    .split(/(\*\*\/|\*\*|\*|\?)/)
    .map((part) => {
      if (part === "**/") return "(?:.*/)?";
      if (part === "**") return ".*";
      if (part === "*") return "[^/]*";
      if (part === "?") return "[^/]";
      return part.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return new RegExp(`^${rx}$`, "i").test(s);
}

/**
 * The enforcement surface: files that, if an agent could edit them, would let
 * it edit the rules it is being held to. The list is owned by
 * .cursor/lifecycle/write-policy.json under "protected"; this is the FAIL-CLOSED
 * fallback, the same arrangement as TIER2_FALLBACK in guard-write.mjs, and
 * self-audit checks the two still agree. Union at runtime, never replacement:
 * a policy may protect more, never less.
 */
export const PROTECTED_FALLBACK = [
  ".claude/hooks/**",
  ".claude/settings.json",
  ".cursor/hooks.json",
  ".cursor/mcp-policy.json",
  ".cursor/lifecycle/**",
  ".cursor/tools/lifecycle.mjs",
  ".mcp.json",
  "lifecycle/state.json",
  "lifecycle/evidence/**",
  "lifecycle/releases/**",
  "lifecycle/overrides/**",
  "lifecycle/incidents/**",
  "lifecycle/changes/**",
  "lifecycle/fitness-baseline.json",
  ".cursor/cache/repo-map.json",
  ".cursor/cache/feature-map.json",
];

/** The write policy, from the project or the copy shipped beside the hooks; null when neither is readable. */
export function writePolicy() {
  const candidates = [
    resolve(projectDir(), ".cursor", "lifecycle", "write-policy.json"),
    fileUrlPath(new URL("../lifecycle/write-policy.json", import.meta.url)),
  ];
  for (const c of candidates) {
    try { if (existsSync(c)) return { policy: JSON.parse(readFileSync(c, "utf8")), source: c }; } catch { /* malformed: try the next, then fall back */ }
  }
  return null;
}

/** Every protected pattern in force: the policy's list unioned with the fallback. */
export function protectedPatterns() {
  const fromPolicy = writePolicy()?.policy?.protected?.paths;
  return [...new Set([...PROTECTED_FALLBACK, ...(Array.isArray(fromPolicy) ? fromPolicy : [])])];
}

/** The pattern a project-relative path is protected by, or null. */
export function isProtected(rel) {
  if (!rel) return null;
  const s = String(rel).replace(/\\/g, "/").replace(/^\.\//, "");
  return protectedPatterns().find((g) => globMatch(g, s)) || null;
}

/**
 * The one escape for the protected list. Set in the editor's environment by a
 * human who is developing the platform itself - the hooks, the policies, the
 * state machine. It is an environment variable and not a file because a file
 * is something an agent can write.
 */
export const platformDev = () => process.env.CURSOR_PLATFORM_DEV === "1";

/**
 * A `file:` URL as a filesystem path. `new URL(...).pathname` is `/D:/x` on
 * Windows, which existsSync cannot open - so every plugin-install fallback that
 * used it resolved to nothing and the hook governed nothing, silently.
 */
export function fileUrlPath(url) {
  try { return fileURLToPath(url); } catch { return String(url); }
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

/**
 * "Allowed" has to be SAID, not implied. Cursor with `failClosed: true` treats a
 * hook that exits 0 with nothing on stdout as a hook that failed, and denies the
 * call - which turned every guard into a wall the moment fail-closed was
 * switched on. So on Cursor a deciding hook answers {permission:"allow"}
 * explicitly. Advisory events (sessionStart, afterFileEdit, stop) have their own
 * output shapes and stay silent; an unknown or missing event name is answered,
 * because the events that can be fail-closed are the deciding ones.
 */
const DECIDING = /^(preToolUse|beforeShellExecution|beforeMCPExecution|beforeReadFile|beforeSubmitPrompt|beforeTabFileRead)$/;
const ADVISORY = /^(sessionStart|afterFileEdit|stop|afterAgentResponse|afterAgentThought|afterTabFileEdit|subagentStart|subagentStop|preCompact|postToolUse)$/i;
export function ok() {
  if (HOST === "cursor") {
    const ev = PAYLOAD?.hook_event_name;
    if (typeof ev !== "string" || DECIDING.test(ev) || !ADVISORY.test(ev)) process.stdout.write(JSON.stringify({ permission: "allow" }));
  }
  process.exit(0);
}

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
