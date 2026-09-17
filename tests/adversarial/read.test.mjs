#!/usr/bin/env node
/**
 * read.test.mjs — guard-read.mjs refuses to read the files whose whole content
 * is a credential, on BOTH hosts.
 *
 * The defect this closes is not that the rule was missing. Claude Code has
 * refused these for as long as .claude/settings.json has existed. The defect is
 * that the rule lived in a file only Claude Code reads, so a Cursor checkout and
 * every plugin install had no such protection while every document described it
 * as the platform's. A control that exists and is unreachable is the exact shape
 * self-audit.mjs was written to find, and it was in the platform's own config.
 *
 * So the Cursor cases below are the point of the file, not an afterthought.
 */

import { join } from "node:path";
import { fixture, runHook, put, check, denies, allows, cursorDenies, cursorAllows, report, section } from "../_harness.mjs";

const H = "guard-read.mjs";

const claudeRead = (file) => ({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: file } });
const cursorRead = (root, file, event = "beforeReadFile") =>
  ({ hook_event_name: event, cursor_version: "1.0.0", workspace_roots: [root], file_path: file });

const SECRET_FILES = [
  ".env",
  ".env.local",
  ".env.production",
  "src/Api/appsettings.Production.json",
  "certs/server.pfx",
  "certs/client.p12",
  ".ssh/id_rsa",
  ".claude/settings.local.json",
  ".cursor/settings.local.json",
];

const ORDINARY_FILES = [
  "src/Api/appsettings.json",
  "src/Api/appsettings.Development.json",
  "docs/design/architecture.md",
  ".envrc",
  "README.md",
  "memory-bank/activeContext.md",
  ".claude/settings.json",
];

section("guard-read.mjs — Claude Code");
{
  const root = fixture("gr-claude");
  for (const f of SECRET_FILES) denies(`refuses: ${f}`, runHook(H, claudeRead(join(root, f)), root), "secret-bearing");
  for (const f of ORDINARY_FILES) allows(`allows: ${f}`, runHook(H, claudeRead(join(root, f)), root));

  allows("a payload naming no file is not this hook's business", runHook(H, { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: {} }, root));
  denies("backslashes do not hide a secret file", runHook(H, claudeRead(root + "\\certs\\server.pfx"), root), "secret-bearing");
  check("the refusal names the pattern it matched", runHook(H, claudeRead(join(root, ".env")), root).err.includes("matched:"), "");
  check("the refusal tells the agent what to do instead", /which key you need/.test(runHook(H, claudeRead(join(root, ".env")), root).err), "");
}

/*
 * The half that did not exist before. Both Cursor read events are wired
 * failClosed, so "allow" has to be said out loud - a hook that exits 0 with an
 * empty stdout is counted by Cursor as a hook that failed, and every read would
 * be denied.
 */
section("guard-read.mjs — Cursor, where there was no rule at all before");
{
  const root = fixture("gr-cursor");
  for (const f of SECRET_FILES) {
    cursorDenies(`beforeReadFile refuses: ${f}`, runHook(H, cursorRead(root, join(root, f)), root), "secret-bearing");
    cursorDenies(`beforeTabFileRead refuses: ${f}`, runHook(H, cursorRead(root, join(root, f), "beforeTabFileRead"), root), "secret-bearing");
  }
  for (const f of ORDINARY_FILES) cursorAllows(`says allow out loud for: ${f}`, runHook(H, cursorRead(root, join(root, f)), root));
  cursorAllows("a Cursor payload with no file_path still answers allow", runHook(H, cursorRead(root, ""), root));
}

section("guard-read.mjs — there is no escape, and that is deliberate");
{
  const root = fixture("gr-escape");
  // Every other guard has one, because every other guard refuses an ACTION a
  // human might want taken. This refuses a READ, and a read that succeeds puts
  // the value in the transcript - the outcome the guard exists to prevent. An
  // escape would not enable the work, it would only move the leak.
  for (const env of [{ CURSOR_PLATFORM_DEV: "1" }, { CLAUDE_ALLOW_TIER2_EDIT: "1" }, { CLAUDE_ALLOW_QUALITY_CONFIG_EDIT: "1" }, { LIFECYCLE_OVERRIDE: "1" }]) {
    denies(`${Object.keys(env)[0]} does not unlock it`, runHook(H, claudeRead(join(root, ".env")), root, env), "secret-bearing");
  }
}

section("guard-read.mjs — the fallback holds when the policy is unreadable");
{
  // A policy that cannot be read must not mean "nothing is secret". The list in
  // _lib.mjs is the fail-closed copy, and self-audit A12 keeps it in step with
  // write-policy.json.
  const noPolicy = fixture("gr-fallback", { writePolicy: false });
  for (const f of [".env", "certs/server.pfx", ".ssh/id_rsa"]) {
    denies(`still refuses without write-policy.json: ${f}`, runHook(H, claudeRead(join(noPolicy, f)), noPolicy), "secret-bearing");
  }
  allows("and still allows an ordinary file", runHook(H, claudeRead(join(noPolicy, "README.md")), noPolicy));

  // A project may protect MORE than the fallback; the union is what is enforced.
  const extra = fixture("gr-extra", { writePolicy: false });
  put(extra, ".cursor/lifecycle/write-policy.json", JSON.stringify({
    version: 1,
    protected: { paths: [".claude/hooks/**"] },
    secretFiles: { paths: ["**/*.keystore", "config/credentials.yml"] },
  }, null, 2));
  denies("a project-specific secret file is refused too", runHook(H, claudeRead(join(extra, "app/release.keystore")), extra), "secret-bearing");
  denies("...and so is the second one", runHook(H, claudeRead(join(extra, "config/credentials.yml")), extra), "secret-bearing");
  denies("...while the fallback's entries still hold", runHook(H, claudeRead(join(extra, ".env")), extra), "secret-bearing");
}

report("Neither host will read a file whose whole content is a credential, and neither can be talked out of it.");
