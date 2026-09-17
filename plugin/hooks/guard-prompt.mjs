#!/usr/bin/env node
// Claude Code: UserPromptSubmit   |   Cursor: beforeSubmitPrompt
// Warns when a credential is in the prompt. It never blocks, and it never repeats the value.
//
// WHY IT WARNS AND DOES NOT BLOCK
//
// Exit 2 on UserPromptSubmit does not warn - it ERASES the message the person
// typed, and they get no chance to recover the wording. Nothing this hook has to
// say is worth deleting someone's words, and a false positive would delete them
// for nothing. So the only channel used is the additive one: context on Claude
// Code, `continue: true` with a note on Cursor.
//
// WHAT IT IS ACTUALLY FOR
//
// The prompt is already in the transcript by the time this runs; the secret is
// not going to be un-pasted. What is still preventable is the SECOND copy - the
// agent echoing it into a file, a commit message, a summary, a memory-bank entry
// or a tool argument, any of which turns a momentary paste into something
// durable that nobody remembers to rotate. So the message is addressed to the
// agent, and names the class of credential rather than the value: a hook that
// repeats a secret in order to report it has made the problem worse.
//
// This deliberately does not try to be a scanner. The patterns are the same ones
// guard-write refuses in file content and session-end strips out of a summary -
// one owner in _lib.mjs, so the three cannot disagree about what a credential
// looks like.

import { readPayload, promptText, findSecret, promptAdvise, ok } from "./_lib.mjs";

const p = await readPayload();
const hit = findSecret(promptText(p));
if (!hit) ok();

promptAdvise(
  `A credential-shaped string (${hit.what}) is in the message just submitted.

Do not echo it back, and do not write it to any file, commit message, summary,
memory-bank entry, log or tool argument - that is the copy that outlives the
conversation. If a credential is genuinely needed here, ask the user to put it in
the environment or in user-secrets and reference it by name.

If it is a real credential that has now been pasted into a transcript, say so
plainly and suggest rotating it. (.cursor/rules/04-security-guard.mdc)`,
);
