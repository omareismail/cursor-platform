#!/usr/bin/env node
/**
 * concurrency.test.mjs — two writers, one record; a crash mid-write.
 *
 * Every lifecycle record used to reach disk as truncate-then-write, and two
 * sessions writing state.json each read, decided and wrote with nothing to say
 * which version they had read. The second write discarded the first decision -
 * a gate verdict, an approval - and neither party was told. Each case here is
 * one of those, now refused or impossible.
 */

import { join } from "node:path";
import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync, utimesSync } from "node:fs";
import { spawn } from "node:child_process";
import { fixture, runTool, put, gitInit, DOC, check, report, section, REPO } from "../_harness.mjs";

const st = await import(new URL(`file:///${join(REPO, ".cursor", "tools", "_state.mjs").replace(/\\/g, "/")}`));
const ev = await import(new URL(`file:///${join(REPO, ".cursor", "tools", "_evidence.mjs").replace(/\\/g, "/")}`));
const readState = (root) => JSON.parse(readFileSync(join(root, "lifecycle", "state.json"), "utf8"));
const tmpFiles = (dir) => readdirSync(dir).filter((f) => f.endsWith(".tmp") || f.endsWith(".lock"));

section("writeJsonAtomic — the target is old content or new content, never empty");
{
  const root = fixture("c-atomic");
  const p = join(root, "lifecycle", "rec.json");
  st.writeJsonAtomic(p, { a: 1 });
  st.writeJsonAtomic(p, { a: 2 });
  check("second write replaces the first", JSON.parse(readFileSync(p, "utf8")).a === 2, readFileSync(p, "utf8"));
  check("no temp file left beside it", tmpFiles(join(root, "lifecycle")).length === 0, tmpFiles(join(root, "lifecycle")).join());
  check("serialised the way records always were (2-space, trailing newline)", readFileSync(p, "utf8") === '{\n  "a": 2\n}\n', JSON.stringify(readFileSync(p, "utf8")));
}

section("commitJson — compare-and-swap on revision");
{
  const root = fixture("c-cas");
  const p = join(root, "lifecycle", "state.json");
  st.writeJsonAtomic(p, { revision: 0, x: "a" });
  const mine = st.readJsonRevisioned(p).obj;           // read at revision 0
  const theirs = st.readJsonRevisioned(p).obj;         // another session, same read
  theirs.x = "theirs";
  check("first writer commits, revision -> 1", st.commitJson(p, theirs) === 1, "");
  mine.x = "mine";
  let err = null;
  try { st.commitJson(p, mine); } catch (e) { err = e; }
  check("second writer, holding revision 0, is REFUSED with ECONFLICT", err?.code === "ECONFLICT" && err.expected === 0 && err.actual === 1, String(err));
  check("...and the first decision is still on disk", st.readJsonRevisioned(p).obj.x === "theirs", readFileSync(p, "utf8"));
  check("...and the refusal names both revisions", /revision 0 .* now at 1/.test(err.message), err.message);
  writeFileSync(p, "{ not json");
  const fresh = { revision: 1, x: "over" };
  err = null;
  try { st.commitJson(p, fresh); } catch (e) { err = e; }
  check("a record that is no longer valid JSON is not overwritten (ECORRUPT)", err?.code === "ECORRUPT", String(err));
  check("no lock left behind after a refused commit", tmpFiles(join(root, "lifecycle")).length === 0, tmpFiles(join(root, "lifecycle")).join());
}

section("lock — a live lock blocks, a dead one is taken over");
{
  const root = fixture("c-lock");
  const p = join(root, "lifecycle", "state.json");
  st.writeJsonAtomic(p, { revision: 0 });
  const held = st.lock(p);
  let err = null;
  const t0 = Date.now();
  try { st.commitJson(p, { revision: 0 }); } catch (e) { err = e; }
  check("a commit against a held lock is refused (ELOCKED) after waiting", err?.code === "ELOCKED" && Date.now() - t0 >= 2500, `${err?.code} after ${Date.now() - t0}ms`);
  check("...and the record was not written", st.readJsonRevisioned(p).revision === 0, "");
  held.release();
  check("released: the same commit succeeds", st.commitJson(p, { revision: 0 }) === 1, "");

  // A crashed writer's lock: older than the stale threshold.
  const lp = p + ".lock";
  writeFileSync(lp, JSON.stringify({ pid: 999999 }));
  const old = new Date(Date.now() - 60_000);
  utimesSync(lp, old, old);
  let took = false;
  const rev = st.commitJson(p, { revision: 1 }, { onTakeover: () => { took = true; } });
  check("a lock older than 30s is a crashed writer: taken over, reported, commit proceeds", took && rev === 2, `took=${took} rev=${rev}`);
  check("the stale lock is gone afterwards", !existsSync(lp), "");
}

section("nextSequentialId — max+1, never count+1");
{
  const root = fixture("c-ids");
  const dir = join(root, "lifecycle", "changes");
  check("empty directory -> 0001", st.nextSequentialId(dir, "CR") === "CR-0001", st.nextSequentialId(dir, "CR"));
  put(root, "lifecycle/changes/CR-0001.json", "{}");
  put(root, "lifecycle/changes/CR-0002.json", "{}");
  put(root, "lifecycle/changes/CR-0003.json", "{}");
  unlinkSync(join(dir, "CR-0002.json"));
  check("with CR-0002 deleted (2 files, max 3) -> 0004, not 0003", st.nextSequentialId(dir, "CR") === "CR-0004", st.nextSequentialId(dir, "CR"));
  put(root, "lifecycle/changes/notes.md", "");
  put(root, "lifecycle/changes/CR-0010.json.bak", "{}");
  check("unrelated files and backups are not ids", st.nextSequentialId(dir, "CR") === "CR-0004", st.nextSequentialId(dir, "CR"));
}

section("lifecycle.mjs — two record-gate commands at once lose nothing");
{
  const root = fixture("c-race", { gates: true });
  for (const f of ["brief", "prd", "personas", "story-map", "scope", "nfr"]) put(root, `docs/product/${f}.md`, DOC(f));
  gitInit(root);
  let r = runTool("lifecycle.mjs", ["init", "--name", "fx"], root);
  check("init", r.exit === 0, r.err);
  const before = readState(root);
  const run = (verdict) => new Promise((res) => {
    const c = spawn(process.execPath, [join(root, ".cursor", "tools", "lifecycle.mjs"), "record-gate", "REQUIREMENTS", "--verdict", verdict, "--by", "business-analyst"], { cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
    let out = "", err = "";
    c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (err += d));
    c.on("close", (code) => res({ code, out, err }));
  });
  const results = await Promise.all([run("GO"), run("NO-GO"), run("GO"), run("NO-GO")]);
  // A NO-GO commits and exits 1 by design, so "committed" is what the tool
  // SAID, not the exit code. Serialised commits (read after the other's write,
  // commit to the next revision) are correct; only a silent overwrite is not.
  const ok = results.filter((x) => /judgement recorded/.test(x.out)).length;
  const conflicts = results.filter((x) => !/judgement recorded/.test(x.out) && /changed underneath|held by another writer/.test(x.err)).length;
  const after = readState(root);
  const verdicts = after.history.filter((h) => h.event === "gate").length;
  check("every command either committed or was told why not", ok + conflicts === 4, results.map((x) => `${x.code}:${(x.out + x.err).trim().split("\n").pop()}`).join(" | "));
  check("no decision was silently lost: history holds exactly as many verdicts as commits", verdicts === ok, `verdicts=${verdicts} committed=${ok} history=${JSON.stringify(after.history)}`);
  check("a refused writer wrote nothing: refusals say so", results.filter((x) => !/judgement recorded/.test(x.out)).every((x) => /Nothing was written/.test(x.err)), results.map((x) => x.err.trim()).join(" | "));
  check("revision advanced exactly once per commit", after.revision === before.revision + ok, `${before.revision} -> ${after.revision}, ${ok} commits`);
  check("state.json is valid JSON and no temp/lock file remains", tmpFiles(join(root, "lifecycle")).length === 0, tmpFiles(join(root, "lifecycle")).join());
  check("the verdict on disk is the one from the LAST commit", after.phases.REQUIREMENTS.judgement.verdict === (after.history.filter((h) => h.event === "gate").pop()?.detail.match(/REQUIREMENTS (GO|NO-GO)/)?.[1]), JSON.stringify(after.phases.REQUIREMENTS.judgement));
}

section("lifecycle.mjs — a stale in-memory read cannot overwrite a newer state");
{
  const root = fixture("c-stale-read", { gates: true });
  for (const f of ["brief", "prd", "personas", "story-map", "scope", "nfr"]) put(root, `docs/product/${f}.md`, DOC(f));
  gitInit(root);
  runTool("lifecycle.mjs", ["init", "--name", "fx"], root);
  // Simulate another session having written since: bump the revision on disk
  // AND index it. A silent put without indexing is CHANGED, which writeState
  // now refuses (R2). Another session that actually committed would have chained.
  const s = readState(root);
  s.revision = 41;
  put(root, "lifecycle/state.json", JSON.stringify(s));
  ev.recordFile(root, "lifecycle/state.json", "state", { event: "other-session", revision: 41 });
  // lifecycle.mjs reads (41), then between read and write another session moves it.
  // We cannot interpose inside one process, so prove the primitive from the CLI side:
  // a record-gate against a file whose revision moves during the command is refused.
  // The lock makes that window a compare, so here: prove the compare is against the
  // revision READ, by handing commitJson a stale object for the CLI's own file.
  const stale = { ...readState(root), revision: 40 };
  let err = null;
  try { st.commitJson(join(root, "lifecycle", "state.json"), stale); } catch (e) { err = e; }
  check("a writer holding revision 40 against a file at 41 is refused", err?.code === "ECONFLICT", String(err));
  const r = runTool("lifecycle.mjs", ["record-gate", "REQUIREMENTS", "--verdict", "GO", "--by", "business-analyst"], root);
  check("a fresh read at 41 commits to 42", r.exit === 0 && readState(root).revision === 42, `${r.err} rev=${readState(root).revision}`);
}

section("change-request.mjs — ids never reused, records written atomically");
{
  const root = fixture("c-cr", { gates: true });
  put(root, "docs/analysis/business-rules.md", DOC("Business rules") + "\n### BR-4 — Cooling-off period\n\nFourteen days.\n");
  put(root, "lifecycle/changes/CR-0001.json", JSON.stringify({ id: "CR-0001", status: "CLOSED" }));
  put(root, "lifecycle/changes/CR-0003.json", JSON.stringify({ id: "CR-0003", status: "CLOSED" }));
  put(root, "lifecycle/state.json", JSON.stringify({ schemaVersion: 3, revision: 0, product: "fx", mode: "greenfield", phase: "DESIGN", phases: {}, history: [] }));
  const r = runTool("change-request.mjs", ["open", "--changes", "BR-4", "--reason", "customer changed the rule", "--by", "sara"], root);
  check("open succeeds", r.exit === 0, r.err + r.out.slice(0, 300));
  check("the new id is CR-0004 (max+1), not CR-0003 (count+1, which exists)", existsSync(join(root, "lifecycle", "changes", "CR-0004.json")) && /CR-0004/.test(r.out), r.out.slice(0, 300));
  const rec = JSON.parse(readFileSync(join(root, "lifecycle", "changes", "CR-0004.json"), "utf8"));
  check("who opened it is recorded beside --by", rec.by === "sara" && rec.recordedBy && "os" in rec.recordedBy, JSON.stringify(rec).slice(0, 300));
  check("no temp file left in the directory", tmpFiles(join(root, "lifecycle", "changes")).length === 0, "");
}

report("A record on disk is always whole, and a decision is never overwritten by a writer who did not see it.");
