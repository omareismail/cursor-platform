# Build gates

Copy these into a **target application repo**, not this one. They turn the
prose in `.cursor/rules/*.mdc` into compiler errors, failing tests, and red CI.

## Why this layer exists

The platform already has 12 guard rules and 98 skills. Those work on the agent —
they shape what it generates. But a rule that only exists in a prompt has three
failure modes:

1. The model drifts on a long session, or a compaction drops the rule.
2. A human writes the code, and never read `.cursor/rules/`.
3. A different tool writes it — Copilot, a teammate's Cursor with a stale config,
   a merge from a branch that predates the rule.

Every rule below has been restated as something a machine checks. After this,
`.cursor/rules/` explains *why* and CI enforces *whether*. Both are needed —
the analyzer tells you a build failed, the rule file tells you what to do instead.

## What maps to what

| Guard rule | Mechanical enforcement | Where |
|---|---|---|
| `02-dotnet-architecture-guard` — layer boundaries | MSBuild `<Error>` targets + NetArchTest | `dotnet/Directory.Build.props`, `dotnet/ArchitectureTests/LayerBoundaryTests.cs` |
| `02` — handlers never touch `DbContext` | `Handlers_Do_Not_Touch_DbContext` | `LayerBoundaryTests.cs` |
| `03-react-architecture-guard` — no `fetch` in components | `no-restricted-globals` scoped to component dirs | `react/eslint.config.mjs` |
| `03` — feature/module boundaries | `import/no-restricted-paths`, `import/no-cycle` | `react/eslint.config.mjs` |
| `04-security-guard` — injection, weak crypto, TLS | CA2100/CA3001/CA5350… escalated to `error` | `dotnet/.editorconfig` |
| `04` — no JWT in `localStorage` | `no-restricted-properties` | `react/eslint.config.mjs` |
| `04` — no secrets in source | gitleaks on full history + PreToolUse hook | `ci/quality-gates.yml` |
| `06-database-provider-guard` — parameterized SQL | CA2100 as `error` + `db-auditor` subagent | `dotnet/.editorconfig` |
| `07-audit-trail-guard` — `decimal` for money | `Money_Properties_Use_Decimal` | `dotnet/ArchitectureTests/ConventionTests.cs` |
| `07` — who/when/what-changed | `Auditable_Entities_Capture_Who_And_When` | `ConventionTests.cs` |
| `08-rtl-i18n-guard` — logical CSS properties | `no-restricted-syntax` AST selectors + stylelint | `react/eslint.config.mjs` |
| `08` — locale-aware formatting | CA1304/CA1305 as `error`; `Intl`/`toLocaleString` AST ban | `dotnet/.editorconfig`, `react/eslint.config.mjs` |
| `10-evidence-and-dependency-guard` — no new packages | Central Package Management (NU1010) + `npm ci` + PreToolUse Bash hook | `dotnet/Directory.Packages.props`, `ci/quality-gates.yml` |
| `05-planning-rigor` — tasks small enough to finish | `task-graph validate` — ≤8 files, ≤2 layers, verify command, no cycles | `ci/quality-gates.yml`, `.cursor/tools/task-graph.mjs` |
| — (new) platform drift | shim-sync + tool-parse checks fail the PR | `ci/quality-gates.yml` |
| — (new) trace staleness | `feature-map verify` warns when traced code moved | `ci/quality-gates.yml`, `.cursor/tools/feature-map.mjs` |
| — (new) untested acceptance criteria | `ac-trace check` — fails on an AC with no test that can fail | `ci/quality-gates.yml`, `.cursor/tools/ac-trace.mjs` |
| — (new) tests that cannot fail | `ac-trace lint` + Stryker mutation score | `ci/quality-gates.yml`, `mutation/` |
| — (new) documentation rot | `docs-lint check` — broken links, ghost skills, stale counts | `ci/quality-gates.yml`, `.cursor/tools/docs-lint.mjs` |
| MCP policy — postgres is read-only | a database role that **cannot** write, with `statement_timeout` and `default_transaction_read_only` — the boundary behind `guard-mcp`'s statement classifier | `postgres/readonly-role.sql` |

`DateTime.Now`, `Task.Wait()`, `System.Data.SqlClient`, `BinaryFormatter` and
friends are banned outright via `dotnet/BannedSymbols.txt` +
`Microsoft.CodeAnalysis.BannedApiAnalyzers`. That file is the cheapest tool in
this whole set: **every time a review catches the same mistake twice, add a
line.** It never catches it a third time.

## Install order

Do these one at a time and get each green before starting the next. Turning all
of them on at once on an existing repo produces hundreds of errors and the usual
outcome is that someone disables the lot.

```
1. .editorconfig                    → dotnet format --verify-no-changes
2. Directory.Build.props            → start with TreatWarningsAsErrors=false,
                                      fix the backlog, then flip it to true
3. BannedSymbols.txt                → add bans incrementally
4. Directory.Packages.props         → migrate versions out of the .csproj files
5. ArchitectureTests project        → expect real failures; they are findings,
                                      not false positives
6. eslint.config.mjs                → run with --max-warnings=999 first, walk
                                      it down to 0
7. mutation/                        → one critical module first; measure before
                                      setting a `break` threshold
8. ci/quality-gates.yml             → last, once local runs are clean
```

Step 7 has its own guidance — which modules are worth the runtime, and why to
read the survivor list rather than the score: [`mutation/README.md`](mutation/README.md).

## Things to change before committing

- **Assembly and namespace names** in `ArchitectureTests/*.cs` (`Company.*`) and
  the `ProjectReference` paths in `ArchitectureTests.csproj`.
- **Layer name suffixes** in `Directory.Build.props` (`.Domain`, `.Application`,
  `.Infrastructure`, `.API`) — match `memory-bank/architecture.md`.
- **Module list** in `Modules_Do_Not_Reach_Into_Each_Others_Internals`.
- **Package versions** in `Directory.Packages.props` — these were captured in
  mid-2026 and are a starting point, not a recommendation. Verify against your
  solution; a wrong pin is worse than no pin.
- **Frontend path** in `quality-gates.yml` (`./frontend`).
- **Coverage threshold** — 60% is a floor to stop regression, not a target.

## The one gate nobody builds

`quality-gates.yml` has a `platform` job that checks the agent configuration
itself: skill shims in sync, hook scripts and tools parse, `settings.json` and
`.mcp.json` are valid JSON, memory-bank not rotting, no credentials committed,
**task boards valid**, and traced features not stale.

The task-board check fails the build rather than warning. An oversized task —
more than 8 files, or spanning more than 2 layers — is a change that will land
half-applied when whoever picks it up runs out of context partway through, and
half-applied changes are worth blocking a merge over. Feature-map staleness only
warns: traces going stale on an active branch is normal, and a hard failure there
would simply get disabled.

Agent config is the only part of a repo that has no compiler and no tests. Left
alone it decays silently — a skill added without a shim is invisible to Claude
Code for months, and the failure mode is "the agent just seems worse lately,"
which nobody files a bug for.
