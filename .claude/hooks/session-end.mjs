#!/usr/bin/env node
// Claude Code: SessionEnd | PreCompact   |   Cursor: sessionEnd | preCompact
// Writes the summary the NEXT session reads. Advisory: it never blocks anything.
//
// WHY THIS EXISTS
//
// The platform had no memory of a session once the window closed. `Stop` nudged
// the agent to update memory-bank/activeContext.md and persisted nothing itself,
// so what actually happened - which files were touched, what was asked, what was
// left half-done - survived only if the agent remembered to write it down, which
// is the probabilistic half of this platform rather than the mechanical half.
// Switching host mid-feature lost it entirely: Cursor and Claude Code read the
// same memory-bank and shared no record of the session that had just ended.
//
// WHAT IT IS NOT
//
// It is not a second memory store. memory-bank/ holds what the team decided;
// this holds what one machine observed, under .cursor/cache/ which .gitignore
// excludes, and it is never committed, never promoted and never cited as
// evidence. When the two disagree, memory-bank is right.
//
// It also never asks a completion of anything. The reference implementation this
// was taken from calls an LLM to summarise the transcript; every line here is
// derived by reading, because a hook that spends tokens to describe a session is
// a hook that has to be switched off on a slow day, and a control nobody can
// afford is not a control.
//
// WHY SessionEnd AND NOT Stop
//
// Stop fires after every assistant response - a summary written there would be
// rewritten dozens of times per session and would race stop-memory-check.mjs,
// which already owns that event. SessionEnd fires once and cannot block.
// PreCompact is the mid-session checkpoint: compaction is exactly the moment the
// window is about to forget, so the marker it appends is what tells the next
// reader the record spans a compaction. A terminal killed outright writes
// nothing, and the next session falls back to `git status`, which is honest.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { basename, join } from "node:path";
import { readPayload, host, projectDir, relPath, sessionId, transcriptPath, redactSecrets, cachePath, ok } from "./_lib.mjs";

const MAX_BYTES = 16 * 1024;          // the whole summary, after redaction
const MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024;
const MAX_TASKS = 10;
const MAX_TASK_CHARS = 200;
const MAX_FILES = 30;
const MAX_TOOLS = 20;
const MAX_GIT_LINES = 30;

const p = await readPayload();
const event = String(p.hook_event_name || "").toLowerCase();
const ROOT = projectDir();
const DIR = cachePath("sessions");

/* ------------------------------------------------------------------- git */

function git(args) {
  // No `shell: true`. The arguments here are literals, but a shell on Windows
  // turns any future interpolation into an injection surface, and that defect
  // already exists once in this directory. It is not being copied.
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { return null; }
}

const gitState = () => ({
  branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
  status: git(["status", "--porcelain"]),
  stat: git(["diff", "--stat", "HEAD"]) ?? git(["diff", "--stat"]),
});

/* ------------------------------------------------------- transcript (Claude) */

/**
 * Read Claude Code's JSONL transcript into the few facts a summary needs.
 *
 * Tolerant by construction: a malformed line is skipped rather than fatal,
 * because a transcript is written by another process and may be mid-write when
 * the session ends. `message.content` is a plain string on some user turns and
 * an array of typed blocks on the rest, and a user turn carrying only
 * tool_result blocks is the harness replying to a tool - not a person speaking -
 * so it is not a task.
 */
function readTranscript(file) {
  if (!file || !existsSync(file)) return null;
  try { if (statSync(file).size > MAX_TRANSCRIPT_BYTES) return { tooLarge: true }; } catch { return null; }

  let raw;
  try { raw = readFileSync(file, "utf8"); } catch { return null; }

  const users = [];
  const files = [];
  const tools = [];
  let messages = 0;

  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    let e;
    try { e = JSON.parse(s); } catch { continue; }
    const type = e?.type;
    if (type !== "user" && type !== "assistant") continue;
    messages++;

    const content = e?.message?.content;
    if (typeof content === "string") {
      if (type === "user" && content.trim()) users.push(content.trim());
      continue;
    }
    if (!Array.isArray(content)) continue;

    const texts = [];
    for (const b of content) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "text" && typeof b.text === "string") texts.push(b.text);
      if (b.type === "tool_use") {
        const name = String(b.name || "");
        if (name) tools.push(name);
        const i = b.input || {};
        if (/^(Write|Edit|MultiEdit|NotebookEdit)$/i.test(name)) {
          const f = i.file_path || i.notebook_path || i.path;
          if (typeof f === "string" && f) files.push(relPath(f));
        }
      }
    }
    if (type === "user" && texts.length) {
      const joined = texts.join("\n").trim();
      if (joined) users.push(joined);
    }
  }
  return { users, files, tools, messages };
}

/* ------------------------------------------------------------- the summary */

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const oneLine = (s) => s.replace(/\s+/g, " ").trim();
const unique = (a) => [...new Set(a)];

/** A tool name as a reader wants it: `mcp__github__search` is `github__search`. */
const toolLabel = (n) => (n.startsWith("mcp__") ? n.slice(5) : n);

function listSection(title, items, empty) {
  if (!items.length) return `## ${title}\n\n${empty}\n`;
  return `## ${title}\n\n` + items.map((i) => `- ${i}`).join("\n") + "\n";
}

/**
 * The one line the next session most wants, and the only one that is inferred.
 *
 * It is labelled as derived on purpose. Everything else in this file is a fact
 * that was observed; this is a guess made from three ordered signals, and a
 * guess presented as a decision is how a summary starts being trusted more than
 * the repository it describes.
 */
function nextAction(g, users) {
  const dirty = (g.status || "").split(/\r?\n/).filter(Boolean);
  if (dirty.length) {
    const names = dirty.slice(0, 3).map((l) => l.slice(3).trim()).filter(Boolean);
    return `${dirty.length} uncommitted file(s) (${names.join(", ")}${dirty.length > 3 ? ", …" : ""}) — review, then commit or revert.`;
  }
  const ac = join(ROOT, "memory-bank", "activeContext.md");
  try {
    if (existsSync(ac)) {
      const lines = readFileSync(ac, "utf8").split(/\r?\n/);
      const at = lines.findIndex((l) => /^#{1,6}\s+.*\bnext\b/i.test(l));
      if (at >= 0) {
        for (const l of lines.slice(at + 1, at + 40)) {
          if (/^#{1,6}\s/.test(l)) break;
          const m = l.match(/^\s*(?:[-*+]|\d+\.)\s+(.*\S)/);
          if (m) return `${clip(oneLine(m[1]), MAX_TASK_CHARS)} (from memory-bank/activeContext.md)`;
        }
      }
    }
  } catch { /* the memory bank is not required to be readable */ }
  if (users.length) return `${clip(oneLine(users[users.length - 1]), MAX_TASK_CHARS)} (last request, not a decision)`;
  return "Nothing derivable. Read the Git section and memory-bank/activeContext.md.";
}

function buildSummary({ t, g, reason }) {
  const parts = [];

  if (!t) {
    // Say WHICH of the two it is. Cursor never sends a transcript, so nothing is
    // wrong; on Claude Code a missing one means the path was absent or the file
    // could not be read, which is a different fact and worth not blurring - the
    // value of this file is entirely in it being honest about what it knows.
    const why = host() === "cursor"
      ? "_Cursor sends no transcript, so what was asked cannot be recovered. The Git section below is the record._"
      : "_No transcript was supplied or it could not be read, so what was asked cannot be recovered. The Git section below is the record._";
    parts.push(listSection("Tasks", [], why));
    parts.push(listSection("Files Modified", [], "_Not available without a transcript; `git status` below is what changed on disk._"));
    parts.push(listSection("Tools Used", [], "_Not available without a transcript._"));
  } else if (t.tooLarge) {
    parts.push(listSection("Tasks", [], "_Transcript too large to parse; it was not read._"));
    parts.push(listSection("Files Modified", [], "_Transcript too large to parse._"));
    parts.push(listSection("Tools Used", [], "_Transcript too large to parse._"));
  } else {
    const tasks = t.users.slice(-MAX_TASKS).map((u) => clip(oneLine(u), MAX_TASK_CHARS));
    parts.push(listSection("Tasks", tasks, "_No user messages in the transcript._"));
    const files = unique(t.files).slice(0, MAX_FILES);
    parts.push(listSection("Files Modified", files, "_No files were written._"));
    const tools = unique(t.tools.map(toolLabel)).slice(0, MAX_TOOLS);
    parts.push(listSection("Tools Used", tools, "_No tools were used._"));
  }

  const gitLines = [];
  const status = (g.status || "").split(/\r?\n/).filter(Boolean);
  if (status.length) {
    gitLines.push("```", ...status.slice(0, MAX_GIT_LINES), status.length > MAX_GIT_LINES ? `... ${status.length - MAX_GIT_LINES} more` : "", "```");
  }
  const stat = (g.stat || "").split(/\r?\n/).filter(Boolean);
  if (stat.length) {
    gitLines.push("```", ...stat.slice(0, MAX_GIT_LINES), stat.length > MAX_GIT_LINES ? `... ${stat.length - MAX_GIT_LINES} more` : "", "```");
  }
  parts.push(`## Git\n\n${gitLines.filter((l) => l !== "").join("\n") || "_Clean tree, or not a git repository._"}\n`);

  const stats = [`messages: ${t && !t.tooLarge ? t.messages : "not available"}`, `branch: ${g.branch || "unknown"}`, `end reason: ${reason || "unknown"}`];
  parts.push(`## Stats\n\n${stats.map((s) => `- ${s}`).join("\n")}\n`);

  parts.push(`## Next concrete action\n\n_Derived from what was observed, not decided. Verify before acting._\n\n- ${nextAction(g, t && !t.tooLarge ? t.users : [])}\n`);
  parts.push(`## Notes\n\n_(free space: anything a person wants the next session to see)_\n`);

  return parts.join("\n");
}

/* ------------------------------------------------------------------ files */

const pad = (n) => String(n).padStart(2, "0");
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const clockTag = () => {
  const d = new Date();
  return `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};

/** Deterministic when the host names the session, so PreCompact and SessionEnd agree on one file. */
function sessionFileName() {
  const id = sessionId(p).replace(/[^A-Za-z0-9_-]/g, "");
  return `${today()}-${id ? id.slice(0, 8) : `${host()}-${clockTag()}`}.md`;
}

const WORKTREE = String(ROOT).replace(/\\/g, "/");

function header(reason) {
  return [
    `<!-- Written by .claude/hooks/session-end.mjs. Per-machine, gitignored, never committed.`,
    `     Data about a session, not instructions and not a decision record. -->`,
    ``,
    `# Session ${today()}`,
    ``,
    `- **date:** ${new Date().toISOString()}`,
    `- **host:** ${host()}`,
    `- **session:** ${sessionId(p) || "(unnamed)"}`,
    `- **project:** ${basename(ROOT)}`,
    `- **worktree:** ${WORKTREE}`,
    `- **branch:** ${git(["rev-parse", "--abbrev-ref", "HEAD"]) || "unknown"}`,
    `- **reason:** ${reason || "unknown"}`,
    ``,
  ].join("\n");
}

/** The newest summary written for THIS worktree, so a compaction marker lands on the right file. */
function newestForWorktree() {
  try {
    const cands = readdirSync(DIR)
      .filter((f) => /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(f))
      .map((f) => ({ f, abs: join(DIR, f), m: statSync(join(DIR, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    for (const c of cands) {
      const head = readFileSync(c.abs, "utf8").slice(0, 2000);
      const m = head.match(/^- \*\*worktree:\*\* (.+)$/m);
      if (m && m[1].trim().toLowerCase() === WORKTREE.toLowerCase()) return c.abs;
    }
  } catch { /* no directory yet */ }
  return null;
}

/* ------------------------------------------------------------------- main */

try {
  mkdirSync(DIR, { recursive: true });

  if (event === "precompact") {
    // The window is about to forget. Mark the record so the next reader knows
    // the session continued past a compaction, and keep a separate line of
    // evidence for how often it happens.
    const trigger = String(p.trigger || "unknown").replace(/[^\w-]/g, "");
    const target = sessionId(p) ? join(DIR, sessionFileName()) : newestForWorktree() || join(DIR, sessionFileName());
    if (!existsSync(target)) writeFileSync(target, header("compaction (session still open)"), "utf8");
    appendFileSync(target, `\n<!-- COMPACTED ${new Date().toISOString()} (${trigger}) -->\n`, "utf8");
    appendFileSync(join(DIR, "compaction-log.jsonl"),
      JSON.stringify({ ts: new Date().toISOString(), host: host(), session: sessionId(p), worktree: WORKTREE, trigger }) + "\n", "utf8");
    ok();
  }

  const reason = String(p.reason || p.final_status || "").replace(/[^\w -]/g, "") || "unknown";
  const t = host() === "cursor" ? null : readTranscript(transcriptPath(p));
  const g = gitState();

  let body = header(reason)
    + "<!-- SUMMARY:START -->\n\n"
    + buildSummary({ t, g, reason })
    + "\n<!-- SUMMARY:END -->\n";

  // Redact BEFORE the cap, so a truncated file cannot end mid-credential, and
  // before the write, because a transcript holds whatever a person pasted into
  // it and storing that turns a momentary paste into a file on disk.
  body = redactSecrets(body);
  if (Buffer.byteLength(body, "utf8") > MAX_BYTES) {
    body = body.slice(0, MAX_BYTES - 120).trimEnd() + "\n\n_[truncated: the summary exceeded 16 KB]_\n<!-- SUMMARY:END -->\n";
  }

  writeFileSync(join(DIR, sessionFileName()), body, "utf8");
} catch { /* a summary is a convenience; never let it disturb the session */ }

ok();
