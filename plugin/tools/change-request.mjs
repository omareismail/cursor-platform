#!/usr/bin/env node
/**
 * change-request.mjs — a change to an approved product, as a record with a
 * computed blast radius.
 *
 * WHY `rollback` WAS NOT ENOUGH
 *
 * `lifecycle.mjs rollback DESIGN --reason "..."` reopens a phase and resets
 * every later one. That is the right hammer for "we got the architecture wrong",
 * and the wrong one for the thing that actually happens: a customer changes a
 * payment rule, and somebody has to work out what that touches. Rollback answers
 * with "everything after DESIGN", which is both true and useless.
 *
 * This answers precisely. It seeds on the ids that changed, walks the
 * traceability graph, and reports the documents, phases and approvals that will
 * stop being true — before the edit is made rather than after.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not invalidate anything. It cannot, and should not: a phase goes STALE
 * because an artifact's content hash moved, which lifecycle.mjs derives on every
 * read. Inventing a second, weaker invalidation path here would create exactly
 * the disagreement that mechanism was built to avoid.
 *
 * So a change request is a FORECAST and a RECORD:
 *   forecast   what will go stale when this edit lands, and what re-approval costs
 *   record     why the change happened, who asked, what was touched
 * The hashes remain the enforcement.
 *
 * Usage:
 *   node .cursor/tools/change-request.mjs open --reason "..." --changes "BR-4,FR-2" --by "name" [--risk LOW|MED|HIGH]
 *   node .cursor/tools/change-request.mjs impact <ID-or-list>     # forecast without opening one
 *   node .cursor/tools/change-request.mjs list [--all]
 *   node .cursor/tools/change-request.mjs show CR-0001
 *   node .cursor/tools/change-request.mjs close CR-0001 --note "..."
 *
 * Exit codes:  0 = ok   1 = refused / not found   2 = usage
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { writeJsonAtomic, nextSequentialId, actor } from "./_state.mjs";
import { recordFile } from "./_evidence.mjs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.env.CLAUDE_PROJECT_DIR || repoRoot() || process.cwd();
function repoRoot() {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}
const CR_DIR = () => join(ROOT, "lifecycle", "changes");

/** Index a record that was just written. The record stands either way; say so if the index did not. */
function chained(relPath, kind, meta) {
  try { return recordFile(ROOT, relPath, kind, meta); }
  catch (e) { console.error(`WARN  ${relPath} was written but could not be added to lifecycle/index.jsonl: ${e.message}`); return null; }
}

const load = async (mod) => import(new URL(`./${mod}`, import.meta.url).href);

/* ------------------------------------------------------------ impact walking */

/**
 * The transitive downstream closure of a set of ids.
 *
 * One step: for every document that CITES a seed id, take the ids that document
 * DEFINES. So FR-2 reaches S-2 (story-map cites FR-2 and defines S-*), S-2
 * reaches UC-2, and UC-2 reaches EP-2 — the chain from the review, computed
 * rather than recalled.
 *
 * It deliberately does NOT filter by the grammar's `tracesTo`. That field is a
 * COMPLETENESS contract — what `artifact-schema.mjs check` insists every id must
 * reach — and using it here would answer the wrong question. BR-1 has no
 * `tracesTo` because a business rule owes nothing downstream, yet changing it
 * plainly affects every use case that enforces it. Impact follows citation.
 *
 * The bias is deliberate: an over-broad blast radius costs a reviewer some
 * reading, and an under-broad one ships a contradiction.
 *
 * Terminates on the visited set, and on a depth bound in case a document pair
 * ends up citing each other.
 */
function impactOf(g, seeds) {
  const impacted = new Map();          // id -> { id, file, via, depth }
  let frontier = seeds.filter((s) => g.byId.has(s));
  const missing = seeds.filter((s) => !g.byId.has(s));
  let depth = 0;

  while (frontier.length && depth < 10) {
    depth++;
    const next = [];
    for (const id of frontier) {
      for (const owner of g.citedBy.get(id) || []) {
        if (impacted.has(owner) || seeds.includes(owner)) continue;
        const v = g.byId.get(owner);
        impacted.set(owner, { id: owner, file: v?.file || "?", via: id, depth });
        next.push(owner);
      }
    }
    frontier = next;
  }
  return { impacted: [...impacted.values()], missing };
}

/** Which documents, and therefore which phases, the change reaches. */
function reach(g, seeds, impacted) {
  const files = new Set();
  for (const id of seeds) { const v = g.byId.get(id); if (v) files.add(v.file); }
  for (const i of impacted) files.add(i.file);

  const phases = new Map();
  for (const f of files) {
    const fm = g.frontMatter.get(f)?.data;
    const ids = [...g.byId.values()].filter((v) => v.file === f);
    const phase = fm?.phase || g.grammar[ids[0]?.prefix]?.phase || null;
    if (phase) (phases.get(phase) || phases.set(phase, new Set()).get(phase)).add(f);
  }
  return { files: [...files], phases };
}

/* ------------------------------------------------------------------ rendering */

async function forecast(seeds) {
  const as = await load("artifact-schema.mjs");
  const g = as.buildGraph();
  if (!g.byId.size) {
    console.log("No ids found in the lifecycle documents — nothing to compute an impact against.");
    console.log("Run the phase 1-3 skills first, or use `lifecycle.mjs rollback` for a coarse reset.");
    return null;
  }
  const { impacted, missing } = impactOf(g, seeds);
  const { files, phases } = reach(g, seeds, impacted);

  // Which of those phases were approved, and would therefore need re-approval.
  let lifecycleState = null, derived = null;
  try {
    const lc = await load("lifecycle.mjs");
    lc.setRoot(ROOT);
    lifecycleState = lc.readState();
    if (lifecycleState) derived = lc.deriveAll(lifecycleState);
  } catch { /* no lifecycle adopted */ }

  const invalidates = [];
  for (const [phase] of phases) {
    const st = derived?.[phase]?.status;
    if (st === "APPROVED" || st === "INHERITED" || st === "INHERITED_UNVERIFIED") invalidates.push({ phase, status: st });
  }
  return { g, seeds, impacted, missing, files, phases, derived, invalidates };
}

function render(f) {
  console.log(`Seeds:     ${f.seeds.join(", ")}`);
  if (f.missing.length) {
    console.log(`\n  NOT FOUND: ${f.missing.join(", ")}`);
    console.log(`  An id nobody defined cannot have an impact computed. Check the spelling,`);
    console.log(`  or run: node .cursor/tools/artifact-schema.mjs graph`);
  }

  console.log(`\nImpact (${f.impacted.length} downstream id${f.impacted.length === 1 ? "" : "s"})`);
  if (!f.impacted.length) console.log(`  none — nothing downstream cites these`);
  for (const i of f.impacted.sort((a, b) => a.depth - b.depth)) {
    console.log(`  ${"  ".repeat(i.depth - 1)}${i.via} -> ${i.id.padEnd(12)} ${i.file}`);
  }

  console.log(`\nDocuments to revise (${f.files.length})`);
  for (const x of f.files) console.log(`  ${x}`);

  console.log(`\nPhases touched`);
  for (const [phase, files] of f.phases) {
    const st = f.derived?.[phase]?.status || "—";
    console.log(`  ${phase.padEnd(13)} ${st.padEnd(12)} ${files.size} document(s)`);
  }

  if (f.invalidates.length) {
    console.log(`\nRE-APPROVAL REQUIRED`);
    for (const i of f.invalidates) console.log(`  ${i.phase} is ${i.status} and will go STALE the moment its documents change.`);
    console.log(`\n  Nothing here invalidates them. lifecycle.mjs derives STALE from the artifact`);
    console.log(`  hashes recorded at approval, so it happens on the next command by itself.`);
    console.log(`  This is the forecast, so the cost is known before the edit rather than after.`);
  } else if (f.derived) {
    console.log(`\n  No approved phase is touched. This change can land without re-approval.`);
  }
}

/* ------------------------------------------------------------------- commands */

// max+1, never count+1: delete CR-0002 and count+1 would hand CR-0003 out twice,
// overwriting a record that somebody's phase re-approval cites.
const nextId = () => nextSequentialId(CR_DIR(), "CR", 4);

async function cmdOpen(args) {
  const reason = valueOf(args, "--reason");
  const by = valueOf(args, "--by");
  const risk = (valueOf(args, "--risk") || "MED").toUpperCase();
  const changes = (valueOf(args, "--changes") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!reason) die(`open needs --reason "..." — a change nobody explained is indistinguishable from a mistake.`, 2);
  if (!by) die(`open needs --by "<name>" — someone asked for this.`, 2);
  if (!changes.length) die(`open needs --changes "BR-4,FR-2" — the ids that changed. Without them there is no impact to compute.`, 2);
  if (!["LOW", "MED", "HIGH"].includes(risk)) die("--risk must be LOW, MED or HIGH.", 2);

  const f = await forecast(changes);
  if (!f) process.exit(1);
  render(f);

  const id = nextId();
  const cr = {
    id, status: "OPEN", reason, by, risk,
    openedAt: new Date().toISOString(),
    changes,
    notFound: f.missing,
    impact: f.impacted,
    documents: f.files,
    phases: Object.fromEntries([...f.phases].map(([p, s]) => [p, { documents: [...s], statusAtOpen: f.derived?.[p]?.status || null }])),
    reApprovalRequired: f.invalidates.map((x) => x.phase),
    recordedBy: actor(ROOT),
  };
  if (existsSync(join(CR_DIR(), `${id}.json`))) die(`${id} already exists - another session opened one at the same moment. Re-run.`, 1);
  writeJsonAtomic(join(CR_DIR(), `${id}.json`), cr);
  chained(`lifecycle/changes/${id}.json`, "change-request", { id, by, risk });
  console.log(`\n${id} opened by ${by} (risk ${risk}).`);
  console.log(`  lifecycle/changes/${id}.json`);
  console.log(`\nNow revise the documents listed above. Each phase whose documents you touch`);
  console.log(`goes STALE on its own; re-review it with /lifecycle-gate before re-approving.`);
}

async function cmdImpact(args) {
  const ids = args.filter((a) => /^[A-Z]{1,4}-\d+$/i.test(a)).map((s) => s.toUpperCase());
  const fromFlag = (valueOf(args, "--changes") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const seeds = [...new Set([...ids, ...fromFlag])];
  if (!seeds.length) die(`impact needs one or more ids: impact BR-4 FR-2`, 2);
  const f = await forecast(seeds);
  if (!f) process.exit(1);
  render(f);
  console.log(`\nNothing was recorded. To open a change request:`);
  console.log(`  node .cursor/tools/change-request.mjs open --changes "${seeds.join(",")}" --reason "..." --by "<name>"`);
}

function cmdList(args) {
  if (!existsSync(CR_DIR())) return console.log("No change requests.");
  const all = readdirSync(CR_DIR()).filter((f) => f.endsWith(".json")).sort()
    .map((f) => JSON.parse(readFileSync(join(CR_DIR(), f), "utf8")));
  const show = args.includes("--all") ? all : all.filter((c) => c.status === "OPEN");
  if (!show.length) return console.log(all.length ? "No open change requests (--all to include closed)." : "No change requests.");
  for (const c of show) {
    console.log(`${c.id}  ${c.status.padEnd(7)} risk ${c.risk.padEnd(4)} ${c.openedAt.slice(0, 10)}  ${c.by}`);
    console.log(`  ${c.reason}`);
    console.log(`  changes: ${c.changes.join(", ")}   -> ${c.impact.length} downstream, ${c.documents.length} document(s)`);
    if (c.reApprovalRequired?.length) console.log(`  re-approval: ${c.reApprovalRequired.join(", ")}`);
  }
}

function cmdShow(args) {
  const id = (args.find((a) => /^CR-\d+$/i.test(a)) || "").toUpperCase();
  if (!id) die("show needs a change request id, e.g. show CR-0001", 2);
  const p = join(CR_DIR(), `${id}.json`);
  if (!existsSync(p)) die(`${id} not found.`, 1);
  console.log(readFileSync(p, "utf8"));
}

function cmdClose(args) {
  const id = (args.find((a) => /^CR-\d+$/i.test(a)) || "").toUpperCase();
  if (!id) die("close needs a change request id.", 2);
  const p = join(CR_DIR(), `${id}.json`);
  if (!existsSync(p)) die(`${id} not found.`, 1);
  const cr = JSON.parse(readFileSync(p, "utf8"));
  cr.status = "CLOSED";
  cr.closedAt = new Date().toISOString();
  cr.closeNote = valueOf(args, "--note") || "";
  cr.closedBy = actor(ROOT);
  writeJsonAtomic(p, cr);
  chained(`lifecycle/changes/${id}.json`, "change-request-closed", { id });
  console.log(`${id} closed.`);
  if (cr.reApprovalRequired?.length) {
    console.log(`\nIt forecast re-approval for: ${cr.reApprovalRequired.join(", ")}`);
    console.log(`Check they actually got it:  node .cursor/tools/lifecycle.mjs status`);
  }
}

const valueOf = (a, f) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : null; };
function die(m, c) { console.error(m); process.exit(c); }

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case "open": await cmdOpen(args); break;
  case "impact": await cmdImpact(args); break;
  case "list": cmdList(args); break;
  case "show": cmdShow(args); break;
  case "close": cmdClose(args); break;
  default:
    console.error(`change-request.mjs — a change to an approved product, with a computed blast radius

  open --changes "BR-4,FR-2" --reason "..." --by "<name>" [--risk LOW|MED|HIGH]
  impact <ID> [<ID>...]      forecast without recording anything
  list [--all]               open change requests, or all of them
  show CR-0001               the full record
  close CR-0001 --note "..."

Impact is walked over schemas/id-grammar.json: FR -> S -> UC -> EP, SC.
It forecasts; it never invalidates. A phase goes STALE because its artifact
hashes moved, which lifecycle.mjs derives on its own.`);
    process.exit(2);
}
