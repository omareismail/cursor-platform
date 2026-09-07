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

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readPayload, projectDir, mcpCall, block, ok } from "./_lib.mjs";

const p = await readPayload();
const call = mcpCall(p);

// On Claude Code this hook sees every tool, not only MCP ones.
if (!call || !call.server) ok();

const root = projectDir();

// Two locations, in priority order:
//   1. the consuming project's own policy - it knows its servers
//   2. the one shipped beside this hook, when installed as a plugin
// Without the second, a plugin install wires the guard and then finds no policy,
// which is a hook that runs and governs nothing. That failure mode is silent,
// and this repo has already been bitten by it once.
const CANDIDATES = [
  join(root, ".cursor", "mcp-policy.json"),
  new URL("../mcp-policy.json", import.meta.url).pathname,
];
const policyPath = CANDIDATES.find((c) => { try { return existsSync(c); } catch { return false; } });
if (!policyPath) ok();                      // no policy declared is not a violation

let policy;
try { policy = JSON.parse(readFileSync(policyPath, "utf8")); } catch { ok(); }

const rule = policy.servers?.[call.server];
if (!rule) {
  // Reported, not blocked. Denying unlisted servers by default sounds stricter
  // and is worse: the first unlisted server breaks the workspace, somebody
  // disables the hook, and then every server is unlisted.
  if (policy.unlisted === "deny") {
    block(`BLOCKED: MCP server "${call.server}" has no policy and .cursor/mcp-policy.json denies unlisted servers.

Add it to the "servers" block with an explicit trust level and write flag, then
tell the user what you added and why.`);
  }
  process.stderr.write(`guard-mcp: "${call.server}" has no entry in .cursor/mcp-policy.json — allowed, unreviewed.\n`);
  ok();
}

const tool = call.tool || "";
const glob = (pattern, s) =>
  new RegExp("^" + pattern.split("*").map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i").test(s);

/* ------------------------------------------------------------- named denials */
// Checked before the write flag, and independent of it. Merging a pull request
// and force-pushing are not "writes" in the ordinary sense; they are the two
// operations no later review can undo.
for (const pattern of rule.deny || []) {
  if (glob(pattern, tool)) {
    block(`BLOCKED: ${call.server}.${tool} is on the deny list in .cursor/mcp-policy.json.

  matched rule: "${pattern}"
  server trust: ${rule.trust || "unspecified"}

This is denied regardless of the server's write flag — these are the operations
no later review can undo. If it genuinely has to happen, a human runs it
themselves. Do not look for another route to the same effect.`);
  }
}

/* ------------------------------------------------------------ phase coupling */
// A tool may be legitimate and still be premature. Opening a pull request during
// REQUIREMENTS means code exists that the design gate never approved.
const phaseRule = rule.phases?.[tool] || Object.entries(rule.phases || {}).find(([k]) => glob(k, tool))?.[1];
if (phaseRule) {
  let phase = null;
  if (existsSync(join(root, "lifecycle", "state.json"))) {
    for (const rel of ["../../.cursor/tools/lifecycle.mjs", "../tools/lifecycle.mjs"]) {
      try {
        const lc = await import(new URL(rel, import.meta.url).href);
        lc.setRoot(root);
        phase = lc.readState()?.phase || null;
        break;
      } catch { /* try the other layout */ }
    }
  }
  if (phase && !phaseRule.includes(phase)) {
    block(`BLOCKED: ${call.server}.${tool} is not allowed during the ${phase} phase.

  allowed in: ${phaseRule.join(", ")}

.cursor/mcp-policy.json couples this tool to the lifecycle. Finish the current
phase and pass its gate; do not work around the sequence through a different
server.`);
  }
}

/* ------------------------------------------------------------- the write flag */
const WRITEY = /^(create|update|delete|remove|write|merge|push|add|set|close|revoke|drop|insert|upsert|patch|put|post|rename|move|assign|dismiss|submit|request)[_-]/i;
if (rule.write === false && WRITEY.test(tool)) {
  block(`BLOCKED: ${call.server}.${tool} looks like a write and .cursor/mcp-policy.json marks this server read-only.

  server trust: ${rule.trust || "unspecified"}
  ${rule["//write"] ? "policy note: " + rule["//write"] : ""}

The server may also be enforcing this itself (X-MCP-Readonly, --access-mode).
That enforcement is somebody else's to keep; this one lives with the code.

If write access is genuinely wanted, the user changes the policy file and says
so. Never propose relaxing it to get past this block.`);
}

/* ------------------------------------------------------------ SQL verb check */
// The predecessor of postgres-mcp shipped a SQL-injection flaw that bypassed its
// own read-only mode. Checking the statement the agent actually sent is cheap.
if (Array.isArray(rule.sqlAllow)) {
  const FIELDS = ["sql", "query", "statement", "sql_query", "queryString"];
  for (const f of FIELDS) {
    const v = call.input?.[f];
    if (typeof v !== "string" || !v.trim()) continue;
    const stripped = v.replace(/^\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/|\s)+/g, "");
    const verb = (stripped.match(/^\s*([A-Za-z]+)/) || [])[1] || "";
    if (!rule.sqlAllow.some((a) => a.toUpperCase() === verb.toUpperCase())) {
      block(`BLOCKED: ${call.server}.${tool} was sent a "${verb.toUpperCase() || "?"}" statement.

  allowed here: ${rule.sqlAllow.join(", ")}
  statement:    ${v.trim().slice(0, 160)}${v.trim().length > 160 ? "..." : ""}

Read-only means the statement, not just the connection. A role with SELECT-only
grants would reject this too — but this check runs before the query leaves, and
does not depend on the role being configured correctly today.`);
    }
    // A second statement after a semicolon is how a read becomes a write.
    const tail = stripped.split(";").slice(1).join(";").trim();
    if (tail && /^[A-Za-z]/.test(tail)) {
      block(`BLOCKED: ${call.server}.${tool} was sent more than one statement.

  after the first ";": ${tail.slice(0, 120)}${tail.length > 120 ? "..." : ""}

A leading SELECT says nothing about what follows the semicolon. Send one
statement per call.`);
    }
  }
}

ok();
