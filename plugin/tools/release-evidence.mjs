#!/usr/bin/env node
/**
 * release-evidence.mjs — what shipped, what proved it, and who said so.
 *
 * WHY THIS EXISTS
 *
 * `lifecycle.mjs` gates the PRODUCT: six phases, six gates, approved once. That
 * is the right shape for "has anybody decided what this system is" and the wrong
 * shape for what happens afterwards, which is a release every fortnight for the
 * next four years. Approve gate 6 on the first go-live and the platform's
 * control ends there — release 2 and everything after it ship through a
 * lifecycle that is already, permanently, APPROVED.
 *
 * A release is not a phase. It is a repeating event with its own contents, its
 * own evidence and its own signature, and it needs a record of its own.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not re-implement the gates. A release cannot be cut while DEVELOPMENT
 * or TESTING is anything but cleared, and that status is derived by
 * `lifecycle.mjs` from artifact hashes — so merging a feature moves
 * `specs/features/`, which makes DEVELOPMENT STALE, which stops the next
 * release until somebody re-reviews it. The re-gating is already there. This
 * tool refuses to cut when it has not happened, and writes down what it found.
 *
 * Nothing in a record is typed by hand. Contents come from git, statuses and
 * approvals from `lifecycle/state.json`, overrides and change requests from
 * their own files, the governance profile from the requirement documents. A
 * field somebody can type is a field that will be wrong.
 *
 * INTEGRITY, HONESTLY
 *
 * Every record carries a hash over its own content, and `verify` recomputes it.
 * That catches a record edited by hand or corrupted in transit. It does NOT make
 * the record tamper-proof: anyone who can edit the file can also re-run the
 * hash. What makes it non-repudiable is committing it — git history is the
 * evidence, this hash is only the tripwire. Commit `lifecycle/releases/`.
 *
 * Usage:
 *   node .cursor/tools/release-evidence.mjs cut --version v1.2.0 [--note "..."] [--accept-check <tool.mjs>]
 *   node .cursor/tools/release-evidence.mjs sign v1.2.0 --by "name" [--accept-override OV-XXXX] [--accept-inherited PHASE] [--note "..."]
 *   node .cursor/tools/release-evidence.mjs list
 *   node .cursor/tools/release-evidence.mjs show v1.2.0 [--md | --json]
 *   node .cursor/tools/release-evidence.mjs verify [v1.2.0]
 *
 * Exit codes:  0 = ok   1 = refused / failed   2 = usage
 */

import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { actor, actorWarning, canonical } from "./_state.mjs";
import { verifyChain, formatChainFindings, commitIndexedRecord } from "./_evidence.mjs";

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));

const ROOT = process.env.CLAUDE_PROJECT_DIR || repoRoot() || process.cwd();
function repoRoot() {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}
const REL_DIR = () => join(ROOT, "lifecycle", "releases");
const CR_DIR = () => join(ROOT, "lifecycle", "changes");

const rel = (p) => p.slice(ROOT.length + 1).split("\\").join("/");
const valueOf = (args, flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
function die(msg, code) { console.error(msg); process.exit(code); }

/* ---------------------------------------------------------------------- git */

/** A git call that returns null instead of throwing. Absent git is a fact to
 *  record, not a crash — but it IS a refusal for `cut`, because a release
 *  record whose contents section is empty is worse than no record. */
function git(...args) {
  try { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 * 1024 * 1024 }).trim(); }
  catch { return null; }
}

/* ------------------------------------------------------------------ hashing */

/** Stable stringify: key order must not change the hash. */

/** The hash covers the derived facts. Signatures are added after and are not
 *  part of it — otherwise signing a record would invalidate the record. */
function integrityOf(record) {
  const { integrity, signature, ...rest } = record;
  return createHash("sha256").update(canonical(rest)).digest("hex");
}

/* -------------------------------------------------------------------- store */

const VERSION_RE = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
const fileFor = (v) => join(REL_DIR(), `${v}.json`);

function readRecord(v) {
  try { return JSON.parse(readFileSync(fileFor(v), "utf8")); } catch { return null; }
}

function allRecords() {
  let names = [];
  try { names = readdirSync(REL_DIR()).filter((f) => f.endsWith(".json")); } catch { return []; }
  return names.map((f) => { try { return JSON.parse(readFileSync(join(REL_DIR(), f), "utf8")); } catch { return null; } })
              .filter(Boolean)
              .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/* ------------------------------------------------------------- lifecycle in */

const load = async (mod) => import(new URL(`./${mod}`, import.meta.url).href);

async function lifecycle() {
  const lc = await load("lifecycle.mjs");
  lc.setRoot(ROOT);
  const state = lc.readState();
  if (!state) die(`No lifecycle/state.json. This repo never adopted the lifecycle, so there is\nnothing for a release record to cite. That is a valid configuration — but then\nthis tool has nothing to say.`, 1);
  return { lc, state, derived: lc.deriveAll(state) };
}

/* ---------------------------------------------------------------- gathering */

/** Which feature specs this release contains. With a previous release, the ones
 *  git says were touched since it; without one, all of them — the first release
 *  contains everything, and pretending otherwise would be the lie. */
function featureSpecs(prevHead) {
  const dirOf = (p) => { const m = p.match(/^specs\/features\/([^/]+)/); return m ? m[1] : null; };
  if (prevHead) {
    const out = git("diff", "--name-only", `${prevHead}..HEAD`, "--", "specs/features");
    if (out === null) return { specs: [], why: "git could not diff against the previous release's commit" };
    const set = new Set(out.split("\n").map(dirOf).filter(Boolean));
    return { specs: [...set].sort(), why: null };
  }
  try { return { specs: readdirSync(join(ROOT, "specs", "features")).filter((f) => !f.startsWith(".")).sort(), why: "first release — every spec in the repo" }; }
  catch { return { specs: [], why: "no specs/features directory" }; }
}

function commits(prevHead) {
  const CAP = 300;
  const args = prevHead ? ["log", "--no-merges", "--format=%h%x09%s", `${prevHead}..HEAD`]
                        : ["log", "--no-merges", "--format=%h%x09%s", `-n`, String(CAP)];
  const out = git(...args);
  if (out === null) return { count: 0, list: [], truncated: false, why: "git log failed" };
  const lines = out ? out.split("\n") : [];
  return { count: lines.length, list: lines.slice(0, CAP), truncated: lines.length > CAP, why: prevHead ? null : "first release — the most recent commits, not a range" };
}

/** Open change requests. Read defensively: this tool does not own their shape. */
function openChangeRequests() {
  let files = [];
  try { files = readdirSync(CR_DIR()).filter((f) => f.endsWith(".json")); } catch { return []; }
  const out = [];
  for (const f of files) {
    let cr; try { cr = JSON.parse(readFileSync(join(CR_DIR(), f), "utf8")); } catch { continue; }
    const closed = cr.closedAt || cr.closed || String(cr.status || "").toUpperCase() === "CLOSED";
    if (!closed) out.push({ id: cr.id || f.replace(/\.json$/, ""), reason: cr.reason || "", by: cr.by || "", risk: cr.risk || "" });
  }
  return out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/** Overrides still in force anywhere in the lifecycle. These are the promises
 *  that get forgotten, so they go in the record where a signature has to see
 *  them rather than in a state file nobody reopens. */
function activeOverrides(state, PHASES) {
  const out = [];
  for (const p of PHASES) {
    const ov = state.phases?.[p]?.override;
    if (!ov) continue;
    const expired = ov.expiresAt && Date.parse(ov.expiresAt) < Date.now();
    if (!expired) out.push({ phase: p, id: ov.id, by: ov.by, risk: ov.risk, reason: ov.reason, expiresAt: ov.expiresAt });
  }
  return out;
}

/** Run a checker and record that it ran, its exit code and its last line. We do
 *  not parse their output: a record that breaks when a tool reformats a table is
 *  a record that stops being written. */
function checkerPath(tool) {
  const sibling = join(TOOL_DIR, tool);
  if (existsSync(sibling)) return sibling;
  const project = join(ROOT, ".cursor", "tools", tool);
  if (existsSync(project)) return project;
  return null;
}

function ranCheck(tool, args) {
  const abs = checkerPath(tool);
  if (!abs) return { tool, ran: false, ok: false, missing: true, why: "required checker not found beside this tool or in .cursor/tools" };
  try {
    const out = execFileSync(process.execPath, [abs, ...args], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024 });
    return { tool, ran: true, ok: true, exit: 0, summary: lastLine(out) };
  } catch (e) {
    const exit = typeof e.status === "number" ? e.status : null;
    const summary = lastLine(String(e.stdout || "") + String(e.stderr || ""));
    // Exit 2 is every checker's "nothing here to check" (no criteria, no
    // promoted architecture, no dependencies). Same convention as
    // lifecycle.mjs: recorded as skipped, which is neither a pass nor a fail.
    if (exit === 2) return { tool, ran: true, ok: true, skipped: true, exit, summary };
    return { tool, ran: true, ok: false, exit, summary };
  }
}
const lastLine = (s) => (String(s).split("\n").map((l) => l.trim()).filter(Boolean).pop() || "").slice(0, 300);

function commitRelease(relPath, record, kind, meta) {
  try { return commitIndexedRecord(ROOT, relPath, record, { kind, meta }); }
  catch (e) {
    if (e.code === "ECHANGED" || e.code === "EUNINDEXED" || e.code === "ELOCKED") die(`REFUSED: ${e.message}\nNothing was written.`, 1);
    throw e;
  }
}

/* ----------------------------------------------------------------- commands */

async function cmdCut(args) {
  const version = valueOf(args, "--version");
  if (!version) die(`cut needs --version, e.g. --version v1.2.0`, 2);
  if (!VERSION_RE.test(version)) die(`"${version}" is not a version. Use v1.2.0 or 1.2.0 — the record is filed under it and it has to sort.`, 2);
  if (existsSync(fileFor(version))) die(`${rel(fileFor(version))} already exists.\nA release record is immutable: it is the answer to "what shipped as ${version}".\nIf the contents changed, this is a different release — bump the version.`, 1);

  const head = git("rev-parse", "HEAD");
  if (!head) die(`No git repository here, or no commits in it. A release record with no\ncontents is a form. Nothing written.`, 1);

  // --- the working tree has to be what shipped. ----------------------------
  const dirty = (git("status", "--porcelain", "--untracked-files=no") || "").split("\n").filter(Boolean);
  if (dirty.length) {
    console.error(`REFUSED: ${dirty.length} tracked file(s) modified and not committed.\n`);
    for (const d of dirty.slice(0, 20)) console.error(`  ${d}`);
    if (dirty.length > 20) console.error(`  ... and ${dirty.length - 20} more`);
    die(`\nThe record would name a commit that is not what is on disk. Commit or stash first.`, 1);
  }
  const untracked = (git("status", "--porcelain", "--untracked-files=all") || "").split("\n").filter((l) => l.startsWith("??"));

  const { lc, state, derived } = await lifecycle();

  // Directory approval hashes include untracked files. A cut that ignores
  // them names a commit that is not the source the approval covered.
  const artifactRoots = new Set();
  for (const ph of ["DEVELOPMENT", "TESTING"]) {
    for (const rel of Object.keys(state.phases?.[ph]?.mechanical?.artifacts || {})) {
      artifactRoots.add(String(rel).split("\\").join("/"));
    }
  }
  const untrackedUnder = untracked
    .map((l) => l.slice(3).split("\\").join("/").replace(/^\.\//, ""))
    .filter((f) => [...artifactRoots].some((r) => f === r || f.startsWith(r + "/")));
  if (untrackedUnder.length) {
    console.error("REFUSED: " + untrackedUnder.length + " untracked file(s) under an approved source/test/spec artifact.\n");
    for (const f of untrackedUnder.slice(0, 20)) console.error("  ?? " + f);
    if (untrackedUnder.length > 20) console.error("  ... and " + (untrackedUnder.length - 20) + " more");
    die("\nThe recorded approval can cover code that is not in HEAD. Commit or remove those files first.", 1);
  }

  // --- the gates that a release actually depends on. ------------------------
  // RELEASE_CLEARED, not CLEARED: an INHERITED_UNVERIFIED phase lets work
  // continue on a brownfield repo, and a release is not work continuing - it is
  // a claim that the gates stood. `sign` is where the claim gets a name.
  const need = ["DEVELOPMENT", "TESTING"];
  const bad = need.filter((p) => !lc.RELEASE_CLEARED.has(derived[p].status));
  if (bad.length) {
    console.error(`REFUSED: ${version} cannot be cut.\n`);
    for (const p of bad) {
      console.error(`  ${p} is ${derived[p].status}`);
      for (const r of derived[p].reasons) console.error(`      ${r}`);
    }
    console.error(`\nA release is the phase 4-5 loop closing once more, not a step past it. If a`);
    console.error(`feature landed since the last release, DEVELOPMENT went STALE by design and`);
    console.error(`wants re-reviewing — that is the gate doing its job, not an obstacle.`);
    console.error(`\n  node .cursor/tools/lifecycle.mjs status`);
    die(``, 1);
  }

  // --- and they have to be cleared in the right ORDER. ----------------------
  //
  // Approving DEVELOPMENT again for release 2 does not touch TESTING: the test
  // suite's directory listing did not change, so its hashes still match and it
  // stays APPROVED. Which means a feature can ship with no test at all, past a
  // testing gate that was signed weeks ago against different code. A phase-level
  // hash cannot see that; two timestamps can. If the tests were approved before
  // the code they are meant to test, they were approved against something else.
  const devAt = state.phases?.DEVELOPMENT?.human?.at, tstAt = state.phases?.TESTING?.human?.at;
  if (devAt && tstAt && Date.parse(tstAt) < Date.parse(devAt)) {
    console.error(`REFUSED: ${version} cannot be cut.\n`);
    const when = (t) => t.slice(0, 19).replace("T", " ") + " UTC";
    console.error(`  DEVELOPMENT was approved ${when(devAt)}`);
    console.error(`  TESTING     was approved ${when(tstAt)} — earlier.`);
    console.error(`\nThe test suite was signed off against code that has since been re-approved.`);
    console.error(`Both gates are green and the pair of them is still wrong. Re-review TESTING:`);
    console.error(`\n  node .cursor/tools/ac-trace.mjs check`);
    console.error(`  node .cursor/tools/lifecycle.mjs record-gate TESTING --verdict GO --by "product-manager"`);
    console.error(`  node .cursor/tools/lifecycle.mjs approve TESTING --by "<name>"`);
    die(``, 1);
  }

  const prev = allRecords().pop() || null;
  const cm = commits(prev?.head);
  const fs_ = featureSpecs(prev?.head);
  const shortstat = prev?.head ? git("diff", "--shortstat", `${prev.head}..HEAD`) : null;

  const phaseEvidence = {};
  for (const p of lc.PHASES) {
    const ph = state.phases?.[p] || {};
    phaseEvidence[p] = {
      status: derived[p].status,
      reasons: derived[p].reasons,
      judgement: ph.judgement ? { verdict: ph.judgement.verdict, by: ph.judgement.by, at: ph.judgement.at, gateVersion: ph.judgement.gateVersion, criteria: ph.judgement.criteria || "", attempt: ph.judgement.attempt || 1 } : null,
      human: ph.human ? { by: ph.human.by, at: ph.human.at } : null,
      inherited: ph.inherited
        ? (typeof ph.inherited === "object" ? { by: ph.inherited.by || null, reviewBy: ph.inherited.reviewBy || null, legacy: !!ph.inherited.legacy } : { legacy: true })
        : null,
    };
  }

  const g = lc.governance();
  const record = {
    version,
    product: state.product,
    at: new Date().toISOString(),
    head,
    branch: git("rev-parse", "--abbrev-ref", "HEAD"),
    previous: prev ? { version: prev.version, head: prev.head, at: prev.at } : null,
    contents: {
      commitCount: cm.count,
      commits: cm.list,
      truncated: cm.truncated,
      rangeNote: cm.why,
      featureSpecs: fs_.specs,
      featureSpecsNote: fs_.why,
      shortstat: shortstat || null,
      untrackedAtCut: untracked.length,
    },
    lifecycle: { phase: state.phase, mode: state.mode, phases: phaseEvidence },
    governance: {
      money: g.money.length > 0, pii: g.pii.length > 0, auth: g.auth.length > 0,
      regimes: [...g.regimes.keys()].sort(),
      derivedFrom: g.read,
    },
    owed: {
      activeOverrides: activeOverrides(state, lc.PHASES),
      openChangeRequests: openChangeRequests(),
    },
    checks: [
      ranCheck("ac-trace.mjs", ["check"]),
      // Flat AC coverage and risk-weighted depth are different claims, and a
      // release record that carries only the first one overstates what was
      // proved. Recording both is how "it was 100% covered" stops being the
      // whole answer six months later.
      ranCheck("risk-profile.mjs", ["check"]),
      // What the system does when something it does not control fails. A release
      // record that says the tests passed and nothing about the payment gateway
      // answers the easy question and skips the one incidents are made of.
      ranCheck("failure-modes.mjs", ["check"]),
      ranCheck("fitness.mjs", ["check"]),
      ranCheck("incidents.mjs", ["check"]),
      ranCheck("flag-debt.mjs", ["scan"]),
      ranCheck("lifecycle.mjs", ["check", "TESTING"]),
    ],
    note: valueOf(args, "--note") || "",
    cutBy: actor(ROOT),
    signature: null,
  };

  // A FAILed check used to be a line in the record and nothing more - the cut
  // went through, and whoever signed had to notice a word in a list. A failure
  // is a refusal; a person who proceeds anyway does it by naming the tool, and
  // the record says they did.
  const acceptChecks = args.reduce((acc, a, i) => (a === "--accept-check" ? [...acc, args[i + 1]] : acc), []);
  const failed = record.checks.filter((c) => !c.ok);
  for (const c of failed) if (acceptChecks.includes(c.tool)) c.accepted = true;
  const unaccepted = failed.filter((c) => !c.accepted);
  if (unaccepted.length) {
    console.error(`REFUSED: ${version} cannot be cut - ${unaccepted.length} check(s) FAILED.\n`);
    for (const c of unaccepted) console.error(`  FAIL  ${c.tool}${c.summary ? `  - ${c.summary}` : ""}`);
    console.error(`\nA release record is what shipped and what proved it. Cutting one over a failing`);
    console.error(`check records that nothing proved it. Fix the finding, or accept it by name -`);
    console.error(`the record will say which tool, and whose decision:\n`);
    console.error(`  node .cursor/tools/release-evidence.mjs cut --version ${version} ${unaccepted.map((c) => `--accept-check ${c.tool}`).join(" ")}`);
    die(``, 1);
  }
  const unused = acceptChecks.filter((t) => !failed.some((c) => c.tool === t));
  if (unused.length) console.error(`NOTE  --accept-check named ${unused.join(", ")}, which did not fail. Not recorded as accepted.\n`);
  record.acceptedChecks = failed.filter((c) => c.accepted).map((c) => c.tool);
  record.integrity = integrityOf(record);

  commitRelease(rel(fileFor(version)), record, "release-cut", { version, head, acceptedChecks: record.acceptedChecks });

  console.log(`Release ${version} cut.`);
  console.log(`  ${rel(fileFor(version))}`);
  console.log(`  ${record.contents.commitCount} commit(s), ${record.contents.featureSpecs.length} feature spec(s), at ${head.slice(0, 10)}`);
  for (const c of record.checks) console.log(`  ${c.ran ? (c.skipped ? "----" : c.ok ? "PASS" : "FAIL (accepted by name)") : "----"}  ${c.tool}${c.ran ? (c.skipped && c.summary ? `  (${c.summary})` : "") : ` (${c.why})`}`);
  if (record.acceptedChecks.length) console.log(`\n  ${record.acceptedChecks.length} failing check(s) accepted at cut time: ${record.acceptedChecks.join(", ")}. The signer will see this.`);
  if (record.owed.activeOverrides.length) {
    console.log(`\n  ${record.owed.activeOverrides.length} active override(s) — this release ships under them:`);
    for (const o of record.owed.activeOverrides) console.log(`    ${o.id}  ${o.phase}  risk ${o.risk}  expires ${String(o.expiresAt).slice(0, 10)}  (${o.by})`);
  }
  if (record.owed.openChangeRequests.length) console.log(`  ${record.owed.openChangeRequests.length} open change request(s) recorded.`);
  console.log(`\nCommit this file. The hash inside it catches an accidental edit; git history is`);
  console.log(`what makes it evidence.`);
  console.log(`\nNext: node .cursor/tools/release-evidence.mjs sign ${version} --by "<name>"`);
}

async function cmdSign(args) {
  const version = args.find((a) => VERSION_RE.test(a));
  if (!version) die(`sign needs a version: sign v1.2.0 --by "name"`, 2);
  const by = valueOf(args, "--by");
  if (!by) die(`sign needs --by "<name>" — an unsigned release record says what shipped but\nnot who allowed it, which is the half that matters afterwards.`, 2);

  const record = readRecord(version);
  if (!record) die(`No record for ${version}. Cut it first.`, 1);
  if (record.signature) die(`${version} was already signed by ${record.signature.by} on ${String(record.signature.at).slice(0, 10)}.\nA second signature would overwrite the first. If something changed, cut a new version.`, 1);
  if (integrityOf(record) !== record.integrity) die(`REFUSED: ${rel(fileFor(version))} does not match its own hash. It was edited\nafter it was cut. Do not sign it — find out what changed (git log -p on that file).`, 1);

  // The record's own hash says this file is intact. The chain says whether the
  // set of records it sits among is - a deleted override, a replaced verdict, a
  // state.json nobody's command wrote. No flag accepts a broken chain: it is not
  // a risk about this release, it is doubt about every record a signature cites.
  const ch = verifyChain(ROOT);
  if (!ch.ok) {
    console.error(`REFUSED: the evidence chain (lifecycle/index.jsonl) does not verify.\n`);
    console.error(formatChainFindings(ch));
    console.error(`\nFind out what changed. If it is acceptable, a human reseals the chain by name:`);
    console.error(`  node .cursor/tools/lifecycle.mjs evidence reseal --by "<name>" --reason "..."`);
    die(``, 1);
  }

  const { lc, state, derived } = await lifecycle();
  const bad = ["DEVELOPMENT", "TESTING", "PRODUCTION"].filter((p) => !lc.RELEASE_CLEARED.has(derived[p].status));
  if (bad.length) {
    console.error(`REFUSED: ${version} cannot be signed.\n`);
    for (const p of bad) { console.error(`  ${p} is ${derived[p].status}`); for (const r of derived[p].reasons) console.error(`      ${r}`); }
    die(`\nCutting a record is bookkeeping; signing it is authorisation. All three of the\ngates a release rests on have to be standing at the moment you sign.`, 1);
  }

  // A release also rests on phases 1-3. On a brownfield repo those may be
  // INHERITED_UNVERIFIED: somebody typed that they happened and nobody has put a
  // name to checking it. The signer can be that name - by saying which phases.
  const unverified = lc.PHASES.filter((p) => derived[p].status === "INHERITED_UNVERIFIED");
  const acceptedInherited = args.reduce((acc, a, i) => (a === "--accept-inherited" ? [...acc, String(args[i + 1] || "").toUpperCase()] : acc), []);
  const unaccepted = unverified.filter((p) => !acceptedInherited.includes(p));
  if (unaccepted.length) {
    console.error(`REFUSED: ${version} rests on ${unverified.length} phase(s) that are INHERITED_UNVERIFIED.\n`);
    for (const p of unaccepted) console.error(`  ${p}  ${derived[p].reasons[0] || ""}`);
    console.error(`\nThey were recorded as done-before-adoption with nobody named as having checked`);
    console.error(`that. Signing a release on top of them is accepting that claim. Do it by name:\n`);
    console.error(`  node .cursor/tools/release-evidence.mjs sign ${version} --by "${by}" ${unaccepted.map((p) => `--accept-inherited ${p}`).join(" ")}`);
    die(``, 1);
  }

  // Shipping under an override must be said out loud, by name.
  const ovs = activeOverrides(state, lc.PHASES);
  if (ovs.length) {
    const accepted = args.reduce((acc, a, i) => (a === "--accept-override" ? [...acc, args[i + 1]] : acc), []);
    const unaccepted = ovs.filter((o) => !accepted.includes(o.id));
    if (unaccepted.length) {
      console.error(`REFUSED: ${version} ships under ${ovs.length} active override(s) you have not named.\n`);
      for (const o of unaccepted) {
        console.error(`  ${o.id}  ${o.phase}  risk ${o.risk}  expires ${String(o.expiresAt).slice(0, 10)}`);
        console.error(`      granted by ${o.by}: ${o.reason}`);
      }
      console.error(`\nName each one you are accepting. A signature that did not have to mention the`);
      console.error(`bypass is how a temporary bypass becomes permanent:\n`);
      console.error(`  node .cursor/tools/release-evidence.mjs sign ${version} --by "${by}" ${unaccepted.map((o) => `--accept-override ${o.id}`).join(" ")}`);
      die(``, 1);
    }
  }

  const who = actor(ROOT);
  const w = actorWarning(by, who);
  if (w) console.error(w + "\n");

  record.signature = {
    by, at: new Date().toISOString(),
    note: valueOf(args, "--note") || "",
    acceptedOverrides: ovs.map((o) => o.id),
    acceptedInherited: unverified,
    recordedBy: who,
    integrityAtSigning: record.integrity,
  };
  commitRelease(rel(fileFor(version)), record, "release-signed", { version, by });
  console.log(`${version} signed by ${by}.`);
  if (record.acceptedChecks?.length) console.log(`This record was cut over ${record.acceptedChecks.length} failing check(s) accepted by name: ${record.acceptedChecks.join(", ")}. Your signature covers that decision too.`);
  if (ovs.length) console.log(`Accepted ${ovs.length} override(s): ${ovs.map((o) => o.id).join(", ")} — each expires, and the expiry is now on your name.`);
  if (unverified.length) console.log(`Accepted ${unverified.length} unverified inherited phase(s): ${unverified.join(", ")} — the claim that they happened now has your name on it.`);
  console.log(`\nCommit ${rel(fileFor(version))}.`);
}

function cmdList() {
  const recs = allRecords();
  if (!recs.length) return console.log(`No release records yet. ${rel(REL_DIR())} is empty.`);
  console.log(`${recs.length} release(s)\n`);
  for (const r of recs) {
    const sig = r.signature ? `signed by ${r.signature.by}` : "UNSIGNED";
    const ok = integrityOf(r) === r.integrity ? "" : "  [HASH MISMATCH]";
    console.log(`  ${String(r.version).padEnd(14)} ${String(r.at).slice(0, 10)}  ${String(r.head || "").slice(0, 8)}  ${String(r.contents?.commitCount ?? "?").toString().padStart(4)} commits  ${sig}${ok}`);
    // At cut time and at signing time are different moments, and an override
    // granted between them is exactly the one worth surfacing.
    const ids = [...new Set([...(r.owed?.activeOverrides || []).map((o) => o.id), ...(r.signature?.acceptedOverrides || [])])];
    if (ids.length) console.log(`  ${" ".repeat(14)} shipped under ${ids.join(", ")}`);
  }
}

function cmdShow(args) {
  const version = args.find((a) => VERSION_RE.test(a));
  if (!version) die(`show needs a version.`, 2);
  const r = readRecord(version);
  if (!r) die(`No record for ${version}.`, 1);
  if (args.includes("--json")) return console.log(JSON.stringify(r, null, 2));
  console.log(renderMarkdown(r));
}

function cmdVerify(args) {
  const one = args.find((a) => VERSION_RE.test(a));
  const recs = one ? [readRecord(one)].filter(Boolean) : allRecords();
  if (!recs.length) die(one ? `No record for ${one}.` : `No release records to verify.`, 1);
  // Two different questions, and conflating them trains people to ignore the
  // answer. Integrity is a defect: the record has been edited, or names a commit
  // this repository does not have. Being unsigned is a STATE — a record cut five
  // minutes ago is legitimately unsigned, and failing CI for it is a false alarm.
  // `--require-signed` is for the pipeline that ships, where it is a defect.
  const requireSigned = args.includes("--require-signed");
  let bad = 0, unsigned = 0;
  for (const r of recs) {
    const problems = [];
    if (integrityOf(r) !== r.integrity) problems.push("content does not match its hash — the file was edited after it was cut");
    if (r.head && git("cat-file", "-e", `${r.head}^{commit}`) === null) problems.push(`commit ${String(r.head).slice(0, 10)} is not in this repository — history was rewritten, or this record came from elsewhere`);
    if (r.signature && r.signature.integrityAtSigning && r.signature.integrityAtSigning !== r.integrity) problems.push("content changed after it was signed");
    if (!r.signature && requireSigned) problems.push("never signed");
    if (problems.length) { bad++; console.log(`FAIL  ${r.version}`); for (const p of problems) console.log(`      ${p}`); }
    else if (!r.signature) { unsigned++; console.log(`WARN  ${r.version}  intact, but nobody has signed it`); }
    else console.log(`OK    ${r.version}  signed by ${r.signature.by} on ${String(r.signature.at).slice(0, 10)}`);
  }
  console.log("");
  console.log(bad ? `${bad} of ${recs.length} record(s) do not stand up.` : `All ${recs.length} record(s) intact.`);
  if (unsigned) console.log(`${unsigned} unsigned. A record nobody signed says what shipped but not who allowed it.`);
  if (bad) process.exit(1);
}

function cmdBundle(args) {
  const sub = args[0];
  if (sub === "export") {
    const oi = args.indexOf("--out");
    const outPath = oi >= 0 ? args[oi + 1] : join(ROOT, "lifecycle", "bundles", `bundle-${(git("rev-parse", "--short", "HEAD") || "local")}.json`);
    const integPath = join(ROOT, "lifecycle", "integrity.json");
    let integrity = null;
    if (existsSync(integPath)) {
      try { integrity = JSON.parse(readFileSync(integPath, "utf8")); } catch { integrity = { unreadable: true }; }
    }
    let policyVersion = null;
    try { policyVersion = JSON.parse(readFileSync(join(ROOT, ".cursor", "lifecycle", "write-policy.json"), "utf8")).version ?? null; } catch { /* none */ }
    const observed = {};
    for (const p of Object.keys(integrity?.files || {})) {
      if (!existsSync(join(ROOT, p))) continue;
      observed[p] = createHash("sha256").update(readFileSync(join(ROOT, p))).digest("hex");
    }
    const record = {
      kind: "cursor-platform/verification-bundle@1",
      commit: git("rev-parse", "HEAD"),
      dirty: !!git("status", "--porcelain"),
      policyVersion,
      integrity: integrity ? { by: integrity.by, writtenAt: integrity.writtenAt, files: integrity.files || {} } : null,
      observed,
      findings: { skipped: true, why: "bundle export does not re-run checkers; it freezes the evidence pointers" },
      limitations: [
        "does not include ignored cache files",
        "does not include application source",
        "bundle integrity is not the same as trust in the producer",
      ],
      reproduce: ["node tests/run.mjs", "node .cursor/tools/self-audit.mjs run", "node .cursor/tools/self-audit.mjs integrity"],
      at: new Date().toISOString(),
    };
    if (args.includes("--redact")) {
      record.findings = { skipped: true, why: "redacted" };
      record.integrity = record.integrity ? { by: record.integrity.by, writtenAt: record.integrity.writtenAt, files: {} } : null;
      record.observed = {};
    }
    const copy = { ...record };
    const h = createHash("sha256").update(canonical(copy)).digest("hex");
    record.bundleHash = h;
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n");
    console.log(`wrote ${rel(outPath)}`);
    console.log(`bundleHash ${h}`);
    return;
  }
  if (sub === "verify") {
    const fi = args.indexOf("--file");
    const file = fi >= 0 ? args[fi + 1] : args.find((a) => a.endsWith(".json") && a !== "verify");
    if (!file || !existsSync(file)) die("bundle verify --file <path>", 2);
    let rec;
    try { rec = JSON.parse(readFileSync(file, "utf8")); }
    catch (e) { die(`cannot read bundle: ${e.message}`, 1); }
    const claimed = rec.bundleHash;
    const copy = { ...rec };
    delete copy.bundleHash;
    const got = createHash("sha256").update(canonical(copy)).digest("hex");
    if (claimed !== got) die(`bundleHash mismatch (file was edited). claimed ${claimed} got ${got}`, 1);
    let fileBad = 0;
    for (const [p, expect] of Object.entries(rec.observed || rec.integrity?.files || {})) {
      if (!existsSync(join(ROOT, p))) continue;
      const actual = createHash("sha256").update(readFileSync(join(ROOT, p))).digest("hex");
      if (actual !== expect) {
        fileBad++;
        console.log(`CHANGED  ${p}`);
      }
    }
    if (fileBad) die(`${fileBad} attested file(s) differ from the bundle.`, 1);
    console.log(`OK  bundle intact (${claimed.slice(0, 12)}…)`);
    return;
  }
  die(`bundle export --out <file> | bundle verify --file <file>`, 2);
}

/* ------------------------------------------------------------------ render */

function renderMarkdown(r) {
  const L = [];
  const yn = (b) => (b ? "yes" : "no");
  L.push(`# Release ${r.version} — ${r.product}`, "");
  L.push(`**Cut:** ${r.at}    **Commit:** \`${r.head}\` on \`${r.branch}\``);
  L.push(r.signature ? `**Signed:** ${r.signature.by}, ${r.signature.at}` : `**Signed:** NOT SIGNED`);
  L.push(r.previous ? `**Previous:** ${r.previous.version} (\`${String(r.previous.head).slice(0, 10)}\`)` : `**Previous:** none — first release`);
  L.push("", "## Contents", "");
  L.push(`${r.contents.commitCount} commit(s)${r.contents.shortstat ? `, ${r.contents.shortstat.trim()}` : ""}${r.contents.truncated ? " (list truncated)" : ""}`);
  if (r.contents.rangeNote) L.push(`> ${r.contents.rangeNote}`);
  if (r.contents.featureSpecs.length) {
    L.push("", "Feature specs:", "");
    for (const f of r.contents.featureSpecs) L.push(`- \`${f}\``);
  } else L.push("", `No feature specs${r.contents.featureSpecsNote ? ` — ${r.contents.featureSpecsNote}` : ""}.`);
  L.push("", "## Gates it rests on", "", "| Phase | Status | Judged | Approved |", "|---|---|---|---|");
  for (const [p, e] of Object.entries(r.lifecycle.phases)) {
    L.push(`| ${p} | ${e.status} | ${e.judgement ? `${e.judgement.verdict} by ${e.judgement.by} (${String(e.judgement.at).slice(0, 10)})` : "—"} | ${e.human ? `${e.human.by} (${String(e.human.at).slice(0, 10)})` : "—"} |`);
  }
  L.push("", "## Governance", "");
  L.push(`money: ${yn(r.governance.money)} · PII: ${yn(r.governance.pii)} · auth: ${yn(r.governance.auth)}`);
  L.push(r.governance.regimes.length
    ? `Regimes named in the requirement documents: ${r.governance.regimes.join(", ")}`
    : `No regime named in the requirement documents.`);
  L.push("", `> Named, not adjudicated. A regime appears here because the documents discuss`,
             `> it — including to rule it out. \`docs/product/nfr.md\` is where which ones`,
             `> actually apply is decided.`);
  L.push("", "## Checks at cut time", "", "| Check | Result | Last line |", "|---|---|---|");
  for (const c of r.checks) L.push(`| \`${c.tool}\` | ${c.ran ? (c.skipped ? "skipped" : c.ok ? "PASS" : c.accepted ? "FAIL (accepted by name)" : "FAIL") : "not run"} | ${(c.summary || c.why || "").replace(/\|/g, "\\|")} |`);
  const ovs = r.owed.activeOverrides, crs = r.owed.openChangeRequests;
  const late = (r.signature?.acceptedOverrides || []).filter((id) => !ovs.some((o) => o.id === id));
  L.push("", "## Still owed", "");
  if (!ovs.length && !crs.length && !late.length) L.push("Nothing outstanding at cut time.");
  for (const id of late) L.push(`- **Override ${id}** — granted between the cut and the signature, and accepted by ${r.signature.by}`);
  for (const o of ovs) L.push(`- **Override ${o.id}** (${o.phase}, risk ${o.risk}, expires ${String(o.expiresAt).slice(0, 10)}) — ${o.reason} — granted by ${o.by}`);
  for (const c of crs) L.push(`- **${c.id}** open — ${c.reason}${c.by ? ` (${c.by})` : ""}`);
  if (r.note) L.push("", "## Note", "", r.note);
  L.push("", "---", "", `Integrity \`${r.integrity}\`. Recompute with \`release-evidence.mjs verify ${r.version}\`.`,
    `The hash catches an edit; git history is what makes this evidence.`);
  return L.join("\n");
}

/* ---------------------------------------------------------------------- main */

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case "cut": await cmdCut(args); break;
  case "sign": await cmdSign(args); break;
  case "list": cmdList(); break;
  case "show": cmdShow(args); break;
  case "verify": cmdVerify(args); break;
  case "bundle": cmdBundle(args); break;
  default:
    console.error(`release-evidence.mjs — what shipped, what proved it, and who said so

  cut --version v1.2.0 [--note "..."]     derive and file the record. Refuses on a
      [--accept-check <tool.mjs>]         dirty tree, an uncleared DEV/TEST gate, or a
                                          FAILED check nobody accepted by name.
  sign v1.2.0 --by "name"                 the human authorisation. Refuses while any
       [--accept-override OV-XXXX]        gate is uncleared, an override is unnamed,
       [--accept-inherited PHASE]         or the evidence chain does not verify.
  list                                    every release, newest last
  show v1.2.0 [--json]                    the record, as markdown or raw
  verify [v1.2.0] [--require-signed]      hash and commit still stand up. An unsigned
                                          record warns; --require-signed fails on it.
  bundle export --out <file>              portable evidence pack another checkout can
                                          validate without ignored caches or source.
  bundle verify --file <file>             detect an edited bundle or changed attested files.

Records live in lifecycle/releases/ and are meant to be committed.`);
    process.exit(2);
}
