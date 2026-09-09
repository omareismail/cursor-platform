#!/usr/bin/env node
/**
 * flag-debt.mjs — finds feature flags that outlived their purpose.
 *
 * WHY THIS EXISTS
 *
 * The documented flag lifecycle ends with Cleanup: flag removed, dead branch
 * deleted. In practice that step is the one nobody does. A flag that has been
 * 100% on for fourteen months is not a flag — it is permanent dead branching
 * that every future reader has to reason about, and every future agent has to
 * fit in its context window.
 *
 * Nothing catches this on its own, because a stale flag breaks nothing. It just
 * quietly doubles the paths through the code. That is exactly the class of
 * problem a mechanical check is for.
 *
 * THE CONVENTION
 *
 * A flag is declared with a comment adjacent to its definition or first use:
 *
 *   // FLAG: premium-v2 owner=@mahmoud expires=2026-09-30
 *   // reason: tiered pricing rollout, remove once 100% for 14 days
 *
 * Recognised in C#, TS/JS (// and / * * /), and YAML/config (#). Key order is
 * free; `owner` and `expires` are both required.
 *
 * Usage:
 *   node .cursor/tools/flag-debt.mjs scan [path] [--json] [--warn-days 14]
 *   node .cursor/tools/flag-debt.mjs scan --strict     # undeclared flags also fail
 *
 * Exit codes:  0 = clean   1 = expired or undeclared flags found   2 = usage
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { report, emit, block, warn, info } from "./_findings.mjs";
import { join, extname } from "node:path";

const ROOT = process.env.CLAUDE_PROJECT_DIR || repoRoot() || process.cwd();

const SOURCE_EXT = new Set([".cs", ".ts", ".tsx", ".js", ".jsx", ".razor", ".yml", ".yaml", ".json", ".config"]);
const SKIP_DIR = /(^|\/)(bin|obj|node_modules|dist|\.next|coverage|TestResults|\.git|Migrations)(\/|$)/;

/**
 * Call sites that mean "a feature flag is being read". Deliberately broad —
 * a false positive costs one comment; a missed permanent flag costs a reader
 * every time they open the file.
 */
const FLAG_CALLS = [
  // .NET: LaunchDarkly, OpenFeature, Azure App Config, custom IFeatureManager
  /\bIsEnabledAsync\s*\(\s*["']([^"']+)["']/g,
  /\bIsEnabled\s*\(\s*["']([^"']+)["']/g,
  /\bFeatureManager\s*\.\s*\w+\s*\(\s*["']([^"']+)["']/g,
  /\[FeatureGate\s*\(\s*["']([^"']+)["']/g,
  /\bGetBoolValue\s*\(\s*["']([^"']+)["']/g,
  // TS/JS: LaunchDarkly, Flagsmith, Unleash, custom hooks
  /\buseFlag\s*\(\s*["'`]([^"'`]+)["'`]/g,
  /\buseFeatureFlag\s*\(\s*["'`]([^"'`]+)["'`]/g,
  /\bflags?\s*\.\s*isEnabled\s*\(\s*["'`]([^"'`]+)["'`]/g,
  /\bvariation\s*\(\s*["'`]([^"'`]+)["'`]/g,
];

/** // FLAG: name owner=@x expires=YYYY-MM-DD   (also #, and inside block comments) */
const DECL = /(?:\/\/|#|\*)\s*FLAG:\s*([A-Za-z0-9._-]+)([^\n]*)/g;

// ------------------------------------------------------------------ utils --
function repoRoot() {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { stdio: "pipe" }).toString().trim(); }
  catch { return null; }
}

function trackedFiles() {
  try {
    return execFileSync("git", ["ls-files"], { cwd: ROOT, stdio: "pipe", maxBuffer: 64 * 1024 * 1024 })
      .toString().split("\n").filter(Boolean);
  } catch { return []; }
}

function walk(dir, acc = []) {
  for (const name of safeReaddir(dir)) {
    const full = join(dir, name);
    const rel = full.slice(ROOT.length + 1).split("\\").join("/");
    if (SKIP_DIR.test("/" + rel)) continue;
    let st; try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, acc);
    else if (SOURCE_EXT.has(extname(name))) acc.push(rel);
  }
  return acc;
}
function safeReaddir(d) {
  try { return readdirSync(d); } catch { return []; }
}

const out = (s = "") => process.stdout.write(s + "\n");
const pad = (s, n) => String(s).slice(0, n - 1).padEnd(n);
function fail(msg, code = 2) { process.stderr.write(msg + "\n"); process.exit(code); }
const days = (from, to = Date.now()) => Math.round((to - from) / 86_400_000);

// ------------------------------------------------------------------ scan ---
function scan(args) {
  const target = args.find(a => !a.startsWith("--")) || ".";
  const json = args.includes("--json");
  const strict = args.includes("--strict");
  const wi = args.indexOf("--warn-days");
  const warnDays = wi >= 0 ? Number(args[wi + 1]) : 14;

  let files = trackedFiles().filter(f => SOURCE_EXT.has(extname(f)) && !SKIP_DIR.test("/" + f));
  if (!files.length) {
    const base = join(ROOT, target === "." ? "" : target);
    files = existsSync(base) ? walk(base) : [];
  }
  if (target !== ".") files = files.filter(f => f.startsWith(target.replace(/^\.\//, "")));

  const declared = new Map();   // name -> {owner, expires, file, line, reason}
  const used = new Map();       // name -> [{file, line}]

  for (const rel of files) {
    let text;
    try { text = readFileSync(join(ROOT, rel), "utf8"); } catch { continue; }
    if (!/FLAG:|IsEnabled|useFlag|useFeatureFlag|variation|FeatureGate|GetBoolValue/.test(text)) continue;
    const lines = text.split("\n");

    // declarations
    for (const m of text.matchAll(DECL)) {
      const name = m[1];
      const meta = m[2] || "";
      const owner = (meta.match(/owner\s*=\s*(\S+)/i) || [])[1] || null;
      const expires = (meta.match(/expires?\s*=\s*(\d{4}-\d{2}-\d{2})/i) || [])[1] || null;
      const line = text.slice(0, m.index).split("\n").length;
      const reason = (lines[line] || "").match(/reason:\s*(.+)$/i)?.[1]?.trim() || null;
      if (!declared.has(name)) declared.set(name, { name, owner, expires, file: rel, line, reason });
    }

    // usages
    for (const re of FLAG_CALLS) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        const name = m[1];
        if (!name || name.length > 80) continue;
        const line = text.slice(0, m.index).split("\n").length;
        if (!used.has(name)) used.set(name, []);
        used.get(name).push({ file: rel, line });
      }
    }
  }

  const today = Date.now();
  const expired = [], expiringSoon = [], noOwner = [], undeclared = [], orphanDecl = [], healthy = [];

  for (const [name, d] of declared) {
    const sites = used.get(name) || [];
    const rec = { ...d, uses: sites.length, sites: sites.slice(0, 3) };
    if (!sites.length) { orphanDecl.push(rec); continue; }

    const missing = [];
    if (!d.owner) missing.push("no owner=");
    const exp = d.expires ? Date.parse(d.expires) : NaN;
    if (!d.expires) missing.push("no expires=");
    else if (Number.isNaN(exp)) missing.push("unparseable expires=");
    if (missing.length) { noOwner.push({ ...rec, missing }); if (Number.isNaN(exp)) continue; }
    if (Number.isNaN(exp)) continue;

    if (exp < today) expired.push({ ...rec, overdueDays: days(exp) });
    else if (exp - today < warnDays * 86_400_000) expiringSoon.push({ ...rec, inDays: -days(exp) });
    else healthy.push(rec);
  }

  for (const [name, sites] of used) {
    if (!declared.has(name)) undeclared.push({ name, uses: sites.length, sites: sites.slice(0, 3) });
  }

  const result = { scanned: files.length, declared: declared.size, used: used.size,
                   expired, expiringSoon, noOwner, undeclared, orphanDecl, healthy };

  if (json) {
    const findings = [
      ...expired.map((f) => block("expired-flag", `${f.name} expired ${f.overdueDays}d ago (owner ${f.owner || "none"}, ${f.uses} use site(s))`, { ref: f.name, file: f.file, line: f.line })),
      ...expiringSoon.map((f) => warn("expiring-flag", `${f.name} expires in ${f.inDays}d (owner ${f.owner || "none"})`, { ref: f.name, file: f.file, line: f.line })),
      ...noOwner.map((f) => warn("unowned-flag", `${f.name}: ${f.missing.join(", ")}`, { ref: f.name, file: f.file, line: f.line })),
      ...undeclared.map((f) => (strict ? block : warn)("undeclared-flag", `${f.name} is read in ${f.uses} place(s) and has no FLAG: declaration`, { ref: f.name, file: f.sites[0]?.file, line: f.sites[0]?.line })),
      ...orphanDecl.map((f) => info("orphan-flag", `${f.name} is declared and never read`, { ref: f.name, file: f.file, line: f.line })),
    ];
    const bad = expired.length + (strict ? undeclared.length : 0);
    return emit(report({
      tool: "flag-debt.mjs", command: "scan", findings,
      summary: bad ? `FAILED: ${expired.length} expired${strict && undeclared.length ? `, ${undeclared.length} undeclared` : ""}` : `OK: no expired flags`,
      data: result,
    }));
  }

  out(`# Feature-flag debt\n`);
  out(`  ${files.length} files scanned | ${declared.size} declared, ${used.size} in use\n`);

  if (expired.length) {
    out(`## EXPIRED (${expired.length}) - these are permanent dead branching now`);
    for (const f of expired) {
      out(`  ${pad(f.name, 28)} ${f.overdueDays}d overdue   owner ${f.owner || "(none)"}   ${f.uses} use site(s)`);
      out(`    declared ${f.file}:${f.line}`);
      for (const s of f.sites) out(`    used     ${s.file}:${s.line}`);
      if (f.reason) out(`    reason   ${f.reason}`);
    }
    out("");
  }
  if (expiringSoon.length) {
    out(`## Expiring within ${warnDays} days (${expiringSoon.length})`);
    for (const f of expiringSoon) out(`  ${pad(f.name, 28)} in ${f.inDays}d   owner ${f.owner || "(none)"}`);
    out("");
  }
  if (noOwner.length) {
    out(`## Missing owner or expiry (${noOwner.length}) - nobody is accountable for removing these`);
    for (const f of noOwner) out(`  ${pad(f.name, 28)} ${pad(f.file + ":" + f.line, 34)} ${f.missing.join(", ")}`);
    out("");
  }
  if (undeclared.length) {
    out(`## Undeclared (${undeclared.length}) - in use, no FLAG: comment${strict ? " [FAILS in --strict]" : ""}`);
    for (const f of undeclared.slice(0, 20)) {
      out(`  ${pad(f.name, 28)} ${f.uses} use site(s)   ${f.sites[0].file}:${f.sites[0].line}`);
    }
    if (undeclared.length > 20) out(`  ... and ${undeclared.length - 20} more`);
    out(`\n  Add above the definition or first use:`);
    out(`    // FLAG: <name> owner=@you expires=YYYY-MM-DD`);
    out(`    // reason: <why it exists and what "done" looks like>\n`);
  }
  if (orphanDecl.length) {
    out(`## Declared but never read (${orphanDecl.length}) - already removed from code, or never wired up`);
    for (const f of orphanDecl) out(`  ${pad(f.name, 28)} ${f.file}:${f.line}`);
    out(`\n  If the code path is gone, delete the declaration too.\n`);
  }
  if (healthy.length) out(`## Healthy (${healthy.length}) - owned, dated, not yet due\n`);

  const bad = expired.length + (strict ? undeclared.length : 0);
  if (bad) {
    out(`FAILED: ${expired.length} expired${strict && undeclared.length ? `, ${undeclared.length} undeclared` : ""}.`);
    out(`An expired flag is not a flag. Either finish the rollout and delete the`);
    out(`old path, or push the expiry date with a reason - but make it a decision,`);
    out(`not a default.`);
    return 1;
  }
  out(`OK: no expired flags.`);
  return 0;
}

const CMDS = { scan };
const [cmd, ...args] = process.argv.slice(2);
if (!cmd || !CMDS[cmd]) {
  out(`flag-debt.mjs — finds feature flags that outlived their purpose.

  scan [path] [--json] [--strict] [--warn-days 14]

Declare each flag next to its definition or first use:
  // FLAG: premium-v2 owner=@mahmoud expires=2026-09-30
  // reason: tiered pricing rollout, remove once 100% for 14 days

Exit 1 on expired flags (and on undeclared flags with --strict), so CI can gate.
See .cursor/skills/release-safety/skill.md.`);
  process.exit(cmd ? 2 : 0);
}
process.exit(CMDS[cmd](args) ?? 0);
