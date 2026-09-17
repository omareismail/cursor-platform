#!/usr/bin/env node
/**
 * prompt.test.mjs — guard-prompt.mjs warns about a credential in the message a
 * person just typed, and never does anything worse than warn.
 *
 * The two ways this hook could be harmful are both pinned here.
 *
 *   It blocks. Exit 2 on UserPromptSubmit does not warn, it ERASES the message.
 *   A false positive would then delete somebody's words for nothing, and this
 *   hook is built on regular expressions, so false positives are certain.
 *
 *   It repeats the value. A hook that prints a secret in order to report a
 *   secret has made a second copy of it, in the transcript, permanently.
 *
 * Every credential below is assembled at RUNTIME; a literal would be refused by
 * guard-write.mjs when this file was saved.
 */

import { fixture, runHook, check, report, section, claudeEvent, cursorEvent } from "../_harness.mjs";

const H = "guard-prompt.mjs";
const root = fixture("prompt");

/** What reached the agent, on either host. */
function advice(res) {
  try {
    const b = JSON.parse(res.out);
    return String(b.hookSpecificOutput?.additionalContext || b.user_message || "");
  } catch { return res.out; }
}

const CASES = [
  ["an Anthropic key", "sk-" + "ant-" + "A".repeat(28), "Anthropic API key"],
  ["a GitHub token", "gh" + "p_" + "B".repeat(30), "GitHub token"],
  ["an AWS access key id", "AKIA" + "QRSTUVWXYZ012345", "AWS access key id"],
  ["a Slack token", "xox" + "b-" + "123456789012-abcdef", "Slack token"],
  ["private key material", "-----BEGIN " + "PRIVATE KEY-----", "private key material"],
  ["an assignment-shaped secret", "the string is " + "pass" + "word=" + "s3cr3tvalue", "connection-string password"],
];

section("guard-prompt.mjs — it notices, and says which kind");
{
  for (const [label, value, what] of CASES) {
    const res = runHook(H, claudeEvent("UserPromptSubmit", { session_id: "p1", prompt: `please use ${value} for this` }), root);
    check(`${label}: the prompt is never blocked`, res.exit === 0, `exit ${res.exit}, stderr ${JSON.stringify(res.err.slice(0, 120))}`);
    const msg = advice(res);
    check(`${label}: the agent is told what kind it was`, msg.includes(what), msg.slice(0, 200));
    check(`${label}: the VALUE is not repeated back`, !msg.includes(value), msg.slice(0, 200));
    check(`${label}: the agent is told not to persist it`, /do not .*write it to any file|not to persist|memory-bank/i.test(msg), msg.slice(0, 300));
  }
}

section("guard-prompt.mjs — an ordinary prompt is left entirely alone");
{
  for (const text of [
    "please refactor the payment handler",
    "the password is stored in the vault, do not put it in source",
    "add a test for the AKIA prefix detector",
    "",
  ]) {
    const res = runHook(H, claudeEvent("UserPromptSubmit", { session_id: "p2", prompt: text }), root);
    check(`allows and stays silent: ${JSON.stringify(text.slice(0, 40))}`, res.exit === 0 && res.out.trim() === "", `exit ${res.exit}, stdout ${JSON.stringify(res.out.slice(0, 120))}`);
  }

  const noPrompt = runHook(H, claudeEvent("UserPromptSubmit", { session_id: "p3" }), root);
  check("a payload with no prompt at all is not an error", noPrompt.exit === 0 && noPrompt.out.trim() === "", `exit ${noPrompt.exit}`);
}

/*
 * Cursor's beforeSubmitPrompt answers {continue:boolean}, not {permission}.
 * Cursor blocks submission when the reply does not match the event's schema, so
 * answering "allow" here - which is what every other deciding event gets - would
 * refuse every prompt the guard had just approved.
 */
section("guard-prompt.mjs — Cursor gets the shape its event defines");
{
  const clean = runHook(H, cursorEvent(root, "beforeSubmitPrompt", { prompt: "refactor the handler" }), root);
  let cleanBody = null;
  try { cleanBody = JSON.parse(clean.out); } catch { /* reported below */ }
  check("a clean prompt is answered {continue:true}", clean.exit === 0 && cleanBody?.continue === true, `exit ${clean.exit}, stdout ${JSON.stringify(clean.out.slice(0, 120))}`);
  check("...and never with a permission field", cleanBody?.permission === undefined, JSON.stringify(clean.out.slice(0, 120)));

  const token = "gh" + "p_" + "C".repeat(30);
  const dirty = runHook(H, cursorEvent(root, "beforeSubmitPrompt", { prompt: `token ${token}` }), root);
  let dirtyBody = null;
  try { dirtyBody = JSON.parse(dirty.out); } catch { /* reported below */ }
  check("a credential still lets the message through", dirty.exit === 0 && dirtyBody?.continue === true, `exit ${dirty.exit}, stdout ${JSON.stringify(dirty.out.slice(0, 160))}`);
  check("...with a note for the person", typeof dirtyBody?.user_message === "string" && dirtyBody.user_message.length > 0, JSON.stringify(dirty.out.slice(0, 160)));
  check("...and the value is not in the note", !String(dirty.out).includes(token), dirty.out.slice(0, 200));
}

section("guard-prompt.mjs — no escape variable changes what it does");
{
  const value = "sk-" + "ant-" + "D".repeat(28);
  for (const env of [{ CURSOR_PLATFORM_DEV: "1" }, { CLAUDE_ALLOW_TIER2_EDIT: "1" }, { LIFECYCLE_OVERRIDE: "1" }]) {
    const res = runHook(H, claudeEvent("UserPromptSubmit", { prompt: `key ${value}` }), root, env);
    check(`still warns with ${Object.keys(env)[0]} set`, res.exit === 0 && advice(res).includes("Anthropic API key"), advice(res).slice(0, 120));
  }
}

report("A credential in a prompt is named, never repeated, and never costs the person their message.");
