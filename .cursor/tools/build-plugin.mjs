#!/usr/bin/env node
/**
 * build-plugin.mjs — produces the distributable Claude Code plugin.
 *
 * WHY THIS IS A BUILD, NOT A SYMLINK
 *
 * In this repo, `.claude/skills/<n>/SKILL.md` is a 40-line shim that says "read
 * `.cursor/skills/<n>/skill.md`". That works here because `.cursor/` is right
 * there.
 *
 * A plugin is installed into somebody else's repository. `.cursor/` does not
 * exist there. Every shim would point at nothing, and every skill would fail
 * silently — the worst possible failure mode, because the agent would simply
 * behave as if the platform were not installed.
 *
 * So the plugin tree is SELF-CONTAINED: full skill bodies, the rules and tools
 * they reference, and every path rewritten to ${CLAUDE_PLUGIN_ROOT}.
 *
 * The output is a generated artifact. It is committed because a marketplace
 * with a local `./plugin` source has to be able to fetch it, and CI checks it is
 * in sync — the same contract as the shims. Never hand-edit it.
 *
 * Usage:
 *   node .cursor/tools/build-plugin.mjs build [--out plugin]
 *   node .cursor/tools/build-plugin.mjs check          # is the tree in sync?
 *
 * Exit codes:  0 = ok   1 = out of sync (check)   2 = usage / missing input
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.env.CLAUDE_PROJECT_DIR || repoRoot() || process.cwd();
const SRC_SKILLS = join(ROOT, ".cursor", "skills");
const SRC_RULES = join(ROOT, ".cursor", "rules");
const SRC_TOOLS = join(ROOT, ".cursor", "tools");
const SRC_DOCS = join(ROOT, ".cursor", "docs");
const SRC_AGENTS = join(ROOT, ".claude", "agents");

/**
 * Docs that ship. Skills reference these by path at run time - rule 00 tells the
 * agent to read skill-catalog.md, generators point at shared-execution-pipeline.
 * A reference to a doc that did not travel is a dead end in someone else's repo.
 *
 * The rest stay behind: the historical reports and the proposal review describe
 * how THIS repo got here, which is of no use inside a consuming project.
 */
const SHIPPED_DOCS = new Set([
  "skill-catalog.md", "skill-graph.md", "shared-execution-pipeline.md",
  "START-HERE.md", "mcp-ecosystem.md", "APPLY-TO-PROJECT.md", "NEW-PROJECT.md",
]);
const SRC_HOOKS = join(ROOT, ".claude", "hooks");
const DESCRIPTIONS = join(ROOT, ".claude", "skills", "_descriptions.json");

const out = (s = "") => process.stdout.write(s + "\n");
function fail(msg, code = 2) { process.stderr.write(msg + "\n"); process.exit(code); }
function repoRoot() {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { stdio: "pipe" }).toString().trim(); }
  catch { return null; }
}
const read = (p) => readFileSync(p, "utf8");
const write = (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s, "utf8"); };

// --------------------------------------------------------------- rewriting --

/**
 * Rewrite in-repo paths to plugin-root paths.
 *
 * A skill that says "read .cursor/rules/02-...mdc" is correct in this repo and
 * wrong everywhere else. ${CLAUDE_PLUGIN_ROOT} is the only path that resolves in
 * an installed plugin.
 *
 * memory-bank/ is deliberately NOT rewritten: it stays in the consuming project,
 * because it holds that project's own conventions. That is the whole point of
 * the tier split — the plugin ships the machinery, the repo keeps its truth.
 */
function rewritePaths(text) {
  return text
    .replace(/`\.cursor\/rules\//g, "`${CLAUDE_PLUGIN_ROOT}/rules/")
    .replace(/(?<!`)\.cursor\/rules\//g, "${CLAUDE_PLUGIN_ROOT}/rules/")
    .replace(/`\.cursor\/docs\//g, "`${CLAUDE_PLUGIN_ROOT}/docs/")
    .replace(/(?<!`)\.cursor\/docs\//g, "${CLAUDE_PLUGIN_ROOT}/docs/")
    .replace(/`\.cursor\/tools\//g, "`${CLAUDE_PLUGIN_ROOT}/tools/")
    .replace(/node \.cursor\/tools\//g, "node ${CLAUDE_PLUGIN_ROOT}/tools/")
    .replace(/(?<!`|\/)\.cursor\/tools\//g, "${CLAUDE_PLUGIN_ROOT}/tools/")
    // Skill-to-skill references become slash commands, which resolve wherever
    // the plugin is installed.
    .replace(/`\.cursor\/skills\/([a-z0-9-]+)\/skill\.md`/g, "`/$1`")
    .replace(/\.cursor\/skills\/([a-z0-9-]+)\/skill\.md/g, "/$1")
    // Glob forms (.cursor/skills/*/skill.md) name no single skill, so they
    // become a path into the plugin's own skills directory instead.
    .replace(/`?\.cursor\/skills\/\*\/skill\.md`?/g, "`${CLAUDE_PLUGIN_ROOT}/skills/*/SKILL.md`")
    .replace(/`?\.cursor\/skills\/`?/g, "`${CLAUDE_PLUGIN_ROOT}/skills/`")
    // The cache lives in the consuming project, not the plugin.
    .replace(/\$\{CLAUDE_PLUGIN_ROOT\}\/cache\//g, ".cursor/cache/");
}

/** Frontmatter description: hand-written override wins, else extract. */
function descriptionFor(name, body, overrides) {
  if (overrides[name]) return `${overrides[name]} Invoked as /${name}.`;
  const m = body.match(/^##\s+Overview\s*$/m);
  let section = m ? body.slice(m.index + m[0].length) : body;
  section = section.split(/^##\s+/m)[0];
  const paras = section.split("\n\n").map(s => s.trim())
    .filter(s => s && !/^(---|#|\||```|>|-|\*|\d+\.)/.test(s) && !s.startsWith("**Memory references"));
  const clean = (t) => t.replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\s+/g, " ").trim();
  for (const p of paras) {
    const c = clean(p);
    if (c.length > 60) {
      const d = c.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
      return `${d.length > 400 ? d.slice(0, 397).replace(/\s+\S*$/, "") + "..." : d} Invoked as /${name}.`;
    }
  }
  return `Runs the ${name} workflow. Invoked as /${name}.`;
}

// ------------------------------------------------------------------ build ---
function build(args) {
  const oi = args.indexOf("--out");
  const OUT = join(ROOT, oi >= 0 ? args[oi + 1] : "plugin");

  if (!existsSync(SRC_SKILLS)) fail(`No ${SRC_SKILLS}. Nothing to build.`, 2);
  let overrides = {};
  try { overrides = JSON.parse(read(DESCRIPTIONS)); delete overrides["//"]; } catch { /* optional */ }

  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  const manifest = [];
  const emit = (rel, content) => { write(join(OUT, rel), content); manifest.push(rel); };

  // ---- skills: FULL body, paths rewritten -------------------------------
  const names = readdirSync(SRC_SKILLS)
    .filter(d => existsSync(join(SRC_SKILLS, d, "skill.md"))).sort();

  for (const n of names) {
    const body = read(join(SRC_SKILLS, n, "skill.md"));
    const desc = rewritePaths(descriptionFor(n, body, overrides))
      .replace(/\$\{CLAUDE_PLUGIN_ROOT\}\/(rules|docs|tools|skills)\//g, "")
      .replace(/"/g, "'");
    emit(`skills/${n}/SKILL.md`,
`---
name: ${n}
description: "${desc}"
---

<!-- GENERATED from the cursor-platform source skill "${n}".
     Do not edit here - edit the source and re-run the plugin build. -->

${rewritePaths(body)}
`);
  }

  // ---- rules: skills reference these, so they must travel with them ------
  if (existsSync(SRC_RULES)) {
    for (const f of readdirSync(SRC_RULES).filter(f => f.endsWith(".mdc")).sort()) {
      emit(`rules/${f}`, rewritePaths(read(join(SRC_RULES, f))));
    }
  }

  // ---- tools: the validators skills invoke ------------------------------
  if (existsSync(SRC_TOOLS)) {
    for (const f of readdirSync(SRC_TOOLS).filter(f => f.endsWith(".mjs")).sort()) {
      if (f === "build-plugin.mjs") continue;      // build tooling does not ship
      emit(`tools/${f}`, read(join(SRC_TOOLS, f)));
    }
  }

  // ---- docs the skills point at ----------------------------------------
  if (existsSync(SRC_DOCS)) {
    for (const f of readdirSync(SRC_DOCS).filter(f => SHIPPED_DOCS.has(f)).sort()) {
      emit(`docs/${f}`, rewritePaths(read(join(SRC_DOCS, f))));
    }
  }

  // ---- agents ------------------------------------------------------------
  if (existsSync(SRC_AGENTS)) {
    for (const f of readdirSync(SRC_AGENTS).filter(f => f.endsWith(".md")).sort()) {
      emit(`agents/${f}`, rewritePaths(read(join(SRC_AGENTS, f))));
    }
  }

  // ---- hooks + their wiring ---------------------------------------------
  if (existsSync(SRC_HOOKS)) {
    for (const f of readdirSync(SRC_HOOKS).filter(f => f.endsWith(".mjs")).sort()) {
      emit(`hooks/${f}`, read(join(SRC_HOOKS, f)));
    }
    const P = "${CLAUDE_PLUGIN_ROOT}";
    emit("hooks/hooks.json", JSON.stringify({
      "//": "GENERATED. Hook wiring for the installed plugin. Paths are plugin-relative because the plugin does not live in the consuming repo.",
      SessionStart: [{ hooks: [{ type: "command", command: `node ${P}/hooks/session-start.mjs`, timeout: 20 }] }],
      PreToolUse: [
        { matcher: "Write|Edit|MultiEdit|NotebookEdit", hooks: [
          { type: "command", command: `node ${P}/hooks/guard-write.mjs`, timeout: 15 },
          { type: "command", command: `node ${P}/hooks/guard-phase.mjs`, timeout: 15 },
        ] },
        { matcher: "Bash", hooks: [{ type: "command", command: `node ${P}/hooks/guard-bash.mjs`, timeout: 15 }] },
        { matcher: "mcp__.*", hooks: [{ type: "command", command: `node ${P}/hooks/guard-mcp.mjs`, timeout: 15 }] },
      ],
      PostToolUse: [{ matcher: "Write|Edit|MultiEdit", hooks: [{ type: "command", command: `node ${P}/hooks/post-edit-verify.mjs`, timeout: 120 }] }],
      Stop: [{ hooks: [{ type: "command", command: `node ${P}/hooks/stop-memory-check.mjs`, timeout: 20 }] }],
    }, null, 2) + "\n");

    // Cursor wiring, same scripts. Its events are camelCase and it has a
    // purpose-built shell hook, so this is not a rename of the block above -
    // beforeShellExecution replaces the Bash matcher entirely.
    const CP = "${PLUGIN_ROOT}";
    emit("hooks/cursor-hooks.json", JSON.stringify({
      "//": "GENERATED. Cursor hook wiring for the installed plugin. Matchers are deliberately absent: a matcher that does not match is a guard that silently never fires, and each script exits in microseconds when the payload is not its own.",
      version: 1,
      hooks: {
        sessionStart: [{ command: `node ${CP}/hooks/session-start.mjs`, timeout: 20 }],
        preToolUse: [
          { command: `node ${CP}/hooks/guard-write.mjs`, timeout: 15 },
          { command: `node ${CP}/hooks/guard-phase.mjs`, timeout: 15 },
        ],
        beforeShellExecution: [{ command: `node ${CP}/hooks/guard-bash.mjs`, timeout: 15 }],
        beforeMCPExecution: [{ command: `node ${CP}/hooks/guard-mcp.mjs`, timeout: 15 }],
        afterFileEdit: [{ command: `node ${CP}/hooks/post-edit-verify.mjs`, timeout: 120 }],
        stop: [{ command: `node ${CP}/hooks/stop-memory-check.mjs`, timeout: 20 }],
      },
    }, null, 2) + "\n");
  }

  // ---- the schemas artifact-schema.mjs reads ----------------------------
  // The tool is useless without them: it would run, find no grammar, and grade
  // nothing - the same silent no-op the hooks were bitten by twice.
  const schemaDir = join(ROOT, "schemas");
  if (existsSync(schemaDir)) {
    for (const f of readdirSync(schemaDir).filter((x) => x.endsWith(".json")).sort()) {
      emit(`schemas/${f}`, read(join(schemaDir, f)));
    }
  }

  // ---- the MCP policy the guard reads -----------------------------------
  // Shipped as a starting point, not a fixture: a consuming repo has its own
  // servers. guard-mcp allows anything the file does not mention, so an
  // unedited copy governs the four servers this platform ships and stays out of
  // the way of everything else.
  const pol = join(ROOT, ".cursor", "mcp-policy.json");
  if (existsSync(pol)) emit("mcp-policy.json", read(pol));

  // ---- MCP: same servers, no secrets ------------------------------------
  // Two names for one file: Claude Code reads .mcp.json, Cursor reads mcp.json
  // at the plugin root. Copying is cheaper than asking either host to be flexible.
  const mcp = join(ROOT, ".mcp.json");
  if (existsSync(mcp)) { emit(".mcp.json", read(mcp)); emit("mcp.json", read(mcp)); }

  // ---- two manifests, one tree ------------------------------------------
  //
  // The directory layout this builder already produced - skills/<n>/SKILL.md,
  // rules/*.mdc, agents/*.md, hooks/ - happens to be exactly what BOTH hosts
  // expect by default, so the whole tree is shared and only the manifests differ:
  //
  //   Claude Code   .claude-plugin/plugin.json   hooks/hooks.json
  //   Cursor        .cursor-plugin/plugin.json   hooks/cursor-hooks.json
  //
  // A Cursor Plugin (not an Agent Plugin) is the right shape: per Cursor's own
  // component table an Agent Plugin carries only skills and MCP servers, so the
  // 12 rules, 14 agents and 6 hooks - most of this platform - would not travel.
  //
  // KNOWN LIMITATION. rewritePaths() stamps ${CLAUDE_PLUGIN_ROOT} into 184 prose
  // references across 57 skill and rule bodies. Cursor does not define that
  // variable, so a `node ${CLAUDE_PLUGIN_ROOT}/tools/...` line inside a skill
  // will not resolve there. It is not fatal - Cursor auto-applies rules and
  // skills from the manifest, which is the reason those instructions exist in the
  // Claude tree at all - but it is wrong, and emitting a second full tree to fix
  // one token is a worse trade. rewritePaths() takes the token as an argument so
  // a per-host build is a one-line change when that trade shifts.
  const src = JSON.parse(read(join(ROOT, ".claude-plugin", "plugin.json")));
  const shared = {
    name: src.name, description: src.description, version: src.version,
    author: src.author, homepage: src.homepage, license: src.license,
    keywords: src.keywords,
  };

  emit(".claude-plugin/plugin.json", JSON.stringify({
    ...src,
    agents: "./agents",
    hooks: "./hooks/hooks.json",
    mcpServers: "./.mcp.json",
  }, null, 2) + "\n");

  emit(".cursor-plugin/plugin.json", JSON.stringify({
    "//": "GENERATED by .cursor/tools/build-plugin.mjs. Cursor Plugin manifest - carries rules, agents, skills and hooks, which an Agent Plugin cannot.",
    ...shared,
    rules: "./rules",
    agents: "./agents",
    skills: "./skills",
    hooks: "./hooks/cursor-hooks.json",
    mcpServers: "./mcp.json",
  }, null, 2) + "\n");

  // ---- what the consuming repo still has to provide ----------------------
  // _lib.mjs is a helper and sync-skills.mjs is a generator; neither is a hook.
  const HOOK_COUNT = existsSync(SRC_HOOKS)
    ? readdirSync(SRC_HOOKS).filter(f => f.endsWith(".mjs") && !["_lib.mjs", "sync-skills.mjs"].includes(f)).length
    : 0;

  emit("README.md",
`# cursor-platform — installed plugin

**Generated.** Built from the platform repo by \`.cursor/tools/build-plugin.mjs\`.
Do not edit anything here; edit the source and rebuild.

Installs in **both** hosts from one tree - the layout below is what each expects
by default, so only the manifests differ:

| | Manifest | Hooks | MCP |
|---|---|---|---|
| Claude Code | \`.claude-plugin/plugin.json\` | \`hooks/hooks.json\` | \`.mcp.json\` |
| Cursor | \`.cursor-plugin/plugin.json\` | \`hooks/cursor-hooks.json\` | \`mcp.json\` |

It is a Cursor Plugin, not an Agent Plugin: an Agent Plugin carries only skills
and MCP servers, so the rules, agents and hooks would not travel.

> Known limitation: prose inside skills and rules refers to CLAUDE_PLUGIN_ROOT,
> which Cursor does not define. Rules and skills are auto-applied there from the
> manifest, so this affects only the tool command lines a skill may print.

## What this plugin ships

| | Count |
|---|---|
| Skills | ${names.length} |
| Rules | ${existsSync(SRC_RULES) ? readdirSync(SRC_RULES).filter(f => f.endsWith(".mdc")).length : 0} |
| Subagents | ${existsSync(SRC_AGENTS) ? readdirSync(SRC_AGENTS).filter(f => f.endsWith(".md")).length : 0} |
| Hooks | ${HOOK_COUNT} + wiring |
| Validators | ${existsSync(SRC_TOOLS) ? readdirSync(SRC_TOOLS).filter(f => f.endsWith(".mjs") && f !== "build-plugin.mjs").length : 0} |
| Reference docs | ${existsSync(SRC_DOCS) ? readdirSync(SRC_DOCS).filter(f => SHIPPED_DOCS.has(f)).length : 0} |

## What it deliberately does NOT ship

**\`memory-bank/\`.** That is your project's own truth — architecture, coding
standards, business rules, glossary. Shipping a generic copy would be worse than
shipping nothing, because every generator reads it and would then imitate
somebody else's conventions.

Create it in your repo from the platform's template and fill in Tier 2 before
generating anything. An hour there is the difference between code that matches
your codebase and code that merely compiles.

**\`CLAUDE.md\`.** Your repo's entry point, which imports your \`AGENTS.md\`.

**\`templates/\`.** The build gates are installed into your solution one at a
time, deliberately — see the platform repo's \`templates/README.md\`.

## After installing

\`\`\`
/repo-discovery full
/context-sync
\`\`\`
`);

  // ---- integrity stamp, so `check` is cheap ------------------------------
  const h = createHash("sha256");
  for (const rel of manifest.sort()) h.update(rel).update(read(join(OUT, rel)));
  const digest = h.digest("hex").slice(0, 16);
  write(join(OUT, ".claude-plugin", "BUILD"), `${digest}\n${manifest.length} files\n`);

  out(`Built ${manifest.length} files into ${oi >= 0 ? args[oi + 1] : "plugin"}/`);
  out(`  ${names.length} skills (full bodies, paths rewritten to \${CLAUDE_PLUGIN_ROOT})`);
  out(`  digest ${digest}`);
  out(``);
  out(`The tree is generated. Commit it — a marketplace with a local ./plugin`);
  out(`source has to fetch it — and let CI check it stays in sync.`);
  return 0;
}

// ------------------------------------------------------------------ check ---
function check(args) {
  const oi = args.indexOf("--out");
  const rel = oi >= 0 ? args[oi + 1] : "plugin";
  const OUT = join(ROOT, rel);
  const stamp = join(OUT, ".claude-plugin", "BUILD");
  if (!existsSync(stamp)) fail(`No ${rel}/ build found. Run: node .cursor/tools/build-plugin.mjs build`, 1);

  const before = read(stamp);
  const tmp = `${rel}.__check__`;
  build(["--out", tmp]);
  const after = read(join(ROOT, tmp, ".claude-plugin", "BUILD"));
  rmSync(join(ROOT, tmp), { recursive: true, force: true });

  if (before.trim() !== after.trim()) {
    process.stderr.write(
`${rel}/ is out of sync with the source.
  committed: ${before.split("\\n")[0]}
  rebuilt:   ${after.split("\\n")[0]}
Run: node .cursor/tools/build-plugin.mjs build
`);
    return 1;
  }
  out(`${rel}/ is in sync (${before.split("\n")[0]}).`);
  return 0;
}

const CMDS = { build, check };
const [cmd, ...args] = process.argv.slice(2);
if (!cmd || !CMDS[cmd]) {
  out(read(new URL(import.meta.url)).split("\n").slice(2, 28).join("\n").replace(/^\s*\*\/?\s?/gm, "").trim());
  process.exit(cmd ? 2 : 0);
}
process.exit(CMDS[cmd](args) ?? 0);
