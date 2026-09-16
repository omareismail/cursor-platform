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
  if (/\bpsql\b[^|;&]*<\s*(?!<|&)(\S+)/i.test(cmd)) {
    block(`BLOCKED: \`psql < file\` runs a file against a database.

Nothing here can read what the file will do. Emit the SQL for review and let a
human run it.

Command: ${cmd}`);
  }
  if (/\b(cat|type|Get-Content)\b[^|;&]*\|\s*psql\b/i.test(cmd)) {
    block(`BLOCKED: piping a file into psql runs SQL this hook cannot read.

Emit the statement as reviewed SQL for a human to run.

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

/**
 * Split a command into statements, then into argv, respecting quotes.
 *
 * POSIX and PowerShell disagree about escapes (`\` vs `` ` ``) and both are
 * handed to this hook. A deny-list that parses with only one dialect will
 * miss the other: `"C:\"` is a closed path in PowerShell and an open quote
 * in POSIX. Newlines are statement boundaries in both, outside quotes.
 * Regexes that stop at `|;&` also miss `git push --force; echo` and quoted
 * `+` refspecs; those are the same operations with ordinary syntax.
 */
function splitStatements(s, dialect = "posix") {
  const parts = [];
  let cur = "";
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (dialect === "pwsh") {
        if (q === '"' && c === "`" && i + 1 < s.length) { cur += c; cur += s[++i]; continue; }
        if (c === q) { q = null; cur += c; continue; }
        cur += c;
        continue;
      }
      cur += c;
      if (c === q && s[i - 1] !== "\\") q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { q = c; cur += c; continue; }
    if (c === "\n" || c === "\r") {
      if (cur.trim()) parts.push(cur.trim());
      cur = "";
      if (c === "\r" && s[i + 1] === "\n") i++;
      continue;
    }
    if (c === ";") { if (cur.trim()) parts.push(cur.trim()); cur = ""; continue; }
    if (c === "&" && s[i + 1] === "&") { if (cur.trim()) parts.push(cur.trim()); cur = ""; i++; continue; }
    if (c === "|" && s[i + 1] === "|") { if (cur.trim()) parts.push(cur.trim()); cur = ""; i++; continue; }
    if (c === "|") { if (cur.trim()) parts.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function tokenize(stmt, dialect = "posix") {
  const tokens = [];
  let cur = "";
  let q = null;
  for (let i = 0; i < stmt.length; i++) {
    const c = stmt[i];
    if (q) {
      if (dialect === "pwsh") {
        if (q === '"' && c === "`" && i + 1 < stmt.length) { cur += stmt[++i]; continue; }
        if (c === q && stmt[i + 1] === q) { cur += c; i++; continue; }
        if (c === q) { q = null; continue; }
        cur += c;
        continue;
      }
      if (c === q) { q = null; continue; }
      if (c === "\\" && q === '"' && i + 1 < stmt.length) { cur += stmt[++i]; continue; }
      cur += c;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    if (/\s/.test(c)) { if (cur) { tokens.push(cur); cur = ""; } continue; }
    cur += c;
  }
  if (cur) tokens.push(cur);
  return tokens;
}

function isGitForcePush(tokens) {
  let i = 0;
  while (i < tokens.length && !/^(git)(\.exe)?$/i.test(tokens[i])) i++;
  if (i >= tokens.length) return false;
  i++;
  while (i < tokens.length && tokens[i] !== "push") {
    const t = tokens[i];
    if (t === "-C" || t === "-c" || t === "--git-dir" || t === "--work-tree") { i += 2; continue; }
    if (t.startsWith("--git-dir=") || t.startsWith("--work-tree=") || t.startsWith("-")) { i++; continue; }
    return false;
  }
  if (i >= tokens.length || tokens[i] !== "push") return false;
  for (const a of tokens.slice(i + 1)) {
    if (a === "--force-with-lease" || a.startsWith("--force-with-lease=")) continue;
    if (a === "--force" || a.startsWith("--force=") || a === "-f") return true;
    if (a.startsWith("+") && a.length > 1) return true;
  }
  return false;
}

function isDangerousFsTarget(t) {
  const s = String(t || "").trim();
  if (!s) return false;
  if (s === "/" || s === "\\" || s === "~" || s === "*" || s === "~/" || s === "~\\") return true;
  return /^[A-Za-z]:[\\/]*$/.test(s);
}

function isDangerousRemoveItem(tokens) {
  if (!tokens.length) return false;
  if (!/^(Remove-Item|ri|rm|rd|rmdir|del|erase)(\.exe)?$/i.test(tokens[0])) return false;
  let recurse = false;
  const targets = [];
  for (let i = 1; i < tokens.length; i++) {
    const a = tokens[i];
    const eq = a.indexOf(":");
    const name = (eq > 0 && a.startsWith("-") ? a.slice(0, eq) : a).toLowerCase();
    const inline = eq > 0 && a.startsWith("-") ? a.slice(eq + 1) : null;
    if (name === "-recurse" || name === "-r") { recurse = true; continue; }
    if (name === "-path" || name === "-literalpath") {
      if (inline) targets.push(inline);
      else if (tokens[i + 1] && !tokens[i + 1].startsWith("-")) targets.push(tokens[++i]);
      continue;
    }
    if (a.startsWith("-")) continue;
    targets.push(a);
  }
  return recurse && targets.some(isDangerousFsTarget);
}

const FORCE_PUSH_MSG = `BLOCKED: force push. Use \`--force-with-lease\` at minimum, and confirm with
the user first - this can destroy a teammate's commits. \`--force-with-lease\`
together with \`--force\` or \`-f\` is still a force push. A '+' refspec is the
same overwrite.`;

const RECURSE_DELETE_MSG = `BLOCKED: destructive recursive delete with a dangerous target.`;

function nestedPayloads(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    if (/^(sh|bash|zsh|dash|ksh|pwsh|powershell)(\.exe)?$/i.test(tokens[i])
      && tokens[i + 1] && /^(-c|-Command|--command)$/i.test(tokens[i + 1])
      && tokens[i + 2]) {
      out.push(tokens[i + 2]);
    }
  }
  return out;
}

for (const dialect of ["posix", "pwsh"]) {
  for (const stmt of splitStatements(cmd, dialect)) {
    const tokens = tokenize(stmt, dialect);
    const inspect = [tokens];
    for (const payload of nestedPayloads(tokens)) {
      for (const inner of splitStatements(payload, dialect)) inspect.push(tokenize(inner, dialect));
    }
    for (const t of inspect) {
      if (isGitForcePush(t)) block(FORCE_PUSH_MSG + `\n\nCommand: ${cmd}`);
      if (isDangerousRemoveItem(t)) block(RECURSE_DELETE_MSG + `\n\nCommand: ${cmd}`);
    }
  }
}

/* ------------------------------------------- Python installers (gap B11) */
// Built from pieces for the same reason WRITES is: a 500-character literal is
// a regex nobody reviews. Two things the npm rule never needed:
//
//   a flag that takes a VALUE (`-r requirements.txt`, `-i <url>`) must not have
//   that value read as the package name, hence the lookbehind - which is why
//   `pip install -r requirements.txt foo` is refused while `-r requirements.txt`
//   alone is not. An `exempt` on -r would have excused the foo along with it.
//
//   a PATH is this repository's own code, not a dependency: `.`, `./pkg`,
//   `-e .`, an absolute path. Hence the lookahead. `pip install --upgrade pip`
//   is refused on purpose; pip is a package.
//
// Not covered, because nothing here documents them: pipenv, poetry, conda,
// `uv run --with`. Like every rule in this file it matches the whole command
// text, so a note ABOUT one of these commands is refused too (finding B11-3).
const PY_VALUED = String.raw`(?:-r|--requirement|-c|--constraint|-t|--target|-i|--index-url|--extra-index-url|-f|--find-links|-p|--python|--prefix|--root)`;
const PY_PATH = String.raw`(?:[.\/~\\]|[a-z]:)`;
const PY_FLAGS = String.raw`(?:\s+(?:${PY_VALUED}(?:\s+|=)\S+|(?:-e|--editable)(?:\s+|=)["']?${PY_PATH}\S*|-{1,2}[\w.=:\/-]+))*`;
const PY_PKG = String.raw`\s+(?<!(?:^|\s)${PY_VALUED}\s+)["']?(?!${PY_PATH})\w[^\s|;&]*`;
const PY_INSTALL = String.raw`(?:(?:python[\w.]*|py)(?:\.exe)?\s+(?:[^\s|;&]+\s+)*?-m\s+pip|pip[0-9.]*(?:\.exe)?|pipx(?:\.exe)?|uv(?:\.exe)?\s+pip|uv(?:\.exe)?\s+tool)\s+install|uv(?:\.exe)?\s+add`;
const PY_RUN_VALUED = String.raw`(?:--from|--with|--python|-p|--index|--index-url|--spec)`;

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
    // pip / pip3 / python -m pip / pipx / uv pip install <pkg>; uv add; uv tool install
    re: new RegExp(String.raw`\b(?:${PY_INSTALL})\b${PY_FLAGS}${PY_PKG}`, "i"),
    msg: `BLOCKED: installing a new Python package.
.cursor/rules/10-evidence-and-dependency-guard.mdc: no new dependencies unless
already in pyproject.toml / requirements.txt or explicitly requested. Restoring
what the repository already declares stays allowed: \`pip install -r
requirements.txt\`, \`pip install -e .\`, \`uv sync\`. If the user approved the
package, they run the install themselves and commit the lockfile change.`,
  },
  {
    // uvx <pkg> / uv tool run <pkg> / pipx run <pkg>.
    //
    // This is the `npx --yes` rule for Python, not the `npx eslint` case: plain
    // npx prompts before fetching a package that is not installed, and none of
    // these ever do. A tool the project declares runs from the project's own
    // environment, which stays open.
    re: new RegExp(String.raw`\b(?:uvx(?:\.exe)?|uv(?:\.exe)?\s+tool\s+run|pipx(?:\.exe)?\s+run)\b(?:\s+(?:${PY_RUN_VALUED}(?:\s+|=)\S+|-{1,2}[\w.=:\/-]+))*\s+(?<!(?:^|\s)${PY_RUN_VALUED}\s+)["']?(?!-)\w[^\s|;&]*`, "i"),
    msg: `BLOCKED: \`uvx\` / \`pipx run\` downloads and runs a package that is not in
the lockfile. Nothing prompts before the fetch, which makes it the \`npx --yes\`
case, not the \`npx eslint\` one.
.cursor/rules/10-evidence-and-dependency-guard.mdc: no new dependencies unless
already in the repo or explicitly requested. A tool this project declares runs
from its own environment (\`uv run <tool>\`, \`python -m <tool>\`). The servers in
.mcp.json are launched by the MCP host, never from this shell.`,
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
    re: /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f)/i,
    msg: `BLOCKED: destructive git command - this discards uncommitted work.
Confirm with the user, or stash instead.`,
  },
  {
    re: /\b(rm\s+-rf?\s+\/(?!\w)|rm\s+-rf?\s+[~*]\s*$)/,
    msg: `BLOCKED: destructive recursive delete with a dangerous target.`,
  },
  {
    re: /\b(DROP\s+(TABLE|DATABASE|SCHEMA|INDEX|VIEW|FUNCTION|PROCEDURE|TRIGGER|SEQUENCE|TYPE|ROLE|USER|EXTENSION)|DROP\s+MATERIALIZED\s+VIEW|TRUNCATE(\s+TABLE)?)\b/i,
    msg: `BLOCKED: destructive DDL. Emit the statement as reviewed SQL for a human to
run; never execute it. (.cursor/rules/06-database-provider-guard.mdc)`,
  },
  {
    re: /\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba)?sh\b/i,
    msg: `BLOCKED: piping a download into a shell. Fetch, review, then run. Never
\`curl | sh\`.`,
  },
  {
    re: /(\|\s*(iex|Invoke-Expression)\b|\b(iex|Invoke-Expression)\b\s*\([^)]*\b(irm|iwr|Invoke-WebRequest|Invoke-RestMethod|curl|wget)\b)/i,
    msg: `BLOCKED: downloading and Invoke-Expression. Fetch the script, review it,
then run it. Never \`iex (irm ...)\` or \`curl | iex\`.`,
  },
  {
    // A skill fetched from a remote repository at run time.
    //
    // Before the --yes rule below on purpose: the loop blocks on the first
    // match, and `npx -y skills add x/y` should say why a remote SKILL is
    // refused, not merely why an unlocked package is.
    re: /\b(?:npx|npm\s+exec|pnpm\s+dlx|yarn\s+dlx|bunx)\b(?:\s+-{1,2}[\w.=:\/-]+)*\s+(?:--\s+)?skills(?:@[\w.^~<>=*-]+)?\s+(?:add|install|i)\b/i,
    msg: `BLOCKED: this installs a skill from a remote repository.
Skills live in .cursor/skills/<name>/skill.md and are reviewed in git like any
other code. One fetched at run time is an always-on directive nobody here has
read, and with -g / --global it lands outside this repository altogether, where
it will never appear in a diff.
.cursor/rules/10-evidence-and-dependency-guard.mdc: no new dependencies unless
explicitly requested. If the user wants it, they run the command themselves and
commit the result so it can be reviewed.`,
  },
  {
    // Starting, configuring or exposing the local LLM gateway.
    //
    // Subcommands, not a bare \`omniroute\`, because \`node
    // .cursor/tools/omniroute.mjs status\` is the read-only adapter and must stay
    // usable, and \`omniroute --version\` answers a question rather than changing
    // anything. The gateway is a human's service: it holds every provider key,
    // `serve` binds 0.0.0.0 by default, and `configure`/`setup-claude` write
    // ~/.claude/profiles/<name>/settings.json, outside the surface
    // lifecycle/integrity.json attests. docs/adr/0001, rules 1 and 2.
    re: /(?:^|[\s;&|(])(?:npx\s+(?:-{1,2}[\w.=:\/-]+\s+)*)?omniroute(?:\.cmd|\.exe)?\s+(?:serve|start|launch|run|connect|configure|setup-[\w-]+|tokens?|login|sync|import|install|update|--mcp)\b/i,
    msg: `BLOCKED: OmniRoute is a human's service, not the agent's to start.

Starting it, pointing a session at it, writing a CLI's config through it, or
minting a token from the agent's shell puts a gateway under this session that
nobody set up and no record names. It holds every provider key, \`serve\` binds
0.0.0.0 by default, and \`configure\`/\`setup-claude\` write outside the surface
lifecycle/integrity.json attests.

Print the command and let the user run it. The read-only view is:
  node .cursor/tools/omniroute.mjs status | tiers | models
The hardening checklist and the rules: .cursor/docs/OMNIROUTE.md`,
  },
  {
    re: /\bdocker\s+(?:run|create|compose\s+up|start)\b[^|;&]*\bomniroute\b/i,
    msg: `BLOCKED: OmniRoute is a human's service, not the agent's to start.

Same rule as the CLI: the container holds every provider key and publishes a
port. Print the command; the user runs it. .cursor/docs/OMNIROUTE.md`,
  },
  {
    // \`npx eslint\` / \`npx --no-install tsc\` are how this repo formats and
    // tests. \`-y\` / \`--yes\` is the auto-install of a package that is not in
    // the lockfile — the same new-dependency rule as \`npm install <pkg>\`.
    re: /\b(npx|npm\s+exec|pnpm\s+dlx|yarn\s+dlx|bunx)\b[^|;&]*\s(-y|--yes)\b/i,
    msg: `BLOCKED: npx/dlx with --yes installs a package that is not in the lockfile.
.cursor/rules/10-evidence-and-dependency-guard.mdc: no new dependencies unless
already in package.json or explicitly requested. \`npx --no-install\` and a
named local binary stay allowed.`,
  },
];

for (const r of RULES) {
  if (r.re.test(cmd) && !(r.exempt && r.exempt.test(cmd))) block(r.msg + `\n\nCommand: ${cmd}`);
}

ok();
