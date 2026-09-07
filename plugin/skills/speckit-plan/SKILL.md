---
name: speckit-plan
description: "Runs the speckit-plan workflow. Invoked as /speckit-plan."
---

<!-- GENERATED from the cursor-platform source skill "speckit-plan".
     Do not edit here - edit the source and re-run the plugin build. -->

# Skill: speckit-plan

**Invocation:** `/speckit-plan`

---

## Overview

**Memory references:** `memory-bank/technologyStack.md, memory-bank/architecture.md`

`speckit-plan` converts the constitution into an ordered, dependency-aware task
board where every task has a layer, a size estimate, and a dependency list.
Before writing a single task, it presents 2-3 named plan variants with a
trade-off matrix and waits for the user to select one — this is mandatory per
`${CLAUDE_PLUGIN_ROOT}/rules/05-planning-rigor.mdc`. The resulting task board drives both
`speckit-implement` (one task at a time) and `speckit-tasks` (which syncs the
board into `memory-bank/progress.md`). Two decisions are elicited, not assumed:
the plan *variant* (scope and thoroughness, Step 2) and the *slicing strategy*
(the order work lands in, Step 2b). Within a horizontal slice, layer ordering is
strictly enforced: Domain before Application before Infrastructure before API
before React.

---

## Steps

**Step 1 — Load context.**

Read:
- `specs/constitutions/[feature-slug]-constitution.md`
- `memory-bank/techContext.md` (framework, test setup)
- `memory-bank/progress.md` (existing in-flight tasks, available bandwidth)

**Step 2 — Present plan variants (mandatory).**

Generate exactly 2-3 named variants before writing any task. Never skip this step.

```markdown
## Plan Variants — [Feature Name]

### Plan A — Minimal / Fast
[What is included: core happy path only, no edge cases, basic error handling]
[What is excluded: observability, advanced validation, E2E tests]

| Metric | Rating |
|--------|--------|
| Delivery speed | ⚡⚡⚡ Fast (est. X days) |
| Test coverage | 🧪 Unit tests only |
| Production readiness | ⚠ Needs follow-up |
| Risk | 🔴 Medium (missing edge case handling) |

### Plan B — Balanced ✅ Recommended
[Core feature + proper validation + unit and integration tests + error states]

| Metric | Rating |
|--------|--------|
| Delivery speed | ⚡⚡ Medium (est. X days) |
| Test coverage | 🧪🧪 Unit + integration |
| Production readiness | ✅ Good |
| Risk | 🟡 Low |

### Plan C — Full Robustness
[Everything in B + E2E tests + observability + performance benchmark + ADR]

| Metric | Rating |
|--------|--------|
| Delivery speed | ⚡ Slower (est. X days) |
| Test coverage | 🧪🧪🧪 Full stack |
| Production readiness | ✅✅ Excellent |
| Risk | 🟢 Minimal |

**Recommended: Plan B** — [one-sentence reasoning]

Please select a plan (A / B / C) or describe a hybrid. I will write the task
board once you confirm.
```

**Step 2b — Present slicing strategies (mandatory, separate from the variant).**

Step 2 chose *how much* to build. This step chooses *what order it lands in* —
an independent decision, and the one that determines when the feature first
becomes demoable and where integration risk sits. `${CLAUDE_PLUGIN_ROOT}/rules/05-planning-rigor.mdc`
requires options with tradeoffs here too; do not default silently.

```markdown
## Slicing Strategy — [Feature Name]

| Strategy | Shape | First demoable | Integration risk | Best when |
|---|---|---|---|---|
| **Vertical** | Thinnest end-to-end path first (one field, one rule, one screen), then widen | After slice 1 | Spread across every slice | Requirements may still move; you want feedback early; the integration is the unknown |
| **Horizontal** | Layer by layer: Domain → Application → Infrastructure → API → React | Only at the end | **All of it, at the end** | The domain model is the unknown; layers are owned by different people; the shape is well understood |
| **Risk-first** | Hardest unknown first, even if it demos nothing | Late | Front-loaded on purpose | An unproven integration, a performance target, or a spike that could invalidate the design |

**Recommended: [strategy]** — [one-sentence reasoning]
```

Recommend **vertical** by default for anything user-visible: horizontal means
nothing works until the last task, and every integration surprise arrives at once
on the day you can least afford it. Recommend **horizontal** when the layers are
genuinely independent or separately owned. Recommend **risk-first** when one
unknown could invalidate the whole plan.

For refactors and migrations, offer a fourth: **expand → migrate → contract**
(add the new alongside the old, move readers across, delete the old). Slower, but
every intermediate state is deployable — which is what you want when the
alternative is a big-bang cutover.

Wait for the selection before writing any task.

**Step 3 — Write the task board for the selected variant and slicing.**

If **vertical** or **risk-first** was chosen, group tasks by slice first and apply
layer ordering *within* each slice. If **horizontal** was chosen, the whole board
is one slice and the layer ordering below applies globally.

Layer ordering rules (never violate **within a slice**):
1. Domain tasks (no deps outside Domain)
2. Application tasks (depend on Domain tasks)
3. Infrastructure tasks (depend on Application tasks)
4. API tasks (depend on Application tasks, not Infrastructure directly)
5. React API-layer tasks (depend on API tasks being specced)
6. React UI component tasks (depend on React API-layer tasks)
7. Test tasks last (depend on the code they test)

Task format:
```
| ID       | Layer         | Description                              | Size | Depends On     |
|----------|---------------|------------------------------------------|------|----------------|
| TASK-001 | Domain        | Create [Entity] aggregate + value objects | S   | —              |
| TASK-002 | Domain        | Define domain events                      | S   | TASK-001       |
| TASK-003 | Application   | [Command]Command + handler               | M    | TASK-001       |
| TASK-004 | Application   | [Command]Validator                       | S    | TASK-003       |
| TASK-005 | Application   | [Query]Query + handler                   | M    | TASK-001       |
| TASK-006 | Infrastructure| [Entity]Repository implementation        | M    | TASK-003       |
| TASK-007 | Infrastructure| EF Core migration                        | S    | TASK-006       |
| TASK-008 | API           | [POST /resource] endpoint                | S    | TASK-003       |
| TASK-009 | API           | [GET /resource] endpoint                 | S    | TASK-005       |
| TASK-010 | React/API     | API types + fetcher function             | S    | TASK-008       |
| TASK-011 | React/API     | useCreateX mutation hook                 | S    | TASK-010       |
| TASK-012 | React/UI      | [Form] component                         | M    | TASK-011       |
| TASK-013 | React/UI      | [List] component                         | M    | TASK-011       |
| TASK-014 | Tests         | Unit tests — Domain entities             | S    | TASK-001       |
| TASK-015 | Tests         | Unit tests — Command handler             | M    | TASK-003       |
| TASK-016 | Tests         | Integration tests — API endpoints        | M    | TASK-008       |
| TASK-017 | Tests         | RTL tests — Form component               | M    | TASK-012       |
| TASK-018 | Tests         | E2E — critical user flow (Plan C only)   | L    | TASK-013       |
```

Size definitions:
- S = < 2 hours
- M = 2–4 hours
- L = 4–8 hours
- XL = > 8 hours — **not a size, a signal that the task is not decomposed yet**

**Hours are not the binding constraint.** A task also has to fit in one agent
session, and that ceiling is about *surface area*, not duration:

- **≤ 8 files** — above this an agent session fails partway and leaves a
  half-applied change, which is worse than not starting
- **≤ 2 layers** — three or more means you have written a slice, not a task
- **one verify command** — "done" has to be checkable by a machine

These are enforced, not advised. Step 4b runs the validator.

**Tests are never optional.** Every plan variant includes at least unit + integration
tests. E2E is included in Plan C and optional in Plan B.

**Step 4 — Save plan document.**

Include the rejected variants and the rejected slicing strategies, each with a
one-sentence explanation of why they were not chosen — this context is valuable
during retros, and it is the part people forget by the time the retro happens.

**Step 4b — Validate the board before presenting it (mandatory).**

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/task-graph.mjs validate specs/plans/[feature-slug]-plan.md
node ${CLAUDE_PLUGIN_ROOT}/tools/task-graph.mjs graph    specs/plans/[feature-slug]-plan.md
```

`validate` rejects oversized and multi-layer tasks, dependency cycles, duplicate
or unknown ids, and tasks with no verify command. **A board the project's own
tooling rejects is not a plan** — fix it and re-run before showing the user
anything.

For a task it rejects as oversized:

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/task-graph.mjs split specs/plans/[feature-slug]-plan.md TASK-004
```

`graph` reports the parallel batches and the critical path. Report the critical
path alongside the point total: the total is how much work there is, the critical
path is the floor on elapsed time however many people or agents work on it.

For the validator to read the board, the table needs `Files` and `Verify`
columns:

```
| ID | Task | Slice | Layer | Size | Files | Depends | Verify |
```

If you are decomposing something that is **not** going through the speckit
pipeline — a bug, a refactor, a migration, or a change to an existing traced
feature — use `/work-breakdown` instead. It takes any source and produces the
same validated board format.

---

## Example Invocation

**Scenario:** User is planning `broker-client-csv-export`. User selected Plan B.

Agent writes a 16-task board covering Domain → Application → Infrastructure →
API → React/API → React/UI → Tests. The plan file includes:
```markdown
## Rejected Variants
- Plan A: Rejected — no integration tests, too risky for a PII-exporting endpoint
- Plan C: Deferred — E2E setup adds 1.5 days; team agreed to add it in a follow-up
```

---

## Output

- Terminal: plan variants table (Step 2), blocking until user selects
- Terminal: slicing strategy table (Step 2b), blocking until user selects
- File: `specs/plans/[feature-slug]-plan.md` (written after both selections)
  - Includes: selected task board, rejected variants and slicing strategies with
    reasoning, total point estimate
- Terminal: `task-graph` validation result + parallel batches + critical path
  (Step 4b). Never present a board that failed validation.

