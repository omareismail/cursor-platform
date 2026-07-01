# Skill: speckit-git-validate

**Invocation:** `/speckit-git-validate`

---

## Overview

`speckit-git-validate` runs the full pre-push validation pipeline across every
layer of the stack — static analysis, all test suites, commit history hygiene,
code cleanliness, and Docker build — before code leaves the developer's machine.
Each step must pass before the next step runs. On any failure the agent outputs
the exact command that failed, the error output, and a specific remediation
suggestion. This skill is the gate before `speckit-git-remote` and should be
run before every `git push`.

---

## Steps

**Step 1 — Static analysis.**

For .NET projects:
```bash
dotnet build --configuration Release --no-incremental
# PASS condition: exit code 0, zero warnings
# FAIL output: compiler errors or warnings (warnings-as-errors enabled)
```

For React projects:
```bash
tsc --noEmit
eslint src/ --ext .ts,.tsx --max-warnings 0
# PASS condition: both exit 0
# FAIL output: type errors or lint errors
```

**Step 2 — Test suites.**

For .NET:
```bash
dotnet test tests/[Project].ArchitectureTests --no-build
dotnet test tests/[Project].UnitTests --no-build
dotnet test tests/[Project].IntegrationTests --no-build
# IntegrationTests require Docker for TestContainers — check if Docker is running first
```

For React:
```bash
vitest run --reporter=verbose   # or: jest --ci
playwright test                  # critical paths only (tagged @smoke if configured)
```

Each suite runs separately. If one fails, the next does not run — output the
failure immediately.

**Step 3 — Commit history hygiene.**

```bash
git log main..HEAD --oneline
```

Check each commit message on this branch against the Conventional Commits format.
Also check for:
- WIP commits: `wip:`, `WIP`, `work in progress`
- Fixup commits: `fixup!`, `squash!`

If found:
```
❌ Branch has WIP/fixup commits that must be squashed before push.
Run: git rebase -i main
Then squash/fixup the offending commits.
```

**Step 4 — Code hygiene scan.**

```bash
git diff main...HEAD -- '*.cs' '*.ts' '*.tsx'
```

Scan the diff for:
- `TODO:` / `FIXME:` / `HACK:` in non-test source files
- `console.log` in production `.ts`/`.tsx` files
- `Console.WriteLine` in production `.cs` files
- Secrets patterns: `password\s*=\s*["'][^"']{8,}` in any file

**Step 5 — Docker build** (if `docker-compose.yml` exists).

```bash
docker compose build --no-cache
# PASS condition: exit code 0
# FAIL: output build errors with line references
```

**Step 6 — Output final result.**

```
═══════════════════════════════════════════
PRE-PUSH VALIDATION: [PASS ✅ | FAIL ❌]
═══════════════════════════════════════════
Step 1 Static analysis:  PASS
Step 2 Test suites:      PASS (ArchTests: 12 | Unit: 87 | Integration: 23 | RTL: 41 | E2E: 5)
Step 3 Commit history:   PASS (8 commits, all Conventional Commits format)
Step 4 Code hygiene:     PASS
Step 5 Docker build:     PASS

Ready to push. Run /speckit-git-remote to create the PR.
```

---

## Example Invocation

**Scenario:** Developer finishes `broker-client-csv-export` and runs `/speckit-git-validate`.

Step 2 fails:
```
❌ Step 2 FAILED — dotnet test *.IntegrationTests

FAILED: BrokerClientExportTests.Export_WithFilters_ReturnsCsvWithFilteredRows
  Expected: 3 rows in CSV
  Actual: 47 rows in CSV (filter not applied server-side)

Fix: The ExportBrokerClientsHandler is not applying filter params to the EF query.
Check: src/OrientPortal.Application/BrokerClients/Export/ExportBrokerClientsHandler.cs
Spec reference: specs/features/broker-client-csv-export.md §Validation Rules

Steps 3-5 skipped (fix Step 2 first).
```

---

## Output

- Terminal: step-by-step pass/fail output
- Terminal: final summary
- Side effect: gates `speckit-git-remote` (push is refused if any step fails)
