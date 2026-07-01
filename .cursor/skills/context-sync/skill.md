# Skill: context-sync

**Invocation:** `/context-sync`

---

## Overview

`context-sync` bootstraps or refreshes the entire `memory-bank/` from the actual
current state of the codebase. It is the entry point for using this `.cursor/` setup
on an existing project that has no memory-bank, and the recovery tool when memory-bank
has drifted significantly out of date. Running it takes a few minutes but prevents
hours of the agent making wrong assumptions about the stack, the patterns, and the
in-flight work. It generates or updates all 6 core memory-bank files and initialises
`memory-bank/techDebt.md` if `technical-debt-tracker` will be used. All generated
content is presented for review before being written — never silently overwritten.

**Scope note:** this skill only manages the 8 Tier 1 dynamic files (listed in
`memory-bank/README.md`). It never writes to `architecture.md`,
`codingStandards.md`, `businessRules.md`, or the other Tier 2 standards files —
those are human-authored and read-only from every skill's perspective.

---

## Steps

**Step 1 — Run `repo-discovery`, don't rescan independently.**

As of this phase, `context-sync` no longer walks `*.csproj`/`package.json`/etc.
itself — that scanning now lives in `/repo-discovery`, which is cached and
shared by every other skill. Call `/repo-discovery full` (or rely on its own
freshness check if already current) and read the resulting
`.cursor/cache/repo-map.json` as the source for this step. This avoids the two
skills drifting out of sync on what "the current stack" means, and means
`context-sync` runs faster on large repos since it's reading a cache, not
re-walking the filesystem.

Output `memory-bank/techContext.md` (narrative form of `repo-map.json`'s
relevant fields — package versions, framework monikers, infra surface):

```markdown
# Tech Context
**Last Updated:** [YYYY-MM-DD]

## Stack
**Backend:** .NET [version] | ASP.NET Core [version] | C# [version]
**Frontend:** React [version] | TypeScript [version] | Vite [version]
**Database:** [SQL Server / PostgreSQL / SQLite] — EF Core [version]
**Containerisation:** Docker Compose [version]
**CI/CD:** GitHub Actions

## Key Backend Packages
| Package | Version | Purpose |
|---------|---------|---------|
| MediatR | [ver] | CQRS pipeline |
| FluentValidation | [ver] | Command validation |
| [etc.] | | |

## Key Frontend Packages
| Package | Version | Purpose |
|---------|---------|---------|
| @tanstack/react-query | [ver] | Server state |
| zustand | [ver] | Client state |
| [etc.] | | |

## Build & Test Commands
**Backend:**
  Build: `dotnet build --configuration Release`
  Test:  `dotnet test`
  Run:   `dotnet run --project src/[Project].API`

**Frontend:**
  Install: `npm install`
  Dev:     `npm run dev`
  Test:    `npm run test`
  Build:   `npm run build`

## Environment Setup
1. [Step derived from docker-compose.yml and README]
2. [Step for secrets / user-secrets / env file]
```

**Step 2 — Infer `systemPatterns.md`.**

Read:
- Application layer files for MediatR, CQRS, repository pattern, outbox
- Frontend files for state management approach, folder structure, API layer pattern
- `.github/workflows/` for branching strategy and commit convention

Output `memory-bank/systemPatterns.md`:

```markdown
# System Patterns
**Last Updated:** [YYYY-MM-DD]

## Backend Architecture
**Pattern:** Clean Architecture (Domain / Application / Infrastructure / API)
**CQRS:** MediatR [version] — Commands and Queries in Application/[Feature]/
**Validation:** FluentValidation — validator in same folder as handler
**Repository:** Interfaces in Application/Interfaces/, implementations in Infrastructure/
**Error handling:** [Result<T> pattern / ProblemDetails / throw]

## Frontend Architecture
**Folder structure:** [features-based / colocation / atomic design]
**Server state:** TanStack Query [version] — hooks in features/[name]/hooks/
**Client state:** [Zustand / Redux Toolkit] — slices in src/store/
**API layer:** fetchers in src/api/, React Query hooks wrap fetchers
**Forms:** React Hook Form + Zod

## Git Workflow
**Branching:** [main / main+develop / gitflow]
**Commits:** Conventional Commits format enforced by commit-msg hook
**PR process:** [describe if README has any]
```

**Step 3 — Read `projectbrief.md`.**

Read `README.md` for project name, purpose, and key features.

Output `memory-bank/projectbrief.md`:
```markdown
# Project Brief
**Project:** [name]
**Purpose:** [from README]
**Key features:** [from README]
**Target users:** [from README or inferred]
```

**Step 4 — Build `progress.md`.**

Read:
- Open GitHub Issues (`gh issue list --json title,number,labels,state` if `gh` is available)
- Existing `specs/plans/*.md` files for any in-progress features
- `git log --oneline -30` for recently completed work

Output `memory-bank/progress.md` skeleton with any detected in-flight features.

**Step 5 — Set `activeContext.md`.**

```markdown
# Active Context
**Last Updated:** [YYYY-MM-DD]
**Current branch:** [git branch --show-current]
**Recently modified files:** [git diff --name-only HEAD~5]
**Active feature:** [from WORKING_ON.md if exists, else "None — run /speckit-analyze to start a feature"]
```

**Step 6 — Initialise `techDebt.md` if empty.**

```markdown
# Tech Debt Register
**Last Updated:** [YYYY-MM-DD]

| ID | Description | Risk | Introduced | Target sprint | Status |
|----|-------------|------|-----------|---------------|--------|
| (empty — run /technical-debt-tracker scan to populate) |
```

**Step 7 — Present all files for review before writing.**

Output all 6 files in a single block and ask:
```
Review the above memory-bank content. Type "confirm" to write all 6 files,
or correct any section and I will regenerate it before writing.
```

---

## Example Invocation

**Scenario:** Developer clones `orient-portal` repo (existing project, no memory-bank).
Runs `/context-sync`.

Agent scans 4 `.csproj` files, `package.json`, 3 GitHub Actions workflows, and 30 git
log entries. Generates all 6 memory-bank files. Confirms with developer, then writes.

Output:
```
✅ memory-bank/ initialised:
  memory-bank/techContext.md      (stack, packages, commands)
  memory-bank/systemPatterns.md  (Clean Architecture + TanStack Query patterns)
  memory-bank/projectbrief.md    (from README.md)
  memory-bank/productContext.md  (product purpose and user personas)
  memory-bank/progress.md        (3 open GitHub issues detected)
  memory-bank/activeContext.md   (current branch: main)
  memory-bank/techDebt.md        (empty — run /technical-debt-tracker scan)
```

---

## Output

- New or updated: all 6 `memory-bank/*.md` files (after human confirmation)
- New (if not exists): `memory-bank/techDebt.md`
