#!/usr/bin/env node
// Claude Code: PreToolUse (Bash)   |   Cursor: beforeShellExecution
// Enforces 10-evidence-and-dependency-guard and blocks destructive/live-DB ops.
//
// Cursor's beforeShellExecution is the better attachment point of the two - it
// fires only for shell, carries the command at the top level, and can answer
// "ask" as well as deny. shellCommand() hides the shape difference.

import { readPayload, shellCommand, block, ok } from "./_lib.mjs";

await readPayload();
const cmd = shellCommand();
if (!cmd) ok();

const RULES = [
  {
    // dotnet add package Foo   /  dotnet package add Foo
    re: /\bdotnet\s+(add\s+(\S+\s+)?package|package\s+add)\s+\S/i,
    msg: `BLOCKED: adding a NuGet package.
.cursor/rules/10-evidence-and-dependency-guard.mdc: never introduce a package
that is not already in the repo unless the user explicitly asked for it.
Stop and ask. If the user approved it, they should run the command themselves,
or add it to Directory.Packages.props.`,
  },
  {
    // npm i <pkg> / npm install <pkg> / yarn add / pnpm add / bun add
    re: /\b(npm\s+(i|install|add)|yarn\s+add|pnpm\s+(add|install)|bun\s+add)\s+(?!-)(?!$)[@\w]/i,
    exempt: /\bnpm\s+(ci|install)\s*(--[\w-]+\s*)*$|\b(yarn|pnpm|bun)\s+install\s*(--[\w-]+\s*)*$/i,
    msg: `BLOCKED: installing a new npm package.
.cursor/rules/10-evidence-and-dependency-guard.mdc: no new dependencies unless
already in package.json or explicitly requested. Restoring the existing
lockfile (\`npm ci\`, \`npm install\` with no package name) is allowed.`,
  },
  {
    re: /\bdotnet\s+ef\s+database\s+update/i,
    msg: `BLOCKED: \`dotnet ef database update\` mutates a real database.
Generate and review the migration, then let a human apply it. Use
\`dotnet ef migrations script\` to produce reviewable SQL instead.`,
  },
  {
    re: /\bdotnet\s+ef\s+migrations\s+remove/i,
    msg: `BLOCKED: removing a migration can desync the model snapshot from applied
history. Ask the user before touching migration history.`,
  },
  {
    re: /\bgit\s+push\b[^|;&]*\s(--force|-f)\b/i,
    exempt: /--force-with-lease/i,
    msg: `BLOCKED: force push. Use \`--force-with-lease\` at minimum, and confirm with
the user first - this can destroy a teammate's commits.`,
  },
  {
    re: /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f)/i,
    msg: `BLOCKED: destructive git command - this discards uncommitted work.
Confirm with the user, or stash instead.`,
  },
  {
    re: /\b(rm\s+-rf?\s+\/(?!\w)|rm\s+-rf?\s+[~*]\s*$)/,
    msg: `BLOCKED: destructive recursive delete with a dangerous target.`,
  },
  {
    re: /\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE)\b/i,
    msg: `BLOCKED: destructive DDL. Emit the statement as reviewed SQL for a human to
run; never execute it. (.cursor/rules/06-database-provider-guard.mdc)`,
  },
];

for (const r of RULES) {
  if (r.re.test(cmd) && !(r.exempt && r.exempt.test(cmd))) block(r.msg + `\n\nCommand: ${cmd}`);
}

ok();
