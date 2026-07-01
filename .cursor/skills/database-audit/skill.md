# Skill: database-audit

**Invocation:** `/database-audit [scope] [provider]`
Example: `/database-audit Tamkeen.Payments oracle` · `/database-audit full`

---

## Overview

**Memory references:** `memory-bank/databaseConventions.md`,
`memory-bank/architecture.md` (multi-database module boundaries),
`.cursor/cache/repo-map.json` (from `repo-discovery` — Step 0 freshness check
applies)

`database-audit` is distinct from `dotnet-schema-diff` (which compares two
environments) and `dotnet-query-optimizer` (which profiles individual query
cost). This skill answers a different question: **within a single
environment, is the data-access layer internally consistent?** — specifically
the EF Core / Dapper coexistence pattern this workspace's projects rely on
(RHODES uses EF Core for the accounting core and Dapper for
reporting/read-heavy paths; Tamkeen mixes both per-gateway). That coexistence
is a known source of silent drift: an EF Core entity gets a new nullable
column via migration, and the three hand-written Dapper queries that map the
same table don't get updated until something breaks in production.

**MCP tools:** `postgres` MCP server for live PostgreSQL catalog reads;
Oracle SQLcl MCP server if connected (see `.cursor/docs/mcp-ecosystem.md`)
for live Oracle catalog reads — same queries as `dotnet-schema-diff` Step 1,
reused here, not redefined.

---

## Steps

**Step 1 — Inventory the data-access surface from `repo-map.json`.**

Pull `dataAccess.efCoreContexts` and `dataAccess.dapperRepositories` from the
cached map (rerun `repo-discovery` first if stale). For each EF Core
`DbContext`, list its configured entities and their column-to-property
mappings. For each Dapper repository, list the tables/views its SQL queries
touch.

**Step 2 — Cross-reference EF Core entities against Dapper queries on the
same table.**

For every table touched by both:
- **Column coverage** — does the Dapper query select every column EF Core's
  entity configuration maps, or has the entity gained columns the Dapper
  query silently ignores (or vice versa)?
- **Type mapping consistency** — does the Dapper query's parameter/result
  type match EF Core's configured CLR type for the same column (a classic
  drift point: EF Core maps `NUMBER(1)` to `bool` via a value converter, a
  hand-written Dapper query maps the same column to `int`)?
- **Nullability** — does the Dapper query's result model mark a column
  nullable consistently with the EF Core entity's configuration and the
  actual database constraint (three sources of truth that should agree and
  often don't)?
- **Naming drift** — same table, different conceptual model name between the
  EF Core entity and the Dapper DTO, making it hard to know they're the same
  underlying data without reading both.

**Step 3 — Provider-specific type incompatibility check.**

For repos spanning more than one provider (per `06-database-provider-guard.mdc`'s
remit, but at the audit/reporting level rather than the generation-time
guard level):
- Oracle `NUMBER` precision/scale vs. SQL Server `DECIMAL`/`INT` vs. Postgres
  `NUMERIC` — flag any shared DTO or contract that assumes one provider's
  rounding/overflow behavior
- Oracle's `VARCHAR2` byte-length semantics vs. SQL Server/Postgres
  character-length semantics — relevant for Arabic/RTL text given this
  repo's bilingual fields; a column sized correctly for Latin text can
  truncate Arabic content silently if byte-length wasn't accounted for
- Date/time: Oracle `DATE` (includes time, no fractional seconds by default)
  vs. `TIMESTAMP` vs. SQL Server `datetime2` vs. Postgres `timestamptz` —
  flag any cross-provider sync path or shared DTO that assumes one provider's
  semantics
- Sequence/identity strategy differences (Oracle sequences + triggers or
  `IDENTITY` columns in 12c+, vs. SQL Server `IDENTITY`, vs. Postgres
  `SERIAL`/`IDENTITY`) — flag any code that assumes a specific
  ID-generation timing (e.g. ID available pre-insert) that doesn't hold
  across providers

**Step 4 — Stored procedure / view / function drift.**

For stored procedures, views, functions, and sequences captured in
`repo-map.json`: confirm the C# call site (Dapper `QueryAsync` with
`CommandType.StoredProcedure`, or EF Core's mapped function) still matches
the procedure's actual parameter list and return shape. Flag procedures that
exist in the database layer but have no corresponding call site found in code
(possible dead database object — cross-reference with `technical-debt-tracker`
rather than duplicating its dead-code detection).

**Step 5 — Migration consistency.**

Confirm EF Core migration history matches the live schema captured by
`repo-discovery`/`dotnet-schema-diff` catalog queries — a migration marked
applied in `__EFMigrationsHistory` but whose DDL doesn't match what's
actually in the database is a higher-severity finding than a normal schema
diff, since it means the migration history itself can't be trusted as a
source of truth going forward.

**Step 5b — Cross-provider SQL syntax and migration portability (added Phase 5).**

For repos targeting more than one provider, or generating migrations meant
to be portable, check each provider-specific surface separately rather than
assuming EF Core's abstraction layer has fully normalized it — EF Core
migrations and Dapper raw SQL both leak provider-specific syntax in ways
that only show up when actually run against the second provider:

- **Identity/sequence generation** — Oracle (`IDENTITY` columns in 12c+ vs.
  sequence+trigger in older schemas) vs. SQL Server `IDENTITY` vs. Postgres
  `SERIAL`/`IDENTITY` vs. SQLite `AUTOINCREMENT` vs. MySQL `AUTO_INCREMENT`
  — flag any migration or Dapper insert that assumes ID-availability timing
  that doesn't hold for every targeted provider
- **Pagination syntax** — `OFFSET...FETCH` (SQL Server, Postgres, Oracle
  12c+) vs. `LIMIT...OFFSET` (Postgres, MySQL, SQLite) vs. `ROWNUM`
  (older Oracle) — flag raw Dapper SQL using one provider's syntax in a
  repository that's expected to be provider-agnostic per
  `06-database-provider-guard.mdc`
- **Date/time functions** — `SYSDATE`/`SYSTIMESTAMP` (Oracle) vs. `GETUTCDATE()`
  (SQL Server) vs. `NOW()`/`CURRENT_TIMESTAMP` (Postgres/MySQL) used directly
  in raw SQL instead of being parameterized from the application layer
- **Parameter syntax** — named (`:param` Oracle, `@param` SQL Server) vs.
  positional (`?` MySQL/SQLite default) — flag raw SQL strings that
  hardcode one provider's parameter marker in a Dapper repository meant to
  be provider-configurable
- **Quoted identifiers** — double-quote (Oracle, Postgres standard SQL) vs.
  square-bracket (SQL Server) vs. backtick (MySQL) — flag any raw SQL
  hardcoding one provider's quoting style for a reserved-word column name
- **Boolean handling** — native `BOOLEAN` (Postgres) vs. `NUMBER(1)`/`CHAR(1)`
  convention (Oracle, no native boolean) vs. `BIT` (SQL Server) — flag any
  Dapper mapping or EF Core value converter that assumes one provider's
  native representation without an explicit conversion for the others
- **MERGE / UPSERT portability** — Oracle `MERGE INTO ... USING ... ON ...
  WHEN MATCHED / WHEN NOT MATCHED`, SQL Server `MERGE`, Postgres
  `INSERT ... ON CONFLICT DO UPDATE`, MySQL `INSERT ... ON DUPLICATE KEY
  UPDATE`, SQLite `INSERT OR REPLACE` — fundamentally different syntax
  and locking semantics across providers. Flag any MERGE/UPSERT in Dapper
  raw SQL or an EF Core `ExecuteSqlRaw` call that uses one provider's
  syntax where `06-database-provider-guard.mdc` shows the project targets
  more than one provider. Recommend either abstracting to an EF Core
  `AddOrUpdate` equivalent (if available for the entity), or making the
  provider branch explicit via the configurable provider pattern rather
  than having two copies of raw SQL diverge silently.
- **String concatenation** — `||` (Oracle, Postgres, SQLite standard SQL)
  vs. `+` (SQL Server) vs. `CONCAT()` (MySQL, works cross-provider but
  with NULL-propagation differences) in raw SQL strings. Flag any raw
  concatenation operator that is provider-specific in a repository where
  portability is expected — `CONCAT()` is the safest cross-provider form,
  but note the MySQL difference where `CONCAT(value, NULL)` returns NULL
  while `||` in Postgres/SQLite with `NULL` also returns NULL, but the
  explicit function makes the intent clear in a code review.

  (MySQL 5.7+, SQL Server 2016+) vs. Oracle's `JSON` constraint-on-CLOB
  approach (pre-21c) vs. SQLite (no native JSON type, stored as TEXT) —
  flag any query using provider-native JSON operators that won't have an
  equivalent on another targeted provider

This step is the cross-database compatibility validator the broader gap
analysis called out as a standalone idea — implemented here as an extension
of `database-audit` rather than a separate skill, since it reuses the same
inventory (Step 1), the same provider detection (`repo-map.json`), and the
same severity model (Step 6) rather than re-deriving any of them.



Same severity model as `dotnet-schema-diff` for consistency across the
database-skill family:
- **Blocking** — type mismatch that can cause runtime exceptions or silent
  data corruption (e.g. Dapper deserializing a now-wider Oracle `NUMBER`
  into `int`, overflow risk)
- **Risk** — drift that hasn't caused an incident yet but will under
  predictable conditions (Arabic text truncation, nullability mismatch)
- **Informational** — naming/cosmetic inconsistency between EF and Dapper
  models for the same table

---

## Example Invocation

**Command:** `/database-audit Tamkeen.Payments oracle`

**Context:** Quarterly data-layer health check on the payments platform.

Agent inventories `Tamkeen.Payments`'s `PaymentsDbContext` (EF Core) against
its 6 Dapper repositories, finds `PAYMENT_TRANSACTIONS.GATEWAY_REFERENCE` was
widened from `VARCHAR2(50)` to `VARCHAR2(100)` in a migration three months
ago, confirms the EF Core entity was updated accordingly, but finds two
Dapper repositories (`ReportingRepository`, `ReconciliationRepository`) still
declare the mapped C# property with an unenforced-but-implied 50-char
assumption in a validation helper — classified Risk, since DirectPay gateway
references can now legitimately exceed 50 characters and would currently
pass database insertion but fail an outdated client-side check.

---

## Output

- Findings table (object, drift type, EF Core state, Dapper state, severity)
- Specific file:line references for each Dapper query/DTO requiring update
- No auto-generated fixes for logic-level drift (unlike `dotnet-schema-diff`'s
  DDL output) — code changes here touch business logic, not just schema, so
  recommendations are presented for the developer to implement
- Flags handed to `technical-debt-tracker` for any finding not fixed
  immediately, so it isn't silently rediscovered next quarter
