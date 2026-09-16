#!/usr/bin/env node
/**
 * graphify.mjs — read a Graphify knowledge graph; never build one.
 *
 * Graphify (https://github.com/Graphify-Labs/graphify) is a third-party Python
 * tool that parses a codebase into graphify-out/graph.json: symbols as nodes,
 * calls and imports as edges, clustered into communities. A human installs it
 * and runs it on their own machine. This platform never does, from an agent or
 * from CI, and never runs `graphify claude install` or `graphify cursor install`:
 * each adds an always-on directive of its own, and the Claude Code one a hook on
 * every Glob and Grep, outside the enforcement surface this repository reviews.
 *
 * What it gives the platform is the one layer its maps lack. repo-map.json stops
 * at projects and feature-map.json holds only what someone has traced, so the
 * skills that read existing code (feature-trace, impact-analysis,
 * context-builder, architecture-map-gen) ask this tool what sits around a file
 * before spending reads on grep. With no graph they say so and carry on.
 *
 * Freshness is derived, not trusted. The first `status` after graph.json is
 * written pins .cursor/cache/graphify-snapshot.json: the git content hash of
 * every file the graph names. From then on a file whose hash moved, or that is
 * gone, makes the graph STALE. Graphify's own cache is never read; its format is
 * not a contract.
 *
 * The one window a snapshot cannot see is between Graphify writing graph.json
 * and that first `status`. For that window only, a file modified after
 * graph.json was written is pinned as suspect and keeps the graph STALE until it
 * is rebuilt. There an mtime can take trust away; it never grants it.
 *
 * Graphify writes paths relative to the directory it scanned, so a graph built
 * from ./src names "payments/x.cs", not "src/payments/x.cs". The root and each
 * top-level directory are probed, and whichever resolves the most paths wins,
 * the root on a tie. Anything deeper is refused, with the fix.
 *
 * An accelerator, not a control: deleting the snapshot or rewriting graph.json
 * re-pins it, and nothing gates on this tool.
 *
 * Usage:
 *   node .cursor/tools/graphify.mjs status [--json]
 *   node .cursor/tools/graphify.mjs neighbours <file|symbol> [--depth N] [--limit N] [--json]
 *   node .cursor/tools/graphify.mjs communities [--limit N] [--json]
 *   node .cursor/tools/graphify.mjs hubs [--top N] [--json]
 *   node .cursor/tools/graphify.mjs path <from> <to> [--json]
 *
 * Exit codes:
 *   status   0 = fresh   1 = stale          2 = no graph, or one this tool cannot place
 *   queries  0 = found   1 = nothing found  2 = no graph, no such node, or usage
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { worktreeShas } from "./feature-map.mjs";
import { writeJsonAtomic } from "./_state.mjs";
import { report, emit, block, warn, info } from "./_findings.mjs";

const TOOL = "graphify.mjs";
// The same expression as feature-map.mjs, whose worktreeShas() resolves paths
// against its own root: two different roots would hash one tree and read another.
const ROOT = process.env.CLAUDE_PROJECT_DIR || findRepoRoot() || process.cwd();
const GRAPH_REL = "graphify-out/graph.json";
const GRAPH_PATH = join(ROOT, "graphify-out", "graph.json");
const SNAP_REL = ".cursor/cache/graphify-snapshot.json";
const SNAP_PATH = join(ROOT, ".cursor", "cache", "graphify-snapshot.json");
const SNAP_SCHEMA = "cursor-platform/graphify-snapshot@1";
const MAX_DEPTH = 3;               // past three hops a neighbourhood is most of the graph
const DEFAULT_DEPTH = 1;
const DEFAULT_LIMIT = 60;
const DEFAULT_COMMUNITIES = 20;
const DEFAULT_TOP = 10;
const PROBE_SAMPLE = 200;          // paths tried per candidate directory when placing a graph
const NOT_SCANNED = new Set(["node_modules", "graphify-out", "bin", "obj"]);
const CONFIDENCE_RANK = { EXTRACTED: 0, INFERRED: 1, AMBIGUOUS: 2 };
const WIN = process.platform === "win32";

const INSTALL_HINT = [
  `No ${GRAPH_REL} in this repository.`,
  "Graphify is a third-party tool. A human installs it (pipx install graphifyy, or uv tool install graphifyy)",
  "and runs it from the repository root, for instance `graphify extract . --code-only`, which parses code",
  "locally with no model calls. Its CLI moves fast, so check its README for the current flags.",
  "This platform only reads the graph. Once it exists, pin it with:",
  "  node .cursor/tools/graphify.mjs status",
  "Do not run `graphify claude install` or `graphify cursor install` here: each adds an always-on directive,",
  "and the Claude Code one a hook on every Glob and Grep, outside this repository's reviewed enforcement surface.",
].join("\n");

const USAGE = `Usage:
  node .cursor/tools/graphify.mjs status [--json]
  node .cursor/tools/graphify.mjs neighbours <file|symbol> [--depth N] [--limit N] [--json]
  node .cursor/tools/graphify.mjs communities [--limit N] [--json]
  node .cursor/tools/graphify.mjs hubs [--top N] [--json]
  node .cursor/tools/graphify.mjs path <from> <to> [--json]

Reads ${GRAPH_REL}, which a human builds with Graphify. Never builds or installs it.

Exit codes:
  status   0 = fresh   1 = stale          2 = no graph, or one this tool cannot place
  queries  0 = found   1 = nothing found  2 = no graph, no such node, or usage`;

// ---------------------------------------------------------------- helpers ---

function findRepoRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { stdio: "pipe" }).toString().trim();
  } catch { return null; }
}

const out = (s = "") => process.stdout.write(s + "\n");
const note = (s) => process.stderr.write(s + "\n");
const slash = (p) => String(p).split("\\").join("/");
const fold = (s) => (WIN ? s.toLowerCase() : s);
const ROOT_FWD = slash(resolve(ROOT)).replace(/\/+$/, "");

/** A refusal carries its exit code and, for status --json, the finding code it reports as. */
class Refusal extends Error {
  constructor(message, exit, kind) { super(message); this.exit = exit; this.kind = kind; }
}
function refuse(message, exit = 2, kind = "usage") { throw new Refusal(message, exit, kind); }

function idOf(v) {
  if (typeof v === "string") return v.length ? v : null;
  return typeof v === "number" && Number.isFinite(v) ? String(v) : null;
}

/**
 * A path as graph.json wrote it. Backslashes become slashes, so a graph built on
 * Windows reads the same on Linux. Absolute and inside this repository: made
 * repo-relative. Absolute elsewhere, a URL, or climbing out with "..": foreign,
 * meaning not a file in this tree. Foreign paths are reported and never hashed.
 */
function classifyPath(raw) {
  const p = slash(raw).trim();
  if (!p) return null;
  if (/^[a-z][a-z0-9+.-]+:\/\//i.test(p)) return { rel: p, absolute: true, foreign: true };
  if (p.startsWith("/") || /^[A-Za-z]:\//.test(p)) {
    return fold(p).startsWith(fold(ROOT_FWD) + "/")
      ? { rel: p.slice(ROOT_FWD.length + 1), absolute: true, foreign: false }
      : { rel: p, absolute: true, foreign: true };
  }
  const rel = p.replace(/^(\.\/)+/, "");
  return { rel, absolute: false, foreign: /(^|\/)\.\.(\/|$)/.test(rel) };
}

const where = (n) => (n.file ? `${n.file}${n.loc ? `:${n.loc}` : ""}` : "(no file)");
const brief = (n) => ({ id: n.id, label: n.label, file: n.file, location: n.loc || null, community: n.community, degree: n.degree });

function parseOpts(args, spec) {
  const o = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (spec[a] === "flag") { o[a] = true; continue; }
    if (spec[a] === "int") {
      const v = Number(args[++i]);
      if (!Number.isInteger(v) || v < 1) refuse(`${a} needs a whole number of 1 or more (got ${args[i] ?? "nothing"}).`);
      o[a] = v;
      continue;
    }
    if (a.startsWith("--")) refuse(`Unknown option ${a}.\n\n${USAGE}`);
    o._.push(a);
  }
  return o;
}

// ------------------------------------------------------------------ graph ---

/**
 * graph.json -> nodes, edges and an adjacency list, or a refusal naming the first
 * thing wrong. Tolerant of shape (edges or NetworkX links, one wrapper level,
 * numeric ids) and of nothing else: answering from half a file is worse than
 * saying it cannot be read.
 */
function loadGraph() {
  if (!existsSync(GRAPH_PATH)) refuse(INSTALL_HINT, 2, "absent");
  let raw;
  try { raw = JSON.parse(readFileSync(GRAPH_PATH, "utf8").replace(/^\uFEFF/, "")); }
  catch (e) { refuse(`${GRAPH_REL} is not valid JSON (${e.message}). A human rebuilds it with Graphify; this tool does not guess.`, 2, "malformed-graph"); }

  const body = [raw, raw?.graph, raw?.data].find((o) => o && typeof o === "object" && !Array.isArray(o) && Array.isArray(o.nodes));
  if (!body) refuse(`${GRAPH_REL} has no nodes[] array, at the top level or under "graph" or "data".`, 2, "malformed-graph");
  const rawEdges = Array.isArray(body.edges) ? body.edges : Array.isArray(body.links) ? body.links : null;
  if (!rawEdges) refuse(`${GRAPH_REL} has nodes[] but no edges[] (or NetworkX links[]) beside it.`, 2, "malformed-graph");

  const nodes = [];
  const byId = new Map();
  let duplicates = 0;
  body.nodes.forEach((n, i) => {
    const id = n && typeof n === "object" ? idOf(n.id) : null;
    if (id === null) refuse(`${GRAPH_REL}: nodes[${i}] has no id.`, 2, "malformed-graph");
    if (byId.has(id)) { duplicates++; return; }
    const file = [n.source_file, n.file, n.path, n.source].find((v) => typeof v === "string" && v.trim());
    const loc = [n.source_location, n.location, n.line].find((v) => typeof v === "string" || typeof v === "number");
    const node = {
      id,
      label: String(n.label ?? n.name ?? id),
      path: file ? classifyPath(file) : null,
      file: null,                    // repository-relative, once freshness() has placed the graph
      loc: loc === undefined ? "" : String(loc).replace(/L(?=\d)/g, ""),
      community: idOf(n.community),
      degree: 0,
    };
    nodes.push(node);
    byId.set(id, node);
  });

  const edges = [];
  let dangling = 0;
  rawEdges.forEach((e, i) => {
    const s = e && typeof e === "object" ? idOf(e.source) : null;
    const t = e && typeof e === "object" ? idOf(e.target) : null;
    if (s === null || t === null) refuse(`${GRAPH_REL}: edges[${i}] has no source or target.`, 2, "malformed-graph");
    const source = byId.get(s), target = byId.get(t);
    if (!source || !target) { dangling++; return; }
    edges.push({ source, target, relation: String(e.relation ?? e.type ?? e.label ?? "related"), confidence: typeof e.confidence === "string" ? e.confidence : "" });
  });

  // Walked undirected, because a caller is as much a neighbour as a callee, but
  // every step remembers which way its edge really points. Strongest evidence
  // first, so a path or a "reached via" prefers EXTRACTED to INFERRED.
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (e.source === e.target) continue;
    e.source.degree++;
    e.target.degree++;
    adj.get(e.source.id).push({ node: e.target, edge: e, forward: true });
    adj.get(e.target.id).push({ node: e.source, edge: e, forward: false });
  }
  const rank = (step) => CONFIDENCE_RANK[step.edge.confidence] ?? 3;
  for (const steps of adj.values()) steps.sort((a, b) => rank(a) - rank(b));

  const rels = [...new Set(nodes.filter((n) => n.path && !n.path.absolute && !n.path.foreign).map((n) => n.path.rel))];
  return { nodes, edges, byId, adj, rels, dangling, duplicates };
}

/**
 * Which directory are graph.json's relative paths relative to? The root, or the
 * one top-level directory under which a sample of them resolves most often. null
 * when none resolves at all.
 */
function placeGraph(rels) {
  if (!rels.length) return "";
  const sample = rels.slice(0, PROBE_SAMPLE);
  const resolved = (base) => sample.reduce((n, p) => n + (existsSync(join(ROOT, base, p)) ? 1 : 0), 0);
  let best = "";
  let most = resolved("");
  if (most < sample.length) {
    let dirs = [];
    try {
      dirs = readdirSync(ROOT, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith(".") && !NOT_SCANNED.has(d.name))
        .map((d) => d.name).sort();
    } catch { /* an unreadable root places nothing */ }
    for (const d of dirs) {
      const n = resolved(d);
      if (n > most) { best = d; most = n; }
    }
  }
  return most ? best : null;
}

function readSnapshot() {
  try {
    const s = JSON.parse(readFileSync(SNAP_PATH, "utf8"));
    return s && s.$schema === SNAP_SCHEMA && s.files && typeof s.files === "object" && !Array.isArray(s.files) ? s : null;
  } catch { return null; }          // absent or unreadable: the next status re-pins it
}

/**
 * Place the graph in the tree, hash what it names, and compare with the pinned
 * snapshot. `write` (status only) pins a new snapshot when graph.json has been
 * rewritten; queries never write, and report "unpinned" instead.
 */
function freshness(g, { write }) {
  const graphMtimeMs = statSync(GRAPH_PATH).mtimeMs;
  const graphSha = worktreeShas([GRAPH_REL]).get(GRAPH_REL);
  if (!graphSha) refuse(`Could not hash ${GRAPH_REL} with git. Freshness is derived from content hashes, so without git on PATH this tool cannot say whether the graph is current.`, 2, "no-git");
  const snap = readSnapshot();
  const pinned = snap && snap.graphSha === graphSha && snap.graphMtimeMs === graphMtimeMs ? snap : null;

  let anchor = pinned ? String(pinned.anchor ?? "") : placeGraph(g.rels);
  if (anchor === null) {
    if (!g.nodes.some((n) => n.path && n.path.absolute && !n.path.foreign)) {
      refuse(`None of the ${g.rels.length} relative path(s) in ${GRAPH_REL} exist here, from the repository root or from any top-level directory (the first is ${g.rels[0]}).\n` +
        "Graphify writes paths relative to the directory it scanned, and this tool places a scan of the root or of one top-level directory. A human rebuilds the graph from the repository root.", 2, "unanchored-graph");
    }
    anchor = "";
  }
  for (const n of g.nodes) {
    if (n.path && !n.path.foreign) n.file = n.path.absolute || !anchor ? n.path.rel : `${anchor}/${n.path.rel}`;
  }
  const files = [...new Set(g.nodes.map((n) => n.file).filter(Boolean))].sort();
  const foreign = [...new Set(g.nodes.filter((n) => n.path && n.path.foreign).map((n) => n.path.rel))].sort();
  if (!files.length) {
    refuse(foreign.length
      ? `Every path in ${GRAPH_REL} lies outside this repository (${foreign.length}, the first ${foreign[0]}): it was built on another machine or from another root. A human rebuilds it here.`
      : `${GRAPH_REL} names no source files, so its nodes cannot be placed in the code and its freshness cannot be derived.`,
    2, foreign.length ? "foreign-graph" : "unanchored-graph");
  }

  const placed = { anchor, files, foreign, changed: [], missing: [], suspect: [], retaken: false, takenAt: null };
  if (!pinned && !write) return { ...placed, state: "unpinned" };

  const shas = worktreeShas(files);
  let snapshot = pinned;
  if (!snapshot) {
    // A content snapshot cannot see edits made between Graphify writing
    // graph.json and this first status, so anything modified after graph.json
    // is pinned as suspect. The mtime only ever takes trust away.
    const suspect = files.filter((f) => {
      try { return statSync(join(ROOT, f)).mtimeMs > graphMtimeMs; } catch { return false; }
    });
    snapshot = {
      $schema: SNAP_SCHEMA, graph: GRAPH_REL, graphSha, graphMtimeMs, anchor, takenAt: new Date().toISOString(),
      files: Object.fromEntries(files.map((f) => [f, shas.get(f) ?? null])), suspect,
    };
    writeJsonAtomic(SNAP_PATH, snapshot);
  }
  const missing = files.filter((f) => (shas.get(f) ?? null) === null);
  const changed = files.filter((f) => {
    const now = shas.get(f) ?? null;
    return now !== null && snapshot.files[f] !== now;
  });
  const known = new Set(files);
  const moved = new Set([...missing, ...changed]);
  const suspect = (Array.isArray(snapshot.suspect) ? snapshot.suspect : []).filter((f) => known.has(f) && !moved.has(f));
  const state = moved.size || suspect.length ? "stale" : "fresh";
  return { ...placed, state, changed, missing, suspect, retaken: !pinned, takenAt: snapshot.takenAt };
}

function staleNote(f) {
  if (f.state === "unpinned") note(`warning: ${GRAPH_REL} has not been pinned, so nothing has checked it against the code. Run: node .cursor/tools/graphify.mjs status`);
  else if (f.state === "stale") note(`warning: ${GRAPH_REL} is STALE (${f.changed.length + f.suspect.length} changed, ${f.missing.length} missing since it was built). Treat this answer as a hypothesis; status names the files.`);
}

/**
 * Most specific rule first, and the first rule that matches anything wins, so a
 * symbol name never widens into every path that happens to contain it.
 */
function resolveSeeds(g, needle) {
  const raw = String(needle).trim();
  const c = classifyPath(raw);
  const q = fold((c && c.absolute && !c.foreign ? c.rel : slash(raw)).replace(/^(\.\/)+/, "").replace(/\/+$/, ""));
  const lower = raw.toLowerCase();
  const inFiles = (test) => g.nodes.filter((n) => n.file && test(fold(n.file)));
  const rules = [
    ["id", () => (g.byId.has(raw) ? [g.byId.get(raw)] : [])],
    ["label", () => g.nodes.filter((n) => n.label.toLowerCase() === lower)],
    ["file", () => inFiles((f) => f === q)],
    ["directory", () => (q ? inFiles((f) => f.startsWith(`${q}/`)) : [])],
    ["file suffix", () => (q ? inFiles((f) => f.endsWith(`/${q}`)) : [])],
    ["partial path", () => (q.length >= 3 ? inFiles((f) => f.includes(q)) : [])],
  ];
  for (const [rule, find] of rules) {
    const nodes = find();
    if (nodes.length) return { rule, nodes };
  }
  return { rule: null, nodes: [] };
}

function walk(g, seeds, depth) {
  const seen = new Map(seeds.map((n) => [n.id, { node: n, dist: 0, step: null }]));
  let frontier = seeds;
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next = [];
    for (const u of frontier) {
      for (const s of g.adj.get(u.id)) {
        if (seen.has(s.node.id)) continue;
        seen.set(s.node.id, { node: s.node, dist: d, step: { from: u, edge: s.edge, forward: s.forward } });
        next.push(s.node);
      }
    }
    frontier = next;
  }
  return seen;
}

function tally(files) {
  const m = new Map();
  for (const f of files) m.set(f, (m.get(f) || 0) + 1);
  return [...m].map(([file, nodes]) => ({ file, nodes })).sort((a, b) => b.nodes - a.nodes || a.file.localeCompare(b.file));
}

// --------------------------------------------------------------- commands ---

function cmdStatus(args) {
  const opts = parseOpts(args, { "--json": "flag" });
  if (opts._.length) refuse(`status takes no arguments.\n\n${USAGE}`);
  const g = loadGraph();
  const f = freshness(g, { write: true });
  const communities = new Set(g.nodes.map((n) => n.community).filter((c) => c !== null)).size;
  const shape = `${g.nodes.length} nodes, ${g.edges.length} edges, ${communities} communities over ${f.files.length} files`;
  const placedAt = f.anchor ? `; its paths are relative to ${f.anchor}/` : "";

  const findings = [info("graph", `${shape}${placedAt}`, { file: GRAPH_REL })];
  if (f.retaken) findings.push(info("snapshot-pinned", "graph.json was rewritten since the last status, so a new snapshot was pinned", { file: SNAP_REL }));
  for (const file of f.changed) findings.push(block("changed-file", "changed since this graph's snapshot was pinned", { file }));
  for (const file of f.suspect) findings.push(block("modified-after-build", `modified after ${GRAPH_REL} was written, before its snapshot was pinned`, { file }));
  for (const file of f.missing) findings.push(block("missing-file", `named by ${GRAPH_REL} but gone from the working tree`, { file }));
  if (f.foreign.length) findings.push(warn("foreign-path", `${f.foreign.length} path(s) lie outside this repository and cannot be checked, the first ${f.foreign[0]}`, { file: GRAPH_REL }));
  if (g.dangling) findings.push(warn("dangling-edge", `${g.dangling} edge(s) name a node missing from nodes[] and were ignored`, { file: GRAPH_REL }));
  if (g.duplicates) findings.push(warn("duplicate-node", `${g.duplicates} node id(s) repeat; the first of each was kept`, { file: GRAPH_REL }));
  const stale = f.state === "stale";

  if (opts["--json"]) {
    return emit(report({
      tool: TOOL, command: "status", findings, exit: stale ? 1 : 0,
      summary: stale ? `STALE: ${f.changed.length} changed, ${f.suspect.length} modified before pinning, ${f.missing.length} missing` : `fresh: ${shape}`,
      data: {
        graph: GRAPH_REL, snapshot: SNAP_REL, state: f.state, nodes: g.nodes.length, edges: g.edges.length, communities,
        files: f.files.length, anchor: f.anchor || null, retaken: f.retaken, takenAt: f.takenAt,
        changed: f.changed, modifiedAfterBuild: f.suspect, missing: f.missing,
        foreign: f.foreign.length, danglingEdges: g.dangling, duplicateNodes: g.duplicates,
      },
    }));
  }

  out(`${GRAPH_REL}: ${shape}${placedAt}.`);
  if (f.retaken) out(`Pinned a new snapshot in ${SNAP_REL}: graph.json was rewritten since the last status.`);
  for (const x of findings) if (x.severity === "warn") note(`warning: ${x.message}`);
  if (!stale) {
    out("FRESH - every file the graph names still matches its snapshot.");
    return 0;
  }
  const rows = [...f.changed.map((p) => ["changed", p]), ...f.suspect.map((p) => ["modified-after-build", p]), ...f.missing.map((p) => ["missing", p])];
  out(`STALE - ${rows.length} file(s) moved underneath this graph:`);
  for (const [why, p] of rows.slice(0, 25)) out(`  ${why.padEnd(22)}${p}`);
  if (rows.length > 25) out(`  ... and ${rows.length - 25} more (--json lists every one)`);
  out("Treat anything read from it as a hypothesis. A human rebuilds the graph with Graphify, then runs status again.");
  return 1;
}

function cmdNeighbours(args) {
  const opts = parseOpts(args, { "--depth": "int", "--limit": "int", "--json": "flag" });
  if (opts._.length !== 1) refuse(`neighbours takes one file or symbol.\n\n${USAGE}`);
  const [needle] = opts._;
  const asked = opts["--depth"] ?? DEFAULT_DEPTH;
  const depth = Math.min(asked, MAX_DEPTH);
  const limit = opts["--limit"] ?? DEFAULT_LIMIT;
  const g = loadGraph();
  const f = freshness(g, { write: false });
  staleNote(f);
  if (asked > MAX_DEPTH) note(`note: depth capped at ${MAX_DEPTH}; past that a neighbourhood is most of the graph.`);
  const seeds = resolveSeeds(g, needle);
  if (!seeds.nodes.length) refuse(`No node in ${GRAPH_REL} matches "${needle}" by id, label or file path.`, 2, "no-match");

  const rows = [...walk(g, seeds.nodes, depth).values()]
    .filter((r) => r.dist > 0)
    .sort((a, b) => a.dist - b.dist || b.node.degree - a.node.degree || a.node.label.localeCompare(b.node.label));
  const seedFiles = new Set(seeds.nodes.map((n) => n.file).filter(Boolean));
  const byFile = new Map();
  for (const r of rows) {
    if (!r.node.file || seedFiles.has(r.node.file)) continue;
    const entry = byFile.get(r.node.file) || { file: r.node.file, distance: r.dist, nodes: 0 };
    entry.nodes++;
    byFile.set(r.node.file, entry);
  }
  const files = [...byFile.values()].sort((a, b) => a.distance - b.distance || b.nodes - a.nodes || a.file.localeCompare(b.file));

  if (opts["--json"]) {
    out(JSON.stringify({
      graph: GRAPH_REL, freshness: f.state, query: needle, matchedBy: seeds.rule, depth, limit,
      seeds: seeds.nodes.map(brief),
      nodes: rows.slice(0, limit).map((r) => ({
        ...brief(r.node), distance: r.dist,
        via: { source: r.step.edge.source.id, relation: r.step.edge.relation, target: r.step.edge.target.id, confidence: r.step.edge.confidence || null },
      })),
      nodesOmitted: Math.max(0, rows.length - limit),
      files: files.slice(0, limit),
      filesOmitted: Math.max(0, files.length - limit),
    }, null, 2));
    return rows.length ? 0 : 1;
  }

  const seedText = seeds.nodes.length === 1 ? `${seeds.nodes[0].label} (${where(seeds.nodes[0])})` : `${seeds.nodes.length} nodes in ${seedFiles.size} file(s)`;
  out(`Neighbourhood of "${needle}", matched by ${seeds.rule}: ${seedText}. Depth ${depth}, graph ${f.state}.`);
  if (!rows.length) {
    out(`Nothing within ${depth} hop(s).`);
    return 1;
  }
  out("");
  const shown = rows.slice(0, limit);
  const width = Math.min(40, shown.reduce((m, r) => Math.max(m, r.node.label.length), 4));
  for (const r of shown) {
    const e = r.step.edge;
    out(`  ${String(r.dist).padEnd(3)}${r.node.label.padEnd(width)}  ${e.source.label} -${e.relation}-> ${e.target.label}   ${where(r.node)}${e.confidence ? `  [${e.confidence}]` : ""}`);
  }
  if (rows.length > limit) out(`  (+${rows.length - limit} more, capped at --limit ${limit})`);
  out("");
  out("Files in neighbourhood, nearest first:");
  if (!files.length) out("  none beyond the seed file(s)");
  for (const x of files.slice(0, limit)) out(`  ${x.file}   distance ${x.distance}, ${x.nodes} node(s)`);
  if (files.length > limit) out(`  (+${files.length - limit} more, capped at --limit ${limit})`);
  return 0;
}

function cmdCommunities(args) {
  const opts = parseOpts(args, { "--limit": "int", "--json": "flag" });
  if (opts._.length) refuse(`communities takes no arguments.\n\n${USAGE}`);
  const limit = opts["--limit"] ?? DEFAULT_COMMUNITIES;
  const g = loadGraph();
  const f = freshness(g, { write: false });
  staleNote(f);
  const groups = new Map();
  for (const n of g.nodes) {
    if (n.community === null) continue;
    if (!groups.has(n.community)) groups.set(n.community, []);
    groups.get(n.community).push(n);
  }
  if (!groups.size) refuse(`${GRAPH_REL} carries no community labels: Graphify's clustering did not run, or did not record them.`, 1, "no-communities");

  const list = [...groups].map(([id, members]) => {
    const hubs = [...members].sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label));
    const files = tally(members.map((m) => m.file).filter(Boolean));
    return {
      id, size: members.length, files: files.length, hub: hubs[0].label,
      hubs: hubs.slice(0, 5).map((m) => ({ id: m.id, label: m.label, degree: m.degree, file: m.file })),
      topFiles: files.slice(0, 5),
    };
  }).sort((a, b) => b.size - a.size || a.id.localeCompare(b.id, undefined, { numeric: true }));
  const unassigned = g.nodes.length - list.reduce((n, c) => n + c.size, 0);

  if (opts["--json"]) {
    out(JSON.stringify({ graph: GRAPH_REL, freshness: f.state, total: list.length, unassigned, communities: list.slice(0, limit), omitted: Math.max(0, list.length - limit) }, null, 2));
    return 0;
  }
  out(`${list.length} communities over ${g.nodes.length} nodes${unassigned ? ` (${unassigned} carry none)` : ""}. Graph ${f.state}.`);
  for (const c of list.slice(0, limit)) {
    out("");
    out(`community ${c.id}   ${c.size} node(s), ${c.files} file(s), hub ${c.hub}`);
    out(`  hubs:  ${c.hubs.map((h) => `${h.label} (${h.degree})`).join(", ")}`);
    if (c.topFiles.length) out(`  files: ${c.topFiles.map((x) => `${x.file} (${x.nodes})`).join(", ")}`);
  }
  if (list.length > limit) out(`\n(+${list.length - limit} smaller communities, capped at --limit ${limit})`);
  return 0;
}

function cmdHubs(args) {
  const opts = parseOpts(args, { "--top": "int", "--json": "flag" });
  if (opts._.length) refuse(`hubs takes no arguments.\n\n${USAGE}`);
  const top = opts["--top"] ?? DEFAULT_TOP;
  const g = loadGraph();
  const f = freshness(g, { write: false });
  staleNote(f);
  const ranked = g.nodes.filter((n) => n.degree > 0).sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label));
  if (!ranked.length) refuse(`${GRAPH_REL} has no edges, so nothing in it is a hub.`, 1, "no-edges");
  if (opts["--json"]) {
    out(JSON.stringify({ graph: GRAPH_REL, freshness: f.state, hubs: ranked.slice(0, top).map(brief) }, null, 2));
    return 0;
  }
  out(`Most connected nodes in ${GRAPH_REL} (graph ${f.state}):`);
  for (const n of ranked.slice(0, top)) {
    out(`  ${String(n.degree).padStart(5)}  ${n.label}   ${where(n)}${n.community !== null ? `   community ${n.community}` : ""}`);
  }
  return 0;
}

function cmdPath(args) {
  const opts = parseOpts(args, { "--json": "flag" });
  if (opts._.length !== 2) refuse(`path takes two nodes: path <from> <to>.\n\n${USAGE}`);
  const [fromQ, toQ] = opts._;
  const g = loadGraph();
  const f = freshness(g, { write: false });
  staleNote(f);
  const a = resolveSeeds(g, fromQ);
  const b = resolveSeeds(g, toQ);
  if (!a.nodes.length) refuse(`No node in ${GRAPH_REL} matches "${fromQ}" by id, label or file path.`, 2, "no-match");
  if (!b.nodes.length) refuse(`No node in ${GRAPH_REL} matches "${toQ}" by id, label or file path.`, 2, "no-match");

  const targets = new Set(b.nodes.map((n) => n.id));
  const prev = new Map(a.nodes.map((n) => [n.id, null]));
  let hit = a.nodes.find((n) => targets.has(n.id)) || null;
  for (let frontier = a.nodes; !hit && frontier.length;) {
    const next = [];
    for (const u of frontier) {
      for (const s of g.adj.get(u.id)) {
        if (prev.has(s.node.id)) continue;
        prev.set(s.node.id, { from: u, edge: s.edge, forward: s.forward });
        if (targets.has(s.node.id)) { hit = s.node; break; }
        next.push(s.node);
      }
      if (hit) break;
    }
    frontier = next;
  }
  const hops = [];
  for (let cur = hit; cur && prev.get(cur.id); cur = prev.get(cur.id).from) hops.unshift({ ...prev.get(cur.id), to: cur });
  const origin = hops.length ? hops[0].from : hit;

  if (opts["--json"]) {
    out(JSON.stringify({
      graph: GRAPH_REL, freshness: f.state, from: fromQ, to: toQ,
      path: hit ? {
        start: brief(origin),
        hops: hops.map((h) => ({ source: h.edge.source.id, relation: h.edge.relation, target: h.edge.target.id, confidence: h.edge.confidence || null, node: brief(h.to) })),
      } : null,
    }, null, 2));
    return hit ? 0 : 1;
  }
  if (!hit) {
    out(`No path between "${fromQ}" and "${toQ}" in ${GRAPH_REL} (graph ${f.state}).`);
    return 1;
  }
  out(`${origin.label}   ${where(origin)}`);
  for (const h of hops) {
    const arrow = h.forward ? `-${h.edge.relation}->` : `<-${h.edge.relation}-`;
    out(`  ${arrow.padEnd(18)}${h.to.label}   ${where(h.to)}${h.edge.confidence ? `  [${h.edge.confidence}]` : ""}`);
  }
  out(hops.length ? `${hops.length} hop(s), graph ${f.state}.` : `"${fromQ}" and "${toQ}" resolve to the same node.`);
  return 0;
}

const CMDS = { status: cmdStatus, neighbours: cmdNeighbours, communities: cmdCommunities, hubs: cmdHubs, path: cmdPath };

function main(argv) {
  const [cmd, ...args] = argv;
  if (!cmd || cmd === "--help" || cmd === "-h") { out(USAGE); return 0; }
  if (!CMDS[cmd]) { note(`Unknown command "${cmd}".\n\n${USAGE}`); return 2; }
  try {
    return CMDS[cmd](args) ?? 0;
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    note(e.message);
    // status --json always answers in the finding envelope, so a caller parsing
    // it never has to tell "no graph" from "the tool crashed" by reading stderr.
    if (cmd === "status" && args.includes("--json") && e.kind !== "usage") {
      const first = e.message.split("\n")[0];
      return emit(e.kind === "absent"
        ? report({ tool: TOOL, command: "status", skipped: true, data: null, summary: `no ${GRAPH_REL}: a human builds it with Graphify, and this platform only reads it` })
        : report({ tool: TOOL, command: "status", exit: e.exit, data: null, summary: first, findings: [block(e.kind, first, { file: GRAPH_REL })] }));
    }
    return e.exit;
  }
}

// ------------------------------------------------------------------- main ---
const invoked = (() => {
  try {
    const self = fileURLToPath(import.meta.url);
    const arg = resolve(process.argv[1] || "");
    return self === arg || self.toLowerCase() === arg.toLowerCase();
  } catch { return false; }
})();
if (invoked) process.exitCode = main(process.argv.slice(2));
