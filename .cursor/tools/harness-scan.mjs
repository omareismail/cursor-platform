#!/usr/bin/env node
/**
 * harness-scan.mjs - reads the harness the way an attacker would.
 *
 * `self-audit.mjs integrity` judges CHANGE - a hash a human signed. This judges
 * CONTENT - what the bytes say, regardless of who signed them. Neither replaces
 * the other: a file can be faithfully attested and still carry an instruction
 * nobody read, and a file can be harmless and unattested.
 *
 * WHAT IT IS FOR
 *
 * Everything else in this repository protects the codebase from the agent. This
 * protects the agent from its own configuration. The skills, agent definitions
 * and rules are prose that a model reads as instruction, and they arrive the
 * same way code does - a pull request, a merge, a plugin update, a translated
 * mirror nobody reads in the original. `project-analysis` has carried
 * "injection-to-action paths" and "no test covers the instruction channel" as
 * open findings for exactly this reason.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not score. There is no grade, no percentage and no baseline file: a
 * number reported as good becomes a number to hit, and the cheapest way to hit
 * one here is to stop looking. Findings are `block`, `warn` or `info`, each with
 * a file and a line, and the reader decides.
 *
 * It also does not guess at intent. Every heuristic below was calibrated against
 * this repository before it was written, and two candidates were dropped for
 * being indistinguishable from ordinary prose: "always run X" is how half the
 * skills legitimately describe a pipeline step, and "never mention X" is how
 * release-notes-gen legitimately describes writing for end users. A warning that
 * fires on correct work is a warning somebody switches off, and then the real
 * one is off too.
 *
 *   scan [--json] [--strict] [--root DIR]
 *
 * Exit 0 clean, 1 on a blocking finding, 2 on usage. --strict promotes warnings
 * to blocks at the source, so a reader never has to know which flags were passed
 * to interpret the list.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep, basename } from "node:path";
import { report, emit, block, warn, info } from "./_findings.mjs";

const out = (s = "") => process.stdout.write(s + "\n");
const slash = (p) => p.split(sep).join("/");

/* ------------------------------------------------------------------ walk */

// Scanned because these ship, or are read as instruction, or enforce something.
const ROOT_FILES = ["README.md", "HANDBOOK.md", "HANDBOOK.ar.md", "CLAUDE.md", "AGENTS.md", ".mcp.json"];
const ROOT_DIRS = [".cursor", ".claude", "plugin", "templates", "schemas", "docs", "tests", ".github", "memory-bank"];

// `lifecycle/` and `project/` are RECORDS, not controls. They legitimately carry
// a machine name in `recordedBy` and a person's words in a reason field; judging
// their content would report the audit trail as a defect.
const SKIP_DIRS = new Set([".git", "node_modules", "cache", "obj", "bin", "coverage", "dist", "graphify-out", "lifecycle", "project", "project-analysis"]);
const TEXT_EXT = new Set([".md", ".mdc", ".mjs", ".js", ".cjs", ".json", ".jsonc", ".yml", ".yaml", ".ps1", ".sh", ".txt", ".ts", ".tsx", ".cs", ".sql", ".props", ".xml", ".toml", ".editorconfig"]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function walk(root) {
  const files = [];
  const visit = (abs) => {
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const child = join(abs, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        visit(child);
      } else if (e.isFile()) {
        const dot = e.name.lastIndexOf(".");
        const ext = dot >= 0 ? e.name.slice(dot) : e.name;
        if (!TEXT_EXT.has(ext)) continue;
        try { if (statSync(child).size > MAX_FILE_BYTES) continue; } catch { continue; }
        files.push(child);
      }
    }
  };
  for (const f of ROOT_FILES) { const abs = join(root, f); if (existsSync(abs)) files.push(abs); }
  for (const d of ROOT_DIRS) { const abs = join(root, d); if (existsSync(abs)) visit(abs); }
  return files;
}

/** Instruction surfaces: prose a model reads as a command rather than as data. */
function isInstructionFile(rel) {
  return /^\.claude\/agents\/[^/]+\.md$/.test(rel)
      || /^plugin\/agents\/[^/]+\.md$/.test(rel)
      || /^\.cursor\/skills\/[^/]+\/skill\.md$/.test(rel)
      || /^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(rel)
      || /^plugin\/skills\/[^/]+\/SKILL\.md$/.test(rel)
      || /^\.cursor\/rules\/[^/]+\.mdc$/.test(rel)
      || /^plugin\/rules\/[^/]+\.mdc$/.test(rel);
}
const isAgentFile = (rel) => /^(\.claude|plugin)\/agents\/[^/]+\.md$/.test(rel);
const isMarkdown = (rel) => /\.(md|mdc|txt)$/i.test(rel);

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

/* --------------------------------------------------- 1. invisible characters */

/**
 * Characters that are in the bytes and not on the screen.
 *
 * This is the whole reason the scan exists. A reviewer approves what a diff
 * renders; a model reads what the file contains. Zero-width joiners, bidi
 * overrides and the Unicode tag block (U+E0000..E007F, "ASCII smuggling") let
 * those two differ on purpose, and nothing in this repository was looking.
 */
const HIDDEN = [
  [0x200b, 0x200d, "zero-width space/joiner"],
  [0x2060, 0x2060, "word joiner"],
  [0xfeff, 0xfeff, "zero-width no-break space"],
  [0x202a, 0x202e, "bidirectional override"],
  [0x2066, 0x2069, "bidirectional isolate"],
  [0xfe00, 0xfe0f, "variation selector"],
  [0xe0100, 0xe01ef, "variation selector supplement"],
  [0xe0000, 0xe007f, "Unicode tag (ASCII smuggling)"],
  [0x180e, 0x180e, "Mongolian vowel separator"],
  [0x115f, 0x1160, "Hangul filler"],
  [0x3164, 0x3164, "Hangul filler"],
  [0x2061, 0x2064, "invisible math operator"],
];
const hiddenName = (cp) => { for (const [lo, hi, name] of HIDDEN) if (cp >= lo && cp <= hi) return name; return null; };

const ARABIC = (cp) => (cp >= 0x0600 && cp <= 0x06ff) || (cp >= 0x0750 && cp <= 0x077f) || (cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff);

function checkHidden(rel, text, add) {
  const cps = [...text];
  let index = 0;
  for (let i = 0; i < cps.length; i++) {
    const ch = cps[i];
    const cp = ch.codePointAt(0);
    const name = hiddenName(cp);
    if (!name) { index += ch.length; continue; }
    const line = lineOf(text, index);
    const prev = i > 0 ? cps[i - 1].codePointAt(0) : 0;
    const next = i + 1 < cps.length ? cps[i + 1].codePointAt(0) : 0;
    const at = `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;

    // Three legitimate uses, reported so a reader can see them and not acted on.
    if (cp === 0xfeff && index === 0) {
      add(info("bom-not-at-start", `byte-order mark at the start of the file (legitimate, but it is still an invisible character)`, { file: rel, line }));
    } else if ((cp === 0x200c || cp === 0x200d) && ARABIC(prev) && ARABIC(next)) {
      add(info("hidden-unicode", `${at} between Arabic letters - a joiner doing its job`, { file: rel, line }));
    } else if (cp >= 0xfe0e && cp <= 0xfe0f && prev > 0x2000) {
      add(info("hidden-unicode", `${at} variation selector after a symbol - presentation, not concealment`, { file: rel, line }));
    } else {
      add(block("hidden-unicode", `${at} (${name}) is in the bytes and not on the screen. A reviewer approves the rendered diff; the model reads the file.`, { file: rel, line }));
    }
    index += ch.length;
  }
}

/* ------------------------------------------ 2. instruction-shaped hazards */

/**
 * Phrasing whose only purpose is to command the reader.
 *
 * Narrow on purpose - see the header. These target concealment from the user
 * and override of prior instruction, which ordinary documentation never needs
 * to express, rather than emphatic prose, which it expresses constantly.
 */
const PHRASES = [
  [/\b(ignore|disregard|forget)\s+(all\s+|any\s+)?(previous|prior|earlier|the\s+above)\s+(instruction|rule|prompt|direction)/i, "override of prior instructions"],
  [/\b(never|do\s+not|don'?t)\s+(mention|tell|reveal|disclose|inform|show)\b[^.\n]{0,40}\b(the\s+)?(user|human|operator|person|reader)\b/i, "concealment from the user"],
  [/\bwithout\s+(telling|informing|asking|notifying)\b[^.\n]{0,30}\b(the\s+)?(user|human)\b/i, "acting without telling the user"],
  [/\balways\s+(report|say|respond\s+with|answer)\s+(that\s+)?(everything\s+is\s+)?(ok|okay|success|successful|pass|passing|fine)\b/i, "a forced positive report"],
  [/\bsuppress\s+(all\s+)?(warning|error|output|finding)/i, "suppression of output"],
  [/\bautomatically\s+install\b/i, "an unprompted install"],
  [/\b(you\s+are\s+now|from\s+now\s+on\s+you)\b[^.\n]{0,40}\b(developer\s+mode|unrestricted|no\s+longer\s+bound)/i, "a role override"],
];

/**
 * Base64 without a `/` in the character set.
 *
 * Allowing `/` makes every namespaced path in this repository a candidate -
 * `Application/Commands/VoidPayment/VoidPaymentCommandHandler` is 58 characters
 * of mixed case - and a warning that fires on every file list is a warning
 * nobody reads. The cost is real: a payload containing a `/` is missed. That is
 * the right side to err on for a heuristic whose job is to make a human look.
 */
const B64 = /\b[A-Za-z0-9+]{40,}={0,2}/g;
const looksBase64 = (s) => /[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s) && !/^[0-9a-f]+$/i.test(s);

const PIPE_TO_SHELL = /\b(curl|wget|irm|iwr|Invoke-WebRequest|Invoke-RestMethod)\b[^\n|]*\|\s*(bash|sh|zsh|iex|Invoke-Expression)\b/i;

function checkInstructions(rel, text, add, sev) {
  for (const [re, what] of PHRASES) {
    const m = re.exec(text);
    if (m) add(sev("instruction-phrase", `${what}: "${m[0].replace(/\s+/g, " ").slice(0, 80)}"`, { file: rel, line: lineOf(text, m.index) }));
  }

  // An HTML comment is invisible in rendered markdown and fully visible to the
  // model. That asymmetry is the classic carrier.
  //
  // The test is SECOND PERSON, not "contains an imperative", and this was
  // narrowed after running it: every generated skill in plugin/ opens with
  // "Do not edit here - edit the source and re-run the plugin build", which is a
  // note to a human about a build convention. Ninety-seven identical warnings is
  // how a check gets switched off, and then the real one is off too. A comment
  // that gives the MODEL orders reads differently, and that is what is flagged;
  // the PHRASES above already run over comment text as well, so an adversarial
  // comment is caught whether or not it addresses anyone directly.
  for (const m of text.matchAll(/<!--([\s\S]{0,600}?)-->/g)) {
    const body = m[1];
    if (/\b(you\s+(must|should|shall|will|need\s+to|are\s+to)|your\s+(task|instruction|goal|job)\s+is)\b/i.test(body)) {
      add(sev("html-comment-directive", `an HTML comment gives the model second-person orders: "${body.replace(/\s+/g, " ").trim().slice(0, 80)}". Invisible when rendered, fully visible to the model.`, { file: rel, line: lineOf(text, m.index) }));
    }
  }

  for (const m of text.matchAll(B64)) {
    if (looksBase64(m[0])) {
      add(sev("base64-blob", `${m[0].length} characters of base64-shaped text. Encoded content in an instruction file is unreviewable by definition.`, { file: rel, line: lineOf(text, m.index) }));
    }
  }

  for (const [i, line] of text.split("\n").entries()) {
    if (PIPE_TO_SHELL.test(line)) {
      add(sev("url-with-exec", `a download piped straight into a shell. guard-bash.mjs refuses this from the shell; an instruction file should not be teaching it.`, { file: rel, line: i + 1 }));
    }
  }
}

/* ----------------------------------------------------- 5. personal paths */

/**
 * A home directory in a shipped file.
 *
 * The patterns are ASSEMBLED rather than written literally, so this file does
 * not report itself - and so that the test suite for it can plant the shapes
 * without the write guard refusing to save the test.
 */
const U = "Users";
const PERSONAL = [
  new RegExp("/" + U + "/([A-Za-z][\\w.-]*)"),
  new RegExp("[A-Za-z]:\\\\" + U + "\\\\([A-Za-z][\\w.-]*)", "i"),
  new RegExp("/home/([A-Za-z][\\w.-]*)"),
];
const PLACEHOLDER_NAME = /^(name|username|user|you|youruser|yourname|your-username|example|me|someone|jdoe|alice|bob|test)$/i;

function checkPersonalPaths(rel, text, add, sev) {
  // A gitignored per-machine file is SUPPOSED to hold this machine's paths.
  if (/settings\.local\.json$/.test(rel)) return;
  for (const re of PERSONAL) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    for (const m of text.matchAll(g)) {
      if (PLACEHOLDER_NAME.test(m[1])) continue;
      const where = { file: rel, line: lineOf(text, m.index) };
      const msg = `a home directory of "${m[1]}" is in a shipped file. It breaks on every other machine, and it names a person.`;
      add(isMarkdown(rel) ? sev("personal-path", msg, where) : block("personal-path", msg, where));
    }
  }
}

/* ------------------------------------------------ 7. agent frontmatter */

/**
 * The agent definitions are load-bearing twice over: self-audit A5 resolves gate
 * reviewers by FILENAME, and omniroute.mjs resolves what a reviewer's judgement
 * costs by its `model:`. A name that disagrees with its filename, or a model no
 * tier can be read from, makes one of those two silently answer about the wrong
 * thing.
 *
 * The tier test is the same semantics as tierOf() in omniroute.mjs - a substring
 * test against the tier names, not a list of model ids - so a new Claude model
 * does not have to be registered in two places.
 */
const TIER_IN_MODEL = /(opus|sonnet|haiku)/i;

function checkAgent(rel, text, add, sev) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!fm) { add(block("agent-frontmatter-missing", `no YAML frontmatter, so neither its name nor its model can be read`, { file: rel, line: 1 })); return; }
  const body = fm[1];
  const field = (k) => { const m = new RegExp(`^${k}:[ \\t]*(.*)$`, "mi").exec(body); return m ? m[1].trim() : null; };
  const lineIn = (k) => { const m = new RegExp(`^${k}:`, "mi").exec(body); return m ? lineOf(text, m.index) + 1 : 1; };

  const expected = basename(rel).replace(/\.md$/i, "");
  const name = field("name");
  if (name !== expected) {
    add(block("agent-name-mismatch", `frontmatter name is ${JSON.stringify(name)} but the file is ${expected}.md. self-audit A5 resolves gate reviewers by filename, so the two must agree.`, { file: rel, line: lineIn("name") }));
  }

  const model = field("model");
  if (!model || !TIER_IN_MODEL.test(model)) {
    add(block("agent-model-unresolvable", `model is ${JSON.stringify(model)}, which no tier can be read from. omniroute.mjs cannot then say what this reviewer's judgement runs on.`, { file: rel, line: lineIn("model") }));
  }

  const tools = field("tools");
  if (tools === "" || tools === null) {
    add(sev("agent-tools-not-scalar", `tools is empty or a YAML sequence; Claude Code expects a comma-separated scalar`, { file: rel, line: lineIn("tools") }));
  }
}

/* ------------------------------------------------- shared credential shapes */

/**
 * The credential patterns are owned by .claude/hooks/_lib.mjs, where guard-write
 * and guard-prompt already read them. A scanner may DEGRADE when a shared
 * constant is unreachable - it says so and carries on; a guard may not, which is
 * why _lib.mjs keeps its own fail-closed fallbacks and this file does not.
 */
const lib = await (async () => {
  for (const rel of ["../../.claude/hooks/_lib.mjs", "../hooks/_lib.mjs"]) {
    try { return await import(new URL(rel, import.meta.url).href); } catch { /* try the next */ }
  }
  return null;
})();

const readJson = (abs) => { try { return JSON.parse(readFileSync(abs, "utf8")); } catch { return null; } };
const readIf = (abs) => { try { return readFileSync(abs, "utf8"); } catch { return null; } };
const lineIn = (text, re) => { const m = re.exec(text); return m ? lineOf(text, m.index) : 1; };

/* --------------------------------------------- 3. permissions in settings */

/**
 * `.claude/settings.json` decides what the agent may do before any hook runs.
 * A wildcard there is not a loosened rule, it is the absence of one, and it is a
 * single line in a file that reviewers skim for hook wiring.
 */
const WILDCARD = /^(Bash|Write|Edit|Read|WebFetch|MultiEdit)\(\s*\*\s*\)$/i;
const DESTRUCTIVE_ALLOW = /(^|\s)(rm\s+-[rRf]|git\s+push[^)]*--force|git\s+reset\s+--hard|dd\s+if=)/i;

function checkSettings(root, add, sev) {
  for (const rel of [".claude/settings.json", ".claude/settings.local.json"]) {
    const abs = join(root, rel);
    const text = readIf(abs);
    if (text === null) continue;

    if (/--dangerously-skip-permissions/.test(text)) {
      add(block("dangerously-skip-permissions", `the permission system is switched off here. Every guard in this repository runs downstream of it.`, { file: rel, line: lineIn(text, /--dangerously-skip-permissions/) }));
    }

    const cfg = readJson(abs);
    if (!cfg) { add(sev("settings-unparseable", `cannot be parsed, so what it permits cannot be read`, { file: rel, line: 1 })); continue; }
    const perms = cfg.permissions || {};
    const allow = Array.isArray(perms.allow) ? perms.allow : [];
    const deny = Array.isArray(perms.deny) ? perms.deny : [];

    for (const a of allow) {
      const s = String(a);
      if (WILDCARD.test(s) || s === "*") {
        add(block("permission-wildcard", `allow entry ${JSON.stringify(s)} grants a whole tool unconditionally`, { file: rel, line: lineIn(text, new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))) }));
      } else if (DESTRUCTIVE_ALLOW.test(s)) {
        add(block("permission-allows-destructive", `allow entry ${JSON.stringify(s)} pre-approves an irreversible command`, { file: rel, line: 1 }));
      }
    }

    // A missing deny list is not an error - it is the default, and the default
    // is that nothing is refused before a hook sees it. Worth saying once.
    if (rel === ".claude/settings.json" && !deny.length) {
      add(sev("deny-list-empty", `no permissions.deny entries: nothing is refused before the hooks run`, { file: rel, line: 1 }));
    }
  }
}

/* ------------------------------------------------- 4. MCP configuration */

/**
 * Judged on `.mcp.json` only, with the generated plugin copies compared rather
 * than re-scanned: reporting the same server three times is how a reader learns
 * to skim. guard-mcp.mjs enforces the POLICY at call time; this reads what the
 * config itself asks for before any call happens.
 */
function checkMcp(root, add, sev) {
  const rel = ".mcp.json";
  const mcp = readJson(join(root, rel));
  if (!mcp) return;
  const text = readIf(join(root, rel)) || "";
  const servers = mcp.mcpServers && typeof mcp.mcpServers === "object" ? mcp.mcpServers : {};
  const policy = readJson(join(root, ".cursor", "mcp-policy.json"));
  const registered = policy && policy.servers && typeof policy.servers === "object" ? policy.servers : null;

  for (const [name, cfg] of Object.entries(servers)) {
    if (name.startsWith("//") || !cfg || typeof cfg !== "object") continue;
    const line = lineIn(text, new RegExp(`"${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:`));

    for (const field of ["env", "headers"]) {
      const obj = cfg[field];
      if (!obj || typeof obj !== "object") continue;
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v !== "string") continue;
        const hit = lib ? lib.findSecret(v) : null;
        if (hit) add(block("mcp-literal-secret", `${name}.${field}.${k} holds a literal ${hit.what}. This file is committed; use \${ENV_VAR}.`, { file: rel, line }));
      }
    }
    if (!lib) add(sev("secret-patterns-unavailable", `_lib.mjs could not be imported, so ${rel} was not checked for literal credentials`, { file: rel, line: 1 }));

    const cmd = String(cfg.command || "");
    const args = Array.isArray(cfg.args) ? cfg.args.map(String) : [];

    if (/^npx$/i.test(cmd) && args.some((a) => /^(-y|--yes)$/.test(a))) {
      add(sev("mcp-npx-yes", `${name} runs \`npx -y\`, which installs whatever the registry currently serves without asking. guard-bash.mjs refuses the same command from the shell.`, { file: rel, line }));
    }
    if (/^(uvx|pipx)$/i.test(cmd)) {
      add(info("mcp-uvx", `${name} runs \`${cmd}\`, the Python equivalent of \`npx -y\`: it fetches before it runs`, { file: rel, line }));
    }

    const pkg = args.find((a) => a && !a.startsWith("-"));
    if (pkg && /^(npx|uvx|pipx)$/i.test(cmd)) {
      if (/@latest$/.test(pkg)) add(sev("mcp-unpinned", `${name} pulls ${pkg}: "latest" is whatever was published most recently, including this morning`, { file: rel, line }));
      else if (!/@\d/.test(pkg)) add(sev("mcp-unpinned", `${name} pulls ${pkg} with no version pin`, { file: rel, line }));
    }

    const remote = !!cfg.url || /^(http|sse|streamable-http)$/i.test(String(cfg.type || ""));
    if (registered && !Object.prototype.hasOwnProperty.call(registered, name)) {
      if (remote) add(sev("mcp-remote-unpolicied", `${name} is a remote transport with no entry in .cursor/mcp-policy.json. guard-mcp denies unlisted servers, so this registration is dead weight that still loads its schema into every session.`, { file: rel, line }));
      else add(info("mcp-unlisted-server", `${name} has no entry in .cursor/mcp-policy.json, so guard-mcp denies every call to it`, { file: rel, line }));
    }
  }

  // The plugin ships its own copies. If they drift, an installed plugin talks to
  // servers this repository never reviewed - and the review here would say clean.
  const canonical = JSON.stringify(servers);
  for (const copy of ["plugin/.mcp.json", "plugin/mcp.json"]) {
    const j = readJson(join(root, copy));
    if (!j) continue;
    if (JSON.stringify(j.mcpServers || {}) !== canonical) {
      add(block("mcp-plugin-copy-differs", `${copy} registers different servers from ${rel}. A plugin install would then talk to something this repository did not review. Rebuild with build-plugin.mjs.`, { file: copy, line: 1 }));
    }
  }
}

/* ------------------------------------------------------- 6. CI workflows */

/**
 * A workflow runs with the repository's credentials. `templates/ci` is labelled
 * separately because it is a template for somebody else's repository - the same
 * finding, but it is not this repository that is exposed by it.
 */
function checkWorkflows(root, add, sev) {
  for (const [dir, isTemplate] of [[".github/workflows", false], ["templates/ci", true]]) {
    let names = [];
    try { names = readdirSync(join(root, dir)).filter((f) => /\.ya?ml$/i.test(f)); } catch { continue; }
    for (const f of names) {
      const rel = `${dir}/${f}`;
      const text = readIf(join(root, dir, f));
      if (text === null) continue;
      const tag = isTemplate ? " (a template for adopter repositories)" : "";

      if (/^\s*pull_request_target\s*:/m.test(text)) {
        add(block("pull-request-target", `pull_request_target runs with write credentials in the context of a fork's pull request${tag}`, { file: rel, line: lineIn(text, /^\s*pull_request_target\s*:/m) }));
      }

      const grantsWrite = /^\s+[\w-]+:\s*write\s*$/m.test(text);
      const seen = new Set();
      for (const m of text.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)) {
        const u = m[1];
        if (u.startsWith("./") || /@[0-9a-f]{40}$/i.test(u) || seen.has(u)) continue;
        seen.add(u);
        add(sev("action-unpinned", `uses: ${u} is a moving tag, not a commit. Whoever controls that tag runs code in this workflow${tag}.`, { file: rel, line: lineOf(text, m.index) }));
      }

      if (grantsWrite && /uses:\s*actions\/checkout/.test(text) && !/persist-credentials:\s*false/.test(text)) {
        add(sev("checkout-persist-credentials", `the workflow grants write and checks out without persist-credentials: false, so the token stays in .git/config for every later step${tag}`, { file: rel, line: lineIn(text, /uses:\s*actions\/checkout/) }));
      }

      for (const m of text.matchAll(/^.*\b(npm (ci|install)|pnpm install|yarn install|bun install)\b.*$/gm)) {
        if (/--ignore-scripts/.test(m[0])) continue;
        add(info("npm-install-scripts", `dependency install without --ignore-scripts runs each package's lifecycle scripts${tag}`, { file: rel, line: lineOf(text, m.index) }));
      }
    }
  }
}

/* ------------------------------------------------------------------ scan */

function scan(args) {
  const json = args.includes("--json");
  const strict = args.includes("--strict");
  const ri = args.indexOf("--root");
  const root = ri >= 0 && args[ri + 1] ? args[ri + 1] : process.cwd();
  if (!existsSync(root)) { process.stderr.write(`harness-scan.mjs: no such directory: ${root}\n`); return 2; }

  // --strict promotes at the SOURCE, per the _findings.mjs convention: a reader
  // never has to know which flags were passed to interpret a severity.
  const sev = strict ? block : warn;

  const findings = [];
  const add = (f) => findings.push(f);
  const files = walk(root);

  for (const abs of files) {
    const rel = slash(relative(root, abs));
    let text;
    try { text = readFileSync(abs, "utf8"); } catch { continue; }

    checkHidden(rel, text, add);
    checkPersonalPaths(rel, text, add, sev);
    if (isInstructionFile(rel)) checkInstructions(rel, text, add, sev);
    if (isAgentFile(rel)) checkAgent(rel, text, add, sev);
  }

  // The config checks address specific named files rather than every file, so
  // they run once over the tree instead of inside the loop above.
  checkSettings(root, add, sev);
  checkMcp(root, add, sev);
  checkWorkflows(root, add, sev);

  const counts = { block: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  const summary = counts.block
    ? `${counts.block} blocking finding(s) in the harness itself`
    : counts.warn ? `no blocking findings; ${counts.warn} to look at` : `clean across ${files.length} file(s)`;

  if (json) {
    return emit(report({ tool: "harness-scan.mjs", command: "scan", findings, summary, data: { root: slash(root), scanned: files.length, counts } }));
  }

  out(`# Harness scan\n`);
  out(`  ${files.length} file(s) read under ${slash(root)}`);
  out(`  integrity judges CHANGE; this judges CONTENT. Neither replaces the other.\n`);

  for (const level of ["block", "warn", "info"]) {
    const list = findings.filter((f) => f.severity === level);
    if (!list.length) continue;
    out(`## ${level} (${list.length})`);
    for (const f of list) out(`  ${f.file}:${f.line || 1}  [${f.code}]\n    ${f.message}`);
    out("");
  }

  if (counts.block) {
    out(`FAILED: ${counts.block} blocking finding(s).`);
    out(`Nothing here is scored, and nothing is auto-fixed. Read each one and decide.`);
    return 1;
  }
  out(counts.warn ? `OK: no blocking findings. ${counts.warn} warning(s) above are for a human to weigh.` : `OK: clean.`);
  return 0;
}

/* ------------------------------------------------------------------- cli */

const CMDS = { scan };
const [cmd, ...args] = process.argv.slice(2);
if (!cmd || !CMDS[cmd]) {
  out(`harness-scan.mjs - reads the harness the way an attacker would.

  scan [--json] [--strict] [--root DIR]

Checks the CONTENT of the files that instruct the agent and configure the
harness: invisible characters, instruction-shaped prose in skills, agents and
rules, home directories in shipped files, and agent frontmatter the gate audit
and the model-tier report both depend on.

self-audit.mjs integrity answers a different question - whether these files are
the ones a human attested. A file can pass one and fail the other.

Exit 1 on a blocking finding, so CI can gate. Nothing is scored.`);
  process.exit(cmd ? 2 : 0);
}
process.exit(CMDS[cmd](args) ?? 0);
