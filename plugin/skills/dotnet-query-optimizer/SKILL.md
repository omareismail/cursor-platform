---
name: dotnet-query-optimizer
description: "dotnet-query-optimizer reviews an EF Core LINQ query or a Dapper SQL statement for performance issues and produces a before/after with the actual execution plan characteristics that change — not just 'this should be faster.' It is distinct from dotnet-perf-profile (which covers in-process/allocation concerns); this skill is specifically about what happens once the query reaches the database... Invoked as /dotnet-query-optimizer."
---

<!-- GENERATED from the cursor-platform source skill "dotnet-query-optimizer".
     Do not edit here - edit the source and re-run the plugin build. -->

# Skill: dotnet-query-optimizer

**Invocation:** `/dotnet-query-optimizer [handler-or-query-path]`

---

## Overview

**Memory references:** `memory-bank/performanceGuidelines.md`, `memory-bank/databaseConventions.md`

`dotnet-query-optimizer` reviews an EF Core LINQ query or a Dapper SQL statement
for performance issues and produces a before/after with the actual execution plan
characteristics that change — not just "this should be faster." It is distinct
from `dotnet-perf-profile` (which covers in-process/allocation concerns); this
skill is specifically about what happens once the query reaches the database
engine, and its recommendations are provider-aware since the same LINQ query can
compile to meaningfully different SQL — and perform differently — across SQL
Server, PostgreSQL, and Oracle.

---

## Steps

**Step 1 — Identify the query pattern and provider.**

For EF Core: read the LINQ expression, determine target provider from
`databaseConventions.md`. For Dapper: read the raw SQL directly.

**Step 2 — Check against the common-issue list.**

| Issue | How it's detected | Fix |
|---|---|---|
| N+1 (lazy-loaded navigation in a loop) | Navigation property accessed inside a `foreach` without prior `.Include()` | Add `.Include()`/`.ThenInclude()`, or project to DTO with `.Select()` |
| Missing `AsNoTracking()` | Read-only query (no later `SaveChangesAsync()` on these entities) without it | Add `.AsNoTracking()` |
| Client-side evaluation | LINQ method EF Core can't translate, silently pulled into memory | Rewrite to a translatable expression or raise as `databaseConventions.md` candidate for Dapper |
| `SELECT *` equivalent (no projection) | Full entity loaded when only 2-3 fields are used downstream | `.Select()` projection to a DTO |
| Missing index on filter/sort/join column | Cross-reference `WHERE`/`ORDER BY`/`JOIN` columns against known indexes | Recommend index (Step 4) |
| `LIKE '%term%'` (leading wildcard) | Cannot use a standard B-tree index | For SQL Server/Postgres: full-text search or trigram index (`pg_trgm`); for Oracle: `CONTEXT` index (Oracle Text) — flag as a real architectural choice, not a one-line fix |

**Step 3 — Provider-specific notes.**

- **SQL Server:** `WITH (NOLOCK)` trades consistency for concurrency — only
  acceptable on reporting queries explicitly tolerant of dirty reads, never on
  anything touching balances or policy status. Recommend `READ COMMITTED
  SNAPSHOT` isolation at the database level instead, if the goal is reducing lock
  contention generally.
- **PostgreSQL:** check for missing `VACUUM`/autovacuum tuning on high-churn
  tables before assuming an index will fix a slow query — bloat is a common
  Postgres-specific cause of degraded query plans that an index won't address.
- **Oracle:** check whether statistics are stale (`DBMS_STATS.GATHER_TABLE_STATS`)
  before trusting the execution plan — Oracle's optimizer is especially sensitive
  to stale stats on legacy tables that get bulk-loaded rather than incrementally
  updated.

**Step 4 — Recommend specific indexes, not "add an index."**

```sql
-- SQL Server
CREATE NONCLUSTERED INDEX IX_Policy_BrokerId_Status
    ON Policy (BrokerId, Status) INCLUDE (PolicyNumber, IssuedAt);

-- PostgreSQL
CREATE INDEX idx_policy_broker_id_status ON policy (broker_id, status);

-- Oracle
CREATE INDEX IX_POLICY_BROKER_STATUS ON POLICY (BROKER_ID, STATUS);
```

Column order in composite indexes follows equality-predicates-first, then
range/sort columns — explain the specific query's predicate shape that drove the
chosen order, not a generic rule restated.

**Step 4b — Compiled queries, when the cost is translation rather than execution.**

If the SQL is already optimal and the plan is good but throughput is still short,
the time may be going on **LINQ-to-SQL translation**, which EF Core repeats on
every call. On a hot path executed thousands of times a minute this is real.

```csharp
private static readonly Func<PolicyDbContext, Guid, CancellationToken, Task<Policy?>> GetByIdQuery =
    EF.CompileAsyncQuery((PolicyDbContext db, Guid id, CancellationToken ct) =>
        db.Policies.AsNoTracking().FirstOrDefault(p => p.Id == id));

public Task<Policy?> GetByIdAsync(Guid id, CancellationToken ct) => GetByIdQuery(_db, id, ct);
```

**Recommend a compiled query only when all three hold**, otherwise it is
complexity with no return:

1. The query shape is **fixed** — no conditional `Where`, no optional includes.
   A compiled query cannot vary its shape, and forcing it to produces worse code
   than you started with.
2. It is genuinely **hot** — thousands of executions per minute, not per hour.
3. Execution time is already good. **Compiling a slow query gives you a slow
   query that translates faster**, which is almost always the wrong problem.

Cost to state plainly: compiled queries are static, so they hold a delegate for
the lifetime of the process and are markedly harder to read and to change. Never
recommend one as a first move.

**Step 4c — Set-based operations instead of load-modify-save.**

The most common avoidable cost in an EF codebase is loading entities purely in
order to change or delete them. EF Core 7+ gives you the set-based form:

```csharp
// Before: N round trips + change tracking for rows you never read
var expired = await _db.Quotes.Where(q => q.ExpiresAt < now).ToListAsync(ct);
foreach (var q in expired) q.Status = QuoteStatus.Expired;
await _db.SaveChangesAsync(ct);

// After: one statement, no materialisation, no tracking
await _db.Quotes.Where(q => q.ExpiresAt < now)
    .ExecuteUpdateAsync(s => s.SetProperty(q => q.Status, QuoteStatus.Expired), ct);
```

**Four consequences to flag every time you recommend this**, because they are
where the bugs come from:

1. **It bypasses the change tracker**, so any in-memory entity for those rows is
   now stale. Do not mix `ExecuteUpdate` and `SaveChanges` on the same entities
   in one unit of work.
2. **It bypasses `SaveChanges` interceptors** — which is where most audit-trail
   implementations live. If the entity is auditable under
   `${CLAUDE_PLUGIN_ROOT}/rules/07-audit-trail-guard.mdc`, a bulk update **silently skips the
   audit record**. Either write the audit rows explicitly or do not use it here.
   This is the single most important caveat on the whole technique.
3. **No domain events fire.** Anything downstream that expects them will not run.
4. **It is its own transaction** unless you opened one. For a multi-statement
   change, wrap it explicitly.

For large inserts, recommend the provider's bulk path — `SqlBulkCopy` for SQL
Server, `COPY` / `Npgsql` binary import for PostgreSQL, array binding for Oracle
— rather than `AddRange` + `SaveChanges`, which builds one parameterised
statement per batch and is orders of magnitude slower at volume. Check the
provider from `databaseConventions.md`; do not assume.

**Step 5 — Flag if a fix requires a schema change.**

Index recommendations go through `dotnet-migration` (system-of-record provider)
or are output as manual DDL with a note for `dotnet-schema-diff` to track
(read-only secondary provider) — this skill never runs DDL itself.

---

## Example Invocation

**Command:** `/dotnet-query-optimizer GetActivePoliciesByBrokerQueryHandler`

**Context:** Handler loads full `Policy` entities including a navigation to
`PolicyDocuments` for a list view that only displays policy number and status.

Agent finds: full entity load with unnecessary `Include`, no `AsNoTracking()`,
no index on `(BrokerId, Status)`. Generates a `.Select()` projection to
`PolicyListItemDto`, adds `AsNoTracking()`, and recommends the composite index
above — explaining the index covers both the `WHERE BrokerId = @x AND Status =
@y` filter and avoids a key lookup via the `INCLUDE` columns.

---

## Output

- Before/after code snippet for the query
- Index recommendation (DDL, provider-specific) — not auto-applied
- Note added to `performanceGuidelines.md` if this represents a new recurring
  pattern worth standardizing, rather than a one-off fix

