#!/usr/bin/env node
/**
 * eval.test.mjs — idea 1: plugin-only smoke plus representative layouts.
 *
 * Not full applications and not a Win/Linux × Node matrix. Small trees that
 * stack-profile and a plugin install must classify the same way every run.
 */

import { join } from "node:path";
import { cpSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fixture, check, report, section, REPO, runTool, put } from "../_harness.mjs";

function runFrom(script, input, cwd, extraEnv = {}) {
  return spawnSync(process.execPath, [script], {
    input: input == null ? undefined : JSON.stringify(input),
    encoding: "utf8",
    cwd,
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, LIFECYCLE_OVERRIDE: "", CLAUDE_ALLOW_TIER2_EDIT: "", CURSOR_PLATFORM_DEV: "", ...extraEnv },
    timeout: 20_000,
  });
}

section("plugin-only smoke — hooks and tools as siblings, no .cursor/tools");
{
  const root = fixture("eval-plugin-smoke", { withTools: false, writePolicy: false, mcpPolicy: null });
  const plug = join(root, "plugin-install");
  mkdirSync(join(plug, "hooks"), { recursive: true });
  mkdirSync(join(plug, "tools"), { recursive: true });
  cpSync(join(REPO, ".claude", "hooks"), join(plug, "hooks"), { recursive: true });
  for (const t of ["_policy.mjs", "_findings.mjs", "_skills-index.mjs"]) {
    cpSync(join(REPO, ".cursor", "tools", t), join(plug, "tools", t));
  }

  const bash = runFrom(join(plug, "hooks", "guard-bash.mjs"), {
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "git status" },
  }, root);
  let body = null;
  try { body = JSON.parse(bash.stdout || ""); } catch { /* Cursor vs Claude */ }
  check("plugin-layout guard-bash allows git status",
    bash.status === 0 && (body?.permission === "allow" || /allow/.test(bash.stdout || "") || bash.stdout === "" && !/BLOCKED/.test(bash.stderr || "")),
    `exit ${bash.status} stdout ${JSON.stringify((bash.stdout || "").slice(0, 200))} stderr ${JSON.stringify((bash.stderr || "").slice(0, 200))}`);

  const roots = spawnSync(process.execPath, [join(plug, "tools", "_policy.mjs"), "roots"], {
    encoding: "utf8", cwd: root, timeout: 10_000,
  });
  check("plugin-layout _policy.mjs roots prints src", roots.status === 0 && /(?:^|\n)src(?:\n|$)/.test(roots.stdout || ""), roots.stdout || roots.stderr);
}

section("plugin-only smoke — built plugin tree when present");
{
  const builtHooks = join(REPO, "plugin", "hooks", "guard-bash.mjs");
  const builtPolicy = join(REPO, "plugin", "tools", "_policy.mjs");
  if (!existsSync(builtHooks)) {
    check("built plugin hooks exist (rebuild skipped this assertion)", false, `missing ${builtHooks}`);
  } else {
    const root = fixture("eval-built-plugin", { withTools: false, writePolicy: false, mcpPolicy: null });
    const bash = runFrom(builtHooks, {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git status" },
    }, root);
    check("built plugin guard-bash allows git status", bash.status === 0 && !/BLOCKED/.test(bash.stderr || ""),
      `exit ${bash.status} stderr ${JSON.stringify((bash.stderr || "").slice(0, 200))}`);
    if (existsSync(builtPolicy)) {
      const roots = spawnSync(process.execPath, [builtPolicy, "roots"], { encoding: "utf8", cwd: root, timeout: 10_000 });
      check("built plugin _policy.mjs roots prints src", roots.status === 0 && /src/.test(roots.stdout || ""), roots.stdout || roots.stderr);
    }
  }
}

const CSPROJ = `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>\n`;

section("representative layouts — stack-profile detect (known-good / known-bad)");
{
  const layouts = [
    { name: "eval-dotnet", expect: "dotnet-api", write(root) {
      put(root, "src/Api.csproj", CSPROJ);
    } },
    { name: "eval-react", expect: "react-frontend", write(root) {
      put(root, "package.json", JSON.stringify({ dependencies: { react: "19.0.0" } }) + "\n");
      put(root, "frontend/App.tsx", "export default function App() { return null; }\n");
    } },
    { name: "eval-packages", expect: "packages-monorepo", write(root) {
      put(root, "packages/lib/index.js", "export const x = 1;\n");
    } },
    { name: "eval-fullstack", expect: "fullstack", write(root) {
      put(root, "src/Api.csproj", CSPROJ);
      put(root, "package.json", JSON.stringify({ dependencies: { react: "19.0.0" } }) + "\n");
    } },
    { name: "eval-brownfield", expect: "dotnet-api", write(root) {
      put(root, "src/Legacy.csproj", CSPROJ);
      put(root, "packages/legacy/Util.cs", "namespace Legacy;\n");
    } },
    { name: "eval-empty", expect: "unknown", write() { /* known-bad / unclassified */ } },
  ];

  for (const layout of layouts) {
    const root = fixture(layout.name, { withTools: true });
    layout.write(root);
    const r = runTool("stack-profile.mjs", ["detect", "--json"], root);
    let body = null;
    try { body = JSON.parse(r.out); } catch { /* below */ }
    check(`${layout.name} detects ${layout.expect}`, r.exit === 0 && body?.id === layout.expect,
      `${r.exit} ${r.out.slice(0, 300)} ${r.err.slice(0, 200)}`);
  }
}

report("Plugin-only smoke plus representative layouts classify the way the fixtures declare.");
