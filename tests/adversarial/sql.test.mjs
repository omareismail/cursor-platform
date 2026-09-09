#!/usr/bin/env node
/**
 * sql.test.mjs — the SQL classifier, against the statements that beat its predecessor.
 *
 * The first check read the first word and split on semicolons. Every case
 * marked DENY below is either something it let through or something a
 * read-only role would refuse; every ALLOW is a read that must keep working,
 * because a classifier that refuses `SELECT count(*)` is switched off by lunch.
 *
 * This tests _sql.mjs directly - it is a pure module - so a failure names the
 * statement, not the hook around it.
 */

import { join } from "node:path";
import { REPO, check, report, section } from "../_harness.mjs";

const sql = await import(new URL(`file:///${join(REPO, ".claude", "hooks", "_sql.mjs").replace(/\\/g, "/")}`));
const RULE = { sqlAllow: ["SELECT", "WITH", "EXPLAIN", "SHOW", "TABLE", "VALUES"] };

section("_sql.judge — writes, wherever they hide");
const DENY = [
  ["DELETE FROM users WHERE id = 1;", "plain DELETE"],
  ["UPDATE users SET active = false", "plain UPDATE"],
  ["INSERT INTO users VALUES (1)", "plain INSERT"],
  ["DROP TABLE users", "DDL"],
  ["TRUNCATE TABLE users", "TRUNCATE"],
  ["WITH deleted AS (DELETE FROM users WHERE id = 1 RETURNING *) SELECT * FROM deleted", "DELETE inside a CTE (the CTE bypass)"],
  ["SELECT * FROM t WHERE id IN (SELECT id FROM u) UNION ALL (WITH x AS (UPDATE t SET a=1 RETURNING a) SELECT a FROM x)", "UPDATE in a nested CTE"],
  ["EXPLAIN ANALYZE DELETE FROM users WHERE id = 1", "EXPLAIN ANALYZE executes (the EXPLAIN bypass)"],
  ["EXPLAIN (ANALYZE, BUFFERS) SELECT 1", "EXPLAIN with ANALYZE in the option list"],
  ["explain analyse select 1", "British spelling, lower case"],
  ["EXPLAIN DELETE FROM users", "EXPLAIN of a write, even without ANALYZE"],
  ["SELECT 1; DELETE FROM users", "second statement"],
  ["SELECT 1; -- note\nDELETE FROM users", "second statement behind a comment (the tail-starts-with-dash bypass)"],
  ["SELECT ';'; DELETE FROM users", "second statement after a literal containing a semicolon"],
  ["SELECT E'\\';'; DELETE FROM users", "second statement after an E'' literal"],
  ["SELECT $$;$$; DELETE FROM users", "second statement after a dollar-quoted literal"],
  ["-- comment\nDELETE FROM users", "DELETE behind a line comment"],
  ["/* comment */ DELETE FROM users", "DELETE behind a block comment"],
  ["/* a */ /* b */ DELETE /* c */ FROM users", "DELETE between comments"],
  ["SELECT pg_sleep(10)", "pg_sleep"],
  ["SELECT pg_catalog.pg_sleep(10)", "schema-qualified pg_sleep"],
  ["SELECT PG_SLEEP(10)", "upper-case pg_sleep"],
  ["SELECT lo_import('/etc/passwd')", "lo_import"],
  ["SELECT pg_read_file('/etc/passwd')", "pg_read_file"],
  ["SELECT set_config('x','y',false)", "set_config"],
  ["SELECT nextval('seq')", "nextval consumes a sequence"],
  ["SELECT pg_terminate_backend(1)", "pg_terminate_backend"],
  ["SELECT dblink_exec('c', 'DELETE FROM t')", "dblink_exec"],
  ["SELECT * FROM users FOR UPDATE", "FOR UPDATE takes locks"],
  ["SELECT * FROM users FOR NO KEY UPDATE", "FOR NO KEY UPDATE"],
  ["SELECT * FROM t WHERE x IN (SELECT y FROM z) FOR SHARE", "FOR SHARE"],
  ["SELECT * INTO backup FROM users", "SELECT INTO creates a table"],
  ["COPY users TO '/tmp/x'", "COPY"],
  ["CALL do_thing()", "CALL"],
  ["DO $$ BEGIN DELETE FROM users; END $$", "DO block"],
  ["SET ROLE postgres", "SET is not in the allow list"],
  ["ANALYZE users", "bare ANALYZE rewrites statistics"],
  ["GRANT ALL ON users TO public", "GRANT"],
  ["REASSIGN OWNED BY a TO b", "an unknown statement is not a read"],
  ["(DELETE FROM users)", "parenthesised DELETE"],
  ["VALUES (1); DELETE FROM users", "second statement after VALUES"],
];
for (const [s, why] of DENY) {
  const v = sql.judge(s, RULE);
  check(`denies ${why}: ${JSON.stringify(s).slice(0, 70)}`, v.ok === false, `expected a refusal; got ${JSON.stringify(v)}`);
}

section("_sql.judge — reads that must keep working");
const ALLOW = [
  "SELECT * FROM users",
  "SELECT * FROM users;",
  "select id, \"delete\" from t where name = $$; DELETE FROM x$$",
  "SELECT 'DELETE FROM users' AS label",
  "SELECT * FROM t WHERE note = '; DROP TABLE users; --'",
  "/* a /* nested */ DELETE */ SELECT 1",
  "EXPLAIN SELECT 1",
  "EXPLAIN (COSTS off, FORMAT JSON) SELECT 1",
  "EXPLAIN VERBOSE SELECT * FROM t",
  "WITH x AS (SELECT 1) SELECT * FROM x",
  "SHOW search_path",
  "TABLE users",
  "VALUES (1), (2)",
  "SELECT count(*) FROM orders WHERE created_at > now() - interval '1 day'",
  "SELECT u.id, p.total FROM users u JOIN payments p ON p.user_id = u.id WHERE p.total > $1",
  "SELECT current_setting('search_path')",
  "SELECT * FROM update_log",
  "SELECT deleted_at FROM users",
  "   ",
  "-- only a comment",
];
for (const s of ALLOW) {
  const v = sql.judge(s, RULE);
  check(`allows ${JSON.stringify(s).slice(0, 70)}`, v.ok === true, `expected allowed; got ${JSON.stringify(v)}`);
}

section("_sql.judge — an empty allow list allows nothing");
check("SELECT with no sqlAllow is refused", sql.judge("SELECT 1", {}).ok === false, "unknown is not allowed");

section("_sql helpers");
check("stringsIn walks nested objects and arrays",
  JSON.stringify(sql.stringsIn({ a: "x", b: { c: ["y", 1, { d: "z" }] } })) === '["x","y","z"]', "expected x, y, z");
check("stringsIn is depth-bounded", Array.isArray(sql.stringsIn(JSON.parse('{"a":{"a":{"a":{"a":{"a":{"a":{"a":{"a":"deep"}}}}}}}}'))), "must not throw");
check("looksLikeSql rejects a schema name", sql.looksLikeSql("public") === false, "");
check("looksLikeSql accepts a select", sql.looksLikeSql("select 1") === true, "");
check("looksLikeSql sees a write behind a benign first statement", sql.looksLikeSql("hello; DELETE FROM users") === true, "");
check("tokenize never throws on an unterminated literal", Array.isArray(sql.tokenize("SELECT '")), "");
check("tokenize never throws on an unterminated comment", Array.isArray(sql.tokenize("SELECT /* ")), "");
check("an unterminated comment cannot hide a second statement",
  sql.judge("SELECT 1 /* x ; DELETE FROM users", RULE).ok === true && sql.splitStatements(sql.tokenize("SELECT 1 /* x ; DELETE FROM users")).length === 1,
  "the comment swallows the rest, which Postgres would reject as unterminated");

report("The classifier refuses every statement that beat its predecessor and allows the reads.");
