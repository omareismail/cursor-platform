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

import { readFileSync, existsSync, statSync, writeSync } from "node:fs";
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
  ".cursor/tools/project.mjs",
  ".cursor/tools/_project-model.mjs",
  ".cursor/tools/_state.mjs",
  ".cursor/tools/_evidence.mjs",
  ".cursor/tools/self-audit.mjs",
  ".cursor/tools/release-evidence.mjs",
  ".mcp.json",
  "lifecycle/state.json",
  "lifecycle/integrity.json",
  "lifecycle/index.jsonl",
  "lifecycle/evidence/**",
  "lifecycle/releases/**",
  "lifecycle/overrides/**",
  "lifecycle/incidents/**",
  "lifecycle/changes/**",
  "lifecycle/fitness-baseline.json",
  "project/project.json",
  "project/delivery.json",
  "project/ideas.json",
  ".cursor/cache/repo-map.json",
  ".cursor/cache/feature-map.json",
];

/**
 * Cursor fires preToolUse for every tool. A Read payload carries the same
 * file_path a Write does, so a guard that treats "has a path" as "is a write"
 * refuses the reads rule 00 requires. Shared here so guard-write and
 * guard-phase cannot disagree about what a read is.
 */
export const READ_TOOLS = /^(Read|ReadFile|read_file|Grep|grep|grep_search|Glob|glob|glob_file_search|file_search|ReadLints|read_lints|ListDir|list_dir|codebase_search|SemanticSearch|view_file|WebFetch|WebSearch)$/i;
export const isReadTool = (p) => READ_TOOLS.test(p?.tool_name || "");

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

/**
 * The pattern a project-relative path is protected by, or null.
 *
 * The trailing-slash strip is load-bearing. A shell token that ends in the
 * backslash its quote was escaped with (`> \".mcp.json\"`) survives the token
 * scan as `.mcp.json\`, which the backslash rule above turns into `.mcp.json/`.
 * A `**` glob still matched that, but an EXACT-FILE entry never did - so all
 * twenty exact-file protected paths were shell-writable while the seven glob
 * entries held, with no escape variable and no `cd` needed. Normalise the shape
 * before matching, not after.
 */
export function isProtected(rel) {
  if (!rel) return null;
  const raw = String(rel).replace(/\\/g, "/").replace(/^\.\//, "");
  const trimmed = raw.replace(/\/+$/, "");
  if (!trimmed) return null;
  const patterns = protectedPatterns();
  // Both shapes, and never fewer matches than before. `trimmed` is what closes
  // the bypass: it lets an exact-file entry match `.mcp.json/`. `raw` is kept
  // because a `**` glob matches `.claude/hooks/` and NOT `.claude/hooks`, so
  // trimming alone would have un-protected every directory form - a second
  // hole opened by the fix for the first.
  return patterns.find((g) => globMatch(g, trimmed))
      || patterns.find((g) => globMatch(g, raw))
      || null;
}

/**
 * The build gates: the files where /postmortem's findings stop being documents.
 *
 * A BannedSymbols entry, an analyzer severity in .editorconfig, a lint rule - an
 * incident bought each of these, and incidents.mjs check re-reads them to prove
 * the defence is still there. An agent that can edit them can delete the defence
 * and watch the build go green, which is the failure /postmortem step 6 names in
 * so many words: teams remove useful guards during cleanups because nobody
 * recorded that they helped.
 *
 * Owned by write-policy.json under `qualityConfig`; this is the fail-closed
 * fallback, and self-audit A12 keeps the two in step. Creating one of these is
 * allowed - adding a gate is not weakening one.
 */
export const QUALITY_CONFIG_FALLBACK = [
  "**/BannedSymbols.txt",
  "**/.editorconfig",
  "**/Directory.Build.props",
  "**/.globalconfig",
  "**/.eslintrc",
  "**/.eslintrc.*",
  "**/eslint.config.*",
  "**/.prettierrc",
  "**/.prettierrc.*",
  "**/biome.json",
  "**/biome.jsonc",
  "**/.markdownlint*",
  "**/.husky/**",
  "**/lefthook.yml",
  "**/.pre-commit-config.yaml",
];

/** Every quality-gate pattern in force: the policy's list unioned with the fallback. */
export function qualityConfigPatterns() {
  const fromPolicy = writePolicy()?.policy?.qualityConfig?.paths;
  return [...new Set([...QUALITY_CONFIG_FALLBACK, ...(Array.isArray(fromPolicy) ? fromPolicy : [])])];
}

/** The quality-gate pattern a project-relative path matches, or null. */
export function isQualityConfig(rel) {
  if (!rel) return null;
  const raw = String(rel).replace(/\\/g, "/").replace(/^\.\//, "");
  const trimmed = raw.replace(/\/+$/, "");
  if (!trimmed) return null;
  const patterns = qualityConfigPatterns();
  // Both shapes, for the same reason isProtected() matches both - see P2G-1.
  return patterns.find((g) => globMatch(g, trimmed))
      || patterns.find((g) => globMatch(g, raw))
      || null;
}

/**
 * Files no agent may read.
 *
 * Claude Code has always refused these through `permissions.deny` in
 * .claude/settings.json - but that file is Claude Code's alone. A Cursor
 * checkout and a plugin install have no equivalent, so the protection existed on
 * one host and silently nowhere else. Owned by write-policy.json under
 * `secretFiles`; this is the fail-closed fallback, A12 keeps them in step, and
 * A13 keeps the policy equal to Claude's own deny list.
 */
export const SECRET_FILES_FALLBACK = [
  ".env",
  ".env.*",
  "**/appsettings.Production.json",
  "**/*.pfx",
  "**/*.p12",
  "**/id_rsa",
  ".cursor/settings.local.json",
  ".claude/settings.local.json",
];

/** Every secret-file pattern in force: the policy's list unioned with the fallback. */
export function secretFilePatterns() {
  const fromPolicy = writePolicy()?.policy?.secretFiles?.paths;
  return [...new Set([...SECRET_FILES_FALLBACK, ...(Array.isArray(fromPolicy) ? fromPolicy : [])])];
}

/** The secret-file pattern a project-relative path matches, or null. */
export function isSecretFile(rel) {
  if (!rel) return null;
  const raw = String(rel).replace(/\\/g, "/").replace(/^\.\//, "");
  const trimmed = raw.replace(/\/+$/, "");
  if (!trimmed) return null;
  const patterns = secretFilePatterns();
  // Both shapes, for the same reason isProtected() matches both - see P2G-1.
  return patterns.find((g) => globMatch(g, trimmed))
      || patterns.find((g) => globMatch(g, raw))
      || null;
}

/**
 * The one escape for the protected list. Set in the editor's environment by a
 * human who is developing the platform itself - the hooks, the policies, the
 * state machine. It is an environment variable and not a file because a file
 * is something an agent can write.
 */
export const platformDev = () => process.env.CURSOR_PLATFORM_DEV === "1";

/**
 * Credential shapes, owned here because four callers need the same answer:
 * guard-write refuses them in content being written, guard-prompt warns when one
 * is in a prompt, session-end redacts them out of a summary before it is stored,
 * and harness-scan reports them in a committed config. Four copies of a regex is
 * four chances for one of them to be the lenient one, and the lenient one is the
 * only one that matters.
 *
 * The two lists are judged differently. SECRET_PATTERNS are assignment-shaped,
 * so a documented example is a false positive and SECRET_PLACEHOLDER exempts it.
 * TOKEN_PATTERNS are issuer-prefixed: nothing legitimately begins with a live
 * key's prefix, so no exemption applies and none is offered.
 */
export const SECRET_PATTERNS = [
  [/(?:password|pwd)\s*=\s*["']?(?!\s*[{$<])[^"';\s]{4,}/i, "connection-string password"],
  [/(?:api[_-]?key|apikey|secret|client[_-]?secret|access[_-]?token)\s*[:=]\s*["'][A-Za-z0-9_\-\/+]{16,}["']/i, "hardcoded API key/secret"],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key material"],
  [/\bBearer\s+eyJ[A-Za-z0-9_\-]{20,}/, "hardcoded JWT"],
];

export const SECRET_PLACEHOLDER = /\$\{|\{\{|<YOUR|placeholder|example|REDACTED|env:/i;

export const TOKEN_PATTERNS = [
  [/\bsk-ant-[A-Za-z0-9_\-]{16,}/, "Anthropic API key"],
  [/\bsk-[A-Za-z0-9]{20,}/, "OpenAI-style API key"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, "GitHub token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key id"],
  [/\bxox[bpsa]-[A-Za-z0-9-]{10,}/, "Slack token"],
];

/** The first credential shape in `text`, or null. Names the class, never logs the value. */
export function findSecret(text) {
  const s = typeof text === "string" ? text : "";
  if (!s) return null;
  for (const [re, what] of SECRET_PATTERNS) {
    const m = s.match(re);
    if (m && !SECRET_PLACEHOLDER.test(m[0])) return { what, match: m[0], index: m.index ?? 0 };
  }
  for (const [re, what] of TOKEN_PATTERNS) {
    const m = s.match(re);
    if (m) return { what, match: m[0], index: m.index ?? 0 };
  }
  return null;
}

/**
 * Replace every credential shape with a marker naming its class.
 *
 * Run over anything this platform is about to PERSIST. A session summary is
 * derived from a transcript, and a transcript holds whatever a person pasted
 * into it; writing that to a file turns a momentary paste into a stored secret.
 */
export function redactSecrets(text) {
  let s = typeof text === "string" ? text : "";
  if (!s) return s;
  const apply = (list, exemptPlaceholders) => {
    for (const [re, what] of list) {
      const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      s = s.replace(g, (m) => (exemptPlaceholders && SECRET_PLACEHOLDER.test(m) ? m : `[REDACTED: ${what}]`));
    }
  };
  apply(SECRET_PATTERNS, true);
  apply(TOKEN_PATTERNS, false);
  return s;
}

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
 * Write the whole answer, then exit - in that order, guaranteed.
 *
 * `process.stdout.write(json); process.exit(0)` is a race. When stdout is a
 * pipe, as it is under a hook runner, the write is ASYNCHRONOUS on Windows and
 * `exit` can run before the bytes leave the process. The answer is then empty,
 * and with `failClosed` an empty answer is a denial - the same tool call was
 * refused twice and then allowed unchanged, which is the signature. `writeSync`
 * on the raw descriptor blocks until the kernel has the bytes; the fallback is
 * for the rare EAGAIN on a non-blocking pipe, where exiting from the write's
 * callback is the only safe order. Either way this function does not return.
 */
function emit(fd, text, code) {
  try { writeSync(fd, text); process.exit(code); }
  catch { (fd === 2 ? process.stderr : process.stdout).write(text, () => process.exit(code)); }
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
    emit(1, JSON.stringify({
      permission: "deny",
      user_message: text.split("\n")[0],
      agent_message: text,
    }), 0);
  }
  emit(2, text + "\n", 2);
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
  emit(2, reason.trim() + "\n", HOST === "cursor" ? 0 : 2);
}

/** Inject text into the session context (SessionStart / sessionStart). */
export function inject(hookEventName, additionalContext) {
  emit(1, HOST === "cursor"
    ? JSON.stringify({ additional_context: additionalContext })
    : JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext } }), 0);
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
const DECIDING = /^(preToolUse|beforeShellExecution|beforeMCPExecution|beforeReadFile|beforeTabFileRead)$/;
const ADVISORY = /^(sessionStart|sessionEnd|afterFileEdit|stop|afterAgentResponse|afterAgentThought|afterTabFileEdit|subagentStart|subagentStop|preCompact|postToolUse)$/i;

/**
 * beforeSubmitPrompt decides as well, but in its OWN shape: {continue:boolean},
 * never {permission}. Cursor blocks submission when the reply does not match the
 * event's schema, so answering "allow" there would refuse every prompt the guard
 * had just passed - a guard that denies the thing it approved. It is therefore
 * listed neither in DECIDING nor ADVISORY and answered before both.
 */
const PROMPT_EVENT = /^beforeSubmitPrompt$/;

export function ok() {
  if (HOST === "cursor") {
    const ev = PAYLOAD?.hook_event_name;
    if (typeof ev === "string" && PROMPT_EVENT.test(ev)) emit(1, JSON.stringify({ continue: true }), 0);
    if (typeof ev !== "string" || DECIDING.test(ev) || !ADVISORY.test(ev)) emit(1, JSON.stringify({ permission: "allow" }), 0);
  }
  process.exit(0);
}

/**
 * Tell the agent something about the prompt a person just submitted, without
 * stopping the prompt.
 *
 * Exit 2 on Claude Code's UserPromptSubmit does not warn - it ERASES the message
 * the person typed. Nothing this platform has to say about a prompt is worth
 * deleting someone's words, so the only channel used here is the additive one:
 * context on Claude, `continue: true` with a note on Cursor.
 */
export function promptAdvise(text) {
  const msg = String(text || "").trim();
  if (!msg) ok();
  if (HOST === "cursor") {
    emit(1, JSON.stringify({ continue: true, user_message: msg.split("\n")[0] }), 0);
  }
  emit(1, JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: msg } }), 0);
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

/** The session, under either host's name for it. Empty string when neither sent one. */
export function sessionId(payload) {
  const p = payload || PAYLOAD || {};
  return String(p.session_id || p.conversation_id || "");
}

/**
 * The JSONL transcript of this session, or null.
 *
 * Claude Code sends the path on the lifecycle events; Cursor sends nothing of
 * the kind, and no amount of defensive reading invents one. A caller must treat
 * null as "this host does not offer a transcript" and say so in its output,
 * rather than reporting an empty summary as an accurate one.
 */
export function transcriptPath(payload) {
  const p = payload || PAYLOAD || {};
  return p.transcript_path || process.env.CLAUDE_TRANSCRIPT_PATH || null;
}

/** The prompt a person just submitted (UserPromptSubmit / beforeSubmitPrompt). */
export function promptText(payload) {
  const p = payload || PAYLOAD || {};
  return typeof p.prompt === "string" ? p.prompt : "";
}

/**
 * A path inside `.cursor/cache/`, which `.gitignore` excludes.
 *
 * Everything written there is per-machine and never committed: it is evidence
 * for the machine that produced it, not a record the platform stands behind.
 * Records the platform stands behind live under `lifecycle/` and are committed.
 */
export function cachePath(...parts) {
  return resolve(projectDir(), ".cursor", "cache", ...parts);
}
