#!/usr/bin/env node
/**
 * _skills-index.mjs — machine-readable routing metadata for every skill.
 *
 * WHY THIS EXISTS
 *
 * Routing used to live only in skill-catalog.md. A new skill could ship
 * without a category, a phase or a requires-list, and nothing failed until
 * an agent picked the wrong announcement rule. This module *derives* the
 * index from `.cursor/skills/` plus the same category sets sync-skills.mjs
 * already used, writes `.cursor/skills.index.json`, and docs-lint fails when
 * the file is missing or stale. SessionStart prints a one-line capability
 * summary so the agent does not have to load the catalog to know the shape.
 *
 * Do not hand-edit the JSON. `node .claude/hooks/sync-skills.mjs` writes it;
 * `node .cursor/tools/_skills-index.mjs write` does the same.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const INDEX_VERSION = 1;
export const PHASES = ["REQUIREMENTS", "ANALYSIS", "DESIGN", "DEVELOPMENT", "TESTING", "PRODUCTION"];
export const CATEGORIES = ["A", "B", "C", "D", "E"];
export const CAPABILITIES = ["generate", "audit", "docs", "housekeeping", "specify"];
export const WORKFLOWS = ["dotnet", "react", "speckit", "lifecycle", "platform"];

export const CATEGORY_LABELS = {
  A: "A (generates/modifies files) - announce, then wait for go-ahead",
  B: "B (read-only analysis) - announce, then proceed",
  C: "C (docs/diagrams) - announce, then proceed",
  D: "D (housekeeping) - run silently, no announcement",
  E: "E (spec pipeline) - announce, then wait for go-ahead",
};

/** Absorbed into enterprise-report-gen. Kept here so lint can treat them as retired, not live. */
export const RETIRED = {
  "refactor-assistant": "Absorbed by enterprise-report-gen refactor",
  "security-perf-report": "Absorbed by enterprise-report-gen security-perf",
};

export const HOUSEKEEPING = new Set(["repo-discovery", "context-builder", "context-sync", "pattern-finder"]);
export const GENERATORS = new Set([
  "refactor-apply", "dotnet-migration", "work-breakdown", "postmortem", "release-safety",
  "lifecycle", "product-brief", "product-requirements", "user-story-map",
  "risk-register", "solution-architecture", "api-contract-design",
  "data-model-design", "ux-design-bridge", "test-strategy",
  "feature-pipeline", "go-live", "change-request",
]);
export const ANALYSIS = new Set([
  "feature-trace", "impact-analysis", "feature-inventory",
  "production-readiness-review", "delivery-metrics", "threat-model",
  "task-verify", "lifecycle-gate",
]);

/** Table rows under `### Category X` in skill-catalog.md. That document is the
 *  routing contract (announce/wait vs proceed). Suffix heuristics are fallback
 *  only for a fixture or a skill not yet listed. */
export function parseCatalogCategories(md) {
  const map = {};
  let cat = null;
  for (const line of String(md || "").split(/\r?\n/)) {
    const heading = line.match(/^###\s+Category\s+([A-E])\b/);
    if (heading) { cat = heading[1]; continue; }
    if (/^###\s+/.test(line)) { cat = null; continue; }
    if (!cat) continue;
    const row = line.match(/^\|\s*`([a-z][a-z0-9-]{2,})`\s*\|/);
    if (row) map[row[1]] = cat;
  }
  return map;
}

const catalogCache = new Map();
function catalogCategories(root) {
  const r = root || repoRoot();
  if (catalogCache.has(r)) return catalogCache.get(r);
  const p = join(r, ".cursor", "docs", "skill-catalog.md");
  let map = {};
  try { if (existsSync(p)) map = parseCatalogCategories(readFileSync(p, "utf8")); } catch { /* none */ }
  catalogCache.set(r, map);
  return map;
}

const PHASE_OF = {
  "product-brief": "REQUIREMENTS",
  "product-requirements": "REQUIREMENTS",
  "persona-gen": "REQUIREMENTS",
  "user-story-map": "REQUIREMENTS",
  "domain-model-gen": "ANALYSIS",
  "use-case-gen": "ANALYSIS",
  "business-rules-gen": "ANALYSIS",
  "risk-register": "ANALYSIS",
  "solution-architecture": "DESIGN",
  "api-contract-design": "DESIGN",
  "data-model-design": "DESIGN",
  "ux-design-bridge": "DESIGN",
  "threat-model": "DESIGN",
  "feature-pipeline": "DEVELOPMENT",
  "change-request": "DEVELOPMENT",
  "work-breakdown": "DEVELOPMENT",
  "refactor-apply": "DEVELOPMENT",
  "dotnet-migration": "DEVELOPMENT",
  "test-strategy": "TESTING",
  "e2e-test-gen": "TESTING",
  "dotnet-test-gen": "TESTING",
  "react-test-gen": "TESTING",
  "load-test-gen": "TESTING",
  "task-verify": "TESTING",
  "deployment-pipeline-gen": "PRODUCTION",
  "go-live": "PRODUCTION",
  "production-readiness-review": "PRODUCTION",
  "operability-gen": "PRODUCTION",
  "release-safety": "PRODUCTION",
  "postmortem": "PRODUCTION",
  "delivery-metrics": "PRODUCTION",
};

const DOCS_GENS = new Set([
  "changelog-gen", "release-notes-gen", "onboarding-doc-gen",
  "architecture-map-gen", "enterprise-report-gen",
]);
const PHASE_GENS = new Set(["persona-gen", "domain-model-gen", "use-case-gen", "business-rules-gen"]);

function repoRoot() {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { stdio: "pipe" }).toString().trim(); }
  catch { return process.cwd(); }
}

export function listSkills(root) {
  const dir = join(root, ".cursor", "skills");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => {
      try { return statSync(join(dir, n)).isDirectory() && existsSync(join(dir, n, "skill.md")); }
      catch { return false; }
    })
    .sort();
}

export function categoryOf(n, root) {
  const mapped = catalogCategories(root)[n];
  if (mapped) return mapped;
  if (n.startsWith("speckit-")) return "E";
  if (HOUSEKEEPING.has(n)) return "D";
  if (n.endsWith("-gen") || GENERATORS.has(n)) return "A";
  if (/audit|guard/.test(n) || ANALYSIS.has(n)) return "B";
  return "C";
}

export function categoryLabel(n, root) {
  return CATEGORY_LABELS[categoryOf(n, root)];
}

function capabilityOf(cat) {
  return { A: "generate", B: "audit", C: "docs", D: "housekeeping", E: "specify" }[cat];
}

function phaseOf(n) {
  if (PHASE_OF[n]) return PHASE_OF[n];
  if (n.startsWith("speckit-")) return "DEVELOPMENT";
  return null;
}

function workflowOf(n) {
  if (n.startsWith("dotnet-") || n === "database-audit") return "dotnet";
  if (n.startsWith("react-")) return "react";
  if (n.startsWith("speckit-")) return "speckit";
  if (PHASE_OF[n] || n === "lifecycle" || n === "lifecycle-gate" || n === "feature-pipeline") return "lifecycle";
  return "platform";
}

function requiresOf(n) {
  const req = [];
  if (n !== "repo-discovery" && (HOUSEKEEPING.has(n) || n === "pattern-finder")) req.push("repo-discovery");
  if (["feature-trace", "impact-analysis", "feature-inventory", "database-audit", "devops-audit", "api-consistency-audit", "code-review-assistant", "dotnet-schema-diff"].includes(n)) {
    req.push("repo-discovery");
  }
  const wantsPattern = (n.endsWith("-gen") && !DOCS_GENS.has(n) && !PHASE_GENS.has(n)) || n === "speckit-implement";
  if (wantsPattern) req.push("pattern-finder");
  return [...new Set(req)];
}

export function classify(n, root) {
  const category = categoryOf(n, root);
  return {
    category,
    phase: phaseOf(n),
    capability: capabilityOf(category),
    workflow: workflowOf(n),
    requires: requiresOf(n),
  };
}

export function build(root) {
  const names = listSkills(root);
  const skills = {};
  for (const n of names) skills[n] = classify(n, root);
  return {
    version: INDEX_VERSION,
    count: names.length,
    retired: { ...RETIRED },
    skills,
  };
}

/** Comparable slice — timestamps must not make a fresh write look stale. */
export function fingerprint(idx) {
  if (!idx || typeof idx !== "object") return "";
  return JSON.stringify({
    version: idx.version,
    count: idx.count,
    retired: idx.retired || {},
    skills: idx.skills || {},
  });
}

export function serialize(idx) {
  return JSON.stringify(idx, null, 2) + "\n";
}

export function indexPath(root) {
  return join(root, ".cursor", "skills.index.json");
}

export function write(root) {
  const idx = build(root);
  const p = indexPath(root);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, serialize(idx), "utf8");
  return idx;
}

export function parseIndex(raw) {
  try {
    const idx = JSON.parse(raw);
    if (!idx || typeof idx !== "object" || idx.version !== INDEX_VERSION) return null;
    if (!idx.skills || typeof idx.skills !== "object") return null;
    return idx;
  } catch { return null; }
}

export function read(root) {
  const p = indexPath(root);
  if (!existsSync(p)) return null;
  try { return parseIndex(readFileSync(p, "utf8")); }
  catch { return null; }
}

/** Plugin install: the index sits next to hooks/, not under the consuming repo's .cursor/. */
export function readBeside(hookMetaUrl) {
  try {
    const p = fileURLToPath(new URL("../skills.index.json", hookMetaUrl));
    if (!existsSync(p)) return null;
    return parseIndex(readFileSync(p, "utf8"));
  } catch { return null; }
}

export function loadForSession(root, hookMetaUrl) {
  return read(root) || (hookMetaUrl ? readBeside(hookMetaUrl) : null);
}

export function summarize(idx) {
  const skills = idx?.skills || {};
  const n = Object.keys(skills).length;
  const by = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const s of Object.values(skills)) if (by[s.category] !== undefined) by[s.category]++;
  const parts = CATEGORIES.filter((c) => by[c]).map((c) => `${c} ${by[c]}`);
  return `${n} skills (${parts.join(" / ")}).`;
}

const invoked = (() => {
  try { return fileURLToPath(import.meta.url) === process.argv[1]; }
  catch { return false; }
})();
if (invoked) {
  const root = process.env.CLAUDE_PROJECT_DIR || repoRoot();
  const cmd = process.argv[2] || "show";
  if (cmd === "write") {
    const idx = write(root);
    process.stdout.write(`skills.index.json: ${idx.count} skill(s) written.\n`);
  } else if (cmd === "show") {
    process.stdout.write(serialize(build(root)));
  } else {
    process.stderr.write("Usage: node .cursor/tools/_skills-index.mjs [show|write]\n");
    process.exit(2);
  }
}
