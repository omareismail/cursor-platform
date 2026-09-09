#!/usr/bin/env node
/**
 * memory-bank.mjs — who owns the memory bank's shape, and whether it is real.
 *
 * WHY THIS EXISTS
 *
 * Nothing owned it. The memory bank has two tiers, a template convention and a
 * staleness threshold, and every one of those facts was written down separately
 * in every file that needed it:
 *
 *   TIER1            session-start.mjs (4 files)   dashboard.mjs (8 files)
 *   TIER2            guard-write.mjs (a regex)     dashboard.mjs (an array)
 *   PLACEHOLDER      lifecycle.mjs   dashboard.mjs   session-start.mjs
 *   STALE_DAYS = 7   session-start.mjs             dashboard.mjs
 *
 * The dashboard did not invent that duplication out of carelessness — it asked
 * a question no tool could answer, so it had to answer it itself. That is the
 * shape of the gap: a fact with no owner gets re-derived by whoever needs it,
 * and the copies disagree quietly.
 *
 * They already did. `session-start` checked four files for staleness and the
 * dashboard checked eight, so the two gave different answers to "is the memory
 * bank fresh?" on the day the dashboard shipped.
 *
 * THE SHARPER ONE: A PROTECTION THAT IS NOT THERE
 *
 * `guard-write.mjs` is the enforcer — its Tier 2 list is what actually blocks
 * an agent from writing those files. The dashboard carries a second list and
 * paints a padlock from it. Add a file to one and not the other and the board
 * shows a protection that does not exist, which is worse than showing none.
 *
 * THREE LISTS, NOT TWO
 *
 * Flattening `session-start`'s four into the dashboard's eight would have been
 * the wrong fix: they are not the same question.
 *
 *   TIER1   the machine-regenerated layer — 8 files
 *   TIER2   human-authored and write-guarded — 15 files
 *   DIGEST  the 4 that rule 00 requires be read at session start, a subset of
 *           TIER1. Injecting all eight would make the digest noise, and noise
 *           in an always-on injection is how an always-on rule gets ignored.
 *
 * So nothing's behaviour changes here. Only the number of places the facts are
 * written down.
 *
 * A LEAF ON PURPOSE
 *
 * This imports no other tool, so a hook, a validator or the dashboard can all
 * import it without a cycle. `guard-write.mjs` keeps its own hardcoded regex as
 * a FAIL-CLOSED fallback — a guard that stops guarding because an import failed
 * is the exact defect this platform exists to prevent — and `self-audit` checks
 * that the fallback still matches this list.
 *
 * Usage:
 *   node .cursor/tools/memory-bank.mjs status [--json]
 *   node .cursor/tools/memory-bank.mjs tiers  [--json]
 *   node .cursor/tools/memory-bank.mjs check
 *
 * Exit codes:  0 = every Tier 1 file is real   1 = missing or still a template
 *              2 = usage
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Mutable for the same reason `lifecycle.mjs`'s is: this module is imported by
 * hooks as well as run as a CLI, and the two learn the workspace differently —
 * Claude Code sets CLAUDE_PROJECT_DIR, Cursor passes workspace_roots and sets
 * nothing. A hook calls setRoot() before asking anything.
 */
let ROOT = process.env.CLAUDE_PROJECT_DIR || repoRoot() || process.cwd();
export function setRoot(p) { if (p) ROOT = p; }
export const root = () => ROOT;
function repoRoot() {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

/* --------------------------------------------------------------- the lists */

/** Regenerated from the live repo by /context-sync and /repo-discovery. */
export const TIER1 = [
  "activeContext.md", "productContext.md", "progress.md", "projectbrief.md",
  "systemPatterns.md", "techContext.md", "techDebt.md", "WORKING_ON.md",
];

/**
 * Human-authored standards. `guard-write.mjs` blocks agent writes to these
 * unless CLAUDE_ALLOW_TIER2_EDIT is set, and gate 3's promotion step is how
 * they legitimately change.
 */
export const TIER2 = [
  "apiConventions.md", "architecture.md", "backendConventions.md", "businessRules.md",
  "codingStandards.md", "commonMistakes.md", "databaseConventions.md", "decisionLog.md",
  "deploymentNotes.md", "frontendConventions.md", "glossary.md", "performanceGuidelines.md",
  "securityStandards.md", "technologyStack.md", "testingStandards.md",
];

/**
 * What rule 00 names, and therefore what SessionStart injects. A subset of
 * TIER1 on purpose: the digest is read in full on every single session, so its
 * cost is paid constantly and its size is a design decision, not an oversight.
 */
export const DIGEST = ["activeContext.md", "progress.md", "techContext.md", "systemPatterns.md"];

/** `README.md` documents the memory bank; it is not one of its files. */
export const NOT_A_MEMORY_FILE = new Set(["README.md"]);

export const STALE_DAYS = 7;

/* --------------------------------------------------- the template convention */

/**
 * A file full of [square-bracket] slots is the unfilled template, not content.
 * Counting it as present is how a gate passes on a document nobody wrote — the
 * same heuristic `lifecycle.mjs` applies to phase artifacts.
 *
 * `lifecycle.mjs` keeps its own copy rather than importing this one: it has to
 * stay a leaf for the hooks that import IT, and it applies the heuristic to a
 * different set of files. So this is a copy on purpose, and `self-audit`'s A9
 * compares the two texts — they cannot drift apart unnoticed, which is the most
 * a deliberate duplicate can honestly promise.
 */
export const PLACEHOLDER = /^\s*(>\s*)?(EXAMPLE|TODO|TBD|PLACEHOLDER|_?fill me in_?)/im;

export function isUnfilled(body) {
  const lines = String(body).split("\n").filter((l) => l.trim());
  if (!lines.length) return true;
  const slots = lines.filter((l) => /\[[^\]]{3,}\]/.test(l) && !/\]\(/.test(l)).length;
  return slots / lines.length > 0.3;
}

/* ------------------------------------------------------------------- status */

const ageInDays = (abs) => {
  try { return (Date.now() - statSync(abs).mtimeMs) / 86400000; } catch { return null; }
};

/**
 * One file's state. `template` is deliberately distinct from `missing`: a file
 * that exists and says nothing is the more dangerous of the two, because every
 * presence check passes on it.
 */
export function fileState(name, tier) {
  const abs = join(ROOT, "memory-bank", name);
  if (!existsSync(abs)) return { file: `memory-bank/${name}`, name, tier, state: "missing", ageDays: null };
  let body = "";
  try { body = readFileSync(abs, "utf8").trim(); } catch {
    return { file: `memory-bank/${name}`, name, tier, state: "unreadable", ageDays: null };
  }
  const age = ageInDays(abs);
  if (!body || body.length < 60 || PLACEHOLDER.test(body) || isUnfilled(body))
    return { file: `memory-bank/${name}`, name, tier, state: "template", ageDays: age, bytes: body.length };
  return {
    file: `memory-bank/${name}`, name, tier,
    state: age !== null && age > STALE_DAYS ? "stale" : "filled",
    ageDays: age, bytes: body.length,
  };
}

export function status() {
  const tier1 = TIER1.map((f) => fileState(f, 1));
  const tier2 = TIER2.map((f) => fileState(f, 2));
  const all = [...tier1, ...tier2];
  const by = (s) => all.filter((f) => f.state === s).length;
  return {
    root: ROOT,
    staleDays: STALE_DAYS,
    counts: {
      total: all.length, tier1: tier1.length, tier2: tier2.length,
      filled: by("filled"), stale: by("stale"), template: by("template"), missing: by("missing"),
    },
    digest: DIGEST,
    tier1, tier2,
  };
}

/* ---------------------------------------------------------------- commands */

const out = (s = "") => process.stdout.write(s + "\n");
const pad = (s, n) => String(s).slice(0, n - 1).padEnd(n);
const MARK = { filled: "ok  ", stale: "old ", template: "TMPL", missing: "MISS", unreadable: "ERR " };

const CMDS = {
  tiers(args) {
    if (args.includes("--json")) { out(JSON.stringify({ TIER1, TIER2, DIGEST, STALE_DAYS }, null, 2)); return 0; }
    out(`Tier 1 — regenerated (${TIER1.length})`);
    for (const f of TIER1) out(`  ${f}${DIGEST.includes(f) ? "   [in the SessionStart digest]" : ""}`);
    out(`\nTier 2 — human-authored, write-guarded (${TIER2.length})`);
    for (const f of TIER2) out(`  ${f}`);
    out(`\nStale after ${STALE_DAYS} days.`);
    out(`\nThese lists are owned here. guard-write.mjs, session-start.mjs and`);
    out(`dashboard.mjs read them rather than restating them — they used to restate`);
    out(`them, and two of the copies already disagreed.`);
    return 0;
  },

  status(args) {
    const s = status();
    if (args.includes("--json")) { out(JSON.stringify(s, null, 2)); return 0; }
    out(`# Memory bank — ${s.counts.total} file(s)\n`);
    for (const [label, list] of [["Tier 1 — regenerated", s.tier1], ["Tier 2 — human-authored", s.tier2]]) {
      out(`## ${label}\n`);
      for (const f of list) {
        const age = f.ageDays === null ? "" : `${Math.floor(f.ageDays)}d`;
        out(`  ${MARK[f.state] || "?   "} ${pad(f.name, 28)}${pad(age, 7)}${DIGEST.includes(f.name) ? "digest" : ""}`);
      }
      out("");
    }
    const c = s.counts;
    out(`${c.filled} filled · ${c.stale} stale (>${s.staleDays}d) · ${c.template} still a template · ${c.missing} missing`);
    if (c.template || c.missing) {
      out(`\nA file that exists and says nothing is worse than one that is absent: every`);
      out(`presence check passes on it. Run /context-sync before trusting the ones above.`);
    }
    return 0;
  },

  check() {
    const s = status();
    const bad = s.tier1.filter((f) => f.state === "missing" || f.state === "template");
    if (!bad.length) { out(`OK: every Tier 1 file exists and has real content.`); return 0; }
    for (const f of bad) out(`${f.state.toUpperCase().padEnd(9)}${f.file}`);
    out(`\nFAILED: ${bad.length} Tier 1 file(s) the agent reads every session are not real.`);
    out(`Rule 00 makes the agent trust these. /context-sync regenerates them.`);
    return 1;
  },
};

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].split("\\").join("/")}`).href;
if (invokedDirectly) {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || !CMDS[cmd]) {
    out(`memory-bank.mjs — who owns the memory bank's shape, and whether it is real

  status [--json]   every file, its tier, and whether it holds anything
  tiers  [--json]   the lists themselves, for the tools that read them
  check             fails when a Tier 1 file is missing or still a template

The two tiers, the template convention and the staleness threshold used to be
written down in four files. Two of the copies already disagreed.`);
    process.exit(cmd ? 2 : 0);
  }
  process.exit(CMDS[cmd](args) ?? 0);
}
