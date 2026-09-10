#!/usr/bin/env node
/**
 * doctor.mjs — read-only install diagnosis and copy-preview.
 *
 * WHY THIS EXISTS
 *
 * self-audit.mjs answers "are the controls wired". It does not answer "what
 * kind of install is this", "which source roots would the policy gate", or
 * "would a checkout copy overwrite something". Those questions belong here so
 * an adopter can see the layout before anyone writes files.
 *
 * This tool never writes. Proposed repairs are named; apply is `repair.mjs`
 * in an isolated --out directory.

 *
 * Usage:
 *   node .cursor/tools/doctor.mjs diagnose [--json]
 *   node .cursor/tools/doctor.mjs preview [--from <platform-root>] [--json]
 *
 * Exit codes:  0 = no blocking findings   1 = blocking findings   2 = usage
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { report, emit, block, warn, info } from "./_findings.mjs";
import { SOURCE_ROOTS, sourceLayout, loadWritePolicy } from "./_policy.mjs";
import { build as buildIndex, fingerprint, read as readIndex } from "./_skills-index.mjs";
import { detect as detectStack } from "./stack-profile.mjs";

const ROOT = process.env.CLAUDE_PROJECT_DIR || repoRoot() || process.cwd();

const EXPECTED_HOOKS = [
  "guard-write.mjs", "guard-phase.mjs", "guard-bash.mjs", "guard-mcp.mjs",
  "session-start.mjs", "_lib.mjs", "_sql.mjs",
];

/** Paths NEW-PROJECT.md / APPLY-TO-PROJECT.md copy from a checkout. */
const COPY_PATHS = [".cursor", ".claude", "memory-bank", "schemas", "AGENTS.md", "CLAUDE.md"];

function repoRoot() {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

function exists(root, rel) {
  try { return existsSync(join(root, rel)); } catch { return false; }
}

const REPAIR_FOR = {
  "missing-hook": "copy the missing hook from the plugin or platform checkout into .claude/hooks (preview via doctor.mjs preview)",
  "index-stale": "node .cursor/tools/repair.mjs preview skills-index-stale",
  "unguarded-root": "add the directory to write-policy.json application-source.match, then node .cursor/tools/_policy.mjs layout",
  "policy-malformed": "fix JSON or replace from built-in: node .cursor/tools/repair.mjs preview write-policy-missing",
};

export function installMode(root) {
  const cursorTools = exists(root, join(".cursor", "tools", "lifecycle.mjs"));
  const pluginManifest = exists(root, join(".claude-plugin", "plugin.json"));
  const pluginHooks = exists(root, join("plugin", "hooks", "guard-phase.mjs"));
  if (pluginManifest && cursorTools) return "platform-source";
  if (cursorTools) return "copy";
  if (process.env.CLAUDE_PLUGIN_ROOT || pluginHooks) return "plugin";
  return "unknown";
}

function hooksDir(root, mode) {
  if (process.env.CLAUDE_PLUGIN_ROOT) return join(process.env.CLAUDE_PLUGIN_ROOT, "hooks");
  if (mode === "plugin") return join(root, "plugin", "hooks");
  return join(root, ".claude", "hooks");
}

function hashFile(abs) {
  try { return createHash("sha256").update(readFileSync(abs)).digest("hex"); }
  catch { return null; }
}

function nodeMajor() {
  const m = /^v(\d+)/.exec(process.version);
  return m ? Number(m[1]) : 0;
}

export function diagnose(root = ROOT) {
  const findings = [];
  const mode = installMode(root);
  const layout = sourceLayout(root, { importMetaUrl: import.meta.url });
  const policyPath = join(root, ".cursor", "lifecycle", "write-policy.json");
  let policySource = "built-in fallback";
  try {
    if (existsSync(policyPath)) {
      JSON.parse(readFileSync(policyPath, "utf8"));
      policySource = ".cursor/lifecycle/write-policy.json";
    }
  } catch {
    policySource = "malformed local file (built-in in effect)";
    findings.push(warn("policy-malformed", "write-policy.json exists but is not JSON; the built-in fallback is in effect", { file: ".cursor/lifecycle/write-policy.json" }));
  }
  // Touch loadWritePolicy so a missing file still resolves the same fallback status uses.
  loadWritePolicy(root, { importMetaUrl: import.meta.url });

  findings.push(info("install-mode", `install mode is ${mode}`, { ref: mode }));
  findings.push(info("node-version", `Node ${process.version}`, { ref: process.version }));
  if (nodeMajor() && nodeMajor() < 22) {
    findings.push(warn("node-version", `Node ${process.version} is older than 22; the platform is developed and tested on 22+`, { ref: process.version }));
  }

  const dir = hooksDir(root, mode);
  const present = [];
  const missing = [];
  for (const h of EXPECTED_HOOKS) {
    if (existsSync(join(dir, h))) present.push(h);
    else missing.push(h);
  }
  const adopted = exists(root, join("lifecycle", "state.json"));
  if (missing.length) {
    const msg = `missing hook(s) ${missing.join(", ")} under ${dir.replace(/\\/g, "/")}`;
    findings.push((adopted ? block : warn)("missing-hook", msg, { file: dir.replace(/\\/g, "/") }));
  } else {
    findings.push(info("hooks", `${present.length} expected hooks present`, { file: dir.replace(/\\/g, "/") }));
  }

  findings.push(info("write-policy", `effective policy: ${policySource}`, { ref: policySource }));
  for (const d of layout.uncovered) {
    findings.push(warn("unguarded-root", `${d}/ is a source root the write-policy does not gate`, { file: `${d}/` }));
  }
  if (layout.detected.length) {
    findings.push(info("source-layout", `detected ${layout.detected.join(", ")} (covered ${layout.covered.join(", ") || "none"})`, { ref: layout.detected.join(",") }));
  } else {
    findings.push(info("source-layout", "no conventional source root detected", { ref: SOURCE_ROOTS.join(",") }));
  }

  const expected = buildIndex(root);
  const onDisk = readIndex(root);
  if (expected.count && !onDisk) {
    findings.push(warn("index-stale", "skills.index.json is missing — run node .claude/hooks/sync-skills.mjs", { file: ".cursor/skills.index.json" }));
  } else if (onDisk && fingerprint(onDisk) !== fingerprint(expected)) {
    findings.push(warn("index-stale", "skills.index.json does not match .cursor/skills/", { file: ".cursor/skills.index.json" }));
  } else if (onDisk) {
    findings.push(info("skills-index", `${onDisk.count} skill(s) indexed`, { file: ".cursor/skills.index.json" }));
  }

  if (!adopted) {
    findings.push(info("lifecycle", "no lifecycle/state.json — this repo has not adopted the six-phase lifecycle", { file: "lifecycle/state.json" }));
  } else {
    findings.push(info("lifecycle", "lifecycle/state.json present", { file: "lifecycle/state.json" }));
  }

  const stack = detectStack(root);
  findings.push(info("stack-profile", `detected stack ${stack.id} (preview only; nothing installed)`, { ref: stack.id }));
  for (const f of findings) {
    if (REPAIR_FOR[f.code]) f.detail = { ...(typeof f.detail === "object" && f.detail ? f.detail : {}), repair: REPAIR_FOR[f.code] };
  }

  const data = { mode, node: process.version, hooksDir: dir.replace(/\\/g, "/"), present, missing, policySource, layout, adopted, stack };
  const blocks = findings.filter((f) => f.severity === "block").length;
  return report({
    tool: "doctor.mjs",
    command: "diagnose",
    findings,
    data,
    summary: blocks ? `${blocks} blocking finding(s); install mode ${mode}` : `install mode ${mode}; ${findings.length} note(s)`,
  });
}

function previewEntry(rel, destRoot, fromRoot) {
  const dest = join(destRoot, rel);
  const destExists = existsSync(dest);
  if (!fromRoot) {
    return { path: rel, status: destExists ? "present" : "would-copy" };
  }
  const src = join(fromRoot, rel);
  const srcExists = existsSync(src);
  if (!srcExists) return { path: rel, status: "skip", reason: "not in --from tree" };
  if (!destExists) return { path: rel, status: "would-copy" };
  let destFile = false, srcFile = false;
  try { destFile = statSync(dest).isFile(); } catch { /* missing */ }
  try { srcFile = statSync(src).isFile(); } catch { /* missing */ }
  if (destFile && srcFile) {
    const a = hashFile(dest), b = hashFile(src);
    return { path: rel, status: a && b && a === b ? "keep" : "conflict" };
  }
  return { path: rel, status: "present" };
}

export function preview(root = ROOT, fromRoot = null) {
  const findings = [];
  const entries = COPY_PATHS.map((rel) => previewEntry(rel, root, fromRoot));
  for (const e of entries) {
    if (e.status === "would-copy") findings.push(info("would-copy", `${e.path} is missing and would be copied`, { file: e.path }));
    else if (e.status === "conflict") findings.push(warn("conflict", `${e.path} exists and differs from --from`, { file: e.path }));
    else if (e.status === "keep") findings.push(info("keep", `${e.path} matches --from`, { file: e.path }));
    else if (e.status === "present") findings.push(info("present", `${e.path} already exists`, { file: e.path }));
  }
  const conflicts = entries.filter((e) => e.status === "conflict").length;
  return report({
    tool: "doctor.mjs",
    command: "preview",
    findings,
    data: { from: fromRoot, entries },
    summary: conflicts ? `${conflicts} conflict(s) with --from` : `copy preview: ${entries.length} path(s)`,
    ok: true,
    exit: 0,
  });
}

function printDiagnose(r) {
  const d = r.data || {};
  process.stdout.write(`# doctor diagnose\n\n`);
  process.stdout.write(`  install mode : ${d.mode}\n`);
  process.stdout.write(`  Node         : ${d.node}\n`);
  process.stdout.write(`  hooks        : ${d.hooksDir}\n`);
  process.stdout.write(`  policy       : ${d.policySource}\n`);
  if (d.stack) process.stdout.write(`  stack        : ${d.stack.id}\n`);
  if (d.layout) {
    process.stdout.write(`  source roots : detected [${(d.layout.detected || []).join(", ")}]\n`);
    process.stdout.write(`                 covered  [${(d.layout.covered || []).join(", ")}]\n`);
    if ((d.layout.uncovered || []).length) process.stdout.write(`                 uncovered[${d.layout.uncovered.join(", ")}]\n`);
  }
  process.stdout.write(`\n`);
  for (const f of r.findings) {
    process.stdout.write(`  ${f.severity.padEnd(5)} ${f.code.padEnd(18)} ${f.message}\n`);
  }
  process.stdout.write(`\n${r.summary}\n`);
}

function printPreview(r) {
  process.stdout.write(`# doctor preview\n\n`);
  for (const e of r.data?.entries || []) {
    process.stdout.write(`  ${String(e.status).padEnd(12)} ${e.path}${e.reason ? ` (${e.reason})` : ""}\n`);
  }
  process.stdout.write(`\n${r.summary}\n`);
}

const invoked = (() => {
  try { return fileURLToPath(import.meta.url) === process.argv[1]; }
  catch { return false; }
})();
if (invoked) {
  const cmd = process.argv[2];
  const json = process.argv.includes("--json");
  const fromIdx = process.argv.indexOf("--from");
  const fromRoot = fromIdx >= 0 ? process.argv[fromIdx + 1] : null;
  if (cmd === "diagnose") {
    const r = diagnose(ROOT);
    if (json) process.exit(emit(r));
    printDiagnose(r);
    process.exit(r.exit);
  }
  if (cmd === "preview") {
    const r = preview(ROOT, fromRoot);
    if (json) process.exit(emit(r));
    printPreview(r);
    process.exit(r.exit);
  }
  process.stderr.write(`Usage: node .cursor/tools/doctor.mjs diagnose|preview [--json] [--from <platform-root>]\n`);
  process.stderr.write(`Read-only. Does not copy, patch, or write files.\n`);
  process.exit(2);
}
