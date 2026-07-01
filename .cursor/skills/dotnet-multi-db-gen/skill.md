# Skill: dotnet-multi-db-gen

**Invocation:** `/dotnet-multi-db-gen [provider] [role]`
`provider`: `sqlserver` | `postgres` | `oracle`
`role`: `system-of-record` | `read-only-secondary`

---

## Overview

**Memory references:** `memory-bank/databaseConventions.md`, `memory-bank/architecture.md`, `memory-bank/technologyStack.md`

`dotnet-multi-db-gen` scaffolds the wiring for a project that talks to more than
one database — the common shape in this codebase's actual projects (SQL Server or
PostgreSQL as system of record, read-only Oracle for legacy MOTORS/INSURANCE_ONLINE-
style schemas). It generates one `DbContext` (or a Dapper connection factory) per
data source, registers each with its own named connection string and its own
`AddDbContext`/factory call, and never lets two providers share a context. This
exists because the single most common mistake in multi-database .NET projects is
treating the second database as an afterthought bolted onto the primary
`DbContext` — which breaks migrations, breaks connection pooling assumptions, and
makes it impossible to point the two providers at different environments
independently (e.g. Oracle TEST while SQL Server is LIVE).

If `databaseConventions.md` doesn't yet state which provider is system-of-record,
this skill runs `/speckit-options` before generating anything — that's an
architectural decision, not a default.

**MCP tools:** if a provider-specific MCP server (Oracle SQLcl, `postgres`, or
a vetted SQL Server server — see `.cursor/docs/mcp-ecosystem.md`) is
connected, use it in Step 1 to confirm the actual current schema/permissions
of the data source being wired up, rather than relying on what
`databaseConventions.md` claims if it might be stale.

---

## Steps

**Step 1 — Resolve provider role from `databaseConventions.md`.**

Read the "Provider per project" section. If empty or this is the first database
being added, ask via `/speckit-options`:
```
Option A — [provider] as system of record (EF Core owns migrations, read/write)
Option B — [provider] as read-only secondary (Dapper or EF Core with no migrations,
           read-only connection string, queried but never written by this app)
```

**Step 2 — Generate the connection registration.**

System-of-record (EF Core, full read/write):
```csharp
// Infrastructure/Persistence/[Provider]DbContext.cs
public sealed class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }
    // DbSets...
}

// Program.cs / DI registration
builder.Services.AddDbContext<AppDbContext>(opts =>
    opts.UseSqlServer(builder.Configuration.GetConnectionString("Primary"),
        sql => sql.MigrationsAssembly("[Project].Infrastructure")));
```

Read-only secondary (Dapper connection factory — no DbContext, no migrations):
```csharp
// Infrastructure/Persistence/ILegacyConnectionFactory.cs
public interface ILegacyConnectionFactory
{
    IDbConnection CreateConnection();
}

public sealed class OracleLegacyConnectionFactory : ILegacyConnectionFactory
{
    private readonly string _connectionString;
    public OracleLegacyConnectionFactory(IConfiguration config) =>
        _connectionString = config.GetConnectionString("LegacyOracleReadOnly")
            ?? throw new InvalidOperationException("LegacyOracleReadOnly connection string missing");

    public IDbConnection CreateConnection() => new OracleConnection(_connectionString);
}
```

Register as scoped, never singleton (connections aren't thread-safe across requests):
```csharp
builder.Services.AddScoped<ILegacyConnectionFactory, OracleLegacyConnectionFactory>();
```

**Step 3 — Verify connection strings are environment-scoped and never shared.**

```json
// appsettings.json (structure only — actual values from user-secrets/Key Vault)
{
  "ConnectionStrings": {
    "Primary": "[system-of-record connection string]",
    "LegacyOracleReadOnly": "[read-only Oracle connection string — separate user, read-only grants]"
  }
}
```

Flag if the read-only secondary's database user has write grants — the connection
string role should match the database-level permission, not just the app's intent.

**Step 4 — Generate a health check per data source.**

```csharp
builder.Services.AddHealthChecks()
    .AddDbContextCheck<AppDbContext>("primary-db")
    .AddCheck<LegacyOracleHealthCheck>("legacy-oracle-readonly");
```

A multi-database app where one source silently goes unreachable while the other
stays healthy needs to be observable as a degraded state, not a total outage.

**Step 5 — Update `memory-bank/databaseConventions.md` and `memory-bank/architecture.md`.**

Confirm the "Provider per project" and "Module boundaries" sections reflect what
was just generated. If they're still template placeholders, fill them in from
this invocation rather than leaving them stale.

---

## Example Invocation

**Command:** `/dotnet-multi-db-gen oracle read-only-secondary`

**Context:** Project already has SQL Server as system of record (existing
`AppDbContext`). Needs read-only access to the legacy `MOTORS` Oracle schema for
vehicle category lookups.

Agent generates `OracleLegacyConnectionFactory`, a `LegacyOracleReadOnly`
connection string entry, a scoped DI registration, and an Oracle-specific health
check. Confirms no `DbContext` or migration path was created for Oracle (read-only,
per `databaseConventions.md`).

---

## Output

- New: `Infrastructure/Persistence/[Provider]ConnectionFactory.cs` (read-only) or
  `[Provider]DbContext.cs` (system of record)
- New: health check class
- Modified: `Program.cs` (DI registration), `appsettings.json` (connection string key)
- Modified: `memory-bank/databaseConventions.md`, `memory-bank/architecture.md`
