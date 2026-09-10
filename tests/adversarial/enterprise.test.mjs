#!/usr/bin/env node
/**
 * enterprise.test.mjs — Phase F (E-17, E-25, E-26).
 *
 * E-18 lives in bash.test.mjs / guards.test.mjs / sql.test.mjs (the refusals).
 * This file pins the rest: the opt-in signed-commits template, dashboard Host
 * checks, and that subagents no longer claim a mechanical sandbox.
 */

import { join } from "node:path";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { check, report, section, REPO, fixture, put, gitInit } from "../_harness.mjs";

const dash = await import(new URL(`file:///${join(REPO, ".cursor", "tools", "dashboard.mjs").replace(/\\/g, "/")}`));
const slRange = await import(new URL(`file:///${join(REPO, ".cursor", "tools", "signed-lifecycle-range.mjs").replace(/\\/g, "/")}`));

section("templates/ci/signed-lifecycle.yml — opt-in, not this repo's CI");
{
  const yml = readFileSync(join(REPO, "templates", "ci", "signed-lifecycle.yml"), "utf8");
  const here = readFileSync(join(REPO, ".github", "workflows", "platform-checks.yml"), "utf8");
  check("the template exists and is named signed-lifecycle", /^name: signed-lifecycle/m.test(yml), yml.slice(0, 200));
  check("it watches lifecycle/**", /paths:[\s\S]*lifecycle\/\*\*/.test(yml), yml.slice(0, 400));
  check("it asks GitHub whether the commit is verified", /verification\.verified/.test(yml) && /gh api/.test(yml), yml.slice(0, 800));
  check("it is not wired into this repo's platform-checks", !/signed-lifecycle/.test(here), "platform-checks.yml mentions signed-lifecycle");
  check("lifecycle-gates.yml points at it as opt-in", /signed-lifecycle\.yml/.test(readFileSync(join(REPO, "templates", "ci", "lifecycle-gates.yml"), "utf8")), "missing pointer");
  check("the workflow runs the range helper instead of HEAD^..HEAD", /signed-lifecycle-range\.mjs/.test(yml) && !/HEAD\^/.test(yml), yml.slice(0, 1200));
}

section("signed-lifecycle-range.mjs — full pushed range, not only HEAD");
{
  const root = fixture("sl-hist");
  gitInit(root);
  mkdirSync(join(root, "lifecycle"), { recursive: true });
  put(root, "lifecycle/state.json", "{\"phase\":\"DESIGN\"}\n");
  const git = (...a) => spawnSync("git", a, { cwd: root, encoding: "utf8" });
  git("add", "-A");
  git("commit", "-qm", "lifecycle change");
  const lifecycleSha = git("rev-parse", "HEAD").stdout.trim();
  put(root, "README.md", "# docs only\n");
  git("add", "-A");
  git("commit", "-qm", "docs only");
  const head = git("rev-parse", "HEAD").stdout.trim();
  const parent = git("rev-parse", `${lifecycleSha}^`).stdout.trim();

  const lastOnly = slRange.listLifecycleCommits({ spec: `${head}^..${head}` }, { cwd: root });
  check("HEAD^..HEAD misses the lifecycle commit behind a docs commit",
    lastOnly.length === 0, JSON.stringify(lastOnly) + git("log", "--oneline").stdout);

  const full = slRange.listLifecycleCommits(slRange.rangeFromEvent({
    eventName: "push", sha: head, before: parent,
  }), { cwd: root });
  check("push before..after includes the lifecycle-changing commit",
    full.includes(lifecycleSha), JSON.stringify({ full, lifecycleSha, head, parent }));

  let threw = null;
  try { slRange.listLifecycleCommits({ spec: "not-a-sha..also-not" }, { cwd: root }); }
  catch (e) { threw = e; }
  check("an invalid range throws instead of becoming an empty success",
    threw && threw.code === "EINVALIDRANGE", String(threw));
}

section("dashboard.mjs — Host must be localhost");
{
  check("127.0.0.1", dash.hostAllowed("127.0.0.1") === true, "");
  check("127.0.0.1:7777", dash.hostAllowed("127.0.0.1:7777") === true, "");
  check("localhost", dash.hostAllowed("localhost") === true, "");
  check("localhost:7777", dash.hostAllowed("LOCALHOST:7777") === true, "");
  check("[::1]", dash.hostAllowed("[::1]") === true, "");
  check("[::1]:7777", dash.hostAllowed("[::1]:7777") === true, "");
  check("empty is refused", dash.hostAllowed("") === false && dash.hostAllowed(undefined) === false, "");
  check("evil.com is refused", dash.hostAllowed("evil.com") === false, "");
  check("127.0.0.1.attacker.com is refused", dash.hostAllowed("127.0.0.1.attacker.com") === false, "");
  check("localhost.evil.com is refused", dash.hostAllowed("localhost.evil.com") === false, "");
}

section("agents — read-only is advisory; repo-cartographer has no Write");
{
  const dir = join(REPO, ".claude", "agents");
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  check("14 agent files", files.length === 14, String(files.length));
  for (const f of files) {
    const body = readFileSync(join(dir, f), "utf8");
    check(`${f} states the advisory`, /Advisory, not a sandbox/.test(body), f);
  }
  const cart = readFileSync(join(dir, "repo-cartographer.md"), "utf8");
  const tools = (cart.match(/^tools:\s*(.+)$/m) || [, ""])[1];
  check("repo-cartographer does not declare Write", !/\bWrite\b/.test(tools), tools);
  check("...and tells the caller to persist the map", /do not write files/i.test(cart) && /repo-discovery/.test(cart), cart.slice(0, 800));
}

report("Phase F: signed-lifecycle is opt-in, Host is localhost-only, agents do not claim a sandbox.");
