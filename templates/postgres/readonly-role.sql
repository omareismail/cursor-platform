-- templates/postgres/readonly-role.sql
--
-- The database role an agent's MCP server should connect as.
--
-- guard-mcp.mjs classifies every statement before it leaves the editor, and
-- postgres-mcp has an --access-mode=restricted. Both are locks on the client.
-- A client-side lock is defence in depth; the boundary is what the ROLE cannot
-- do, because that holds when the hook is disabled, the server is swapped, or
-- the SQL arrives by a path nobody wrote a guard for.
--
-- Level 5 (system boundary) protecting level 3 (hook). Run with psql as a
-- superuser or the database owner, once per database, then point DATABASE_URI
-- in .mcp.json at the new role:
--
--   psql "$ADMIN_URL" -v dbname=appdb -v app_schema=public \
--        -v role_name=agent_ro -v role_pass="$(openssl rand -base64 24)" \
--        -f templates/postgres/readonly-role.sql
--
-- What it gives:   connect, read every table/view/sequence in app_schema, and
--                  the same for tables created later.
-- What it denies:  every write, every DDL, temp tables (a scratch space is a
--                  write); statement_timeout is the answer to pg_sleep.
--
-- psql variables only; no DO blocks, because psql does not interpolate :'vars'
-- inside dollar quotes and a template that silently grants to the literal
-- string ':role_name' is worse than none. One schema per run - run it again
-- with another -v app_schema for a second one.

\set ON_ERROR_STOP on

BEGIN;

-- 1. The role: can log in, can do nothing else by inheritance. Idempotent via \gexec.
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
              :'role_name', :'role_pass')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role_name') \gexec

-- 2. Connect, and read.
GRANT CONNECT ON DATABASE :"dbname" TO :"role_name";
GRANT USAGE  ON SCHEMA :"app_schema" TO :"role_name";
GRANT SELECT ON ALL TABLES    IN SCHEMA :"app_schema" TO :"role_name";
GRANT SELECT ON ALL SEQUENCES IN SCHEMA :"app_schema" TO :"role_name";

-- Tables created after today. Without this the role silently loses sight of
-- every new table and somebody "fixes" it with a broader grant.
ALTER DEFAULT PRIVILEGES IN SCHEMA :"app_schema" GRANT SELECT ON TABLES    TO :"role_name";
ALTER DEFAULT PRIVILEGES IN SCHEMA :"app_schema" GRANT SELECT ON SEQUENCES TO :"role_name";

-- Postgres 14+: the predefined read-everything role, where it exists. The
-- explicit grants above are the fallback and the record of intent.
SELECT format('GRANT pg_read_all_data TO %I', :'role_name')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pg_read_all_data') \gexec

-- 3. Take back what PUBLIC hands out by default.
REVOKE CREATE ON SCHEMA public   FROM :"role_name";
REVOKE TEMP   ON DATABASE :"dbname" FROM :"role_name";

-- 4. Session limits that make the client-side denials redundant.
--    statement_timeout closes pg_sleep and runaway scans; the idle timeout
--    closes a held connection; default_transaction_read_only makes the
--    transaction itself refuse writes even where a grant was widened by mistake.
ALTER ROLE :"role_name" SET statement_timeout = '30s';
ALTER ROLE :"role_name" SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE :"role_name" SET default_transaction_read_only = on;
ALTER ROLE :"role_name" SET lock_timeout = '5s';
ALTER ROLE :"role_name" SET search_path = :'app_schema';

COMMIT;

-- Verify, connected as the new role:
--   SELECT current_user, current_setting('default_transaction_read_only');   -- agent_ro | on
--   CREATE TABLE t (x int);   -- ERROR: permission denied for schema public
--   SELECT pg_sleep(60);      -- ERROR: canceling statement due to statement timeout
--   DELETE FROM some_table;   -- ERROR: cannot execute DELETE in a read-only transaction
--
-- Note: on Postgres < 15, PUBLIC still holds CREATE on schema public. The REVOKE
-- above removes it from agent_ro only; whether to REVOKE it from PUBLIC as well
-- (the 15+ default) is a decision about every other role in the database, so it
-- is not made here.
