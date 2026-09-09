#!/usr/bin/env node
/**
 * artifact-schema.mjs — the traceability graph over the lifecycle documents.
 *
 * WHY THIS SHAPE AND NOT JSON DOCUMENTS
 *
 * The obvious reading of "add schemas" is: author requirements as JSON, render
 * Markdown from it. That would be a mistake here. The value of this platform is
 * that an agent writes these documents as PROSE - with options, trade-offs and
 * the reasoning behind a decision. A PRD squeezed into a JSON object loses
 * exactly the part worth reading, and all ninety-six skills produce Markdown.
 *
 * So this does what `ac-trace.mjs` already does successfully: a machine-readable
 * tag inside a human-written artifact. A `// AC-3:` comment in a test file is
 * that pattern, and it works. Here it is two things:
 *
 *   1. front-matter   what this document IS and what it descends from,
 *                     validated against schemas/document.schema.json
 *   2. IDs in prose   FR-12, S-07, UC-04, EP-05 - already emitted by the
 *                     lifecycle skills, now read as a graph
 *
 * Nothing has to be re-authored. The graph works on documents that exist today.
 *
 * DIVISION OF LABOUR
 *   ac-trace.mjs        acceptance criterion  -> test          (already existed)
 *   this                requirement -> story -> use case -> endpoint / screen
 * Together they span phase 1 to phase 5. Neither duplicates the other.
 *
 * Usage:
 *   node .cursor/tools/artifact-schema.mjs validate        # front-matter vs schema
 *   node .cursor/tools/artifact-schema.mjs graph [--json]  # what is defined where
 *   node .cursor/tools/artifact-schema.mjs trace <ID>      # one id, up and down
 *   node .cursor/tools/artifact-schema.mjs check [--json]  # dangling / misplaced / unlinked
 *
 * Exit codes:  0 = clean   1 = findings   2 = usage
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

// The template convention (which markers mean 'unfilled', and how many
// [square-bracket] slots make a document a form rather than a document) is
// owned by memory-bank.mjs. It is a LEAF - it imports nothing - so importing
// it here cannot create the cycle that kept this file from importing
// lifecycle.mjs. self-audit A9 found the copy below had already drifted.
const mb = await import(new URL("./memory-bank.mjs", import.meta.url));

const ROOT = process.env.CLAUDE_PROJECT_DIR || repoRoot() || process.cwd();
function repoRoot() {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

/**
 * The project's own schemas win - it may extend the id grammar with prefixes
 * this platform never heard of. The copy shipped beside the tool is the
 * fallback, so a plugin install is not a tool that runs and grades nothing.
 */
const SCHEMA_DIRS = [
  join(ROOT, "schemas"),                                    // the project's own, which may extend the grammar
  // fileURLToPath, not .pathname: the latter is "/D:/..." on Windows, which
  // existsSync cannot open, so neither fallback ever resolved there.
  fileURLToPath(new URL("../../schemas/", import.meta.url)),   // repo layout:   .cursor/tools/ -> schemas/
  fileURLToPath(new URL("../schemas/", import.meta.url)),      // plugin layout: tools/         -> schemas/
];
function load(f) {
  for (const d of SCHEMA_DIRS) {
    try { return JSON.parse(readFileSync(join(d, f), "utf8")); } catch { /* next */ }
  }
  throw new Error(`schema ${f} not found in ${SCHEMA_DIRS.join(" or ")}`);
}

/* ------------------------------------------------------- front-matter parser */

/**
 * A deliberately small YAML subset: `key: scalar`, `key: [a, b]`, and block
 * sequences. That is everything document.schema.json permits, and a full YAML
 * parser would be a dependency - which rule 10 forbids and none of the other
 * seven tools have needed.
 *
 * Anything outside the subset is reported as a parse error rather than guessed
 * at. A front-matter block this tool half-understands is worse than one it
 * refuses.
 */
export function parseFrontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) return { found: false, data: null, errors: [] };

  const data = {}, errors = [];
  let key = null;
  for (const [i, raw] of m[1].split(/\r?\n/).entries()) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || /^\s*#/.test(line)) continue;

    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item) {
      if (!key) { errors.push(`line ${i + 1}: list item before any key`); continue; }
      (data[key] ||= []).push(scalar(item[1]));
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) { errors.push(`line ${i + 1}: not "key: value" or "  - item": ${line.slice(0, 50)}`); continue; }
    key = kv[1];
    const v = kv[2].trim();
    if (v === "") data[key] = [];                                   // block sequence follows
    else if (/^\[.*\]$/.test(v)) data[key] = v.slice(1, -1).split(",").map((x) => scalar(x.trim())).filter((x) => x !== "");
    else data[key] = scalar(v);
  }
  return { found: true, data, errors, raw: m[0] };
}
const scalar = (s) => {
  const v = s.replace(/^["']|["']$/g, "");
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
};

/* ---------------------------------------------------- JSON Schema (a subset) */

/**
 * Supports type, required, additionalProperties, properties, enum, pattern and
 * items - which is all document.schema.json uses. Unsupported keywords are
 * ignored rather than silently treated as passing constraints, and the schema
 * is small enough to keep that honest.
 */
export function validate(value, schema, path = "") {
  const out = [];
  const at = path || "(root)";
  const t = schema.type;
  if (t === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return [`${at}: expected an object`];
    for (const r of schema.required || []) if (!(r in value)) out.push(`${at}: missing required key "${r}"`);
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(value)) {
        if (!(k in (schema.properties || {}))) out.push(`${at}: unknown key "${k}"`);
      }
    }
    for (const [k, sub] of Object.entries(schema.properties || {})) {
      if (k in value) out.push(...validate(value[k], sub, path ? `${path}.${k}` : k));
    }
    return out;
  }
  if (t === "array") {
    if (!Array.isArray(value)) return [`${at}: expected a list`];
    value.forEach((v, i) => out.push(...validate(v, schema.items || {}, `${at}[${i}]`)));
    return out;
  }
  if (t === "string" && typeof value !== "string") return [`${at}: expected a string, got ${typeof value}`];
  if (schema.enum && !schema.enum.includes(value)) {
    out.push(`${at}: "${value}" is not one of ${schema.enum.join(", ")}`);
  }
  if (schema.pattern && typeof value === "string" && !new RegExp(schema.pattern).test(value)) {
    out.push(`${at}: "${value}" does not match ${schema.pattern}`);
  }
  return out;
}

/* ---------------------------------------------------------------- ID scanning */

/**
 * Telling a DEFINITION from a REFERENCE without asking anyone to change how they
 * write. Four shapes, all of which the lifecycle skills already emit:
 *
 *   ### UC-04 — Issue policy          a heading
 *   | UC-04 | ... |                   the first cell of a table row
 *   - **AC-1** Given ... When ...     a bold list item
 *   INV-03  A Policy may not ...      first token on the line
 *
 * Anything else on a line is a reference. The heuristic is deliberately narrow:
 * a missed definition shows up as "dangling", which is visible and fixable,
 * while a false definition would silently satisfy a broken chain.
 */
function scanIds(text, prefixes) {
  const P = prefixes.join("|");
  const DEF = [
    new RegExp(`^#{2,6}\\s+\\**\`?(${P})-(\\d{1,3})\`?\\**`),
    new RegExp(`^\\|\\s*\\**\`?(${P})-(\\d{1,3})\`?\\**\\s*\\|`),
    new RegExp(`^\\s*[-*]\\s+\\*\\*(${P})-(\\d{1,3})\\*\\*`),
    new RegExp(`^\\**\`?(${P})-(\\d{1,3})\`?\\**(?:\\s{2,}|\\s*[—:-])`),
  ];
  const ANY = new RegExp(`\\b(${P})-(\\d{1,3})\\b`, "g");

  const defs = [], refs = [];
  let story = null;                      // AC ids are scoped by the story above them
  let section = null;                    // the definition a reference belongs to
  text.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) return;
    let defId = null;
    for (const re of DEF) {
      const m = re.exec(line);
      if (m) { defId = `${m[1]}-${String(Number(m[2]))}`; break; }
    }
    if (defId?.startsWith("S-")) story = defId;
    if (defId) {
      const scoped = defId.startsWith("AC-") && story ? `${story}/${defId}` : defId;
      defs.push({ id: scoped, line: i + 1, text: line.trim().slice(0, 90) });
      section = scoped;
    }
    for (const m of line.matchAll(ANY)) {
      const id = `${m[1]}-${String(Number(m[2]))}`;
      if (id === defId) continue;
      // `owner` is the entity this citation belongs to - the nearest definition
      // above it in the same document. `**Requirement:** FR-2` under `### S-2`
      // is S-2 citing FR-2, and nothing to do with S-1.
      refs.push({ id, line: i + 1, owner: section });
    }
  });
  return { defs, refs };
}

/* ------------------------------------------------------------------ the graph */

const LIFECYCLE_DIRS = ["docs/product", "docs/analysis", "docs/design", "docs/testing"];

function walkMd(dir, out = []) {
  let entries;
  try { entries = readdirSync(join(ROOT, dir), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walkMd(rel, out);
    else if (e.name.endsWith(".md")) out.push(rel);
  }
  return out;
}

export function buildGraph() {
  const grammar = load("id-grammar.json").prefixes;
  const prefixes = Object.keys(grammar);
  const files = LIFECYCLE_DIRS.flatMap((d) => walkMd(d));

  const byId = new Map();        // id -> { id, file, line, prefix }
  const refsByFile = new Map();  // file -> Set(id)
  const defsByFile = new Map();  // file -> Set(prefix)
  const frontMatter = new Map(); // file -> { data, errors, found }
  const citedBy = new Map();     // id -> Set(entity ids that cite it, by section)
  const duplicates = [];

  for (const f of files) {
    let text;
    try { text = readFileSync(join(ROOT, f), "utf8"); } catch { continue; }
    frontMatter.set(f, parseFrontMatter(text));
    const { defs, refs } = scanIds(text, prefixes);

    // A document defines only the prefixes it OWNS. The first cell of a row in
    // a traceability table looks exactly like the first cell of a row in a
    // definition table, and no amount of pattern-matching separates them -
    // `| S-1 | UC-1 | FR-1 |` in use-cases.md is a citation, not a second
    // definition of S-1. Ownership is already declared in front-matter
    // (`defines:`), and falls back to the grammar's definedIn, so the answer is
    // stated rather than guessed.
    const fmDefines = frontMatter.get(f)?.data?.defines;
    const owns = (pfx) => Array.isArray(fmDefines) && fmDefines.length
      ? fmDefines.includes(pfx)
      : (grammar[pfx]?.definedIn ? f.startsWith(grammar[pfx].definedIn.replace(/\/$/, "")) : true);

    for (const d of defs) {
      if (!owns(prefixOf(d.id))) { (refsByFile.get(f) || refsByFile.set(f, new Set()).get(f)).add(d.id.includes("/") ? d.id : d.id); continue; }
      if (byId.has(d.id)) duplicates.push({ id: d.id, first: byId.get(d.id).file, again: f, line: d.line });
      else byId.set(d.id, { ...d, file: f, prefix: prefixOf(d.id) });
      (defsByFile.get(f) || defsByFile.set(f, new Set()).get(f)).add(prefixOf(d.id));
    }
    const set = refsByFile.get(f) || refsByFile.set(f, new Set()).get(f);
    for (const r of refs) {
      set.add(r.id);
      // Only count an owner this file actually defines - a citation attributed to
      // a section heading further up is still inside that entity.
      if (r.owner && owns(prefixOf(r.owner))) {
        (citedBy.get(r.id) || citedBy.set(r.id, new Set()).get(r.id)).add(r.owner);
      }
    }
  }
  return { grammar, files, byId, refsByFile, defsByFile, frontMatter, duplicates, citedBy };
}

/**
 * The prefix of an id. "S-1/AC-1" is an AC, not an S - reading the scope's
 * prefix made every acceptance criterion inherit the story's obligation to reach
 * a use case, which is ac-trace.mjs's half of the chain, not this one's.
 */
export const prefixOf = (id) => (id.includes("/") ? id.split("/").pop() : id).split("-")[0];

/** Is `id` picked up by a document that defines something it should trace to? */
function downstream(g, id) {
  const prefix = prefixOf(id);
  const targets = g.grammar[prefix]?.tracesTo || [];
  if (!targets.length) return { required: false, found: [] };
  const found = [];
  for (const [file, refs] of g.refsByFile) {
    if (!refs.has(id)) continue;
    for (const t of targets) if (g.defsByFile.get(file)?.has(t)) found.push({ file, via: t });
  }
  return { required: true, targets, found };
}

/* ------------------------------------------------------------------ commands */

function cmdValidate() {
  const g = buildGraph();
  const schema = load("document.schema.json");
  let bad = 0, withFm = 0;
  for (const f of g.files) {
    const fm = g.frontMatter.get(f);
    if (!fm?.found) continue;                 // front-matter is opt-in; absence is not a failure
    withFm++;
    const errs = [...fm.errors, ...validate(fm.data, schema)];
    if (!errs.length) continue;
    bad++;
    console.log(`  ${f}`);
    for (const e of errs) console.log(`    ${e}`);
  }
  if (!g.files.length) return console.log("No lifecycle documents yet — nothing to validate.");
  console.log(bad
    ? `\n${bad} document(s) with invalid front-matter, of ${withFm} that declare it.`
    : `${withFm} of ${g.files.length} lifecycle document(s) declare valid front-matter.`);
  if (bad) process.exit(1);
}

function cmdGraph(args) {
  const g = buildGraph();
  if (args.includes("--json")) {
    return console.log(JSON.stringify({
      ids: [...g.byId.values()],
      duplicates: g.duplicates,
    }, null, 2));
  }
  if (!g.byId.size) return console.log("No ids found. Run the phase 1-3 skills first.");
  const groups = {};
  for (const v of g.byId.values()) (groups[v.prefix] ||= []).push(v);
  for (const [pfx, list] of Object.entries(groups)) {
    const meta = g.grammar[pfx] || {};
    console.log(`\n${pfx}  ${meta.name || ""}  (${list.length})  ${meta.phase || ""}`);
    for (const v of list.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))) {
      const d = downstream(g, v.id);
      const link = !d.required ? "" : d.found.length ? `-> ${[...new Set(d.found.map((x) => x.via))].join(",")}` : "-> NOTHING";
      console.log(`  ${v.id.padEnd(14)} ${v.file.padEnd(38)} ${link}`);
    }
  }
}

function cmdTrace(args) {
  const g = buildGraph();
  const id = (args.find((a) => /^[A-Z]{1,4}-\d+$/.test(a)) || "").toUpperCase();
  if (!id) die("trace needs an id, e.g. trace S-07", 2);
  const def = g.byId.get(id);
  console.log(`${id}  ${g.grammar[id.split("-")[0]]?.name || ""}`);
  console.log(def ? `  defined: ${def.file}:${def.line}\n    ${def.text}` : `  defined: NOWHERE — referenced but never defined`);
  const citing = [...g.refsByFile].filter(([, r]) => r.has(id)).map(([f]) => f);
  console.log(`\n  referenced by (${citing.length}):`);
  for (const f of citing) console.log(`    ${f}`);
  const d = downstream(g, id);
  if (d.required) {
    console.log(`\n  should reach: ${d.targets.join(", ")}`);
    console.log(d.found.length
      ? `  reaches:      ${[...new Set(d.found.map((x) => `${x.via} (${x.file})`))].join(", ")}`
      : `  reaches:      NOTHING — the chain stops here`);
  }
}

/* ------------------------------------------------------- definition of ready */

/**
 * Is one story ready to enter DEVELOPMENT?
 *
 * "Definition of Done" is well served here already - /task-verify refuses to
 * mark a task done without evidence. Nothing asked the question at the other
 * end, and that is where the cheaper mistake lives: a story that enters
 * development half-specified costs a rewrite, while one that fails this check
 * costs a paragraph.
 *
 * Most of the list is now computable, because the graph already knows what
 * reaches what. Two items are not, and are reported as manual rather than
 * quietly dropped - a checklist that silently omits what it cannot verify is
 * how a gate stops gating.
 */
/**
 * Does a required design document exist with real content?
 *
 * lifecycle.mjs has a richer version of this, and importing IT here would make
 * the two tools import each other - lifecycle.mjs already imports buildGraph()
 * from this file. So the convention is taken from memory-bank.mjs instead,
 * which imports nothing and therefore cannot close that loop.
 *
 * The copy that used to live here had already drifted: it was missing the
 * `fill me in` marker and had no slot heuristic at all, so a requirements
 * document that was 80% [square brackets] passed this presence check while
 * failing lifecycle.mjs's. The 120-byte floor stays local - that is this
 * file's own policy about its own documents, not a shared convention.
 */
function docPresent(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return { ok: false, reason: "missing" };
  let body = "";
  try { body = readFileSync(abs, "utf8").trim(); } catch { return { ok: false, reason: "unreadable" }; }
  if (body.length < 120) return { ok: false, reason: "too short to be real content" };
  if (mb.PLACEHOLDER.test(body) || mb.isUnfilled(body)) return { ok: false, reason: "still a template" };
  return { ok: true };
}

function readiness(g, storyId) {
  const story = g.byId.get(storyId);
  const out = { id: storyId, story, checks: [], manual: [] };
  if (!story) { out.missing = true; return out; }

  const cites = (id) => {
    const v = g.byId.get(id);
    if (!v) return new Set();
    // What the entity's own section cites, via the citedBy index inverted.
    const s = new Set();
    for (const [target, owners] of g.citedBy) if (owners.has(id)) s.add(target);
    return s;
  };
  const reaches = (id, prefix) =>
    [...(g.citedBy.get(id) || [])].filter((o) => (o.includes("/") ? o.split("/").pop() : o).split("-")[0] === prefix);

  const add = (ok, label, detail) => out.checks.push({ ok, label, detail });

  // 1. a requirement to exist for
  const frs = [...cites(storyId)].filter((x) => x.startsWith("FR-"));
  add(frs.length > 0, "requirement", frs.join(", ") || "the story cites no FR");

  // 2. acceptance criteria, which phase 5 will trace tests against
  const acs = [...g.byId.keys()].filter((k) => k.startsWith(`${storyId}/AC-`));
  add(acs.length > 0, "acceptance criteria",
      acs.length ? `${acs.length} (${acs.map((a) => a.split("/")[1]).join(", ")})` : "none - /e2e-test-gen has nothing to generate from");

  // 3. a use case: how the business actually performs it
  const ucs = reaches(storyId, "UC");
  add(ucs.length > 0, "use case", ucs.join(", ") || "no use case covers this story");

  // 4. the rules that constrain it
  const rules = ucs.flatMap((uc) => [...cites(uc)].filter((x) => x.startsWith("BR-") || x.startsWith("INV-")));
  add(rules.length > 0, "business rules",
      rules.length ? [...new Set(rules)].join(", ") : `${ucs.join(", ") || "its use case"} cites no BR or INV`);

  // 5. the API it will be built against
  const eps = ucs.flatMap((uc) => reaches(uc, "EP"));
  add(eps.length > 0, "API", [...new Set(eps)].join(", ") || "no endpoint serves this story's use case");

  // 6. the screen. Not every story has one, so this warns rather than fails.
  const scs = ucs.flatMap((uc) => reaches(uc, "SC"));
  out.checks.push({
    ok: scs.length > 0, warn: scs.length === 0, label: "UI",
    detail: [...new Set(scs)].join(", ") || "no screen - fine for a backend-only story, confirm it is one",
  });

  // 7-8. project-level prerequisites: design work that must exist before any
  // story is built, not something each story re-establishes.
  for (const [rel, label, why] of [
    ["docs/design/security-design.md", "security design", "threat-model output and the authn/authz decisions"],
    ["docs/design/database-design.md", "data design", "the physical schema this story will write to"],
  ]) {
    const st = docPresent(rel);
    add(st.ok, label, st.ok ? rel : `${rel}: ${st.reason} - ${why}`);
  }

  out.manual = [
    ["dependencies", "node .cursor/tools/task-graph.mjs graph <plan.md>", "which stories must land first"],
    ["task sizing", "node .cursor/tools/task-graph.mjs validate <plan.md>", "no task over 8 files or 2 layers"],
  ];
  return out;
}

function cmdReady(args) {
  const g = buildGraph();
  if (!g.byId.size) { console.log("No ids found - run the phase 1-3 skills first."); return; }

  const wanted = args.find((a) => /^S-\d+$/i.test(a))?.toUpperCase();
  const ids = wanted ? [wanted] : [...g.byId.keys()].filter((k) => /^S-\d+$/.test(k)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!ids.length) { console.log("No stories found. /user-story-map defines them in docs/product/story-map.md."); return; }

  const results = ids.map((id) => readiness(g, id));
  if (args.includes("--json")) return console.log(JSON.stringify(results, null, 2));

  let blocked = 0;
  for (const r of results) {
    if (r.missing) { console.log(`\n${r.id}  NOT FOUND`); blocked++; continue; }
    const hard = r.checks.filter((c) => !c.ok && !c.warn);
    if (hard.length) blocked++;
    // The captured line is the heading: "### S-1 — Request a quote". Strip the
    // marker and the id so the title is not printed twice.
    const title = (r.story.text || "").replace(/^#+\s*/, "").replace(/^[A-Z]{1,4}-\d+\s*[—–-]\s*/, "");
    console.log(`\n${r.id.padEnd(6)} ${title.slice(0, 56)}`);
    console.log(`      ${hard.length ? "NOT READY" : "READY"}`);
    for (const c of r.checks) {
      console.log(`  [${c.ok ? "x" : c.warn ? "~" : " "}] ${c.label.padEnd(20)} ${c.detail}`);
    }
    if (!wanted) continue;
    console.log(`\n  not computable here - check by hand:`);
    for (const [label, cmd, why] of r.manual) console.log(`    ${label.padEnd(14)} ${cmd}\n                   ${why}`);
  }

  console.log(`\n${results.length - blocked}/${results.length} ready.`);
  if (blocked) {
    console.log(`A story that enters development half-specified costs a rewrite.`);
    console.log(`One that fails this check costs a paragraph.`);
    process.exit(1);
  }
}

function cmdCheck(args) {
  const g = buildGraph();
  const findings = { dangling: [], misplaced: [], unlinked: [], duplicate: g.duplicates };

  for (const [file, refs] of g.refsByFile) {
    for (const id of refs) if (!g.byId.has(id)) findings.dangling.push({ id, file });
  }
  for (const v of g.byId.values()) {
    const want = g.frontMatter.get(v.file)?.data?.defines ? null : g.grammar[v.prefix]?.definedIn;
    if (want && !v.file.startsWith(want.replace(/\/$/, ""))) findings.misplaced.push({ ...v, want });
    const d = downstream(g, v.id);
    if (d.required && !d.found.length) findings.unlinked.push({ id: v.id, file: v.file, targets: d.targets });
  }

  if (args.includes("--json")) return console.log(JSON.stringify(findings, null, 2));

  const n = Object.values(findings).reduce((a, x) => a + x.length, 0);
  if (!g.byId.size) { console.log("No ids found — nothing to check yet."); return; }
  if (!n) {
    console.log(`Traceability intact: ${g.byId.size} ids across ${g.files.length} document(s), every chain reaches its next link.`);
    return;
  }

  if (findings.dangling.length) {
    console.log(`\nDANGLING (${findings.dangling.length}) — referenced, never defined`);
    for (const d of findings.dangling) console.log(`  ${d.id.padEnd(12)} cited in ${d.file}`);
    console.log(`  A citation to an id nobody wrote down is a decision that was never recorded.`);
  }
  if (findings.duplicate.length) {
    console.log(`\nDUPLICATE (${findings.duplicate.length}) — the same id defined twice`);
    for (const d of findings.duplicate) console.log(`  ${d.id.padEnd(12)} ${d.first}  and  ${d.again}:${d.line}`);
  }
  if (findings.misplaced.length) {
    console.log(`\nMISPLACED (${findings.misplaced.length}) — defined outside the document that owns the prefix`);
    for (const d of findings.misplaced) console.log(`  ${d.id.padEnd(12)} in ${d.file}, expected ${d.want}`);
  }
  if (findings.unlinked.length) {
    console.log(`\nUNLINKED (${findings.unlinked.length}) — defined, but the chain stops`);
    for (const d of findings.unlinked) console.log(`  ${d.id.padEnd(12)} ${d.file}  should reach ${d.targets.join(" or ")}`);
    console.log(`  This is Gate 1 criterion 3 and Gate 2 criterion 1, computed rather than judged.`);
  }
  console.log(`\n${n} finding(s).`);
  process.exit(1);
}

function die(m, c) { console.error(m); process.exit(c); }

// Only run the CLI when invoked directly. lifecycle.mjs imports buildGraph() to
// fold traceability into the mechanical consent, and must not trip a command.
const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].split("\\").join("/")}`).href;
if (invokedDirectly) main();

function main() {
const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case "validate": cmdValidate(); break;
  case "graph": cmdGraph(args); break;
  case "trace": cmdTrace(args); break;
  case "ready": cmdReady(args); break;
  case "check": cmdCheck(args); break;
  default:
    console.error(`artifact-schema.mjs — traceability across the lifecycle documents

  validate        front-matter against schemas/document.schema.json
  graph [--json]  every id, where it is defined, whether its chain continues
  trace <ID>      one id: where defined, who cites it, what it reaches
  ready [S-7]     definition of ready: may this story enter DEVELOPMENT
  check [--json]  dangling / duplicate / misplaced / unlinked

Chain (schemas/id-grammar.json):  FR -> S -> UC -> EP, SC     NFR -> ADR, EP
ac-trace.mjs owns the other half: AC -> test.`);
    process.exit(2);
}
}
