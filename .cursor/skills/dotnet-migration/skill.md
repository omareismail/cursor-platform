# Skill: dotnet-migration

**Invocation:** `/dotnet-migration [migration-name]`

---

## Overview

**Memory references:** `memory-bank/databaseConventions.md`

`dotnet-migration` generates an EF Core migration safely by first validating
that the DbContext model matches the spec's Database Changes section, then
reviewing the generated migration for unintended destructive changes, missing
indexes, and large-table risks before any `database update` command is run.
For any migration strategy that is not straightforward (large production tables,
multi-step backfill required, shared database with other services), it invokes
`/speckit-options` before generating anything — the migration strategy is a
consequential decision, not a default. All migrations must have a functioning
`Down()` method.

---

## Steps

**Step 0 — Confirm this provider owns migrations.**

Read `memory-bank/databaseConventions.md` "Provider per project." If the target
provider is listed as a read-only secondary (common for legacy Oracle schemas in
this codebase's projects), refuse and redirect:
```
⚠ [Provider] is configured as a read-only secondary in databaseConventions.md.
  This codebase does not own its schema — migrations here would be reconciled
  manually with the DBA process. Use /dotnet-schema-diff to compare schemas, or
  /dotnet-multi-db-gen if this provider's role needs to change.
```
Only proceed past this step for the system-of-record provider.

**Step 1 — Apply planning rigor check.**

If the migration involves any of the following, run `/speckit-options` for the
migration strategy before proceeding:
- A table with > 1M rows (large table alteration risk)
- Dropping a column or table (destructive — requires backfill strategy)
- Renaming a column (breaking change for any code not yet deployed)
- Adding a NOT NULL column without a default (blocks insert for in-flight deploys)
- A shared database accessed by multiple services

Options to offer:
```
Option A — Single-step: Apply all changes in one migration.
  Trade-off: Simple | Risk of locking large tables

Option B — Additive-then-backfill-then-cleanup:
  Step 1: Add new column/table (nullable or with default).
  Step 2: Backfill data via a separate background job.
  Step 3: Add NOT NULL constraint after backfill complete.
  Step 4: Remove old column in a follow-up migration.
  Trade-off: Zero downtime | More coordinated deploys required

Option C — Deferred (feature flag):
  Ship the code change behind a feature flag; run the migration in maintenance window.
  Trade-off: No production risk | Requires feature flag infrastructure
```

**Step 2 — Verify DbContext model is aligned with spec.**

Read the spec's `## Database Changes` section. For each stated change, verify
the corresponding EF Core entity / Fluent API configuration exists in the
Infrastructure project. If not, output:
```
⚠ Model mismatch: Spec states a new column [ColumnName] on [TableName], but
  the EF Core entity [EntityName] does not have a property for it.
  Update the entity before generating the migration.
```

**Step 3 — Generate the migration.**

```bash
dotnet ef migrations add [MigrationName] \
  --project src/[Project].Infrastructure \
  --startup-project src/[Project].API \
  --output-dir Persistence/Migrations
```

**Step 4 — Review the generated migration.**

Open and analyze the generated `.cs` migration file for:

| Issue | Severity | Action |
|-------|----------|--------|
| Column drop without data preservation | MUST FLAG | Refuse to proceed; require explicit confirmation |
| FK column without an index | SHOULD FIX | Suggest adding `CreateIndex` for the FK |
| NOT NULL column on existing table | WARN | Verify default value or migration strategy |
| `AlterColumn` on large table | WARN | Flag production lock risk |
| `Down()` method is empty or `throw new NotSupportedException()` | MUST FLAG | Require a real Down() |
| Oracle target: identifier > 30 bytes (pre-12.2 compatibility) | WARN | Oracle truncates/errors past 30 chars — rename predictably |
| Oracle target: `bool` property mapped without explicit conversion | MUST FLAG | Oracle has no native boolean — confirm `NUMBER(1)` or `CHAR(1)` conversion is configured, not left to provider default |
| Postgres target: `Include()` causing a cartesian-product join split issue | WARN | Verify EF Core's query splitting behavior matches expectation for this provider |

**Step 5 — Generate database update command.**

```bash
dotnet ef database update \
  --project src/[Project].Infrastructure \
  --startup-project src/[Project].API
```

Output this command for the developer to run manually — never auto-execute.

**Step 6 — Remind about Down() completeness.**

Check the generated `Down()` method. If it only has partial reversal, output:
```
⚠ The generated Down() migration may be incomplete. Verify it fully reverses
the Up() migration — especially any indexes, FKs, and constraints added in Up().
A broken Down() makes emergency rollbacks impossible.
```

---

## Example Invocation

**Command:** `/dotnet-migration AddBrokerClientExportAuditTable`

**Context:** Spec states: new table `broker_export_audit` with columns
`id`, `broker_id` (FK), `exported_at`, `row_count`, `filter_params_json`.

Agent verifies `BrokerExportAudit.cs` entity exists with all properties,
generates the migration, reviews it — finds FK `broker_id` has no index,
suggests adding `CreateIndex("IX_broker_export_audit_broker_id")`. Migration
does not involve large tables so no strategy choice needed.

Output:
```
✅ Migration generated: 20250915143022_AddBrokerClientExportAuditTable

⚠ SHOULD FIX: No index on FK column broker_id.
  Add to the migration:
  migrationBuilder.CreateIndex("IX_broker_export_audit_broker_id", "broker_export_audit", "broker_id");

Run to apply:
  dotnet ef database update --project src/OrientPortal.Infrastructure --startup-project src/OrientPortal.API
```

---

## Output

- Generated files: `src/[Project].Infrastructure/Persistence/Migrations/[timestamp]_[Name].cs`
- Terminal: migration review output (issues found, indexes to add, Down() check)
- Terminal: `dotnet ef database update` command (for manual execution)
