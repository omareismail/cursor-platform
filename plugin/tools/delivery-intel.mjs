#!/usr/bin/env node
/**
 * delivery-intel.mjs — the platform's own records, read together, to answer the
 * one question none of them answers alone: is this process producing anything,
 * or is it being performed?
 *
 * WHY THIS EXISTS, AND HOW IT DIFFERS FROM delivery-metrics.mjs
 *
 * `delivery-metrics.mjs` reads GIT and reports DORA: deploy frequency, lead
 * time, change failure rate, rework. That is the industry's question about a
 * codebase, and it is answered there.
 *
 * This reads the LIFECYCLE'S OWN records — gate verdicts, overrides, releases,
 * incidents, the architectural-debt baseline — which by now hold several years'
 * worth of governance evidence and have only ever been read one file at a time.
 * Cross-referenced, they answer things no single record can:
 *
 *   how many attempts does a gate take, and has one ever said NO
 *   do releases that shipped under an override end up in the incident register
 *   how long after a release does the first incident arrive
 *   has the architectural-debt ratchet ever actually turned
 *   how were incidents found — and how often was it a customer
 *
 * NOT A SCORECARD
 *
 * A number reported as good gets optimised. "Gate pass rate 100%" printed with a
 * tick is an instruction to stop failing gates, which is achieved most cheaply by
 * not looking. So nothing here is scored, ranked or given a target. Each
 * observation is printed with BOTH readings it permits and the evidence that
 * tells them apart — because "every gate passed first time" is either unusually
 * good work or a review that has never said no, and the NO-GO count is what
 * distinguishes them.
 *
 * SMALL NUMBERS ARE SAID OUT LOUD
 *
 * Two releases and one incident support no conclusion whatsoever, and a tool
 * that draws a trend line through them is worse than one that stays quiet. Every
 * section prints its n, and refuses the language of trend below a threshold.
 * Where a section has nothing to work from it says so rather than printing a
 * zero that reads like a finding.
 *
 * Usage:
 *   node .cursor/tools/delivery-intel.mjs report [--json]
 *   node .cursor/tools/delivery-intel.mjs questions      # only the interpretation
 *
 * Exit code is always 0 unless the arguments are wrong: this observes, it does
 * not gate. A gate that fires on a metric is how the metric stops being true.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.env.CLAUDE_PROJECT_DIR || repoRoot() || process.cwd();
function repoRoot() {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}
const LC = (...p) => join(ROOT, "lifecycle", ...p);

const out = (s = "") => process.stdout.write(s + "\n");
const pad = (s, n) => String(s).slice(0, n - 1).padEnd(n);
const die = (m, c = 2) => { process.stderr.write(m + "\n"); process.exit(c); };
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const dirJson = (d) => { try { return readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => readJson(join(d, f))).filter(Boolean); } catch { return []; } };
function git(...a) {
  try { return execFileSync("git", a, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 32 * 1024 * 1024 }).trim(); }
  catch { return null; }
}

/** Below this, the word "trend" is not available. */
const N_FOR_TREND = 5;
const enough = (n) => n >= N_FOR_TREND;

/* ------------------------------------------------------------------ sources */

function gates() {
  const s = readJson(LC("state.json"));
  if (!s) return null;
  const ev = dirJson(LC("evidence"));
  const rows = [];
  for (const p of ["REQUIREMENTS", "ANALYSIS", "DESIGN", "DEVELOPMENT", "TESTING", "PRODUCTION"]) {
    const mine = ev.filter((e) => e.phase === p).sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const hist = (s.history || []).filter((h) => String(h.detail || "").startsWith(p + " "));
    const approve = (s.history || []).filter((h) => h.event === "approve" && String(h.detail || "").startsWith(p + " "));
    rows.push({
      phase: p,
      verdicts: mine.length || hist.length,
      noGos: mine.filter((e) => e.verdict === "NO-GO").length || hist.filter((h) => String(h.detail).includes("NO-GO")).length,
      firstVerdict: mine[0]?.at || null,
      approvals: approve.length,
      approvedAt: approve.at(-1)?.at || null,
      underOverride: approve.filter((a) => String(a.detail).includes("UNDER OVERRIDE")).length,
      reviewers: [...new Set(mine.map((e) => e.by).filter(Boolean))],
      approvers: [...new Set(approve.map((a) => String(a.detail).split(" by ")[1] || "").map((x) => x.replace(" (UNDER OVERRIDE)", "")).filter(Boolean))],
    });
  }
  return { state: s, rows };
}

function overrides(state) {
  const list = [];
  for (const [phase, p] of Object.entries(state?.phases || {})) {
    if (!p.override) continue;
    const o = p.override;
    list.push({ phase, ...o, expired: o.expiresAt ? Date.parse(o.expiresAt) < Date.now() : false });
  }
  return list;
}

/** Has the architectural-debt ratchet ever turned? Git already knows. */
function debtHistory() {
  const rel = "lifecycle/fitness-baseline.json";
  if (!existsSync(join(ROOT, rel))) return null;
  const log = git("log", "--format=%H\t%ad", "--date=short", "--", rel);
  if (!log) return null;
  const points = [];
  for (const line of log.split("\n").filter(Boolean).reverse()) {
    const [sha, date] = line.split("\t");
    const blob = git("show", `${sha}:${rel}`);
    if (!blob) continue;
    try { points.push({ date, count: (JSON.parse(blob).violations || []).length }); } catch { /* unreadable revision */ }
  }
  return points;
}

/* ------------------------------------------------------------------- report */

function gather() {
  const g = gates();
  if (!g) return null;
  const rels = dirJson(LC("releases")).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const incs = dirJson(LC("incidents")).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const crs = dirJson(LC("changes"));
  return { ...g, overrides: overrides(g.state), releases: rels, incidents: incs, changes: crs, debt: debtHistory() };
}

function section(title, n, body) {
  out(`## ${title}${n === null ? "" : `   n = ${n}`}\n`);
  body();
  out("");
}

const CMDS = {
  report(args) {
    const d = gather();
    if (!d) return die(`No lifecycle/state.json. There is nothing here to read.\nThis reads what the lifecycle recorded; a repo that never adopted it has\nnothing for it to say — which is a valid configuration, not a gap.`, 1);
    if (args.includes("--json")) { out(JSON.stringify(d, null, 2)); return 0; }

    out(`# Delivery intelligence — ${d.state.product}\n`);
    out(`  Read from the lifecycle's own records, not from git. DORA is`);
    out(`  delivery-metrics.mjs; this is the governance evidence, cross-referenced.\n`);

    section("Gates", d.rows.filter((r) => r.verdicts).length, () => {
      out(`  ${pad("PHASE", 14)}${pad("VERDICTS", 10)}${pad("NO-GO", 8)}${pad("APPROVALS", 11)}REVIEWER -> APPROVER`);
      for (const r of d.rows) {
        if (!r.verdicts && !r.approvals) continue;
        out(`  ${pad(r.phase, 14)}${pad(r.verdicts, 10)}${pad(r.noGos, 8)}${pad(r.approvals, 11)}${r.reviewers.join(",") || "—"} -> ${r.approvers.join(",") || "—"}`);
        if (r.firstVerdict && r.approvedAt) {
          const dd = days(r.firstVerdict, r.approvedAt);
          out(`  ${" ".repeat(14)}${dd} day(s) from first verdict to approval${r.underOverride ? `, ${r.underOverride} approval(s) under override` : ""}`);
        }
      }
      const total = d.rows.reduce((a, r) => a + r.verdicts, 0), no = d.rows.reduce((a, r) => a + r.noGos, 0);
      out(`\n  ${total} verdict(s) recorded, ${no} of them NO-GO.`);
    });

    section("Overrides", d.overrides.length, () => {
      if (!d.overrides.length) return out(`  None granted. Nothing was ever bypassed.`);
      for (const o of d.overrides) {
        out(`  ${pad(o.id, 12)}${pad(o.phase, 14)}risk ${pad(o.risk, 6)}${o.expired ? "EXPIRED" : "active"}  granted ${String(o.at).slice(0, 10)} by ${o.by}`);
        out(`  ${" ".repeat(12)}${o.reason}`);
      }
      const expired = d.overrides.filter((o) => o.expired).length;
      if (expired) out(`\n  ${expired} expired without being resolved. An override that lapses is a risk\n  somebody accepted for a fortnight and then stopped tracking.`);
    });

    section("Releases", d.releases.length, () => {
      if (!d.releases.length) return out(`  None cut. The lifecycle has not shipped anything through release-evidence.mjs.`);
      for (const r of d.releases) {
        const sig = r.signature ? `signed by ${r.signature.by} after ${days(r.at, r.signature.at)} day(s)` : "UNSIGNED";
        out(`  ${pad(r.version, 12)}${String(r.at).slice(0, 10)}  ${pad(String(r.contents?.commitCount ?? "?") + " commits", 14)}${sig}`);
        const ov = [...new Set([...(r.owed?.activeOverrides || []).map((o) => o.id), ...(r.signature?.acceptedOverrides || [])])];
        if (ov.length) out(`  ${" ".repeat(12)}shipped under ${ov.join(", ")}`);
      }
      if (d.releases.length > 1) {
        const gaps = d.releases.slice(1).map((r, i) => days(d.releases[i].at, r.at));
        const avg = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
        out(`\n  ${enough(d.releases.length) ? `Median gap` : `Gap over only ${d.releases.length} releases`}: about ${avg} day(s).`);
        if (!enough(d.releases.length)) out(`  ${d.releases.length} releases is not a cadence. This is an observation, not a trend.`);
      }
      const signers = [...new Set(d.releases.map((r) => r.signature?.by).filter(Boolean))];
      if (signers.length === 1 && d.releases.length > 2)
        out(`\n  Every release signed by ${signers[0]}. One person is the whole human consent.`);
    });

    section("Incidents", d.incidents.length, () => {
      if (!d.incidents.length) return out(`  None recorded. Either nothing has gone wrong, or nothing has been written\n  down — and this tool cannot tell those apart.`);
      const byDetection = new Map();
      for (const i of d.incidents) byDetection.set(i.detected, (byDetection.get(i.detected) || 0) + 1);
      for (const [k, n] of byDetection) out(`  ${pad(k, 16)}${n}`);
      const missed = (byDetection.get("customer") || 0) + (byDetection.get("reconciliation") || 0);
      if (missed) out(`\n  ${missed} found by a customer or by reconciliation — the monitoring did not fire.\n  That is a finding about the alerts, separate from the incident itself.`);
      const rec = d.incidents.filter((i) => i.recurrenceOf?.length);
      if (rec.length) out(`  ${rec.length} overlapped an earlier incident's guard.`);
      // The cross-reference no single record holds.
      const lastRel = d.releases.at(-1);
      if (lastRel) {
        const after = d.incidents.filter((i) => Date.parse(i.at) > Date.parse(lastRel.at));
        if (after.length) out(`  ${after.length} arrived after ${lastRel.version} (cut ${String(lastRel.at).slice(0, 10)}).`);
      }
      const underOv = d.releases.filter((r) => (r.signature?.acceptedOverrides || []).length);
      if (underOv.length && d.incidents.length)
        out(`\n  ${underOv.length} release(s) shipped under an override. With ${d.incidents.length} incident(s) on record\n  that is a coincidence to look at, not a correlation to report — the numbers\n  are far too small for the second.`);
    });

    section("Architectural debt", d.debt ? d.debt.length : null, () => {
      if (!d.debt) return out(`  No fitness baseline committed, so there is no history to read.`);
      if (d.debt.length === 1) return out(`  Baseline set on ${d.debt[0].date} at ${d.debt[0].count}. One point is not a direction.`);
      for (const p of d.debt) out(`  ${p.date}   ${p.count}`);
      const first = d.debt[0], last = d.debt.at(-1);
      out(`\n  ${last.count - first.count === 0 ? `Unchanged at ${last.count} across ${d.debt.length} revisions` : last.count < first.count ? `Down ${first.count - last.count} since ${first.date}` : `UP ${last.count - first.count} since ${first.date} — the ratchet is meant to make that impossible`}.`);
    });

    section("Open change requests", d.changes.filter((c) => !(c.closedAt || c.closed)).length, () => {
      const open = d.changes.filter((c) => !(c.closedAt || c.closed));
      if (!open.length) return out(`  None open.`);
      for (const c of open) out(`  ${pad(c.id || "?", 12)}${pad(c.risk || "", 6)}${c.reason || ""}`);
    });

    CMDS.questions([], d);
    return 0;
  },

  /**
   * The part that matters. Every observation gets both readings it permits, and
   * the evidence that separates them — never a verdict, because a verdict here
   * would be a target, and a target is a thing to be hit rather than measured.
   */
  questions(args, pre) {
    const d = pre || gather();
    if (!d) return die(`No lifecycle/state.json to read.`, 1);
    const qs = [];

    const verdicts = d.rows.reduce((a, r) => a + r.verdicts, 0);
    const noGos = d.rows.reduce((a, r) => a + r.noGos, 0);
    if (verdicts && !noGos) qs.push([
      `${verdicts} gate verdict(s) recorded and not one NO-GO.`,
      `the work has been good enough every time`,
      `the review has never been in a position to say no`,
      `look at whether any verdict was recorded before its artifacts were finished, and at how long each gate took: a review that takes an hour and always passes is the second reading.`]);

    const sameDay = d.rows.filter((r) => r.firstVerdict && r.approvedAt && days(r.firstVerdict, r.approvedAt) === 0).length;
    if (sameDay >= 3) qs.push([
      `${sameDay} gate(s) were approved the same day the verdict was recorded.`,
      `the reviewer and the approver were both ready and the work was done`,
      `the human consent was a formality applied immediately after the machine one`,
      `whether the approver and the reviewer are different people is enforced; whether the approver read anything is not, and cannot be.`]);

    const expired = d.overrides.filter((o) => o.expired);
    if (expired.length) qs.push([
      `${expired.length} override(s) expired without being resolved.`,
      `the risk went away on its own and nobody needed to close the record`,
      `the expiry passed unnoticed and the bypass is now permanent in practice`,
      `the phase derives to STALE once an override lapses, so lifecycle.mjs status already knows. Whether anyone looked is the question.`]);

    const unsigned = d.releases.filter((r) => !r.signature).length;
    if (unsigned) qs.push([
      `${unsigned} release record(s) were cut and never signed.`,
      `they were cut speculatively and the release did not happen`,
      `the release shipped and the authorisation step was skipped`,
      `git log on lifecycle/releases/ against the deploy history. A record with no signature and a deploy behind it is the second.`]);

    const weak = d.incidents.filter((i) => (i.guards || []).length && Math.min(...i.guards.map((g) => g.rung)) >= 7 && !i.unmechanisable);
    if (weak.length) qs.push([
      `${weak.length} incident(s) closed with a rung 7-8 guard and no note saying why.`,
      `the finding genuinely could not be mechanised and nobody wrote it down`,
      `the ladder was skipped because the top of it costs more`,
      `/postmortem's ladder names what each rung catches. Ask what a rung 3 convention test for that finding would have cost — usually an afternoon.`]);

    if (d.debt && d.debt.length > 2 && d.debt.at(-1).count === d.debt[0].count) qs.push([
      `The architectural-debt baseline has not moved across ${d.debt.length} revisions.`,
      `the debt is stable and nothing new is being added`,
      `the ratchet is being re-accepted rather than turned`,
      `the count can only fall, so "unchanged" means nothing was ever fixed. Compare against how many features shipped in the same window.`]);

    const noIncidents = !d.incidents.length && d.releases.length >= 3;
    if (noIncidents) qs.push([
      `${d.releases.length} releases and no incident recorded.`,
      `the releases were clean`,
      `incidents happen and nobody opens a record for them`,
      `ask whoever was on call. An incident register that has never had an entry is usually a register nobody knows exists.`]);

    if (!qs.length) {
      out(`## Questions\n`);
      out(`  Nothing in the records reads two ways yet. That is mostly because there is`);
      out(`  not much in them: this section gets useful after a few gates, a few`);
      out(`  releases and the first incident.`);
      return 0;
    }
    out(`## Questions the records raise\n`);
    out(`  Each of these reads two ways. Neither reading is scored, because a number`);
    out(`  reported as good becomes a number to hit.\n`);
    for (const [obs, a, b, how] of qs) {
      out(`  ${obs}`);
      out(`      either  ${a}`);
      out(`      or      ${b}`);
      out(`      tell them apart: ${how}\n`);
    }
    return 0;
  },
};

const [cmd, ...args] = process.argv.slice(2);
if (!cmd || !CMDS[cmd]) {
  out(`delivery-intel.mjs — the lifecycle's own records, read together

  report [--json]   gates, overrides, releases, incidents, debt, cross-referenced
  questions         only the interpretation: what each observation could mean

delivery-metrics.mjs reads git and reports DORA. This reads the governance
evidence the lifecycle has been accumulating and never read as a whole.

Nothing here is scored or given a target. A number reported as good becomes a
number to hit, and the cheapest way to hit "no failed gates" is to stop looking.`);
  process.exit(cmd ? 2 : 0);
}
process.exit(CMDS[cmd](args) ?? 0);
