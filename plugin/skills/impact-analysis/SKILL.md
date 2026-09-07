---
name: impact-analysis
description: "Runs the impact-analysis workflow. Invoked as /impact-analysis."
---

<!-- GENERATED from the cursor-platform source skill "impact-analysis".
     Do not edit here - edit the source and re-run the plugin build. -->

# Skill: impact-analysis

**Invocation:** `/impact-analysis [what-you-intend-to-change]`
Example: `/impact-analysis "add IsActive to Broker"` · `/impact-analysis PremiumCalculator.Calculate` · `/impact-analysis "drop Policies.LegacyRateCode"` · `/impact-analysis --staged`

---

## Overview

**Memory references:** `.cursor/cache/feature-map.json` (from `feature-trace`),
`.cursor/cache/repo-map.json` (from `repo-discovery`, Step 0 freshness applies),
`memory-bank/architecture.md`, `memory-bank/apiConventions.md`,
`memory-bank/databaseConventions.md`, `memory-bank/businessRules.md`

`impact-analysis` answers **"if I change this, what breaks?"** *before* anything
is edited. It sweeps outward from a proposed change — callers, subclasses,
interface implementors, DTO consumers, SQL referencing a column, API clients
depending on a response shape, feature flags gating the path, tests that will go
red, and cached data that will go wrong — and returns a ranked blast radius with
the things that fail silently called out separately from the things that fail
loudly.

The distinction that matters: **a compiler error is not a risk, it is a chore.**
The value here is finding what will *not* fail at build time — the raw SQL string
naming a column you renamed, the frontend reading a JSON field you dropped, the
serialised cache entry whose shape just changed, the report that queries the
table directly and bypasses the domain entirely. Those are what turn a two-hour
change into a Sunday incident.

`context-builder` assembles what you need to *write* a feature. `impact-analysis`
enumerates what you might *break*. Run this one first when the change touches
anything that already exists.

Read-only. Writes nothing, not even the cache.

---

## Steps

**Step 0 — Establish the baseline.**

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/feature-map.mjs list
```

If `feature-map.json` has entries, the byFile / byTable / byEndpoint indexes turn
this skill from a whole-repo grep into a lookup. If a feature relevant to the
change is **STALE**, say so in the report header and treat its trace as a
hypothesis rather than fact — or re-run `/feature-trace` on it first.

If the map is empty, proceed with grep-based analysis and note in the output that
coverage would improve after tracing the affected features. Do not silently
degrade — the user should know which mode produced the answer.

**Step 1 — Classify the change. This determines everything that follows.**

| Change type | Blast radius is driven by |
|---|---|
| **Signature** (method params, return type) | Callers, overrides, interface implementors, mocks in tests |
| **Entity/property** (add, rename, retype, drop) | EF config, migrations, DTO mapping, raw SQL, reports, seed data, serialised caches |
| **DTO / API contract** | Every frontend caller, every external consumer, OpenAPI clients, integration tests |
| **Database column/table** | EF model, raw SQL and Dapper strings, views, stored procs, reports, ETL, indexes, constraints |
| **Business rule / calculation** | Every entry point computing the same thing (use `feature-map` divergences), historical data already computed under the old rule |
| **Auth policy / permission** | Every endpoint referencing the policy, UI permission gates, tests asserting 401/403 |
| **Config / feature flag** | Every read site, all environments, default-value behaviour when the key is absent |
| **Dependency version** | Delegate to `/dependency-upgrade-guard` — that skill already owns this |

If the change spans several types (renaming an entity property usually spans
four), run every applicable row.

**Step 2 — Direct references: what the compiler will catch.**

Grep for the symbol and every realistic spelling of it. For a rename, search the
old name; for a type change, search the assignment and usage sites.

```bash
grep -rn "SymbolName" --include=*.cs --include=*.ts --include=*.tsx
grep -rn "IInterfaceName" --include=*.cs          # implementors
grep -rn ": BaseClassName" --include=*.cs         # subclasses
```

List these, but keep the section short and label it plainly: **the build will
find these for you.** They are inventory, not risk.

**Step 3 — Indirect references: what the compiler will NOT catch.**

This is the section the whole skill exists for. Search each of these explicitly:

**String-literal SQL** — column and table names inside `FromSqlRaw`,
`ExecuteSqlRaw`, Dapper `Query<T>("...")`, `.sql` files, views, stored procedures,
migration `Sql("...")` calls:

```bash
grep -rn "ColumnName" --include=*.cs --include=*.sql
```

**Serialisation names** — `[JsonPropertyName]`, `[Column]`, `[Display]`,
`[FromQuery(Name=)]`, AutoMapper profiles, and any JSON path the frontend reads
by string. A renamed C# property with an unchanged wire name is safe; the reverse
is a silent break.

**Frontend consumption** — TypeScript types mirroring the DTO, and, more
dangerously, any place the response is read untyped (`data.someField`,
`res.data[0]`, `any`). Generated API clients are stale until regenerated.

**Reflection and convention-based wiring** — DI registered by naming convention,
`nameof()` in validators or policy names, `Type.GetType`, dynamic dispatch,
source generators, anything switching on a type name string.

**Cached and persisted shapes** — Redis / distributed-cache entries holding the
serialised old shape, outbox rows not yet processed, queued messages in flight,
`localStorage` on clients that have not refreshed. A deploy does not invalidate
these; a schema change makes them poison.

**Data already written under the old rule** — for a calculation change, rows
computed under the previous formula. Ask explicitly whether historical data needs
backfilling; this question is missed almost every time and is usually the
expensive part.

**Configuration** — every environment, and the behaviour when the key is absent
(the default is the production behaviour on the box where someone forgot).

**Step 4 — Feature-level impact.**

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/feature-map.mjs query --file  <changed-file>
node ${CLAUDE_PLUGIN_ROOT}/tools/feature-map.mjs query --table <changed-table>
```

Report which *business capabilities* are affected, not just which files. "This
touches `Policies.BasePremium`, which three traced features read: premium
calculation, renewal quoting, and the broker commission export" is a sentence a
product owner can act on. "47 files reference this" is not.

Flag any feature the change touches that has **never been traced** — that is
unknown territory, and its absence from the map is not evidence of safety.

**Step 5 — Tests.**

Which tests cover the change site, which will legitimately go red, and — most
importantly — **which paths have no test at all**. An untested path in the blast
radius is where the regression will land. Cite the test files by name so the user
can run exactly those first.

**Step 6 — Rank, and be explicit about confidence.**

Every finding gets a severity and a detection point:

| Severity | Meaning |
|---|---|
| **Critical** | Breaks silently in production — no build error, no test failure |
| **High** | Breaks at runtime, in a path a test may or may not cover |
| **Medium** | Breaks the build or an existing test — annoying, self-announcing |
| **Low** | Cosmetic, or needs a follow-up but nothing breaks |

Then state coverage honestly. Static analysis cannot see reflection, dynamic SQL
built at runtime, external consumers outside this repo, or a partner integration.
Say which of those apply here rather than implying the list is exhaustive.

**Step 7 — Propose the safe sequence.**

Where the change is genuinely risky, give the ordered path: expand-then-contract
for a rename (add new, dual-write, migrate readers, drop old), a versioned
endpoint rather than a breaking edit, a feature flag with a documented rollback,
cache-key change instead of cache invalidation. Two or three concrete steps —
this is not the place to write the plan, that is `/speckit-plan`.

---

## Example Invocation

**Command:** `/impact-analysis "rename Broker.CommissionRate to Broker.BaseCommissionRate"`

Agent classifies it as an entity-property rename, finds 14 compile-time
references (medium — the build catches them), then finds the three that matter:
a Dapper query in the monthly settlement report using the literal string
`CommissionRate`, a `[JsonPropertyName("commissionRate")]` the React client reads
untyped, and a Redis cache holding the serialised old shape with a 24-hour TTL.
All three are Critical, none produce a build error. It recommends expand-then-
contract with a cache-key bump, and names the two test files to run first.

---

## Output

```
## Impact analysis: <proposed change>

**Change type:** <classification>
**Analysis mode:** feature-map (n features indexed) | grep-only (map empty)
**Blast radius:** <n> files, <n> traced features, <n> tables
**Stale traces in scope:** <ids, or "none">

### Verdict
<2-3 sentences: is this a contained change or a load-bearing one, and why>

### CRITICAL - breaks silently, no build error
| # | What | Where (file:line) | Why it fails silently | Mitigation |

### HIGH - breaks at runtime
| # | What | Where | Trigger | Mitigation |

### MEDIUM - the build or a test will catch it
| # | What | Where |
(inventory - list, do not belabour)

### Business capabilities affected
| Feature | Traced? | How it is affected |

### Data already written under the old behaviour
<backfill needed? how many rows? who decides? - or "n/a">

### Test coverage
| Path in blast radius | Covered by | Gap? |

### Recommended sequence
1. ...

### What this analysis could NOT see
<reflection, runtime-built SQL, consumers outside this repo, partner
integrations, untraced features - be specific, not boilerplate>
```

