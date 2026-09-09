#!/usr/bin/env node
// Claude Code: PreToolUse (mcp__*)   |   Cursor: beforeMCPExecution
//
// Governance on this platform is lopsided. `guard-write` and `guard-bash` are
// strict about what an agent may do to files and to the shell; MCP has been
// ungoverned entirely — and MCP is where the database and the GitHub account
// are.
//
// Two locks already exist and both belong to someone else: the github server's
// X-MCP-Readonly header, and postgres-mcp's --access-mode=restricted. .mcp.json
// says it in its own words — the access mode is defence in depth, not the
// boundary. Drop a header, point DATABASE_URI at a role with more grants, or add
// a server on a Friday, and the lock is gone with nothing in this repo
// objecting. This is the lock that lives beside the code and fails the build.
//
// Policy is data, in .cursor/mcp-policy.json. This file is the engine.
//
// WHAT CHANGED, AND WHY IT FAILS CLOSED NOW
//
// The first version allowed a server nobody had written a policy for, allowed
// everything when the policy file was missing or would not parse, decided
// "write" from a fixed list of snake_case prefixes (`deleteRows` and
// `truncate_table` passed), and judged SQL by its first word (a CTE carrying a
// DELETE passed). Every one of those was a default that chose convenience, and
// each was reachable by an agent that had merely been asked to try harder.
//
//   unknown server     -> DENY, until it is registered with an access level
//   unknown tool       -> DENY on a read-only server, until it is in `allow`
//   unreadable policy  -> DENY, and say which file
//   SQL                -> classified by _sql.mjs, over every string argument
//
// The policy file is still where the exceptions live, and it is still hand
// edited by a human. That is the point: an agent that wants more reach has to
// ask for it in a diff a person reads.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readPayload, projectDir, mcpCall, block, ok, fileUrlPath } from "./_lib.mjs";
import { judge, stringsIn, looksLikeSql } from "./_sql.mjs";

const p = await readPayload();
const call = mcpCall(p);

// On Claude Code this hook sees every tool, not only MCP ones.
if (!call || !call.server) ok();

const root = projectDir();
const tool = call.tool || "";
const where = (r) => `${call.server}.${tool}${r ? ` (${r})` : ""}`;

/* --------------------------------------------------------------- the policy */
// Two locations, in priority order:
//   1. the consuming project's own policy - it knows its servers
//   2. the one shipped beside this hook, when installed as a plugin
// Without the second, a plugin install wires the guard and then finds no policy,
// which is a hook that runs and governs nothing. That failure mode is silent,
// and this repo has already been bitten by it once.
const CANDIDATES = [
  join(root, ".cursor", "mcp-policy.json"),
  fileUrlPath(new URL("../mcp-policy.json", import.meta.url)),
];
const policyPath = CANDIDATES.find((c) => { try { return existsSync(c); } catch { return false; } });
if (!policyPath) {
  block(`BLOCKED: MCP call ${where()} - no MCP policy file was found.

  looked in: ${CANDIDATES.join("\n             ")}

guard-mcp is wired, so somebody wanted MCP governed here; a governed channel
with no policy is a closed one. Create .cursor/mcp-policy.json (the platform
ships a starting point) and register "${call.server}" with an access level.
Do not disable the hook to get past this.`);
}

let policy;
try {
  policy = JSON.parse(readFileSync(policyPath, "utf8"));
  if (!policy || typeof policy !== "object" || (policy.servers && typeof policy.servers !== "object")) throw new Error("not a policy object");
} catch (e) {
  block(`BLOCKED: MCP call ${where()} - the MCP policy could not be read.

  file:  ${policyPath}
  error: ${e.message}

A policy that does not parse is not "no policy"; it is a policy nobody can see.
Until a human fixes the file, every MCP call is refused. Tell the user, and do
not edit the file yourself - it is on the protected list for this reason.`);
}

/* ---------------------------------------------------------------- the server */
const raw = policy.servers?.[call.server];
if (!raw) {
  // Absent -> deny. An explicit "allow" is honoured, because a human wrote it,
  // and reported, because it is the setting that made the first version a lock
  // with the key in it.
  if (policy.unlisted === "allow") {
    process.stderr.write(`guard-mcp: "${call.server}" has no entry in ${policyPath} - allowed because unlisted:"allow" is set. That setting lets any server an agent can reach run unreviewed; consider "deny".\n`);
    ok();
  }
  block(`BLOCKED: MCP server "${call.server}" is not registered in the MCP policy.

  file: ${policyPath}
  call: ${where()}

Unknown means denied. Register the server under "servers" with an explicit
access level - "deny", "read-only", "restricted-write" or "full" - and, for
anything above read-only, the tools it may write with under "allow". Then tell
the user what you added and why. Never set unlisted:"allow" to get past this.`);
}

/**
 * v1 policies said `write: true|false`; v2 says `access`. Both are understood,
 * so no existing policy file changes meaning by being read by this version:
 *   write:false -> read-only     write:true -> full     neither -> read-only
 */
const ACCESS = ["deny", "read-only", "restricted-write", "full"];
const rule = { ...raw };
if (!ACCESS.includes(rule.access)) {
  rule.access = raw.write === true ? "full" : "read-only";
}
if (rule.access === "deny") {
  block(`BLOCKED: MCP server "${call.server}" is registered with access "deny".

  call: ${where()}
  ${rule["//"] ? "policy note: " + rule["//"] : ""}

A human turned this server off. If it is needed, they change the policy.`);
}

const glob = (pattern, s) =>
  new RegExp("^" + pattern.split("*").map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i").test(s);
const inList = (list) => (list || []).find((pat) => glob(pat, tool));

/* ------------------------------------------------------------- named denials */
// Checked before the access level, and independent of it. Merging a pull request
// and force-pushing are not "writes" in the ordinary sense; they are the two
// operations no later review can undo.
const denied = inList(rule.deny);
if (denied) {
  block(`BLOCKED: ${where()} is on the deny list in the MCP policy.

  matched rule: "${denied}"
  server access: ${rule.access}

This is denied regardless of the server's access level — these are the
operations no later review can undo. If it genuinely has to happen, a human runs
it themselves. Do not look for another route to the same effect.`);
}

/* ------------------------------------------------------------ phase coupling */
// A tool may be legitimate and still be premature. Opening a pull request during
// REQUIREMENTS means code exists that the design gate never approved.
const phaseRule = rule.phases?.[tool] || Object.entries(rule.phases || {}).find(([k]) => glob(k, tool))?.[1];
if (phaseRule) {
  let phase = null, stateProblem = null;
  if (existsSync(join(root, "lifecycle", "state.json"))) {
    let lc = null;
    for (const rel of ["../../.cursor/tools/lifecycle.mjs", "../tools/lifecycle.mjs"]) {
      try { lc = await import(new URL(rel, import.meta.url).href); break; } catch { /* try the other layout */ }
    }
    if (!lc) stateProblem = "lifecycle.mjs could not be loaded from either layout";
    else {
      lc.setRoot(root);
      const info = lc.readStateInfo ? lc.readStateInfo() : { status: lc.readState() ? "ok" : "corrupt", state: lc.readState() };
      if (info.status === "ok") phase = info.state?.phase || null;
      else stateProblem = `lifecycle/state.json is ${info.status}${info.error ? ` (${info.error})` : ""}`;
    }
    // The tool is coupled to a phase and the phase cannot be read. Allowing it
    // would make a corrupt state file the way to open a PR in REQUIREMENTS.
    if (!phase) {
      block(`BLOCKED: ${where()} is coupled to the lifecycle phase, and the phase cannot be determined.

  ${stateProblem || "state.json has no phase"}

Fix the state file (lifecycle.mjs status will say what is wrong) before running
phase-coupled tools. Do not delete state.json to clear this.`);
    }
  }
  if (phase && !phaseRule.includes(phase)) {
    block(`BLOCKED: ${where()} is not allowed during the ${phase} phase.

  allowed in: ${phaseRule.join(", ")}

The MCP policy couples this tool to the lifecycle. Finish the current phase and
pass its gate; do not work around the sequence through a different server.`);
  }
}

/* ---------------------------------------------------- what kind of tool is it */
// Split on case AND separators, so `deleteRows`, `delete-rows`, `delete_rows`
// and `DeleteRows` are the same four letters. The first version tested a
// snake_case prefix and camelCase walked past it.
const READ_VERBS = new Set(["get", "list", "search", "read", "fetch", "find", "describe", "show", "view", "browse",
  "lookup", "resolve", "count", "explain", "check", "validate", "whoami", "ping", "status", "compare", "diff",
  "query", "inspect", "preview", "summarize", "summarise", "analyze", "analyse", "trace", "history", "download",
  "retrieve", "head", "exists", "stat", "watch", "snapshot", "screenshot", "info", "help", "me"]);
const WRITE_VERBS = new Set(["create", "update", "delete", "remove", "write", "merge", "push", "add", "set", "close",
  "revoke", "drop", "insert", "upsert", "patch", "put", "post", "rename", "move", "assign", "dismiss", "submit",
  "request", "truncate", "execute", "exec", "run", "kill", "terminate", "cancel", "send", "publish", "deploy",
  "approve", "reject", "lock", "unlock", "grant", "apply", "restore", "reset", "install", "uninstall", "import",
  "fork", "star", "unstar", "invite", "transfer", "edit", "modify", "change", "replace", "append", "clear",
  "purge", "destroy", "reopen", "pin", "unpin", "archive", "unarchive", "enable", "disable", "trigger",
  "dispatch", "rerun", "retry", "upload", "copy", "invoke", "mutate", "revert"]);
// Anywhere in the name, not only first: `repo_delete`, `issue_write`. Kept to
// words that are never a noun in a tool name, so `get_workflow_run` and
// `pull_request_read` stay reads.
const DESTRUCTIVE_ANYWHERE = new Set(["delete", "remove", "drop", "truncate", "destroy", "purge", "write", "merge",
  "push", "kill", "terminate", "update", "insert", "upsert", "create", "exec", "execute", "modify", "edit",
  "upload", "publish", "deploy", "revoke", "grant"]);
const nameTokens = (name) => String(name).replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function classifyTool(name) {
  const t = nameTokens(name);
  if (!t.length) return "unknown";
  if (WRITE_VERBS.has(t[0])) return "write";
  if (t.some((x) => DESTRUCTIVE_ANYWHERE.has(x))) return "write";   // repo_delete, get_then_delete
  if (READ_VERBS.has(t[0]) || t.some((x) => READ_VERBS.has(x))) return "read";   // list_x, issue_read
  return "unknown";
}
const kind = classifyTool(tool);
const allowed = inList(rule.allow);
const carriesSql = Array.isArray(rule.sqlAllow);

/* ------------------------------------------------------------ the SQL check */
// Every string argument, not five named fields. A server whose parameter is
// `command`, or that takes an array, was uninspected before. For a tool that is
// itself an execute/run, every multi-word string is judged as SQL even when it
// does not open with a keyword we know - an unknown statement is not a read.
// For a read-shaped tool (list_objects with schema "public") only strings that
// look like SQL are judged, so a schema name is not refused as a statement.
if (carriesSql) {
  const strict = kind !== "read" || nameTokens(tool).some((x) => ["query", "sql", "execute", "exec", "run", "statement"].includes(x));
  for (const s of stringsIn(call.input)) {
    const sqlLike = looksLikeSql(s);
    if (!sqlLike && !(strict && /\s/.test(s.trim()))) continue;
    const v = judge(s, rule);
    if (v.ok) continue;
    block(`BLOCKED: ${where()} was sent SQL a read-only policy refuses.

  reason:    ${v.reason}
  ${v.detail ? "detail:    " + v.detail : ""}
  allowed:   ${rule.sqlAllow.join(", ")}
  statement: ${s.trim().slice(0, 160)}${s.trim().length > 160 ? "..." : ""}

Read-only means the statement, not just the connection. This check classifies
the statement - comments, literals, CTEs, EXPLAIN options and function calls
included - before it leaves. A SELECT-only database role would refuse it as
well; that role is the boundary, and templates/postgres/readonly-role.sql
creates it. This check does not depend on the role being configured today.`);
  }
}

/* ------------------------------------------------------------- access level */
if (rule.access === "full") ok();

if (kind === "read") ok();

if (allowed) ok();                                            // explicitly registered

// A SQL-carrying execute tool whose statements all passed above is how a
// read-only postgres session reads at all. Nothing else gets through on a name.
if (carriesSql && kind !== "read" && stringsIn(call.input).some(looksLikeSql)) ok();

if (rule.access === "restricted-write") {
  block(`BLOCKED: ${where(kind)} is not in the "allow" list for this restricted-write server.

  server access: restricted-write
  allowed tools: ${(rule.allow || []).join(", ") || "(none)"}

Restricted write means the writes are enumerated. If this one is wanted, the
user adds it to "allow" in the MCP policy and says so.`);
}

// read-only
block(`BLOCKED: ${where(kind)} is ${kind === "write" ? "a write" : "not recognisably a read"} and the MCP policy marks this server read-only.

  server access: read-only
  ${rule["//write"] ? "policy note: " + rule["//write"] : ""}
${kind === "unknown" ? `
The tool's name says nothing this guard recognises. Unknown is denied: if it is
a read, add it to the server's "allow" list in the MCP policy so the decision is
written down, and tell the user.` : `
The server may also be enforcing this itself (X-MCP-Readonly, --access-mode).
That enforcement is somebody else's to keep; this one lives with the code.`}

If write access is genuinely wanted, the user changes the policy file and says
so. Never propose relaxing it to get past this block.`);
