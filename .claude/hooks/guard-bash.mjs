#!/usr/bin/env node
// Claude Code: PreToolUse (Bash)   |   Cursor: beforeShellExecution
// Enforces 10-evidence-and-dependency-guard and blocks destructive/live-DB ops.
//
// Cursor's beforeShellExecution is the better attachment point of the two - it
// fires only for shell, carries the command at the top level, and can answer
// "ask" as well as deny. shellCommand() hides the shape difference.

import { readPayload, shellCommand, block, ok, relPath, isProtected, protectedPatterns, platformDev } from "./_lib.mjs";
import { judge, looksLikeSql } from "./_sql.mjs";

await readPayload();
const cmd = shellCommand();
if (!cmd) ok();

/* ------------------------------------------------- 1. the approval commands */
// `approve`, `override`, `sign` and `init --existing` are the three consents
// the lifecycle exists to collect from a HUMAN. Run from the agent's shell they
// are a human consent typed by a machine, with whatever name the agent chose
// for --by. There is no escape for this rule on purpose: the human runs the
// command in their own terminal, where no hook is watching, which is the point.
const HUMAN_ONLY = [
  [/\blifecycle\.mjs\b[^|;&]*\bapprove\b/i, "lifecycle.mjs approve", "the human consent on a gate"],
  [/\blifecycle\.mjs\b[^|;&]*\boverride\b/i, "lifecycle.mjs override", "acceptance of a named risk by its owner"],
  [/\blifecycle\.mjs\b[^|;&]*\binit\b[^|;&]*--existing\b/i, "lifecycle.mjs init --existing", "the declaration that phases 1-3 were done before the lifecycle was adopted"],
  [/\brelease-evidence\.mjs\b[^|;&]*\bsign\b/i, "release-evidence.mjs sign", "the signature on a release"],
  // The manifest attests to the enforcement surface. An agent that could change
  // a hook and then re-attest it would have closed the loop on itself.
  [/\bself-audit\.mjs\b[^|;&]*\bintegrity\b[^|;&]*--write\b/i, "self-audit.mjs integrity --write", "the attestation that the hooks, policies and gates are what a human last reviewed"],
  // A broken evidence chain is the one refusal no override reaches. Resealing it
  // is a person accepting, by name, that the records are what they now are.
  [/\blifecycle\.mjs\b[^|;&]*\bevidence\b[^|;&]*\breseal\b/i, "lifecycle.mjs evidence reseal", "acceptance that the record of every lifecycle decision is what it is now, after something changed it"],
];
for (const [re, what, means] of HUMAN_ONLY) {
  if (re.test(cmd)) {
    block(`BLOCKED: \`${what}\` is a human's command.

It records ${means}. Typed by an agent it is a human consent with a machine
behind it, under whatever name the agent put after --by. Show the user the exact
command and let them run it in their own terminal. record-gate (the reviewer's
verdict) is the agent's job; approve is not.

Command: ${cmd}`);
  }
}

/* --------------------------------------------- 2. writes to protected paths */
// The Write tool is refused on the enforcement surface by guard-write.mjs. A
// shell has a dozen other ways to write a file, and every one of them used to
// be open: `echo {} > .cursor/mcp-policy.json` was a policy change nobody read.
// A command that names a protected path AND contains something that writes,
// moves, deletes or restores is refused. Reads (`cat`, `git diff`, running a
// tool) pass.
if (!platformDev()) {
  const WRITES = new RegExp([
    String.raw`(^|[^<>&|\w])>{1,2}(?!&)`,                                              // redirect, not 2>&1 / here-doc
    String.raw`\|\s*(tee|Out-File|Set-Content|Add-Content|sponge)\b`,
    String.raw`\b(Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Move-Item|Copy-Item|Rename-Item|Clear-Content|ri|rni|mi|cpi|sc|ac)\b`,
    String.raw`(^|[\s;&|(])(rm|del|erase|mv|move|cp|copy|truncate|touch|ln|install|tee|ren|rmdir|rd|unlink|shred)\b`,
    String.raw`\b(sed|perl)\s+(-[a-zA-Z]*i|--in-place)\b`,
    String.raw`\bdd\b[^|;&]*\bof=`,
    String.raw`\b(node|deno|bun)\s+(-[a-z]*e|--eval|-p|--print)\b`,
    String.raw`\bpython[0-9.]*\s+-c\b`,
    String.raw`\b(powershell|pwsh)(\.exe)?\b[^|;&]*\s-(c|command|e|ec|enc|encodedcommand)\b`,
    String.raw`\b(bash|sh|zsh|dash)\s+-c\b`,
    String.raw`\bcmd(\.exe)?\s+/[ck]\b`,
    String.raw`\beval\b`,
    String.raw`\bbase64\b`,
    String.raw`\bgit\s+(checkout|restore|rm|mv|clean|stash)\b`,
    String.raw`\b(Invoke-Expression|iex|Invoke-WebRequest\b[^|;&]*-OutFile|curl\b[^|;&]*\s-o\b|wget\b[^|;&]*\s-O\b)`,
    String.raw`\b(chmod|chown|attrib|icacls)\b`,
  ].join("|"), "i");

  if (WRITES.test(cmd)) {
    // Every path-like token, normalised the way relPath normalises a tool path.
    // A `cd` earlier in the same command re-bases the tokens after it, so
    // `cd lifecycle; echo {} > state.json` is judged as lifecycle/state.json.
    const norm = (t) => (/^([a-zA-Z]:)?[\\/]/.test(t) ? relPath(t) : t.replace(/\\/g, "/").replace(/^\.\//, ""));
    const cds = [...cmd.matchAll(/(?:^|[\s;&|(])(?:cd|pushd|Set-Location|sl)\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|)]+))/gi)]
      .map((m) => norm(m[1] ?? m[2] ?? m[3])).filter((d) => d && d !== "-");
    // A directory above a protected file is protected against rm/mv/cp too:
    // `rm -rf .claude/hooks` removes every guard without naming one.
    const ancestorOf = (rel) => protectedPatterns().find((g) => g.toLowerCase().startsWith(rel.toLowerCase().replace(/\/+$/, "") + "/")) || null;
    const tokens = cmd.replace(/["'`]/g, " ").split(/[\s=;&|()<>]+/).filter(Boolean);
    for (const t of tokens) {
      if (!/[\\/]|^\.(mcp|gitignore)|\.(json|mjs|md)$/i.test(t)) continue;
      const rel = norm(t);
      if (!rel) continue;
      const hit = isProtected(rel) || ancestorOf(rel) || cds.map((d) => isProtected(`${d}/${rel}`) || ancestorOf(`${d}/${rel}`)).find(Boolean);
      if (!hit) continue;
      block(`BLOCKED: this command writes to a protected path.

  path:     ${rel}
  rule:     ${hit}
  policy:   .cursor/lifecycle/write-policy.json -> protected

These files are the enforcement surface - the hooks, their wiring, the policies
they read and the records they produce. An agent that can change them can
change the rules it is held to. Propose the change to the user in chat; if they
want it, they make it. A human developing the platform itself sets
CURSOR_PLATFORM_DEV=1 in the editor's environment - a variable, not a file,
because a file is something an agent can write.

Command: ${cmd}`);
    }
  }
}

/* ------------------------------------------------------- 3. SQL via psql */
// The MCP path is classified by guard-mcp.mjs. The shell path was open: `psql
// -c "DELETE ..."` was only refused when the text happened to contain DROP or
// TRUNCATE. The same classifier now judges what psql is handed; a file (-f) is
// unreviewable from here and is a human's to run.
if (/\bpsql\b/i.test(cmd)) {
  const READ_ONLY = { sqlAllow: ["SELECT", "WITH", "EXPLAIN", "SHOW", "TABLE", "VALUES"] };
  if (/\bpsql\b[^|;&]*\s(-f|--file)(\s|=)/i.test(cmd)) {
    block(`BLOCKED: \`psql -f\` runs a file against a database.

Nothing here can read what the file will do. Emit the SQL for review and let a
human run it - templates/postgres/readonly-role.sql is a human's to apply for
exactly this reason.

Command: ${cmd}`);
  }
  const candidates = [];
  for (const m of cmd.matchAll(/(?:-c|--command)(?:\s+|=)("((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+))/gi)) candidates.push(m[2] ?? m[3] ?? m[4]);
  for (const m of cmd.matchAll(/<<-?\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\s*\1\b/g)) candidates.push(m[2]);
  for (const m of cmd.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)) candidates.push(m[1] ?? m[2]);
  for (const sql of candidates) {
    if (!sql || !looksLikeSql(sql)) continue;
    const v = judge(sql, READ_ONLY);
    if (v.ok) continue;
    block(`BLOCKED: psql was handed SQL that is not a single read.

  reason:    ${v.reason}
  ${v.detail ? "detail:    " + v.detail : ""}
  statement: ${sql.trim().slice(0, 160)}

Emit the statement as reviewed SQL for a human to run; never execute it from
here. (.cursor/rules/06-database-provider-guard.mdc)

Command: ${cmd}`);
  }
}

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
    //
    // The flag group is why this is not simply `\s+(?!-)`. That earlier form
    // gave up on the whole match at the first flag, so `npm install --save
    // lodash`, `npm i --save-dev jest`, `yarn add -D vite` and `pnpm add -w foo`
    // all went straight through - which is how anyone actually adds a dev
    // dependency. Rule 10 was unenforced for the common case and nothing said
    // so. Skip the flags, then require a real package token.
    re: /\b(npm\s+(i|install|add)|yarn\s+add|pnpm\s+(add|install)|bun\s+add)(\s+-{1,2}[\w-]+)*\s+(?!-)[@\w][\w@.\/-]*/i,
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
