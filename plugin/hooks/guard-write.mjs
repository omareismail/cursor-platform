#!/usr/bin/env node
// PreToolUse: Write | Edit | MultiEdit | NotebookEdit
// Turns four prose rules into hard blocks.

import { readPayload, relPath, targetPath, writtenContent, block, ok } from "./_lib.mjs";

const p = await readPayload();
const file = relPath(targetPath(p));
const body = writtenContent(p);
if (!file) ok();

const lower = file.toLowerCase();

// 1. The cache layer is machine-owned (AGENTS.md: "never hand-edit").
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

// 2. Never write secret-bearing files.
if (/(^|\/)\.env(\.|$)/.test(lower) || /(^|\/)secrets?\.(json|ya?ml)$/.test(lower)) {
  block(`BLOCKED: ${file} holds secrets and must not be written by an agent.
Tell the user which key is needed and let them add it themselves.
(.cursor/rules/04-security-guard.mdc)`);
}

// 3. Tier 2 memory-bank files are human-authored standards.
const TIER2 = /^memory-bank\/(architecture|codingStandards|businessRules|technologyStack|databaseConventions|apiConventions|frontendConventions|backendConventions|securityStandards|performanceGuidelines|testingStandards|deploymentNotes|decisionLog|commonMistakes|glossary)\.md$/i;
if (TIER2.test(file) && !process.env.CLAUDE_ALLOW_TIER2_EDIT) {
  block(`BLOCKED: ${file} is a Tier 2 (human-authored) memory-bank standard.
Agents read these; they do not rewrite them. Propose the change to the user in
chat instead. If the user explicitly asked for this edit, they can re-run with
CLAUDE_ALLOW_TIER2_EDIT=1 set.`);
}

// 4. Hardcoded credentials in the content being written.
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
