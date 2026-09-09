#!/usr/bin/env node
/**
 * feature-map.mjs — the behavioural cache layer.
 *
 *   repo-map.json     answers "what is in this repo?"        (structure)
 *   feature-map.json  answers "what does this repo DO?"      (behaviour)
 *
 * Owned by /feature-trace, /feature-inventory and /impact-analysis. Never
 * hand-edited — the PreToolUse write guard blocks that.
 *
 * Freshness is computed from content hashes of the files on disk, not from
 * prose or timestamps. A trace records the exact hash of every file it covers,
 * so `verify` can say precisely which features went stale and which files moved
 * underneath them. An agent guessing "this looks recent enough" is exactly the
 * failure mode this replaces.
 *
 * Usage:
 *   node .cursor/tools/feature-map.mjs init
 *   node .cursor/tools/feature-map.mjs verify [feature-id]
 *   node .cursor/tools/feature-map.mjs stale [--json]
 *   node .cursor/tools/feature-map.mjs list [--json]
 *   node .cursor/tools/feature-map.mjs show <feature-id>
 *   node .cursor/tools/feature-map.mjs query --file <path>
 *   node .cursor/tools/feature-map.mjs query --table <name>
 *   node .cursor/tools/feature-map.mjs query --endpoint <method /path>
 *   node .cursor/tools/feature-map.mjs upsert <file.json>     # written by the skills
 *   node .cursor/tools/feature-map.mjs reindex
 *   node .cursor/tools/feature-map.mjs rm <feature-id>
 *
 * Exit codes:  0 = ok/fresh   1 = stale or missing   2 = usage/schema error
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { writeJsonAtomic } from "./_state.mjs";
import { join, resolve, sep } from "node:path";

const ROOT = process.env.CLAUDE_PROJECT_DIR || findRepoRoot() || process.cwd();
const MAP_PATH = join(ROOT, ".cursor", "cache", "feature-map.json");
const SCHEMA_VERSION = 1;
// TRACE_STALE_DAYS, not STALE_DAYS: this is how old a feature TRACE may get
// before it is called aged out, which is a different question from
// memory-bank.mjs's 7-day file staleness and deliberately a different number.
// Two facts sharing one name is how a reader - or a drift check - conflates
// them; the qualified name is the whole fix.
const TRACE_STALE_DAYS = 14;

// ---------------------------------------------------------------- helpers ---

function findRepoRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { stdio: "pipe" }).toString().trim();
  } catch { return null; }
}

function git(args, fallback = "") {
  try {
    return execFileSync("git", args, { cwd: ROOT, stdio: "pipe", maxBuffer: 64 * 1024 * 1024 }).toString();
  } catch { return fallback; }
}

const norm = (p) => String(p || "").split(sep).join("/").replace(/^\.\//, "").replace(/^\/+/, "");

/** Every path git tracks. Used only to flag traces that cite untracked files. */
function trackedSet() {
  const s = new Set();
  for (const line of git(["ls-files"]).split("\n")) if (line) s.add(norm(line));
  return s;
}

/**
 * Content hash of the file AS IT IS ON DISK, for the given paths.
 *
 * Deliberately not `git ls-files -s`: that returns the *index* SHA, so a file
 * edited but not staged would hash as unchanged while the code you traced is
 * already different. Hashing the working tree is what "did this actually
 * change since I traced it?" means.
 *
 * One git call for all paths via --stdin-paths.
 */
function worktreeShas(paths) {
  const list = [...new Set(paths.map(norm))].filter(Boolean);
  const m = new Map();
  if (!list.length) return m;

  const existing = list.filter(p => existsSync(join(ROOT, p)));
  if (existing.length) {
    let outStr = "";
    try {
      outStr = execFileSync("git", ["hash-object", "--stdin-paths"], {
        cwd: ROOT, input: existing.join("\n") + "\n",
        stdio: "pipe", maxBuffer: 64 * 1024 * 1024,
      }).toString();
    } catch { outStr = ""; }
    const shas = outStr.split("\n").filter(Boolean);
    // git preserves input order, so a length mismatch means we cannot trust the
    // pairing — fall back to per-file hashing rather than silently misaligning.
    if (shas.length === existing.length) {
      existing.forEach((p, i) => m.set(p, shas[i]));
    } else {
      for (const p of existing) {
        const one = git(["hash-object", p]).trim();
        if (one) m.set(p, one);
      }
    }
  }
  for (const p of list) if (!m.has(p)) m.set(p, null); // deleted / unreadable
  return m;
}

function emptyMap() {
  return {
    $schema: "cursor-platform/feature-map@1",
    version: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    repo: norm(ROOT.split(sep).pop() || ""),
    features: {},
    index: { byFile: {}, byTable: {}, byEndpoint: {}, byFlag: {} },
  };
}

function load({ required = true } = {}) {
  if (!existsSync(MAP_PATH)) {
    if (!required) return null;
    fail(`No feature-map.json.\nRun: node .cursor/tools/feature-map.mjs init\nThen trace a feature with /feature-trace.`, 1);
  }
  let m;
  try { m = JSON.parse(readFileSync(MAP_PATH, "utf8")); }
  catch (e) { fail(`feature-map.json is not valid JSON: ${e.message}\nDelete it and re-run init; do not hand-repair.`, 2); }
  if (m.version !== SCHEMA_VERSION) {
    warn(`feature-map.json is schema v${m.version}, tool expects v${SCHEMA_VERSION}. Re-trace affected features.`);
  }
  m.features ||= {};
  m.index ||= { byFile: {}, byTable: {}, byEndpoint: {}, byFlag: {} };
  return m;
}

function save(m) {
  m.generatedAt = new Date().toISOString();
  writeJsonAtomic(MAP_PATH, m);
}

const out = (s = "") => process.stdout.write(s + "\n");
const warn = (s) => process.stderr.write("warning: " + s + "\n");
function fail(msg, code = 2) { process.stderr.write(msg + "\n"); process.exit(code); }

const daysSince = (iso) => {
  const t = Date.parse(iso || "");
  return Number.isNaN(t) ? Infinity : (Date.now() - t) / 86_400_000;
};

// ------------------------------------------------------------- freshness ---

/**
 * A feature is stale when any recorded file's on-disk content no longer hashes
 * to what was recorded, or the file is gone. Age alone is reported but does NOT
 * mark a feature stale: a trace of code nobody has touched in six months is
 * still accurate, and crying wolf on it trains people to ignore the signal.
 *
 * Each reason is reported separately — "stale" with no reason is not actionable.
 */
function assess(feature, shas) {
  const changed = [], missing = [];
  for (const f of feature.files || []) {
    const p = norm(f.path);
    const current = shas.get(p);
    if (current === null || current === undefined) { missing.push(p); continue; }
    if (f.sha && f.sha !== current) changed.push(p);
  }
  const age = daysSince(feature.tracedAt);
  const stale = changed.length > 0 || missing.length > 0;
  return {
    stale, changed, missing,
    agedOut: age > TRACE_STALE_DAYS,
    ageDays: Number.isFinite(age) ? Math.floor(age) : null,
    fileCount: (feature.files || []).length,
  };
}

/** Collect every path referenced by the given features, for one bulk hash call. */
const allPaths = (features) =>
  features.flatMap(([, f]) => (f.files || []).map(x => norm(x.path)));

function reindex(m) {
  const idx = { byFile: {}, byTable: {}, byEndpoint: {}, byFlag: {} };
  const push = (bucket, key, id) => {
    if (!key) return;
    const k = String(key);
    (idx[bucket][k] ||= []);
    if (!idx[bucket][k].includes(id)) idx[bucket][k].push(id);
  };
  for (const [id, f] of Object.entries(m.features)) {
    for (const file of f.files || []) push("byFile", norm(file.path), id);
    for (const t of f.dataTouched?.tables || []) push("byTable", t, id);
    for (const e of f.entryPoints || []) if (e.ref) push("byEndpoint", e.ref, id);
    for (const fl of f.featureFlags || []) push("byFlag", typeof fl === "string" ? fl : fl.name, id);
  }
  m.index = idx;
  return m;
}

// --------------------------------------------------------------- commands ---

const CMDS = {
  init() {
    if (existsSync(MAP_PATH)) { out(`feature-map.json already exists (${Object.keys(load().features).length} features). Nothing to do.`); return 0; }
    save(emptyMap());
    out(`Created ${norm(MAP_PATH.replace(ROOT, ""))}`);
    out(`Trace your first feature with /feature-trace "<feature name>".`);
    return 0;
  },

  list(args) {
    const m = load();
    const entries = Object.entries(m.features);
    const shas = worktreeShas(allPaths(entries));
    const rows = entries.map(([id, f]) => ({
      id, name: f.name || id, status: f.status || "unknown",
      confidence: f.confidence || "?", files: (f.files || []).length,
      ...assess(f, shas),
    }));
    if (args.includes("--json")) { out(JSON.stringify(rows, null, 2)); return 0; }
    if (!rows.length) { out("No features traced yet. Run /feature-trace \"<name>\"."); return 0; }
    out(`${rows.length} feature(s) in feature-map.json\n`);
    out(pad("ID", 30) + pad("STATUS", 10) + pad("CONF", 8) + pad("FILES", 7) + "FRESHNESS");
    out("-".repeat(78));
    for (const r of rows.sort((a, b) => a.id.localeCompare(b.id))) {
      const f = r.stale ? `STALE (${reasons(r)})`
              : r.agedOut ? `ok (${r.ageDays}d old, unchanged)`
              : `fresh (${r.ageDays}d)`;
      out(pad(r.id, 30) + pad(r.status, 10) + pad(r.confidence, 8) + pad(String(r.files), 7) + f);
    }
    return rows.some(r => r.stale) ? 1 : 0;
  },

  verify(args) {
    const m = load();
    const only = args.find(a => !a.startsWith("--"));
    const entries = only
      ? (m.features[only] ? [[only, m.features[only]]] : fail(`Unknown feature '${only}'. Run \`list\` to see ids.`, 2))
      : Object.entries(m.features);
    if (!entries.length) { out("No features traced yet."); return 0; }
    const shas = worktreeShas(allPaths(entries));

    let bad = 0;
    for (const [id, f] of entries) {
      const a = assess(f, shas);
      if (!a.stale) {
        out(`  fresh  ${id}  (${a.fileCount} files, traced ${a.ageDays}d ago)`);
        if (a.agedOut) out(`         trace is ${a.ageDays}d old but every file is byte-identical - still accurate`);
        continue;
      }
      bad++;
      out(`  STALE  ${id}  (${a.fileCount} files, traced ${a.ageDays}d ago)`);
      if (a.changed.length) out(`         content changed since trace: ${a.changed.join(", ")}`);
      if (a.missing.length) out(`         gone or unreadable: ${a.missing.join(", ")}`);
    }
    if (bad) out(`\n${bad} of ${entries.length} feature(s) stale. Re-run /feature-trace on each before relying on it.`);
    return bad ? 1 : 0;
  },

  stale(args) {
    const m = load();
    const entries = Object.entries(m.features);
    const shas = worktreeShas(allPaths(entries));
    const stale = entries.map(([id, f]) => ({ id, ...assess(f, shas) })).filter(r => r.stale);
    if (args.includes("--json")) { out(JSON.stringify(stale, null, 2)); return stale.length ? 1 : 0; }
    if (!stale.length) { out("All traced features are fresh."); return 0; }
    for (const r of stale) out(`${r.id}\t${reasons(r)}`);
    return 1;
  },

  show(args) {
    const m = load();
    const id = args.find(a => !a.startsWith("--"));
    if (!id) fail("Usage: show <feature-id>", 2);
    const f = m.features[id];
    if (!f) fail(`Unknown feature '${id}'.`, 2);
    out(JSON.stringify(f, null, 2));
    return 0;
  },

  query(args) {
    const m = load();
    const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
    const file = get("--file"), table = get("--table"), endpoint = get("--endpoint"), flag = get("--flag");
    const json = args.includes("--json");

    let hits = [];
    if (file) {
      const p = norm(file);
      hits = m.index.byFile?.[p] || [];
      if (!hits.length) {
        // Directory or partial-path fallback — impact-analysis passes globs.
        const seen = new Set();
        for (const [k, ids] of Object.entries(m.index.byFile || {})) {
          if (k.includes(p)) ids.forEach(i => seen.add(i));
        }
        hits = [...seen];
      }
    } else if (table)    hits = matchCI(m.index.byTable, table);
    else if (endpoint)   hits = matchCI(m.index.byEndpoint, endpoint);
    else if (flag)       hits = matchCI(m.index.byFlag, flag);
    else fail("Usage: query --file <path> | --table <name> | --endpoint <ref> | --flag <name>", 2);

    if (json) { out(JSON.stringify(hits, null, 2)); return hits.length ? 0 : 1; }
    if (!hits.length) {
      out(`No traced feature touches that. Either it is genuinely unused, or it has not been traced yet.`);
      out(`Check coverage with \`list\` before concluding the former.`);
      return 1;
    }
    for (const id of hits) {
      const f = m.features[id];
      out(`${id}\t${f?.name || ""}\t${f?.status || ""}\t${(f?.files || []).length} files`);
    }
    return 0;
  },

  upsert(args) {
    const src = args.find(a => !a.startsWith("--"));
    if (!src) fail("Usage: upsert <file.json>   (a single feature object, or {features:{...}})", 2);
    let payload;
    try { payload = JSON.parse(readFileSync(resolve(src), "utf8")); }
    catch (e) { fail(`Cannot read ${src}: ${e.message}`, 2); }

    const m = load({ required: false }) || emptyMap();
    const incoming = payload.features ? payload.features : { [payload.id]: payload };
    const tracked = trackedSet();
    const shas = worktreeShas(
      Object.values(incoming).flatMap(f => (f.files || []).map(x => norm(typeof x === "string" ? x : x.path)))
    );
    const problems = [];
    let n = 0;

    for (const [id, f] of Object.entries(incoming)) {
      if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) { problems.push(`bad id '${id}' (use kebab-case)`); continue; }
      if (!Array.isArray(f.files) || !f.files.length) { problems.push(`'${id}' has no files[] - a trace with no files is not a trace`); continue; }

      // Stamp the on-disk content hash so freshness is computable later.
      f.files = f.files.map(x => {
        const p = norm(typeof x === "string" ? x : x.path);
        const sha = shas.get(p);
        if (!sha) problems.push(`'${id}' cites '${p}' which does not exist - fix the trace, do not leave a dangling path`);
        else if (!tracked.has(p)) problems.push(`'${id}' cites untracked file '${p}' - is it generated, or missing from git?`);
        return { path: p, role: (typeof x === "object" && x.role) || "unknown", sha: sha || null };
      });
      f.id = id;
      f.tracedAt = f.tracedAt || new Date().toISOString();
      f.status ||= "traced";
      f.confidence ||= "medium";
      m.features[id] = f;
      n++;
    }

    reindex(m);
    save(m);
    out(`upserted ${n} feature(s); map now holds ${Object.keys(m.features).length}.`);
    if (problems.length) { problems.forEach(p => warn(p)); return 1; }
    return 0;
  },

  reindex() { const m = load(); reindex(m); save(m); out(`reindexed ${Object.keys(m.features).length} feature(s).`); return 0; },

  rm(args) {
    const id = args.find(a => !a.startsWith("--"));
    if (!id) fail("Usage: rm <feature-id>", 2);
    const m = load();
    if (!m.features[id]) fail(`Unknown feature '${id}'.`, 2);
    delete m.features[id];
    reindex(m); save(m);
    out(`removed '${id}'; ${Object.keys(m.features).length} remain.`);
    return 0;
  },
};

// ------------------------------------------------------------------ utils ---
const pad = (s, n) => String(s).slice(0, n - 1).padEnd(n);
// Only fields assess() actually sets. A reason for a field it never fills in
// (`uncommitted` was one) throws on the first stale feature, and `list` died on
// the exact row it existed to show.
const reasons = (r) => [
  r.changed.length && `${r.changed.length} changed`,
  r.missing.length && `${r.missing.length} missing`,
  r.agedOut && `${r.ageDays}d old`,
].filter(Boolean).join(", ");

function matchCI(bucket, needle) {
  const seen = new Set();
  for (const [k, ids] of Object.entries(bucket || {})) {
    if (k.toLowerCase().includes(String(needle).toLowerCase())) ids.forEach(i => seen.add(i));
  }
  return [...seen];
}

// ------------------------------------------------------------------- main ---
const [cmd, ...args] = process.argv.slice(2);
if (!cmd || cmd === "--help" || cmd === "-h" || !CMDS[cmd]) {
  out(readFileSync(new URL(import.meta.url)).toString()
    .split("\n").slice(2, 41).join("\n")
    .replace(/^\s*\*\/?\s?/gm, "").trim());
  process.exit(cmd && !CMDS[cmd] ? 2 : 0);
}
process.exit(CMDS[cmd](args) ?? 0);
