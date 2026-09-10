#!/usr/bin/env node
/**
 * orchestration.test.mjs — Phase D (E-20, E-21).
 *
 * The skill index is generated, not authored. docs-lint must fail when it is
 * missing, stale, or when a live skill has no catalog row. Hyphenated English
 * counts, Arabic مهارة counts, and cited .mdc files that do not exist were
 * invisible to the previous linter.
 */

import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { fixture, runTool, runHook, put, gitInit, check, report, section, REPO } from "../_harness.mjs";

const idxMod = await import(new URL(`file:///${join(REPO, ".cursor", "tools", "_skills-index.mjs").replace(/\\/g, "/")}`));

const parse = (r) => { try { return JSON.parse(r.out); } catch { return null; } };
const lint = (root) => runTool("docs-lint.mjs", ["check", "--json"], root);

function addSkill(root, name) {
  const dir = join(root, ".cursor", "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "skill.md"), `# ${name}\n\nOverview paragraph for ${name}.\n`);
}

section("_skills-index.mjs — classification matches the announcement categories");
{
  check("speckit is E / specify / DEVELOPMENT", idxMod.classify("speckit-plan").category === "E" && idxMod.classify("speckit-plan").capability === "specify" && idxMod.classify("speckit-plan").phase === "DEVELOPMENT", JSON.stringify(idxMod.classify("speckit-plan")));
  check("repo-discovery is D / housekeeping", idxMod.classify("repo-discovery").category === "D" && idxMod.classify("repo-discovery").capability === "housekeeping", JSON.stringify(idxMod.classify("repo-discovery")));
  check("dotnet-endpoint-gen is A, requires pattern-finder", idxMod.classify("dotnet-endpoint-gen").category === "A" && idxMod.classify("dotnet-endpoint-gen").requires.includes("pattern-finder"), JSON.stringify(idxMod.classify("dotnet-endpoint-gen")));
  check("database-audit is B / dotnet", idxMod.classify("database-audit").category === "B" && idxMod.classify("database-audit").workflow === "dotnet", JSON.stringify(idxMod.classify("database-audit")));
  check("dashboard is C", idxMod.classify("dashboard").category === "C", JSON.stringify(idxMod.classify("dashboard")));
  check("operability-gen is B from the catalog, not A from the -gen suffix", idxMod.classify("operability-gen", REPO).category === "B", JSON.stringify(idxMod.classify("operability-gen", REPO)));
  check("architecture-map-gen is C from the catalog, not A from the -gen suffix", idxMod.classify("architecture-map-gen", REPO).category === "C", JSON.stringify(idxMod.classify("architecture-map-gen", REPO)));
  check("dotnet-query-optimizer is B from the catalog, not C from the fallback", idxMod.classify("dotnet-query-optimizer", REPO).category === "B", JSON.stringify(idxMod.classify("dotnet-query-optimizer", REPO)));
  check("code-review-assistant requires repo-discovery", idxMod.classify("code-review-assistant", REPO).requires.includes("repo-discovery"), JSON.stringify(idxMod.classify("code-review-assistant", REPO)));
  check("dotnet-schema-diff requires repo-discovery", idxMod.classify("dotnet-schema-diff", REPO).requires.includes("repo-discovery"), JSON.stringify(idxMod.classify("dotnet-schema-diff", REPO)));
  check("retired names are recorded, not live", !!idxMod.RETIRED["refactor-assistant"] && !!idxMod.RETIRED["security-perf-report"], JSON.stringify(idxMod.RETIRED));
  const built = idxMod.build(REPO);
  check("this repo's index count equals the skill folders", built.count === 98 && Object.keys(built.skills).length === 98, String(built.count));
  check("fingerprint ignores generatedAt", idxMod.fingerprint({ ...built, generatedAt: "2000-01-01" }) === idxMod.fingerprint(built), "");
}

section("docs-lint — skills.index.json missing or stale is a block");
{
  const root = fixture("d-idx-missing");
  addSkill(root, "pay-gen");
  put(root, "README.md", "# Fixture\n\nA skill lives here.\n");
  gitInit(root);
  let r = lint(root);
  let rep = parse(r);
  const miss = (rep?.findings || []).find((f) => f.code === "index-stale");
  check("missing index is index-stale", r.exit === 1 && miss && /missing/.test(miss.message), JSON.stringify(miss || rep?.findings));

  const fresh = idxMod.build(root);
  put(root, ".cursor/skills.index.json", idxMod.serialize(fresh));
  r = lint(root);
  rep = parse(r);
  check("matching index is not index-stale", !(rep?.findings || []).some((f) => f.code === "index-stale"), JSON.stringify(rep?.findings));

  put(root, ".cursor/skills.index.json", idxMod.serialize({ ...fresh, skills: {} }));
  r = lint(root);
  rep = parse(r);
  check("empty skills object against a folder is index-stale", (rep?.findings || []).some((f) => f.code === "index-stale"), JSON.stringify(rep?.findings));
}

section("docs-lint — hyphenated English counts, Arabic counts, ghost .mdc, catalog gap");
{
  const root = fixture("d-counts");
  addSkill(root, "pay-gen");
  put(root, ".cursor/skills.index.json", idxMod.serialize(idxMod.build(root)));
  put(root, "README.md", "# Fixture\n\nSee the full 66-skill catalog.\n");
  put(root, "HANDBOOK.ar.md", "# دليل\n\nمنصة من 96 مهارة.\n");
  put(root, "notes.md", "# Notes\n\nSee `99-nope.mdc` before generating.\n");
  put(root, ".cursor/rules/00-memory-think.mdc", "# 00\n");
  put(root, ".cursor/docs/skill-catalog.md", "# Catalog\n\n| Skill |\n| `other-skill` |\n");
  gitInit(root);
  const r = lint(root);
  const rep = parse(r);
  const codes = (rep?.findings || []).map((f) => f.code + ":" + f.message);
  check("66-skill is stale-count", (rep?.findings || []).some((f) => f.code === "stale-count" && /66/.test(f.message) && /README/.test(f.file)), codes.join(" | "));
  check("96 مهارة is stale-count", (rep?.findings || []).some((f) => f.code === "stale-count" && /96/.test(f.message) && /HANDBOOK.ar/.test(f.file)), codes.join(" | "));
  check("99-nope.mdc is ghost-mdc", (rep?.findings || []).some((f) => f.code === "ghost-mdc" && /99-nope/.test(f.message)), codes.join(" | "));
  check("pay-gen missing from catalog is catalog-gap", (rep?.findings || []).some((f) => f.code === "catalog-gap" && /pay-gen/.test(f.message)), codes.join(" | "));
}

section("docs-lint — count-ok skips a frozen figure");
{
  const root = fixture("d-ok");
  addSkill(root, "pay-gen");
  put(root, ".cursor/skills.index.json", idxMod.serialize(idxMod.build(root)));
  put(root, "README.md", "# Fixture\n\nThe old copy claimed 66-skill once. <!-- count-ok -->\n");
  gitInit(root);
  const r = lint(root);
  const rep = parse(r);
  check("count-ok suppresses hyphenated stale-count", !(rep?.findings || []).some((f) => f.code === "stale-count"), JSON.stringify(rep?.findings));
}

section("session-start.mjs — prints the capability line when the index is present");
{
  const withIdx = fixture("d-ss-idx");
  put(withIdx, ".cursor/skills.index.json", idxMod.serialize({
    version: 1, generatedAt: "2026-09-09T00:00:00.000Z", count: 2,
    retired: {},
    skills: {
      "pay-gen": { category: "A", phase: "DEVELOPMENT", capability: "generate", workflow: "dotnet", requires: ["pattern-finder"] },
      "repo-discovery": { category: "D", phase: null, capability: "housekeeping", workflow: "platform", requires: [] },
    },
  }));
  let r = runHook("session-start.mjs", { hook_event_name: "SessionStart" }, withIdx);
  check("prints Skills index with category counts", r.exit === 0 && /Skills index:/.test(r.out) && /A 1/.test(r.out) && /D 1/.test(r.out), r.out.slice(0, 800));

  const none = fixture("d-ss-none");
  r = runHook("session-start.mjs", { hook_event_name: "SessionStart" }, none);
  check("missing index is attention-required, not a crash", r.exit === 0 && /skills\.index\.json/.test(r.out) && /sync-skills/.test(r.out), r.out.slice(0, 800));
}

report("The skill index is generated and linted; hyphenated, Arabic and .mdc drift fail the same way English counts already did.");
