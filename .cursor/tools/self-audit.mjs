#!/usr/bin/env node
/**
 * self-audit.mjs — is every control this platform claims actually connected?
 *
 * WHY THIS EXISTS, AND THE BUG THAT PROVES IT
 *
 * `guard-phase.mjs` was written, tested, documented and copied into the
 * distributable plugin — and never added to the plugin's generated hook wiring.
 * For everyone who installed the plugin rather than cloning the repo, the design
 * gate blocked nothing at all. Every document said it did.
 *
 * That is the most dangerous class of defect here, and it has its own shape: a
 * control that EXISTS but is not REACHABLE. It is worse than a missing control,
 * because a missing one is noticed and a disconnected one is trusted. And the
 * whole platform rests on the claim that the mechanical consent is the one that
 * cannot be argued with.
 *
 * `.cursor/hooks.json` already states the risk in its own comment: "Two copies
 * of a guard, one per editor, is how one of them silently stops being enforced."
 * Nothing checked that the two copies agreed.
 *
 * WHAT IT DOES NOT DO — the existing checkers own these
 *
 *   docs-lint.mjs          broken links, ghost skills, ghost tools, stale counts
 *   platform-metadata.mjs  every stated count against the real one
 *   build-plugin.mjs check the built plugin tree against the source
 *
 * `run` invokes all three and reports them, so there is one command. What this
 * file adds is only what none of them looks at: WIRING.
 *
 *   A1  every hook script is wired in Claude Code's settings AND Cursor's
 *   A2  every wired command points at a file that exists
 *   A3  the two hosts wire the same set — the guard that fires for one editor
 *       and not the other is invisible from inside either one
 *   A4  the built plugin wires them too — the original bug
 *   A5  every gate's reviewer and authors are real agents, and the reviewer is
 *       never one of the authors
 *   A6  no orphan tool: something built and then wired to nothing
 *   A7  this audit itself runs in CI, because an audit nobody runs is exactly
 *       the defect it exists to find
 *
 * Usage:
 *   node .cursor/tools/self-audit.mjs run [--json]      wiring + the three others
 *   node .cursor/tools/self-audit.mjs wiring [--json]   only the wiring checks
 *
 * Exit codes:  0 = everything connected   1 = a control is not reachable
 *              2 = usage
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.env.CLAUDE_PROJECT_DIR || repoRoot() || process.cwd();
function repoRoot() {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}
const out = (s = "") => process.stdout.write(s + "\n");
const pad = (s, n) => String(s).slice(0, n - 1).padEnd(n);
const read = (rel) => { try { return readFileSync(join(ROOT, rel), "utf8"); } catch { return null; } };
const readJson = (rel) => { const t = read(rel); if (t === null) return null; try { return JSON.parse(t); } catch { return null; } };
const ls = (rel) => { try { return readdirSync(join(ROOT, rel)); } catch { return []; } };

/**
 * Scripts in .claude/hooks/ that are NOT hooks. `_lib.mjs` is the shared
 * payload normaliser; `sync-skills.mjs` is a maintenance command run by hand.
 * Listing them here rather than inferring, because guessing wrong in the other
 * direction — treating a real hook as a utility — is how a guard goes unchecked.
 */
const NOT_HOOKS = new Set(["_lib.mjs", "sync-skills.mjs"]);

const findings = [];
const fail = (check, what, why) => findings.push({ sev: "FAIL", check, what, why });
const warn = (check, what, why) => findings.push({ sev: "warn", check, what, why });

/* ------------------------------------------------------------ A1 / A2 / A3 */

/** Every `node .claude/hooks/x.mjs` mentioned in a wiring file, and its event. */
function wiredIn(obj) {
  const found = new Map();
  const walk = (node, event) => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, event));
    if (!node || typeof node !== "object") return;
    if (typeof node.command === "string") {
      const m = node.command.match(/\.claude\/hooks\/([\w.-]+\.mjs)/);
      if (m) { if (!found.has(m[1])) found.set(m[1], new Set()); found.get(m[1]).add(event); }
    }
    for (const [k, v] of Object.entries(node)) if (k !== "command") walk(v, event === "?" ? k : event);
  };
  for (const [event, v] of Object.entries(obj?.hooks || {})) walk(v, event);
  return found;
}

function hookWiring() {
  const scripts = ls(".claude/hooks").filter((f) => f.endsWith(".mjs") && !NOT_HOOKS.has(f));
  const cc = readJson(".claude/settings.json");
  const cur = readJson(".cursor/hooks.json");
  if (!cc) fail("A2", ".claude/settings.json", "missing or unparseable — Claude Code has no hook wiring at all");
  if (!cur) fail("A2", ".cursor/hooks.json", "missing or unparseable — Cursor has no hook wiring at all");

  const ccMap = cc ? wiredIn(cc) : new Map();
  const curMap = cur ? wiredIn(cur) : new Map();

  for (const s of scripts) {
    if (cc && !ccMap.has(s)) fail("A1", `.claude/hooks/${s}`, "exists but is wired to no event in .claude/settings.json — it runs for nobody using Claude Code");
    if (cur && !curMap.has(s)) fail("A1", `.claude/hooks/${s}`, "exists but is wired to no event in .cursor/hooks.json — it runs for nobody using Cursor");
  }
  for (const [map, where] of [[ccMap, ".claude/settings.json"], [curMap, ".cursor/hooks.json"]]) {
    for (const s of map.keys()) if (!existsSync(join(ROOT, ".claude/hooks", s)))
      fail("A2", `${where} -> ${s}`, "wired to a script that does not exist. The host will fail this hook on every invocation, or skip it silently");
  }
  // The check the .cursor/hooks.json comment asks for and nothing performed.
  if (cc && cur) {
    const only = (a, b) => [...a.keys()].filter((k) => !b.has(k));
    for (const s of only(ccMap, curMap)) fail("A3", s, "wired for Claude Code but not for Cursor — the guard fires for one editor and not the other, and neither can see the difference from the inside");
    for (const s of only(curMap, ccMap)) fail("A3", s, "wired for Cursor but not for Claude Code — same problem, other direction");
  }
  return { scripts, ccMap, curMap };
}

/* -------------------------------------------------------------------- A4 */

/** The bug this file was written for. */
function pluginWiring(scripts) {
  const dir = "plugin";
  if (!existsSync(join(ROOT, dir))) return warn("A4", "plugin/", "not built, so its wiring cannot be checked. Run build-plugin.mjs build");
  const wiring = readJson(`${dir}/hooks/hooks.json`) || readJson(`${dir}/.claude-plugin/hooks.json`);
  if (!wiring) return fail("A4", `${dir}/hooks/hooks.json`, "the built plugin has no hook wiring. Every guard is copied in and none of them runs for anyone who installed it");
  const have = wiredIn(wiring);
  for (const s of scripts) if (!have.has(s))
    fail("A4", s, `copied into the plugin but not wired in its hooks.json. This is exactly how guard-phase.mjs blocked nothing for every plugin install while every document said it did`);
}

/* -------------------------------------------------------------------- A5 */

function gateRoles() {
  const agents = new Set(ls(".claude/agents").filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")));
  if (!agents.size) return warn("A5", ".claude/agents/", "no agent definitions found, so gate reviewers cannot be verified");
  const gates = ls(".cursor/lifecycle/gates").filter((f) => f.endsWith(".gate.md"));
  if (!gates.length) return warn("A5", ".cursor/lifecycle/gates/", "no gate definitions found");
  for (const g of gates) {
    const src = read(`.cursor/lifecycle/gates/${g}`) || "";
    const roles = (label) => {
      const m = src.match(new RegExp(`^\\*\\*${label}:\\*\\*(.+)$`, "mi"));
      return m ? [...m[1].matchAll(/`([a-z0-9-]+)`/g)].map((x) => x[1]) : [];
    };
    const reviewer = roles("Reviewed by")[0] || null, authors = roles("Authored by");
    if (!reviewer) { fail("A5", g, "names no reviewer. record-gate will accept a verdict from anyone, including the author"); continue; }
    if (!agents.has(reviewer)) fail("A5", `${g} -> ${reviewer}`, `names a reviewer with no agent definition. record-gate refuses every verdict for this gate and the message will not say why`);
    for (const a of authors) if (!agents.has(a)) warn("A5", `${g} -> ${a}`, "names an author with no agent definition");
    if (authors.includes(reviewer)) fail("A5", `${g} -> ${reviewer}`, "is listed as both author and reviewer of the same gate — one consent signed twice");
  }
}

/* -------------------------------------------------------------------- A6 */

/** A tool nothing runs is a control that was built and then left disconnected. */
function orphanTools() {
  const tools = ls(".cursor/tools").filter((f) => f.endsWith(".mjs"));
  const haystack = [];
  const collect = (dir, exts) => {
    const walk = (d) => {
      for (const n of ls(d)) {
        const rel = `${d}/${n}`;
        let st; try { st = statSync(join(ROOT, rel)); } catch { continue; }
        if (st.isDirectory()) { if (!/node_modules|\.git|plugin$/.test(rel)) walk(rel); }
        else if (exts.some((e) => n.endsWith(e))) { const t = read(rel); if (t) haystack.push(t); }
      }
    };
    walk(dir);
  };
  collect(".cursor", [".md", ".mdc", ".json", ".mjs", ".yml"]);
  collect("templates", [".yml", ".yaml", ".md"]);
  for (const f of ["CLAUDE.md", "AGENTS.md", "README.md", "HANDBOOK.md", "HANDBOOK.ar.md"]) { const t = read(f); if (t) haystack.push(t); }
  const blob = haystack.join("\n");
  for (const t of tools) {
    // Its own source mentions its name; that must not count as a citation.
    const own = read(`.cursor/tools/${t}`) || "";
    const mentions = blob.split(t).length - 1 - (own.split(t).length - 1);
    if (mentions <= 0) fail("A6", `.cursor/tools/${t}`, "is referenced by no gate, rule, skill, template or document. A tool nobody runs is a control that was built and never connected");
  }
}

/* -------------------------------------------------------------------- A7 */

function auditInCi() {
  const files = ls("templates/ci").filter((f) => /\.ya?ml$/.test(f)).map((f) => read(`templates/ci/${f}`) || "").join("\n");
  const gh = ls(".github/workflows").filter((f) => /\.ya?ml$/.test(f)).map((f) => read(`.github/workflows/${f}`) || "").join("\n");
  if (!(files + gh).includes("self-audit.mjs"))
    fail("A7", "self-audit.mjs", "is in no CI workflow or template. An audit nobody runs is precisely the defect this file exists to find, and it would be a poor joke to ship it disconnected");
}

/* ------------------------------------------------------------------- run */

function runWiring() {
  findings.length = 0;
  const { scripts } = hookWiring();
  pluginWiring(scripts);
  gateRoles();
  orphanTools();
  auditInCi();
  return findings;
}

function report(list) {
  if (!list.length) { out(`OK: every control is wired, in both hosts and in the built plugin.`); return 0; }
  const byCheck = new Map();
  for (const f of list) { if (!byCheck.has(f.check)) byCheck.set(f.check, []); byCheck.get(f.check).push(f); }
  const NAMES = { A1: "a hook script wired to nothing", A2: "a wiring pointing at nothing", A3: "the two hosts disagree",
                  A4: "the built plugin does not wire it", A5: "gate roles", A6: "an orphan tool", A7: "the audit is not in CI" };
  for (const [c, fs_] of [...byCheck].sort()) {
    out(`## ${c} — ${NAMES[c] || c} (${fs_.length})\n`);
    for (const f of fs_) { out(`  ${f.sev}  ${f.what}`); out(`        ${f.why}`); }
    out("");
  }
  const hard = list.filter((f) => f.sev === "FAIL").length;
  out(hard ? `FAILED: ${hard} control(s) exist but are not reachable.\nA missing control is noticed. A disconnected one is trusted.`
           : `${list.length} warning(s), nothing disconnected.`);
  return hard ? 1 : 0;
}

/** Compose the three existing checkers rather than reimplementing any of them. */
function others() {
  const rows = [];
  for (const [tool, args] of [["docs-lint.mjs", ["check"]], ["platform-metadata.mjs", ["check"]], ["build-plugin.mjs", ["check"]]]) {
    const abs = join(ROOT, ".cursor", "tools", tool);
    if (!existsSync(abs)) { rows.push({ tool, ran: false, why: "not present" }); continue; }
    try { execFileSync(process.execPath, [abs, ...args], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024 }); rows.push({ tool, ran: true, ok: true }); }
    catch (e) { rows.push({ tool, ran: true, ok: false, exit: e.status ?? null, tail: String(e.stdout || e.stderr || "").split("\n").filter(Boolean).pop()?.slice(0, 160) || "" }); }
  }
  return rows;
}

const CMDS = {
  wiring(args) {
    const list = runWiring();
    if (args.includes("--json")) { out(JSON.stringify(list, null, 2)); return list.some((f) => f.sev === "FAIL") ? 1 : 0; }
    out(`# Wiring — is every control reachable?\n`);
    return report(list);
  },
  run(args) {
    const list = runWiring();
    const rows = others();
    if (args.includes("--json")) { out(JSON.stringify({ wiring: list, others: rows }, null, 2)); return list.some((f) => f.sev === "FAIL") || rows.some((r) => r.ran && !r.ok) ? 1 : 0; }
    out(`# Self-audit\n`);
    out(`## The three existing checkers\n`);
    for (const r of rows) {
      out(`  ${pad(r.ran ? (r.ok ? "PASS" : "FAIL") : "----", 7)}${pad(r.tool, 26)}${r.ran ? (r.tail || "") : r.why}`);
    }
    out(`\n  Those own links, counts and the plugin tree. What follows is only wiring —\n  the thing none of them looks at.\n`);
    const w = report(list);
    return w || (rows.some((r) => r.ran && !r.ok) ? 1 : 0);
  },
};

const [cmd, ...args] = process.argv.slice(2);
if (!cmd || !CMDS[cmd]) {
  out(`self-audit.mjs — is every control this platform claims actually connected?

  run [--json]      wiring, plus docs-lint, platform-metadata and build-plugin check
  wiring [--json]   only the wiring: hooks in both hosts and in the built plugin,
                    gate reviewers, orphan tools, and whether this audit runs in CI

It was written for a real defect: guard-phase.mjs was copied into the plugin and
never wired into its hooks.json, so the design gate blocked nothing for every
plugin install while every document said it did.

A missing control is noticed. A disconnected one is trusted.`);
  process.exit(cmd ? 2 : 0);
}
process.exit(CMDS[cmd](args) ?? 0);
