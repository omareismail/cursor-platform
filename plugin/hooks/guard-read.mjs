#!/usr/bin/env node
// Claude Code: PreToolUse (Read)   |   Cursor: beforeReadFile, beforeTabFileRead
// Refuses to read the files whose whole content is a credential.
//
// WHY THIS EXISTS WHEN settings.json ALREADY SAID IT
//
// Claude Code refuses these through `permissions.deny` in .claude/settings.json,
// and has for as long as that file has existed. But that is Claude Code's file
// and nothing else reads it: a Cursor checkout of this repository had no such
// rule, and neither did any plugin install. The protection was real on one host
// and absent on the others, while every document described it as a property of
// the platform.
//
// That is the shape self-audit.mjs was written to find - a control that exists
// and is not reachable - and it was sitting in the platform's own configuration.
//
// WHY THERE IS NO ESCAPE VARIABLE
//
// Every other guard here has one, because every other guard refuses an ACTION a
// human might legitimately want taken. This one refuses a READ, and a read that
// succeeds puts the value in the transcript, in the context window, and in any
// summary derived from either - which is the outcome the guard exists to
// prevent. An escape would not enable the work; it would only move the leak.
//
// The single source of truth is write-policy.json -> secretFiles, with a
// fail-closed fallback in _lib.mjs (self-audit A12) that is checked against
// Claude Code's own deny list (A13), so the two hosts cannot drift apart again.

import { readPayload, relPath, targetPath, isSecretFile, block, ok } from "./_lib.mjs";

const p = await readPayload();

// Claude Code reaches this hook only through a `Read` matcher. Cursor's
// beforeReadFile and beforeTabFileRead are read events by definition. Anything
// that names no file is not this hook's business.
const file = relPath(targetPath(p));
if (!file) ok();

const hit = isSecretFile(file);
if (!hit) ok();

block(`BLOCKED: ${file} is a secret-bearing file and must not be read by an agent.

  matched:  ${hit}
  tool:     ${p.tool_name || p.hook_event_name || "unknown"}
  policy:   .cursor/lifecycle/write-policy.json -> secretFiles

Reading it puts the value in the transcript, in the context window, and in every
summary derived from either. There is no escape variable for this one, because an
escape would not let the work proceed - it would only move the leak.

Tell the user which key you need and what for. They can confirm it is set, or
give you the variable NAME to reference. If you need to know whether a key
exists, ask; do not read the file to find out.
(.cursor/rules/04-security-guard.mdc)`);
