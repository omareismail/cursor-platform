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
 *   A7  the checks this repo owns actually run HERE, in .github/workflows/ —
 *       a template that ships to someone else's repository is not evidence
 *   A8  the built plugin carries the DATA its tools read at runtime, not only
 *       the tools — the same defect as A4, one level out
 *   A9  every deliberate copy of a fact still matches the file that owns it,
 *       because a fail-closed fallback that has drifted fails OPEN
 *   A10 the four guards are wired failClosed in Cursor's wiring and the
 *       plugin's, and _lib.ok() still says "allow" out loud - a fail-closed
 *       hook that exits silently is counted as a failed hook
 *   A11 the protected-path list in write-policy.json and its fallback in
 *       _lib.mjs still agree - A9, for the enforcement surface itself
 *
 * Usage:
 *   node .cursor/tools/self-audit.mjs run [--json]      wiring + the three others
 *   node .cursor/tools/self-audit.mjs wiring [--json]   only the wiring checks
 *
 * Exit codes:  0 = everything connected   1 = a control is not reachable
 *              2 = usage
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { report as findingReport, emit } from "./_findings.mjs";

const ROOT = process.env.CLAUDE_PROJECT_DIR || repoRoot() || process.cwd();
const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const INSTALL_PARENT = dirname(TOOL_DIR);
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
 * Scripts in .claude/hooks/ that are NOT hooks. `_`-prefixed files are shared
 * helpers (`_lib.mjs` normalises payloads, `_sql.mjs` classifies SQL);
 * `sync-skills.mjs` is a maintenance command run by hand. The prefix is the
 * convention build-plugin.mjs and platform-metadata.mjs use too, so a new
 * helper cannot be counted as an unwired hook by one of them and not the others.
 */
const NOT_HOOKS = new Set(["sync-skills.mjs", ...ls(".claude/hooks").filter((f) => f.startsWith("_") && f.endsWith(".mjs"))]);

const findings = [];
const fail = (check, what, why) => findings.push({ sev: "FAIL", check, what, why });
const warn = (check, what, why) => findings.push({ sev: "warn", check, what, why });

/* ------------------------------------------------------------ A1 / A2 / A3 */

/**
 * Every hook script a wiring file invokes, and the event it is wired to.
 *
 * This was wrong twice, and both mistakes pointed the same way — reporting a
 * correctly wired plugin as entirely unwired, which is the direction that gets a
 * checker switched off within a week:
 *
 *   the PATH   the source says `node .claude/hooks/x.mjs`; the plugin says
 *              `node ${CLAUDE_PLUGIN_ROOT}/hooks/x.mjs` and Cursor's says
 *              `${PLUGIN_ROOT}`. Anchoring on `.claude/` matched none of them.
 *   the SHAPE  `.claude/settings.json` nests events under a `hooks` key; the
 *              plugin's `hooks.json` puts them at the top level. Starting at
 *              `obj.hooks` walked an empty object and found nothing.
 *
 * Neither was caught, because the fixture that tested this was built to match
 * the parser instead of the files — which tests the code against itself and
 * passes for exactly the wrong reason.
 */
function wiredIn(obj) {
  const found = new Map();
  const walk = (node, event) => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, event));
    if (!node || typeof node !== "object") return;
    if (typeof node.command === "string") {
      // Any `hooks/<name>.mjs`, whatever stands in front of it.
      const m = node.command.match(/hooks[\\/]([\w.-]+\.mjs)\b/);
      if (m) { if (!found.has(m[1])) found.set(m[1], new Set()); found.get(m[1]).add(event); }
    }
    for (const [k, v] of Object.entries(node)) if (k !== "command") walk(v, event);
  };
  // Events under a `hooks` key, or at the top level — both shapes are in use.
  const events = obj?.hooks && typeof obj.hooks === "object" ? obj.hooks : obj || {};
  for (const [event, v] of Object.entries(events)) { if (event.startsWith("//")) continue; walk(v, event); }
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
  const cc = readJson(`${dir}/hooks/hooks.json`) || readJson(`${dir}/.claude-plugin/hooks.json`);
  const cur = readJson(`${dir}/hooks/cursor-hooks.json`);
  if (!cc) return fail("A4", `${dir}/hooks/hooks.json`, "the built plugin has no hook wiring. Every guard is copied in and none of them runs for anyone who installed it");
  const ccHave = wiredIn(cc), curHave = cur ? wiredIn(cur) : null;
  for (const s of scripts) {
    if (!ccHave.has(s))
      fail("A4", s, `copied into the plugin but not wired in its hooks.json. This is exactly how guard-phase.mjs blocked nothing for every plugin install while every document said it did`);
    // The A3 problem again, inside the plugin: two hosts, one of them uncovered.
    else if (curHave && !curHave.has(s))
      fail("A4", s, `wired in the plugin's hooks.json but not in cursor-hooks.json — it guards a Claude Code install and not a Cursor one`);
  }
  if (!cur) warn("A4", `${dir}/hooks/cursor-hooks.json`, "absent, so a Cursor install of this plugin has no hook wiring at all");
}

/* -------------------------------------------------------------------- A8 */

/**
 * A tool without the file it reads is as disconnected as a hook without wiring,
 * and it was true here: the plugin shipped `lifecycle.mjs`, `guard-phase.mjs`,
 * `write-policy.json` and six documents describing six gates — and no gate
 * definitions. `record-gate` died with "cannot record a verdict against
 * nothing", so no judgement consent could ever be recorded, so `approve` refused
 * forever, so the whole six-phase layer was unusable from a plugin install while
 * every document said it worked.
 *
 * A4 asks whether the hooks are wired. This asks whether what the tools READ
 * travelled with them.
 */
const RUNTIME_DATA = [
  { from: ".cursor/lifecycle/gates", to: "plugin/lifecycle/gates", match: /\.gate\.md$/, who: "lifecycle.mjs record-gate / gate / approve" },
  { from: ".cursor/schemas", to: "plugin/schemas", match: /\.json$/, who: "artifact-schema.mjs", optional: true },
  { from: "schemas", to: "plugin/schemas", match: /\.json$/, who: "artifact-schema.mjs" },
];
const RUNTIME_FILES = [
  { from: ".cursor/lifecycle/write-policy.json", to: "plugin/lifecycle/write-policy.json", who: "guard-phase.mjs" },
  { from: ".cursor/mcp-policy.json", to: "plugin/mcp-policy.json", who: "guard-mcp.mjs" },
];

function pluginData() {
  if (!existsSync(join(ROOT, "plugin"))) return;   // A4 already said so
  for (const r of RUNTIME_DATA) {
    const src = ls(r.from).filter((f) => r.match.test(f));
    if (!src.length) { if (!r.optional) warn("A8", r.from, "nothing to ship from here"); continue; }
    const got = new Set(ls(r.to));
    const missing = src.filter((f) => !got.has(f));
    if (missing.length === src.length)
      fail("A8", r.to, `none of the ${src.length} file(s) in ${r.from} travelled with the plugin. ${r.who} reads them at runtime and will fail for every plugin install, with an error that blames the project`);
    else for (const f of missing)
      fail("A8", `${r.to}/${f}`, `is in ${r.from} but not in the built plugin. ${r.who} reads it`);
  }
  for (const f of RUNTIME_FILES) {
    if (existsSync(join(ROOT, f.from)) && !existsSync(join(ROOT, f.to)))
      fail("A8", f.to, `is in the source but not in the built plugin. ${f.who} reads it`);
  }
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

/**
 * A7 — the checks this repository owns actually run HERE.
 *
 * The first version of this check counted `templates/ci/*.yml` as evidence, and
 * passed for months while nothing ran at all. Those templates are files that a
 * DIFFERENT repository copies in one day; they say nothing about this one. An
 * audit that accepted "shipped as a template for someone else" as "runs here"
 * was the exact defect it was written to find, sitting inside itself.
 *
 * So the only evidence now is `.github/workflows/`. The templates are still
 * read, for one purpose: when a check is missing here but present there, the
 * message says so, because that is the confusion the old version fell into.
 */
function auditInCi() {
  const wf = ls(".github/workflows").filter((f) => /\.ya?ml$/.test(f));
  const here = wf.map((f) => read(`.github/workflows/${f}`) || "").join("\n");
  const templates = ls("templates/ci").filter((f) => /\.ya?ml$/.test(f))
    .map((f) => read(`templates/ci/${f}`) || "").join("\n");

  if (!wf.length) {
    return fail("A7", ".github/workflows/", templates
      ? "does not exist. Every check in this repo runs only when a human remembers to type it. The two files in templates/ci/ are for the applications that adopt the platform — they run in somebody else's repository, not this one"
      : "does not exist. Every check in this repo runs only when a human remembers to type it");
  }

  /**
   * What must run here, and why each one is not optional. Kept small on purpose:
   * `self-audit run` already composes docs-lint, platform-metadata and
   * build-plugin check, so naming those separately would just be a longer list
   * of the same guarantee.
   */
  const REQUIRED = [
    { cmd: "self-audit.mjs", exists: true,
      why: "An audit nobody runs is precisely the defect it exists to find" },
    { cmd: "tests/run.mjs", exists: existsSync(join(ROOT, "tests/run.mjs")),
      why: "The guards are this repository's product. A regex that stops matching is silent — the hook still runs, still exits 0, and the wiring audit still says PASS. tests/run.mjs runs every suite, the adversarial ones included" },
  ];

  for (const r of REQUIRED) {
    if (!r.exists || here.includes(r.cmd)) continue;
    fail("A7", r.cmd, templates.includes(r.cmd)
      ? `is in templates/ci/ but in no workflow under .github/workflows/. A template runs in the repositories that adopt this platform, never in this one. ${r.why}`
      : `is in no workflow under .github/workflows/. ${r.why}`);
  }
}

/* ------------------------------------------------------------------- A10 */

/**
 * A10 — the guards fail closed, in Cursor's wiring and in the plugin's.
 *
 * Cursor's default when a hook crashes, times out or returns something it cannot
 * parse is to let the tool call proceed. For sessionStart that is right. For a
 * guard it means a node that is not on PATH, or a syntax error from a bad merge,
 * switches every guard off with nothing on screen. `failClosed: true` turns each
 * of those into a denial the user sees. It is a per-entry flag, so it can be
 * dropped from one guard by accident and nothing would say so - this does.
 *
 * Also checks the other half: a fail-closed hook that exits 0 with no stdout is
 * counted by Cursor as a FAILED hook, so `_lib.ok()` has to answer
 * {permission:"allow"} explicitly. If that line goes, every fail-closed guard
 * blocks every call - the day this was first switched on, it did.
 */
const GUARDS = ["guard-write.mjs", "guard-phase.mjs", "guard-bash.mjs", "guard-mcp.mjs"];
function failClosedIn(obj, file) {
  const seen = new Map();
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    if (typeof node.command === "string") {
      const m = node.command.match(/hooks[\\/]([\w.-]+\.mjs)\b/);
      if (m) seen.set(m[1], node.failClosed === true);
    }
    for (const [k, v] of Object.entries(node)) if (k !== "command") walk(v);
  };
  walk(obj?.hooks && typeof obj.hooks === "object" ? obj.hooks : obj || {});
  for (const g of GUARDS) {
    if (!seen.has(g)) continue;                      // A1/A4 already report an unwired guard
    if (!seen.get(g)) fail("A10", `${file} -> ${g}`, "is wired without failClosed:true. When this hook crashes, times out or prints something malformed, Cursor lets the call through - the guard is off and nothing says so");
  }
}
function failClosed() {
  const cur = readJson(".cursor/hooks.json");
  if (cur) failClosedIn(cur, ".cursor/hooks.json");
  const plug = readJson("plugin/hooks/cursor-hooks.json");
  if (plug) failClosedIn(plug, "plugin/hooks/cursor-hooks.json");

  const lib = read(".claude/hooks/_lib.mjs");
  if (lib !== null && !/permission:\s*"allow"/.test(lib)) {
    fail("A10", "_lib.mjs -> ok()", 'no longer answers {permission:"allow"} on Cursor. With failClosed set, a hook that exits 0 silently is a hook that failed, and every guarded call is denied');
  }
}

/* ------------------------------------------------------------------- A11 */

/**
 * A11 — the protected-path list and its fail-closed fallback agree.
 *
 * Same arrangement as A9's TIER2_FALLBACK: the list is owned by
 * .cursor/lifecycle/write-policy.json under `protected.paths`, and _lib.mjs
 * carries a literal copy so a missing or unreadable policy leaves the guards
 * protecting exactly what they protected before. Two copies, watched.
 */
function protectedCopies() {
  const policy = readJson(".cursor/lifecycle/write-policy.json");
  const lib = read(".claude/hooks/_lib.mjs");
  if (!policy || lib === null) return;
  const owner = policy.protected?.paths;
  if (!Array.isArray(owner) || !owner.length) return fail("A11", "write-policy.json -> protected.paths", "is missing or empty. The enforcement surface - hooks, wiring, policies, lifecycle records - is protected only by the fallback in _lib.mjs, and nothing declares the list where a human would look for it");
  const copy = arrayLiteral(lib, "PROTECTED_FALLBACK");
  if (!copy) return fail("A11", "_lib.mjs -> PROTECTED_FALLBACK", "no longer a plain array literal. If write-policy.json is unreadable the guards protect nothing, and this audit cannot see what they would fall back to");
  const d = setDiff(owner, copy);
  for (const p of d.absent) fail("A11", `_lib.mjs -> ${p}`, "is protected by write-policy.json but not by the fallback. When the policy is unreadable, an agent may write this file");
  for (const p of d.extra) warn("A11", `_lib.mjs -> ${p}`, "is in the fallback but not in write-policy.json. The two disagree about what is protected");
}

/* -------------------------------------------------------------------- A9 */

/**
 * A9 — the copies that are supposed to exist.
 *
 * `memory-bank.mjs` owns the two tiers, the digest, the staleness threshold and
 * the template heuristic. Four files keep their own copy anyway, and each copy
 * is deliberate: a hook whose import fails must keep guarding, so `guard-write`
 * hardcodes the Tier 2 list and `session-start` hardcodes the digest. Refusing
 * the redundancy would trade a drift risk for an outage risk, and an outage in
 * a guard is the worse of the two.
 *
 * But a fallback nobody compares is not a fallback. Add a file to the owner's
 * Tier 2 list, forget the regex in `guard-write`, and the guard keeps working
 * for every case except the new one — silently, and only for the installs where
 * the import happens to fail. That is a control that exists and is trusted and
 * does not protect the thing it names.
 *
 * So the redundancy is allowed and WATCHED. Nothing here executes either file;
 * it reads both as text and compares what is written down, which is the only
 * thing the runtime fallback path will ever see.
 */

const arrayLiteral = (src, name) => {
  const m = src.match(new RegExp(`(?:export\\s+)?(?:const|let)\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
  return m ? [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]) : null;
};
const numberLiteral = (src, name) => {
  const m = src.match(new RegExp(`(?:export\\s+)?(?:const|let)\\s+${name}\\s*=\\s*(\\d+)`));
  return m ? Number(m[1]) : null;
};
const regexLiteral = (src, name) => {
  const m = src.match(new RegExp(`(?:export\\s+)?(?:const|let)\\s+${name}\\s*=\\s*(/.+/[a-z]*)\\s*;`));
  return m ? m[1] : null;
};

/** Set comparison, never count comparison: one added and one removed is a diff. */
const setDiff = (owner, copy) => {
  const A = new Set(owner.map((x) => x.toLowerCase())), B = new Set(copy.map((x) => x.toLowerCase()));
  return { absent: [...A].filter((x) => !B.has(x)), extra: [...B].filter((x) => !A.has(x)) };
};

function watchedCopies() {
  const OWNER = ".cursor/tools/memory-bank.mjs";
  const owner = read(OWNER);
  if (owner === null) return fail("A9", OWNER, "is missing. Every fallback in the hooks is a copy of a list that no longer has an owner, and nothing can tell whether the copies are still right");

  const tier2 = arrayLiteral(owner, "TIER2"), digest = arrayLiteral(owner, "DIGEST");
  const staleDays = numberLiteral(owner, "STALE_DAYS"), placeholder = regexLiteral(owner, "PLACEHOLDER");
  if (!tier2 || !digest || staleDays === null || !placeholder)
    return fail("A9", OWNER, "no longer states TIER2, DIGEST, STALE_DAYS and PLACEHOLDER as plain literals. This audit reads them as text on purpose — it must see what a failed import would leave behind — so a computed list here is a list nothing can check");

  const bare = (l) => l.map((f) => f.replace(/\.md$/i, ""));

  /* guard-write.mjs — the Tier 2 write block. The dangerous direction is a file
     the owner protects and the fallback does not: the guard fails OPEN on it. */
  const gw = read(".claude/hooks/guard-write.mjs");
  if (gw === null) fail("A9", ".claude/hooks/guard-write.mjs", "is missing, so nothing blocks agent writes to Tier 2");
  else {
    const m = gw.match(/TIER2_FALLBACK\s*=\s*\/\^memory-bank\\\/\(([^)]+)\)/);
    if (!m) fail("A9", "guard-write.mjs", "no longer carries a TIER2_FALLBACK alternation. If the import of memory-bank.mjs fails at runtime the guard now blocks nothing at all, and it will not say so");
    else {
      const d = setDiff(bare(tier2), m[1].split("|").map((x) => x.trim()));
      for (const f of d.absent)
        fail("A9", `guard-write.mjs -> ${f}.md`, "is Tier 2 in memory-bank.mjs but not in the hardcoded fallback. Whenever the import fails, an agent may rewrite this file and no message is printed");
      for (const f of d.extra)
        warn("A9", `guard-write.mjs -> ${f}.md`, "is blocked by the fallback but is not Tier 2 in memory-bank.mjs. The two hosts disagree about what is protected");
    }
  }

  /* session-start.mjs — the digest injected into every session. */
  const ss = read(".claude/hooks/session-start.mjs");
  if (ss === null) fail("A9", ".claude/hooks/session-start.mjs", "is missing, so no memory-bank digest reaches the agent at session start");
  else {
    const copy = arrayLiteral(ss, "DIGEST");
    if (!copy) fail("A9", "session-start.mjs", "no longer carries a DIGEST fallback. If the import fails, the session starts with no memory bank at all and rule 00 is unenforced");
    else {
      const d = setDiff(digest, copy);
      for (const f of d.absent) fail("A9", `session-start.mjs -> ${f}`, "is in the canonical digest but not in the fallback. On a failed import the agent starts the session without it");
      for (const f of d.extra) fail("A9", `session-start.mjs -> ${f}`, "is in the fallback but not in the canonical digest. The digest is a deliberate subset; growing it here grows the always-on injection that nobody approved");
    }
    const sd = numberLiteral(ss, "STALE_DAYS");
    if (sd !== null && sd !== staleDays)
      fail("A9", "session-start.mjs -> STALE_DAYS", `says ${sd} and memory-bank.mjs says ${staleDays}. The two would call the same file fresh and stale on the same day`);
    const pm = regexLiteral(ss, "placeholderMarker");
    if (pm && pm !== placeholder)
      fail("A9", "session-start.mjs -> placeholderMarker", "no longer matches memory-bank.mjs's PLACEHOLDER. An unfilled template counts as written content on one path and not the other");
  }

  /* lifecycle.mjs keeps its own PLACEHOLDER on purpose: it must stay a leaf for
     the hooks that import it, and it applies the heuristic to phase artifacts
     rather than to memory-bank files. Same convention, so the same text. */
  const lc = read(".cursor/tools/lifecycle.mjs");
  if (lc !== null) {
    const pl = regexLiteral(lc, "PLACEHOLDER");
    if (pl && pl !== placeholder)
      fail("A9", "lifecycle.mjs -> PLACEHOLDER", "no longer matches memory-bank.mjs's. A gate and the memory bank would disagree about whether an unfilled template counts as a written document");
  }

  /* A fifth copy, in a file nothing above knows about, is how this started. */
  const WATCHED = new Set(["memory-bank.mjs", "self-audit.mjs", "lifecycle.mjs", "guard-write.mjs", "session-start.mjs"]);
  for (const [dir, names] of [[".cursor/tools", ls(".cursor/tools")], [".claude/hooks", ls(".claude/hooks")]]) {
    for (const n of names) {
      if (!n.endsWith(".mjs") || WATCHED.has(n)) continue;
      const t = read(`${dir}/${n}`);
      if (!t) continue;
      const owned = ["TIER1", "TIER2", "DIGEST", "STALE_DAYS"].filter((k) => new RegExp(`(?:const|let)\\s+${k}\\s*=`).test(t));
      if (/EXAMPLE\|TODO\|TBD\|PLACEHOLDER/.test(t)) owned.push("PLACEHOLDER");
      for (const k of owned)
        warn("A9", `${dir}/${n} -> ${k}`, "declares a fact memory-bank.mjs owns, and this audit is not comparing it to anything. Import it, or add it to A9 — an unwatched copy is the defect A9 exists to find");
    }
  }
}

/* ------------------------------------------------------------------- run */

function runWiring() {
  findings.length = 0;
  const { scripts } = hookWiring();
  pluginWiring(scripts);
  pluginData();
  gateRoles();
  orphanTools();
  auditInCi();
  watchedCopies();
  failClosed();
  protectedCopies();
  return findings;
}

function report(list) {
  if (!list.length) { out(`OK: every control is wired, in both hosts and in the built plugin.`); return 0; }
  const byCheck = new Map();
  for (const f of list) { if (!byCheck.has(f.check)) byCheck.set(f.check, []); byCheck.get(f.check).push(f); }
  const NAMES = { A1: "a hook script wired to nothing", A2: "a wiring pointing at nothing", A3: "the two hosts disagree",
                  A4: "the built plugin does not wire it", A5: "gate roles", A6: "an orphan tool", A7: "a check that runs nowhere",
                  A8: "the built plugin ships a tool without the data it reads",
                  A9: "a fail-closed copy has drifted from the file that owns it",
                  A10: "a guard that fails open", A11: "the protected-path list and its fallback disagree" };
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

/* ------------------------------------------------------------ integrity */

/**
 * The enforcement surface, attested.
 *
 * guard-write and guard-bash refuse an AGENT's edit to a hook or a policy. They
 * do nothing about an edit made with the escape variable set, a commit from a
 * clone with no hooks installed, or a line changed in a web editor. Those are
 * legitimate ways to change the platform, and they are also every way a control
 * gets weakened without anyone deciding to weaken it.
 *
 * `integrity --write` records a sha256 of every file that enforces something,
 * under a human's name (guard-bash refuses it from the agent's shell). `--check`
 * recomputes and fails on any file that changed, vanished, or appeared under a
 * covered directory without being attested - a new hook is a new control and
 * a new place for a hole. CI runs `--check` on every push, so the surface can
 * change only through a diff that also touches the manifest, which is the
 * review prompt: "why did the guards change?"
 *
 * The manifest lives under lifecycle/ because it is a record about this repo's
 * controls, and lifecycle/** is itself protected - the manifest is covered by
 * the guards it attests.
 */
const INTEGRITY_FILE = "lifecycle/integrity.json";
const PROJECT_GLOBS = [
  ".claude/hooks/*.mjs", ".claude/settings.json", ".cursor/hooks.json",
  ".cursor/mcp-policy.json", ".cursor/lifecycle/write-policy.json", ".cursor/lifecycle/gates/*.md",
  ".cursor/tools/lifecycle.mjs", ".cursor/tools/_state.mjs", ".cursor/tools/_evidence.mjs", ".cursor/tools/release-evidence.mjs",
  ".cursor/tools/self-audit.mjs", ".mcp.json",
];
const PLUGIN_GLOBS = [
  "hooks/*.mjs", "hooks/hooks.json", "hooks/cursor-hooks.json", "mcp-policy.json",
  "lifecycle/write-policy.json", "lifecycle/gates/*.md",
  "tools/lifecycle.mjs", "tools/_state.mjs", "tools/_evidence.mjs", "tools/release-evidence.mjs", "tools/self-audit.mjs",
];
const INTEGRITY_REQUIRED = ["guard-write.mjs", "guard-phase.mjs", "guard-bash.mjs", "guard-mcp.mjs", "_lib.mjs", "lifecycle.mjs"];

function globIntegrity(root, globs) {
  const files = [];
  for (const g of globs) {
    const slash = g.lastIndexOf("/");
    const dir = g.slice(0, slash), pat = g.slice(slash + 1);
    if (!pat.includes("*")) {
      const abs = join(root, ...g.split("/"));
      if (existsSync(abs) && statSafe(abs)?.isFile()) files.push({ rel: g, abs });
      continue;
    }
    const re = new RegExp("^" + pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") + "$");
    let names = [];
    try { names = readdirSync(join(root, ...dir.split("/"))); } catch { continue; }
    for (const f of names) {
      const abs = join(root, ...dir.split("/"), f);
      if (re.test(f) && statSafe(abs)?.isFile()) files.push({ rel: dir + "/" + f, abs });
    }
  }
  return files;
}

function integrityEntries() {
  const out = [], seen = new Set();
  const add = (list) => { for (const e of list) { if (seen.has(e.rel)) continue; seen.add(e.rel); out.push(e); } };
  if (existsSync(join(INSTALL_PARENT, "hooks", "guard-write.mjs"))) add(globIntegrity(INSTALL_PARENT, PLUGIN_GLOBS));
  add(globIntegrity(ROOT, PROJECT_GLOBS));
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}
function integrityFiles() { return integrityEntries().map((e) => e.rel); }
function requiredLocation(n) {
  const plugin = n === "lifecycle.mjs" ? join(INSTALL_PARENT, "tools", n) : join(INSTALL_PARENT, "hooks", n);
  const project = n === "lifecycle.mjs" ? join(ROOT, ".cursor", "tools", n) : join(ROOT, ".claude", "hooks", n);
  return { plugin, project };
}
function coverageGaps(entries) {
  // Incomplete means a file that is on disk was not enumerated, or a plugin
  // install is missing a required guard. A deleted attested file is MISSING
  // at check time, not a coverage gap — otherwise --write could never record
  // that the guard is gone.
  const names = new Set(entries.map((e) => e.rel.split("/").pop()));
  const pluginInstall = existsSync(join(INSTALL_PARENT, "hooks", "guard-write.mjs"));
  const missing = [];
  for (const n of INTEGRITY_REQUIRED) {
    const { plugin, project } = requiredLocation(n);
    const onDisk = existsSync(plugin) || existsSync(project);
    if (onDisk && !names.has(n)) missing.push(n);
    else if (pluginInstall && !existsSync(plugin)) missing.push(n);
  }
  return missing;
}
const statSafe = (p) => { try { return statSync(p); } catch { return null; } };

/** The shared finding-report shape (schemas/finding.schema.json). */
function emitFindings(command, findings, summary, data) {
  return emit(findingReport({ tool: "self-audit.mjs", command, findings, summary, data }), out);
}
const sha256 = (rel) => {
  const hit = integrityEntries().find((e) => e.rel === rel);
  const b = readFileSync(hit ? hit.abs : join(ROOT, rel));
  return execSha(b);
};
function execSha(buf) { return createHash("sha256").update(buf).digest("hex"); }

async function integrityWrite(args) {
  const by = args[args.indexOf("--by") + 1];
  if (!args.includes("--by") || !by) { out(`integrity --write needs --by "<name>". An attestation with no name on it is a checksum.`); return 2; }
  const files = integrityFiles();
  const gaps = coverageGaps(integrityEntries());
  if (!files.length || gaps.length) {
    out("FAIL: incomplete coverage of the enforcement surface (" + (files.length ? "missing " + gaps.join(", ") : "0 files") + ").");
    out("A plugin-only install is attested from the plugin directory this tool lives in, not from an empty project.");
    return 1;
  }
  const st = await import(new URL("./_state.mjs", import.meta.url).href);
  const prev = readJson(INTEGRITY_FILE);
  const manifest = {
    version: 1,
    writtenAt: new Date().toISOString(),
    by,
    recordedBy: st.actor(ROOT),
    note: "sha256 of every file that enforces a control. `self-audit.mjs integrity --check` fails when any of them changes without this file changing with it. Written by a human; guard-bash refuses --write from the agent's shell.",
    files: Object.fromEntries(files.map((f) => [f, sha256(f)])),
  };
  const w = st.actorWarning(by, manifest.recordedBy);
  if (w) process.stderr.write(w + "\n");
  st.writeJsonAtomic(join(ROOT, INTEGRITY_FILE), manifest);
  const changed = prev ? files.filter((f) => prev.files?.[f] && prev.files[f] !== manifest.files[f]) : [];
  const added = prev ? files.filter((f) => !prev.files?.[f]) : files;
  const gone = prev ? Object.keys(prev.files || {}).filter((f) => !manifest.files[f]) : [];
  out(`Integrity manifest written: ${files.length} file(s) attested by ${by}.`);
  if (prev) out(`  since ${String(prev.writtenAt).slice(0, 10)} (${prev.by}): ${changed.length} changed, ${added.length} added, ${gone.length} removed`);
  for (const f of changed) out(`    ~ ${f}`);
  for (const f of added) out(`    + ${f}`);
  for (const f of gone) out(`    - ${f}`);
  out(`  ${INTEGRITY_FILE}\nCommit it with the change it attests.`);
  return 0;
}

function integrityCheck(args) {
  const m = readJson(INTEGRITY_FILE);
  const jsonOut = args.includes("--json");
  if (!m || typeof m.files !== "object") {
    const why = existsSync(join(ROOT, INTEGRITY_FILE)) ? "exists but is not a readable manifest" : "does not exist";
    if (jsonOut) return emitFindings("integrity", [{ severity: "block", code: "manifest-missing", message: `${INTEGRITY_FILE} ${why}`, file: INTEGRITY_FILE }], `FAIL: ${INTEGRITY_FILE} ${why}`, { ok: false, missing: true, why });
    out(`FAIL: ${INTEGRITY_FILE} ${why}.\n\nNothing attests to the enforcement surface, so a hook can change and nothing\nnotices. A human writes it:\n\n  node .cursor/tools/self-audit.mjs integrity --write --by "<name>"`);
    return 1;
  }
  const now = integrityFiles();
  const gaps = coverageGaps(integrityEntries());
  if (!now.length || gaps.length) {
    const why = !now.length ? "0 enforcement files found (plugin files are resolved from this tool's install directory)" : "missing " + gaps.join(", ");
    if (jsonOut) return emitFindings("integrity", [{ severity: "block", code: "coverage-incomplete", message: why, file: INTEGRITY_FILE }], "FAIL: incomplete coverage of the enforcement surface", { ok: false, incomplete: true, why, gaps });
    out("FAIL: incomplete coverage of the enforcement surface: " + why + ".");
    return 1;
  }
  const changed = [], missing = [], unattested = [];
  for (const [f, h] of Object.entries(m.files)) {
    const hit = integrityEntries().find((e) => e.rel === f);
    const abs = hit ? hit.abs : join(ROOT, f);
    if (!existsSync(abs)) missing.push(f);
    else if (sha256(f) !== h) changed.push(f);
  }
  for (const f of now) if (!(f in m.files)) unattested.push(f);
  const ok = !changed.length && !missing.length && !unattested.length;
  if (jsonOut) {
    const findings = [
      ...changed.map((f) => ({ severity: "block", code: "changed", message: `${f} differs from what ${m.by} attested`, file: f })),
      ...missing.map((f) => ({ severity: "block", code: "missing", message: `${f} was attested and is gone`, file: f })),
      ...unattested.map((f) => ({ severity: "block", code: "unattested", message: `${f} is new under a covered path and nobody has signed for it`, file: f })),
    ];
    return emitFindings("integrity", findings, ok ? `OK: ${Object.keys(m.files).length} enforcement file(s) match the manifest` : `FAIL: the enforcement surface differs from what ${m.by} attested`, { ok, attestedAt: m.writtenAt, by: m.by, changed, missing, unattested });
  }
  if (ok) { out(`OK: ${Object.keys(m.files).length} enforcement file(s) match the manifest ${m.by} wrote on ${String(m.writtenAt).slice(0, 10)}.`); return 0; }
  out(`FAIL: the enforcement surface differs from what ${m.by} attested on ${String(m.writtenAt).slice(0, 10)}.\n`);
  for (const f of changed) out(`  CHANGED     ${f}`);
  for (const f of missing) out(`  MISSING     ${f}`);
  for (const f of unattested) out(`  UNATTESTED  ${f}   (new under a covered path; nobody has signed for it)`);
  out(`\nIf these changes were reviewed, a human re-attests:\n  node .cursor/tools/self-audit.mjs integrity --write --by "<name>"\nIf they were not, this is the finding.`);
  return 1;
}

/** Compose the three existing checkers rather than reimplementing any of them. */
function others() {
  const rows = [];
  for (const [tool, args] of [["docs-lint.mjs", ["check"]], ["platform-metadata.mjs", ["check"]], ["build-plugin.mjs", ["check"]]]) {
    const abs = join(ROOT, ".cursor", "tools", tool);
    if (!existsSync(abs)) { rows.push({ tool, ran: false, why: "not present" }); continue; }
    try { execFileSync(process.execPath, [abs, ...args], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024 }); rows.push({ tool, ran: true, ok: true }); }
    catch (e) {
      // The LAST line of a failing checker is usually its closing sentence, not
      // its findings — which made this report say nothing useful. Keep the tail,
      // and tell the reader where the whole thing is.
      const lines = String(e.stdout || e.stderr || "").split("\n").filter((l) => l.trim());
      rows.push({ tool, ran: true, ok: false, exit: e.status ?? null, tail: lines.slice(-6).map((l) => l.trim().slice(0, 120)) });
    }
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
      out(`  ${pad(r.ran ? (r.ok ? "PASS" : "FAIL") : "----", 7)}${pad(r.tool, 26)}${r.ran ? "" : r.why}`);
      for (const l of r.tail || []) out(`  ${" ".repeat(7)}${l}`);
      if (r.ran && !r.ok) out(`  ${" ".repeat(7)}-> node .cursor/tools/${r.tool} check   for the rest`);
    }
    out(`\n  Those own links, counts and the plugin tree. What follows is only wiring —\n  the thing none of them looks at.\n`);
    const w = report(list);
    return w || (rows.some((r) => r.ran && !r.ok) ? 1 : 0);
  },
  integrity(args) {
    if (args.includes("--write")) return integrityWrite(args);
    return integrityCheck(args);
  },
};

const [cmd, ...args] = process.argv.slice(2);
if (!cmd || !CMDS[cmd]) {
  out(`self-audit.mjs — is every control this platform claims actually connected?

  run [--json]      wiring, plus docs-lint, platform-metadata and build-plugin check
  wiring [--json]   only the wiring: hooks in both hosts and in the built plugin,
                    the data those tools read, gate reviewers, orphan tools, and
                    whether this audit itself runs in CI
  integrity [--check | --write --by "<name>"] [--json]
                    the enforcement surface (hooks, wiring, policies, gates,
                    lifecycle.mjs) against lifecycle/integrity.json. --write is a
                    human's command; --check is CI's

It was written for a real defect: guard-phase.mjs was copied into the plugin and
never wired into its hooks.json, so the design gate blocked nothing for every
plugin install while every document said it did.

A missing control is noticed. A disconnected one is trusted.`);
  process.exit(cmd ? 2 : 0);
}
process.exit((await CMDS[cmd](args)) ?? 0);
