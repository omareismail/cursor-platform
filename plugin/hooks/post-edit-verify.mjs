#!/usr/bin/env node
// PostToolUse: Write | Edit | MultiEdit
// Fast, deterministic checks on the file that was just written. Complements -
// does not replace - the real build gates in templates/ (analyzers, ESLint,
// architecture tests, CI). Those run on the whole repo; this runs in <1s on one
// file so the agent gets feedback before it moves on.
//
// Opt-in heavier checks:
//   CLAUDE_HOOK_DOTNET_FORMAT=1   run `dotnet format` on touched .cs files
//   CLAUDE_HOOK_ESLINT=1          run `eslint --fix` on touched .ts/.tsx files

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relPath, targetPath, readPayload, projectDir, ok } from "./_lib.mjs";

const p = await readPayload();
const rel = relPath(targetPath(p));
const abs = targetPath(p);
if (!rel) ok();

let src = "";
try { src = readFileSync(abs, "utf8"); } catch { ok(); }

const lines = src.split("\n");
const findings = [];
const hit = (re, msg, rule, guard) => {
  lines.forEach((l, i) => {
    if (re.test(l) && !(guard && guard(l))) findings.push(`${rel}:${i + 1}  ${msg}  [${rule}]`);
  });
};

const isCs   = /\.cs$/i.test(rel);
const isTsx  = /\.(tsx|jsx)$/i.test(rel);
const isTs   = /\.(ts|tsx|js|jsx)$/i.test(rel);
const isCss  = /\.(css|scss)$/i.test(rel);
const isTest = /(\.test\.|\.spec\.|Tests?\/|__tests__)/i.test(rel);

// ---------------------------------------------------------------- .NET ------
if (isCs && !isTest) {
  hit(/\b(float|double)\s+\w*(amount|price|total|balance|fee|rate|cost|salary|premium|payment)/i,
      "floating-point type on a monetary field - use decimal", "07-audit-trail-guard");
  hit(/\bDateTime\.(Now|Today)\b/,
      "DateTime.Now - use DateTimeOffset.UtcNow", "codingStandards");
  hit(/\.(Result|GetAwaiter\(\)\.GetResult\(\))\s*[;,)]|\.Wait\(\)\s*;/,
      "sync-over-async - await instead (deadlock + thread-pool starvation risk)", "02-dotnet-architecture-guard");
  hit(/\basync\s+void\s+(?!Main)/,
      "async void - use async Task (exceptions are unobservable)", "02-dotnet-architecture-guard");
  hit(/(FromSqlRaw|ExecuteSqlRaw|CommandText\s*=)\s*[^;]*\$"/,
      "interpolated string in raw SQL - parameterize", "06-database-provider-guard");
  hit(/new\s+SqlCommand\s*\(\s*[^,)]*\+/,
      "concatenated SQL - parameterize", "06-database-provider-guard");
  if (/\/(Application|Handlers|UseCases)\//i.test(rel)) {
    hit(/\b\w*DbContext\b/,
        "DbContext referenced from the Application layer - go through a repository/abstraction",
        "02-dotnet-architecture-guard");
  }
  if (/\.API\/|\/Controllers\/|\/Endpoints\//i.test(rel)) {
    hit(/using\s+[\w.]*\.Infrastructure/,
        "API layer importing Infrastructure - API depends on Application only",
        "02-dotnet-architecture-guard");
  }
  hit(/\b(Map(Get|Post|Put|Delete|Patch)|\[Http(Get|Post|Put|Delete|Patch)\])/,
      "endpoint declared - confirm [Authorize] or a justified [AllowAnonymous] is present",
      "04-security-guard",
      () => /Authorize|AllowAnonymous|RequireAuthorization/.test(src));
}

// ------------------------------------------------------------- React/TS -----
if (isTs && !isTest) {
  const isComponent = isTsx && !/\/(api|services|lib|hooks|utils|store)\//i.test(rel);
  if (isComponent) {
    hit(/\b(fetch\s*\(|axios\s*\.\s*(get|post|put|delete|patch)|axios\s*\()/,
        "direct HTTP call in a component - route through the API layer + React Query",
        "03-react-architecture-guard");
  }
  hit(/\b(localStorage|sessionStorage)\.setItem\s*\(\s*["'][^"']*(token|jwt|auth|refresh)/i,
      "auth token in web storage - use an HttpOnly cookie", "04-security-guard");
  hit(/dangerouslySetInnerHTML/,
      "dangerouslySetInnerHTML - sanitize (DOMPurify) or remove", "04-security-guard",
      (l) => /sanitiz|DOMPurify/i.test(l) || /sanitiz|DOMPurify/i.test(src));
  hit(/(?:VITE_|NEXT_PUBLIC_)\w*(SECRET|KEY|TOKEN|PASSWORD)/i,
      "secret in a client-exposed env var - these ship to the browser", "04-security-guard");
  hit(/\bkey\s*=\s*\{\s*(i|idx|index)\s*\}/,
      "array index as React key - unstable across reorder", "03-react-architecture-guard");
  hit(/\.toLocaleString\s*\(\s*\)|\.toLocaleDateString\s*\(\s*\)|new Intl\.\w+\(\s*\)/,
      "locale-less formatting - pass an explicit locale (ar / en)", "08-rtl-i18n-guard");
}

// --------------------------------------------------------------- RTL --------
if (isTsx || isCss) {
  hit(/\b(margin|padding|border)-(left|right)\s*:|\b(margin|padding)(Left|Right)\s*:/,
      "physical property - use margin-inline-start/end (RTL safety)", "08-rtl-i18n-guard");
  hit(/\btext-align\s*:\s*(left|right)\b|textAlign\s*:\s*["'](left|right)["']/,
      "text-align: left/right - use start/end", "08-rtl-i18n-guard");
  hit(/^\s*(left|right)\s*:\s*[-\d]|(?<![\w-])(left|right)\s*:\s*["']?[-\d]/,
      "physical offset - use inset-inline-start/end", "08-rtl-i18n-guard");
}

// ------------------------------------------------------- optional tooling ---
const runQuiet = (file, args) => {
  try {
    execFileSync(file, args, { cwd: projectDir(), stdio: "pipe", timeout: 90_000, shell: process.platform === "win32" });
    return null;
  } catch (e) {
    return (e.stdout?.toString() || "") + (e.stderr?.toString() || "");
  }
};

if (isCs && process.env.CLAUDE_HOOK_DOTNET_FORMAT === "1") {
  const out = runQuiet("dotnet", ["format", "--include", rel, "--verbosity", "quiet"]);
  if (out) findings.push(`dotnet format reported issues on ${rel}:\n${out.slice(0, 800)}`);
}
if (isTs && process.env.CLAUDE_HOOK_ESLINT === "1") {
  const out = runQuiet("npx", ["--no-install", "eslint", "--fix", "--cache", rel]);
  if (out) findings.push(`eslint on ${rel}:\n${out.slice(0, 800)}`);
}

// ------------------------------------------------------------------ out -----
if (findings.length) {
  process.stderr.write(
    `Tripwires fired on ${rel} - fix these before continuing:\n\n` +
    findings.map(f => "  - " + f).join("\n") +
    `\n\nEach cites the .cursor/rules/ file that governs it. If a hit is a false ` +
    `positive, say so explicitly and move on; do not silently ignore it.\n`
  );
  process.exit(2);
}
process.exit(0);
