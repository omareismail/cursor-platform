# Skill: speckit-tasks

**Invocation:** `/speckit-tasks`

---

## Overview

`speckit-tasks` syncs the plan document's task table into `memory-bank/progress.md`
as a live kanban-style board. It converts raw plan rows into a structured task
board that `speckit-implement` reads to find the next task, that `speckit-checklist`
reads to validate task completion, and that the team reads to see overall feature
progress. It also calculates a total point estimate using the sizing definitions
(S=1, M=3, L=8) and detects project type to use layer names appropriate to the
stack (.NET layers vs React layers vs both).

---

## Steps

**Step 1 — Read inputs.**

- `specs/plans/[feature-slug]-plan.md` — task table from the selected plan variant
- `memory-bank/progress.md` — existing content to append to (never overwrite other features)
- `memory-bank/techContext.md` — project type for layer labels

**Step 2 — Calculate estimates.**

| Size | Points | Approx time |
|------|--------|-------------|
| S | 1 | < 2 hours |
| M | 3 | 2–4 hours |
| L | 8 | 4–8 hours |

Total points = sum of all task sizes.
Working days estimate = total points / 8 (assuming 8 points per developer day).

**Step 3 — Write the task board into progress.md.**

Append (never overwrite) the new feature board to the end of `memory-bank/progress.md`.

Board format:

```markdown
---
## [Feature Name] — Task Board
**Feature slug:** [feature-slug]
**Spec:** specs/features/[feature-slug].md
**Plan variant:** [A / B / C / hybrid description]
**Total points:** [N] ([M]d estimated at 8pts/day)
**Started:** [YYYY-MM-DD]
**Status:** 🟡 In Progress

### ⬜ Not Started
- [ ] TASK-001 | Domain | S | Create [Entity] aggregate + value objects
- [ ] TASK-002 | Domain | S | Define [EventName] domain event
- [ ] TASK-003 | Application | M | [Command]Command + Handler
- [ ] TASK-004 | Application | S | [Command]Validator
- [ ] TASK-005 | Application | M | [Query]Query + Handler
- [ ] TASK-006 | Infrastructure | M | [Entity]Repository implementation
- [ ] TASK-007 | Infrastructure | S | EF Core migration
- [ ] TASK-008 | API | S | POST /api/v1/[resource] endpoint
- [ ] TASK-009 | API | S | GET /api/v1/[resource]/{id} endpoint
- [ ] TASK-010 | React/API | S | API types + [resource] fetcher
- [ ] TASK-011 | React/API | S | use[Create] mutation hook
- [ ] TASK-012 | React/UI | M | [Form] component
- [ ] TASK-013 | React/UI | M | [List] component
- [ ] TASK-014 | Tests | S | Unit tests — Domain entities
- [ ] TASK-015 | Tests | M | Unit tests — [Command]Handler
- [ ] TASK-016 | Tests | M | Integration tests — API endpoints
- [ ] TASK-017 | Tests | M | RTL tests — [Form] component

### 🔄 In Progress
(empty — tasks move here when /speckit-implement is called)

### ✅ Done
(empty — tasks move here when marked complete)

### 🚫 Blocked
(empty — tasks move here when a blocker is discovered)
---
```

**Step 4 — Output summary.**

```
✅ Task board written to memory-bank/progress.md
Feature: [Feature Name]
Tasks: [N] total | [Npt] points | ~[Nd] working days
Next step: Run /speckit-git-feature [feature-slug] to create the branch,
           then /speckit-implement TASK-001 to begin.
```

---

## Blocked Task Format

When a blocker is encountered during implementation, tasks move to the Blocked
section with this format:

```markdown
### 🚫 Blocked
- [ ] TASK-006 | Infrastructure | M | [Entity]Repository implementation
  **Blocked by:** External team has not yet merged the shared DbContext migration
  **Blocked since:** [YYYY-MM-DD]
  **Impact:** TASK-007, TASK-008 also blocked (depend on TASK-006)
  **Resolution path:** Monitor PR #47; ping @dbteam if not merged by [date]
```

---

## Example Invocation

**Scenario:** `speckit-plan` has produced `specs/plans/broker-client-csv-export-plan.md`
with 17 tasks (Plan B — Balanced). User runs `/speckit-tasks`.

Agent reads the 17 tasks, calculates total points (1+1+3+1+3+3+1+1+1+1+1+3+3+1+3+3+3 = 30 pts),
estimates ~3.75 working days, and appends the board to `memory-bank/progress.md`.

Output:
```
✅ Task board written to memory-bank/progress.md
Feature: Broker Client CSV Export
Tasks: 17 total | 30 points | ~3.75 working days
Next step: Run /speckit-git-feature broker-client-csv-export, then /speckit-implement TASK-001
```

---

## Output

- File: `memory-bank/progress.md` (appended with new feature task board)
- Terminal: summary with task count, point total, days estimate, and next step suggestion
