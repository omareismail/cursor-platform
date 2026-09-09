#!/usr/bin/env node
/**
 * mcp.test.mjs — guard-mcp.mjs against the calls that used to go through.
 *
 * Each DENY case here was reproduced against the previous version of the hook
 * before it was fixed: an unlisted server ran; a missing or unparseable policy
 * allowed everything; `deleteRows` and `truncate_table` were not "writes";
 * `WITH d AS (DELETE ...) SELECT` was a SELECT; a statement in a field called
 * `command` was never inspected. Every one is a regression test now.
 */

import { fixture, runHook, repoMcpPolicy, mcp, cursorMcp, check, denies, allows, cursorDenies, cursorAllows, report, section } from "../_harness.mjs";

const H = "guard-mcp.mjs";

/* ------------------------------------------------------- unknown is denied */

section("guard-mcp.mjs — unknown server, unreadable policy");
{
  const root = fixture("mcp-default");
  denies("an unregistered server is refused", runHook(H, mcp("some-new-server", "get_things"), root), "not registered");
  denies("an unregistered server is refused even for a read-shaped tool", runHook(H, mcp("some-new-server", "list_items"), root), "not registered");

  const legacy = fixture("mcp-unlisted-allow", { mcpPolicy: { version: 1, unlisted: "allow", servers: {} } });
  const r = runHook(H, mcp("some-new-server", "delete_everything"), legacy);
  allows("an explicit unlisted:\"allow\" is still honoured (a human wrote it)", r);
  check("...and reported on stderr as unreviewed", /unreviewed|unlisted/i.test(r.err), `stderr: ${r.err.slice(0, 120)}`);

  denies("no policy file anywhere is a closed channel", runHook(H, mcp("github", "search_repositories"), fixture("mcp-nopolicy", { mcpPolicy: null })), "no MCP policy file");
  denies("a policy that does not parse denies everything", runHook(H, mcp("github", "search_repositories"), fixture("mcp-corrupt", { mcpPolicy: "corrupt" })), "could not be read");
  denies("a policy whose servers block is not an object denies", runHook(H, mcp("github", "search_repositories"), fixture("mcp-badshape", { mcpPolicy: { servers: "yes" } })), "could not be read");
}

/* ------------------------------------------------------ access levels */

section("guard-mcp.mjs — access levels");
{
  const root = fixture("mcp-levels", { mcpPolicy: {
    version: 2, unlisted: "deny",
    servers: {
      off:  { access: "deny" },
      ro:   { access: "read-only", allow: ["oddly_named_read"] },
      rw:   { access: "restricted-write", allow: ["create_issue", "add_*_comment"], deny: ["merge_*"] },
      full: { access: "full", deny: ["merge_*", "*force*"] },
      v1ro: { write: false },
      v1rw: { write: true },
      nothing: { trust: "low" },
    },
  } });

  denies("access:deny refuses a read", runHook(H, mcp("off", "list_items"), root), 'access "deny"');

  allows("read-only allows a read", runHook(H, mcp("ro", "list_items"), root));
  allows("read-only allows a camelCase read", runHook(H, mcp("ro", "getIssue"), root));
  allows("read-only allows a read verb later in the name", runHook(H, mcp("ro", "pull_request_read"), root));
  allows("read-only allows a read whose noun looks like a verb", runHook(H, mcp("ro", "get_workflow_run"), root));
  denies("read-only refuses a snake_case write", runHook(H, mcp("ro", "delete_rows"), root), "a write");
  denies("read-only refuses a camelCase write (the deleteRows bypass)", runHook(H, mcp("ro", "deleteRows"), root), "a write");
  denies("read-only refuses a verb the old prefix list lacked (truncate_table)", runHook(H, mcp("ro", "truncate_table"), root), "a write");
  denies("read-only refuses a write verb later in the name (repo_delete)", runHook(H, mcp("ro", "repo_delete"), root), "a write");
  denies("read-only refuses a write hidden after a read verb (get_then_delete)", runHook(H, mcp("ro", "get_then_delete"), root), "a write");
  denies("read-only refuses a tool it cannot classify", runHook(H, mcp("ro", "frobnicate"), root), "not recognisably a read");
  allows("...unless it is registered in allow", runHook(H, mcp("ro", "oddly_named_read"), root));

  allows("restricted-write allows a read", runHook(H, mcp("rw", "get_issue"), root));
  allows("restricted-write allows a write in its allow list", runHook(H, mcp("rw", "create_issue"), root));
  allows("restricted-write allow list takes globs", runHook(H, mcp("rw", "add_issue_comment"), root));
  denies("restricted-write refuses a write not in its allow list", runHook(H, mcp("rw", "create_pull_request"), root), "restricted-write");
  denies("restricted-write refuses an unknown tool", runHook(H, mcp("rw", "frobnicate"), root), "restricted-write");
  denies("deny list beats allow list", runHook(H, mcp("rw", "merge_pull_request"), root), "deny list");

  allows("full allows a write", runHook(H, mcp("full", "delete_repository"), root));
  allows("full allows an unknown tool", runHook(H, mcp("full", "frobnicate"), root));
  denies("full still honours the deny list", runHook(H, mcp("full", "push_force"), root), "deny list");
  denies("deny globs are case-insensitive", runHook(H, mcp("full", "Merge_Pull_Request"), root), "deny list");

  allows("v1 write:false reads as read-only (read)", runHook(H, mcp("v1ro", "list_x"), root));
  denies("v1 write:false reads as read-only (write)", runHook(H, mcp("v1ro", "create_x"), root), "read-only");
  allows("v1 write:true reads as full", runHook(H, mcp("v1rw", "create_x"), root));
  denies("a server with neither access nor write is read-only", runHook(H, mcp("nothing", "create_x"), root), "read-only");
}

/* ------------------------------------------------------ the repo's policy */

section("guard-mcp.mjs — this repository's own policy behaves as documented");
{
  const root = fixture("mcp-repo");
  allows("github: a search is a read", runHook(H, mcp("github", "search_repositories", { query: "x" }), root));
  denies("github: create_pull_request is refused while access is read-only", runHook(H, mcp("github", "create_pull_request"), root), "read-only");
  denies("github: merge is on the deny list", runHook(H, mcp("github", "merge_pull_request"), root), "deny list");
  denies("github: create_or_update_file is on the deny list", runHook(H, mcp("github", "create_or_update_file"), root), "deny list");
  allows("context7: a lookup is a read", runHook(H, mcp("context7", "resolve-library-id", { libraryName: "react" }), root));
  allows("playwright: full", runHook(H, mcp("playwright", "browser_click"), root));
  check("the repo policy denies unlisted servers", repoMcpPolicy().unlisted === "deny", "unlisted must be deny");
  check("ANALYZE is no longer an allowed leading keyword", !repoMcpPolicy().servers.postgres.sqlAllow.includes("ANALYZE"), "ANALYZE rewrites statistics / executes under EXPLAIN");
}

/* ------------------------------------------------------------------- SQL */

section("guard-mcp.mjs — SQL through postgres, every field, every shape");
{
  const root = fixture("mcp-sql");
  const q = (s, field = "sql") => mcp("postgres", "execute_sql", { [field]: s });
  allows("a SELECT through execute_sql", runHook(H, q("SELECT * FROM users"), root));
  allows("a WITH ... SELECT", runHook(H, q("WITH x AS (SELECT 1) SELECT * FROM x"), root));
  denies("a DELETE", runHook(H, q("DELETE FROM users WHERE id = 1"), root), "not an allowed statement");
  denies("a DELETE inside a CTE", runHook(H, q("WITH d AS (DELETE FROM users RETURNING *) SELECT * FROM d"), root), "data-modifying keyword");
  denies("EXPLAIN ANALYZE", runHook(H, q("EXPLAIN ANALYZE DELETE FROM users"), root), "EXPLAIN ANALYZE");
  denies("a second statement", runHook(H, q("SELECT 1; DELETE FROM users"), root), "more than one statement");
  denies("a second statement behind a comment", runHook(H, q("SELECT 1; -- x\nDELETE FROM users"), root), "more than one statement");
  denies("pg_sleep", runHook(H, q("SELECT pg_sleep(30)"), root), "denied for a read-only session");
  denies("quoted pg_sleep", runHook(H, q('SELECT "pg_sleep"(10)'), root), "denied for a read-only session");
  denies("quoted schema-qualified lo_unlink", runHook(H, q('SELECT pg_catalog."lo_unlink"(12345)'), root), "denied for a read-only session");
  denies("FOR UPDATE", runHook(H, q("SELECT * FROM users FOR UPDATE"), root), "UPDATE");
  denies("FOR SHARE", runHook(H, q("SELECT * FROM users FOR SHARE"), root), "row locking");
  denies("SQL in a field the old list never read (command)", runHook(H, q("DELETE FROM users", "command"), root), "not an allowed statement");
  denies("SQL in a field the old list never read (text)", runHook(H, q("DELETE FROM users", "text"), root), "not an allowed statement");
  denies("SQL nested in an object", runHook(H, mcp("postgres", "execute_sql", { params: { statement: "DELETE FROM users" } }), root), "not an allowed statement");
  denies("SQL in an array of statements", runHook(H, mcp("postgres", "execute_sql", { statements: ["SELECT 1", "DELETE FROM users"] }), root), "not an allowed statement");
  denies("an unknown statement through an execute tool", runHook(H, q("REASSIGN OWNED BY a TO b"), root), "not an allowed statement");
  denies("the old `query` tool name is judged strictly too", runHook(H, mcp("postgres", "query", { sql: "SET ROLE postgres" }), root), "not an allowed statement");
  allows("a read-shaped tool with a schema name is not judged as SQL", runHook(H, mcp("postgres", "list_objects", { schema_name: "public" }), root));
  allows("a read-shaped tool with a table name", runHook(H, mcp("postgres", "get_object_details", { schema_name: "public", object_name: "select" }), root));
  denies("a read-shaped tool carrying SQL is still judged", runHook(H, mcp("postgres", "explain_query", { sql: "DELETE FROM users" }), root), "not an allowed statement");
  allows("execute_sql with a numeric option beside the SQL", runHook(H, mcp("postgres", "execute_sql", { sql: "SELECT 1", timeout: "30" }), root));
  denies("sqlDenyFunctions from the policy is honoured", runHook(H, q("SELECT my_side_effect(1)"),
    fixture("mcp-sql-deny", { mcpPolicy: { ...repoMcpPolicy(), servers: { postgres: { access: "read-only", sqlAllow: ["SELECT"], sqlDenyFunctions: ["my_side_effect"] } } } })), "my_side_effect");
}

/* ------------------------------------------------------------ phase rule */

section("guard-mcp.mjs — phase coupling fails closed on unreadable state");
{
  const policy = { version: 2, unlisted: "deny", servers: { gh: { access: "restricted-write", allow: ["create_pull_request"], phases: { create_pull_request: ["DEVELOPMENT", "TESTING", "PRODUCTION"] } } } };
  const early = fixture("mcp-phase-early", { mcpPolicy: policy, state: { schemaVersion: 2, product: "p", phase: "REQUIREMENTS", phases: {} } });
  denies("a phase-coupled tool is refused in an earlier phase", runHook(H, mcp("gh", "create_pull_request"), early), "not allowed during the REQUIREMENTS phase");
  const late = fixture("mcp-phase-late", { mcpPolicy: policy, state: { schemaVersion: 2, product: "p", phase: "DEVELOPMENT", phases: {} } });
  allows("...and allowed once the phase is reached", runHook(H, mcp("gh", "create_pull_request"), late));
  const corrupt = fixture("mcp-phase-corrupt", { mcpPolicy: policy, state: "{ not json" });
  denies("a corrupt state file no longer opens the phase rule", runHook(H, mcp("gh", "create_pull_request"), corrupt), "cannot be determined");
  const none = fixture("mcp-phase-none", { mcpPolicy: policy });
  allows("no state file: the repo never adopted the lifecycle, the phase rule is inert", runHook(H, mcp("gh", "create_pull_request"), none));
}

/* ------------------------------------------------------------ Cursor shape */

section("guard-mcp.mjs — the same verdicts reach Cursor, and allow is said out loud");
{
  const root = fixture("mcp-cursor");
  cursorAllows("Cursor: a read answers {permission:\"allow\"}", runHook(H, cursorMcp(root, "github", "search_repositories", { query: "x" }), root));
  cursorDenies("Cursor: an unregistered server is denied", runHook(H, cursorMcp(root, "unknown", "get_x"), root), "not registered");
  cursorDenies("Cursor: SQL in a JSON-string tool_input is still classified", runHook(H, cursorMcp(root, "postgres", "execute_sql", { sql: "DELETE FROM users" }), root), "not an allowed statement");
  cursorDenies("Cursor: a camelCase write is denied", runHook(H, cursorMcp(root, "github", "deleteRepository"), root), "a write");
}

report("guard-mcp refuses every call that used to go through, and reads still work.");
