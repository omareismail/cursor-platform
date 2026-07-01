# Skill: dotnet-dapper-gen

**Invocation:** `/dotnet-dapper-gen [repository-or-query-name] [provider]`
`provider`: `sqlserver` | `postgres` | `oracle` (defaults to whatever
`databaseConventions.md` lists; required if the project is multi-database)

---

## Overview

**Memory references:** `memory-bank/databaseConventions.md`, `memory-bank/performanceGuidelines.md`, `memory-bank/securityStandards.md`

`dotnet-dapper-gen` generates parameterized Dapper queries and repository methods
for read-heavy or reporting paths where EF Core's tracking and change-detection
overhead isn't worth paying — this is the deliberate alternative named in
`technologyStack.md`, not a fallback for when EF Core "feels slow." Every query is
parameterized regardless of provider (no string interpolation, ever — `04-security-
guard.mdc` blocks generation otherwise), and the SQL dialect is adapted per
provider since Dapper does not abstract dialect differences the way EF Core does.

---

## Steps

**Step 0 — Call `pattern-finder` for the nearest existing repository on the
same provider.**

Run `/pattern-finder new Dapper repository for [table/query]`, filtered to
the target provider — an Oracle Dapper repository is not a usable template
for a PostgreSQL one (parameter prefix, pagination syntax, and type mapping
all differ). Imitate the matched repository's parameterization style, result
mapping (manual vs. `Dapper.FluentMap`), and connection-lifetime pattern.

**Step 1 — Resolve target provider and dialect rules.**

Read `databaseConventions.md` "Provider per project." If the query needs to run
against more than one provider (rare — usually only for a schema-comparison or
migration-support utility, see `dotnet-schema-diff`), generate a query per
provider behind a shared interface, not one query with conditional SQL fragments
spliced together at runtime.

**Step 2 — Generate the parameterized query, dialect-adjusted.**

SQL Server:
```csharp
public async Task<Policy?> GetByPolicyNumberAsync(string policyNumber, CancellationToken ct)
{
    const string sql = """
        SELECT TOP 1 Id, PolicyNumber, BrokerId, IssuedAt, Status
        FROM Policy WITH (NOLOCK)
        WHERE PolicyNumber = @PolicyNumber
        """;
    using var conn = _connectionFactory.CreateConnection();
    var cmd = new CommandDefinition(sql, new { PolicyNumber = policyNumber }, cancellationToken: ct);
    return await conn.QuerySingleOrDefaultAsync<Policy>(cmd);
}
```

PostgreSQL (note: `LIMIT`, not `TOP`; lowercase unquoted identifiers fold to
lowercase — match the actual column casing in the schema):
```csharp
const string sql = """
    SELECT id, policy_number, broker_id, issued_at, status
    FROM policy
    WHERE policy_number = @PolicyNumber
    LIMIT 1
    """;
```

Oracle (note: `FETCH FIRST n ROWS ONLY` for limiting, `:ParamName` bind style is
also valid via Oracle.ManagedDataAccess but Dapper's `@ParamName` works through
its provider adapter — keep `@` for consistency with the rest of the codebase;
identifiers are case-sensitive only if quoted, legacy schemas are typically
unquoted UPPERCASE):
```csharp
const string sql = """
    SELECT ID, POLICY_NUMBER, BROKER_ID, ISSUED_AT, STATUS
    FROM POLICY
    WHERE POLICY_NUMBER = :PolicyNumber
    FETCH FIRST 1 ROWS ONLY
    """;
```

**Step 3 — Generate bulk operations using the provider's actual bulk path, not a loop.**

SQL Server — `SqlBulkCopy` for large inserts, table-valued parameters for bulk
lookups/updates. Postgres — `NpgsqlBinaryImporter` (via `COPY`) for bulk inserts.
Oracle — `OracleBulkCopy` (Oracle.ManagedDataAccess) or array binding
(`OracleCommand.ArrayBindCount`) for bulk inserts/updates. Never generate a
`foreach` loop issuing one `ExecuteAsync` per row for anything over ~50 rows —
flag it as a `performanceGuidelines.md` violation if found in existing code.

**Step 4 — Wrap multi-statement operations in an explicit transaction.**

```csharp
using var conn = _connectionFactory.CreateConnection();
conn.Open();
using var tx = conn.BeginTransaction();
try
{
    await conn.ExecuteAsync(sql1, params1, tx);
    await conn.ExecuteAsync(sql2, params2, tx);
    tx.Commit();
}
catch
{
    tx.Rollback();
    throw;
}
```

**Step 5 — Generate the repository interface and registration, matching the
project's existing repository pattern from `systemPatterns.md`.**

---

## Example Invocation

**Command:** `/dotnet-dapper-gen MotorModelDedupQuery oracle`

**Context:** Reporting query against the legacy Oracle `MOTORS` schema to find
candidate duplicate motor model names for the fuzzy-dedup service.

Agent generates an Oracle-dialect parameterized query (`FETCH FIRST`,
UPPER_SNAKE_CASE columns matching the legacy schema), wires it through the
existing `ILegacyConnectionFactory` from `dotnet-multi-db-gen`, and flags that
this is read-only (no transaction needed, no write-back to Oracle).

---

## Output

- New: `Infrastructure/Persistence/Queries/[Name]Query.cs` or
  `Infrastructure/Persistence/Repositories/[Name]Repository.cs`
- New: interface in `Application/Interfaces/`
- Modified: DI registration
