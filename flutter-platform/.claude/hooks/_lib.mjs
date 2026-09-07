// Shared helpers for flutter-platform Claude Code hooks.
// No dependencies. Node 18+. Cross-platform (Windows / macOS / Linux).

import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

/** Read the hook payload Claude Code sends on stdin. Never throws. */
export async function readPayload() {
  try {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Project root. CLAUDE_PROJECT_DIR is set by Claude Code; cwd is the fallback. */
export const projectDir = () => process.env.CLAUDE_PROJECT_DIR || process.cwd();

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

/** Block a tool call: stderr goes back to Claude, exit 2 stops the call. */
export function block(reason) {
  process.stderr.write(reason.trim() + "\n");
  process.exit(2);
}

/** Non-blocking note fed back to Claude after a tool ran. */
export function warn(reason) {
  process.stderr.write(reason.trim() + "\n");
  process.exit(2);
}

/** Inject text into the session context (SessionStart / UserPromptSubmit). */
export function inject(hookEventName, additionalContext) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName, additionalContext },
  }));
  process.exit(0);
}

export const ok = () => process.exit(0);

/** Extract the target file path from any file-tool payload shape. */
export function targetPath(payload) {
  const i = payload.tool_input || {};
  return i.file_path || i.path || i.notebook_path || "";
}

/** Extract the content being written, across Write / Edit / MultiEdit shapes. */
export function writtenContent(payload) {
  const i = payload.tool_input || {};
  if (typeof i.content === "string") return i.content;
  if (typeof i.new_string === "string") return i.new_string;
  if (Array.isArray(i.edits)) return i.edits.map(e => e.new_string || "").join("\n");
  return "";
}
