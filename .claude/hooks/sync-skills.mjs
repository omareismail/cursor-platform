#!/usr/bin/env node
// Regenerates .claude/skills/<name>/SKILL.md shims from .cursor/skills/.
// Run after adding, renaming, or removing a skill:  node .claude/hooks/sync-skills.mjs
// The shims contain no skill content - .cursor/skills/<name>/skill.md stays the
// single source of truth for both Cursor and Claude Code.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { projectDir } from "./_lib.mjs";

const root = projectDir();
const SRC = join(root, ".cursor", "skills");
const DST = join(root, ".claude", "skills");

// Hand-written descriptions win over auto-extraction. Auto-extraction reads the
// Overview paragraph, which in ~10 skills is rationale rather than description.
const OVERRIDES_PATH = join(DST, "_descriptions.json");
let OVERRIDES = {};
try { OVERRIDES = JSON.parse(readFileSync(OVERRIDES_PATH, "utf8")); } catch { /* optional */ }

const SKIP = ["**Memory references", "**Invocation", "**Reads", "**Writes", "**Depends"];
const clean = (t) => t
  .replace(/`([^`]+)`/g, "$1")
  .replace(/\*\*([^*]+)\*\*/g, "$1")
  .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
  .replace(/\s+/g, " ")
  .trim();

function firstTwoSentences(t, cap = 400) {
  const d = t.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").trim();
  return d.length > cap ? d.slice(0, cap - 3).replace(/\s+\S*$/, "") + "..." : d;
}

function describe(md, name) {
  const m = md.match(/^##\s+Overview\s*$/m);
  let body = m ? md.slice(m.index + m[0].length) : md;
  body = body.split(/^##\s+/m)[0];
  const paras = body.split("\n\n").map(s => s.trim())
    .filter(s => s && !/^(---|#|\||```|>|-|\*|\d+\.)/.test(s));
  for (const p of paras) {                       // prefer the self-describing paragraph
    const c = clean(p);
    if (c.toLowerCase().startsWith(name.toLowerCase()) && c.length > 60) return firstTwoSentences(c);
  }
  for (const p of paras) {
    if (SKIP.some(s => p.startsWith(s))) continue;
    const c = clean(p);
    if (c.length > 60) return firstTwoSentences(c);
  }
  return `Runs the ${name} workflow from the cursor-platform skill library.`;
}

const HOUSEKEEPING = new Set(["repo-discovery", "context-builder", "context-sync", "pattern-finder"]);
const GENERATORS = new Set(["refactor-apply", "dotnet-migration", "work-breakdown", "postmortem", "release-safety",
                            // Lifecycle phase skills: each writes a phase artifact the next
                            // phase depends on, so they announce and wait like any generator.
                            "lifecycle", "product-brief", "product-requirements", "user-story-map",
                            "risk-register", "solution-architecture", "api-contract-design",
                            "data-model-design", "ux-design-bridge", "test-strategy",
                            "feature-pipeline", "go-live", "change-request"]);
// Read-only analysis of code that already exists. Announce, then proceed.
const ANALYSIS = new Set(["feature-trace", "impact-analysis", "feature-inventory",
                          "production-readiness-review", "delivery-metrics", "threat-model",
                          "task-verify",
                          // Judges a phase's artifacts and returns GO/NO-GO. Writes nothing.
                          "lifecycle-gate"]);
function category(n) {
  if (n.startsWith("speckit-")) return "E (spec pipeline) - announce, then wait for go-ahead";
  if (HOUSEKEEPING.has(n)) return "D (housekeeping) - run silently, no announcement";
  if (n.endsWith("-gen") || GENERATORS.has(n)) return "A (generates/modifies files) - announce, then wait for go-ahead";
  if (/audit|guard/.test(n) || ANALYSIS.has(n)) return "B (read-only analysis) - announce, then proceed";
  return "C (docs/diagrams) - announce, then proceed";
}

const tmpl = (n, desc, cat) => `---
name: ${n}
description: "${desc}"
---

# ${n}

> **Registration shim.** Canonical instructions live in
> \`.cursor/skills/${n}/skill.md\` - single source of truth, shared with Cursor.
> This file exists only so Claude Code discovers and auto-routes the skill.
> Regenerate with \`node .claude/hooks/sync-skills.mjs\`; never edit by hand.

## How to run this skill

1. **Read \`.cursor/skills/${n}/skill.md\` now** and follow every step literally.
2. Apply the platform contract in \`AGENTS.md\`:
   - **Category:** ${cat}
   - Announcement (unless Category D): \`**Matched skill:** ${n} - [one-line description].\`
3. Guard rules in \`.cursor/rules/\` are binding. Claude Code does not auto-load
   \`.mdc\` files, so read the matching rule before generating:

   | Files touched | Read first (in \`.cursor/rules/\`) |
   |---|---|
   | \`**/*.cs\`, \`**/*.csproj\` | \`02-dotnet-architecture-guard.mdc\`, \`07-audit-trail-guard.mdc\` |
   | \`**/*.tsx\`, \`**/*.ts\` | \`03-react-architecture-guard.mdc\`, \`08-rtl-i18n-guard.mdc\` |
   | \`**/*.sql\`, \`**/*.cs\` | \`06-database-provider-guard.mdc\` |
   | any of the above | \`04-security-guard.mdc\` |

   Rules \`00\`, \`05\`, \`09\`, \`10\` are always binding - summarised in \`CLAUDE.md\`
   and injected by the \`SessionStart\` hook.
4. After significant work, update \`memory-bank/activeContext.md\` and
   \`memory-bank/progress.md\`.
`;

if (!existsSync(SRC)) { console.error(`No ${SRC} - nothing to sync.`); process.exit(1); }
mkdirSync(DST, { recursive: true });

const names = readdirSync(SRC).filter(n => statSync(join(SRC, n)).isDirectory() && existsSync(join(SRC, n, "skill.md")));
const keep = new Set(names);
let written = 0, overridden = 0;

for (const n of names) {
  const md = readFileSync(join(SRC, n, "skill.md"), "utf8");
  const base = OVERRIDES[n] || describe(md, n);
  if (OVERRIDES[n]) overridden++;
  const desc = `${base} Invoked as /${n}.`.replace(/"/g, "'").replace(/\\/g, "/");
  mkdirSync(join(DST, n), { recursive: true });
  writeFileSync(join(DST, n, "SKILL.md"), tmpl(n, desc, category(n)), "utf8");
  written++;
}

let removed = 0;
for (const d of readdirSync(DST)) {
  const full = join(DST, d);
  if (!statSync(full).isDirectory()) continue;          // leaves _descriptions.json alone
  if (!keep.has(d)) { rmSync(full, { recursive: true, force: true }); removed++; }
}

console.log(`sync-skills: ${written} shim(s) written (${overridden} from _descriptions.json), ${removed} orphan(s) removed.`);
const missing = Object.keys(OVERRIDES).filter(k => k !== "//" && !keep.has(k));
if (missing.length) console.warn(`WARNING: _descriptions.json has entries with no matching skill: ${missing.join(", ")}`);
console.log(`Auto-extracted descriptions come from each skill's Overview paragraph. Review any that`);
console.log(`read oddly and add an override - description quality is what determines whether Claude`);
console.log(`Code routes to the right skill.`);
