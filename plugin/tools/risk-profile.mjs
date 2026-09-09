#!/usr/bin/env node
/**
 * risk-profile.mjs — where being wrong is expensive, and whether the tests know it.
 *
 * WHY THIS EXISTS
 *
 * `ac-trace.mjs` asks one question of every acceptance criterion: is there a test
 * that can fail? That question is flat. It gives the same answer for "the header
 * shows the broker's name" and "the settlement transfers 1,500 SAR to a mada
 * account", and so the platform reports 100% coverage over a test suite that is
 * adequate for one of those and nowhere near adequate for the other.
 *
 * Flat coverage does not just mislead. It misallocates: effort spreads evenly,
 * which means the parts that would cost a regulator's attention get exactly the
 * same single happy-path test as a label change.
 *
 * WHAT RISK MEANS HERE, AND WHAT IT DOES NOT
 *
 * Not a score. Scores of the "likelihood 1-5 x impact 1-5" kind look objective
 * and are invented, they go stale the day after the workshop, and nobody can
 * argue with a number. This assigns TIERS from explicit rules, and every tier
 * prints the rule that produced it. A reason can be disagreed with; that is the
 * point of writing it down.
 *
 * Every signal is derived from what the repo already says — the criterion's own
 * words, the ids it cites, and how many documents depend on those ids. Nothing
 * is scored by hand, because a field somebody types is a field that goes wrong.
 *
 * THE LADDER ONLY RATCHETS UP
 *
 * This is the rule that keeps the tool safe to be wrong. T1 is exactly the
 * existing requirement — one test that can fail — so nothing this tool decides
 * can ever justify testing something LESS. A misjudged tier costs some wasted
 * diligence; it can never remove a check that was already there. Read every
 * output with that in mind: the tool raises the floor, it does not set it.
 *
 * It also cannot see the thing that is expensive for a reason nobody wrote down.
 * Its real product is a reviewer's attention budget — a ranked list of where to
 * actually look — not a verdict.
 *
 * Usage:
 *   node .cursor/tools/risk-profile.mjs profile [spec.md] [--json] [--tier T2|T3]
 *   node .cursor/tools/risk-profile.mjs check   [spec.md] [--json]   # gate 5
 *   node .cursor/tools/risk-profile.mjs explain AC-12
 *
 * Exit codes:  0 = every criterion carries the evidence its tier requires
 *              1 = a T2 or T3 criterion is under-evidenced
 *              2 = usage / nothing to profile
 */

import { readFileSync, existsSync } from "node:fs";
import { report, emit, block, info } from "./_findings.mjs";
import { join } from "node:path";

const AC = await import(new URL("./ac-trace.mjs", import.meta.url).href);
const ROOT = AC.ROOT;

const out = (s = "") => process.stdout.write(s + "\n");
const pad = (s, n) => String(s).slice(0, n - 1).padEnd(n);
const fail = (m, c = 2) => { process.stderr.write(m + "\n"); process.exit(c); };

/* ----------------------------------------------------------------- signals */

/**
 * Each signal is a question about the criterion's own words, with the reason it
 * raises the tier. The vocabularies are deliberately domain-specific: a generic
 * list fires on everything, and a check that fires on everything gets switched
 * off within a week.
 *
 * `irreversible` is the narrow one on purpose. "cancel", "send" and "approve"
 * appear in half the UI copy ever written; including them would tier the whole
 * backlog critical and make the ranking useless.
 */
const SIGNALS = [
  { key: "regulated", re: /\b(SAMA|ZATCA|mada|PCI[-\s]?DSS|GDPR|HIPAA|audit\s+trail|regulator[a-z]*|compliance)\b/i,
    why: "carries a regulatory obligation" },
  { key: "money", re: /\b(money|premium|payment|invoice|refund|settle(?:ment)?|debit|credit|balance|commission|SAR|USD|EUR|decimal\(\d+,\d+\))\b/i,
    why: "moves or computes money" },
  { key: "pii", re: /\b(PII|personal\s+data|national\s+id|iqama|passport|IBAN|date\s+of\s+birth|phone\s+number|email\s+address)\b/i,
    why: "handles personal data" },
  { key: "auth", re: /\b(authenticat\w*|authoris\w*|authoriz\w*|permission|entitlement|role|claim|JWT|OAuth|sign-?in|login|session|tenant)\b/i,
    why: "decides who may do what" },
  { key: "irreversible", re: /\b(delete[sd]?|purge[sd]?|settle[sd]?|submit(?:s|ted)?|issue[sd]?|dispatch(?:es|ed)?|void(?:s|ed)?|transfer(?:s|red)?|finali[sz]e[sd]?)\b/i,
    why: "does something that cannot be taken back" },
  { key: "integration", re: /\b(gateway|provider|third[-\s]?party|external|webhook|callback|queue|message\s+bus|retry|retries|timeout|idempoten\w*)\b/i,
    why: "crosses a boundary this system does not control" },
  { key: "concurrency", re: /\b(concurren\w*|simultaneous\w*|race\s+condition|lock(?:ing|s)?|parallel|at\s+the\s+same\s+time)\b/i,
    why: "can happen twice at once" },
];

/** Fan-in thresholds. Structural, not guessed: how many documents cite the id. */
const CENTRAL_HIGH = 8, CENTRAL_MED = 4;

/* ---------------------------------------------------------------- context */

/**
 * The words a criterion is judged on: its own line plus the few after it,
 * because Given/When/Then spans lines and the money is usually in the Then.
 * `specACs` caps its `text` at 120 characters, which is fine for a report and
 * far too little to read a criterion's subject matter from.
 */
const specCache = new Map();
function contextOf(ac, nextLine) {
  if (!specCache.has(ac.spec)) {
    try { specCache.set(ac.spec, readFileSync(join(ROOT, ac.spec), "utf8").split("\n")); }
    catch { specCache.set(ac.spec, []); }
  }
  const lines = specCache.get(ac.spec);
  // Stop at the next criterion. A fixed window overruns into it, and then a
  // criterion about a page header inherits the settlement's regulatory words and
  // is tiered critical — which makes the ranking worthless in the one way that
  // matters, by ranking everything the same.
  const end = Math.min(nextLine ? nextLine - 1 : Infinity, ac.line + 6);
  return lines.slice(Math.max(0, ac.line - 1), end).join(" ");
}

/** Ids the criterion cites, e.g. BR-4, UC-2 — the rules it implements. */
const ID_RE = /\b([A-Z]{1,4})-(\d{1,4})\b/g;
function citedIds(text) {
  const ids = new Set();
  for (const m of text.matchAll(ID_RE)) if (m[1] !== "AC" && m[1] !== "T") ids.add(`${m[1]}-${Number(m[2])}`);
  return [...ids];
}

/**
 * How many documents depend on an id. Absent `artifact-schema.mjs` or an id
 * grammar is not a failure — a project may never have adopted the convention —
 * but a checker that goes quiet about its own absence is how a check stops
 * checking, so the caller is told either way.
 */
async function centrality() {
  try {
    const as = await import(new URL("./artifact-schema.mjs", import.meta.url).href);
    const g = as.buildGraph();
    if (!g.byId.size) return { map: null, why: "no ids defined in the lifecycle documents" };
    const map = new Map();
    for (const [file, refs] of g.refsByFile) for (const id of refs) map.set(id, (map.get(id) || 0) + 1);
    return { map, why: null };
  } catch (e) {
    return { map: null, why: `traceability graph unavailable: ${String(e.message || e).slice(0, 120)}` };
  }
}

/* ------------------------------------------------------------------ tiers */

/**
 * Explicit rules, in order, first match wins. No arithmetic: two signals that
 * happen to add to the same number are not the same situation, and a total
 * hides which one it was.
 */
function tierOf(hits, central) {
  const has = (k) => hits.some((h) => h.key === k);
  // Naming the word that matched is what makes a tier arguable in two seconds.
  // "money — moves or computes money" is unfalsifiable to a reader;
  // "money — 'settlement'" shows them at once that it fired on a screen's name.
  const reasons = hits.map((h) => `${h.key} ("${h.term}") — ${h.why}`);
  if (central.n >= CENTRAL_HIGH) reasons.push(`central — ${central.id} is cited by ${central.n} documents`);
  else if (central.n >= CENTRAL_MED) reasons.push(`load-bearing — ${central.id} is cited by ${central.n} documents`);

  if (has("regulated")) return { tier: 3, rule: "regulatory obligation", reasons };
  if (has("irreversible") && (has("money") || has("pii"))) return { tier: 3, rule: "irreversible and touches money or personal data", reasons };
  if (has("money") && has("auth")) return { tier: 3, rule: "money behind an authorisation decision", reasons };
  if (central.n >= CENTRAL_HIGH) return { tier: 3, rule: "many documents depend on the rule it implements", reasons };

  if (has("money") || has("pii") || has("auth") || has("irreversible")) return { tier: 2, rule: "touches money, identity, permission, or something irreversible", reasons };
  if (central.n >= CENTRAL_MED) return { tier: 2, rule: "several documents depend on the rule it implements", reasons };
  if (has("integration") && has("concurrency")) return { tier: 2, rule: "crosses a boundary it does not control, concurrently", reasons };

  return { tier: 1, rule: "no signal found — the existing rule applies unchanged", reasons };
}

/** What each tier's tests have to prove, beyond "it runs". */
const REQUIRED = {
  1: { tests: 1, negative: false, layers: 1, says: "one test that can fail" },
  2: { tests: 1, negative: true, layers: 1, says: "one test that can fail, and one that asserts the failure path" },
  3: { tests: 1, negative: true, layers: 2, says: "a failure-path test and coverage at two different layers" },
};

/**
 * Which layer a test file belongs to, from its path. A heuristic, and stated as
 * one: the point of the two-layer requirement is that a criticial criterion is
 * not proved only by a unit test with every collaborator mocked out.
 */
function layerOf(file) {
  const f = file.toLowerCase();
  if (/e2e|playwright|cypress|\.feature$/.test(f)) return "e2e";
  if (/integration|\.it\.|functional|component/.test(f)) return "integration";
  return "unit";
}

/* ------------------------------------------------------------- evaluation */

async function build(args) {
  const { acs, claims } = AC.load(args);
  if (!acs.size) {
    // Same exit 2 either way; in JSON the reader gets the envelope, not stderr.
    if (args.includes("--json")) process.exit(emit(report({ tool: "risk-profile.mjs", command: "check", skipped: true, summary: "no acceptance criteria found - nothing to profile", data: null })));
    fail(`No acceptance criteria found. Nothing to profile.\nNumber them AC-1, AC-2, ... in the spec; the test generators already emit the matching comments.`, 2);
  }
  const cen = await centrality();

  const byAc = new Map();
  for (const c of claims) { if (!byAc.has(c.ac)) byAc.set(c.ac, []); byAc.get(c.ac).push(c); }

  // Where each criterion's own words end: the next criterion in the same spec.
  const boundary = new Map();
  const bySpec = new Map();
  for (const ac of acs.values()) { if (!bySpec.has(ac.spec)) bySpec.set(ac.spec, []); bySpec.get(ac.spec).push(ac); }
  for (const list of bySpec.values()) {
    list.sort((a, b) => a.line - b.line);
    list.forEach((ac, i) => boundary.set(ac.key, list[i + 1]?.line ?? null));
  }

  const rows = [];
  for (const [id, ac] of acs) {
    const ctx = contextOf(ac, boundary.get(id));
    const hits = SIGNALS.map((sig) => { const m = ctx.match(sig.re); return m ? { ...sig, term: m[0] } : null; }).filter(Boolean);
    let central = { n: 0, id: null };
    if (cen.map) for (const cid of citedIds(ctx)) { const n = cen.map.get(cid) || 0; if (n > central.n) central = { n, id: cid }; }

    const t = tierOf(hits, central);
    const req = REQUIRED[t.tier];
    const all = byAc.get(id) || [];
    const real = all.filter((c) => !c.skipped && !c.vacuous && !c.weak.length);
    const layers = new Set(real.map((c) => layerOf(c.file)));
    const negatives = real.filter((c) => c.negative);

    const missing = [];
    if (real.length < req.tests) missing.push(real.length ? `${req.tests} real tests, found ${real.length}` : "no test that can fail");
    if (req.negative && !negatives.length) missing.push("no test asserting the failure path");
    if (layers.size < req.layers) missing.push(`only ${layers.size || "no"} layer${layers.size === 1 ? "" : "s"} (${[...layers].join(", ") || "none"}), needs ${req.layers}`);

    rows.push({ ...ac, tier: t.tier, rule: t.rule, reasons: t.reasons, central,
                tests: real.length, layers: [...layers], negatives: negatives.length,
                evidence: real.map((c) => `${c.file}:${c.line}${c.negative ? " [negative]" : ""}`), missing });
  }
  rows.sort((a, b) => b.tier - a.tier || b.missing.length - a.missing.length || a.num - b.num);
  return { rows, centralityNote: cen.why, acs };
}

const label = (t) => ["", "T1 normal", "T2 high", "T3 critical"][t];

/* ----------------------------------------------------------------- commands */

const CMDS = {
  async profile(args) {
    const { rows, centralityNote } = await build(args);
    if (args.includes("--json")) { out(JSON.stringify({ rows, centralityNote }, null, 2)); return 0; }

    const only = args.includes("--tier") ? Number(String(args[args.indexOf("--tier") + 1]).replace(/\D/g, "")) : null;
    const shown = only ? rows.filter((r) => r.tier === only) : rows;
    const counts = [3, 2, 1].map((t) => `${rows.filter((r) => r.tier === t).length} ${label(t)}`).join(" | ");

    out(`# Risk profile — ${rows.length} acceptance criteria\n`);
    out(`  ${counts}`);
    if (centralityNote) out(`  Structural centrality not used: ${centralityNote}`);
    out(`\n  The ladder only ratchets up. T1 is the existing rule — one test that can`);
    out(`  fail — so nothing here can justify testing anything less.\n`);

    let lastTier = null;
    for (const r of shown) {
      if (r.tier !== lastTier) { out(`\n## ${label(r.tier)} (${rows.filter((x) => x.tier === r.tier).length}) — ${REQUIRED[r.tier].says}\n`); lastTier = r.tier; }
      const flag = r.missing.length ? "GAP " : "ok  ";
      out(`  ${flag}${pad(r.id, 7)} ${r.text || "(no text)"}`);
      out(`        ${r.spec}:${r.line}`);
      if (r.tier > 1) out(`        why: ${r.reasons.join("; ") || r.rule}`);
      out(`        has: ${r.tests} test(s), ${r.negatives} negative, layers: ${r.layers.join("+") || "none"}`);
      for (const m of r.missing) out(`        NEEDS: ${m}`);
    }
    out(`\n  Every "why" above is a rule you can disagree with. If a criterion is tiered`);
    out(`  wrongly, the fix is the wording of the criterion or the rule in this file —`);
    out(`  not an exception list.`);
    return 0;
  },

  async check(args) {
    const { rows, centralityNote } = await build(args);
    const gaps = rows.filter((r) => r.tier > 1 && r.missing.length);
    const t1gaps = rows.filter((r) => r.tier === 1 && r.missing.length);

    if (args.includes("--json")) {
      const findings = [
        ...gaps.map((r) => block(`t${r.tier}-under-evidenced`, `${r.id} (T${r.tier}, ${r.rule}) is missing: ${r.missing.join("; ")}`, { ref: r.id, file: r.spec, line: r.line, detail: { tier: r.tier, missing: r.missing } })),
        ...t1gaps.map((r) => info("t1-uncovered", `${r.id} (T1) is uncovered - ac-trace.mjs check reports it`, { ref: r.id, file: r.spec, line: r.line })),
      ];
      return emit(report({
        tool: "risk-profile.mjs", command: "check", findings,
        summary: gaps.length ? `FAILED: ${gaps.length} criterion/criteria tested as if being wrong were cheap` : `OK: every T2 and T3 criterion carries the evidence its tier requires`,
        data: { criteria: rows.length, gaps, t1gaps: t1gaps.length, centralityNote },
      }));
    }
    out(`# Risk-based coverage — ${rows.length} acceptance criteria\n`);
    if (centralityNote) out(`  Structural centrality not used: ${centralityNote}\n`);
    if (!gaps.length) {
      out(`OK: every T2 and T3 criterion carries the evidence its tier requires.`);
      if (t1gaps.length) out(`\n${t1gaps.length} T1 criterion/criteria are uncovered — ac-trace.mjs check reports those.`);
      return 0;
    }
    for (const r of gaps) {
      out(`  ${label(r.tier)}  ${pad(r.id, 7)} ${r.text || ""}`);
      out(`            ${r.spec}:${r.line}   ${r.rule}`);
      for (const m of r.missing) out(`            MISSING: ${m}`);
      for (const e of r.evidence.slice(0, 4)) out(`            has: ${e}`);
      out("");
    }
    out(`FAILED: ${gaps.length} criterion/criteria are tested as if being wrong were cheap.`);
    out(`A happy-path test proves the code runs. For money, identity and anything that`);
    out(`cannot be taken back, what happens on the bad input IS the requirement.`);
    return 1;
  },

  async explain(args) {
    const id = args.find((a) => /^AC-\d+$/i.test(a));
    if (!id) fail(`explain needs a criterion: explain AC-12`, 2);
    const { rows } = await build(args.filter((a) => a !== id));
    const r = rows.find((x) => x.id.toUpperCase() === id.toUpperCase());
    if (!r) fail(`${id} is not defined in any spec.`, 1);
    out(`${r.id} — ${label(r.tier)}\n`);
    out(`  ${r.text}`);
    out(`  ${r.spec}:${r.line}\n`);
    out(`  Rule that decided the tier:`);
    out(`    ${r.rule}\n`);
    out(`  Signals read from the criterion's own words:`);
    if (!r.reasons.length) out(`    none — no risk vocabulary matched`);
    for (const x of r.reasons) out(`    ${x}`);
    out(`\n  Required at ${label(r.tier)}: ${REQUIRED[r.tier].says}`);
    out(`  Present: ${r.tests} test(s), ${r.negatives} asserting a failure path, layers: ${r.layers.join("+") || "none"}`);
    for (const e of r.evidence) out(`    ${e}`);
    for (const m of r.missing) out(`  MISSING: ${m}`);
    out(`\n  Disagree with the tier? The signals come from the words in the criterion.`);
    out(`  If they are misleading, the criterion is worth rewording — a tester reading`);
    out(`  it would have been misled in the same direction.`);
    return r.missing.length && r.tier > 1 ? 1 : 0;
  },
};

const [cmd, ...args] = process.argv.slice(2);
if (!cmd || !CMDS[cmd]) {
  out(`risk-profile.mjs — where being wrong is expensive, and whether the tests know it

  profile [spec.md] [--tier 3] [--json]   every criterion, ranked, with the rule
                                          that put it there and what it still needs
  check   [spec.md] [--json]              gate 5: fails when a T2 or T3 criterion is
                                          tested as if being wrong were cheap
  explain AC-12                           why that one is tiered the way it is

Tiers come from explicit rules over the criterion's own words and how many
documents depend on the ids it cites. The ladder only ratchets up: T1 is the
existing requirement, so nothing here can justify testing anything less.`);
  process.exit(cmd ? 2 : 0);
}
process.exit((await CMDS[cmd](args)) ?? 0);
