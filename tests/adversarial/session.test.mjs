#!/usr/bin/env node
/**
 * session.test.mjs — session-end.mjs writes a summary, and session-start.mjs
 * reads back the right one.
 *
 * Three things can go wrong here and only one of them is loud.
 *
 *   The loud one: nothing is written. A missing file is noticed immediately.
 *
 *   The quiet one: the WRONG session is injected. The sessions directory is
 *   shared by every worktree on the machine, so "newest file" is frequently
 *   another project's, and a summary from another repository read as this one's
 *   prior context is worse than no summary at all - it is confidently wrong.
 *
 *   The dangerous one: a credential reaches disk. A transcript holds whatever a
 *   person pasted into it. Writing that to a file turns a momentary paste into a
 *   stored secret, on a machine where nothing will ever look at it again.
 *
 * Every secret-shaped value below is assembled at RUNTIME; a literal would be
 * refused by guard-write.mjs when this file was saved.
 */

import { existsSync, readFileSync, readdirSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixture, runHook, put, gitInit, check, report, section, claudeEvent, cursorEvent } from "../_harness.mjs";

const H = "session-end.mjs";
const sessionsDir = (root) => join(root, ".cursor", "cache", "sessions");
const summaries = (root) => { try { return readdirSync(sessionsDir(root)).filter((f) => f.endsWith(".md")); } catch { return []; } };
const onlySummary = (root) => {
  const f = summaries(root);
  return f.length ? readFileSync(join(sessionsDir(root), f[0]), "utf8") : "";
};

/** A Claude Code transcript: JSONL, one event per line. */
function transcript(root, name, events) {
  return put(root, `.cursor/cache/${name}`, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
}
const userMsg = (text) => ({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
const userString = (text) => ({ type: "user", message: { role: "user", content: text } });
const toolResult = () => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } });
const assistantUse = (name, input) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name, input }] } });

/* ------------------------------------------------------------------------ */

section("session-end.mjs — SessionEnd writes one summary of what happened");
{
  const root = fixture("se-write");
  gitInit(root);
  put(root, "src/Touched.cs", "class Touched {}\n");

  const tp = transcript(root, "t-write.jsonl", [
    userMsg("first request, trace the payment feature"),
    assistantUse("Read", { file_path: join(root, "src/Touched.cs") }),
    assistantUse("Write", { file_path: join(root, "src/Touched.cs"), content: "x" }),
    assistantUse("mcp__github__search_code", { q: "x" }),
    toolResult(),
    userMsg("second request, now add the test"),
  ]);

  const res = runHook(H, claudeEvent("SessionEnd", { session_id: "abcdef1234567890", transcript_path: tp, reason: "clear" }), root);
  check("the hook exits 0 and says nothing", res.exit === 0 && res.out.trim() === "", `exit ${res.exit}, stdout ${JSON.stringify(res.out.slice(0, 120))}`);
  check("exactly one summary is written", summaries(root).length === 1, JSON.stringify(summaries(root)));
  check("the file name carries the date and the session", /^\d{4}-\d{2}-\d{2}-abcdef12\.md$/.test(summaries(root)[0] || ""), JSON.stringify(summaries(root)));

  const s = onlySummary(root);
  check("it declares itself per-machine and gitignored", /gitignored/i.test(s), s.slice(0, 200));
  check("it says it is data, not instructions", /not instructions/i.test(s), s.slice(0, 300));
  check("the worktree header is this root", s.includes(`**worktree:** ${root.replace(/\\/g, "/")}`), s.slice(0, 500));
  check("the summary markers are both present", s.includes("<!-- SUMMARY:START -->") && s.includes("<!-- SUMMARY:END -->"), "");

  check("both user requests are tasks", s.includes("first request") && s.includes("second request"), s);
  check("a tool_result turn is NOT counted as something a person asked", !/tool_result/.test(s), s);
  check("the written file is listed, relative to the root", /- src\/Touched\.cs/.test(s), s);
  check("an absolute path never reaches the summary", !s.includes(root.replace(/\\/g, "/") + "/src"), s);
  check("tools used are listed", /- Write/.test(s) && /- Read/.test(s), s);
  check("an MCP tool keeps its server but loses the mcp__ prefix", /- github__search_code/.test(s) && !/mcp__github/.test(s), s);
  // Assert the PORCELAIN marker, not the filename. `Touched.cs` also appears
  // under Files Modified, so a filename match here passed even when the Git
  // section was empty - a test that could not fail for the reason it was written.
  check("the git section reports the working tree", /## Git/.test(s) && /\?\? src\//.test(s), s);
  check("stats name the branch and the end reason", /branch:/.test(s) && /end reason: clear/.test(s), s);
  check("a next action is derived and labelled as derived", /## Next concrete action/.test(s) && /not decided/i.test(s), s);
  check("the uncommitted file is what the next action points at", /uncommitted file/.test(s), s);
}

section("session-end.mjs — a credential in the transcript never reaches disk");
{
  const root = fixture("se-redact");
  gitInit(root);
  const value = "hunter22SuperSecret";
  const token = "gh" + "p_" + "Z".repeat(24);
  const tp = transcript(root, "t-secret.jsonl", [
    userMsg("here is the connection string: " + "pass" + "word=" + value),
    userMsg("and the token " + token),
    assistantUse("Bash", { command: "curl -H 'Authorization: " + token + "' https://example.test" }),
  ]);

  runHook(H, claudeEvent("SessionEnd", { session_id: "redact01", transcript_path: tp, reason: "logout" }), root);
  const s = onlySummary(root);
  check("a summary was still written", s.length > 0, "");
  check("the assigned value is gone", !s.includes(value), s);
  check("the token value is gone", !s.includes(token), s);
  check("the class of what was removed is named", /\[REDACTED: /.test(s), s);
  check("the surrounding request is kept", /connection string/.test(s), s);

  // Tool ARGUMENTS are never stored at all - not redacted, simply never read.
  // Redaction is the second line of defence; not collecting is the first.
  check("a tool argument is not in the summary", !s.includes("example.test"), s);
}

section("session-end.mjs — Cursor has no transcript, and the summary says so");
{
  const root = fixture("se-cursor");
  gitInit(root);
  put(root, "src/Changed.cs", "class Changed {}\n");

  const res = runHook(H, cursorEvent(root, "sessionEnd", { conversation_id: "cur12345", reason: "user_closed" }), root);
  check("the Cursor hook exits 0 with no body - sessionEnd is advisory", res.exit === 0 && res.out.trim() === "", `exit ${res.exit}, stdout ${JSON.stringify(res.out.slice(0, 120))}`);
  const s = onlySummary(root);
  check("a summary is still written on Cursor", s.length > 0, "");
  check("the host is recorded as cursor", /\*\*host:\*\* cursor/.test(s), s.slice(0, 400));
  check("it states plainly that Cursor is the reason there is no transcript", /Cursor sends no transcript/i.test(s), s);
  check("it does not present an empty task list as an accurate one", !/_No user messages in the transcript\._/.test(s), s);
  // `git status --porcelain` collapses a wholly-untracked directory to `?? src/`
  // rather than naming each file, so this asserts what git actually prints.
  check("git is offered as the record instead", /## Git/.test(s) && /\?\? src\//.test(s), s);
}

section("session-end.mjs — PreCompact marks the record instead of replacing it");
{
  const root = fixture("se-compact");
  gitInit(root);
  const tp = transcript(root, "t-compact.jsonl", [userMsg("do the thing")]);

  runHook(H, claudeEvent("SessionEnd", { session_id: "compact1", transcript_path: tp, reason: "other" }), root);
  const before = summaries(root).length;
  const res = runHook(H, claudeEvent("PreCompact", { session_id: "compact1", transcript_path: tp, trigger: "auto" }), root);
  check("PreCompact exits 0", res.exit === 0, `exit ${res.exit}`);
  check("PreCompact does not create a second summary for the same session", summaries(root).length === before, JSON.stringify(summaries(root)));
  const s = onlySummary(root);
  check("a compaction marker is appended", /<!-- COMPACTED .* \(auto\) -->/.test(s), s.slice(-400));
  check("the summary it was appended to is intact", /do the thing/.test(s), s);
  check("the compaction is also logged separately", existsSync(join(sessionsDir(root), "compaction-log.jsonl")), "");

  const log = readFileSync(join(sessionsDir(root), "compaction-log.jsonl"), "utf8").trim().split(/\r?\n/);
  const rec = JSON.parse(log[log.length - 1]);
  check("the log line names the trigger and the worktree", rec.trigger === "auto" && String(rec.worktree).toLowerCase() === root.replace(/\\/g, "/").toLowerCase(), JSON.stringify(rec));

  const fresh = fixture("se-compact-first");
  gitInit(fresh);
  runHook(H, claudeEvent("PreCompact", { session_id: "nofile01", trigger: "manual" }), fresh);
  check("PreCompact with no prior summary creates a header-only one", summaries(fresh).length === 1 && /COMPACTED/.test(onlySummary(fresh)), JSON.stringify(summaries(fresh)));
}

section("session-end.mjs — it never disturbs the session, whatever it is handed");
{
  const root = fixture("se-robust");
  gitInit(root);

  const missing = runHook(H, claudeEvent("SessionEnd", { session_id: "miss0001", transcript_path: join(root, "nope.jsonl"), reason: "clear" }), root);
  check("a transcript that does not exist is not an error", missing.exit === 0, `exit ${missing.exit}`);
  // The two "no transcript" states are different facts and the summary must not
  // blur them: on Claude Code a missing transcript means it was not supplied or
  // could not be read, and saying "this host has none" there would be false.
  check("...and the summary says it could not read one, not that the host has none",
    /No transcript was supplied or it could not be read/i.test(onlySummary(root)) && !/Cursor sends no transcript/i.test(onlySummary(root)), onlySummary(root));

  const bad = fixture("se-badjson");
  gitInit(bad);
  put(bad, ".cursor/cache/t-bad.jsonl", "{not json at all\n" + JSON.stringify(userMsg("survived the bad line")) + "\n\n{\n");
  const r2 = runHook(H, claudeEvent("SessionEnd", { session_id: "badjson1", transcript_path: join(bad, ".cursor/cache/t-bad.jsonl"), reason: "clear" }), bad);
  check("a malformed transcript line is skipped, not fatal", r2.exit === 0, `exit ${r2.exit}`);
  check("...and the well-formed lines around it still count", /survived the bad line/.test(onlySummary(bad)), onlySummary(bad));

  const nogit = fixture("se-nogit");
  const r3 = runHook(H, claudeEvent("SessionEnd", { session_id: "nogit001", reason: "clear" }), nogit);
  check("a directory that is not a git repository is not an error", r3.exit === 0, `exit ${r3.exit}`);
  check("...and the summary says the tree is clean or not a repository", /not a git repository|Clean tree/i.test(onlySummary(nogit)), onlySummary(nogit));

  const huge = fixture("se-huge");
  gitInit(huge);
  const big = Array.from({ length: 400 }, (_, i) => JSON.stringify(userMsg(`request ${i} ` + "y".repeat(400)))).join("\n");
  put(huge, ".cursor/cache/t-huge.jsonl", big);
  runHook(H, claudeEvent("SessionEnd", { session_id: "huge0001", transcript_path: join(huge, ".cursor/cache/t-huge.jsonl"), reason: "clear" }), huge);
  const hs = onlySummary(huge);
  check("a long session is capped at 16 KB", Buffer.byteLength(hs, "utf8") <= 16 * 1024, `${Buffer.byteLength(hs, "utf8")} bytes`);
  check("only the last 10 requests are kept", (hs.match(/^- request \d+/gm) || []).length <= 10, String((hs.match(/^- request \d+/gm) || []).length));
  check("the end marker survives truncation", hs.includes("<!-- SUMMARY:END -->"), hs.slice(-200));

  const strOnly = fixture("se-stringcontent");
  gitInit(strOnly);
  put(strOnly, ".cursor/cache/t-str.jsonl", JSON.stringify(userString("a plain string content turn")) + "\n");
  runHook(H, claudeEvent("SessionEnd", { session_id: "strcont1", transcript_path: join(strOnly, ".cursor/cache/t-str.jsonl"), reason: "clear" }), strOnly);
  check("message.content as a plain string is read too", /a plain string content turn/.test(onlySummary(strOnly)), onlySummary(strOnly));
}

/*
 * The quiet failure. The sessions directory is shared by every worktree on the
 * machine, so the newest file in it is frequently a DIFFERENT project's, and
 * injecting that as this project's prior context is confidently wrong.
 */
section("session-start.mjs — the prior session injected is this worktree's, and recent");
{
  const root = fixture("ss-prior");
  gitInit(root);
  const dir = sessionsDir(root);
  mkdirSync(dir, { recursive: true });

  const summary = (worktree, marker, ageDays) => {
    const name = `2026-09-0${Math.floor(Math.random() * 9) + 1}-${marker}.md`;
    const abs = join(dir, name);
    writeFileSync(abs, [
      `# Session`, ``,
      `- **worktree:** ${worktree}`, ``,
      `<!-- SUMMARY:START -->`, ``,
      `## Tasks`, ``, `- ${marker} task`, ``,
      `<!-- SUMMARY:END -->`, ``,
    ].join("\n"), "utf8");
    if (ageDays) {
      const t = new Date(Date.now() - ageDays * 86400_000);
      utimesSync(abs, t, t);
    }
    return abs;
  };

  const mine = summary(root.replace(/\\/g, "/"), "mineFresh", 0);
  summary(root.replace(/\\/g, "/") + "-other", "otherFresh", 0);
  const old = summary(root.replace(/\\/g, "/"), "mineStale", 20);

  const res = runHook("session-start.mjs", claudeEvent("SessionStart", {}), root);
  const ctx = (() => { try { return JSON.parse(res.out).hookSpecificOutput.additionalContext; } catch { return res.out; } })();

  check("this worktree's recent summary is injected", ctx.includes("mineFresh task"), ctx.slice(0, 1200));
  check("another worktree's summary is NOT injected", !ctx.includes("otherFresh task"), ctx.slice(0, 1200));
  check("the injected block is labelled historical, not current", /HISTORICAL REFERENCE ONLY/.test(ctx), ctx.slice(0, 1200));
  check("it is labelled data rather than instructions", /not instructions/i.test(ctx), ctx.slice(0, 1200));
  check("a summary older than the retention window is swept", !existsSync(old), old);
  check("the recent one is kept", existsSync(mine), mine);

  const empty = fixture("ss-none");
  const r2 = runHook("session-start.mjs", claudeEvent("SessionStart", {}), empty);
  check("no sessions directory at all is not an error", r2.exit === 0, `exit ${r2.exit}`);
}

report("A session leaves a record of itself, the next session reads the right one, and no secret is in it.");
