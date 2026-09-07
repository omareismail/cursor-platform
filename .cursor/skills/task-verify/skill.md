# Skill: task-verify

**Invocation:** `/task-verify [T-01|spec-file|--suite] [--mutate]`
Example: `/task-verify T-04` · `/task-verify specs/features/refunds.md` · `/task-verify --suite` · `/task-verify T-04 --mutate`

---

## Overview

**Memory references:** `memory-bank/testingStandards.md`,
`memory-bank/businessRules.md`, `memory-bank/progress.md`,
`.cursor/cache/feature-map.json`, `specs/**`

`task-verify` decides whether a task is **actually done**, from evidence, and
refuses to let it be marked Done otherwise. It closes a loop the platform left
open in three places:

1. **`task-graph` requires a `Verify` command on every task but never runs it.**
   "Done" has been a claim, not a fact.
2. **`dotnet-test-gen` and `react-test-gen` emit `// AC-N:` traceability
   comments, and nothing ever read them back.** Nothing caught an acceptance
   criterion with no test, or a test claiming an AC the spec no longer has.
3. **Passing tests are weak evidence when the same process wrote the code and
   the tests.** They prove the two agree, not that either is right.

That third point is the one that matters most here. The 2026 research is
consistent about it: *"tests that run a function but never check its output
contribute to coverage while verifying nothing"*, and 43% of AI-generated
changes still needed manual debugging in production **after passing QA and
staging**. Verification, not generation, is the bottleneck — so verification has
to be something stronger than "the suite went green".

**Blocking by design.** A task cannot move to Done without a recorded passing
run and covered acceptance criteria. Consistent with how task sizing already
works: a gate that never blocks is a form, not a control.

---

## Steps

**Step 0 — Resolve scope and load the contract.**

| Argument | Scope |
|---|---|
| A task id (`T-04`) | That task's row in the plan board — its `Files` and `Verify` columns |
| A spec file | Every AC in the spec, and every test claiming one |
| `--suite` | The whole repo — a test-quality sweep, not a task gate |
| Nothing | The task the board says is In Progress |

```bash
node .cursor/tools/task-graph.mjs next specs/plans/<slug>-tasks.md
node .cursor/tools/ac-trace.mjs matrix specs/features/<slug>.md
```

If the task has no `Verify` command, stop. That is a defect in the board, not a
reason to skip verification — `task-graph validate` should already have rejected
it. Fix the board first.

**Step 1 — Run the verify command. Record the result verbatim.**

```bash
# exactly the command in the task's Verify column
dotnet test --filter PremiumCalculator
```

Capture exit code, pass/fail counts, and duration. Do not paraphrase a failure
into "mostly passing". If the command errors before running anything — a build
break, a missing fixture — that is a **fail**, not an inconclusive.

Two failure modes to name explicitly if you see them:

- **The command passes but ran nothing.** `--filter` matching zero tests exits 0.
  A verify command that selects no tests is worse than a missing one, because it
  looks green. Check the test count, not just the exit code.
- **The command was changed to make it pass.** If the `Verify` column differs
  from what the board originally specified, say so.

**Step 2 — Check acceptance-criteria coverage.**

```bash
node .cursor/tools/ac-trace.mjs check specs/features/<slug>.md
```

The tool fails on: an AC no test claims; a test claiming an AC the spec does not
define; an AC whose only test is skipped; a claiming test with no assertion; and
assertions that cannot fail (`Assert.True(true)`, `NotBeNull()` alone,
`toBeDefined()` alone, asserting the mock rather than the behaviour).

**An AC with no test that can fail is not implemented.** It is untested code that
happens to compile. Report it that way — do not soften it to "partially covered".

Where the tool reports an orphan claim, decide which side is wrong: the spec
changed and the test was not updated, or the test is claiming coverage it does
not have. Both are findings; say which.

**Step 3 — Read the tests. This is the part a tool cannot do.**

`ac-trace` catches assertions that are structurally incapable of failing. It
cannot catch a test that asserts the *wrong thing* confidently. Read every test
claiming an AC in scope and check:

| Failure mode | What it looks like | Why it matters |
|---|---|---|
| **Asserts the implementation, not the behaviour** | `result.Should().Be(_calculator.Calculate(x))` — comparing the code to itself | Passes for any implementation, including a wrong one |
| **Tests the mock** | Arranges a substitute to return 42, asserts the result is 42 | Verifies the mocking framework works |
| **Same misunderstanding as the code** | Test asserts 10,000 is *not* included when the spec says "10,000 and above" | Both written from the same wrong reading. The most dangerous case, and invisible to every tool. |
| **Happy path only** | One test per AC, no boundary, no error case | The bugs live at the boundary |
| **Over-mocked** | Every collaborator mocked, so nothing real is exercised | Green suite, broken integration |
| **Asserts on a shape, not a value** | `Should().BeOfType<Result>()` | The type is guaranteed by the compiler |

For each AC, ask the question the tool cannot: **if the implementation were
wrong in the most plausible way, would this test fail?** If the honest answer is
no, the AC is not covered, whatever the matrix says.

Cross-check the test's expected values against `memory-bank/businessRules.md` and
the spec text — **not** against the implementation. Reading the implementation
first is how you end up confirming its assumptions.

**Step 4 — Boundary and negative coverage.**

Per AC, confirm there is a test for:

- the boundary itself (10,000 exactly, not just 9,999 and 10,001)
- the error/rejection path, not just success
- the empty, null, and maximum cases where they are meaningful
- the concurrent case where two requests could race a check-then-write

Missing boundary coverage on a threshold in a financial rule is a **blocker**,
not a nice-to-have. Off-by-one on a money threshold is the single most common
real drift found by `/spec-drift-audit`.

**Step 5 — Mutation testing, scoped to what changed (`--mutate`).**

Static analysis proves a test *can* fail. Mutation testing proves it *would*.

```bash
# .NET — only the files this task touched
dotnet stryker --mutate "src/Co.Domain/Pricing/PremiumCalculator.cs"
# TypeScript
npx stryker run --mutate "src/features/quotes/**/*.ts"
```

Mutation score = killed mutants ÷ (killed + survived). Config lives in
`templates/mutation/`. Read the **survivors**, not the score: each survivor is a
change to your code that no test noticed, named precisely. That list is worth
more than any coverage percentage.

Scope it to changed files. A full-repo run takes hours and gets disabled; a
task-scoped run takes minutes and gets used.

Treat mutation testing as escalation, not routine: run it on money, auth, and
anything a `/threat-model` rated Critical. Elsewhere, Steps 1–4 are proportionate.

**Step 6 — Verdict, and record the evidence.**

```
DONE          verify passed, every AC covered by a test that would catch a
              plausible wrong implementation
NOT DONE      any AC uncovered, skipped-only, vacuous, or weak; or verify failed
DONE WITH GAP verify passed and ACs covered, but a named boundary or negative
              case is missing — allowed only with an owner and a follow-up task
```

Only on **DONE** may `memory-bank/progress.md` move the task to Done, and the
entry records the evidence: the command, its result, the AC coverage, and the
date. A status change with no evidence behind it is the thing this skill exists
to prevent.

On **NOT DONE**, list exactly what would change the verdict — a specific test for
a specific AC, not "improve coverage".

---

## What this skill will not do

- **Weaken a test to make it pass.** If a test fails, the code is wrong or the
  test is wrong; deciding which is the work. Changing an assertion to match
  observed behaviour is how a suite stops being a suite.
- **Accept a coverage percentage as evidence.** Coverage is necessary and not
  sufficient — it measures lines executed, not behaviour verified.
- **Mark Done from a green CI badge alone.** The question is whether the tests
  would catch the bug, not whether they ran.

---

## Example Invocation

**Command:** `/task-verify T-04 --mutate`

Runs `dotnet test --filter PremiumCalculator` — 14 passed. `ac-trace` reports
AC-1 through AC-5 claimed, but AC-3's only test is `[Fact(Skip="flaky")]` and
AC-4's test asserts `Should().NotBeNull()` on a freshly constructed object.
Reading the tests, AC-1's test asserts the threshold at 10,001 while the spec
says "10,000 and above" — the test encodes the same off-by-one as the
implementation, so both are wrong together and nothing fails. Mutation testing
on `PremiumCalculator.cs` scores 61% with four survivors, including flipping
`>=` to `>` on the very threshold in question. **Verdict: NOT DONE**, with three
named tests to add.

---

## Output

```
## Task verification: <task-id | spec | suite>

**Verdict:** DONE | NOT DONE | DONE WITH GAP
**Verify command:** `<exact command>` → passed | FAILED (<n> tests, <duration>)
**AC coverage:** <n>/<n> genuinely covered
**Mutation score:** <n>% (<n> survivors) | not run

### Acceptance criteria
| AC | Criterion | Test | Would it catch a wrong implementation? |
|---|---|---|---|

### Blocking gaps
| # | AC | Problem | The specific test that would fix it |

### Test quality findings
| File:line | Problem | Why it proves nothing |

### Mutation survivors
| Mutation | File:line | What no test noticed |

### Boundary & negative coverage
| AC | Boundary tested? | Error path tested? | Concurrency? |

### Evidence recorded
<the exact line appended to memory-bank/progress.md — command, result, date>
```
