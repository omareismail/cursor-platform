#!/usr/bin/env node
/**
 * adopt.test.mjs — the published copy recipe and the YAML-embedded CI script.
 *
 * Parsing standalone .mjs files does not cover JavaScript embedded in YAML,
 * and a fixture that is already a full install does not cover following the
 * bootstrap instructions.
 */

import { join } from "node:path";
import { readFileSync, mkdirSync, cpSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fixture, runHook, write, put, check, denies, report, section, REPO } from "../_harness.mjs";

section("templates/ci/lifecycle-gates.yml — Report active overrides is valid JS");
{
  const yml = readFileSync(join(REPO, "templates", "ci", "lifecycle-gates.yml"), "utf8");
  check("the step no longer contains a top-level return", /name: Report active overrides/.test(yml) && !/if\s*\(!ov\.length\)\s*return;/.test(yml), "top-level return still present");
  const m = yml.match(/name: Report active overrides[\s\S]*?node -e "([\s\S]*?)"\s*\n/);
  check("the embedded script can be extracted", !!m, "script not found");
  const src = m[1];
  const chk = spawnSync(process.execPath, ["--check"], { input: src, encoding: "utf8" });
  check("node --check accepts the embedded script", chk.status === 0, chk.stderr);

  function runScript(state) {
    const root = fixture("ci-ov-" + state.tag);
    put(root, "lifecycle/state.json", JSON.stringify(state.body, null, 2));
    return spawnSync(process.execPath, ["-e", src], { cwd: root, encoding: "utf8" });
  }
  const none = runScript({ tag: "none", body: { schemaVersion: 3, phases: { DESIGN: {} } } });
  check("zero overrides: exit 0, no annotations", none.status === 0 && !/::/.test(none.stdout), none.stdout + none.stderr);
  const future = new Date(Date.now() + 86400000).toISOString();
  const past = new Date(Date.now() - 86400000).toISOString();
  const active = runScript({ tag: "active", body: { schemaVersion: 3, phases: { DESIGN: { override: { id: "OV-1", risk: "LOW", by: "sara", expiresAt: future, reason: "spike" } } } } });
  check("active override: notice annotation, exit 0", active.status === 0 && /::notice::OV-1/.test(active.stdout), active.stdout + active.stderr);
  const expired = runScript({ tag: "exp", body: { schemaVersion: 3, phases: { DESIGN: { override: { id: "OV-2", risk: "HIGH", by: "sara", expiresAt: past, reason: "lapsed" } } } } });
  check("expired override: error annotation, exit 1", expired.status === 1 && /::error::OV-2/.test(expired.stdout), expired.stdout + expired.stderr);
}

section("NEW-PROJECT.md / APPLY-TO-PROJECT.md — the copy recipe installs hooks and schemas");
{
  const neu = readFileSync(join(REPO, ".cursor", "docs", "NEW-PROJECT.md"), "utf8");
  const apply = readFileSync(join(REPO, ".cursor", "docs", "APPLY-TO-PROJECT.md"), "utf8");
  check("NEW-PROJECT copies .claude", /cp -r .*\/\.claude \./.test(neu) || /Copy-Item -Recurse .*\\\.claude \./.test(neu), "NEW-PROJECT missing .claude");
  check("NEW-PROJECT copies schemas", /cp -r .*\/schemas \./.test(neu) || /Copy-Item -Recurse .*\\schemas \./.test(neu), "NEW-PROJECT missing schemas");
  check("APPLY-TO-PROJECT copies .claude", /Copy-Item -Recurse .*\\\.claude \./.test(apply) || /Copy-Item -Recurse .*\/\.claude \./.test(apply), "APPLY missing .claude");
  check("APPLY-TO-PROJECT copies schemas", /Copy-Item -Recurse .*\\schemas \./.test(apply) || /Copy-Item -Recurse .*\/schemas \./.test(apply), "APPLY missing schemas");

  const root = fixture("adopt-copy", { withTools: false, writePolicy: false, mcpPolicy: null });
  cpSync(join(REPO, ".cursor"), join(root, ".cursor"), { recursive: true });
  cpSync(join(REPO, ".claude"), join(root, ".claude"), { recursive: true });
  cpSync(join(REPO, "schemas"), join(root, "schemas"), { recursive: true });
  const r = runHook("guard-write.mjs", write(join(root, ".cursor", "mcp-policy.json"), "{}"), root);
  denies("after the published copy set, guard-write still refuses a policy edit", r, "enforcement surface");
}

report("The adopter CI script parses, and the published copy recipe installs the hooks it wires.");
