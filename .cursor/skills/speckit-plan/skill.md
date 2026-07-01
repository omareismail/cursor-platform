# Skill: speckit-plan

**Invocation:** `/speckit-plan`

---

## Overview

**Memory references:** `memory-bank/technologyStack.md, memory-bank/architecture.md`

`speckit-plan` converts the constitution into an ordered, dependency-aware task
board where every task has a layer, a size estimate, and a dependency list.
Before writing a single task, it presents 2-3 named plan variants with a
trade-off matrix and waits for the user to select one — this is mandatory per
`.cursor/rules/05-planning-rigor.mdc`. The resulting task board drives both
`speckit-implement` (one task at a time) and `speckit-tasks` (which syncs the
board into `memory-bank/progress.md`). Layer ordering is strictly enforced:
Domain before Application before Infrastructure before API before React.

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

**Step 3 — Write the task board for the selected variant.**

Layer ordering rules (never violate):
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
- XL = > 8 hours (flag for splitting)

**Tests are never optional.** Every plan variant includes at least unit + integration
tests. E2E is included in Plan C and optional in Plan B.

**Step 4 — Save plan document.**

Include the rejected variants and a one-sentence explanation of why they were
not chosen — this context is valuable during retros.

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
- File: `specs/plans/[feature-slug]-plan.md` (written after user selects variant)
  - Includes: selected task board, rejected variants with reasoning, total point estimate
