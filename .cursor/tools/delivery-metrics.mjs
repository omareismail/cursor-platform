#!/usr/bin/env node
/**
 * delivery-metrics.mjs — DORA four keys + rework rate, computed from git history.
 *
 * WHY THIS EXISTS
 *
 * A 77-skill agent platform is a throughput amplifier. DORA's 2025/2026 research
 * is blunt about what that does on its own: AI adoption raises throughput 2-18%
 * while stability degrades — one study measured change failure rate going from
 * 8% to 14% after Copilot adoption, with PR size +154% and review time +91%.
 * "AI improves outcomes only when the underlying delivery system is already
 * working well."
 *
 * So the platform needs to be able to answer: is this making delivery better, or
 * just making more code faster? Without a number, that question gets answered by
 * whoever is most confident, which is not a control system.
 *
 * HONESTY ABOUT WHAT IS MEASURED
 *
 * Git history alone cannot observe deployments or incidents. Every metric below
 * is labelled MEASURED or PROXY, and the proxies are named. A dashboard that
 * hides its assumptions is worse than no dashboard, because people act on it.
 * Wire --deploy-tag to your real release tags and --fix-pattern to your real
 * incident convention and most of the proxies become measurements.
 *
 * Usage:
 *   node .cursor/tools/delivery-metrics.mjs report [--days 90] [--json]
 *   node .cursor/tools/delivery-metrics.mjs report --deploy-tag 'v*' --main main
 *   node .cursor/tools/delivery-metrics.mjs trend  [--days 180] [--bucket 30]
 *
 * Options:
 *   --days N            window to analyse (default 90)
 *   --main <branch>     integration branch (default: auto-detect main/master)
 *   --deploy-tag <glob> tags that represent a deploy. If set, deployment
 *                       frequency and MTTR become MEASURED instead of proxied.
 *   --fix-pattern <re>  commit subjects that indicate a production fix
 *                       (default: fix|hotfix|revert|rollback|incident)
 *   --rework-days N     a change is "rework" if it touches a file changed by a
 *                       different commit within this window (default 21)
 *   --json              machine-readable output
 *
 * Exit codes: 0 = report produced   2 = not a git repo / bad usage
 */

import { execFileSync } from "node:child_process";

const SEP = "";   // field separator that will not appear in a commit message
const REC = "";   // record separator

// ------------------------------------------------------------------ git ----

function git(args, { allowFail = true } = {}) {
  try {
    return execFileSync("git", args, { stdio: "pipe", maxBuffer: 256 * 1024 * 1024 }).toString();
  } catch (e) {
    if (allowFail) return "";
    throw e;
  }
}

function requireRepo() {
  if (!git(["rev-parse", "--is-inside-work-tree"]).trim()) {
    fail("Not a git repository. Delivery metrics are computed from git history.", 2);
  }
}

function detectMain(explicit) {
  if (explicit) return explicit;
  for (const b of ["main", "master", "develop"]) {
    if (git(["rev-parse", "--verify", "--quiet", b]).trim()) return b;
  }
  return "HEAD";
}

/** All commits in the window, with parents so merges can be identified. */
function loadCommits(main, days) {
  const raw = git([
    "log", main, `--since=${days}.days.ago`,
    `--pretty=format:%H${SEP}%P${SEP}%at${SEP}%an${SEP}%s${REC}`,
  ]);
  return raw.split(REC).map(r => r.trim()).filter(Boolean).map(r => {
    const [sha, parents, at, author, subject] = r.split(SEP);
    return {
      sha, parents: (parents || "").trim().split(/\s+/).filter(Boolean),
      at: Number(at) * 1000, author, subject: subject || "",
      isMerge: (parents || "").trim().split(/\s+/).filter(Boolean).length > 1,
    };
  });
}

// -------------------------------------------------------------- metrics ----

/**
 * Lead time for changes: first commit of a branch -> the merge that lands it.
 * MEASURED when the repo uses merge commits; a squash/rebase workflow collapses
 * that history and the metric degrades to "time from authorship to landing",
 * which is reported as PROXY.
 */
function leadTimes(commits, main, days) {
  const merges = commits.filter(c => c.isMerge && c.parents.length >= 2);
  const out = [];

  for (const m of merges) {
    // Commits reachable from the merged-in parent but not from the first parent.
    const list = git(["log", "--pretty=format:%at", `${m.parents[0]}..${m.parents[1]}`]);
    const times = list.split("\n").map(s => Number(s.trim()) * 1000).filter(Boolean);
    if (!times.length) continue;
    const first = Math.min(...times);
    out.push({ sha: m.sha, subject: m.subject, hours: (m.at - first) / 3_600_000 });
  }

  if (out.length) return { values: out, method: "MEASURED", note: "first commit on branch -> merge commit" };

  // Squash/rebase fallback: author date -> commit date on the integration branch.
  const raw = git(["log", main, `--since=${days}.days.ago`, "--no-merges", "--pretty=format:%H|%at|%ct|%s"]);
  const vals = raw.split("\n").filter(Boolean).map(l => {
    const [sha, at, ct, ...rest] = l.split("|");
    return { sha, subject: rest.join("|"), hours: (Number(ct) - Number(at)) / 3600 };
  // A commit pushed straight to the integration branch has author date == commit
  // date, so this proxy reports ~0. That is not an Elite lead time, it is an
  // absence of measurement - drop those rather than flattering the number.
  }).filter(v => v.hours >= 0.02);
  return {
    values: vals, method: "PROXY",
    note: vals.length
      ? "no merge commits found (squash or rebase workflow) - using author-date to commit-date, which understates real lead time"
      : "no merge commits and no author/commit date gap - this workflow commits straight to the integration branch, so lead time cannot be derived from git alone",
  };
}

/** Deployments: real tags if given, otherwise merges into the integration branch. */
function deployments(commits, days, deployTag) {
  if (deployTag) {
    const raw = git(["tag", "-l", deployTag, "--sort=creatordate", "--format=%(creatordate:unix)%(refname:short)%00%(refname:short)"]);
    const cutoff = Date.now() - days * 86_400_000;
    const list = git(["for-each-ref", `refs/tags/${deployTag}`, "--sort=creatordate",
                      "--format=%(creatordate:unix)|%(refname:short)|%(objectname)"])
      .split("\n").filter(Boolean)
      .map(l => { const [at, name, sha] = l.split("|"); return { at: Number(at) * 1000, name, sha }; })
      .filter(d => d.at >= cutoff);
    return { list, method: "MEASURED", note: `tags matching '${deployTag}'` };
  }
  const list = commits.filter(c => c.isMerge).map(c => ({ at: c.at, name: c.sha.slice(0, 8), sha: c.sha, subject: c.subject }));
  if (list.length) return { list, method: "PROXY", note: "merge commits into the integration branch - pass --deploy-tag to measure real deploys" };
  const all = commits.map(c => ({ at: c.at, name: c.sha.slice(0, 8), sha: c.sha, subject: c.subject }));
  return { list: all, method: "PROXY", note: "every commit on the integration branch (no merges found) - this almost certainly overstates deployment frequency" };
}

/** Failures: commits whose subject matches the fix/revert convention. */
function failures(commits, fixRe) {
  const list = commits.filter(c => fixRe.test(c.subject) && !c.isMerge);
  return { list, method: "PROXY", note: `commit subjects matching /${fixRe.source}/i - accuracy depends entirely on commit hygiene` };
}

/**
 * MTTR: time from the deploy preceding a fix to the fix itself.
 * Only meaningful when the fix convention is actually followed.
 */
function mttr(deploys, fixes) {
  const sorted = [...deploys].sort((a, b) => a.at - b.at);
  const out = [];
  for (const f of fixes) {
    const prior = sorted.filter(d => d.at <= f.at).pop();
    if (!prior) continue;
    const hours = (f.at - prior.at) / 3_600_000;
    if (hours >= 0 && hours < 24 * 30) out.push({ fix: f.subject, hours });
  }
  return out;
}

/**
 * Rework rate — DORA's newer metric, and the one that matters most for an
 * AI-amplified codebase: how much of what we ship is re-touching code we only
 * just wrote? Rising rework with rising throughput is the signature of
 * generating faster than you are verifying.
 *
 * Proxy: a commit is rework if it touches a file that a DIFFERENT commit
 * touched within the last N days. That is code churn, the standard stand-in.
 */
function reworkRate(main, days, reworkDays) {
  const raw = git(["log", main, `--since=${days}.days.ago`, "--no-merges", "--reverse",
                   `--pretty=format:${REC}%H${SEP}%at`, "--name-only"]);
  const recs = raw.split(REC).map(r => r.trim()).filter(Boolean);
  const lastTouch = new Map();       // file -> {at, sha}
  let total = 0, rework = 0;
  const churned = new Map();         // file -> count

  for (const r of recs) {
    const [head, ...fileLines] = r.split("\n");
    const [sha, atStr] = head.split(SEP);
    const at = Number(atStr) * 1000;
    const files = fileLines.map(s => s.trim()).filter(Boolean);
    if (!files.length) continue;
    total++;
    let isRework = false;
    for (const f of files) {
      const prev = lastTouch.get(f);
      if (prev && prev.sha !== sha && (at - prev.at) <= reworkDays * 86_400_000) {
        isRework = true;
        churned.set(f, (churned.get(f) || 0) + 1);
      }
      lastTouch.set(f, { at, sha });
    }
    if (isRework) rework++;
  }
  const hottest = [...churned.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  return { total, rework, pct: total ? (rework / total) * 100 : 0, hottest };
}

/** Change size — PR size proxy. DORA 2026 flags growth here as an AI-adoption tell. */
function changeSizes(main, days) {
  const raw = git(["log", main, `--since=${days}.days.ago`, "--no-merges", "--pretty=format:%H", "--shortstat"]);
  const sizes = [];
  for (const block of raw.split(/\n(?=[0-9a-f]{40})/)) {
    const m = block.match(/(\d+) insertions?\(\+\)|(\d+) deletions?\(-\)/g);
    if (!m) continue;
    const n = m.reduce((s, x) => s + Number(x.match(/\d+/)[0]), 0);
    sizes.push(n);
  }
  return sizes;
}

// ------------------------------------------------------------ benchmarks ---
// DORA performance bands. Deliberately shown as ranges, not a grade: a single
// letter invites gaming, and the useful signal is the direction of travel.
const BANDS = {
  deployFreq: [["Elite", "on-demand, multiple per day", d => d >= 1],
               ["High", "between once per day and once per week", d => d >= 1 / 7],
               ["Medium", "between once per week and once per month", d => d >= 1 / 30],
               ["Low", "less than once per month", () => true]],
  leadTime:   [["Elite", "< 1 day", h => h < 24],
               ["High", "1 day - 1 week", h => h < 24 * 7],
               ["Medium", "1 week - 1 month", h => h < 24 * 30],
               ["Low", "> 1 month", () => true]],
  cfr:        [["Elite", "0-5%", p => p <= 5],
               ["High", "5-10%", p => p <= 10],
               ["Medium", "10-15%", p => p <= 15],
               ["Low", "> 15%", () => true]],
  mttr:       [["Elite", "< 1 hour", h => h < 1],
               ["High", "< 1 day", h => h < 24],
               ["Medium", "< 1 week", h => h < 24 * 7],
               ["Low", "> 1 week", () => true]],
};
const band = (key, v, samples = 1) =>
  samples === 0 || v === 0 && samples === 0
    ? ["insufficient data", "not enough history to rate this", null]
    : (BANDS[key].find(([, , t]) => t(v)) || ["?", "", null]);

// --------------------------------------------------------------- commands --
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

function compute(args) {
  requireRepo();
  const num = (f, d) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : d; };
  const str = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };

  const days = num("--days", 90);
  const main = detectMain(str("--main", null));
  const deployTag = str("--deploy-tag", null);
  const fixRe = new RegExp(str("--fix-pattern", "\\b(fix|hotfix|revert|rollback|incident|patch)\\b"), "i");
  const reworkDays = num("--rework-days", 21);

  const commits = loadCommits(main, days);
  if (!commits.length) fail(`No commits on '${main}' in the last ${days} days.`, 2);

  const dep = deployments(commits, days, deployTag);
  const lead = leadTimes(commits, main, days);
  const fail_ = failures(commits, fixRe);
  const mt = mttr(dep.list, fail_.list);
  const rw = reworkRate(main, days, reworkDays);
  const sizes = changeSizes(main, days);

  const perDay = dep.list.length / days;
  const cfrPct = dep.list.length ? (fail_.list.length / dep.list.length) * 100 : 0;

  return {
    window: { days, branch: main, commits: commits.length, since: new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10) },
    deploymentFrequency: { perDay, perWeek: perDay * 7, count: dep.list.length, method: dep.method, note: dep.note, band: band("deployFreq", perDay, dep.list.length) },
    leadTime: { medianHours: median(lead.values.map(v => v.hours)), p90Hours: pct(lead.values.map(v => v.hours), 0.9), samples: lead.values.length, method: lead.method, note: lead.note, band: band("leadTime", median(lead.values.map(v => v.hours)), lead.values.length) },
    changeFailureRate: { pct: cfrPct, failures: fail_.list.length, method: fail_.method, note: fail_.note, band: band("cfr", cfrPct, dep.list.length), examples: fail_.list.slice(0, 5).map(c => c.subject) },
    mttr: { medianHours: median(mt.map(m => m.hours)), samples: mt.length, method: "PROXY", note: "preceding deploy -> fix commit", band: band("mttr", median(mt.map(m => m.hours)), mt.length) },
    reworkRate: { pct: rw.pct, reworkCommits: rw.rework, totalCommits: rw.total, windowDays: reworkDays, method: "PROXY", note: `a commit counts as rework if it re-touches a file another commit changed within ${reworkDays} days`, hottestFiles: rw.hottest },
    changeSize: { medianLines: median(sizes), p90Lines: pct(sizes, 0.9), samples: sizes.length, method: "MEASURED" },
  };
}

const CMDS = {
  report(args) {
    const m = compute(args);
    if (args.includes("--json")) { out(JSON.stringify(m, null, 2)); return 0; }

    out(`# Delivery metrics — last ${m.window.days} days on '${m.window.branch}' (since ${m.window.since})`);
    out(`  ${m.window.commits} commits\n`);

    row("Deployment frequency", `${m.deploymentFrequency.perWeek.toFixed(1)}/week (${m.deploymentFrequency.count} total)`, m.deploymentFrequency);
    row("Lead time for changes", `median ${hrs(m.leadTime.medianHours)}, p90 ${hrs(m.leadTime.p90Hours)}`, m.leadTime);
    row("Change failure rate", `${m.changeFailureRate.pct.toFixed(1)}% (${m.changeFailureRate.failures} fixes)`, m.changeFailureRate);
    row("Time to restore", `median ${hrs(m.mttr.medianHours)} (${m.mttr.samples} samples)`, m.mttr);
    out(`\n  Rework rate            ${m.reworkRate.pct.toFixed(1)}%  (${m.reworkRate.reworkCommits}/${m.reworkRate.totalCommits} commits re-touch code < ${m.reworkRate.windowDays}d old)   [PROXY]`);
    out(`  Change size            median ${m.changeSize.medianLines} lines, p90 ${m.changeSize.p90Lines}   [MEASURED]`);

    if (m.reworkRate.hottestFiles.length) {
      out(`\n  Churn hotspots (re-touched most often - where rework concentrates):`);
      for (const [f, n] of m.reworkRate.hottestFiles) out(`    ${String(n).padStart(3)}x  ${f}`);
    }
    if (m.changeFailureRate.examples.length) {
      out(`\n  Sample fix commits (the change-failure-rate input - check these are real failures):`);
      for (const s of m.changeFailureRate.examples) out(`    - ${s.slice(0, 88)}`);
    }

    out(`\n## Read this before acting on the numbers`);
    out(`  Metrics marked PROXY are inferred from commit history, not observed. The`);
    out(`  proxy is named on each line. To turn proxies into measurements:`);
    out(`    --deploy-tag 'v*'        real deploys instead of merge commits`);
    out(`    --fix-pattern '<regex>'  your actual incident/hotfix convention`);
    out(`  Trend matters more than level. A single reading tells you almost nothing;`);
    out(`  run \`trend\` and watch the direction.`);
    out(`\n  Watch specifically for throughput and stability moving in opposite`);
    out(`  directions - deployment frequency up while change failure rate and rework`);
    out(`  rate also rise. That is the documented failure mode of AI-assisted`);
    out(`  delivery, and it is the reason this tool exists.`);
    return 0;
  },

  trend(args) {
    requireRepo();
    const num = (f, d) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : d; };
    const totalDays = num("--days", 180), bucket = num("--bucket", 30);
    const buckets = Math.max(2, Math.floor(totalDays / bucket));
    const rows = [];
    for (let i = buckets - 1; i >= 0; i--) {
      const win = bucket * (i + 1);
      const m = compute([...args.filter(a => a !== "--json"), "--days", String(win)]);
      rows.push({ upTo: win, ...m });
    }
    if (args.includes("--json")) { out(JSON.stringify(rows, null, 2)); return 0; }

    out(`# Delivery trend (cumulative windows, newest first)\n`);
    out(`  ${pad("window", 12)}${pad("deploys/wk", 13)}${pad("lead(med)", 12)}${pad("CFR", 9)}${pad("rework", 9)}size(med)`);
    out(`  ${"-".repeat(63)}`);
    for (const r of rows.reverse()) {
      out(`  ${pad(`${r.upTo}d`, 12)}${pad(r.deploymentFrequency.perWeek.toFixed(1), 13)}` +
          `${pad(hrs(r.leadTime.medianHours), 12)}${pad(r.changeFailureRate.pct.toFixed(1) + "%", 9)}` +
          `${pad(r.reworkRate.pct.toFixed(1) + "%", 9)}${r.changeSize.medianLines}`);
    }
    out(`\n  Cumulative windows, so the shortest window is the most recent behaviour.`);
    out(`  If CFR and rework climb as the window shortens, recent delivery is getting`);
    out(`  less stable - regardless of what deployment frequency is doing.`);
    return 0;
  },
};

// ------------------------------------------------------------------ utils --
const out = (s = "") => process.stdout.write(s + "\n");
const pad = (s, n) => String(s).slice(0, n - 1).padEnd(n);
const hrs = (h) => (!h ? "n/a" : h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`);
function row(label, value, m) {
  out(`  ${pad(label, 23)}${pad(value, 34)}${pad(m.band[0], 18)}[${m.method}]`);
  if (m.band[2]) out(`  ${" ".repeat(23)}DORA ${m.band[0]}: ${m.band[1]}`);
  else           out(`  ${" ".repeat(23)}${m.band[1]}`);
  if (m.method === "PROXY") out(`  ${" ".repeat(23)}proxy: ${m.note}`);
}
function fail(msg, code = 2) { process.stderr.write(msg + "\n"); process.exit(code); }

const [cmd, ...args] = process.argv.slice(2);
if (!cmd || !CMDS[cmd] || cmd === "--help" || cmd === "-h") {
  out(`delivery-metrics.mjs — DORA four keys + rework rate from git history.

  report  [--days 90] [--main <branch>] [--deploy-tag 'v*'] [--fix-pattern <re>] [--json]
  trend   [--days 180] [--bucket 30] [--json]

Every metric is labelled MEASURED or PROXY. Pass --deploy-tag and --fix-pattern
to convert proxies into measurements. See .cursor/skills/delivery-metrics/skill.md.`);
  process.exit(cmd && !CMDS[cmd] ? 2 : 0);
}
process.exit(CMDS[cmd](args) ?? 0);
