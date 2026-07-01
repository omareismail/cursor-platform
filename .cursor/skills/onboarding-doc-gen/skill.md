# Skill: onboarding-doc-gen

**Invocation:** `/onboarding-doc-gen`

---

## Overview

**Memory references:** `memory-bank/glossary.md, memory-bank/projectbrief.md`

`onboarding-doc-gen` generates or refreshes `README.md` and `CONTRIBUTING.md` from
the actual current state of memory-bank and the codebase. Documentation that tells
a new developer to run `dotnet run` when the project needs Docker and a seeded database
is worse than no documentation, because it wastes their first hour and breaks their trust
in everything else in the repo. Every generated document is verified against the codebase
— commands must exist, file paths must resolve — using the same discipline as `docs-guard`.
The output is presented as a diff for human review, never silently overwritten.

---

## Steps

**Step 1 — Load context.**

- `.cursor/cache/repo-map.json` (from `repo-discovery` — confirm fresh first)
  → authoritative project list, providers, infra surface; use this instead
  of re-deriving it from `docker-compose.yml`/`.env.example` by hand
- `memory-bank/techContext.md` → build/test/run commands, environment setup
- `memory-bank/systemPatterns.md` → architecture overview
- `memory-bank/projectbrief.md` → project purpose, features, users
- `.env.example` → required environment variables
- `scripts/` → any setup or migration scripts
- If `.cursor/docs/architecture/` has diagrams from `architecture-map-gen`,
  link them rather than re-describing the architecture in prose only

**Step 2 — Generate `README.md`.**

```markdown
# [Project Name]

[One-paragraph description from projectbrief.md]

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| .NET SDK | [from global.json] | https://dot.net |
| Node.js | [from .nvmrc or package.json engines] | https://nodejs.org |
| Docker | 24+ | https://docker.com |
| [gh CLI] | [if used] | https://cli.github.com |

## Quick Start

### 1. Clone and configure
```bash
git clone [repo-url]
cd [project-name]
cp .env.example .env.local
# Edit .env.local — see Environment Variables section below
```

### 2. Start dependencies
```bash
docker compose up -d    # starts [list services from docker-compose.yml]
```

### 3. Apply database migrations
```bash
dotnet ef database update --project src/[Project].Infrastructure --startup-project src/[Project].API
```

### 4. Run the API
```bash
dotnet run --project src/[Project].API
# API available at: https://localhost:7000
# Swagger UI:       https://localhost:7000/swagger
```

### 5. Run the frontend
```bash
cd frontend   # or src/[frontend-folder]
npm install
npm run dev
# App available at: http://localhost:5173
```

## Running Tests
```bash
# Backend
dotnet test

# Frontend
npm run test

# E2E
npx playwright test
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| [from .env.example] | | |

## Where Things Live

```
src/
├── [Project].Domain/          # Domain entities, value objects, domain events
├── [Project].Application/     # MediatR commands/queries, validators
├── [Project].Infrastructure/  # EF Core, repositories, external services
└── [Project].API/             # ASP.NET Core endpoints, DI registration
frontend/src/
├── features/                  # Feature-scoped components, hooks, API
├── components/                # Shared reusable UI components
├── api/                       # Fetchers + React Query hooks
└── types/                     # TypeScript interfaces
specs/                         # Feature specs, plans, clarifications
memory-bank/                   # AI agent context files
docs/                          # Architecture decisions, API reference
```

## Development Workflow

See [CONTRIBUTING.md](CONTRIBUTING.md) for the speckit feature development pipeline.
```

**Step 3 — Generate `CONTRIBUTING.md`.**

```markdown
# Contributing

## Development Setup
[Point to README.md Quick Start]

## Feature Development Pipeline

All features follow the speckit pipeline — no code without a spec.

```
/speckit-analyze → /speckit-clarify → /speckit-constitution →
/speckit-plan → /speckit-specify → /speckit-implement → /speckit-checklist → /speckit-git-commit
```

See `.cursor/rules/01-specify-rules.mdc` for detailed gate rules.

## Git Workflow
[Git Workflow section from speckit-git-initialize]

## Code Quality Standards
- **Backend:** `.cursor/rules/02-dotnet-architecture-guard.mdc`
- **Frontend:** `.cursor/rules/03-react-architecture-guard.mdc`
- **Security:** `.cursor/rules/04-security-guard.mdc`

## Running `/context-sync`
If you're new to this project, run `/context-sync` in Cursor to bootstrap the
memory-bank from the codebase. This gives the AI agent full context about the
project's stack and patterns.
```

**Step 4 — Cross-verify every command mentioned.**

For every shell command in the generated docs:
- Verify the script/binary exists
- Verify the project path is correct
- Verify environment variables referenced in the command are in `.env.example`

Flag any command that cannot be verified.

**Step 5 — Present as diff for review.**

Output the proposed README.md and CONTRIBUTING.md content and ask for confirmation
before writing. Never silently overwrite existing documentation.

---

## Example Invocation

**Command:** `/onboarding-doc-gen`

Agent reads memory-bank, scans docker-compose.yml (PostgreSQL + Redis), reads .env.example
(8 variables), reads package.json dev scripts. Generates README with Quick Start (5 steps),
environment variable table, and folder map. Cross-verifies all commands. Presents diff.

---

**MCP tools:** if the `git` MCP server is connected, use it to verify a documented command/script was actually touched recently, rather than trusting a possibly-stale README claim.

## Output

- Updated: `README.md` (diff presented for approval)
- Updated: `CONTRIBUTING.md` (diff presented for approval)
- Terminal: list of any commands that could not be verified
