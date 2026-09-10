#!/usr/bin/env node
/**
 * derived-status.mjs — status facts from evidence, not hand-written claims.
 *
 * Idea 9 first useful: identify contradictory documentation and print a
 * proposed update. Does not overwrite human commentary in hardening/progress.
 *
 * Usage:
 *   node .cursor/tools/derived-status.mjs snapshot [--json]
 *   node .cursor/tools/derived-status.mjs propose
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { report, emit, warn, info, block } from "./_findings.mjs";

const ROOT = process.env.CLAUDE_PROJECT_DIR || repoRoot() || process.cwd();

function repoRoot() {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

function git(...args) {
  try { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

function read(rel) {
  try { return readFileSync(join(ROOT, rel), "utf8"); } catch { return ""; }
}

function sha(rel) {
  try { return createHash("sha256").update(readFileSync(join(ROOT, rel))).digest("hex"); }
  catch { return null; }
}

export function snapshot(root = ROOT) {
  const findings = [];
  const commit = git("rev-parse", "HEAD");
  const dirty = git("status", "--porcelain");
  const implemented = true;
  const tested = null; // this command does not run the suite
  let attested = false;
  let integrityOk = null;
  const integ = join(root, "lifecycle", "integrity.json");
  if (existsSync(integ)) {
    try {
      const man = JSON.parse(readFileSync(integ, "utf8"));
      attested = true;
      let changed = 0;
      for (const [rel, expect] of Object.entries(man.files || man.hashes || {})) {
        const got = sha(rel);
        if (got && expect && got !== expect) changed++;
      }
      integrityOk = changed === 0;
      if (changed) findings.push(warn("integrity-stale", `${changed} attested file(s) no longer match lifecycle/integrity.json`, { file: "lifecycle/integrity.json" }));
      else findings.push(info("integrity-ok", "attested files match the manifest"));
    } catch {
      findings.push(block("integrity-unreadable", "lifecycle/integrity.json is not JSON", { file: "lifecycle/integrity.json" }));
    }
  } else {
    findings.push(info("integrity-absent", "no integrity manifest"));
  }
  const committed = !dirty;
  if (dirty) findings.push(info("dirty-tree", "working tree has uncommitted changes"));
  const worktreeDigest = createHash("sha256").update(String(commit || "") + "\n" + String(dirty || "")).digest("hex");

  const progress = read("memory-bank/progress.md");
  const hardening = read(".cursor/docs/HARDENING-STATUS.md");
  const claimsPass = /integrity PASS/i.test(progress) || /Integrity verification is \*\*green\*\*/i.test(hardening);
  const claimsFail = /Integrity FAIL/i.test(progress) || /Integrity verification is \*\*red\*\*/i.test(hardening);
  if (integrityOk === false && claimsPass && !claimsFail) {
    findings.push(block("doc-contradiction", "progress/hardening claim integrity PASS while attested files have changed", { file: "memory-bank/progress.md" }));
  }
  if (integrityOk === true && claimsFail) {
    findings.push(warn("doc-lag", "docs still say integrity is red but the manifest currently matches", { file: ".cursor/docs/HARDENING-STATUS.md" }));
  }

  const data = {
    commit,
    dirty: !!dirty,
    implemented,
    tested,
    reviewed: null,
    attested,
    attestedOk: integrityOk,
    committed,
    worktreeDigest,
    deployed: false,
    skipped: [{ check: "tests/run.mjs", why: "derived-status does not run the suite" }],
  };
  const r = report({
    tool: "derived-status.mjs",
    command: "snapshot",
    findings,
    data,
    summary: findings.some((f) => f.severity === "block")
      ? "status snapshot has contradictions"
      : `status snapshot at ${commit || "(no git)"}`,
  });
  return r;
}

export function propose(root = ROOT) {
  const r = snapshot(root);
  const d = r.data;
  const lines = [
    `<!-- derived-status ${d.commit || "unknown"} — do not treat this block as commentary -->`,
    `- implemented: ${d.implemented}`,
    `- tested: ${d.tested === null ? "skipped (run tests/run.mjs)" : d.tested}`,
    `- attested: ${d.attested} (ok=${d.attestedOk})`,
    `- committed: ${d.committed}`,
    `- worktreeDigest: ${d.worktreeDigest}`,
    `- deployed: ${d.deployed}`,
  ];
  return { snapshot: r, markdown: lines.join("\n") };
}

const invoked = (() => {
  try { return fileURLToPath(import.meta.url) === process.argv[1]; }
  catch { return false; }
})();
if (invoked) {
  const cmd = process.argv[2] || "snapshot";
  const json = process.argv.includes("--json");
  if (cmd === "propose") {
    const p = propose(ROOT);
    if (json) process.stdout.write(JSON.stringify(p, null, 2) + "\n");
    else process.stdout.write(p.markdown + "\n");
    process.exit(p.snapshot.exit);
  }
  if (cmd === "snapshot") {
    const r = snapshot(ROOT);
    if (json) process.exit(emit(r));
    process.stdout.write(`${r.summary}\n`);
    for (const f of r.findings) process.stdout.write(`  ${f.severity} ${f.code} ${f.message}\n`);
    process.exit(r.exit);
  }
  process.stderr.write("Usage: node .cursor/tools/derived-status.mjs snapshot|propose [--json]\n");
  process.exit(2);
}
