# Skill: data-model-design

**Invocation:** `/data-model-design`

---

## Overview

**Memory references:** `memory-bank/databaseConventions.md, memory-bank/architecture.md`

`data-model-design` turns the domain model into a physical schema — tables,
keys, indexes, precision, nullability — and assigns each data source its role
where the product talks to more than one database. It is the phase 3 counterpart
to `/domain-model-gen`: that one describes the business as it would exist without
software, this one decides how it is stored. Doing it explicitly matters most in
this codebase's actual shape, where a SQL Server or PostgreSQL system of record
sits beside a read-only Oracle legacy schema, and the dialect rules that
`06-database-provider-guard` enforces depend on knowing which is which.

---

## Steps

**Step 1 — Read the inputs.**

`docs/analysis/domain-model.md`, `docs/design/architecture.md`,
`docs/product/nfr.md` (capacity, retention, residency), `docs/analysis/risks.md`
(data risks).

**Step 2 — Assign provider roles before designing tables.**

For each data source: which entities live there, whether it is read-write or
read-only, its dialect, and how it is reached (EF Core, or Dapper for read-heavy
and reporting paths). One `DbContext` per data source — never one context
spanning two providers.

**Step 3 — Map aggregates to tables.**

The aggregate boundary decides the transaction boundary, which decides which
tables are written together. Cross-aggregate references use the business key,
not a foreign key to another aggregate's internals — an FK across an aggregate
boundary is how transaction scope quietly grows.

**Step 4 — Get precision and nullability right the first time.**

| Data | Rule |
|---|---|
| Money | `decimal(18,3)` or as `databaseConventions.md` states — never float, never double |
| Dates | State whether the column carries an offset, and be consistent |
| Text | Bounded lengths; state the collation where Arabic content is stored |
| Enumerations | Stored as what — and whether the set is closed |
| Identifiers | Generation strategy, and whether it is exposed to users |

Nullable is a business statement, not a convenience. Every nullable column names
the case where the value is legitimately absent.

**Step 5 — Index for the queries that exist.**

Work from the use cases: every query implied by a use case gets a supporting
index, or an explicit note that a scan is acceptable at the stated capacity.
Include covering indexes where an NFR depends on them, and say which NFR.

Do not index speculatively. Every index is a write cost paid on every insert.

**Step 6 — Design the migration path for a live database.**

If the product replaces or reads from an existing system: how the initial load
works, how long it takes, what happens to records that fail validation, and
whether the two run in parallel. Anything structurally risky uses expand ->
migrate -> contract. This answers the data risks from `risks.md`.

**Step 7 — Retention and residency.**

Per data class: how long it is kept, what happens at expiry, and which
jurisdiction it must stay in. These come from `nfr.md` and, in this domain,
usually from a regulator.

**Step 8 — Write `docs/design/database-design.md`.**

Provider roles, then per-table DDL-shaped tables, then indexes with their
justification, then the migration and retention sections, then a Mermaid ERD of
the physical model.

**Step 9 — Prepare the promotion.**

Provider roles and dialect rules go into `memory-bank/databaseConventions.md` —
show the diff, get the user's word, apply with `CLAUDE_ALLOW_TIER2_EDIT=1`.
Rule 06 reads that file on every `.cs` and `.sql` file thereafter.

---

## Front-matter — required on every document this skill writes

Open each file with this block. It is the machine-readable half of a
human-written document: the prose stays prose, and `artifact-schema.mjs` reads
this to know what the document is and where it sits in the chain.

```yaml
---
type: database-design
phase: DESIGN
traces: [<repo-relative paths of the documents this was derived from>]
owner: solution-architect
---
```

`defines` names the ID prefixes this document **owns**. It is what stops the
first cell of a traceability table being mistaken for a second definition — a
citation of `S-1` in a use-case table is a reference, not a redeclaration.

Validate before reporting done:

```bash
node .cursor/tools/artifact-schema.mjs validate
node .cursor/tools/artifact-schema.mjs check
```

`check` fails on an ID cited but never defined, and on a chain that stops — a
requirement no story implements, a story no use case covers, a use case no
endpoint serves. Those are gate criteria, computed rather than judged, and
`lifecycle.mjs check` now fails on them too.

---

## Output

- `docs/design/database-design.md`
- A proposed diff for `memory-bank/databaseConventions.md`
- Terminal: entities with no table, money columns with no precision, use-case
  queries with no supporting index
