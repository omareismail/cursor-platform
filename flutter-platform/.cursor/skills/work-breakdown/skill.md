# Skill: work-breakdown

**Invocation:** `/work-breakdown [source]`

`[source]` — a feature description, a `feature-trace`/`impact-analysis`
result, a bug report, or a refactor description.

---

## Overview

`work-breakdown` decomposes a unit of work into a task board sized so each
task can be finished in one agent session. Task size is enforced, not
estimated: a task touching 20 files does not just take longer, it fails
partway and leaves a half-applied change behind. This platform does not
ship a separate `task-graph.mjs` validator (kept lean) — the sizing rules
below are enforced by the agent directly against the checklist in Step 3.

**Memory references:** `memory-bank/architecture.md`,
`memory-bank/progress.md` (don't recreate a task that's already Done).

**Guard rules:** `05-planning-rigor.mdc` (Rule 5 — slicing variants
required before the board is written).

---

## Steps

**Step 0 — Gather scope.** If `[source]` references an existing flow, run
`/feature-trace` and `/impact-analysis` first rather than guessing file
counts.

**Step 1 — Present slicing options (per `05-planning-rigor.mdc` Rule 5).**

```markdown
## Slicing Options — [Feature Name]

### Option A — Vertical (by screen)
One task per screen: model + provider + repository + widget + route + test
for that screen only. Each task is independently shippable/demoable.
Trade-off: More tasks, some cross-task duplication of a shared model | Each task is small and low-risk

### Option B — Horizontal (by layer)
One task per layer across the whole feature: all models, then all
repositories, then all providers, then all screens.
Trade-off: Less duplication | Nothing is demoable until the last task lands

### Option C — Risk-first
Task 1 tackles the riskiest/least-understood part (e.g. the payment
provider integration) before the routine CRUD screens.
Trade-off: Surfaces unknowns early | Less predictable task-to-task velocity

**Recommended: Option [X]** — [reasoning tied to memory-bank/architecture.md
or the trace/impact result].
```

Wait for the user to pick before writing the board.

**Step 2 — Write the task board** for the selected variant. Every task
includes: files touched (estimated), a Verify command, and dependencies on
other tasks.

**Step 3 — Enforce sizing on every task before presenting the board.**

| Check | Limit |
|---|---|
| Files touched | ≤ 8 |
| Layers touched (presentation / application / domain / data) | ≤ 2 |
| Has a Verify command (`flutter test <path>`, `flutter analyze`) | Required |
| Dependency cycles between tasks | None |

A task failing any check is split before the board is presented — never
present a board with an oversized task and a note to "split it later."

**Step 4 — Board format.**

```markdown
## Task Board — [Feature Name] (Option [X])

### T-01: Order model + repository
Files: order.dart, order.freezed.dart*, order.g.dart*, order_repository.dart,
api_order_repository.dart, order_repository_test.dart (6, ≤8 ✓)
Layers: domain, data (2, ≤2 ✓)
Verify: `flutter test test/features/orders/data/`
Depends on: none

### T-02: Order history screen
Files: order_history_provider.dart, order_history_screen.dart,
order_tile.dart, order_history_screen_test.dart (4, ≤8 ✓)
Layers: application, presentation (2, ≤2 ✓)
Verify: `flutter test test/features/orders/presentation/`
Depends on: T-01
```
(* generated files, not hand-written — still count toward the file-touch
estimate since they're produced by the task.)

**Step 5 — Note the critical path.** With independent tasks in the same
batch, they can run in parallel (e.g. one agent per task via an isolated
worktree); the critical path is the longest dependency chain and is the
floor on elapsed time regardless of parallelism.

---

## Example

Request: "Break down adding a wishlist feature."

Output: three slicing options per Step 1, the user picks Option A
(vertical), then a 3-4 task board (model+repo, provider, screen+route,
tests-and-l10n) each within the 8-file/2-layer limit with explicit Verify
commands.
