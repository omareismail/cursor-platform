/**
 * _project-txn.mjs — one journaled write over project/*.json.
 *
 * WHY THIS EXISTS
 *
 * Identity, delivery and ideas are three files. A command that updates two of
 * them used to `commitJson` each in turn. Kill the process after delivery.json
 * lands and before ideas.json, and the overlay disagrees with itself: a feature
 * binding with no idea, a current phase pointer with no matching status.
 *
 * Per-file `commitJson` is still the right primitive for a single record.
 * This module is the write-ahead journal that makes a *set* of those records
 * recover as one revision boundary.
 *
 *   1. Lock project/.txn.json (the same O_EXCL lock commitJson uses).
 *   2. Finish any journal already on disk (forward recovery).
 *   3. Compare-and-swap every file's revision.
 *   4. Fsync the intended next bodies to .txn.json.
 *   5. Write each file atomically.
 *   6. Delete the journal.
 *
 * A crash after step 4 completes the transaction on the next command; it does
 * not roll back. A crash before step 4 leaves the journal absent and the
 * previous files untouched. The journal is ephemeral and gitignored.
 */

import { existsSync, readFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { lock, readJsonRevisioned, writeJsonAtomic } from "./_state.mjs";

export const JOURNAL = ".txn.json";

export function journalPath(dir) {
  return join(dir, JOURNAL);
}

function crash(step) {
  const err = new Error(`injected crash after ${step}`);
  err.code = "ECRASH";
  throw err;
}

/**
 * Replay a leftover journal under an already-held lock. Missing journal is a
 * no-op. A journal whose on-disk files match neither the expected nor the
 * intended revision is corrupt: refuse rather than guess.
 */
export function recoverDocumentsUnlocked(dir) {
  const path = journalPath(dir);
  if (!existsSync(path)) return { recovered: false };
  let txn;
  try { txn = JSON.parse(readFileSync(path, "utf8")); }
  catch {
    const err = new Error("project/.txn.json is not valid JSON. Inspect project/*.json and delete the journal only if those files already agree.");
    err.code = "ECORRUPT";
    throw err;
  }
  if (!Array.isArray(txn.files) || !txn.files.length) {
    unlinkSync(path);
    return { recovered: false };
  }
  for (const f of txn.files) {
    if (!f?.name || !f.body || typeof f.body !== "object") {
      const err = new Error(`project/.txn.json names a malformed file entry. Restore project/ from version control.`);
      err.code = "ECORRUPT";
      throw err;
    }
    const target = join(dir, f.name);
    const expected = Number.isInteger(f.expectedRevision) ? f.expectedRevision : 0;
    const nextRev = Number.isInteger(f.nextRevision) ? f.nextRevision : expected + 1;
    let onDisk = { exists: false, revision: 0 };
    if (existsSync(target)) {
      try { onDisk = readJsonRevisioned(target); }
      catch {
        const err = new Error(`${f.name} is no longer valid JSON during transaction recovery. Restore it from version control; the journal was not applied.`);
        err.code = "ECORRUPT";
        throw err;
      }
    }
    if (onDisk.exists && onDisk.revision === nextRev) continue;
    if (!onDisk.exists || onDisk.revision === expected) {
      writeJsonAtomic(target, f.body);
      continue;
    }
    const err = new Error(`Incomplete project transaction: ${f.name} is at revision ${onDisk.revision}, expected ${expected} or ${nextRev}. Restore project/ from version control.`);
    err.code = "ECORRUPT";
    throw err;
  }
  unlinkSync(path);
  return { recovered: true };
}

export function recoverDocuments(dir, { onTakeover } = {}) {
  mkdirSync(dir, { recursive: true });
  const { release, tookOver } = lock(journalPath(dir));
  try {
    if (tookOver && onTakeover) onTakeover();
    return recoverDocumentsUnlocked(dir);
  } finally {
    release();
  }
}

/**
 * Write `docs` (filename → object) as one transaction. Each object's
 * `revision` is the revision the caller read. On success those objects are
 * mutated to the new revision, matching commitJson.
 *
 * `opts.crashAfter`: test hook. `"journal"` or a filename aborts after that
 * step with `ECRASH`, leaving the journal for the next recovery.
 */
export function commitDocuments(dir, docs, opts = {}) {
  mkdirSync(dir, { recursive: true });
  const { release, tookOver } = lock(journalPath(dir));
  try {
    if (tookOver && opts.onTakeover) opts.onTakeover();
    recoverDocumentsUnlocked(dir);
    const entries = [];
    for (const [name, obj] of Object.entries(docs)) {
      if (!obj || typeof obj !== "object") continue;
      const target = join(dir, name);
      const expected = Number.isInteger(obj.revision) ? obj.revision : 0;
      let onDisk = 0;
      if (existsSync(target)) {
        try { onDisk = readJsonRevisioned(target).revision; }
        catch {
          const err = new Error(`${target} is no longer valid JSON. Refusing to overwrite a record that cannot be read — repair or restore it first.`);
          err.code = "ECORRUPT";
          throw err;
        }
      }
      if (onDisk !== expected) {
        const err = new Error(`${name} changed underneath this command: it was read at revision ${expected} and is now at ${onDisk}. Another session wrote to it. Re-run so the decision is made against the current state.`);
        err.code = "ECONFLICT";
        err.expected = expected;
        err.actual = onDisk;
        throw err;
      }
      entries.push({
        name,
        expected,
        next: { ...obj, revision: expected + 1 },
      });
    }
    if (!entries.length) return { revision: {} };
    const txn = {
      schemaVersion: 1,
      at: new Date().toISOString(),
      pid: process.pid,
      files: entries.map((e) => ({
        name: e.name,
        expectedRevision: e.expected,
        nextRevision: e.next.revision,
        body: e.next,
      })),
    };
    writeJsonAtomic(journalPath(dir), txn);
    if (opts.crashAfter === "journal") crash("journal");
    for (const e of entries) {
      writeJsonAtomic(join(dir, e.name), e.next);
      if (opts.crashAfter === e.name) crash(e.name);
    }
    unlinkSync(journalPath(dir));
    for (const e of entries) docs[e.name].revision = e.next.revision;
    return { revision: Object.fromEntries(entries.map((e) => [e.name, e.next.revision])) };
  } finally {
    release();
  }
}
