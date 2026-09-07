# Skill: work-breakdown

**Invocation:** `/work-breakdown [source] [--slice vertical|horizontal|risk-first]`
Example: `/work-breakdown specs/features/refunds.md` · `/work-breakdown premium-calculation` · `/work-breakdown "migrate reporting from Oracle to Postgres"` · `/work-breakdown --split T-04`

---

## Overview

**Memory references:** `.cursor/cache/feature-map.json` (from `feature-trace`),
`.cursor/cache/repo-map.json` (from `repo-discovery`, Step 0 freshness applies),
`memory-bank/architecture.md`, `memory-bank/systemPatterns.md`,
`memory-bank/testingStandards.md`, `memory-bank/progress.md`, `memory-bank/techDebt.md`

`work-breakdown` turns **any** unit of work into a validated board of tasks small
enough that one agent session can actually finish each one.

Two things make it different from `speckit-plan`, which is the existing
decomposition step:

1. **It accepts any starting point.** `speckit-plan` decomposes a constitution
   produced by the speckit pipeline. Most real work never enters that pipeline —
   a bug, a refactor, a migration, a change to a feature you just traced. Those
   currently have no route to a task board without fabricating a spec first.
2. **Task size is enforced, not estimated.** S/M/L points say how long work takes.
   They say nothing about whether an agent can hold the task in one context
   window. A task touching 25 files does not take longer — it *fails*, partway,
   leaving a half-applied change and a poisoned context. The board is validated
   by `.cursor/tools/task-graph.mjs`, which rejects that outright.

Use `speckit-plan` when the work is a new feature going through the full spec
pipeline. Use `work-breakdown` for everything else, or to re-cut a board that
`task-graph validate` has rejected.

---

## Steps

**Step 0 — Resolve the source of work.**

| Argument | Read | Notes |
|---|---|---|
| `specs/**.md` | Acceptance criteria, API contract, UI behaviour | Each AC becomes at least one task |
| A feature id | `feature-map.mjs show <id>` | Existing feature — the trace already lists the files and layers |
| An `/impact-analysis` result | Its blast-radius table | Each Critical/High finding becomes a task |
| A bug description | Reproduce path, then trace it | Add a regression-test task *before* the fix task |
| A refactor / migration | `/enterprise-report-gen refactor`, `/technical-debt-tracker`, `/database-audit` output | Sequencing matters more than sizing here |
| Plain prose | Nothing yet | **Ask for the acceptance criteria first.** Prose is not decomposable — you will invent scope. |

If the work touches code that already exists and there is **no fresh trace**, run
`/feature-trace` first. Decomposing a change to code you have not read produces a
board that looks reasonable and is wrong about which files each task touches —
which is exactly the input the size limits depend on.

**Step 1 — Present slicing strategies. Mandatory, and do not skip it.**

`.cursor/rules/05-planning-rigor.mdc` requires options with tradeoffs before any
plan. Slicing strategy is the highest-leverage decision in a breakdown, so it gets
the elicitation rather than a default:

| Strategy | Shape | Ships value | Integration risk | Best when |
|---|---|---|---|---|
| **Vertical** | Thinnest end-to-end path first (one field, one rule, one screen), then widen | After the first slice | Spread across every slice | Requirements may change; you want a demo early; the integration is the unknown |
| **Horizontal** | Layer by layer — all Domain, then Application, then Infrastructure, then API, then React | Only at the end | **All of it, at the end** | The domain model is the unknown; layers are owned by different people; the shape is genuinely well understood |
| **Risk-first** | Hardest unknown first, even if it demos nothing | Late | Front-loaded on purpose | A spike, an unproven integration, or a performance target that could invalidate the whole design |

State a recommendation with a reason, then wait. Default to **vertical** unless
the work is a pure refactor with no user-visible surface — but say why, and let
the user overrule it.

For refactors and migrations there is a fourth shape worth naming:
**expand → migrate → contract** (add the new alongside the old, move readers
across, delete the old). Slower, but every intermediate state is deployable.
Recommend it whenever the change would otherwise require a big-bang cutover.

**Step 2 — Cut the tasks.**

Every task must satisfy all of these. These are the tool's limits, so failing one
is not a style opinion:

- **≤ 8 files.** Above that no agent session reliably finishes.
- **≤ 2 layers.** Three or more means you cut a slice, not a task.
- **≤ 8 points** (S=1, M=3, L=8). An L is the ceiling; there is no XL.
- **Independently verifiable.** One command proves it done.
- **Leaves the build green.** Never split so that main is broken between tasks.
- **Named as an outcome**, not an activity. "Persist tier on Policy", not "work
  on the repository".

Two failure modes to avoid deliberately:

- **Fake small.** Ten tasks that only compile together are one task with extra
  ceremony. If two pieces cannot be verified separately, they are one task and
  the size is real — say so rather than renumbering it.
- **Missing the boring ones.** Migrations, feature flags, config keys, seed data,
  API-client regeneration, translation strings, permission entries and rollback
  steps are tasks. They are the ones that get discovered on deploy day.

Where the source is an existing feature, take the file manifest from the trace
rather than guessing — that is the whole reason `feature-map.json` records it.

**Step 3 — Order by real dependencies only.**

A dependency means *this task cannot start until that one is merged*. Not "it
feels tidier in this order". Over-specified dependencies are the most common
defect in a task board: they serialise work that could run in parallel, and
`task-graph graph` will show it — if every batch has one task, the dependencies
are almost certainly wrong.

Test coverage, telemetry and docs tasks usually depend on the code task and
nothing else. Say so, and they parallelise.

**Step 4 — Write the board, in the exact format the validator reads.**

```markdown
| ID | Task | Slice | Layer | Size | Files | Depends | Verify |
|---|---|---|---|---|---|---|---|
| T-01 | Add PremiumTier value object | tier-pricing | domain | S | src/Co.Domain/Pricing/PremiumTier.cs; tests/Co.UnitTests/PremiumTierTests.cs | - | dotnet test --filter PremiumTier |
| T-02 | Tier lookup in calculator | tier-pricing | domain | M | src/Co.Domain/Pricing/PremiumCalculator.cs | T-01 | dotnet test --filter PremiumCalculator |
```

- **Files** — real paths, semicolon-separated. Paths that will be *created* count
  too. This column is what makes the size limit checkable; a bare count is
  accepted but much less useful to the agent that executes the task.
- **Verify** — a command, not a sentence. `dotnet test --filter X`,
  `npx vitest run Y`, `dotnet ef migrations script --idempotent`. If a task
  genuinely cannot be verified by a command, that is a finding: it means there is
  no test for this behaviour, and adding one is a prerequisite task.
- **Depends** — task ids, or `-`.

Write to `specs/plans/<slug>-tasks.md`, or append to an existing plan document.

**Step 5 — Validate. Do not present an unvalidated board.**

```bash
node .cursor/tools/task-graph.mjs validate specs/plans/<slug>-tasks.md
node .cursor/tools/task-graph.mjs graph    specs/plans/<slug>-tasks.md
```

`validate` catches oversized tasks, multi-layer tasks, dependency cycles, unknown
and duplicate ids, and missing verify commands. **If it fails, fix the board and
re-run before showing anything to the user** — a board that the project's own
tooling rejects is not a plan.

For any task it rejects as oversized:

```bash
node .cursor/tools/task-graph.mjs split specs/plans/<slug>-tasks.md T-04
```

`graph` gives the parallel batches and the critical path. Report both: the
critical path is the floor on elapsed time no matter how many agents you run, and
it is usually the number the user actually wants.

**Step 6 — Hand off.**

- Sync to the kanban board → `/speckit-tasks`
- Create GitHub issues → `/speckit-taskstoissues`
- Execute one task → `/speckit-implement T-01`
- Full spec pipeline instead → `/speckit-analyze`

`--split T-04` mode re-cuts a single oversized task in an existing board and
rewrites just those rows, leaving the rest untouched (rule 09).

---

## Example Invocation

**Command:** `/work-breakdown premium-calculation --slice vertical`

Agent loads the cached `premium-calculation` trace, sees it spans 4 layers and 3
entry points, and presents the three slicing options with a recommendation for
vertical. The user picks it. The agent cuts 11 tasks — including the two nobody
asks for, a migration and a feature flag — validates, and finds T-04 touches 11
files. It runs `split`, breaks T-04 into three per-layer tasks, revalidates
clean, and reports: 14 tasks, 26 points sequential, 9-point critical path, max 4
in parallel.

---

## Output

- **File:** `specs/plans/<slug>-tasks.md` — the task board table
- **Console:**

```
## Work breakdown: <source>

**Slicing:** vertical | horizontal | risk-first | expand-migrate-contract  (chosen at Step 1)
**Tasks:** <n>   **Total:** <n> pts   **Critical path:** <n> pts   **Max parallel:** <n>
**Validation:** PASS | FAILED (n errors)

### Slice order
<the vertical slices or layer phases, in the order they land>

### Task board
<the table>

### Parallel batches
<from `task-graph graph` - what can run at once>

### Critical path
T-01 -> T-02 -> T-04 -> T-05   (<n> pts - the floor on elapsed time)

### Tasks that were split
| Original | Why it failed | Became |

### Easy to forget - included on purpose
<migrations, flags, config, seed data, client regeneration, i18n strings,
permissions, rollback - or say explicitly that none apply>

### Not decomposed
<anything that needs a human decision before it can be cut, and what the
question is>
```
