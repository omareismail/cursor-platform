# Skill: speckit-checklist

**Invocation:** `/speckit-checklist`

---

## Overview

**Memory references:** `memory-bank/businessRules.md, memory-bank/securityStandards.md`

`speckit-checklist` is the pre-commit quality gate. It runs a comprehensive
structured checklist across every changed file, marking each item Pass / Fail /
N/A. Any Fail blocks the commit — `speckit-git-commit` refuses to run until
all failures are resolved. The checklist covers spec compliance, architecture
integrity, security, code hygiene, and test coverage for both .NET and React.
It auto-detects which sections apply based on the project type read from
`memory-bank/techContext.md`, skipping irrelevant sections cleanly.

---

## Steps

**Step 1 — Determine scope.**

Read:
- `memory-bank/techContext.md` → project type (dotnet / react / fullstack)
- `memory-bank/WORKING_ON.md` → active feature and spec file path
- `git diff --staged` → files changed in this commit

**Step 2 — Run the checklist.**

For each item: output `[PASS]`, `[FAIL: reason]`, or `[N/A: reason]`.
Any `[FAIL]` is printed in red with a specific remediation instruction.

**Step 3 — Output the result.**

```
══════════════════════════════════════════
CHECKLIST RESULT: [PASS ✅ | FAIL ❌ (N failures)]
══════════════════════════════════════════
Blocked items (must fix before commit):
  [FAIL] Item description — Remediation: ...
```

If result is PASS: agent proceeds to suggest `speckit-git-commit`.
If result is FAIL: agent refuses to generate a commit message until fixed.

---

## Full Checklist

```
═══════════════════════════════════════════
SHARED (applies to all project types)
═══════════════════════════════════════════

[ ] Spec file exists in specs/features/ for the active feature
    FAIL if: memory-bank/WORKING_ON.md references a feature with no spec file

[ ] All acceptance criteria have a corresponding test
    FAIL if: any criterion in the spec's AC section has no test referencing it
    (check for // AC-N: comment in test files)

[ ] No TODO / FIXME / HACK comments in changed files
    FAIL if: grep finds any in staged files

[ ] No hardcoded secrets or config values
    FAIL if: any pattern matching secret/password/key/token followed by = and a value

[ ] No console.log / Console.WriteLine in production source files
    FAIL if: found outside of test files or logger utility

[ ] Clarify / Plan stages followed options format (rule 05)
    PASS if: specs/clarifications/[feature-slug].md exists with options recorded
    N/A if: feature is a non-speckit ad-hoc change (hotfix, chore)

[ ] decisions recorded in specs/clarifications/ and specs/plans/
    FAIL if: spec file exists but no corresponding clarification file

═══════════════════════════════════════════
.NET BACKEND (skip entirely if React-only project)
═══════════════════════════════════════════

[ ] dotnet build → zero warnings (warnings-as-errors enabled)
[ ] dotnet test *.ArchitectureTests → zero failures
[ ] dotnet test *.UnitTests → zero failures
[ ] dotnet test *.IntegrationTests → zero failures

[ ] No layer boundary violations
    FAIL if: ArchitectureTests report any; or manual check finds Infrastructure
    using in Domain/Application project

[ ] All async methods have Async suffix
    FAIL if: any public method returns Task<T> without Async in its name

[ ] No .Result / .Wait() / .GetAwaiter().GetResult() in production code
    FAIL if: found in any non-test .cs file

[ ] Repository interfaces in Application layer, implementations in Infrastructure
    FAIL if: any IRepository interface found in Infrastructure project

[ ] Domain entities have no public setters
    FAIL if: any Domain entity has a property with { get; set; }

[ ] All new endpoints have [Authorize] or [AllowAnonymous] with justification comment
    FAIL if: any new endpoint has neither attribute

[ ] EF migration added for any schema changes
    FAIL if: spec's Database Changes section is non-empty but no new migration file exists

[ ] All new public API types have XML doc comments
    FAIL if: any new public class/record/interface in API project lacks /// summary

[ ] No missing CancellationToken on async I/O methods
    FAIL if: any handler method or repository method has async Task<T> without CancellationToken ct

═══════════════════════════════════════════
REACT FRONTEND (skip entirely if .NET-only project)
═══════════════════════════════════════════

[ ] TypeScript compiles with zero errors (tsc --noEmit)
[ ] ESLint passes with zero errors (no eslint-disable comments added)
[ ] vitest / jest → zero failing tests
[ ] Playwright E2E → zero failing tests for affected user flows

[ ] No `any` types in changed files
    FAIL if: grep finds `: any` or `as any` outside of type declaration files

[ ] No direct fetch / axios in component files
    FAIL if: found in *.tsx files outside of api/ folder

[ ] All API response types defined in types/api.ts
    FAIL if: inline type literal used for API response shape in a hook

[ ] Loading, empty, and error states implemented for all async UI elements
    FAIL if: a component uses a React Query hook but has no isLoading / isError handling

[ ] No prop drilling > 2 levels
    FAIL if: a prop is passed through 3 or more component levels without being used

[ ] All interactive elements have accessible labels
    FAIL if: <button> or <a> with no text content and no aria-label

[ ] No dangerouslySetInnerHTML without DOMPurify sanitization
    FAIL if: dangerouslySetInnerHTML found without import of DOMPurify

[ ] Forms have validation with user-facing error messages
    FAIL if: a form using React Hook Form has no error message display logic

[ ] No useEffect with eslint-disable-next-line react-hooks/exhaustive-deps
    FAIL if: any such suppression comment found in staged files
```

---

## Example Invocation

**Scenario:** Developer has staged changes for TASK-015 (unit tests for export handler).

Agent runs checklist. Finds:
- `[FAIL] dotnet test *.UnitTests → 2 failures` — output shows failing test names
- `[FAIL] No TODO comments — found in CreateBrokerClientExportHandler.cs:47`

Output:
```
══════════════════════════════════════════
CHECKLIST RESULT: FAIL ❌ (2 failures)
══════════════════════════════════════════
[FAIL] dotnet test *.UnitTests → 2 failures
  CreateBrokerClientExportHandlerTests.Handle_EmptyClientList_ReturnsCsvWithHeaderOnly — Assert failed
  Remediation: Fix the assertion; the handler returns a 0-byte stream instead of a header-only CSV.

[FAIL] No TODO comments in production source
  CreateBrokerClientExportHandler.cs:47 — "// TODO: add streaming for large datasets"
  Remediation: Resolve the TODO now, or log it via /technical-debt-tracker and remove the comment.

Commit blocked. Fix the above issues and re-run /speckit-checklist.
```

---

## Output

- Terminal: full checklist with Pass / Fail / N/A per item
- Terminal: summary block (result, count of failures, blocked items with remediations)
- Side effect: gates `speckit-git-commit` — commit is refused until all items Pass or N/A
