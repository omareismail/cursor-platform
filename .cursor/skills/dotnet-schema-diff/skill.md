# Skill: dotnet-schema-diff

**Invocation:** `/dotnet-schema-diff [source-env] [target-env] [provider]`
Example: `/dotnet-schema-diff LIVE TEST oracle`

---

## Overview

**Memory references:** `memory-bank/databaseConventions.md`, `memory-bank/decisionLog.md`, `memory-bank/deploymentNotes.md`

`dotnet-schema-diff` compares two schema snapshots (typically LIVE vs TEST, or two
providers holding the same logical data) and produces a structured diff plus the
DDL needed to reconcile them — covering tables, columns, data types, nullability,
constraints, indexes, and sequences. It does not silently generate and run
reconciliation DDL; the diff is presented for review and the DDL is output as a
script the developer runs manually, since schema reconciliation on a shared
database is exactly the kind of consequential change `05-planning-rigor.mdc`
exists for.

This formalizes work that has historically been done by hand against Oracle's
`MOTORS`/`INSURANCE_ONLINE` schemas — extracting DDL, diffing LIVE against TEST,
and generating migration SQL for category-mapping and translation tables.

**MCP tools:** if the Oracle SQLcl MCP server, `postgres` MCP server, or a
vetted SQL Server MCP server (see `.cursor/docs/mcp-ecosystem.md`) is
connected, use it to pull live catalog metadata directly rather than asking
the developer to paste query output — same Step 1 queries below, executed
through the MCP connection instead of manually.

---

## Steps

**Step 1 — Extract DDL/metadata from both sources.**

Provider-specific catalog queries (read-only, never run against a connection
string that isn't explicitly read-only for a LIVE source):

Oracle:
```sql
SELECT table_name, column_name, data_type, data_length, nullable, data_default
FROM all_tab_columns
WHERE owner = :SchemaOwner
ORDER BY table_name, column_id;

SELECT index_name, table_name, column_name, uniqueness
FROM all_ind_columns aic JOIN all_indexes ai ON aic.index_name = ai.index_name
WHERE ai.owner = :SchemaOwner;
```

PostgreSQL:
```sql
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = @SchemaName
ORDER BY table_name, ordinal_position;
```

SQL Server:
```sql
SELECT t.name AS table_name, c.name AS column_name, ty.name AS data_type,
       c.is_nullable, dc.definition AS default_value
FROM sys.tables t
JOIN sys.columns c ON c.object_id = t.object_id
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = t.object_id
    AND dc.parent_column_id = c.column_id;
```

**Step 2 — Normalize and diff.**

Produce a structured table:

| Object | Change type | LIVE | TEST | Risk |
|---|---|---|---|---|
| `POLICY.STATUS` | Type mismatch | `VARCHAR2(20)` | `VARCHAR2(10)` | Data truncation risk |
| `MOTOR_MODEL` | Missing constraint | `UNIQUE(MODEL_CODE)` | none | Dedup logic relies on this |
| `BROKER_EXPORT_AUDIT` | Table missing | exists | missing | Blocks feature deploy to TEST |

**Step 3 — Classify each finding.**

- **Blocking** — missing table/column required by code already deployed or about
  to deploy.
- **Risk** — type/constraint mismatch that won't error immediately but can cause
  silent data issues (truncation, duplicate rows a unique constraint would catch).
- **Informational** — naming/cosmetic differences with no functional impact.

**Step 4 — Generate reconciliation DDL, provider-correct, never auto-executed.**

```sql
-- Oracle: add missing constraint found in Step 2
ALTER TABLE MOTOR_MODEL ADD CONSTRAINT UQ_MOTOR_MODEL_CODE UNIQUE (MODEL_CODE);

-- Oracle 30-byte identifier limit (pre-12.2): verify constraint name length
-- before generating — truncate predictably (not silently) if it would exceed it.
```

**Step 5 — Record the decision in `decisionLog.md` if reconciliation isn't immediate.**

If the recommendation is "don't reconcile yet" (e.g. TEST intentionally lags
LIVE for a pending migration), write an ADR entry rather than letting the
discrepancy go unexplained the next time someone runs this skill and gets
confused by the same finding.

---

## Example Invocation

**Command:** `/dotnet-schema-diff LIVE TEST oracle`

**Context:** Pre-deployment check before promoting a feature that depends on a
new `VEHICLE_CATEGORY_MAPPING` table.

Agent extracts DDL from both Oracle schemas (read-only connections), finds the
table missing in TEST, classifies it Blocking, generates the `CREATE TABLE`
script matching LIVE's exact column types and constraints, and flags that this
must run before the feature's TEST deployment, not after.

---

## Output

- Diff report (table, presented in chat — not written to disk unless requested)
- Reconciliation DDL script (provider-specific, for manual execution)
- Optional: new `decisionLog.md` ADR entry if a discrepancy is intentionally deferred
