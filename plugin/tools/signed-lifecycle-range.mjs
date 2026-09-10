#!/usr/bin/env node
/**
 * Commit range for templates/ci/signed-lifecycle.yml.
 *
 * Push used to use HEAD^..HEAD, so an unsigned lifecycle change hidden behind a
 * later docs-only commit produced an empty list. `git log ... || true` then
 * turned a bad range into a successful empty result.
 *
 * This module computes the full pushed range from before/after (or the PR
 * base/head), treats an all-zero "before" as a first push, and fails on an
 * invalid range instead of swallowing it.
 *
 * Usage (from the adopter workflow):
 *   node .cursor/tools/signed-lifecycle-range.mjs
 *
 * Env: EVENT_NAME, SHA, BEFORE, PR_BASE, PR_HEAD, DEFAULT_BRANCH
 * Prints one commit SHA per line (commits that touch lifecycle/). Exit 2 on
 * an invalid range; exit 0 with no output when the range is valid but empty.
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function isZeroSha(s) {
  return !s || /^0+$/.test(String(s));
}

export function rangeFromEvent({ eventName, sha, before, prBase, prHead, defaultBranch }) {
  const name = String(eventName || "");
  if (name === "pull_request") {
    if (!prBase || !prHead) {
      const err = new Error("invalid pull_request range: missing base or head sha");
      err.code = "EINVALIDRANGE";
      throw err;
    }
    return { spec: `${prBase}..${prHead}`, inclusive: false };
  }
  if (name === "push") {
    if (!sha) {
      const err = new Error("invalid push range: missing sha");
      err.code = "EINVALIDRANGE";
      throw err;
    }
    if (isZeroSha(before)) {
      if (defaultBranch) return { spec: `origin/${defaultBranch}..${sha}`, inclusive: false, firstPush: true };
      return { spec: sha, inclusive: true, firstPush: true };
    }
    return { spec: `${before}..${sha}`, inclusive: false };
  }
  if (name === "workflow_dispatch") {
    if (!sha) {
      const err = new Error("invalid workflow_dispatch range: missing sha");
      err.code = "EINVALIDRANGE";
      throw err;
    }
    if (defaultBranch) return { spec: `origin/${defaultBranch}..${sha}`, inclusive: false };
    return { spec: sha, inclusive: true };
  }
  const err = new Error(`unsupported event: ${name || "(empty)"}`);
  err.code = "EINVALIDRANGE";
  throw err;
}

export function listLifecycleCommits(range, { cwd = process.cwd(), git = execFileSync } = {}) {
  const args = ["log", "--format=%H", range.spec, "--", "lifecycle"];
  try {
    const out = git("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return String(out || "").split("\n").map((s) => s.trim()).filter(Boolean);
  } catch (e) {
    const err = new Error(`invalid commit range ${range.spec}: ${e.stderr || e.message}`);
    err.code = "EINVALIDRANGE";
    throw err;
  }
}

function main() {
  let range;
  try {
    range = rangeFromEvent({
      eventName: process.env.EVENT_NAME || process.env.GITHUB_EVENT_NAME,
      sha: process.env.SHA || process.env.GITHUB_SHA,
      before: process.env.BEFORE,
      prBase: process.env.PR_BASE,
      prHead: process.env.PR_HEAD || process.env.SHA || process.env.GITHUB_SHA,
      defaultBranch: process.env.DEFAULT_BRANCH,
    });
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(2);
  }
  let commits;
  try { commits = listLifecycleCommits(range); }
  catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(2);
  }
  if (commits.length) process.stdout.write(commits.join("\n") + "\n");
  process.exit(0);
}

const invoked = (() => {
  try {
    const self = fileURLToPath(import.meta.url);
    const arg = resolve(process.argv[1] || "");
    return self === arg || self.toLowerCase() === arg.toLowerCase();
  } catch { return false; }
})();
if (invoked) main();
