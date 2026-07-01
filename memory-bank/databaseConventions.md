# Database Conventions
**Last Updated:** [YYYY-MM-DD]
**Note:** This is the foundational reference. Phase 2 of the workspace roadmap adds
dedicated skills (multi-provider EF Core/Dapper, dialect differences, schema
comparison, migration strategy) that read this file — keep it accurate, that work
builds on top of it rather than duplicating it.

## Provider per project
State which provider(s) this project actually uses — most projects use one as the
system of record and may read a second as legacy/reporting only.
> EXAMPLE: "SQL Server — system of record. Oracle — read-only, legacy MOTORS and
> INSURANCE_ONLINE schemas, accessed via a dedicated read-only connection string,
> never migrated by this project's EF Core migrations."

## Naming
- Tables: PascalCase, singular (`Policy`, not `Policies`) — [or your team's actual
  convention; Oracle shops often use UPPER_SNAKE_CASE for legacy schemas — record
  which applies where, since mixing within one schema is worse than either choice].
- Columns: match table casing convention. Primary key: `Id` (SQL Server/Postgres) or
  `<TABLE>_ID` (Oracle legacy convention — do not rename existing legacy columns).
- Foreign keys: `<ReferencedTable>Id`.

## Parameterization
All SQL — Dapper or raw — uses parameterized queries. No string interpolation into
SQL text, ever, including for "trusted" internal values like enum names or table
names selected by a switch statement. `04-security-guard.mdc` blocks generation of
interpolated SQL.

## Transactions
- EF Core: `DbContext.Database.BeginTransactionAsync()` only when more than one
  `SaveChangesAsync()` call must be atomic; a single `SaveChangesAsync()` is already
  transactional.
- Cross-database operations (e.g. write to SQL Server, read-confirm from Oracle)
  cannot share a transaction — use the outbox pattern or compensating actions instead
  of pretending a distributed transaction exists.

## Migrations
EF Core migrations are owned by the system-of-record provider only. Read-only
secondary providers (e.g. legacy Oracle) are never targeted by `dotnet ef migrations`
— schema changes there go through the DBA process and get reflected in
`memory-bank/decisionLog.md` when they affect this codebase.

## Per-provider best practices

### SQL Server
- Use `READ COMMITTED SNAPSHOT` isolation at the database level to reduce lock
  contention instead of reaching for `WITH (NOLOCK)` query-by-query.
- `NVARCHAR` by default for any text that could ever contain Arabic or other
  non-Latin script — `VARCHAR` silently mangles it.
- Clustered index choice matters more than on Postgres/Oracle — default to an
  `IDENTITY`/sequential key as the clustered index; a GUID clustered key
  fragments badly under write load.

### PostgreSQL
- Identifiers are case-folded to lowercase unless quoted — pick one convention
  (this project: unquoted lowercase_snake_case) and never mix quoted/unquoted
  references to the same table.
- `TEXT` over `VARCHAR(n)` unless a length constraint is a real business rule —
  Postgres doesn't get a performance benefit from `VARCHAR(n)` the way some other
  engines imply.
- Watch table bloat on high-churn tables (frequent updates/deletes) — autovacuum
  tuning matters before blaming the query/index for a regression.
- `pg_trgm` extension for fuzzy/leading-wildcard text search instead of
  `LIKE '%term%'` on an unindexed column.

### Oracle
- Identifiers limited to 30 bytes pre-12.2 (128 from 12.2c+) — confirm target
  version before generating long constraint/index names.
- No native boolean type — `NUMBER(1)` or `CHAR(1)` by convention, and the EF
  Core/Dapper mapping must be explicit, never left to provider default inference.
- Sequences + triggers (or `IDENTITY` columns from 12c+) for auto-increment keys
  — confirm which pattern an existing legacy schema already uses before adding a
  new table that mixes conventions.
- Run `DBMS_STATS.GATHER_TABLE_STATS` after bulk loads — Oracle's optimizer is
  unusually sensitive to stale statistics on tables that are bulk-loaded rather
  than incrementally written.
- Legacy schemas in this codebase's actual projects (MOTORS, INSURANCE_ONLINE)
  use unquoted UPPER_SNAKE_CASE — match that convention exactly when writing
  Dapper SQL against them; do not "modernize" the casing in queries, since
  Oracle's default identifier folding makes mismatched casing a silent
  no-rows-found bug, not an error.

## Related skills (Phase 2)
`dotnet-multi-db-gen` (provider/connection wiring), `dotnet-dapper-gen`
(parameterized multi-provider queries and bulk ops), `dotnet-schema-diff`
(cross-environment/cross-provider schema comparison), `dotnet-query-optimizer`
(provider-aware query and index tuning). `06-database-provider-guard.mdc`
enforces the boundaries described above at generation time.
