/**
 * _state.mjs — how a lifecycle record reaches disk.
 *
 * WHY THIS EXISTS
 *
 * Seven tools write records under lifecycle/ and .cursor/cache/, and every one of
 * them did it the same way: `writeFileSync(path, JSON.stringify(obj))`. That is a
 * truncate followed by a write, and between the two the file is empty. A crash,
 * a killed terminal or a full disk in that window leaves `state.json` as zero
 * bytes - which readStateInfo() now reports as corrupt, which closes every gate.
 * The right outcome for a corrupt file, and the wrong way to get one.
 *
 * Two sessions on the same repo were the other hole. Each reads the state, each
 * decides, each writes; the second write silently discards the first decision -
 * a gate verdict, an approval - and neither party is told. Nothing in the file
 * said which version a writer had read.
 *
 * WHAT THIS DOES
 *
 *   writeJsonAtomic   write to a sibling temp file, fsync, rename over the target.
 *                     The target is either the old content or the new content;
 *                     there is no moment in between.
 *   commitJson        compare-and-swap on a `revision` counter. The caller hands
 *                     back the object it READ; if the file's revision has moved
 *                     since, the write is refused with both revisions named. A
 *                     lock file (O_EXCL) covers the compare and the write together,
 *                     because a compare that is not under the same lock as the
 *                     write is a race with a smaller window, not no race.
 *   nextSequentialId  max+1 over the ids already on disk, never count+1. Delete
 *                     CR-0002 and count+1 hands out CR-0003 twice.
 *   actor             who the OS and git say is at the keyboard. Recorded beside
 *                     `--by`, never instead of it: a mismatch is a warning the
 *                     signer can see, not a refusal - this is the first rung of
 *                     identity, and it is honest about being only that.
 *
 * No policy lives here. This file knows nothing about phases, gates or ids other
 * than their file names; it is the disk layer, and it is shared so that the seven
 * writers cannot drift apart in how safely they write.
 */

import { readFileSync, writeFileSync, renameSync, openSync, closeSync, fsyncSync, unlinkSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const sleep = (ms) => { const end = Date.now() + ms; while (Date.now() < end) { /* spin; the waits here are milliseconds */ } };

/** Serialise the way every record has always been serialised, so diffs stay quiet. */
export const serialise = (obj) => JSON.stringify(obj, null, 2) + "\n";

/**
 * A key-sorted serialisation for HASHING, not for writing. Mirrors JSON.stringify
 * in the two places it matters: an undefined property is dropped, an undefined
 * array element is null. Otherwise a record hashes differently before it is
 * written and after it is read back, and a tool refuses its own output.
 */
export function canonical(v) {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  return "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
}

/**
 * Write `text` to `path` so that a reader never sees a partial file.
 *
 * Windows will refuse a rename while another process (an editor, an indexer, an
 * antivirus) holds the target; retrying a handful of times over ~1s covers that
 * without hiding a real failure.
 */
export function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  let fd = null;
  try {
    fd = openSync(tmp, "w");
    writeFileSync(fd, text, "utf8");
    try { fsyncSync(fd); } catch { /* some filesystems refuse; the rename is still atomic */ }
    closeSync(fd); fd = null;
    let lastErr = null;
    for (let i = 0; i < 10; i++) {
      try { renameSync(tmp, path); lastErr = null; break; }
      catch (e) { lastErr = e; if (!/EPERM|EBUSY|EACCES/.test(String(e.code))) break; sleep(50 + i * 50); }
    }
    if (lastErr) throw lastErr;
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch { /* already closed */ } }
    if (existsSync(tmp)) { try { unlinkSync(tmp); } catch { /* best effort */ } }
  }
}

export function writeJsonAtomic(path, obj) { writeAtomic(path, serialise(obj)); }

/* ------------------------------------------------------------------- locking */

const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 3_000;

/**
 * Take `path`.lock exclusively. Returns a release function.
 *
 * A lock older than LOCK_STALE_MS is a crashed writer, not a live one - it is
 * removed and taken over, and the takeover is reported in the returned info so
 * a caller that cares can say so. A lock that stays contended for LOCK_WAIT_MS
 * throws: two writers genuinely at once is a thing to tell the user, not to
 * wait out silently.
 */
export function lock(path) {
  const lp = path + ".lock";
  mkdirSync(dirname(path), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  let tookOver = false;
  for (;;) {
    try {
      const fd = openSync(lp, "wx");
      writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), "utf8");
      closeSync(fd);
      return { release: () => { try { unlinkSync(lp); } catch { /* gone already */ } }, tookOver };
    } catch (e) {
      if (e.code === "EEXIST") {
        let age = 0;
        try { age = Date.now() - statSync(lp).mtimeMs; } catch { continue; /* released between the two calls */ }
        if (age > LOCK_STALE_MS) { try { unlinkSync(lp); tookOver = true; } catch { /* someone else did */ } continue; }
        if (Date.now() > deadline) {
          const err = new Error(`${lp} is held by another writer (for ${Math.round(age / 1000)}s). Two commands are changing this record at once; wait for the other to finish and re-run.`);
          err.code = "ELOCKED";
          throw err;
        }
        sleep(40);
        continue;
      }
      // Windows can surface a sharing violation as EPERM/EBUSY/EACCES while
      // another writer still has the lock handle, rather than EEXIST. Retry
      // those the same way as a live lock; a permanent ACL failure still
      // becomes ELOCKED after LOCK_WAIT_MS instead of an uncaught throw.
      if (e.code === "EPERM" || e.code === "EBUSY" || e.code === "EACCES") {
        if (Date.now() > deadline) {
          const err = new Error(`${lp} could not be taken (${e.code} after waiting). Two commands may be changing this record at once; wait for the other to finish and re-run.`);
          err.code = "ELOCKED";
          throw err;
        }
        sleep(40);
        continue;
      }
      throw e;
    }
  }
}

/* ------------------------------------------------------------ revision / CAS */

/** Read JSON with its revision. `revision` is 0 for a file written before this existed. */
export function readJsonRevisioned(path) {
  if (!existsSync(path)) return { exists: false, obj: null, revision: 0 };
  const obj = JSON.parse(readFileSync(path, "utf8"));
  return { exists: true, obj, revision: Number.isInteger(obj?.revision) ? obj.revision : 0 };
}

/**
 * Write `obj` to `path` only if the file's current revision is the one `obj`
 * was read at. On success `obj.revision` is incremented and written; on a
 * conflict nothing is written and an ECONFLICT error names both revisions.
 *
 * `obj.revision` is the revision the CALLER read - readStateInfo() stamps it,
 * migrate() defaults it to 0. That is what makes this a compare-and-swap rather
 * than a last-writer-wins with extra steps.
 */
export function commitJson(path, obj, { onTakeover, beforeWrite, afterWrite } = {}) {
  const expected = Number.isInteger(obj.revision) ? obj.revision : 0;
  const { release, tookOver } = lock(path);
  try {
    if (tookOver && onTakeover) onTakeover();
    let onDisk = 0;
    if (existsSync(path)) {
      try { onDisk = readJsonRevisioned(path).revision; }
      catch { onDisk = NaN; }
    }
    if (Number.isNaN(onDisk)) {
      const err = new Error(`${path} is no longer valid JSON. Refusing to overwrite a record that cannot be read - repair or restore it first.`);
      err.code = "ECORRUPT";
      throw err;
    }
    if (onDisk !== expected) {
      const err = new Error(`${basename(path)} changed underneath this command: it was read at revision ${expected} and is now at ${onDisk}. Another session wrote to it. Re-run so the decision is made against the current state.`);
      err.code = "ECONFLICT";
      err.expected = expected; err.actual = onDisk;
      throw err;
    }
    if (beforeWrite) beforeWrite();
    obj.revision = expected + 1;
    writeJsonAtomic(path, obj);
    if (afterWrite) afterWrite(obj);
    return obj.revision;
  } finally {
    release();
  }
}

/* ------------------------------------------------------------------------ ids */

/**
 * `PREFIX-0007` where 7 is one more than the largest number already used in
 * `dir`, whatever the count of files. Ids are never reused: a deleted record
 * leaves a gap, and a gap is information.
 */
export function nextSequentialId(dir, prefix, width = 4) {
  mkdirSync(dir, { recursive: true });
  const re = new RegExp(`^${prefix}-(\\d+)\\.json$`, "i");
  let max = 0;
  for (const f of readdirSync(dir)) {
    const m = f.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(width, "0")}`;
}

/* ---------------------------------------------------------------------- actor */

/**
 * Who the environment says is here. Two sources because they fail differently:
 * the OS account is always set and rarely meaningful on a shared runner; the git
 * identity is meaningful and often unset. Both are recorded, neither is trusted
 * - `--by` stays the name that carries responsibility; this is the context it
 * was given in.
 */
export function actor(cwd) {
  const os = process.env.USER || process.env.USERNAME || process.env.LOGNAME || null;
  let git = null, email = null;
  try { git = execFileSync("git", ["config", "user.name"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null; } catch { /* no git, or unset */ }
  try { email = execFileSync("git", ["config", "user.email"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null; } catch { /* unset */ }
  const ci = process.env.GITHUB_ACTOR || process.env.GITLAB_USER_LOGIN || process.env.BUILD_REQUESTEDFOR || null;
  return { os, git, email, ci, host: process.env.COMPUTERNAME || process.env.HOSTNAME || null };
}

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Does `by` look like any name the environment knows? Null when there is nothing
 * to compare against (no git identity, no OS user) - "unknown" is not "mismatch".
 * A first name matching a full git name counts: "Sara" against "Sara Al-Amri" is
 * not the case this exists to catch. "sara" against "ops-bot" is.
 */
export function actorMatches(by, a) {
  const b = norm(by);
  if (!b) return null;
  const known = [a.os, a.git, a.ci, a.email && a.email.split("@")[0]].map(norm).filter(Boolean);
  if (!known.length) return null;
  return known.some((k) => k === b || k.includes(b) || b.includes(k));
}

/** One line for the terminal when the signer's name and the environment disagree. */
export function actorWarning(by, a) {
  const m = actorMatches(by, a);
  if (m !== false) return null;
  const seen = [a.git && `git: ${a.git}`, a.os && `os: ${a.os}`, a.ci && `ci: ${a.ci}`].filter(Boolean).join(", ");
  return `WARN  signing as "${by}" from an environment that identifies as ${seen}.\n      Recorded as given; the mismatch is in the record too. If "${by}" is not you, stop.`;
}
