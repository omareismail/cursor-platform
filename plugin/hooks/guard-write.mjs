#!/usr/bin/env node
// Claude Code: PreToolUse (Write | Edit | MultiEdit | NotebookEdit)   |   Cursor: preToolUse (every tool, incl. Delete)
// Turns four prose rules into hard blocks, and keeps the hands off the enforcement surface.

import { readPayload, relPath, targetPath, writtenContent, isProtected, platformDev, block, ok } from "./_lib.mjs";

const p = await readPayload();
const file = relPath(targetPath(p));
const body = writtenContent(p);
if (!file) ok();

const lower = file.toLowerCase();

// 1. The cache layer is machine-owned (AGENTS.md: "never hand-edit"). These are
//    also on the protected list below; they come first because each message
//    names the tool that owns the file, which the generic refusal cannot. No
//    escape, not even CURSOR_PLATFORM_DEV - a platform developer uses the tool too.
if (lower.endsWith(".cursor/cache/repo-map.json")) {
  block(`BLOCKED: .cursor/cache/repo-map.json is generated and owned by /repo-discovery.
Hand-editing it makes every downstream skill trust wrong data.
Run \`/repo-discovery full\` (or delegate to the repo-cartographer subagent) instead.`);
}
if (lower.endsWith(".cursor/cache/feature-map.json")) {
  block(`BLOCKED: .cursor/cache/feature-map.json is generated and owned by /feature-trace,
/feature-inventory and /impact-analysis. Its freshness depends on content hashes the
tool stamps - a hand-edit silently breaks staleness detection for every feature.
Use the tool instead:
  node .cursor/tools/feature-map.mjs upsert /tmp/<feature-id>.json
  node .cursor/tools/feature-map.mjs rm <feature-id>`);
}

if (lower.endsWith("lifecycle/state.json")) {
  block(`BLOCKED: lifecycle/state.json is the product lifecycle state machine and is owned
by .cursor/tools/lifecycle.mjs. Hand-editing it lets a phase be marked approved
without the artifacts existing - which is the exact failure the gates prevent.
Use the tool instead:
  node .cursor/tools/lifecycle.mjs check <PHASE>
  node .cursor/tools/lifecycle.mjs approve <PHASE> --by "<name>"
  node .cursor/tools/lifecycle.mjs advance
  node .cursor/tools/lifecycle.mjs rollback <PHASE> --reason "..."`);
}

// 2. The enforcement surface: the hooks, their wiring, the policies they read,
//    the state machine they call and the records they produce. Every one of
//    these was writable by the same Write tool the hooks govern, which meant an
//    agent asked to try harder could edit the rule instead of obeying it -
//    `unlisted: "allow"` was one Edit away. The list is owned by
//    .cursor/lifecycle/write-policy.json (protected.paths) and unioned with a
//    fail-closed fallback in _lib.mjs; self-audit A11 keeps the two in step.
//
//    Delete counts as a write. Cursor has a Delete tool and this hook sees it on
//    preToolUse; a guard that only knows Write is a guard with a door beside it.
const hit = isProtected(file);
if (hit && !platformDev()) {
  block(`BLOCKED: ${file} is part of the enforcement surface and may not be written by an agent.

  matched:  ${hit}
  tool:     ${p.tool_name || "unknown"}
  policy:   .cursor/lifecycle/write-policy.json -> protected

An agent that can change the hooks, their wiring, the policies they read or the
records they produce can change the rules it is being held to. Propose the
change to the user in chat - show the exact diff - and let them make it.

A human developing the platform itself sets CURSOR_PLATFORM_DEV=1 in the
editor's environment. It is a variable and not a file because a file is
something an agent can write. Do not route around this with the shell; the
shell guard refuses the same paths.`);
}

// 3. Never write secret-bearing files.
if (/(^|\/)\.env(\.|$)/.test(lower) || /(^|\/)secrets?\.(json|ya?ml)$/.test(lower)) {
  block(`BLOCKED: ${file} holds secrets and must not be written by an agent.
Tell the user which key is needed and let them add it themselves.
(.cursor/rules/04-security-guard.mdc)`);
}

// 4. Tier 2 memory-bank files are human-authored standards.
//
// The list is owned by .cursor/tools/memory-bank.mjs. The regex below is a
// FAIL-CLOSED fallback, not a second source of truth: if the import fails for
// any reason this hook keeps blocking exactly what it blocked before, because a
// guard that stops guarding when an import breaks is the defect this whole
// platform exists to prevent. `self-audit` checks that the two still agree, so
// the redundancy is watched rather than merely tolerated.
const TIER2_FALLBACK = /^memory-bank\/(architecture|codingStandards|businessRules|technologyStack|databaseConventions|apiConventions|frontendConventions|backendConventions|securityStandards|performanceGuidelines|testingStandards|deploymentNotes|decisionLog|commonMistakes|glossary)\.md$/i;

let isTier2 = TIER2_FALLBACK.test(file);
// Two paths, because the hook sits at .claude/hooks/ in a repo and at
// plugin/hooks/ in an installed plugin - the same dual-path guard-phase.mjs
// uses. Anchoring on one of them means the import silently fails for every
// plugin install and the canonical list never reaches it.
const mbTool = await (async () => {
  for (const rel of ["../../.cursor/tools/memory-bank.mjs", "../tools/memory-bank.mjs"]) {
    try { return await import(new URL(rel, import.meta.url).href); } catch { /* try the next */ }
  }
  return null;
})();
if (mbTool) {
  const name = file.replace(/^memory-bank\//i, "");
  // Union, never replacement: the imported list may add a file, never remove
  // the protection from one the fallback already covers.
  isTier2 = isTier2 || mbTool.TIER2.some((f) => f.toLowerCase() === name.toLowerCase());
}

if (isTier2 && !process.env.CLAUDE_ALLOW_TIER2_EDIT) {
  block(`BLOCKED: ${file} is a Tier 2 (human-authored) memory-bank standard.
Agents read these; they do not rewrite them. Propose the change to the user in
chat instead. If the user explicitly asked for this edit, they can re-run with
CLAUDE_ALLOW_TIER2_EDIT=1 set.`);
}

// 5. Hardcoded credentials in the content being written.
if (body) {
  const secretPatterns = [
    [/(?:password|pwd)\s*=\s*["']?(?!\s*[{$<])[^"';\s]{4,}/i, "connection-string password"],
    [/(?:api[_-]?key|apikey|secret|client[_-]?secret|access[_-]?token)\s*[:=]\s*["'][A-Za-z0-9_\-\/+]{16,}["']/i, "hardcoded API key/secret"],
    [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key material"],
    [/\bBearer\s+eyJ[A-Za-z0-9_\-]{20,}/, "hardcoded JWT"],
  ];
  for (const [re, what] of secretPatterns) {
    const m = body.match(re);
    if (m && !/\$\{|\{\{|<YOUR|placeholder|example|REDACTED|env:/i.test(m[0])) {
      block(`BLOCKED: ${what} detected in the content being written to ${file}.
Match: ${m[0].slice(0, 60)}...
Use configuration/user-secrets/environment variables. Never inline credentials.
(.cursor/rules/04-security-guard.mdc)`);
    }
  }
}

ok();
