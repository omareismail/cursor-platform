#!/usr/bin/env node
/**
 * fitness.mjs — the architecture, as an assertion rather than a paragraph.
 *
 * WHY THIS EXISTS
 *
 * Gate 3 ends with a promotion step, and it says this about it:
 *
 *   "This promotion is what makes the design binding. Once the layering is in
 *    architecture.md, rule 02 enforces it on every .cs file for the rest of the
 *    project's life. Skip it and the design is a document; do it and the design
 *    is a compiler error."
 *
 * That was not true. Rule 02 is a prose file an agent reads and chooses to
 * comply with, and `dotnet-auditor` sweeps when somebody remembers to ask. Both
 * are probabilistic. Nothing in this repository ever asserted that Domain does
 * not reference Infrastructure — which is one grep over `using` directives and
 * `<ProjectReference>` elements, and is the single load-bearing claim of the
 * whole architecture.
 *
 * WHERE THE RULES COME FROM
 *
 * Not from a config file. A `fitness.json` would be a fourth source of
 * architectural truth beside `memory-bank/architecture.md`, rule 02 and the
 * ADRs, and the four would disagree within a month.
 *
 * The rules are READ from `memory-bank/architecture.md`, which already states
 * them in a parseable form — the layering block names each layer and what it may
 * depend on, the frontend block says `shared/` cannot import from `features/`.
 * That file is Tier 2: human-authored, promoted at gate 3, blocked from agent
 * writes by `guard-write.mjs`. So promoting the design is what brings these
 * checks into existence, which is exactly what the gate promised.
 *
 * If that file is still the template, this tool says so and checks nothing. An
 * un-promoted architecture is not a violation to report; it is a gate that was
 * skipped, and pretending otherwise would invent rules nobody agreed to.
 *
 * Where `architecture.md` and rule 02 disagree — and in the shipped templates
 * they do, about whether API may reference Infrastructure — the promoted file
 * wins. It is the one a human signed.
 *
 * THE RATCHET, WHICH IS WHAT MAKES THIS SURVIVABLE
 *
 * Point a new checker at an existing codebase and it returns four hundred
 * violations, and it is switched off that afternoon. A fitness function has to
 * be incremental to be continuous. `baseline` records today's violations;
 * `check` fails only on ones that are NEW. The count can fall and never rise.
 *
 * That is not a `--force`. The baseline is a written record of architectural
 * debt with a date on it, and this tool reports its age and whether it has moved
 * — because a baseline that has sat at forty for a year is a disabled check
 * wearing a hat.
 *
 * Usage:
 *   node .cursor/tools/fitness.mjs rules                 what was derived, and from where
 *   node .cursor/tools/fitness.mjs check [--json]        new violations only
 *   node .cursor/tools/fitness.mjs all [--json]          every violation, baseline ignored
 *   node .cursor/tools/fitness.mjs baseline [--accept]   record today's, or show the drift
 *
 * Exit codes:  0 = no new violation   1 = new violations
 *              2 = usage / no promoted architecture (nothing to check)
 */

import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { writeJsonAtomic } from "./_state.mjs";
import { report as findingReport, emit, block, info } from "./_findings.mjs";
import { join, extname, relative, dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.env.CLAUDE_PROJECT_DIR || repoRoot() || process.cwd();
function repoRoot() {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}
const ARCH = () => join(ROOT, "memory-bank", "architecture.md");
const BASELINE = () => join(ROOT, "lifecycle", "fitness-baseline.json");

const out = (s = "") => process.stdout.write(s + "\n");
const pad = (s, n) => String(s).slice(0, n - 1).padEnd(n);
const die = (m, c = 2) => { process.stderr.write(m + "\n"); process.exit(c); };

const SKIP = /(^|\/)(bin|obj|node_modules|dist|\.next|coverage|TestResults|\.git|plugin|templates|\.cursor|\.claude)(\/|$)/;

function files() {
  let list;
  try {
    list = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter(Boolean);
  } catch { list = walk(ROOT); }
  return list.filter((f) => !SKIP.test("/" + f));
}
function walk(dir, acc = []) {
  let names; try { names = readdirSync(dir); } catch { return acc; }
  for (const n of names) {
    const full = join(dir, n), r = relative(ROOT, full).split("\\").join("/");
    if (SKIP.test("/" + r)) continue;
    let st; try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, acc); else acc.push(r);
  }
  return acc;
}
const read = (rel) => { try { return readFileSync(join(ROOT, rel), "utf8"); } catch { return null; } };

/* ------------------------------------------------------ the promoted rules */

const TEMPLATE = /\[Project\]|\[YYYY-MM-DD\]|\[name\]/;

/**
 * Parse the layering out of `memory-bank/architecture.md`.
 *
 *   [Project].Domain/         no dependencies — entities, value objects
 *   [Project].Application/    depends on Domain only — CQRS handlers
 *   [Project].Infrastructure/ depends on Application — EF Core, Dapper
 *   [Project].API/            depends on Application + Infrastructure
 *
 * "depends on Application" implies Domain as well: depending on a layer means
 * depending on what that layer depends on. Without the transitive closure,
 * Infrastructure using a Domain entity — which is correct and universal — reads
 * as a violation, and the first thing anyone would do is turn the tool off.
 */
function parseLayers(src) {
  const block = src.match(/##\s*Layering[^\n]*\n+```[^\n]*\n([\s\S]*?)```/i);
  if (!block) return { layers: null, why: "no fenced layering block under a `## Layering` heading" };
  const direct = new Map();
  for (const line of block[1].split("\n")) {
    const m = line.match(/^\s{2,}(?:\[Project\]\.)?([A-Za-z][A-Za-z0-9_.]*)\/\s+(.*)$/);
    if (!m) continue;
    const name = m[1].split(".").pop(), desc = m[2];
    if (/^no dependencies/i.test(desc)) { direct.set(name, []); continue; }
    const dep = desc.match(/depends on ([^—\-]*)/i);
    direct.set(name, dep ? [...dep[1].matchAll(/\b([A-Z][A-Za-z0-9]*)\b/g)].map((x) => x[1]).filter((x) => x !== "only") : []);
  }
  if (!direct.size) return { layers: null, why: "the layering block named no layers this tool could read" };

  const allowed = new Map();
  for (const l of direct.keys()) {
    const seen = new Set(), stack = [...(direct.get(l) || [])];
    while (stack.length) {
      const n = stack.pop();
      if (!direct.has(n) || seen.has(n)) continue;
      seen.add(n); stack.push(...(direct.get(n) || []));
    }
    allowed.set(l, seen);
  }
  return { layers: { direct, allowed }, why: null };
}

/** `shared/ ... cannot import from features/` — stated, so read rather than assumed. */
function parseFrontend(src) {
  const block = src.match(/##\s*Frontend[^\n]*\n+```[^\n]*\n([\s\S]*?)```/i);
  if (!block) return [];
  const rules = [];
  for (const line of block[1].split("\n")) {
    const m = line.match(/^\s{2,}([A-Za-z][A-Za-z0-9_-]*)\/[^\n]*?cannot import from ([A-Za-z][A-Za-z0-9_-]*)\//i);
    if (m) rules.push({ from: m[1], to: m[2] });
  }
  return rules;
}

function rules() {
  const src = read("memory-bank/architecture.md");
  if (src === null) return { promoted: false, why: "memory-bank/architecture.md does not exist" };
  if (TEMPLATE.test(src)) return { promoted: false, why: "memory-bank/architecture.md is still the template — the gate 3 promotion never happened", src };
  const { layers, why } = parseLayers(src);
  return { promoted: !!layers, why, layers, frontend: parseFrontend(src), src };
}

/* --------------------------------------------------------------- .NET side */

const layerOfPath = (p, names) => {
  for (const seg of p.split("/")) {
    const tail = seg.split(".").pop();
    const hit = names.find((n) => n.toLowerCase() === tail.toLowerCase() || n.toLowerCase() === seg.toLowerCase());
    if (hit) return hit;
  }
  return null;
};
const layerOfNamespace = (ns, names) => {
  for (const seg of ns.split(".")) { const hit = names.find((n) => n.toLowerCase() === seg.toLowerCase()); if (hit) return hit; }
  return null;
};

/** Packages that are infrastructure by definition. Narrow on purpose: a broad
 *  list turns a purity check into a dependency-policy argument. */
const INFRA_PACKAGES = /^(Microsoft\.EntityFrameworkCore|Microsoft\.AspNetCore|Dapper|Npgsql|MySql|Oracle\.|StackExchange\.Redis|MassTransit|RabbitMQ\.|Azure\.|AWSSDK\.|System\.Data\.SqlClient|Microsoft\.Data\.SqlClient|Serilog\.Sinks)/i;

function dotnetViolations(list, layers) {
  const v = [], names = [...layers.direct.keys()];

  for (const rel of list) {
    if (extname(rel) === ".csproj") {
      const text = read(rel); if (!text) continue;
      const mine = layerOfPath(rel, names);
      if (!mine) continue;
      for (const m of text.matchAll(/<ProjectReference[^>]*Include\s*=\s*"([^"]+)"/g)) {
        const target = layerOfPath(m[1].split("\\").join("/"), names);
        if (!target || target === mine) continue;
        if (!layers.allowed.get(mine)?.has(target))
          v.push({ rule: "layer-direction", file: rel, detail: `${mine} project references ${target}`,
                   why: `${mine} may depend on ${[...(layers.allowed.get(mine) || [])].join(", ") || "nothing"}. This edge points the wrong way, and the compiler will now enforce it in the wrong direction for everyone.` });
      }
      if ((layers.direct.get(mine) || []).length === 0) {
        for (const m of text.matchAll(/<PackageReference[^>]*Include\s*=\s*"([^"]+)"/g)) {
          if (INFRA_PACKAGES.test(m[1]))
            v.push({ rule: "domain-purity", file: rel, detail: `${mine} references package ${m[1]}`,
                     why: `${mine} is declared as depending on nothing. A package that knows about a database or a web server makes the domain untestable without one.` });
        }
      }
      continue;
    }
    if (extname(rel) !== ".cs") continue;
    const mine = layerOfPath(rel, names);
    if (!mine) continue;
    const text = read(rel); if (!text) continue;
    const allowed = layers.allowed.get(mine) || new Set();
    const seen = new Set();
    for (const m of text.matchAll(/^\s*(?:global\s+)?using\s+(?:static\s+)?([A-Za-z_][\w.]*)\s*;/gm)) {
      const target = layerOfNamespace(m[1], names);
      if (!target || target === mine || allowed.has(target) || seen.has(target)) continue;
      seen.add(target);
      v.push({ rule: "layer-direction", file: rel, detail: `${mine} uses ${target} (${m[1]})`,
               why: `${mine} may depend on ${[...allowed].join(", ") || "nothing"}. Every one of these is a place the layering stopped being true.` });
    }
  }
  return v;
}

/* ------------------------------------------------------------ frontend side */

const isTs = (p) => [".ts", ".tsx", ".js", ".jsx"].includes(extname(p));
const COMPONENT = /(^|\/)(components?|pages|views)(\/|$)/i;

function frontendViolations(list, fe) {
  const v = [];
  const imports = new Map();

  for (const rel of list) {
    if (!isTs(rel)) continue;
    const text = read(rel); if (!text) continue;

    // Rule 03's headline: a component that fetches is a component that cannot be
    // rendered in a test without a network, and an API layer that is optional.
    if (COMPONENT.test(rel) && !/\.(test|spec|stories)\./.test(rel)) {
      if (/\bfetch\s*\(|\baxios\s*\.\s*(get|post|put|patch|delete)\s*\(/.test(text))
        v.push({ rule: "no-fetch-in-component", file: rel, detail: "calls the network directly",
                 why: "the API layer becomes optional the moment one component skips it, and this component can no longer be rendered in a test without a server." });
    }

    const targets = [];
    for (const m of text.matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/g)) targets.push(m[1] || m[2]);
    imports.set(rel, targets);

    for (const r of fe) {
      if (!new RegExp(`(^|/)${r.from}/`).test(rel)) continue;
      for (const t of targets) {
        const abs = t.startsWith(".") ? relative(ROOT, resolve(join(ROOT, dirname(rel)), t)).split("\\").join("/") : t;
        if (new RegExp(`(^|/|^@/)${r.to}/`).test(abs))
          v.push({ rule: "frontend-boundary", file: rel, detail: `${r.from}/ imports from ${r.to}/ (${t})`,
                   why: `architecture.md says ${r.from}/ cannot import from ${r.to}/. Once it does, ${r.from}/ cannot be extracted or reused without dragging ${r.to}/ with it.` });
      }
    }
  }
  return { v, imports };
}

/** Import cycles. A cycle is not a style problem: it is the thing that makes a
 *  module impossible to move, test alone, or reason about in one sitting. */
function cycles(imports) {
  const norm = new Map();
  const resolveTo = (from, spec) => {
    if (!spec.startsWith(".")) return null;
    const base = relative(ROOT, resolve(join(ROOT, dirname(from)), spec)).split("\\").join("/");
    for (const cand of [base, base + ".ts", base + ".tsx", base + "/index.ts", base + "/index.tsx"])
      if (imports.has(cand)) return cand;
    return null;
  };
  for (const [f, ts] of imports) norm.set(f, ts.map((t) => resolveTo(f, t)).filter(Boolean));

  const state = new Map(), stack = [], found = [];
  const visit = (n) => {
    state.set(n, 1); stack.push(n);
    for (const m of norm.get(n) || []) {
      if (!state.has(m)) visit(m);
      else if (state.get(m) === 1) {
        const cyc = stack.slice(stack.indexOf(m)).concat(m);
        if (cyc.length <= 8) found.push(cyc);
      }
    }
    stack.pop(); state.set(n, 2);
  };
  for (const n of norm.keys()) if (!state.has(n)) visit(n);

  const seen = new Set(), v = [];
  for (const c of found) {
    const key = [...c].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    v.push({ rule: "import-cycle", file: c[0], detail: c.join(" -> "),
             why: "a cycle makes every file in it impossible to move, test alone, or read without the others." });
  }
  return v;
}

/* -------------------------------------------------- the claimed build gate */

function archTestsClaim(src, list) {
  if (!/NetArchTest|ArchitectureTests|architecture tests?/i.test(src || "")) return null;
  const found = list.find((f) => /architecture\.?tests?/i.test(f));
  if (found) return null;
  return { rule: "missing-arch-tests", file: "memory-bank/architecture.md",
           detail: "architecture.md claims architecture tests are the build gate; no such project exists",
           why: "the claim is what stops anyone looking. A stated build gate that is not in the repository is worse than an admitted absence." };
}

/* ------------------------------------------------------------------ engine */

const fingerprint = (x) => `${x.rule}|${x.file}|${x.detail}`;

function collect() {
  const r = rules();
  if (!r.promoted) return { rules: r, violations: null };
  const list = files();
  const v = [...dotnetViolations(list, r.layers)];
  const fe = frontendViolations(list, r.frontend);
  v.push(...fe.v, ...cycles(fe.imports));
  const claim = archTestsClaim(r.src, list);
  if (claim) v.push(claim);
  return { rules: r, violations: v };
}

const readBaseline = () => { try { return JSON.parse(readFileSync(BASELINE(), "utf8")); } catch { return null; } };

const unpromoted = (r, args = [], command = "check") => {
  // Exit 2, like every sibling checker's "nothing to check": an un-promoted
  // architecture is a skipped gate, not a violation, and a release record or an
  // approval that ran this should say "skipped", not "FAILED".
  if (args.includes("--json")) return emit(findingReport({ tool: "fitness.mjs", command, skipped: true, summary: `no promoted architecture: ${r.why}`, data: null }));
  out(`No promoted architecture to check against.`);
  out(`  ${r.why}\n`);
  out(`Gate 3 ends with a promotion step, and this is what it is for: the layering`);
  out(`in memory-bank/architecture.md is what these checks are derived FROM. Until it`);
  out(`is written, there are no rules here to enforce — and inventing some would mean`);
  out(`enforcing an architecture nobody agreed to.`);
  out(`\n  node .cursor/tools/lifecycle.mjs gate DESIGN`);
  return 2;
};

const CMDS = {
  rules() {
    const r = rules();
    if (!r.promoted) return unpromoted(r);
    out(`# Fitness rules — derived from memory-bank/architecture.md\n`);
    out(`  Layers (transitive closure of what each may depend on):\n`);
    for (const [l, direct] of r.layers.direct) {
      const all = [...(r.layers.allowed.get(l) || [])];
      out(`    ${pad(l, 16)} declared: ${direct.join(", ") || "nothing"}`);
      out(`    ${" ".repeat(16)} allowed:  ${all.join(", ") || "nothing"}`);
    }
    if (r.frontend.length) {
      out(`\n  Frontend boundaries:`);
      for (const f of r.frontend) out(`    ${f.from}/ must not import from ${f.to}/`);
    } else out(`\n  Frontend boundaries: none stated`);
    out(`\n  Nothing here is configured. Change the architecture by editing`);
    out(`  memory-bank/architecture.md — which is Tier 2, so a human does it.`);
    out(`  Where rule 02 and that file disagree, the promoted file wins.`);
    return 0;
  },

  all(args) {
    const { rules: r, violations } = collect();
    if (!violations) return unpromoted(r);
    if (args.includes("--json")) { out(JSON.stringify(violations, null, 2)); return violations.length ? 1 : 0; }
    return report(violations, "every violation, baseline ignored");
  },

  check(args) {
    const { rules: r, violations } = collect();
    if (!violations) return unpromoted(r, args);
    const base = readBaseline();
    const known = new Set(base?.violations || []);
    const now = new Set(violations.map(fingerprint));
    const fresh = violations.filter((v) => !known.has(fingerprint(v)));
    const fixed = [...known].filter((k) => !now.has(k));

    if (args.includes("--json")) {
      const findings = fresh.map((v) => block(String(v.rule || "violation").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "violation", `${v.rule}: ${v.detail}`, { file: v.file, line: v.line, detail: v.detail }));
      if (fixed.length) findings.push(info("baseline-fixed", `${fixed.length} baselined violation(s) no longer exist - lower the ratchet with \`baseline --accept\``));
      return emit(findingReport({
        tool: "fitness.mjs", command: "check", findings,
        summary: fresh.length ? `${fresh.length} NEW architectural violation(s) since the baseline` : `OK: no new architectural violation`,
        data: { total: violations.length, new: fresh, fixed: fixed.length, baseline: base ? { at: base.at, count: base.violations.length } : null },
      }));
    }
    if (base) {
      const days = Math.floor((Date.now() - Date.parse(base.at)) / 86400000);
      out(`Baseline: ${base.violations.length} violation(s) accepted on ${base.at.slice(0, 10)} by ${base.by || "unknown"} — ${days} day(s) ago\n`);
      if (days > 90 && base.violations.length && !fixed.length)
        out(`  That baseline has not moved in ${days} days. A ratchet that never turns is\n  a disabled check with a record attached.\n`);
    } else {
      out(`No baseline. Every violation below is being reported for the first time.`);
      out(`On an existing codebase, run \`baseline --accept\` once so this can fail on\n  NEW decay rather than on all of history.\n`);
    }
    if (fixed.length) {
      out(`${fixed.length} baselined violation(s) no longer exist. Lower the ratchet:`);
      out(`  node .cursor/tools/fitness.mjs baseline --accept\n`);
    }
    if (!fresh.length) { out(`OK: no new architectural violation.`); return 0; }
    return report(fresh, "NEW since the baseline");
  },

  baseline(args) {
    const { rules: r, violations } = collect();
    if (!violations) return unpromoted(r);
    const base = readBaseline();
    const known = new Set(base?.violations || []);
    const today = violations.map(fingerprint);
    // Comparing COUNTS is not enough: fix one violation, introduce another, and a
    // count-only ratchet accepts the swap in silence — which is precisely the
    // quiet erosion this tool exists to catch. Compare the sets.
    const added = today.filter((f) => !known.has(f));
    const gone = [...known].filter((f) => !today.includes(f));

    if (!args.includes("--accept")) {
      if (!base) { out(`No baseline yet. Today: ${violations.length} violation(s).\nRun with --accept to record them.`); return 0; }
      out(`Baseline: ${base.violations.length} violation(s), accepted ${base.at.slice(0, 10)} by ${base.by || "unknown"}.`);
      out(`Today:    ${violations.length}   (${gone.length} fixed, ${added.length} new)\n`);
      out(added.length
        ? `--accept alone will be refused while there are new violations. Fix them, or say\n--accept-new deliberately.`
        : `--accept will lower the ratchet to ${violations.length}.`);
      return 0;
    }
    // Only once a baseline EXISTS. Without this guard the very first baseline is
    // refused — every violation is "new" when there is nothing to be new against —
    // and the ratchet can never be started at all.
    if (base && added.length && !args.includes("--accept-new")) {
      die(`REFUSED: ${added.length} violation(s) here are not in the baseline.\n\n` +
          added.slice(0, 10).map((f) => `  ${f.split("|").slice(0, 2).join("  ")}`).join("\n") +
          (added.length > 10 ? `\n  ... and ${added.length - 10} more` : "") +
          `\n\nFixing one violation and adding another keeps the count flat, and a ratchet\n` +
          `that only compares counts would accept that swap without a word. Fix these —\n` +
          `\`check\` lists exactly them — or, if the architecture itself changed, change\n` +
          `memory-bank/architecture.md first and they stop being violations.\n\n` +
          `To accept new architectural debt deliberately, add --accept-new.`, 1);
    }
    const rec = {
      at: new Date().toISOString(),
      by: (args[args.indexOf("--by") + 1] && args.includes("--by")) ? args[args.indexOf("--by") + 1] : "",
      note: "Architectural debt accepted at this date. `check` fails only on violations not in this list. The count may fall and must never rise.",
      violations: violations.map(fingerprint).sort(),
    };
    writeJsonAtomic(BASELINE(), rec);
    out(`Baseline recorded: ${rec.violations.length} violation(s)${base ? ` (was ${base.violations.length}: ${gone.length} fixed, ${added.length} newly accepted)` : ""}.`);
    out(`  ${relative(ROOT, BASELINE()).split("\\").join("/")}`);
    out(`\nCommit it. It is a dated record of architectural debt, not a suppression file.`);
    return 0;
  },
};

function report(v, what) {
  if (!v.length) { out(`OK: no violation.`); return 0; }
  out(`# Architecture fitness — ${v.length} violation(s), ${what}\n`);
  const byRule = new Map();
  for (const x of v) { if (!byRule.has(x.rule)) byRule.set(x.rule, []); byRule.get(x.rule).push(x); }
  for (const [rule, list] of byRule) {
    out(`## ${rule} (${list.length})\n`);
    out(`  ${list[0].why}\n`);
    for (const x of list.slice(0, 25)) out(`  ${pad(x.file, 52)} ${x.detail}`);
    if (list.length > 25) out(`  ... and ${list.length - 25} more`);
    out("");
  }
  out(`FAILED: ${v.length} violation(s).`);
  out(`Every one of these was allowed by a rule an agent read and a reviewer skimmed.`);
  out(`That is the difference between an architecture that is documented and one that`);
  out(`is enforced.`);
  return 1;
}

const [cmd, ...args] = process.argv.slice(2);
if (!cmd || !CMDS[cmd]) {
  out(`fitness.mjs — the architecture, as an assertion rather than a paragraph

  rules                    what was derived from memory-bank/architecture.md
  check [--json]           violations NEW since the baseline — this is the gate
  all [--json]             every violation, baseline ignored
  baseline [--accept]      record today's set, or show the drift

The rules are read from memory-bank/architecture.md, not configured here: that
file is Tier 2, human-authored, and promoted at gate 3. Promoting the design is
what brings these checks into existence.

The baseline is a ratchet. It records accepted architectural debt with a date,
check fails only on what is new, and accepting a larger set is refused.`);
  process.exit(cmd ? 2 : 0);
}
process.exit(CMDS[cmd](args) ?? 0);
