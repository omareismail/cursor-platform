# Skill Catalog & Auto-Routing

Referenced by `.cursor/rules/00-memory-think.mdc` Step 2.5. Kept as a
separate doc (not inlined in the rule) on purpose — this file is read
on-demand, only at the moment the agent is actually routing a request to
a skill, instead of loading all 66 skills' descriptions into every single
message. If you edit skill descriptions, edit them here, not in the rule.

## Step 2.5 — Skill Auto-Routing (all 66 skills, announce before running)

Skills are written as slash commands (`/dotnet-migration`, `/database-audit`,
etc.) for manual invocation, but the user should not have to know or type
the exact command. Before responding, match the request against the catalog
below — every skill in `.cursor/skills/` has a row.

**Every match must be announced before it runs — never invoke a skill silently.**
Output one line in this exact shape first:

> **Matched skill:** `skill-name` — [one-line description of when this skill
> is used, from the table below].

Then follow the confirmation rule for that skill's category (below). Never
skip the announcement, even for read-only audits — the user should always
know which skill produced the output they're about to read.

If a request plausibly matches two rows, name the one you consider the best
fit in the announcement and briefly say why, rather than silently picking
one (e.g. "This could be `dotnet-migration` or `dotnet-perf-profile` — since
you mentioned a large table timing out, I'm treating it as a migration
issue: `dotnet-migration`").

### Category A — Generates or modifies files → announce, then WAIT for a go-ahead

| Skill | When to use it |
|---|---|
| `dotnet-migration` | Generate/review an EF Core migration; validates model-vs-spec drift, checks for destructive changes, ensures a working `Down()` |
| `dotnet-endpoint-gen` | Scaffold a complete, production-ready API endpoint from a spec |
| `dotnet-dapper-gen` | Generate parameterized Dapper queries and repository methods |
| `dotnet-background-job-gen` | Scaffold a recurring or fire-and-forget background job |
| `dotnet-caching-gen` | Add a caching layer to a read-heavy query handler |
| `dotnet-messaging-gen` | Scaffold an integration event using the outbox pattern |
| `dotnet-observability-gen` | Wire up structured logging, tracing, and metrics for a handler |
| `dotnet-iac-gen` | Generate parameterized IaC templates (Bicep/Terraform) |
| `dotnet-multi-db-gen` | Scaffold wiring for a project talking to more than one database/provider |
| `dotnet-test-gen` | Generate a complete, runnable test file for a .NET source file |
| `react-component-gen` | Generate a complete, production-ready React component file |
| `react-hook-gen` | Generate a complete, typed custom hook with its test |
| `react-api-layer-gen` | Generate the frontend API client layer from a backend contract |
| `react-state-machine-gen` | Model a multi-step/multi-status UI flow as an explicit state machine |
| `react-storybook-gen` | Generate Storybook stories covering every meaningful prop state |
| `react-module-federation-gen` | Scaffold Module Federation config for a micro-frontend split |
| `react-i18n-rtl-gen` | Wire internationalization + RTL support into a component/feature |
| `react-test-gen` | Generate a complete test file for a React component or hook |
| `refactor-apply` | Apply findings from a clean-code-guard/refactor-assistant report to real files — auto-applies mechanical fixes, walks risky ones one at a time |

### Category B — Read-only audits → announce, then proceed automatically

These skills only report — they never write. If the user wants findings
*applied*, that's `refactor-apply` (Category A), not a rerun of the guard
with different phrasing.

| Skill | When to use it |
|---|---|
| `dotnet-clean-code-guard` | Static review of a .NET file against coding standards |
| `dotnet-perf-profile` | Static review of a handler/endpoint for perf red flags |
| `dotnet-query-optimizer` | Review an EF Core LINQ query or Dapper SQL statement for inefficiency |
| `dotnet-schema-diff` | Compare two schema snapshots (LIVE vs TEST, or two branches) |
| `dotnet-dependency-audit` | Run and interpret `dotnet list package --vulnerable` |
| `database-audit` | Check EF/Dapper/schema consistency across the codebase |
| `react-clean-code-guard` | Static review of a React/TypeScript file against coding standards |
| `react-perf-audit` | Review a component tree for unnecessary re-renders |
| `react-accessibility-audit` | Deeper a11y pass beyond the baseline RTL/i18n guard |
| `security-perf-report` | Aggregate security findings across the security guard's output |
| `code-review-assistant` | Structured review of a PR or diff against standards |
| `api-consistency-audit` | Check naming/shape/error-handling consistency across API endpoints |
| `compliance-audit` | Check SAMA/ZATCA/mada or other framework-specific compliance |
| `devops-audit` | Review CI/CD, IaC, and Kubernetes config health |
| `technical-debt-tracker` | Maintain the living ledger of known shortcuts/deferred work |
| `refactor-assistant` | Aggregate clean-code guard output into refactor priorities |
| `enterprise-report-gen` | Aggregate multiple audits into a production/release-readiness report |
| `dependency-upgrade-guard` | Cross-stack safety check before bumping a dependency version |
| `docs-guard` | Verify every claim in a doc file matches the actual code |
| `prompt-quality-audit` | Sanity-check a request before it enters the spec pipeline |
| `skill-maturity-audit` | Check whether skills are correctly wired to shared infra |
| `platform-health-validator` | Check the workspace itself for naming/duplicate/orphan issues |

### Category C — Diagrams & docs → announce, then proceed automatically

| Skill | When to use it |
|---|---|
| `architecture-map-gen` | Generate ERD / dependency-graph / service-map / service-interaction / C4 diagrams |
| `onboarding-doc-gen` | Generate/refresh `README.md` and `CONTRIBUTING.md` from the actual repo |
| `changelog-gen` | Generate a Keep-a-Changelog-format entry |
| `release-notes-gen` | Generate customer-facing release notes in plain language |

### Category D — Workspace/session housekeeping → run silently, no announcement needed

| Skill | Runs when… |
|---|---|
| `repo-discovery` | Start of a new session (`quick` mode), or before any skill needs a fresh structural map |
| `context-builder` | About to touch multiple files across one feature — builds the task-scoped working set |
| `context-sync` | `memory-bank/` is missing or stale (see Step 1/Step 3) |
| `pattern-finder` | Step 0 of any `*-gen` skill — finds a real example to imitate before generating |

These are infrastructure, not user-facing deliverables — silence here avoids
noise; the *-gen skill that called them still gets announced per Category A.

### Category E — Spec-driven pipeline → announce the stage, then WAIT

Gated by `01-specify-rules.mdc`'s mandatory sequence
(`analyze → clarify → constitution → plan → specify → implement → checklist → commit`).
Do not jump into this pipeline opportunistically — only enter it when the
user is clearly starting a new feature from scratch, announce which stage
you're starting at, and wait for confirmation before generating anything,
since each stage gates irreversible-ish downstream work.

| Skill | When to use it |
|---|---|
| `speckit-analyze` | Mandatory first step — analyzes the raw request before anything else |
| `speckit-clarify` | Converts open questions from `analyze` into a resolved clarification record |
| `speckit-constitution` | Converts the clarification record into project values/constraints for this feature |
| `speckit-options` | Standalone decision-support skill producing weighed architectural options |
| `speckit-plan` | Converts the constitution into an ordered, dependency-aware task plan |
| `speckit-specify` | Assembles the clarification + constitution into the full feature spec |
| `speckit-tasks` | Syncs the plan's task table into `memory-bank/progress.md` |
| `speckit-checklist` | Pre-commit quality gate — comprehensive check before allowing commit |
| `speckit-implement` | Generates production code for a single task from the spec |
| `speckit-adr` | Records a lightweight Architecture Decision Record after a consequential choice |
| `speckit-retro` | Post-ship retrospective comparing plan estimates to actuals |
| `speckit-taskstoissues` | Converts the task board into ready-to-run GitHub issues |
| `speckit-git-initialize` | Sets up git workflow infrastructure for a new project |
| `speckit-git-feature` | Creates the feature branch and registers it in progress tracking |
| `speckit-git-remote` | Pushes the branch and generates a `gh pr create` command |
| `speckit-git-validate` | Runs the full pre-push validation pipeline |
| `speckit-git-commit` | Generates a Conventional-Commits-compliant commit message |

