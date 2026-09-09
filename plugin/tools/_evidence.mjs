/**
 * _evidence.mjs - the hash chain over every record the lifecycle writes.
 *
 * Every other record under lifecycle/ answers a question on its own: a verdict,
 * an approval, an override, a release, an incident, a change request. None of
 * them could answer "is this the set of records that was written, in the order
 * it was written?" - a file could be deleted, replaced, or added by hand and
 * nothing would say so, because each record only vouches for itself.
 *
 * lifecycle/index.jsonl is the answer. It is append-only. Each line names one
 * record (path + sha256 of its bytes) and carries the hash of the previous line,
 * so removing a line, editing a line, or reordering two breaks the link that the
 * next line asserts. Editing a RECORD without touching the index shows up as the
 * on-disk hash disagreeing with the last entry that named it.
 *
 *   { seq, at, kind, ref, hash, meta, prev, entry }
 *
 *   ref   repo-relative path of the record, or "lifecycle/state.json"
 *   hash  sha256 of the file as written
 *   prev  the `entry` of the line before it; null on the first line
 *   entry sha256 of the canonical form of this line without `entry`
 *
 * The first append on a repo that already has records ADOPTS them: one entry per
 * existing file, so that from then on a record the index does not know about is
 * a finding rather than history. That makes the chain honest about its own
 * start - it does not claim to know what happened before it existed.
 *
 * What this does NOT do: prove who wrote a line. It is tamper-EVIDENT, not
 * tamper-proof; the guards refuse the agent's writes to lifecycle/, git carries
 * the file, and a person who rewrites both has left a commit. The chain's job is
 * to make the rewrite something that has to be done, rather than something that
 * can happen by accident or by one tool disagreeing with another.
 *
 * Repair is `lifecycle.mjs evidence reseal --by <name> --reason "..."`: the
 * current index is archived beside itself, untouched, and a new one starts with
 * a line that names the person, the reason and the archive. It is human-only.
 */

import { readFileSync, existsSync, appendFileSync, readdirSync, statSync, renameSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { lock, canonical, actor, writeJsonAtomic } from "./_state.mjs";

export const INDEX_REL = "lifecycle/index.jsonl";

/** Directories whose every *.json file is a record the chain must know about. */
export const RECORD_DIRS = ["lifecycle/evidence", "lifecycle/overrides", "lifecycle/releases", "lifecycle/incidents", "lifecycle/changes"];
export const RECORD_FILES = ["lifecycle/state.json"];

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const toPosix = (p) => p.split("\\").join("/");
const entryHash = (e) => { const { entry, ...rest } = e; return sha(canonical(rest)); };

export function indexPath(root) { return join(root, ...INDEX_REL.split("/")); }

export function hashFile(root, rel) {
  const abs = join(root, ...rel.split("/"));
  if (!existsSync(abs)) return null;
  return sha(readFileSync(abs));
}

/* ------------------------------------------------------------------ reading */

export function readChain(root) {
  const p = indexPath(root);
  if (!existsSync(p)) return { exists: false, entries: [], unparseable: [] };
  const entries = [], unparseable = [];
  const lines = readFileSync(p, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    try { entries.push(JSON.parse(line)); }
    catch (e) { unparseable.push({ line: i + 1, error: e.message }); }
  });
  return { exists: true, entries, unparseable };
}

/** Every record file on disk that the chain is expected to name. */
export function recordFilesOnDisk(root) {
  const out = [];
  for (const rel of RECORD_FILES) if (existsSync(join(root, ...rel.split("/")))) out.push(rel);
  for (const dir of RECORD_DIRS) {
    const abs = join(root, ...dir.split("/"));
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs).sort()) {
      if (!f.endsWith(".json") || f.startsWith(".")) continue;
      try { if (statSync(join(abs, f)).isFile()) out.push(`${dir}/${f}`); } catch { /* raced */ }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ writing */

function appendLocked(root, drafts) {
  const p = indexPath(root);
  mkdirSync(join(root, "lifecycle"), { recursive: true });
  const { release } = lock(p);
  try {
    const { entries } = readChain(root);
    let last = entries.length ? entries[entries.length - 1] : null;
    const written = [];
    let text = "";
    for (const d of drafts) {
      const e = { seq: last ? (Number(last.seq) || 0) + 1 : 1, at: new Date().toISOString(), ...d, prev: last ? last.entry : null };
      e.entry = entryHash(e);
      text += JSON.stringify(e) + "\n";
      written.push(e);
      last = e;
    }
    appendFileSync(p, text, "utf8");
    return written;
  } finally {
    release();
  }
}

/**
 * Add one entry. On the very first append, every record that already exists is
 * adopted first, so the chain's first line is where the chain's knowledge
 * starts and not a claim about what came before.
 */
export function appendEntry(root, { kind, ref, hash, meta }) {
  const drafts = [];
  const { exists } = readChain(root);
  if (!exists) {
    for (const rel of recordFilesOnDisk(root)) {
      if (rel === ref) continue; // the record being indexed now is named by its own entry
      drafts.push({ kind: "adopted", ref: rel, hash: hashFile(root, rel), meta: { note: "existed before the chain started" } });
    }
  }
  drafts.push({ kind, ref: toPosix(ref), hash, meta: meta || {} });
  const written = appendLocked(root, drafts);
  return written[written.length - 1];
}

/** Hash a record that was just written and add it to the chain. */
export function recordFile(root, rel, kind, meta) {
  rel = toPosix(rel);
  const hash = hashFile(root, rel);
  if (hash === null) throw new Error(`${rel} was not written; nothing to index.`);
  return appendEntry(root, { kind, ref: rel, hash, meta });
}

/**
 * Replace an existing chained record, or write a new one, under the file lock.
 * The on-disk bytes must still be what the chain last indexed; a normal mutation
 * must not absorb a rewrite that happened outside the writer.
 */
export function commitIndexedRecord(root, rel, obj, { kind, meta } = {}) {
  rel = toPosix(rel);
  const abs = join(root, ...rel.split("/"));
  const { release } = lock(abs);
  try {
    assertIndexedUnchanged(root, rel);
    writeJsonAtomic(abs, obj);
    return recordFile(root, rel, kind, meta);
  } finally {
    release();
  }
}

/* ---------------------------------------------------------------- verifying */

/**
 * Walk the chain. Returns { exists, ok, entries, findings, latest } where every
 * finding has a code, a severity and one sentence, and `latest` maps each ref to
 * the last entry that named it.
 *
 *   LINK_BROKEN     prev does not equal the previous line's entry
 *   ENTRY_ALTERED   the line's own hash no longer matches its content
 *   SEQ_GAP         a sequence number was skipped or repeated
 *   UNPARSEABLE     a line is not JSON
 *   CHANGED         the record on disk is not what the chain last saw
 *   MISSING         the chain names a record that is no longer on disk
 *   UNINDEXED       a record is on disk that the chain never saw
 */
export function verifyChain(root) {
  const { exists, entries, unparseable } = readChain(root);
  const findings = [];
  const F = (code, message, extra = {}) => findings.push({ code, severity: "block", message, ...extra });
  if (!exists) return { exists: false, ok: true, entries: [], findings, latest: new Map(), archives: archives(root) };

  for (const u of unparseable) F("UNPARSEABLE", `line ${u.line} is not JSON: ${u.error}`, { line: u.line });

  let prev = null;
  entries.forEach((e, i) => {
    if (typeof e !== "object" || e === null) { F("UNPARSEABLE", `line ${i + 1} is not an entry`); return; }
    if (entryHash(e) !== e.entry) F("ENTRY_ALTERED", `entry ${e.seq} (${e.kind} ${e.ref}) was edited after it was written`, { seq: e.seq, ref: e.ref });
    const expectPrev = prev ? prev.entry : null;
    if (e.prev !== expectPrev) F("LINK_BROKEN", `entry ${e.seq} links to ${short(e.prev)} but the line before it is ${short(expectPrev)} - a line was removed, inserted or reordered`, { seq: e.seq, ref: e.ref });
    const expectSeq = prev ? (Number(prev.seq) || 0) + 1 : 1;
    if (e.seq !== expectSeq) F("SEQ_GAP", `entry ${e.seq} follows ${prev ? prev.seq : "nothing"}`, { seq: e.seq });
    prev = e;
  });

  const latest = new Map();
  for (const e of entries) if (e && e.ref) latest.set(e.ref, e);

  for (const [ref, e] of latest) {
    const onDisk = hashFile(root, ref);
    if (onDisk === null) F("MISSING", `${ref} is named by entry ${e.seq} and is no longer on disk`, { ref, seq: e.seq });
    else if (onDisk !== e.hash) F("CHANGED", `${ref} is not the content entry ${e.seq} recorded - it was edited after it was written`, { ref, seq: e.seq });
  }
  for (const rel of recordFilesOnDisk(root)) {
    if (!latest.has(rel)) F("UNINDEXED", `${rel} is on disk and the chain never saw it - added by hand, or by a tool that does not index`, { ref: rel });
  }

  return { exists: true, ok: !findings.length, entries, findings, latest, archives: archives(root) };
}

/**
 * A normal mutation must not absorb a pre-existing rewrite. If the chain
 * already names `rel`, the bytes on disk have to still be those bytes; if a
 * chain exists and `rel` is on disk but never indexed, same refusal. Called
 * under the record's lock, before the replacement is written.
 */
export function assertIndexedUnchanged(root, rel) {
  rel = toPosix(rel);
  const v = verifyChain(root);
  if (!v.exists) return;
  const e = v.latest.get(rel);
  const onDisk = hashFile(root, rel);
  if (!e) {
    if (onDisk !== null) {
      const err = new Error(`${rel} is on disk and the evidence chain never indexed it. A normal command must not absorb an unindexed record. A human reseals:\n  node .cursor/tools/lifecycle.mjs evidence reseal --by "<name>" --reason "..."`);
      err.code = "EUNINDEXED";
      throw err;
    }
    return;
  }
  if (onDisk !== null && onDisk !== e.hash) {
    const err = new Error(`${rel} was edited after the chain recorded it (CHANGED). A normal command must not absorb that change. Find out what changed; a human reseals:\n  node .cursor/tools/lifecycle.mjs evidence reseal --by "<name>" --reason "..."`);
    err.code = "ECHANGED";
    throw err;
  }
}

const short = (h) => (h ? String(h).slice(0, 12) : "null");

export function archives(root) {
  const dir = join(root, "lifecycle");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^index\.\d{8}T\d{6}Z\.jsonl$/.test(f)).sort().map((f) => `lifecycle/${f}`);
}

export function formatChainFindings(v, indent = "  ") {
  return v.findings.map((f) => `${indent}${f.code.padEnd(14)} ${f.message}`).join("\n");
}

/* ----------------------------------------------------------------- resealing */

/**
 * Archive the current index untouched and start a new one whose first line
 * names who accepted the break, why, and what they accepted. Human-only; the
 * bash guard refuses it from the agent's shell.
 */
export function reseal(root, { by, reason }) {
  if (!by) throw new Error("reseal needs --by <name>: a chain that resealed itself has recorded nothing.");
  if (!reason) throw new Error("reseal needs --reason: the archive says what broke, the reason says why that is acceptable.");
  const before = verifyChain(root);
  const p = indexPath(root);
  const { release } = lock(p);
  let archived = null;
  try {
    if (existsSync(p)) {
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
      archived = `lifecycle/index.${stamp}.jsonl`;
      renameSync(p, join(root, ...archived.split("/")));
    }
    const last = before.entries.length ? before.entries[before.entries.length - 1] : null;
    const genesis = {
      seq: 1, at: new Date().toISOString(), kind: "reseal", ref: archived || INDEX_REL, hash: archived ? hashFile(root, archived) : null,
      meta: { by, recordedBy: actor(root), reason, archived, archivedLastEntry: last ? last.entry : null, archivedEntries: before.entries.length,
              accepted: before.findings.map((f) => ({ code: f.code, ref: f.ref || null, seq: f.seq || null })) },
      prev: null,
    };
    genesis.entry = entryHash(genesis);
    writeFileSync(p, JSON.stringify(genesis) + "\n", "utf8");
  } finally {
    release();
  }
  // Adopt everything that exists now, under the new genesis.
  const drafts = recordFilesOnDisk(root).map((rel) => ({ kind: "adopted", ref: rel, hash: hashFile(root, rel), meta: { note: "adopted at reseal" } }));
  if (drafts.length) appendLocked(root, drafts);
  return { archived, accepted: before.findings.length, adopted: drafts.length };
}
