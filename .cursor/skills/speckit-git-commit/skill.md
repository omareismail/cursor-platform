# Skill: speckit-git-commit

**Invocation:** `/speckit-git-commit`

---

## Overview

`speckit-git-commit` generates a Conventional Commits-compliant commit message
from the staged diff and the active feature context. It reads `WORKING_ON.md`
to get the spec reference and feature name, analyses the staged changes to
determine the correct type and scope, and detects breaking changes automatically.
It refuses to generate a commit message if `speckit-checklist` has not passed
in this session — ensuring quality gates are never bypassed. The generated
message includes a spec reference and a `Closes #N` line when an issue number
can be determined.

---

## Steps

**Step 1 — Pre-condition check.**

Verify `speckit-checklist` passed in this session (by checking session context).
If not:
```
❌ speckit-checklist has not passed in this session.
Run /speckit-checklist first. A commit without a passing checklist violates the
pipeline and may introduce quality issues that are expensive to fix in review.
```
Abort.

**Step 2 — Read staged diff.**

Run `git diff --staged --stat` and `git diff --staged` to understand:
- Which files changed
- What kinds of changes (new file, modification, deletion)
- Which layer the changes belong to (inferred from folder path)

**Step 3 — Determine commit type.**

| Change nature | Type |
|---------------|------|
| New feature code (handler, component, endpoint) | `feat` |
| Bug fix | `fix` |
| Moving code without changing behaviour | `refactor` |
| Adding or fixing tests only | `test` |
| Documentation only | `docs` |
| Build, CI, config, tooling | `chore` or `ci` or `build` |
| Performance improvement | `perf` |
| Code style only (formatting, whitespace) | `style` |

**Step 4 — Determine scope.**

From the files changed:

| Path pattern | Scope |
|-------------|-------|
| `src/[Project].Domain/` | `domain` |
| `src/[Project].Application/` | `application` |
| `src/[Project].Infrastructure/` | `infrastructure` |
| `src/[Project].API/` | `api` |
| `tests/` | `tests` |
| `src/features/` or `src/components/` | `components` or feature name |
| `src/hooks/` | `hooks` |
| `src/api/` | `api` |
| `src/store/` | `store` |
| `.github/workflows/` | `ci` |
| Migration files | `migrations` |

If the change spans multiple scopes (common in full-stack tasks), use the
primary scope and note the others in the body.

**Step 5 — Detect breaking changes.**

Flag as `BREAKING CHANGE` if the diff shows:
- A public API method or endpoint signature changed
- A DTO property was renamed or removed
- A database column was renamed or dropped
- A public interface method signature changed

**Step 6 — Generate commit message.**

```
type(scope): short imperative description (max 72 chars)

[Blank line]
What changed and why — not how (the code shows how).
If the change spans multiple layers, note each:
  - Application: added CreateBrokerClientExportHandler
  - Infrastructure: added CsvHelperExportWriter
Keep each line ≤ 72 characters.

Spec: specs/features/[feature-slug].md
Closes #[issue-number if determinable from WORKING_ON.md or task board]

[BREAKING CHANGE: description — only if detected in Step 5]
```

**Step 7 — Confirm before committing.**

Output the generated message and ask:
```
Generated commit message:
────────────────────────────────────────
feat(application): add broker client CSV export handler

Implements the ExportBrokerClientsQuery handler using CsvHelper streaming
writer. Honour the broker ownership check (IDOR mitigation per spec §Security).
Handler returns a MemoryStream; controller converts to FileStreamResult.

Spec: specs/features/broker-client-csv-export.md
Closes #34
────────────────────────────────────────
Run `git commit -m "..."` with this message? (yes / edit / no)
```

If "yes": output the exact `git commit` command (user runs it).
If "edit": show the message in an editable block.
If "no": discard.

---

## Example Invocation

**Scenario:** TASK-003 implementation is staged. Checklist passed.

Diff shows changes to:
- `src/OrientPortal.Application/BrokerClients/Export/ExportBrokerClientsHandler.cs` (new)
- `src/OrientPortal.Application/BrokerClients/Export/ExportBrokerClientsQuery.cs` (new)
- `src/OrientPortal.Application/BrokerClients/Export/ExportBrokerClientsValidator.cs` (new)

Agent generates:
```
feat(application): add broker client CSV export query and handler

New CQRS query ExportBrokerClientsQuery accepts broker ID and filter params.
Handler validates broker ownership before streaming CSV response via
ICsvExportWriter (Infrastructure interface). FluentValidation ensures
brokerId is non-empty and filters are within allowed ranges.

Spec: specs/features/broker-client-csv-export.md
Closes #34
```

---

## Output

- Terminal: generated commit message with confirmation prompt
- Side effect: `git commit` command output (user executes after confirmation)
