#!/usr/bin/env node
/**
 * graphify.test.mjs — the Graphify adapter reads a graph it did not build,
 * refuses what it cannot place, and derives freshness from content.
 *
 * Every fixture holds a hand-written graphify-out/graph.json in the shapes
 * Graphify documents. No case runs Graphify or needs it installed: the platform
 * never does either, and a suite that did would be testing Graphify.
 *
 * File times are set explicitly. "Written before the graph" must not depend on
 * how fast the disk is, or the late-pin case passes on one machine and fails on
 * the next.
 */

import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, utimesSync } from "node:fs";
import { fixture, runTool, put, gitInit, check, report, section, REPO } from "../_harness.mjs";

const fm = await import(new URL(`file:///${join(REPO, ".cursor", "tools", "_findings.mjs").replace(/\\/g, "/")}`));

const T = "graphify.mjs";
const SNAP = (root) => join(root, ".cursor", "cache", "graphify-snapshot.json");
const GRAPH = (root) => join(root, "graphify-out", "graph.json");
const parse = (r) => { try { return JSON.parse(r.out); } catch { return null; } };
const node = (id, file, community = 0) => ({ id, label: id, source_file: file, source_location: "L1", community });
const edge = (source, target, relation = "calls", confidence = "EXTRACTED") => ({ source, target, relation, confidence });
const age = (abs, seconds) => { const t = new Date(Date.now() - seconds * 1000); utimesSync(abs, t, t); };

/**
 * src/a..d.py, then graph.json written after them. By default a -> b -> c -> d in
 * two communities, with c named by an absolute path the way a Windows build writes it.
 */
function seeded(name, graph) {
  const root = fixture(name);
  for (const f of ["a", "b", "c", "d"]) age(put(root, `src/${f}.py`, `def ${f}(): pass\n`), 120);
  const g = graph || {
    nodes: [node("a", "src/a.py", 0), node("b", "src/b.py", 0), node("c", join(root, "src", "c.py"), 1), node("d", "src/d.py", 1)],
    edges: [edge("a", "b"), edge("b", "c"), edge("c", "d", "imports", "INFERRED")],
  };
  age(put(root, "graphify-out/graph.json", JSON.stringify(g)), 60);
  gitInit(root);
  return root;
}

section("graphify - no graph: refuses, says how a human builds one, writes nothing");
{
  const root = fixture("gf-absent");
  const r = runTool(T, ["status"], root);
  check("status exits 2", r.exit === 2, `${r.exit} ${r.err}`);
  check("it names the package a human installs", /pipx install graphifyy/.test(r.err), r.err);
  check("it warns off the installers that add a second front door", /graphify claude install/.test(r.err), r.err);
  check("no snapshot is written", !existsSync(SNAP(root)), "");
  const j = runTool(T, ["status", "--json"], root);
  const rep = parse(j);
  check("--json is a valid skipped report with exit 2", rep && fm.validate(rep).length === 0 && rep.skipped === true && rep.exit === 2 && j.exit === 2, rep ? fm.validate(rep).join("; ") : j.out + j.err);
  const n = runTool(T, ["neighbours", "src/a.py"], root);
  check("a query exits 2 as well", n.exit === 2, `${n.exit} ${n.err}`);
}

section("graphify - freshness comes from content: pinned, staled by an edit, re-pinned by a rebuild");
{
  const root = seeded("gf-fresh");
  let r = runTool(T, ["status"], root);
  check("the first status pins a snapshot and reports FRESH", r.exit === 0 && existsSync(SNAP(root)) && /FRESH/.test(r.out), `${r.exit} ${r.out} ${r.err}`);
  const keys = Object.keys(JSON.parse(readFileSync(SNAP(root), "utf8")).files);
  check("the absolute path is recorded repo-relative, with forward slashes", keys.includes("src/c.py") && keys.every((k) => !k.includes("\\")), JSON.stringify(keys));
  r = runTool(T, ["status"], root);
  check("a second status with nothing changed stays FRESH and does not re-pin", r.exit === 0 && /FRESH/.test(r.out) && !/Pinned/.test(r.out), r.out);

  writeFileSync(join(root, "src", "b.py"), "def b(): return c()\n");
  r = runTool(T, ["status"], root);
  check("an edited file makes it STALE, exit 1, naming the file", r.exit === 1 && /STALE/.test(r.out) && /src\/b\.py/.test(r.out), `${r.exit} ${r.out}`);
  const rep = parse(runTool(T, ["status", "--json"], root));
  check("--json: valid, exit 1, one changed-file block for src/b.py", rep && fm.validate(rep).length === 0 && rep.exit === 1 && rep.findings.filter((f) => f.code === "changed-file").map((f) => f.file).join() === "src/b.py", rep ? JSON.stringify(rep.findings) : "");
  const q = runTool(T, ["neighbours", "src/a.py"], root);
  check("a query on a stale graph still answers, and warns on stderr", q.exit === 0 && /STALE/.test(q.err), `${q.exit} ${q.err}`);

  const g = JSON.parse(readFileSync(GRAPH(root), "utf8"));
  g.nodes.push(node("b2", "src/b.py", 0));
  g.edges.push(edge("b2", "c"));
  writeFileSync(GRAPH(root), JSON.stringify(g));
  r = runTool(T, ["status"], root);
  check("a rebuilt graph.json is re-pinned and FRESH again", r.exit === 0 && /Pinned/.test(r.out) && /FRESH/.test(r.out), `${r.exit} ${r.out}`);

  writeFileSync(GRAPH(root), JSON.stringify(g));
  r = runTool(T, ["status"], root);
  check("identical bytes rewritten re-pin too: a rebuild that found nothing new still ran", r.exit === 0 && /Pinned/.test(r.out), `${r.exit} ${r.out}`);
}

section("graphify - an edit made before the first status is not laundered by pinning late");
{
  const root = seeded("gf-late-pin");
  writeFileSync(join(root, "src", "d.py"), "def d(): return 1\n");
  const r = runTool(T, ["status", "--json"], root);
  const rep = parse(r);
  check("the late pin still reports STALE with exit 1", rep && fm.validate(rep).length === 0 && rep.exit === 1 && r.exit === 1, r.out + r.err);
  check("src/d.py is a modified-after-build block", rep && rep.findings.some((f) => f.code === "modified-after-build" && f.file === "src/d.py" && f.severity === "block"), rep ? JSON.stringify(rep.findings) : "");
  check("files written before graph.json are not suspects", rep && rep.findings.filter((f) => f.code === "modified-after-build").length === 1, rep ? JSON.stringify(rep.findings) : "");
}

section("graphify - neighbours, communities, hubs and path answer from the graph");
{
  const root = seeded("gf-query");
  runTool(T, ["status"], root);
  let r = runTool(T, ["neighbours", "src/a.py", "--depth", "1", "--json"], root);
  let j = parse(r);
  check("depth 1 from src/a.py reaches b and not c", j && r.exit === 0 && j.nodes.map((n) => n.id).join() === "b", r.out + r.err);
  check("the seed was matched by file, and src/b.py is the file to read", j && j.matchedBy === "file" && j.files.map((f) => f.file).join() === "src/b.py", r.out);
  r = runTool(T, ["neighbours", "a", "--depth", "2", "--json"], root);
  j = parse(r);
  check("depth 2 from the symbol a reaches b then c, nearest first", j && j.matchedBy === "id" && j.nodes.map((n) => `${n.id}@${n.distance}`).join() === "b@1,c@2", r.out);
  check("each step keeps its edge's real direction", j && j.nodes[1].via.source === "b" && j.nodes[1].via.target === "c", r.out);
  r = runTool(T, ["neighbours", "d", "--json"], root);
  j = parse(r);
  check("a caller is a neighbour too: d is reached from c, which imports it", j && j.nodes.map((n) => n.id).join() === "c" && j.nodes[0].via.source === "c" && j.nodes[0].via.relation === "imports", r.out);
  r = runTool(T, ["neighbours", "a", "--depth", "3", "--limit", "1"], root);
  check("--limit caps the list and says so", r.exit === 0 && /capped at --limit 1/.test(r.out), r.out);
  r = runTool(T, ["neighbours", "nothing-like-this"], root);
  check("an unknown seed exits 2", r.exit === 2 && /No node/.test(r.err), `${r.exit} ${r.err}`);
  r = runTool(T, ["neighbours", "a", "--depth", "zero"], root);
  check("a bad --depth is a usage error, exit 2", r.exit === 2 && /--depth/.test(r.err), `${r.exit} ${r.err}`);

  r = runTool(T, ["communities"], root);
  check("both communities are listed", r.exit === 0 && /community 0/.test(r.out) && /community 1/.test(r.out), r.out);
  r = runTool(T, ["hubs", "--top", "2", "--json"], root);
  j = parse(r);
  check("hubs ranks the two nodes with two edges", j && r.exit === 0 && j.hubs.map((n) => n.id).sort().join() === "b,c", r.out);
  r = runTool(T, ["path", "a", "d"], root);
  check("path a to d walks three hops and shows the INFERRED import", r.exit === 0 && /3 hop/.test(r.out) && /-imports->/.test(r.out) && /INFERRED/.test(r.out), r.out);
}
{
  const root = seeded("gf-nopath", { nodes: [node("x", "src/a.py"), node("y", "src/b.py")], edges: [] });
  runTool(T, ["status"], root);
  const r = runTool(T, ["path", "x", "y"], root);
  check("no path exits 1 and says so", r.exit === 1 && /No path/.test(r.out), `${r.exit} ${r.out} ${r.err}`);
  const h = runTool(T, ["hubs"], root);
  check("a graph with no edges has no hubs: exit 1", h.exit === 1, `${h.exit} ${h.err}`);
}

section("graphify - a subdirectory scan is placed; a graph it cannot place or read is refused");
{
  const root = seeded("gf-subdir", { nodes: [node("a", "a.py"), node("b", "b.py")], links: [edge("a", "b")] });
  let r = runTool(T, ["status", "--json"], root);
  const rep = parse(r);
  check("paths relative to src/ are placed under src/, read from NetworkX links[]", rep && r.exit === 0 && rep.data.anchor === "src" && rep.data.edges === 1, r.out + r.err);
  r = runTool(T, ["neighbours", "src/a.py", "--json"], root);
  check("queries answer in repository paths", parse(r)?.files?.[0]?.file === "src/b.py", r.out + r.err);
}
{
  const root = seeded("gf-unplaced", { nodes: [node("a", "deep/nowhere/a.py")], edges: [] });
  const r = runTool(T, ["status", "--json"], root);
  const rep = parse(r);
  check("paths that resolve nowhere: exit 2, an unanchored-graph block, no snapshot", rep && r.exit === 2 && fm.validate(rep).length === 0 && rep.findings.some((f) => f.code === "unanchored-graph") && !existsSync(SNAP(root)), r.out + r.err);
}
{
  const root = seeded("gf-foreign", { nodes: [node("a", "src/a.py"), node("z", "/somewhere/else/z.py"), node("u", "https://example.com/spec.pdf")], edges: [edge("a", "z"), edge("a", "u", "cites")] });
  const r = runTool(T, ["status", "--json"], root);
  const rep = parse(r);
  check("a path from another machine, or a URL it ingested, warns and does not stale the graph", rep && r.exit === 0 && rep.data.foreign === 2 && rep.findings.some((f) => f.code === "foreign-path" && f.severity === "warn"), r.out + r.err);
}
{
  const root = fixture("gf-malformed");
  put(root, "graphify-out/graph.json", JSON.stringify({ nodes: "nope" }));
  let r = runTool(T, ["status"], root);
  check("nodes that are not an array: exit 2, the message names nodes, no snapshot", r.exit === 2 && /nodes/.test(r.err) && !existsSync(SNAP(root)), `${r.exit} ${r.err}`);
  put(root, "graphify-out/graph.json", "{ not json");
  r = runTool(T, ["status", "--json"], root);
  const rep = parse(r);
  check("unparseable JSON: a valid report with a malformed-graph block and exit 2", rep && r.exit === 2 && fm.validate(rep).length === 0 && rep.findings.some((f) => f.code === "malformed-graph"), r.out + r.err);
}

report("The Graphify adapter reads what a human built, refuses what it cannot place, and derives freshness from content.");
