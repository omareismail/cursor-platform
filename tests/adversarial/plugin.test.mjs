#!/usr/bin/env node
/**
 * plugin.test.mjs — R03, R10, R11, R12.
 *
 * --out must not recursively delete the repo; check must hash installed bytes
 * not only the BUILD stamp; rewrite must leave project-owned diagram paths in
 * the consuming repo; packaged docs must include the runbook they link to.
 */

import { join } from "node:path";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { fixture, check, report, section, REPO } from "../_harness.mjs";

const plugin = await import(new URL(`file:///${join(REPO, ".cursor", "tools", "build-plugin.mjs").replace(/\\/g, "/")}`));

section("build-plugin.mjs — --out refuses unsafe destinations");
{
  const root = fixture("plug-out");
  mkdirSync(join(root, "keep"), { recursive: true });
  writeFileSync(join(root, "keep", "canary.txt"), "untouched\n");
  mkdirSync(join(root, "not-plugin"), { recursive: true });
  writeFileSync(join(root, "not-plugin", "canary.txt"), "untouched\n");

  let err = null;
  try { plugin.resolvePluginOut(root, "."); } catch (e) { err = e; }
  check("refuses the repository root", err?.code === "EUNSAFEOUT", String(err));
  check("root canary still there", readFileSync(join(root, "keep", "canary.txt"), "utf8") === "untouched\n", "");

  err = null;
  try { plugin.resolvePluginOut(root, ".."); } catch (e) { err = e; }
  check("refuses an ancestor", err?.code === "EUNSAFEOUT", String(err));

  err = null;
  try { plugin.resolvePluginOut(root, "src"); } catch (e) { err = e; }
  check("refuses a source tree name", err?.code === "EUNSAFEOUT", String(err));

  err = null;
  try { plugin.resolvePluginOut(root, "not-plugin"); } catch (e) { err = e; }
  check("refuses to replace a directory without a plugin BUILD marker", err?.code === "EUNSAFEOUT", String(err));
  check("that directory was not deleted", existsSync(join(root, "not-plugin", "canary.txt")), "");

  mkdirSync(join(root, "ok-plugin", ".claude-plugin"), { recursive: true });
  writeFileSync(join(root, "ok-plugin", ".claude-plugin", "BUILD"), "deadbeef\n");
  check("allows replacing a previous plugin build", plugin.resolvePluginOut(root, "ok-plugin").endsWith("ok-plugin"), "");

  mkdirSync(join(root, "backup.__check__"), { recursive: true });
  writeFileSync(join(root, "backup.__check__", "important.txt"), "keep\n");
  err = null;
  try { plugin.resolvePluginOut(root, "backup.__check__"); } catch (e) { err = e; }
  check("refuses an existing .__check__ directory without a plugin marker", err?.code === "EUNSAFEOUT", String(err));
  check("suffix-named directory was not treated as owned", existsSync(join(root, "backup.__check__", "important.txt")), "");

  mkdirSync(join(root, "nested.__check__", "out"), { recursive: true });
  writeFileSync(join(root, "nested.__check__", "out", "important.txt"), "keep\n");
  err = null;
  try { plugin.resolvePluginOut(root, "nested.__check__/out"); } catch (e) { err = e; }
  check("refuses an existing nested .__check__/ path without a marker", err?.code === "EUNSAFEOUT", String(err));
  check("nested suffix path was not deleted", existsSync(join(root, "nested.__check__", "out", "important.txt")), "");

  check("a new unused check path is allowed",
    plugin.resolvePluginOut(root, "plugin.check-new").replace(/\\/g, "/").endsWith("plugin.check-new"), "");
}

section("build-plugin.mjs — rewrite keeps project diagram output in the repo");
{
  const skill = readFileSync(join(REPO, ".cursor", "skills", "architecture-map-gen", "skill.md"), "utf8");
  const rewritten = plugin.rewritePaths(skill);
  check("diagram destination stays .cursor/docs/architecture/",
    rewritten.includes(".cursor/docs/architecture/") && !rewritten.includes("${CLAUDE_PLUGIN_ROOT}/docs/architecture/"),
    rewritten.slice(rewritten.indexOf("architecture") - 40, rewritten.indexOf("architecture") + 80));
  const start = plugin.rewritePaths("Full runbook: `.cursor/docs/IDEA-TO-PRODUCTION.md`.");
  check("shipped runbook path is rewritten into the plugin",
    start.includes("${CLAUDE_PLUGIN_ROOT}/docs/IDEA-TO-PRODUCTION.md"), start);
}

section("build-plugin.mjs — check compares installed bytes, not only the stamp");
{
  const root = fixture("plug-digest");
  mkdirSync(join(root, "plugin", "skills", "x"), { recursive: true });
  mkdirSync(join(root, "plugin", ".claude-plugin"), { recursive: true });
  writeFileSync(join(root, "plugin", "skills", "x", "SKILL.md"), "# original\n");
  const first = plugin.digestPluginTree(join(root, "plugin"));
  writeFileSync(join(root, "plugin", ".claude-plugin", "BUILD"), `${first.digest}\n1 files\n`);
  check("stamp matches the tree it was computed from", plugin.digestPluginTree(join(root, "plugin")).digest === first.digest, first.digest);

  writeFileSync(join(root, "plugin", "skills", "x", "SKILL.md"), "# edited without updating BUILD\n");
  const after = plugin.digestPluginTree(join(root, "plugin"));
  check("editing a shipped skill without touching BUILD changes the tree digest",
    after.digest !== first.digest, `${first.digest} vs ${after.digest}`);
}

report("Plugin output paths, --out safety, and installed-tree digest are checked as behaviour.");
