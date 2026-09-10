#!/usr/bin/env node
// SessionStart - makes rule 00-memory-think deterministic.
// Injects a memory-bank Tier 1 digest plus repo-map freshness, so the agent
// starts every session already oriented instead of being asked to read files.

import { join } from "node:path";
import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { readPayload, projectDir, readIfExists, ageInDays, inject } from "./_lib.mjs";

await readPayload();
const root = projectDir();
const mb = (f) => join(root, "memory-bank", f);

// The digest list, the template convention and the staleness threshold are
// owned by .cursor/tools/memory-bank.mjs. They used to be restated here, in
// dashboard.mjs and in lifecycle.mjs, and two of the copies already disagreed:
// this file checked four files for staleness while the dashboard checked eight,
// so the two gave different answers to "is the memory bank fresh?".
//
// DIGEST is a deliberate SUBSET of Tier 1 - four files, not eight. This runs on
// every session and its output is read in full every time, so its size is a
// design decision. Fallbacks below keep the hook working if the import fails;
// a SessionStart hook that throws costs the agent its orientation.
let DIGEST = ["activeContext.md", "progress.md", "techContext.md", "systemPatterns.md"];
let STALE_DAYS = 7;
let placeholderMarker = /^\s*(>\s*)?(EXAMPLE|TODO|TBD|PLACEHOLDER|_?fill me in_?)/im;
let isUnfilledTemplate = (str) => {
  const ls = String(str).split("\n").filter((l) => l.trim());
  if (!ls.length) return true;
  return ls.filter((l) => /\[[^\]]{3,}\]/.test(l) && !/\]\(/.test(l)).length / ls.length > 0.3;
};
// Two paths: .claude/hooks/ in a repo, plugin/hooks/ in an installed plugin.
// Note `mbTool`, not `mb` - this file already has an `mb(f)` path helper, and
// shadowing it inside the block would work today and confuse somebody later.
const mbTool = await (async () => {
  for (const rel of ["../../.cursor/tools/memory-bank.mjs", "../tools/memory-bank.mjs"]) {
    try { return await import(new URL(rel, import.meta.url).href); } catch { /* try the next */ }
  }
  return null;
})();
if (mbTool) {
  mbTool.setRoot(root);
  DIGEST = mbTool.DIGEST; STALE_DAYS = mbTool.STALE_DAYS;
  placeholderMarker = mbTool.PLACEHOLDER; isUnfilledTemplate = mbTool.isUnfilled;
}

const MAX_CHARS = 1400; // per file, keeps the digest bounded

const out = ["# Session context (auto-injected by .claude/hooks/session-start.mjs)"];
const problems = [];

// --- product lifecycle phase ------------------------------------------------
// Reported first because it changes what the agent is ALLOWED to do, not merely
// what it knows. A repo with no state.json never adopted the lifecycle; that is
// a valid configuration and gets no mention.
//
// Status is DERIVED by lifecycle.mjs, never read off the file: v2 stopped
// storing `phases[p].status`, and this hook kept reading it, so every approved
// gate showed as not passed and the digest opened with a warning that was false.
// The same dual-path import guard-phase.mjs uses; if it fails, the fallback
// reads the file and says that it could not derive.
const lcPath = join(root, "lifecycle", "state.json");
const lcTool = await (async () => {
  for (const rel of ["../../.cursor/tools/lifecycle.mjs", "../tools/lifecycle.mjs"]) {
    try { return await import(new URL(rel, import.meta.url).href); } catch { /* try the next */ }
  }
  return null;
})();
const ORDER = ["REQUIREMENTS", "ANALYSIS", "DESIGN", "DEVELOPMENT", "TESTING", "PRODUCTION"];
const MARK = { APPROVED: "x", INHERITED: "i", INHERITED_UNVERIFIED: "u", STALE: "!", BLOCKED: "-", IN_PROGRESS: "~", NOT_STARTED: " " };
if (lcTool) {
  try {
    lcTool.setRoot(root);
    const info = lcTool.readStateInfo();
    if (info.status === "corrupt") {
      problems.push(
        `**\`lifecycle/state.json\` exists but cannot be read** (${info.error}). \`guard-phase.mjs\` treats ` +
        `this as a CLOSED design gate and blocks source writes. Do not run \`init\` over it - restore it ` +
        `from git or repair it with the user.`);
    } else if (info.status === "ok") {
      const lc = info.state;
      const d = lcTool.deriveAll(lc);
      const track = ORDER.map((p) => `${MARK[d[p]?.status] ?? "?"} ${p}`).join("  |  ");
      out.push(`\n**Lifecycle:** \`${lc.product}\` is in phase **${lc.phase}** (${lc.mode}${lc.migratedFrom ? `, migrated from schema v${lc.migratedFrom}` : ""}).\n\n    [${track}]\n\n    x approved  i inherited  u inherited, unverified  ! stale  - blocked  ~ in progress`);
      const stale = ORDER.filter((p) => d[p]?.status === "STALE");
      if (stale.length) problems.push(`**${stale.join(", ")} ${stale.length === 1 ? "is" : "are"} STALE** - approved once, and something approved changed since. ${d[stale[0]].reasons[0] || ""} Offer to re-review, never to re-approve.`);
      const unverified = ORDER.filter((p) => d[p]?.status === "INHERITED_UNVERIFIED");
      if (unverified.length) out.push(`\n_${unverified.join(", ")}: inherited from before the lifecycle was adopted, with nobody named as having checked that. Work continues; a release must accept them by name._`);
      if (!lcTool.designCleared(lc)) {
        problems.push(
          `**The DESIGN gate has not passed** (${d.DESIGN?.status}). \`guard-phase.mjs\` will BLOCK every write under ` +
          `\`src/\`, \`backend/\` and \`frontend/\`. Do not attempt implementation - work the current ` +
          `phase instead. \`node .cursor/tools/lifecycle.mjs check ${lc.phase}\` lists what is missing.`);
      }
    }
    // status "missing": never adopted the lifecycle. Valid; no mention.
  } catch (e) {
    problems.push(`Lifecycle status could not be derived (${String(e.message || e).slice(0, 120)}). Run \`node .cursor/tools/lifecycle.mjs status\` before writing source.`);
  }
} else {
  try {
    const lc = JSON.parse(readFileSync(lcPath, "utf8"));
    out.push(`\n**Lifecycle:** \`${lc.product}\` is in phase **${lc.phase}** (${lc.mode}). Gate statuses could not be derived here - run \`node .cursor/tools/lifecycle.mjs status\`.`);
  } catch { /* no lifecycle in this repo - not every project adopts it */ }
}

// --- repo-map freshness -----------------------------------------------------
const mapPath = join(root, ".cursor", "cache", "repo-map.json");
const mapAge = ageInDays(mapPath);
if (mapAge === null) {
  problems.push("`.cursor/cache/repo-map.json` is MISSING - run `/repo-discovery full` before generating or auditing code.");
} else if (mapAge > STALE_DAYS) {
  problems.push(`\`.cursor/cache/repo-map.json\` is ${Math.floor(mapAge)} days old - run \`/repo-discovery quick\` to refresh.`);
} else {
  out.push(`\n**repo-map.json:** fresh (${Math.floor(mapAge)}d old).`);
  try {
    const mapM = statSync(mapPath).mtimeMs;
    const extras = [".cursor/lifecycle/write-policy.json", ".cursor/mcp-policy.json", "packages", "src", "backend", "frontend"];
    const newer = extras.filter((rel) => {
      try { return statSync(join(root, rel)).mtimeMs > mapM + 1000; } catch { return false; }
    });
    if (newer.length) {
      problems.push(`\`.cursor/cache/repo-map.json\` is older than ${newer.join(", ")} — run \`/repo-discovery quick\` so discovery sees added or removed roots.`);
    }
  } catch { /* map unreadable */ }
}

// --- feature-map coverage ---------------------------------------------------
// Behavioural layer over the structural one. Only mentioned when it has
// something to say - an absent map on a repo nobody has analysed yet is not news.
const fmPath = join(root, ".cursor", "cache", "feature-map.json");
try {
  const fm = JSON.parse(readFileSync(fmPath, "utf8"));
  const ids = Object.keys(fm.features || {});
  if (ids.length) {
    const traced = ids.filter(k => fm.features[k].status === "traced").length;
    const r = spawnSync("node", [join(root, ".cursor", "tools", "feature-map.mjs"), "stale", "--json"],
                        { cwd: root, encoding: "utf8", timeout: 10_000 });
    let staleIds = [];
    try { staleIds = JSON.parse(r.stdout || "[]").map(x => x.id); } catch { /* tool unavailable */ }
    out.push(`\n**feature-map:** ${ids.length} capabilities (${traced} fully traced)` +
             (staleIds.length ? `, ${staleIds.length} STALE: ${staleIds.slice(0, 6).join(", ")}` : `, all fresh`) + ".");
    if (staleIds.length) problems.push(
      `${staleIds.length} traced feature(s) went stale - the code moved underneath them. ` +
      `Run \`node .cursor/tools/feature-map.mjs verify\` for the exact files, then re-run \`/feature-trace\`.`);
  }
} catch { /* no map yet - /feature-inventory or /feature-trace will create it */ }

// --- Tier 1 digest ----------------------------------------------------------
// A file full of [square-bracket] template slots is not context - it is the
// unfilled template. Flag it rather than injecting noise the agent will trust.
// (Convention owned by memory-bank.mjs; see the import at the top.)
let anyContent = false;

for (const f of DIGEST) {
  const body = readIfExists(mb(f));
  if (body === null) { problems.push(`\`memory-bank/${f}\` not found.`); continue; }
  const trimmed = body.trim();
  if (!trimmed || trimmed.length < 60 || placeholderMarker.test(trimmed) || isUnfilledTemplate(trimmed)) {
    problems.push(`\`memory-bank/${f}\` is still an unfilled template - run \`/context-sync\` before trusting anything in it.`);
    continue;
  }
  anyContent = true;
  const age = ageInDays(mb(f));
  const stale = age !== null && age > STALE_DAYS ? ` _(stale: ${Math.floor(age)}d)_` : "";
  const clipped = trimmed.length > MAX_CHARS
    ? trimmed.slice(0, MAX_CHARS) + `\n... [truncated - read memory-bank/${f} in full if you need more]`
    : trimmed;
  out.push(`\n## memory-bank/${f}${stale}\n\n${clipped}`);
}

// --- always-on rules --------------------------------------------------------
out.push(`
## Binding rules this session (full text in .cursor/rules/)

- **00-memory-think** - the digest above satisfies the read step. Re-read the
  full file if any of it looks contradictory or stale.
- **05-planning-rigor** - no plan/spec without an elicitation pass; always give
  options with tradeoffs.
- **09-minimal-changes** - change only what the task requires; minimise the diff.
- **10-evidence-and-dependency-guard** - verify symbols/tables/packages exist
  before referencing them; never add a package that is not already in the repo.

Glob-scoped rules are NOT auto-loaded in Claude Code. Before writing \`.cs\`
read \`.cursor/rules/02\` + \`07\`; before \`.tsx\`/\`.ts\` read \`03\` + \`08\`;
before SQL read \`06\`; \`04-security-guard\` applies to all of them.

Prefer the subagents in \`.claude/agents/\` for multi-file reads - \`pattern-scout\`
before any \`*-gen\` skill, and the \`*-auditor\` agents for reviews.`);

// --- skills index -----------------------------------------------------------
// One line. The catalog is the long form; this is the shape of the library so
// the agent can route without loading it. Missing means sync-skills was not run.
const skillsIdx = await (async () => {
  for (const rel of ["../../.cursor/tools/_skills-index.mjs", "../tools/_skills-index.mjs"]) {
    try { return await import(new URL(rel, import.meta.url).href); } catch { /* try the next */ }
  }
  return null;
})();
if (skillsIdx) {
  const idx = skillsIdx.loadForSession(root, import.meta.url);
  if (!idx) {
    problems.push("`.cursor/skills.index.json` is missing — run `node .claude/hooks/sync-skills.mjs`.");
  } else {
    out.push(`\n**Skills index:** ${skillsIdx.summarize(idx)}`);
  }
}

if (problems.length) {
  out.push(`\n## Attention required\n\n${problems.map(p => "- " + p).join("\n")}`);
} else if (anyContent) {
  out.push(`\n_Memory-bank Tier 1 is present and current._`);
}

inject("SessionStart", out.join("\n"));
