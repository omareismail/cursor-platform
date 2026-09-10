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
 *   node .cursor/tools/feature-map.mjs query --object <schema.name>
 *   node .cursor/tools/feature-map.mjs lineage <feature-id|object|table>
 *   node .cursor/tools/feature-map.mjs edges [--json]
 *   node .cursor/tools/feature-map.mjs impact --file <path>|--object <id> [--json]
 *   node .cursor/tools/feature-map.mjs upsert <file.json>     # written by the skills
 *   node .cursor/tools/feature-map.mjs reindex
 *   node .cursor/tools/feature-map.mjs rm <feature-id>
 *   node .cursor/tools/feature-map.mjs prune
 *
 * Exit codes:  0 = ok/fresh   1 = stale or missing   2 = usage/schema error
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { commitJson } from "./_state.mjs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.CLAUDE_PROJECT_DIR || findRepoRoot() || process.cwd();
const MAP_PATH = join(ROOT, ".cursor", "cache", "feature-map.json");
const SCHEMA_VERSION = 2;
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
    $schema: "cursor-platform/feature-map@2",
    version: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    repo: norm(ROOT.split(sep).pop() || ""),
    features: {},
    dataObjects: {},
    revision: 0,
    index: { byFile: {}, byTable: {}, byEndpoint: {}, byFlag: {}, byObject: {} },
  };
}

/** v1 traces stay valid. Objects and lineage are additive. */
function migrateMap(m) {
  const v = Number(m.version) || 1;
  if (v >= SCHEMA_VERSION) {
    m.dataObjects ||= {};
    m.index ||= {};
    m.index.byObject ||= {};
    return m;
  }
  m.$schema = "cursor-platform/feature-map@2";
  m.version = SCHEMA_VERSION;
  m.dataObjects ||= {};
  m.index ||= { byFile: {}, byTable: {}, byEndpoint: {}, byFlag: {}, byObject: {} };
  m.index.byObject ||= {};
  return m;
}

function load({ required = true } = {}) {
  if (!existsSync(MAP_PATH)) {
    if (!required) return null;
    fail(`No feature-map.json.\nRun: node .cursor/tools/feature-map.mjs init\nThen trace a feature with /feature-trace.`, 1);
  }
  let m;
  try { m = JSON.parse(readFileSync(MAP_PATH, "utf8")); }
  catch (e) { fail(`feature-map.json is not valid JSON: ${e.message}\nDelete it and re-run init; do not hand-repair.`, 2); }
  if ((m.version || 1) > SCHEMA_VERSION) {
    warn(`feature-map.json is schema v${m.version}, tool expects v${SCHEMA_VERSION}. Re-trace affected features.`);
  }
  migrateMap(m);
  m.features ||= {};
  m.dataObjects ||= {};
  m.index ||= { byFile: {}, byTable: {}, byEndpoint: {}, byFlag: {}, byObject: {} };
  if (!Number.isInteger(m.revision)) m.revision = 0;
  return m;
}

function save(m) {
  m.generatedAt = new Date().toISOString();
  try {
    commitJson(MAP_PATH, m);
  } catch (e) {
    if (e.code === "ECONFLICT") fail(`feature-map.json revision conflict (read ${e.expected}, on disk ${e.actual}). Re-run so the write sees the current map.`, 1);
    throw e;
  }
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
function assess(feature, shas, objects = {}) {
  const changed = [], missing = [];
  const catalogOnly = [];
  for (const f of feature.files || []) {
    const p = norm(f.path);
    const current = shas.get(p);
    if (current === null || current === undefined) { missing.push(p); continue; }
    if (f.sha && f.sha !== current) changed.push(p);
  }
  const objectIds = [
    ...(feature.dataTouched?.objects || []),
    ...(feature.lineage?.calls || []),
    ...(feature.lineage?.firedBy || []),
  ];
  for (const raw of objectIds) {
    const resolved = resolveObjectRef(objects, raw);
    if (resolved.ambiguous) continue;
    const oid = resolved.id;
    const o = oid ? objects[oid] : null;
    if (!o) continue;
    const defs = o.definitionFiles || [];
    if (!defs.length) { catalogOnly.push(oid || raw); continue; }
    for (const d of defs) {
      const p = norm(typeof d === "string" ? d : d.path);
      const current = shas.get(p);
      if (current === null || current === undefined) { missing.push(p); continue; }
      const sha = typeof d === "object" ? d.sha : null;
      if (sha && sha !== current) changed.push(p);
    }
  }
  const age = daysSince(feature.tracedAt);
  const stale = changed.length > 0 || missing.length > 0;
  return {
    stale, changed, missing, catalogOnly,
    agedOut: age > TRACE_STALE_DAYS,
    ageDays: Number.isFinite(age) ? Math.floor(age) : null,
    fileCount: (feature.files || []).length,
  };
}

/** Collect every path referenced by the given features and catalog objects. */
const objectDefPaths = (objects) =>
  Object.values(objects || {}).flatMap((o) =>
    (o.definitionFiles || []).map((x) => norm(typeof x === "string" ? x : x.path)));

const allPaths = (features, objects) => [
  ...features.flatMap(([, f]) => (f.files || []).map((x) => norm(x.path))),
  ...objectDefPaths(objects),
];

function reindex(m) {
  const idx = { byFile: {}, byTable: {}, byEndpoint: {}, byFlag: {}, byObject: {} };
  const push = (bucket, key, id) => {
    if (!key) return;
    const k = String(key);
    (idx[bucket][k] ||= []);
    if (!idx[bucket][k].includes(id)) idx[bucket][k].push(id);
  };
  for (const [id, f] of Object.entries(m.features || {})) {
    for (const file of f.files || []) push("byFile", norm(file.path), id);
    for (const t of f.dataTouched?.tables || []) push("byTable", t, id);
    for (const o of f.dataTouched?.objects || []) {
      const key = canonicalObjectId(m.dataObjects, o);
      if (key) push("byObject", key, id);
    }
    for (const e of f.entryPoints || []) if (e.ref) push("byEndpoint", e.ref, id);
    for (const fl of f.featureFlags || []) push("byFlag", typeof fl === "string" ? fl : fl.name, id);
    const lin = f.lineage || {};
    for (const t of [...(lin.reads || []), ...(lin.writes || [])]) push("byTable", t, id);
    for (const o of [...(lin.calls || []), ...(lin.firedBy || [])]) {
      const key = canonicalObjectId(m.dataObjects, o);
      if (key) push("byObject", key, id);
    }
  }
  for (const [oid, o] of Object.entries(m.dataObjects || {})) {
    push("byObject", oid, oid);
    if (o.name && o.name !== oid) push("byObject", o.name, oid);
    if (o.schema && o.name) push("byObject", `${o.schema}.${o.name}`, oid);
    for (const t of o.tables || []) {
      push("byTable", t, oid);
      for (const feat of o.features || []) push("byTable", t, feat);
    }
    if (o.on) {
      push("byTable", o.on, oid);
      for (const feat of o.features || []) push("byTable", o.on, feat);
    }
    for (const feat of o.features || []) push("byObject", oid, feat);
    for (const d of o.definitionFiles || []) {
      const p = norm(typeof d === "string" ? d : d.path);
      push("byFile", p, oid);
      for (const feat of o.features || []) push("byFile", p, feat);
      for (const feat of idx.byObject[oid] || []) push("byFile", p, feat);
    }
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
    const shas = worktreeShas(allPaths(entries, m.dataObjects));
    const rows = entries.map(([id, f]) => ({
      id, name: f.name || id, status: f.status || "unknown",
      confidence: f.confidence || "?", files: (f.files || []).length,
      ...assess(f, shas, m.dataObjects),
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
    const shas = worktreeShas(allPaths(entries, m.dataObjects));

    let bad = 0;
    for (const [id, f] of entries) {
      const a = assess(f, shas, m.dataObjects);
      if (!a.stale) {
        out(`  fresh  ${id}  (${a.fileCount} files, traced ${a.ageDays}d ago)`);
        if (a.agedOut) out(`         trace is ${a.ageDays}d old but every file is byte-identical - still accurate`);
        if (a.catalogOnly.length) out(`         catalog-only objects (no definition file): ${a.catalogOnly.join(", ")}`);
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
    const shas = worktreeShas(allPaths(entries, m.dataObjects));
    const stale = entries.map(([id, f]) => ({ id, ...assess(f, shas, m.dataObjects) })).filter(r => r.stale);
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
    const file = get("--file"), table = get("--table"), endpoint = get("--endpoint"), flag = get("--flag"), object = get("--object");
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
    else if (object)     hits = matchCI(m.index.byObject, object);
    else fail("Usage: query --file <path> | --table <name> | --endpoint <ref> | --flag <name> | --object <schema.name>", 2);

    if (json) { out(JSON.stringify(hits, null, 2)); return hits.length ? 0 : 1; }
    if (!hits.length) {
      out(`No traced feature or data object touches that. Either it is genuinely unused, or it has not been traced yet.`);
      out(`Check coverage with \`list\` before concluding the former.`);
      return 1;
    }
    for (const id of hits) {
      const f = m.features[id];
      const o = m.dataObjects?.[id];
      if (f) out(`${id}\t${f.name || ""}\t${f.status || ""}\t${(f.files || []).length} files`);
      else if (o) out(`${id}\t${o.kind || "object"}\t${(o.features || []).join(",") || "unlinked"}`);
      else out(`${id}`);
    }
    return 0;
  },

  lineage(args) {
    const m = load();
    const seed = args.find((a) => !a.startsWith("--"));
    if (!seed) fail("Usage: lineage <feature-id | object-id | table>", 2);
    const walked = walkLineage(m, seed);
    if (args.includes("--json")) {
      out(JSON.stringify(walked, null, 2));
      return walked.features.length || walked.objects.length ? 0 : 1;
    }
    if (!walked.features.length && !walked.objects.length) {
      out(`No lineage from '${seed}'. Trace the feature or upsert the catalog object first.`);
      return 1;
    }
    out(`Lineage from ${seed}`);
    if (walked.features.length) out(`  features: ${walked.features.join(", ")}`);
    if (walked.objects.length) {
      out(`  objects:`);
      for (const oid of walked.objects) {
        const o = m.dataObjects[oid] || {};
        out(`    ${oid}\t${o.kind || "?"}\ton=${o.on || (o.tables || []).join(",") || "-"}`);
      }
    }
    if (walked.tables.length) out(`  tables: ${walked.tables.join(", ")}`);
    return 0;
  },

  edges(args) {
    const m = load();
    const edges = collectEdges(m);
    if (args.includes("--json")) { out(JSON.stringify(edges, null, 2)); return edges.length ? 0 : 1; }
    out(`${edges.length} edge(s)`);
    for (const e of edges) out(`  ${e.kind}\t${e.from} -> ${e.to || e.raw}${e.stale ? " STALE" : ""}${e.dataSource ? `\t[${e.dataSource}]` : ""}`);
    return 0;
  },

  impact(args) {
    const file = valueOf(args, "--file");
    const object = valueOf(args, "--object");
    if (!file && !object) fail("Usage: impact --file <path> | --object <id>", 2);
    const m = load({ required: false }) || emptyMap();
    const body = impactOf(m, { file, object });
    if (args.includes("--json")) { out(JSON.stringify(body, null, 2)); return 0; }
    out(`coverage: ${body.coverage}`);
    out(`features: ${(body.features || []).join(", ") || "(none)"}`);
    out(`objects: ${(body.objects || []).join(", ") || "(none)"}`);
    out(`tests: ${(body.tests || []).join(", ") || "(none)"}`);
    if (body.uninspected) out(`uninspected: ${body.uninspected}`);
    return body.coverage === "insufficient" ? 1 : 0;
  },

  upsert(args) {
    const src = args.find(a => !a.startsWith("--"));
    if (!src) fail("Usage: upsert <file.json>   (a single feature object, or {features:{...}})", 2);
    let payload;
    try { payload = JSON.parse(readFileSync(resolve(src), "utf8")); }
    catch (e) { fail(`Cannot read ${src}: ${e.message}`, 2); }

    const m = load({ required: false }) || emptyMap();
    const incoming = payload.features
      ? payload.features
      : (payload.id ? { [payload.id]: payload } : {});
    const tracked = trackedSet();
    const shas = worktreeShas(
      Object.values(incoming).flatMap(f => (f.files || []).map(x => norm(typeof x === "string" ? x : x.path)))
        .concat(Object.values(payload.dataObjects || {}).flatMap((o) =>
          (o.definitionFiles || o.files || []).map((x) => norm(typeof x === "string" ? x : x.path))))
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

    let objects = 0;
    if (payload.dataObjects && typeof payload.dataObjects === "object") {
      m.dataObjects ||= {};
      for (const [rawId, o] of Object.entries(payload.dataObjects)) {
        const oid = rawId || (o.schema ? `${o.schema}.${o.name}` : o.name);
        if (!oid || !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(oid)) { problems.push(`bad data-object id '${oid}'`); continue; }
        const rec = {
          kind: o.kind || "unknown",
          schema: o.schema || null,
          name: o.name || oid,
          provider: o.provider || null,
          dataSource: o.dataSource || o.provider || "default",
          tables: [...new Set(o.tables || [])],
          on: o.on || null,
          features: [...new Set(o.features || [])],
          referencedBy: [...new Set((o.referencedBy || []).map(norm))],
          dependsOn: [...new Set(o.dependsOn || [])],
          catalogSnapshot: o.catalogSnapshot || o.snapshot || null,
          catalogedAt: o.catalogedAt || new Date().toISOString(),
        };
        const defs = o.definitionFiles || o.files || [];
        if (Array.isArray(defs) && defs.length) {
          rec.definitionFiles = defs.map((x) => {
            const p = norm(typeof x === "string" ? x : x.path);
            const sha = shas.get(p);
            if (!sha) problems.push(`object '${oid}' cites '${p}' which does not exist`);
            return { path: p, sha: sha || null };
          });
        }
        if (!rec.definitionFiles) {
          rec.definitionSource = o.definitionSource || o.source || "catalog";
          rec.catalogedAt = o.catalogedAt || new Date().toISOString();
        }
        m.dataObjects[oid] = rec;
        objects++;
      }
    }

    if (!n && !objects) fail("upsert: nothing to write. Pass a feature object (files[] required) and/or { dataObjects: { ... } }.", 2);

    const aliasProblems = ambiguousAliasProblems(m);
    if (aliasProblems.length) fail(aliasProblems.join("\n"), 2);

    reindex(m);
    save(m);
    out(`upserted ${n} feature(s)` + (objects ? `, ${objects} data object(s)` : "") + `; map now holds ${Object.keys(m.features).length} feature(s), ${Object.keys(m.dataObjects || {}).length} data object(s).`);
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

  prune() {
    const m = load({ required: false }) || emptyMap();
    const gone = [];
    for (const [oid, o] of Object.entries(m.dataObjects || {})) {
      const defs = o.definitionFiles || [];
      if (!defs.length) continue;
      const missing = defs.every((d) => !existsSync(join(ROOT, norm(typeof d === "string" ? d : d.path))));
      if (missing) { delete m.dataObjects[oid]; gone.push(oid); }
    }
    reindex(m);
    save(m);
    out(gone.length ? `pruned ${gone.join(", ")}` : "nothing to prune");
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

/**
 * Map a name, schema.name, or catalog id to a single data-object id.
 * A short name that matches more than one catalog object is refused rather
 * than bound to whichever key happens to come first.
 */
function resolveObjectRef(objects, seed) {
  if (seed == null || seed === "") return { missing: true };
  const s = String(seed);
  if (objects[s]) return { id: s };
  const lower = s.toLowerCase();
  const hits = [];
  for (const [oid, o] of Object.entries(objects || {})) {
    if (oid.toLowerCase() === lower) hits.push(oid);
    else if (o?.name && String(o.name).toLowerCase() === lower) hits.push(oid);
    else if (o?.schema && o.name && `${o.schema}.${o.name}`.toLowerCase() === lower) hits.push(oid);
  }
  const uniq = [...new Set(hits)];
  if (uniq.length === 1) return { id: uniq[0] };
  if (uniq.length > 1) return { ambiguous: uniq.sort() };
  return { missing: true };
}

function resolveObject(objects, seed) {
  return resolveObjectRef(objects, seed).id || null;
}

function canonicalObjectId(objects, raw) {
  const r = resolveObjectRef(objects, raw);
  if (r.ambiguous) return null;
  return r.id || String(raw);
}

function ambiguousAliasProblems(m) {
  const problems = [];
  for (const [id, f] of Object.entries(m.features || {})) {
    const refs = [
      ...(f.dataTouched?.objects || []),
      ...(f.lineage?.calls || []),
      ...(f.lineage?.firedBy || []),
    ];
    for (const raw of refs) {
      const r = resolveObjectRef(m.dataObjects, raw);
      if (r.ambiguous) {
        problems.push(`'${id}' refers to '${raw}' which matches ${r.ambiguous.join(", ")} — use a schema-qualified name`);
      }
    }
  }
  return problems;
}

/**
 * Walk from a feature, a catalog object, or a table name to everything
 * connected through dataTouched / lineage / dataObjects. This is what
 * /impact-analysis uses instead of grepping only files.
 */
function walkLineage(m, seed) {
  const features = m.features || {};
  const objects = m.dataObjects || {};
  const featHits = new Set();
  const objHits = new Set();
  const tables = new Set();
  const pendingFeat = [];
  const pendingObj = [];

  const addTable = (t) => { if (t) tables.add(String(t)); };

  const enqueueFeat = (id) => {
    if (!id || !features[id] || featHits.has(id)) return;
    featHits.add(id);
    pendingFeat.push(id);
  };
  const enqueueObj = (id) => {
    const oid = resolveObject(objects, id);
    if (!oid || objHits.has(oid)) return;
    objHits.add(oid);
    pendingObj.push(oid);
  };

  const drain = () => {
    while (pendingFeat.length || pendingObj.length) {
      while (pendingFeat.length) {
        const f = features[pendingFeat.pop()];
        for (const t of f.dataTouched?.tables || []) addTable(t);
        for (const o of f.dataTouched?.objects || []) enqueueObj(o);
        const lin = f.lineage || {};
        for (const t of [...(lin.reads || []), ...(lin.writes || [])]) addTable(t);
        for (const o of [...(lin.calls || []), ...(lin.firedBy || [])]) enqueueObj(o);
      }
      while (pendingObj.length) {
        const oid = pendingObj.pop();
        const o = objects[oid];
        if (!o) continue;
        for (const feat of o.features || []) enqueueFeat(feat);
        for (const id of m.index?.byObject?.[oid] || []) {
          if (features[id]) enqueueFeat(id);
        }
        for (const t of o.tables || []) addTable(t);
        if (o.on) addTable(o.on);
        for (const dep of o.dependsOn || []) enqueueObj(dep);
      }
    }
  };

  const enqueueIndexed = (id) => {
    if (features[id]) enqueueFeat(id);
    else enqueueObj(id);
  };

  if (features[seed]) enqueueFeat(seed);
  else {
    const oid = resolveObject(objects, seed);
    if (oid) enqueueObj(oid);
    else {
      for (const id of matchCI(m.index.byTable, seed)) enqueueIndexed(id);
      for (const id of matchCI(m.index.byObject, seed)) enqueueIndexed(id);
    }
  }

  drain();
  let added = true;
  while (added) {
    added = false;
    for (const [id, f] of Object.entries(features)) {
      if (featHits.has(id)) continue;
      const tabs = [
        ...(f.dataTouched?.tables || []),
        ...(f.lineage?.reads || []),
        ...(f.lineage?.writes || []),
      ].map(String);
      if (tabs.some((t) => tables.has(t))) { enqueueFeat(id); added = true; }
    }
    for (const [oid, o] of Object.entries(objects)) {
      if (objHits.has(oid)) continue;
      const tabs = [...(o.tables || []), ...(o.on ? [o.on] : [])].map(String);
      if (tabs.some((t) => tables.has(t))) { enqueueObj(oid); added = true; }
    }
    drain();
  }

  return {
    seed,
    features: [...featHits].sort(),
    objects: [...objHits].sort(),
    tables: [...tables].sort(),
  };
}

function valueOf(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

function collectEdges(m) {
  const edges = [];
  const shas = worktreeShas(allPaths(Object.entries(m.features || {}), m.dataObjects));
  for (const [id, f] of Object.entries(m.features || {})) {
    const refs = [...(f.lineage?.calls || []), ...(f.dataTouched?.objects || [])];
    for (const raw of refs) {
      const r = resolveObjectRef(m.dataObjects, raw);
      const to = r.id || null;
      const files = (f.files || []).map((x) => ({
        path: x.path, recorded: x.sha, current: shas.get(x.path) || null,
      }));
      const stale = files.some((e) => e.recorded && e.current && e.recorded !== e.current)
        || !!r.missing || !!r.ambiguous;
      edges.push({
        from: id, to, raw, kind: "feature-calls",
        dataSource: to ? (m.dataObjects[to]?.dataSource || m.dataObjects[to]?.provider || "default") : null,
        evidence: { tracedAt: f.tracedAt || null, files },
        stale, missing: !!r.missing, ambiguous: r.ambiguous || null,
      });
    }
  }
  for (const [oid, o] of Object.entries(m.dataObjects || {})) {
    const callers = new Set([...(o.features || []), ...(m.index?.byObject?.[oid] || [])]);
    for (const fid of callers) {
      if (!m.features[fid]) continue;
      edges.push({
        from: oid, to: fid, kind: "object-called-by",
        dataSource: o.dataSource || o.provider || "default",
        evidence: { catalogedAt: o.catalogedAt || null, definitionFiles: o.definitionFiles || [] },
        stale: false,
      });
    }
  }
  return edges;
}

function impactOf(m, { file, object }) {
  let seed = object;
  if (file) {
    const normed = String(file).replace(/\\/g, "/");
    const hits = m.index?.byFile?.[normed] || [];
    seed = hits[0] || object || normed;
  }
  const walked = seed ? walkLineage(m, seed) : { features: [], objects: [], tables: [] };
  const tests = [];
  for (const fid of walked.features) {
    for (const x of m.features[fid]?.files || []) {
      if (/test|spec/i.test(x.path)) tests.push(x.path);
    }
  }
  const traced = walked.features.length > 0 || walked.objects.length > 0;
  return {
    seed: seed || null,
    file: file || null,
    object: object || null,
    features: walked.features,
    objects: walked.objects,
    tables: walked.tables,
    tests: [...new Set(tests)],
    coverage: traced ? "traced" : "insufficient",
    uninspected: traced ? null : "No feature-map hit for this file or object. Empty impact is insufficient tracing, not proof of no blast radius.",
    edges: collectEdges(m).filter((e) =>
      walked.features.includes(e.from) || walked.features.includes(e.to)
      || walked.objects.includes(e.from) || walked.objects.includes(e.to)),
  };
}

export { collectEdges, impactOf, emptyMap };
export { load as loadFeatureMap };

// ------------------------------------------------------------------- main ---
const invoked = (() => {
  try {
    const self = fileURLToPath(import.meta.url);
    const arg = resolve(process.argv[1] || "");
    return self === arg || self.toLowerCase() === arg.toLowerCase();
  } catch { return false; }
})();
if (invoked) {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === "--help" || cmd === "-h" || !CMDS[cmd]) {
    out(readFileSync(new URL(import.meta.url)).toString()
      .split("\n").slice(2, 34).join("\n")
      .replace(/^\s*\*\/?\s?/gm, "").trim());
    process.exit(cmd && !CMDS[cmd] ? 2 : 0);
  }
  process.exit(CMDS[cmd](args) ?? 0);
}
