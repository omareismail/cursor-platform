#!/usr/bin/env node
// PreToolUse: Write | Edit | MultiEdit | NotebookEdit
// Turns the always-on prose rules into hard blocks.

import { readPayload, relPath, targetPath, writtenContent, block, ok } from "./_lib.mjs";

const p = await readPayload();
const file = relPath(targetPath(p));
const body = writtenContent(p);
if (!file) ok();

const lower = file.toLowerCase();

// 1. The structural cache is machine-owned (AGENTS.md: "never hand-edit").
if (lower.endsWith(".cursor/cache/repo-map.json")) {
  block(`BLOCKED: .cursor/cache/repo-map.json is generated and owned by /repo-discovery.
Hand-editing it makes every downstream skill trust wrong data.
Run \`/repo-discovery\` (or delegate to the repo-cartographer subagent) instead.`);
}

// 2. Generated skill shims are regenerated, never hand-edited.
if (/^\.claude\/skills\/[^/]+\/skill\.md$/i.test(lower)) {
  block(`BLOCKED: ${file} is a generated shim. Edit the canonical
.cursor/skills/<name>/skill.md instead and run
\`node .claude/hooks/sync-skills.mjs\` to regenerate the shim.`);
}

// 3. Never write secret-bearing files.
if (/(^|\/)\.env(\.|$)/.test(lower) || /(^|\/)secrets?\.(json|ya?ml)$/.test(lower)) {
  block(`BLOCKED: ${file} holds secrets and must not be written by an agent.
Tell the user which key is needed and let them add it themselves.
(.cursor/rules/03-flutter-security-guard.mdc)`);
}

// 4. Tier 2 memory-bank files are human-authored standards.
const TIER2 = /^memory-bank\/(architecture|domainRules|securityStandards)\.md$/i;
if (TIER2.test(file) && !process.env.CLAUDE_ALLOW_TIER2_EDIT) {
  block(`BLOCKED: ${file} is a Tier 2 (human-authored) memory-bank standard.
Agents read these; they do not rewrite them. Propose the change to the user in
chat instead. If the user explicitly asked for this edit, they can re-run with
CLAUDE_ALLOW_TIER2_EDIT=1 set.`);
}

// 5. Hardcoded credentials in the content being written.
if (body) {
  const secretPatterns = [
    [/(?:api[_-]?key|apikey|secret|client[_-]?secret|access[_-]?token)\s*[:=]\s*["'][A-Za-z0-9_\-\/+]{16,}["']/i, "hardcoded API key/secret"],
    [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key material"],
    [/\bBearer\s+eyJ[A-Za-z0-9_\-]{20,}/, "hardcoded JWT"],
  ];
  for (const [re, what] of secretPatterns) {
    const m = body.match(re);
    if (m && !/\$\{|\{\{|<YOUR|placeholder|example|REDACTED|env:|dart-define/i.test(m[0])) {
      block(`BLOCKED: ${what} detected in the content being written to ${file}.
Match: ${m[0].slice(0, 60)}...
Use --dart-define / flutter_secure_storage / environment configuration.
Never inline credentials. (.cursor/rules/03-flutter-security-guard.mdc)`);
    }
  }
}

ok();
