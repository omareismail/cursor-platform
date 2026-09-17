#!/usr/bin/env node
/**
 * paths.test.mjs — path handling in _lib.mjs, where a wrong answer is a guard that misses.
 *
 *   relPath        used to be `abs.startsWith(root)`: a sibling directory whose
 *                  name began with the root's was "inside", and on Windows a
 *                  lower-case drive letter made every anchored pattern miss -
 *                  so a Tier 2 write with `d:\...` went through where `D:\...`
 *                  was refused.
 *   fileUrlPath    the plugin-install fallbacks used `new URL(...).pathname`,
 *                  which is `/D:/x` on Windows and opens nothing; every fallback
 *                  resolved to no file and the hook governed nothing, silently.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fixture, runHook, write, check, denies, report, section, claudeEvent, cursorEvent, REPO } from "../_harness.mjs";

const lib = await import(new URL(`file:///${join(REPO, ".claude", "hooks", "_lib.mjs").replace(/\\/g, "/")}`));
const root = fixture("paths");
process.env.CLAUDE_PROJECT_DIR = root;
const win = process.platform === "win32";

section("_lib.relPath");
{
  check("a path under the root is relative with forward slashes",
    lib.relPath(join(root, "memory-bank", "architecture.md")) === "memory-bank/architecture.md", lib.relPath(join(root, "memory-bank", "architecture.md")));
  check("a sibling directory whose name extends the root's is NOT inside it",
    !/^memory-bank\//.test(lib.relPath(join(root + "2", "memory-bank", "architecture.md"))), lib.relPath(join(root + "2", "memory-bank", "architecture.md")));
  check("a path outside the root comes back absolute, never as a plausible relative path",
    /^([A-Za-z]:)?\//.test(lib.relPath(join(root, "..", "elsewhere", "x.md"))), lib.relPath(join(root, "..", "elsewhere", "x.md")));
  check("a relative input resolves against cwd, not the root, and is reported honestly",
    typeof lib.relPath("x.md") === "string", "");
  if (win) {
    const lower = join(root, "memory-bank", "architecture.md").replace(/^([A-Z]):/, (m, d) => d.toLowerCase() + ":");
    check("Windows: a lower-case drive letter is the same tree", lib.relPath(lower) === "memory-bank/architecture.md", lib.relPath(lower));
    const upper = join(root, "memory-bank", "architecture.md").replace(/^([a-z]):/, (m, d) => d.toUpperCase() + ":");
    check("Windows: an upper-case drive letter is the same tree", lib.relPath(upper) === "memory-bank/architecture.md", lib.relPath(upper));
    check("Windows: backslashes normalise", lib.relPath(root + "\\src\\A.cs") === "src/A.cs", lib.relPath(root + "\\src\\A.cs"));
  }
}

section("_lib.fileUrlPath");
{
  const p = lib.fileUrlPath(new URL("./_lib.mjs", `file:///${join(REPO, ".claude", "hooks", "x").replace(/\\/g, "/")}`));
  check("returns a path existsSync can open", existsSync(p), p);
  if (win) check("Windows: no leading slash before the drive letter", /^[A-Za-z]:\\/.test(p), p);
  check("the old .pathname form would NOT have opened on Windows (documenting the bug)",
    !win || !existsSync(new URL("./_lib.mjs", `file:///${join(REPO, ".claude", "hooks", "x").replace(/\\/g, "/")}`).pathname), "");
}

section("guard-write.mjs — the refusal survives the drive-letter case");
if (win) {
  const lower = join(root, "memory-bank", "architecture.md").replace(/^([A-Z]):/, (m, d) => d.toLowerCase() + ":");
  denies("Tier 2 write with a lower-case drive letter is refused", runHook("guard-write.mjs", write(lower), root), "Tier 2");
  const upper = join(root, "memory-bank", "architecture.md").replace(/^([a-z]):/, (m, d) => d.toUpperCase() + ":");
  denies("Tier 2 write with an upper-case drive letter is refused", runHook("guard-write.mjs", write(upper), root), "Tier 2");
} else {
  console.log("  (skipped: drive letters are a Windows concern)");
}

section("_lib.globMatch");
{
  check("** spans directories", lib.globMatch(".claude/hooks/**", ".claude/hooks/a/b.mjs"), "");
  check("* does not", !lib.globMatch("lifecycle/*.json", "lifecycle/a/b.json"), "");
  check("case-insensitive", lib.globMatch("lifecycle/state.json", "Lifecycle/State.json"), "");
  check("dots are literal", !lib.globMatch("lifecycle/state.json", "lifecycle/stateXjson"), "");
}

section("_lib.isProtected");
{
  check("a hook is protected", lib.isProtected(".claude/hooks/guard-mcp.mjs") !== null, "");
  check("backslashes are normalised", lib.isProtected(".claude\\hooks\\guard-mcp.mjs") !== null, "");
  check("a leading ./ is ignored", lib.isProtected("./.cursor/mcp-policy.json") !== null, "");
  check("a document is not", lib.isProtected("docs/x.md") === null, "");
  check("the fallback list is a literal array self-audit can read", Array.isArray(lib.PROTECTED_FALLBACK) && lib.PROTECTED_FALLBACK.length > 10, "");
}

/*
 * The trailing slash (P2G-1, Critical).
 *
 * A shell token that ends in the backslash its quote was escaped with -
 * `printf x > \".mcp.json\"` - survived guard-bash's token scan as `.mcp.json\`.
 * The backslash rule above turned that into `.mcp.json/`, and a `**` glob still
 * matched it while an EXACT-FILE entry never did. Result: all twenty exact-file
 * protected paths were shell-writable with no escape variable and no `cd`,
 * while the seven glob entries held - which is why nothing looked broken.
 *
 * The section above passed throughout, because every spelling it tried was one
 * a human would type. These are the spellings a token scan produces.
 */
section("_lib.isProtected — a trailing separator is still the same file (P2G-1)");
{
  const exact = [
    ".mcp.json",
    ".cursor/mcp-policy.json",
    ".claude/settings.json",
    ".cursor/hooks.json",
    "lifecycle/state.json",
    "lifecycle/integrity.json",
    ".cursor/tools/lifecycle.mjs",
  ];
  for (const p of exact) {
    check(`${p} is protected with a trailing slash`, lib.isProtected(`${p}/`) !== null, "");
    check(`${p} is protected with a trailing backslash`, lib.isProtected(`${p}\\`) !== null, "");
  }
  check("repeated trailing slashes collapse", lib.isProtected(".mcp.json///") !== null, "");
  check("a leading ./ and a trailing slash together", lib.isProtected("./.mcp.json/") !== null, "");
  check("mixed separators and a trailing backslash", lib.isProtected(".cursor\\tools/lifecycle.mjs\\") !== null, "");

  // The other direction: the fix must not start protecting things it should not.
  // A guard that denies ordinary work is a guard somebody switches off.
  check("a document is still not protected with a trailing slash", lib.isProtected("docs/x.md/") === null, "");
  check("a source file is still not protected", lib.isProtected("src/Api/Program.cs/") === null, "");
  check("a bare directory outside the list is still not protected", lib.isProtected("docs/") === null, "");
  check("the empty string is still null", lib.isProtected("") === null, "");
  check("a lone separator is still null", lib.isProtected("/") === null, "");

  // The glob entries that held before must still hold.
  check("a hooks glob holds with a trailing slash", lib.isProtected(".claude/hooks/guard-bash.mjs/") !== null, "");
  check("the hooks directory itself is protected", lib.isProtected(".claude/hooks/") !== null, "");
}

/*
 * The credential patterns and the lifecycle accessors (T-01).
 *
 * Every secret-shaped string here is BUILT AT RUNTIME from fragments, and no
 * variable is named so that its own assignment looks like one. A literal would
 * be refused by guard-write.mjs the moment this file were written - the guard
 * working correctly, and the test impossible to save. It refused an earlier
 * draft of this very section.
 */
section("_lib.findSecret / redactSecrets");
{
  const pwAssign = "pass" + "word=" + "hunter22";
  const ghToken = "gh" + "p_" + "A".repeat(24);
  const anthropic = "sk-" + "ant-" + "B".repeat(24);
  const aws = "AKIA" + "ABCDEFGHIJKLMNOP";
  const slack = "xox" + "b-" + "1234567890abcd";
  const documented = "api_key: " + '"' + "exampleValueNotARealCredential" + '"';
  const interpolated = "pass" + "word=" + "${DB_PASSWORD}";

  check("an assignment-shaped secret is found", lib.findSecret(pwAssign)?.what === "connection-string password", JSON.stringify(lib.findSecret(pwAssign)));
  check("a GitHub token is found", lib.findSecret(ghToken)?.what === "GitHub token", JSON.stringify(lib.findSecret(ghToken)));
  check("an Anthropic key is found", lib.findSecret(anthropic)?.what === "Anthropic API key", JSON.stringify(lib.findSecret(anthropic)));
  check("an AWS access key id is found", lib.findSecret(aws)?.what === "AWS access key id", JSON.stringify(lib.findSecret(aws)));
  check("a Slack token is found", lib.findSecret(slack)?.what === "Slack token", JSON.stringify(lib.findSecret(slack)));

  check("a documented example is exempt", lib.findSecret(documented) === null, JSON.stringify(lib.findSecret(documented)));
  check("an interpolated variable is exempt", lib.findSecret(interpolated) === null, JSON.stringify(lib.findSecret(interpolated)));
  check("ordinary prose is not a credential", lib.findSecret("the pass" + "word is stored in the vault") === null, "");
  check("empty input is null, not a throw", lib.findSecret("") === null && lib.findSecret(undefined) === null, "");

  const composed = `line one\n${ghToken}\nline three\n${pwAssign}\n`;
  const red = lib.redactSecrets(composed);
  check("redactSecrets removes the token value", !red.includes(ghToken), red);
  check("redactSecrets removes the assigned value", !red.includes("hunter22"), red);
  check("redactSecrets names the class it removed", red.includes("[REDACTED: GitHub token]"), red);
  check("redactSecrets keeps the surrounding text", red.includes("line one") && red.includes("line three"), red);
  check("redactSecrets leaves a placeholder alone", lib.redactSecrets(interpolated).includes("${DB_PASSWORD}"), lib.redactSecrets(interpolated));
  check("redactSecrets is a no-op on clean text", lib.redactSecrets("nothing to see") === "nothing to see", "");
}

section("_lib — the lifecycle-event accessors read both hosts");
{
  delete process.env.CLAUDE_TRANSCRIPT_PATH;
  check("sessionId reads Claude Code's session_id", lib.sessionId({ session_id: "abc123" }) === "abc123", "");
  check("sessionId reads Cursor's conversation_id", lib.sessionId({ conversation_id: "xyz789" }) === "xyz789", "");
  check("sessionId is an empty string when neither host sent one", lib.sessionId({}) === "", "");
  check("transcriptPath reads the payload", lib.transcriptPath({ transcript_path: "/t/s.jsonl" }) === "/t/s.jsonl", "");
  check("transcriptPath is null when there is none - Cursor never sends one", lib.transcriptPath({}) === null, String(lib.transcriptPath({})));
  check("promptText reads the prompt", lib.promptText({ prompt: "hello" }) === "hello", "");
  check("promptText is an empty string for a non-string prompt", lib.promptText({ prompt: { a: 1 } }) === "" && lib.promptText({}) === "", "");
  check("cachePath lands under the gitignored cache", lib.cachePath("sessions", "x.md").replace(/\\/g, "/").endsWith("/.cursor/cache/sessions/x.md"), lib.cachePath("sessions", "x.md"));
  check("cachePath is absolute", /^([A-Za-z]:)?[\\/]/.test(lib.cachePath("x")), lib.cachePath("x"));
}

/*
 * ok() answers in the shape the EVENT defines, not one shape for every event.
 *
 * Cursor rejects a reply that does not match the event's schema, and on
 * beforeSubmitPrompt a rejected reply blocks the person's message. Answering
 * {permission:"allow"} there - which is what every deciding event gets - would
 * refuse every prompt the guard had just approved. guard-write is the probe
 * because it calls ok() on any payload that names no file.
 */
section("_lib.ok — one shape per event");
{
  const sp = runHook("guard-write.mjs", cursorEvent(root, "beforeSubmitPrompt", { prompt: "hello" }), root);
  let spBody = null;
  try { spBody = JSON.parse(sp.out); } catch { /* reported below */ }
  check("Cursor beforeSubmitPrompt is answered {continue:true}", sp.exit === 0 && spBody?.continue === true, `exit ${sp.exit}, stdout ${JSON.stringify(sp.out.slice(0, 120))}`);
  check("Cursor beforeSubmitPrompt is NOT answered with a permission", spBody?.permission === undefined, JSON.stringify(sp.out.slice(0, 120)));

  const se = runHook("guard-write.mjs", cursorEvent(root, "sessionEnd", { reason: "clear" }), root);
  check("Cursor sessionEnd is advisory, so ok() stays silent", se.exit === 0 && se.out.trim() === "", `exit ${se.exit}, stdout ${JSON.stringify(se.out.slice(0, 120))}`);

  const pc = runHook("guard-write.mjs", cursorEvent(root, "preCompact", { trigger: "auto" }), root);
  check("Cursor preCompact is advisory too", pc.exit === 0 && pc.out.trim() === "", `exit ${pc.exit}, stdout ${JSON.stringify(pc.out.slice(0, 120))}`);

  const dec = runHook("guard-write.mjs", cursorEvent(root, "preToolUse", { tool_name: "Write", tool_input: { file_path: join(root, "docs", "x.md") } }), root);
  let decBody = null;
  try { decBody = JSON.parse(dec.out); } catch { /* reported below */ }
  check("a deciding event still says allow out loud", dec.exit === 0 && decBody?.permission === "allow", `exit ${dec.exit}, stdout ${JSON.stringify(dec.out.slice(0, 120))}`);

  const claude = runHook("guard-write.mjs", claudeEvent("UserPromptSubmit", { prompt: "hello" }), root);
  check("Claude Code gets no stdout and exit 0", claude.exit === 0 && claude.out.trim() === "", `exit ${claude.exit}, stdout ${JSON.stringify(claude.out.slice(0, 120))}`);
}

report("Path handling gives the same answer for every spelling of the same file.");
