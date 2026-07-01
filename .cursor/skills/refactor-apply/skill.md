# Skill: refactor-apply

**Invocation:** `/refactor-apply [scope] [--tier=safe|should-fix|all]`
Default tier: `safe` (see Tier Definitions below). Default scope: same
resolution as `refactor-assistant` — `full`, or a project/service name
resolved via `repo-map.json`.

Examples:
`/refactor-apply Tamkeen.Payments` · `/refactor-apply src/Orders --tier=should-fix`

---

## Overview

**Memory references:** `memory-bank/codingStandards.md`,
`memory-bank/systemPatterns.md`, `memory-bank/commonMistakes.md`

`refactor-apply` is the execution counterpart to `dotnet-clean-code-guard`,
`react-clean-code-guard`, and `refactor-assistant`. Those three skills are
deliberately read-only — they produce findings, never patch code — because
detection and modification carry different risk profiles and mixing them
makes both harder to trust. This skill closes the loop: it takes their
findings and actually applies the subset that's safe to apply automatically,
while routing everything else to explicit per-item confirmation.

This skill does not re-implement detection logic. It never scans code
itself — it always starts from a fresh run of the relevant guard skill(s)
(or a `refactor-assistant` consolidated report) and works only from that
findings list. If a finding looks wrong, the fix belongs in the guard skill
that produced it, not here.

**Hard constraint:** every change this skill makes must independently
satisfy `09-minimal-changes.mdc` — touch only the lines the specific finding
requires, never reformat, reorder, or "improve while I'm in there." A
finding that requires touching more than its own reported location to fix
correctly is automatically Tier 2, not Tier 1, regardless of how trivial it
looks — see Step 2.

---

## Tier Definitions

### Tier 1 — Auto-apply (safe, no behavior change, single-location)

Applied automatically once approved for the batch — no per-item pause. A
finding qualifies for Tier 1 only if **all** of the following hold:

- The fix is confined to the single file:line the finding reports (no
  ripple to callers, interfaces, or other files)
- The fix does not change a method's public signature, return type, or
  externally observable behavior
- The fix does not cross a layer boundary or touch a `DbContext`/EF model
- The fix has exactly one unambiguous correct form (not "one of several
  reasonable approaches")

Concretely, from the existing guards' checklists, this covers:

| Finding type | Why it's Tier 1 |
|---|---|
| Non-async method missing `Async` suffix | Rename only, same file, no signature change to callers using it by interface |
| Magic string/number → named constant | New constant declared adjacent to use, single-file |
| Missing XML doc on a public type | Additive, no behavior change |
| Missing `CancellationToken` param on async I/O, where the enclosing method already receives one to forward | Pure pass-through, no new decision logic |
| Dead/unreachable code removal flagged by the guard | Deletion only, guard already confirmed unreachability |

### Tier 2 — Propose, then wait for per-item confirmation

Everything else the guards flag. This includes anything touching more than
one file, anything changing a signature or behavior, and every MUST FIX
architectural finding (layer violations, `DbContext` in Application,
swallowed exceptions, god classes). For each Tier 2 item, show the proposed
diff and a one-line risk note, then wait — do not batch-approve these the
way Tier 1 is batch-approved, even if the user approved a Tier 1 batch
moments earlier in the same run.

### Tier 3 — Flag only, never apply

Anything security-relevant (auth, secrets, input validation), anything
touching a financial/audit-trail invariant (`07-audit-trail-guard.mdc`
territory), and anything the guard itself marked with uncertainty. Report
these with a pointer to the right skill (`security-perf-report`,
`speckit-adr` if it's a real architectural decision) instead of a diff.

---

## Steps

**Step 1 — Get findings.**

If the user already has fresh output from `dotnet-clean-code-guard`,
`react-clean-code-guard`, or `refactor-assistant` earlier in this session,
reuse it — don't re-scan. Otherwise, run the appropriate guard(s) for the
resolved scope first (via `repo-map.json` project/language detection, same
as `refactor-assistant` Step 1).

**Step 2 — Classify every finding into Tier 1 / 2 / 3.**

Use the Tier Definitions above. When a finding is ambiguous between Tier 1
and Tier 2, classify it Tier 2 — the cost of an unnecessary confirmation
pause is much lower than the cost of an unreviewed behavioral change.

**Step 3 — Present the plan before touching anything.**

```
Tier 1 (auto-apply, N findings):
  - [file:line] one-line description
  - ...

Tier 2 (needs your OK, one at a time, N findings):
  - [file:line] one-line description

Tier 3 (flagged only, not applied, N findings):
  - [file:line] one-line description → see [pointer skill]
```

Ask once: "Apply the N Tier 1 fixes now?" A single yes covers the whole
Tier 1 batch (they're independently low-risk by definition). Tier 2 items
are then walked one at a time regardless of the Tier 1 answer.

**Step 4 — Apply Tier 1.**

Apply each fix scoped to exactly its reported location. After each file,
show a compact before/after for that specific change — not a full-file
diff.

**Step 5 — Walk Tier 2 one at a time.**

For each item: show the proposed change, name what it touches beyond the
single line (interfaces, callers, tests), and wait for an explicit go/skip
before moving to the next item. Skipped items go to Step 6 instead of being
silently dropped.

**Step 6 — Reconcile with tech debt.**

Anything skipped (declined Tier 2 items, all Tier 3 items) must exist in
`memory-bank/techDebt.md` afterward. If it's not already there, call
`technical-debt-tracker log` for it rather than letting it disappear once
this session ends.

**Step 7 — Final summary.**

```
Applied:  N Tier 1 + N Tier 2 fixes across N files
Skipped:  N (now tracked in techDebt.md)
Flagged:  N Tier 3 items → see [pointer skill] for each
```

Remind the user to run the test suite before committing — this skill does
not execute tests itself.

---

## Example Invocation

**Command:** `/refactor-apply Tamkeen.Payments`

**Context:** Findings already produced by `refactor-assistant` earlier in
the session; a `PaymentReconciliationService` god-class finding (Critical)
and four smaller findings (missing `Async` suffix, two magic numbers, one
missing `CancellationToken`).

Agent classifies: the three mechanical findings → Tier 1; the god-class
finding → Tier 2 (multi-method split, changes call sites). Presents the
plan, applies the 3 Tier 1 fixes on a single "yes," then walks the
god-class split as its own confirmation with a proposed extraction plan
before touching `PaymentReconciliationService.cs`.

---

## Output

- Before/after snippets for every applied change, grouped by tier
- Updated `memory-bank/techDebt.md` entries for anything skipped or flagged
- A final counts summary (applied / skipped / flagged)
- No test execution, no commit — that's `speckit-git-validate` /
  `speckit-git-commit`'s job once the developer has reviewed the diff
