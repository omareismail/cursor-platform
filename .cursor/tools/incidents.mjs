#!/usr/bin/env node
/**
 * incidents.mjs — what production taught, and whether the guard it bought is
 * still standing.
 *
 * WHY THIS EXISTS
 *
 * `/postmortem` is already good. It has an eight-rung escalation ladder, it
 * insists that a finding becomes a `BannedSymbols.txt` entry or a convention
 * test rather than a paragraph, and CLAUDE.md repeats the rule. And in step 6 it
 * writes down, in its own words, the failure mode nothing in this repository
 * could catch:
 *
 *   "Teams delete useful defences during cleanups because nobody recorded that
 *    they helped."
 *
 * Nobody recorded it. There was no link from an incident to the guard it bought,
 * so three things happened silently and often:
 *
 *   1  the postmortem's action item was closed without the guard being built
 *   2  the guard was built, then removed by someone who did not know why it was
 *      there — the analyzer suppressed, the convention test marked Skip, the
 *      banned symbol quietly deleted in a cleanup
 *   3  the same incident recurred and nobody connected the two
 *
 * All three are mechanically detectable the moment an incident record names its
 * guard by path. That is the whole tool.
 *
 * AND THE OTHER HALF: WHAT PRODUCTION FALSIFIED
 *
 * An incident is also evidence about the documents. `nfr.md` says P99 under
 * 400ms; production said 1200ms for six hours. The NFR is not "at risk" — it is
 * WRONG, and phase 1's document still asserts it. `falsifies` records which
 * written ids production disproved, and `learned` puts that list in front of the
 * gate 1 and gate 5 reviewers, who are otherwise reading a document that
 * reality has already contradicted.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not measure anything. There is no ingestion of alerts, no SLO burn
 * calculation, no incident detection — those live in the monitoring the product
 * actually runs, and a tool in a repository that pretended to know about them
 * would be inventing numbers. This records what a human learned, and then holds
 * the repository to it.
 *
 * Usage:
 *   node .cursor/tools/incidents.mjs open --title "..." --detected alert \
 *        --guard "tests/Arch/Idempotency.cs#Retriable_Operations_Are_Idempotent" \
 *        [--guard "..."] [--falsifies NFR-3,AC-12] [--postmortem docs/...] \
 *        [--unmechanisable "why"] --by "name"
 *   node .cursor/tools/incidents.mjs check [--json]     # are the guards still there
 *   node .cursor/tools/incidents.mjs learned [--json]   # what production falsified
 *   node .cursor/tools/incidents.mjs list | show INC-0001
 *
 * Exit codes:  0 = every guard stands   1 = a guard is gone, disabled or absent
 *              2 = usage
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { writeJsonAtomic } from "./_state.mjs";
import { recordFile } from "./_evidence.mjs";
import { report, emit, block } from "./_findings.mjs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.env.CLAUDE_PROJECT_DIR || repoRoot() || process.cwd();
function repoRoot() {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}
const DIR = () => join(ROOT, "lifecycle", "incidents");

const out = (s = "") => process.stdout.write(s + "\n");
const pad = (s, n) => String(s).slice(0, n - 1).padEnd(n);
const die = (m, c = 2) => { process.stderr.write(m + "\n"); process.exit(c); };
const valueOf = (a, f) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : null; };
const allOf = (a, f) => a.reduce((acc, x, i) => (x === f && a[i + 1] ? [...acc, a[i + 1]] : acc), []);

/* -------------------------------------------------------------- the ladder */

/**
 * The same eight rungs `/postmortem` defines, classified from where the guard
 * lives. Rungs 7 and 8 are the ones the skill calls "rung 8 wearing a hat": a
 * line in a document that nobody reads is not prevention, and an incident whose
 * only guard is one has not actually been closed.
 */
const RUNGS = [
  { rung: 1, what: "BannedSymbols.txt entry — compile time, forever", re: /BannedSymbols\.txt$/i },
  { rung: 2, what: "analyzer severity — compile time", re: /\.editorconfig$|Directory\.Build\.props$|\.ruleset$/i },
  { rung: 3, what: "architecture or convention test — CI, every PR", re: /(architecture|convention).*tests?|tests?\/.*\.(cs|ts|tsx|js)$|Tests?\.cs$/i },
  { rung: 4, what: "ESLint rule or AST ban — lint time", re: /eslint|\.eslintrc|lint.*\.(js|cjs|mjs|json)$/i },
  { rung: 5, what: "hook tripwire — while the agent is writing it", re: /\.claude\/hooks\/|hooks\.json$/i },
  { rung: 6, what: "guard rule — generation time, advisory", re: /\.cursor\/rules\/.*\.mdc$/i },
  { rung: 7, what: "memory-bank entry — read by the agent", re: /memory-bank\//i },
  { rung: 8, what: "a line in a document", re: /.*/ },
];
const classify = (spec) => RUNGS.find((r) => r.re.test(spec.split("#")[0]));

/* -------------------------------------------------------- guard verification */

const SKIP_MARK = /\[(Fact|Theory)\s*\([^)]*\bSkip\s*=|\[Ignore(\s*\(|\])|\b(?:it|test|describe)\.(?:skip|todo)\s*\(|^\s*x(?:it|test)\s*\(/;
const COMMENTED = /^\s*(\/\/|#|<!--|;)/;

/**
 * A guard is `path` or `path#needle`. The path must exist; the needle must
 * appear in it, on a line that is not commented out, and not inside a test the
 * suite is skipping.
 *
 * A guard that exists but is switched off is the worst of the three states,
 * because the incident record still says it is there and nobody looks again.
 */
function verify(spec) {
  const [rel, needle] = spec.split("#");
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return { state: "MISSING", why: `${rel} does not exist` };
  if (!needle) return { state: "PRESENT", why: "" };
  let lines; try { lines = readFileSync(abs, "utf8").split("\n"); } catch { return { state: "MISSING", why: `${rel} is unreadable` }; }

  const hits = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.includes(needle));
  if (!hits.length) return { state: "MISSING", why: `"${needle}" is no longer in ${rel}` };
  const live = hits.filter(({ l }) => !COMMENTED.test(l));
  if (!live.length) return { state: "COMMENTED", why: `"${needle}" is only present on a commented-out line` };
  for (const { i } of live) {
    const window = lines.slice(Math.max(0, i - 4), i + 1).join("\n");
    if (SKIP_MARK.test(window)) return { state: "SKIPPED", why: `"${needle}" is inside a test the suite is skipping` };
  }
  return { state: "PRESENT", why: "" };
}

/* -------------------------------------------------------------------- store */

function all() {
  let names = [];
  try { names = readdirSync(DIR()).filter((f) => /^INC-\d+\.json$/.test(f)); } catch { return []; }
  return names.map((f) => { try { return JSON.parse(readFileSync(join(DIR(), f), "utf8")); } catch { return null; } })
              .filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
}
const nextId = (list) => `INC-${String(list.reduce((m, x) => Math.max(m, Number(String(x.id).slice(4)) || 0), 0) + 1).padStart(4, "0")}`;

/* ----------------------------------------------------------------- commands */

const DETECTED = ["alert", "monitoring", "customer", "reconciliation", "manual"];

const CMDS = {
  open(args) {
    const title = valueOf(args, "--title");
    const by = valueOf(args, "--by");
    const detected = (valueOf(args, "--detected") || "").toLowerCase();
    const guards = allOf(args, "--guard");
    const unmech = valueOf(args, "--unmechanisable");
    if (!title) die(`open needs --title "<what happened, in the business's words>"`, 2);
    if (!by) die(`open needs --by "<name>" — an incident with no owner is a story.`, 2);
    if (!DETECTED.includes(detected))
      die(`open needs --detected ${DETECTED.join(" | ")}.\n\nHow you found out is the most useful field in the record: "customer" and\n"reconciliation" mean the monitoring did not fire, which is its own finding.`, 2);
    if (!guards.length && !unmech)
      die(`open needs at least one --guard "<path>[#<needle>]", or --unmechanisable "<why>".\n\n` +
          `/postmortem's ladder exists so a finding becomes a compile error rather than\n` +
          `a paragraph. An incident with no guard named is an incident that will happen\n` +
          `again. If it genuinely cannot be mechanised, say so in words — that is a\n` +
          `different thing from settling quietly, and the record keeps them apart.`, 2);

    const falsifies = (valueOf(args, "--falsifies") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const list = all();

    // "Have we had this before?" — asked here because nobody asks it later.
    const prior = list.filter((x) =>
      (x.guards || []).some((g) => guards.some((n) => g.spec.split("#")[0] === n.split("#")[0])) ||
      (x.falsifies || []).some((f) => falsifies.includes(f)));

    const rec = {
      id: nextId(list), title, at: new Date().toISOString(), openedBy: by, detected,
      impact: valueOf(args, "--impact") || "",
      falsifies,
      guards: guards.map((spec) => { const r = classify(spec); return { spec, rung: r.rung, mechanism: r.what }; }),
      unmechanisable: unmech || "",
      postmortem: valueOf(args, "--postmortem") || "",
      note: valueOf(args, "--note") || "",
      recurrenceOf: prior.map((p) => p.id),
    };
    writeJsonAtomic(join(DIR(), `${rec.id}.json`), rec);
    try { recordFile(ROOT, `lifecycle/incidents/${rec.id}.json`, "incident", { id: rec.id, detected: rec.detected, by: rec.openedBy }); }
    catch (e) { process.stderr.write(`WARN  ${rec.id} was written but could not be added to lifecycle/index.jsonl: ${e.message}\n`); }

    out(`${rec.id} recorded.`);
    for (const g of rec.guards) {
      const v = verify(g.spec);
      out(`  rung ${g.rung}  ${pad(g.spec, 54)} ${v.state}`);
      out(`          ${g.mechanism}`);
      if (v.state !== "PRESENT") out(`          ${v.why}`);
    }
    const weakest = rec.guards.length ? Math.max(...rec.guards.map((g) => g.rung)) : 9;
    const best = rec.guards.length ? Math.min(...rec.guards.map((g) => g.rung)) : 9;
    if (best >= 7 && !unmech) {
      out(`\n  The strongest guard here is rung ${best}. /postmortem calls that "rung 8 wearing`);
      out(`  a hat" — it is read by whoever already agrees with it. Climb the ladder, or`);
      out(`  record --unmechanisable with the reason.`);
    }
    if (prior.length) {
      out(`\n  RECURRENCE: this overlaps ${prior.map((p) => p.id).join(", ")}.`);
      for (const p of prior) out(`    ${p.id}  ${p.at.slice(0, 10)}  ${p.title}`);
      out(`  A guard that was supposed to prevent this already exists on paper. Find out`);
      out(`  whether it was never built, was removed, or does not cover this case —`);
      out(`  those are three different postmortems.`);
    }
    if (falsifies.length) out(`\n  Falsifies: ${falsifies.join(", ")}. Those documents still assert what production disproved.`);
    out(`\n  ${["lifecycle/incidents", rec.id + ".json"].join("/")} — commit it.`);
    return 0;
  },

  check(args) {
    const list = all();
    if (args.includes("--json")) {
      const rows = list.map((i) => ({ ...i, guards: (i.guards || []).map((g) => ({ ...g, ...verify(g.spec) })) }));
      const findings = [];
      for (const i of rows) {
        for (const g of i.guards) if (g.state !== "PRESENT") findings.push(block(`guard-${g.state.toLowerCase()}`, `${i.id}: the guard it bought is ${g.state} - ${g.spec}: ${g.why}`, { ref: i.id, file: g.spec.split("#")[0], detail: { spec: g.spec, rung: g.rung } }));
        const best = i.guards.length ? Math.min(...i.guards.map((g) => g.rung)) : 9;
        if (best >= 7 && !i.unmechanisable) findings.push(block("guard-weak", `${i.id}: strongest guard is rung ${best} - read by whoever already agrees with it`, { ref: i.id }));
      }
      const gone = findings.filter((f) => f.severity === "block" && f.code !== "guard-weak").length;
      const weakN = findings.filter((f) => f.code === "guard-weak").length;
      return emit(report({
        tool: "incidents.mjs", command: "check", findings,
        summary: !rows.length ? "no incident records" : (gone || weakN) ? `${gone} guard(s) bought by past incidents are no longer standing, ${weakN} with no real one` : `every incident guard still stands`,
        data: rows,
      }));
    }
    if (!list.length) { out(`No incident records. lifecycle/incidents/ is empty.`); return 0; }

    const broken = [], weak = [];
    out(`# Incident guards — ${list.length} incident(s)\n`);
    for (const i of list) {
      const results = (i.guards || []).map((g) => ({ ...g, ...verify(g.spec) }));
      const bad = results.filter((g) => g.state !== "PRESENT");
      const best = results.length ? Math.min(...results.map((g) => g.rung)) : 9;
      if (bad.length) broken.push({ i, bad });
      if (best >= 7 && !i.unmechanisable) weak.push(i);
      const mark = bad.length ? "GONE" : best >= 7 && !i.unmechanisable ? "weak" : "ok  ";
      out(`  ${mark}  ${pad(i.id, 10)} ${i.title}`);
      for (const g of results) out(`          rung ${g.rung}  ${pad(g.spec, 52)} ${g.state}`);
      if (i.unmechanisable) out(`          not mechanisable: ${i.unmechanisable}`);
    }
    out("");
    for (const { i, bad } of broken) {
      out(`${i.id} — the guard it bought is no longer there:`);
      for (const g of bad) out(`  ${g.state}  ${g.spec}\n         ${g.why}`);
      out(`  ${i.at.slice(0, 10)}: ${i.title}`);
      out(`  Somebody removed a defence without knowing what it was for. That is the`);
      out(`  exact sentence /postmortem step 6 warns about, and this is the incident it`);
      out(`  will let happen twice.\n`);
    }
    if (weak.length) {
      out(`${weak.length} incident(s) whose strongest guard is rung 7 or 8 — read by whoever`);
      out(`already agrees with it. Climb the ladder or record --unmechanisable:`);
      for (const i of weak) out(`  ${i.id}  ${i.title}`);
      out("");
    }
    if (!broken.length && !weak.length) { out(`OK: every guard an incident bought is still standing.`); return 0; }
    out(`FAILED: ${broken.length} incident(s) with a missing or disabled guard, ${weak.length} with no real one.`);
    return 1;
  },

  learned(args) {
    const list = all();
    const byId = new Map();
    for (const i of list) for (const f of i.falsifies || []) {
      if (!byId.has(f)) byId.set(f, []);
      byId.get(f).push(i);
    }
    if (args.includes("--json")) { out(JSON.stringify([...byId].map(([id, incs]) => ({ id, incidents: incs.map((x) => x.id) })), null, 2)); return 0; }
    if (!byId.size) {
      out(`Nothing recorded as falsified by production.`);
      out(`\nThat is either true, or nobody has been writing --falsifies on the incidents.`);
      out(`An NFR that production disproved and the document still asserts is the kind of`);
      out(`thing a gate 1 reviewer cannot possibly know from reading the document.`);
      return 0;
    }
    out(`# What production falsified — ${byId.size} id(s) across ${list.length} incident(s)\n`);
    for (const [id, incs] of [...byId].sort()) {
      out(`  ${pad(id, 10)} disproved by ${incs.map((x) => x.id).join(", ")}`);
      for (const i of incs) out(`             ${i.at.slice(0, 10)}  ${i.title}`);
    }
    out(`\nThese documents still assert what production contradicted. Reading them at`);
    out(`gate 1 or gate 5 without this list means reviewing a claim reality already`);
    out(`settled — and the reviewer has no way to know from the document itself.`);
    return 0;
  },

  list() {
    const l = all();
    if (!l.length) return void out(`No incident records.`);
    out(`${l.length} incident(s)\n`);
    for (const i of l) {
      const bad = (i.guards || []).filter((g) => verify(g.spec).state !== "PRESENT").length;
      out(`  ${pad(i.id, 10)}${i.at.slice(0, 10)}  ${pad(i.detected, 15)}${i.title}${bad ? `   [${bad} guard(s) gone]` : ""}`);
    }
  },

  show(args) {
    const id = args.find((a) => /^INC-\d+$/i.test(a));
    if (!id) die(`show needs an id: show INC-0001`, 2);
    const i = all().find((x) => x.id.toUpperCase() === id.toUpperCase());
    if (!i) die(`No record for ${id}.`, 1);
    out(`${i.id} — ${i.title}\n`);
    out(`  Opened ${i.at} by ${i.openedBy}`);
    out(`  Detected by: ${i.detected}${i.detected === "customer" || i.detected === "reconciliation" ? "   <- the monitoring did not fire; that is its own finding" : ""}`);
    if (i.impact) out(`  Impact: ${i.impact}`);
    if (i.postmortem) out(`  Postmortem: ${i.postmortem}`);
    if (i.recurrenceOf?.length) out(`  Overlaps: ${i.recurrenceOf.join(", ")}`);
    out(`\n  Guards:`);
    for (const g of i.guards || []) { const v = verify(g.spec); out(`    rung ${g.rung}  ${pad(g.spec, 52)} ${v.state}`); out(`            ${g.mechanism}${v.why ? `\n            ${v.why}` : ""}`); }
    if (i.unmechanisable) out(`    not mechanisable: ${i.unmechanisable}`);
    if (i.falsifies?.length) out(`\n  Falsifies: ${i.falsifies.join(", ")}`);
    if (i.note) out(`\n  ${i.note}`);
    return 0;
  },
};

const [cmd, ...args] = process.argv.slice(2);
if (!cmd || !CMDS[cmd]) {
  out(`incidents.mjs — what production taught, and whether the guard is still standing

  open --title --detected --guard [--falsifies] [--unmechanisable] --by
                       record an incident and the guard it bought
  check [--json]       are those guards still there, and still switched on
  learned [--json]     which written ids production disproved
  list | show INC-0001

/postmortem already insists a finding becomes a compile error rather than a
paragraph. Nothing recorded WHICH guard an incident bought, so a defence could
be removed in a cleanup by someone who never knew why it was there — the exact
failure that skill's own step 6 warns about.

Records live in lifecycle/incidents/ and are committed.`);
  process.exit(cmd ? 2 : 0);
}
process.exit(CMDS[cmd](args) ?? 0);
