#!/usr/bin/env node
/**
 * change-verify.mjs — recommend checks for a change; do not replace the suite.
 *
 * Idea 8 first useful: recommendations only, with selected-vs-full comparison.
 *
 * Usage:
 *   node .cursor/tools/change-verify.mjs recommend [--json]
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.CLAUDE_PROJECT_DIR || repoRoot() || process.cwd();

function repoRoot() {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

function git(...args) {
  try { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
}

function changedFiles() {
  const staged = git("diff", "--cached", "--name-only");
  const unstaged = git("diff", "--name-only");
  const untracked = git("ls-files", "--others", "--exclude-standard");
  const set = new Set();
  for (const block of [staged, unstaged, untracked]) {
    for (const line of block.split(/\r?\n/)) if (line.trim()) set.add(line.trim().replace(/\\/g, "/"));
  }
  return [...set];
}

function loadMap() {
  const p = join(ROOT, ".cursor", "cache", "feature-map.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

export function recommend(root = ROOT) {
  const files = changedFiles();
  const map = loadMap();
  const selected = [];
  const why = [];
  const features = [];
  const uncertain = [];

  for (const f of files) {
    if (/\.(md|mdc)$/i.test(f)) {
      selected.push("docs-lint.mjs check");
      why.push({ check: "docs-lint.mjs check", file: f, reason: "markdown or rule changed" });
    }
    if (f.startsWith(".claude/hooks/") || f.startsWith(".cursor/tools/") || f.startsWith("tests/")) {
      selected.push("tests/run.mjs");
      why.push({ check: "tests/run.mjs", file: f, reason: "enforcement or tests changed — do not narrow" });
    }
    if (/\.cs$/.test(f)) {
      selected.push("fitness.mjs check");
      why.push({ check: "fitness.mjs check", file: f, reason: ".NET source changed" });
    }
    if (map?.index?.byFile) {
      const hits = map.index.byFile[f] || map.index.byFile[f.replace(/\\/g, "/")] || [];
      if (hits.length) features.push(...hits);
      else if (/\.(cs|ts|tsx)$/.test(f) && !f.startsWith("tests/")) {
        uncertain.push(f);
      }
    } else if (/\.(cs|ts|tsx)$/.test(f) && !f.startsWith("tests/")) {
      uncertain.push(f);
    }
  }

  const unique = [...new Set(selected)];
  const coverageTooUncertain = uncertain.length > 0 || !map;
  const fullSuite = "node tests/run.mjs";
  if (coverageTooUncertain && !unique.includes("tests/run.mjs")) {
    why.push({ check: fullSuite, file: uncertain[0] || "(no map)", reason: "coverage too uncertain to narrow the run" });
  }

  return {
    files,
    features: [...new Set(features)],
    selected: unique,
    why,
    uncertain,
    fullSuite,
    compare: {
      selectedCount: unique.length,
      fullSuite,
      automaticSelection: false,
      note: "Keep the broader release check until selection accuracy is measured against full-suite results.",
    },
  };
}

const invoked = (() => {
  try { return fileURLToPath(import.meta.url) === process.argv[1]; }
  catch { return false; }
})();
if (invoked) {
  const cmd = process.argv[2] || "recommend";
  if (cmd !== "recommend") {
    process.stderr.write("Usage: node .cursor/tools/change-verify.mjs recommend [--json]\n");
    process.exit(2);
  }
  const body = recommend(ROOT);
  if (process.argv.includes("--json")) process.stdout.write(JSON.stringify(body, null, 2) + "\n");
  else {
    process.stdout.write(`changed ${body.files.length} file(s)\n`);
    process.stdout.write(`selected: ${body.selected.join(", ") || "(none)"}\n`);
    process.stdout.write(`full suite remains: ${body.fullSuite}\n`);
    if (body.uncertain.length) process.stdout.write(`uncertain (untraced source): ${body.uncertain.join(", ")}\n`);
  }
}
