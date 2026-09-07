#!/usr/bin/env node
/**
 * task-graph.mjs — makes "small task" a checkable property instead of a hope.
 *
 * Reads the task table out of a plan document (markdown, human-editable, single
 * source of truth — no JSON sidecar to drift) and enforces it:
 *
 *   - a task nobody can finish in one agent session is REJECTED, not estimated
 *   - dependency cycles, unknown deps and unreachable tasks are found, not felt
 *   - every task must carry a command that proves it is done
 *     (this tool checks the command EXISTS; `/task-verify` runs it and checks
 *      the acceptance criteria it is supposed to prove)
 *   - critical path and parallel batches are computed, not eyeballed
 *
 * Sizing is the point. S/M/L points tell you how long work takes; they say
 * nothing about whether an agent can hold the task in one context window. A
 * 25-file task fails halfway through and leaves a half-applied change behind,
 * which is worse than not starting. maxFiles/maxLayers are that ceiling.
 *
 * Expected table (column order is free, header names matter):
 *
 *   | ID | Task | Slice | Layer | Size | Files | Depends | Verify |
 *   |---|---|---|---|---|---|---|---|
 *   | T-01 | Add PremiumTier enum | tier-pricing | domain | S | src/Co.Domain/PremiumTier.cs | - | dotnet build |
 *
 *   ID       T-01 / TASK-001 (either convention)
 *   Slice    vertical slice / feature name this belongs to; "-" if not sliced
 *   Layer    domain|application|infrastructure|api|react|db|test|infra|docs (| separated for multi)
 *   Size     S|M|L  (1|3|8 points)
 *   Files    semicolon- or comma-separated paths, or a bare count
 *   Depends  comma-separated task ids, or "-"
 *   Verify   shell command that proves the task is done
 *
 * Usage:
 *   node .cursor/tools/task-graph.mjs validate <plan.md> [--max-files 8] [--max-layers 2]
 *   node .cursor/tools/task-graph.mjs graph    <plan.md> [--json]
 *   node .cursor/tools/task-graph.mjs next     <plan.md> [--done T-01,T-02]
 *   node .cursor/tools/task-graph.mjs split    <plan.md> <task-id>
 *
 * Exit codes:  0 = ok   1 = validation failed   2 = usage / unparseable
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULTS = {
  maxFiles: 8,      // above this, one agent session cannot reliably finish it
  maxLayers: 2,     // a task spanning 3+ layers is a slice, not a task
  maxPoints: 8,     // an L is the ceiling; XL means "not decomposed yet"
  points: { S: 1, M: 3, L: 8 },
};

const LAYERS = new Set([
  "domain", "application", "infrastructure", "api", "react", "frontend",
  "db", "database", "test", "tests", "infra", "devops", "docs", "config",
]);

// ---------------------------------------------------------------- parsing ---

/** Pull the first markdown table that has an ID column out of the document. */
function parseTable(md, file) {
  const lines = md.split("\n");
  let header = null, headerIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith("|")) continue;
    const cells = splitRow(lines[i]);
    if (cells.some(c => /^id$/i.test(c)) && cells.some(c => /^task|title|description$/i.test(c))) {
      // next line must be the markdown separator
      if (lines[i + 1] && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) { header = cells; headerIdx = i; break; }
    }
  }
  if (!header) {
    fail(`No task table found in ${file}.\n` +
         `Expected a markdown table with at least "ID" and "Task" columns.\n` +
         `Run /work-breakdown to generate one, or see .cursor/skills/work-breakdown/skill.md for the format.`, 2);
  }

  const col = (...names) => header.findIndex(h => names.some(n => new RegExp(`^${n}$`, "i").test(h)));
  const idx = {
    id: col("id"), task: col("task", "title", "description"),
    slice: col("slice", "feature", "epic"), layer: col("layer", "layers"),
    size: col("size", "estimate", "points"), files: col("files", "file", "touches"),
    deps: col("depends", "depends on", "dependencies", "blocked by"),
    verify: col("verify", "verification", "done when", "definition of done"),
    status: col("status", "state"),
  };

  const rows = [];
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) { if (rows.length) break; else continue; }
    const c = splitRow(line);
    const get = (k) => (idx[k] >= 0 && c[idx[k]] !== undefined ? c[idx[k]].trim() : "");
    const id = get("id");
    if (!id || /^-+$/.test(id)) continue;
    rows.push({
      id, line: i + 1,
      task: get("task"),
      slice: get("slice"),
      layers: splitList(get("layer")).map(s => s.toLowerCase()),
      size: get("size").toUpperCase(),
      files: splitList(get("files")),
      fileCount: fileCountOf(get("files")),
      deps: splitList(get("deps")).filter(d => d && !/^-+$/.test(d)),
      verify: get("verify"),
      status: get("status"),
    });
  }
  if (!rows.length) fail(`Task table in ${file} has a header but no rows.`, 2);
  return { rows, header };
}

const splitRow = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(s => s.trim());
const splitList = (s) => (!s || /^-+$/.test(s.trim()) ? [] : s.split(/[;,]/).map(x => x.trim().replace(/^`|`$/g, "")).filter(Boolean));

function fileCountOf(raw) {
  if (!raw || /^-+$/.test(raw.trim())) return 0;
  const bare = raw.trim().match(/^(\d+)\s*(files?)?$/i);   // "6" or "6 files"
  if (bare) return Number(bare[1]);
  return splitList(raw).length;
}

// ------------------------------------------------------------- validation ---

function validate(rows, opts) {
  const errors = [], warnings = [];
  const byId = new Map();
  const E = (id, line, msg) => errors.push({ id, line, msg });
  const W = (id, line, msg) => warnings.push({ id, line, msg });

  for (const r of rows) {
    if (!/^(T|TASK)-?\d+$/i.test(r.id)) E(r.id, r.line, `id '${r.id}' is not T-nn or TASK-nnn`);
    if (byId.has(r.id)) E(r.id, r.line, `duplicate id (also at line ${byId.get(r.id).line})`);
    byId.set(r.id, r);

    if (!r.task) E(r.id, r.line, "no task description");

    // --- the sizing ceiling: this is what makes a task agent-executable ---
    if (r.fileCount === 0) {
      W(r.id, r.line, "no file manifest - the agent has to guess what to open, and will guess wrong");
    } else if (r.fileCount > opts.maxFiles) {
      E(r.id, r.line, `touches ${r.fileCount} files (max ${opts.maxFiles}). No single agent session finishes this - ` +
                      `it fails partway and leaves a half-applied change. Split it.`);
    }

    const known = r.layers.filter(l => LAYERS.has(l));
    for (const l of r.layers) if (!LAYERS.has(l)) W(r.id, r.line, `unknown layer '${l}'`);
    if (known.length > opts.maxLayers)
      E(r.id, r.line, `spans ${known.length} layers (${known.join(", ")}; max ${opts.maxLayers}). ` +
                      `That is a slice, not a task - split it per layer.`);
    if (!r.layers.length) W(r.id, r.line, "no layer");

    if (!r.size) W(r.id, r.line, "no size");
    else if (!(r.size in opts.points)) E(r.id, r.line, `size '${r.size}' is not one of ${Object.keys(opts.points).join("/")}`);
    else if (opts.points[r.size] > opts.maxPoints)
      E(r.id, r.line, `size ${r.size} exceeds the ${opts.maxPoints}-point ceiling - decompose further`);

    // --- a task with no verification is a task nobody can close ---
    if (!r.verify || /^-+$/.test(r.verify))
      E(r.id, r.line, `no verify command. "Done" must be something a machine can check, ` +
                      `not something someone declares.`);
  }

  for (const r of rows) for (const d of r.deps) {
    if (!byId.has(d)) E(r.id, r.line, `depends on unknown task '${d}'`);
    if (d === r.id) E(r.id, r.line, "depends on itself");
  }

  const cycles = findCycles(rows, byId);
  for (const c of cycles) E(c[0], byId.get(c[0])?.line, `dependency cycle: ${c.join(" -> ")} -> ${c[0]}`);

  return { errors, warnings, byId, cycles };
}

function findCycles(rows, byId) {
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map(rows.map(r => [r.id, WHITE]));
  const stack = [], cycles = [];
  const visit = (id) => {
    color.set(id, GREY); stack.push(id);
    for (const d of byId.get(id)?.deps || []) {
      if (!byId.has(d)) continue;
      if (color.get(d) === GREY) cycles.push(stack.slice(stack.indexOf(d)));
      else if (color.get(d) === WHITE) visit(d);
    }
    stack.pop(); color.set(id, BLACK);
  };
  for (const r of rows) if (color.get(r.id) === WHITE) visit(r.id);
  return cycles;
}

// ------------------------------------------------------------------ graph ---

/**
 * Topological levels. Level 0 has no dependencies and can all start at once;
 * level n needs everything in level n-1. This is the parallelisation plan —
 * with git worktrees you can run one agent per task within a level.
 */
function levels(rows, byId) {
  const depth = new Map();
  const of = (id, seen = new Set()) => {
    if (depth.has(id)) return depth.get(id);
    if (seen.has(id)) return 0;                 // cycle: validation already reported it
    seen.add(id);
    const deps = (byId.get(id)?.deps || []).filter(d => byId.has(d));
    const d = deps.length ? Math.max(...deps.map(x => of(x, seen))) + 1 : 0;
    depth.set(id, d);
    return d;
  };
  const out = [];
  for (const r of rows) { const d = of(r.id); (out[d] ||= []).push(r.id); }
  return out;
}

/** Longest weighted chain — the floor on elapsed time no matter how many agents. */
function criticalPath(rows, byId, points) {
  const memo = new Map();
  const cost = (id) => points[byId.get(id)?.size] ?? 1;
  const walk = (id, seen = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    if (seen.has(id)) return { len: 0, path: [] };
    seen.add(id);
    const deps = (byId.get(id)?.deps || []).filter(d => byId.has(d));
    let best = { len: 0, path: [] };
    for (const d of deps) { const r = walk(d, new Set(seen)); if (r.len > best.len) best = r; }
    const res = { len: best.len + cost(id), path: [...best.path, id] };
    memo.set(id, res);
    return res;
  };
  let best = { len: 0, path: [] };
  for (const r of rows) { const res = walk(r.id); if (res.len > best.len) best = res; }
  return best;
}

// --------------------------------------------------------------- commands ---

function loadPlan(args) {
  const file = args.find(a => !a.startsWith("--") && a.endsWith(".md"));
  if (!file) fail("Usage: <command> <plan.md> [options]", 2);
  const p = resolve(file);
  if (!existsSync(p)) fail(`Not found: ${file}`, 2);
  return { file, ...parseTable(readFileSync(p, "utf8"), file) };
}

function optsFrom(args) {
  const num = (flag, dflt) => { const i = args.indexOf(flag); return i >= 0 ? Number(args[i + 1]) : dflt; };
  return {
    ...DEFAULTS,
    maxFiles: num("--max-files", DEFAULTS.maxFiles),
    maxLayers: num("--max-layers", DEFAULTS.maxLayers),
    maxPoints: num("--max-points", DEFAULTS.maxPoints),
  };
}

const CMDS = {
  validate(args) {
    const { file, rows } = loadPlan(args);
    const opts = optsFrom(args);
    const { errors, warnings } = validate(rows, opts);

    if (args.includes("--json")) { out(JSON.stringify({ file, tasks: rows.length, errors, warnings }, null, 2)); return errors.length ? 1 : 0; }

    out(`task-graph validate: ${file}`);
    out(`  ${rows.length} tasks | limits: <=${opts.maxFiles} files, <=${opts.maxLayers} layers, <=${opts.maxPoints} points\n`);
    for (const e of errors)   out(`  ERROR  ${file}:${e.line}  [${e.id}] ${e.msg}`);
    for (const w of warnings) out(`  warn   ${file}:${w.line}  [${w.id}] ${w.msg}`);
    out("");
    if (errors.length) {
      out(`FAILED: ${errors.length} error(s), ${warnings.length} warning(s).`);
      out(`Oversized tasks are the ones that matter - run \`split <plan.md> <task-id>\` for a suggested breakdown.`);
      return 1;
    }
    out(`OK: ${warnings.length} warning(s), no errors.`);
    return 0;
  },

  graph(args) {
    const { file, rows } = loadPlan(args);
    const opts = optsFrom(args);
    const { byId, cycles } = validate(rows, opts);
    if (cycles.length) { fail(`Cannot build a graph: dependency cycle ${cycles[0].join(" -> ")}. Run \`validate\` first.`, 1); }

    const lv = levels(rows, byId);
    const cp = criticalPath(rows, byId, opts.points);
    const total = rows.reduce((s, r) => s + (opts.points[r.size] ?? 1), 0);
    const widest = Math.max(...lv.map(l => l.length));

    if (args.includes("--json")) {
      out(JSON.stringify({ file, total, batches: lv, criticalPath: cp.path, criticalPathPoints: cp.len, maxParallel: widest }, null, 2));
      return 0;
    }

    out(`task-graph: ${file}\n`);
    out(`  Tasks: ${rows.length}   Total: ${total} pts   Critical path: ${cp.len} pts   Max parallel: ${widest}\n`);

    out(`Parallel batches (everything in a batch can run at once):`);
    lv.forEach((ids, i) => {
      const pts = ids.reduce((s, id) => s + (opts.points[byId.get(id).size] ?? 1), 0);
      out(`  batch ${i}  (${ids.length} task${ids.length > 1 ? "s" : ""}, ${pts} pts)`);
      for (const id of ids) {
        const r = byId.get(id);
        out(`    ${pad(id, 9)} ${pad(r.size || "?", 3)} ${pad((r.layers[0] || "-"), 15)} ${r.task.slice(0, 46)}`);
      }
    });

    out(`\nCritical path (${cp.len} pts) - this is the floor on elapsed time, however many agents you run:`);
    out(`  ${cp.path.join(" -> ")}`);

    const seq = total, par = cp.len;
    out(`\n  Sequential: ${seq} pts.  Perfectly parallel: ${par} pts.  Best case speedup: ${(seq / Math.max(par, 1)).toFixed(1)}x`);
    if (widest === 1) out(`  Note: every batch has one task - this plan is fully sequential. If that is not intended,`);
    if (widest === 1) out(`  the dependencies are probably over-specified.`);
    return 0;
  },

  next(args) {
    const { rows } = loadPlan(args);
    const opts = optsFrom(args);
    const { byId } = validate(rows, opts);
    const i = args.indexOf("--done");
    const done = new Set(i >= 0 ? splitList(args[i + 1]) : rows.filter(r => /done|complete/i.test(r.status)).map(r => r.id));

    const ready = rows.filter(r => !done.has(r.id) && (r.deps || []).filter(d => byId.has(d)).every(d => done.has(d)));
    if (args.includes("--json")) { out(JSON.stringify(ready.map(r => r.id))); return 0; }

    if (!ready.length) { out(done.size >= rows.length ? "All tasks done." : "Nothing is runnable - every remaining task is blocked. Check for a cycle with `validate`."); return 0; }
    out(`Runnable now (${ready.length}); dependencies satisfied, safe to start in parallel:\n`);
    for (const r of ready) {
      out(`  ${pad(r.id, 9)} ${pad(r.size || "?", 3)} ${r.task}`);
      if (r.files.length) out(`  ${" ".repeat(9)}     files:  ${r.files.join(", ")}`);
      if (r.verify)       out(`  ${" ".repeat(9)}     verify: ${r.verify}`);
    }
    return 0;
  },

  split(args) {
    const { rows } = loadPlan(args);
    const opts = optsFrom(args);
    const id = args.find(a => !a.startsWith("--") && !a.endsWith(".md"));
    if (!id) fail("Usage: split <plan.md> <task-id>", 2);
    const r = rows.find(x => x.id.toLowerCase() === id.toLowerCase());
    if (!r) fail(`Unknown task '${id}'.`, 2);

    out(`Split suggestion for ${r.id}: ${r.task}`);
    out(`  currently ${r.fileCount} files across ${r.layers.length} layer(s) - limits are ${opts.maxFiles} / ${opts.maxLayers}\n`);

    // Group the manifest by layer, then by directory - the two splits that
    // actually reduce context, as opposed to renumbering the same work.
    const byLayer = new Map();
    for (const f of r.files) {
      const l = guessLayer(f);
      (byLayer.get(l) || byLayer.set(l, []).get(l)).push(f);
    }
    if (byLayer.size > 1) {
      out(`  Split by layer (${byLayer.size} sub-tasks):`);
      let n = 1;
      for (const [layer, files] of byLayer) {
        out(`    ${r.id}.${n++}  ${pad(layer, 16)} ${files.length} file(s)`);
        for (const f of files) out(`            ${f}`);
      }
      out(`\n  Order them by the dependency arrow: domain -> application -> infrastructure -> api -> react.`);
    } else {
      out(`  All files are in one layer, so a layer split will not help.`);
      out(`  Split by behaviour instead: separate the happy path from validation, error handling,`);
      out(`  and edge cases. Each sub-task should be independently verifiable - if two pieces cannot`);
      out(`  be verified separately, they are one task and the size is real.`);
    }
    out(`\n  Whatever you choose, every sub-task needs its own verify command.`);
    return 0;
  },
};

function guessLayer(path) {
  const p = path.toLowerCase();
  // Frontend first: a .ts under frontend/ is React-side even when the folder is
  // called "api" — otherwise the client API layer gets filed under the backend.
  if (/^(frontend|client|web|ui|src\/app)\//.test(p) || /\.(tsx|jsx)$/.test(p)) return "react";
  if (/\.domain\/|\/domain\//.test(p)) return "domain";
  if (/\.application\/|\/application\/|\/handlers?\/|\/usecases?\//.test(p)) return "application";
  if (/\.infrastructure\/|\/infrastructure\/|\/persistence\/|\/repositories\//.test(p)) return "infrastructure";
  if (/\.api\/|\/controllers?\/|\/endpoints?\//.test(p)) return "api";
  if (/\.sql$|\/migrations?\//.test(p)) return "db";
  if (/\.(ts|js)$|\/components?\/|\/pages?\/|\/features\//.test(p)) return "react";
  if (/test|spec/.test(p)) return "test";
  return "other";
}

// ------------------------------------------------------------------ utils ---
const out = (s = "") => process.stdout.write(s + "\n");
const pad = (s, n) => String(s).slice(0, n).padEnd(n);
function fail(msg, code = 2) { process.stderr.write(msg + "\n"); process.exit(code); }

const [cmd, ...args] = process.argv.slice(2);
if (!cmd || !CMDS[cmd] || cmd === "--help" || cmd === "-h") {
  out(readFileSync(new URL(import.meta.url)).toString()
    .split("\n").slice(2, 45).join("\n").replace(/^\s*\*\/?\s?/gm, "").trim());
  process.exit(cmd && !CMDS[cmd] ? 2 : 0);
}
process.exit(CMDS[cmd](args) ?? 0);
