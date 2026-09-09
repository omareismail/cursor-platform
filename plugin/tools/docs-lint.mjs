#!/usr/bin/env node
/**
 * docs-lint.mjs — structural integrity of the documentation graph.
 *
 * WHY THIS EXISTS
 *
 * Agent configuration is the only part of a repository with no compiler and no
 * tests. A skill renamed but still referenced in START-HERE.md, a doc linking to
 * a deleted file, a stated count that drifted — none of these break anything
 * loudly. They just quietly make the platform wrong, and the failure mode is
 * "the agent seems worse lately", which nobody files a bug for.
 *
 * The proof this was needed is that the same checks were run by hand three times
 * during recent work on this repo. Anything checked by hand three times should
 * be a script.
 *
 * NOT the same as `docs-guard`. That skill asks whether a document's claims
 * about the CODE are still true — semantic, agent-run, needs judgement. This
 * asks whether the DOCUMENT GRAPH itself is intact — structural, mechanical,
 * runs in a second.
 *
 * WHAT IT CHECKS
 *
 *   broken-link    a relative link whose target does not exist        FAIL
 *   ghost-skill    a /skill-name reference with no such skill         FAIL
 *   ghost-tool     a .cursor/tools/x.mjs reference with no such tool  FAIL
 *   stale-count    "N skills" where N is not the real count           FAIL
 *   orphan         a doc nothing links to                             warn
 *   dup-heading    the same H1 in two docs - a sign of a fork         warn
 *   long-line      >120 chars outside code fences                     warn (--strict fails)
 *
 * Usage:
 *   node .cursor/tools/docs-lint.mjs check [--json] [--strict]
 *   node .cursor/tools/docs-lint.mjs graph          # who links to what
 *
 * Exit codes:  0 = clean   1 = errors found   2 = usage
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { report, emit, finding } from "./_findings.mjs";
import { join, dirname, relative, normalize } from "node:path";

const ROOT = process.env.CLAUDE_PROJECT_DIR || repoRoot() || process.cwd();
const SKIP = /(^|\/)(node_modules|\.git|bin|obj|dist|coverage)(\/|$)/;

/**
 * Generated trees. `.claude/skills/**` is the shims from sync-skills.mjs;
 * `plugin/**` is the distributable built by build-plugin.mjs. If a generator's
 * template is wrong every output file is wrong, and the fix is to re-run the
 * generator, not to lint what it produced. Reading them costs most of this
 * tool's runtime and produces no finding anyone can act on.
 */
const GENERATED = /^(\.claude\/skills|plugin)\//;

/** Docs written as point-in-time records. Their counts are deliberately frozen. */
const HISTORICAL = /(ENTERPRISE_MATURITY_REPORT|GOVERNANCE_REPORT|MIGRATION_NOTES|PHASE\d|PROPOSAL-REVIEW)/i;

/**
 * `/word` in backticks is not always a skill. Two other things look identical:
 * Claude Code's own CLI commands, and HTTP paths. Flagging either produces noise
 * that trains people to ignore the check.
 */
const BUILTIN_COMMANDS = new Set([
  "skills", "agents", "help", "clear", "init", "compact", "review", "config",
  "model", "cost", "memory", "resume", "doctor", "login", "logout", "mcp",
]);
const URL_PATHS = new Set([
  "health", "healthz", "ready", "readyz", "live", "livez", "metrics", "api",
  "swagger", "openapi", "docs", "status", "ping", "version",
]);

// ------------------------------------------------------------------ utils --
function repoRoot() {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { stdio: "pipe" }).toString().trim(); }
  catch { return null; }
}
/**
 * Markdown files in the repo.
 *
 * `git ls-files` first: one process, and it already respects .gitignore. The
 * directory walk is the fallback for a non-git checkout - and it uses
 * withFileTypes so there is no separate stat syscall per entry, which on a
 * network or mounted filesystem is the difference between 0.3s and 40s.
 */
function markdownFiles() {
  try {
    // --cached --others --exclude-standard: tracked AND untracked-but-not-ignored.
    // Plain `ls-files` misses every file added since the last commit, which on a
    // freshly-edited repo is exactly the set most likely to contain a broken link.
    const listed = execFileSync("git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "*.md", "**/*.md"], {
      cwd: ROOT, stdio: "pipe", maxBuffer: 64 * 1024 * 1024,
    }).toString().split("\n").filter(Boolean);
    const md = [...new Set(listed)]
      .filter(f => f.endsWith(".md") && !SKIP.test("/" + f) && !GENERATED.test(f));
    if (md.length) return md;
  } catch { /* not a git repo, or git unavailable */ }
  return walk(ROOT);
}

function walk(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = join(dir, e.name);
    const rel = relative(ROOT, full).split("\\").join("/");
    if (SKIP.test("/" + rel) || GENERATED.test(rel)) continue;
    if (e.isDirectory()) walk(full, acc);
    else if (e.name.endsWith(".md")) acc.push(rel);
  }
  return acc;
}
const out = (s = "") => process.stdout.write(s + "\n");
const pad = (s, n) => String(s).slice(0, n - 1).padEnd(n);
function fail(msg, code = 2) { process.stderr.write(msg + "\n"); process.exit(code); }

/** Strip fenced and inline code so checks do not fire on examples. */
function stripCode(text) {
  return text.replace(/```[\s\S]*?```/g, m => m.replace(/[^\n]/g, " "))
             .replace(/`[^`\n]*`/g, m => " ".repeat(m.length));
}

/**
 * Line number from a character offset, via binary search over precomputed line
 * starts. The obvious `text.slice(0, i).split("\n").length` is O(n) per lookup
 * and O(n^2) per file - fine at 200 lines, and the reason this tool started
 * timing out once the docs grew.
 */
function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (offset) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

// ------------------------------------------------------------------ scan ---
function scan() {
  const docs = markdownFiles();
  const skills = new Set(
    existsSync(join(ROOT, ".cursor/skills"))
      ? readdirSync(join(ROOT, ".cursor/skills")).filter(d => existsSync(join(ROOT, ".cursor/skills", d, "skill.md")))
      : []);
  const tools = new Set(
    existsSync(join(ROOT, ".cursor/tools"))
      ? readdirSync(join(ROOT, ".cursor/tools")).filter(f => f.endsWith(".mjs"))
      : []);
  const agents = new Set(
    existsSync(join(ROOT, ".claude/agents"))
      ? readdirSync(join(ROOT, ".claude/agents")).filter(f => f.endsWith(".md")).map(f => f.replace(/\.md$/, ""))
      : []);

  const errors = [], warnings = [];
  const linkedTo = new Set();
  const headings = new Map();
  const E = (file, line, kind, msg) => errors.push({ file, line, kind, msg });
  const W = (file, line, kind, msg) => warnings.push({ file, line, kind, msg });

  for (const rel of docs) {
    let raw; try { raw = readFileSync(join(ROOT, rel), "utf8"); } catch { continue; }
    const clean = stripCode(raw);
    // `\r?\n`, not `\n`. On a Windows checkout every line keeps a trailing
    // carriage return, so `lines[0] === "---"` was false for every file in the
    // repo and the frontmatter skip below never engaged — which is why 48
    // `description:` lines, each of which MUST be one line for YAML to parse,
    // were reported as too long. The check was right; the line endings defeated
    // it, silently, for every developer on Windows.
    const lines = raw.split(/\r?\n/);
    const lineOf = lineIndex(raw);

    // --- H1, for duplicate detection -------------------------------------
    const h1 = raw.match(/^#\s+(.+)$/m);
    if (h1) {
      const key = h1[1].trim().toLowerCase();
      if (!headings.has(key)) headings.set(key, []);
      headings.get(key).push(rel);
    }

    // --- relative links ---------------------------------------------------
    for (const m of clean.matchAll(/\[[^\]]*\]\((?!https?:|mailto:|#)([^)\s]+)\)/g)) {
      const target = m[1].split("#")[0];
      if (!target) continue;
      const resolved = normalize(join(dirname(rel), target)).split("\\").join("/");
      linkedTo.add(resolved);
      if (!existsSync(join(ROOT, resolved)) && !existsSync(join(ROOT, target))) {
        E(rel, lineOf(m.index), "broken-link", `link target does not exist: ${target}`);
      }
    }

    // --- /skill-name references ------------------------------------------
    // Only inside backticks, which is how every doc here writes them - a bare
    // slash-word in prose is usually a path fragment, not a skill.
    for (const m of raw.matchAll(/`\/([a-z][a-z0-9-]{2,})`/g)) {
      const name = m[1];
      if (skills.has(name) || agents.has(name)) continue;
      if (tools.has(name + ".mjs")) continue;
      if (BUILTIN_COMMANDS.has(name) || URL_PATHS.has(name)) continue;
      E(rel, lineOf(m.index), "ghost-skill", `/${name} is referenced but no such skill exists`);
    }

    // --- tool references --------------------------------------------------
    for (const m of raw.matchAll(/\.cursor\/tools\/([\w.-]+\.mjs)/g)) {
      if (!tools.has(m[1])) E(rel, lineOf(m.index), "ghost-tool", `${m[1]} does not exist in .cursor/tools/`);
    }

    // --- stated counts ----------------------------------------------------
    if (!HISTORICAL.test(rel)) {
      const counts = [
        [/\b(\d{2,3})\s+(?:slash-command\s+)?skills\b/gi, skills.size, "skills"],
        [/\b(\d{1,2})\s+subagents\b/gi, agents.size, "subagents"],
        [/\ball\s+(\d{2,3})\s+skills\b/gi, skills.size, "skills"],
      ];
      for (const [re, actual, label] of counts) {
        for (const m of clean.matchAll(re)) {
          if (Number(m[1]) !== actual) {
            E(rel, lineOf(m.index), "stale-count", `says ${m[1]} ${label}, actual is ${actual}`);
          }
        }
      }
    }

    // --- long lines -------------------------------------------------------
    const DELIM = /^---\s*$/;
    let inFence = false, inFrontmatter = DELIM.test(lines[0] || "");
    lines.forEach((l, i) => {
      // YAML frontmatter must hold `description:` on one line - not a finding.
      if (inFrontmatter) { if (i > 0 && DELIM.test(l)) inFrontmatter = false; return; }
      if (/^\s*```/.test(l)) { inFence = !inFence; return; }
      if (inFence) return;
      if (l.length > 120 && !/^\s*\|/.test(l) && !/https?:\/\//.test(l)) {
        W(rel, i + 1, "long-line", `${l.length} chars`);
      }
    });
  }

  // --- orphans ------------------------------------------------------------
  // Entry points and discovered artifacts. Claude Code finds agents and skill
  // shims by scanning the directory; nothing links to them and nothing should.
  const ENTRY = /^(README|CLAUDE|AGENTS|HANDBOOK)\.md$|^memory-bank\/|^\.claude\/(skills|agents)\/|^\.cursor\/skills\//;
  for (const rel of docs) {
    if (ENTRY.test(rel)) continue;
    if (linkedTo.has(rel)) continue;
    W(rel, 1, "orphan", "no other document links here");
  }

  // --- duplicate H1 -------------------------------------------------------
  for (const [title, files] of headings) {
    const real = files.filter(f => !f.startsWith(".claude/skills/") && !f.startsWith(".cursor/skills/"));
    if (real.length > 1) {
      W(real[0], 1, "dup-heading", `"${title}" is also the H1 of ${real.slice(1).join(", ")} - a fork?`);
    }
  }

  return { docs, skills: skills.size, tools: tools.size, agents: agents.size, errors, warnings };
}

// -------------------------------------------------------------- commands ---
const CMDS = {
  check(args) {
    const r = scan();
    const strict = args.includes("--strict");
    if (args.includes("--json")) {
      const code = (k) => String(k || "lint").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "lint";
      const findings = [
        ...r.errors.map((e) => finding("block", code(e.kind), e.msg, { file: e.file, line: e.line })),
        ...r.warnings.map((w) => finding(strict ? "block" : "warn", code(w.kind), w.msg, { file: w.file, line: w.line })),
      ];
      const bad = r.errors.length + (strict ? r.warnings.length : 0);
      return emit(report({
        tool: "docs-lint.mjs", command: "check", findings,
        summary: bad ? `FAILED: ${r.errors.length} error(s), ${r.warnings.length} warning(s)${strict ? " (strict)" : ""}` : `OK: ${r.docs.length} markdown files, ${r.warnings.length} warning(s)`,
        data: r,
      }));
    }

    out(`# Docs lint\n`);
    out(`  ${r.docs.length} markdown files | ${r.skills} skills, ${r.tools} tools, ${r.agents} agents\n`);

    const byKind = (list) => list.reduce((m, x) => ((m[x.kind] ||= []).push(x), m), {});
    const eK = byKind(r.errors), wK = byKind(r.warnings);

    for (const [kind, items] of Object.entries(eK)) {
      out(`## ${kind.toUpperCase()} (${items.length})`);
      for (const e of items) out(`  ${pad(e.file + ":" + e.line, 46)} ${e.msg}`);
      out("");
    }
    for (const [kind, items] of Object.entries(wK)) {
      const show = kind === "long-line" ? 5 : 12;
      out(`## ${kind} (${items.length})${strict ? " [FAILS in --strict]" : ""}`);
      for (const w of items.slice(0, show)) out(`  ${pad(w.file + ":" + w.line, 46)} ${w.msg}`);
      if (items.length > show) out(`  ... and ${items.length - show} more`);
      out("");
    }

    if (r.errors.length) {
      out(`FAILED: ${r.errors.length} error(s), ${r.warnings.length} warning(s).`);
      out(`A broken link or a ghost skill reference sends the next reader - human or`);
      out(`agent - somewhere that does not exist. Nothing else in the repo catches it.`);
      return 1;
    }
    if (strict && r.warnings.length) {
      out(`FAILED (--strict): ${r.warnings.length} warning(s).`);
      return 1;
    }
    out(`OK: no broken links, ghost references or stale counts. ${r.warnings.length} warning(s).`);
    return 0;
  },

  graph() {
    const docs = markdownFiles().filter(d => !d.startsWith(".claude/skills/") && !d.startsWith(".cursor/skills/"));
    const edges = new Map();
    for (const rel of docs) {
      let raw; try { raw = readFileSync(join(ROOT, rel), "utf8"); } catch { continue; }
      const targets = new Set();
      for (const m of stripCode(raw).matchAll(/\[[^\]]*\]\((?!https?:|mailto:|#)([^)\s]+)\)/g)) {
        const t = normalize(join(dirname(rel), m[1].split("#")[0])).split("\\").join("/");
        if (t.endsWith(".md")) targets.add(t);
      }
      edges.set(rel, [...targets]);
    }
    out(`# Documentation graph\n`);
    for (const [from, tos] of [...edges].sort()) {
      if (!tos.length) continue;
      out(`  ${from}`);
      for (const t of tos) out(`    -> ${t}`);
    }
    const inbound = new Map();
    for (const tos of edges.values()) for (const t of tos) inbound.set(t, (inbound.get(t) || 0) + 1);
    out(`\n  Most linked-to:`);
    for (const [d, n] of [...inbound].sort((a, b) => b[1] - a[1]).slice(0, 8)) out(`    ${String(n).padStart(3)}x  ${d}`);
    return 0;
  },
};

const [cmd, ...args] = process.argv.slice(2);
if (!cmd || !CMDS[cmd]) {
  out(readFileSync(new URL(import.meta.url)).toString()
    .split("\n").slice(2, 40).join("\n").replace(/^\s*\*\/?\s?/gm, "").trim());
  process.exit(cmd ? 2 : 0);
}
process.exit(CMDS[cmd](args) ?? 0);
