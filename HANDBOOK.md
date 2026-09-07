# cursor-platform — Handbook

> **بالعربية:** [HANDBOOK.ar.md](HANDBOOK.ar.md) — الدليل نفسه كاملاً بالعربية.

Every file in this repository, what it does, and how to use it — followed by the
two workflows that matter: **starting a new project** and **applying this to an
existing one**.

- New here? Read § 1 and § 2, then jump to § 10.
- Looking up one file? § 3–§ 9 are the reference.
- Already set up and want the daily commands? § 12.

---

## 1. What this repository is

This is a **platform**, not an application. It contains no product code. It is
the configuration that makes an AI coding agent behave like a senior engineer on
a large .NET + React codebase: reading before writing, imitating existing
patterns, refusing to cross architecture boundaries, and proving work is done
rather than declaring it.

It works in **both Cursor and Claude Code** from one set of source files.

| Count | What |
|---|---|
| 77 | skills — slash commands the agent runs |
| 11 | guard rules — always-on or file-type-scoped constraints |
| 8 | subagents — read-only specialists with their own context window (Claude Code) |
| 7 | hook scripts — deterministic enforcement that does not depend on the model |
| 7 | validators — CLI tools that check things mechanically |
| 24 | memory-bank files — what the agent knows about your project |
| — | build-gate templates — the same rules as compiler errors and CI failures |

### The one idea behind all of it

**Prose is advisory; machines are not.** A rule written in a prompt protects you
from the agent on a good day. The same rule written as an analyzer, a test, or a
hook protects you from everyone — the agent on a bad day, a human who never read
the rules, and a merge from a branch that predates them.

So almost everything here exists twice: once as a rule that explains *why*, and
once as a mechanism that enforces *whether*. Both are needed. The analyzer tells
you the build failed; the rule file tells you what to do instead.

---

## 2. The mental model

Work moves through four layers. Most teams build only the middle two.

```
  UNDERSTAND        what does this code already do?
      ↓             feature-trace · impact-analysis · feature-inventory · spec-drift-audit
  PLAN              what exactly are we building, in what order?
      ↓             speckit-* · work-breakdown · threat-model
  BUILD             generate it, following local convention
      ↓             *-gen skills · pattern-finder · guard rules · hooks
  VERIFY            is it actually done?
      ↓             task-verify · ac-trace · *-audit skills · build gates
  SHIP & RUN        can we run it, and is delivery improving?
                    production-readiness-review · operability-gen · release-safety
                    delivery-metrics · postmortem
```

**UNDERSTAND comes first on an inherited codebase.** You cannot safely change
premium calculation until you know it also runs inside a nightly job.

**VERIFY is the bottleneck, not BUILD.** When the same process writes the code
and the tests, a green suite proves the two agree — not that either is right.
That is why `task-verify` and `ac-trace` exist, and why the templates turn rules
into compiler errors.

---

## 3. Root files

| File | What it is | When you touch it |
|---|---|---|
| `README.md` | Project overview, inventory, quick start | Read once |
| `HANDBOOK.md` | This file | Reference |
| `AGENTS.md` | **The agent contract.** Session-start procedure, how to route a request to a skill, the non-negotiables. Cursor reads this automatically. | Copy to every app repo. Edit when the contract changes. |
| `CLAUDE.md` | **Claude Code entry point.** Imports `AGENTS.md` via `@AGENTS.md`, then adds what only Claude Code has: subagents, hooks, and the rule-routing table (Claude has no glob-scoped rule loader). | Copy to every app repo |
| `.mcp.json` | Project MCP servers — GitHub, Postgres, Context7, Playwright. Committed; contains only `${ENV_VAR}` references, never secrets. | Edit to add a server |
| `.gitignore` | Excludes `settings.local.json`, the caches, build output | Rarely |
| `.claude-plugin/plugin.json` | Plugin manifest — what installs when someone runs `/plugin install` | Bump `version` on release |
| `.claude-plugin/marketplace.json` | Marketplace catalog — what `/plugin marketplace add` reads | Bump `version` on release |
| `plugin/` | **Generated, committed.** The self-contained distributable, built by `build-plugin.mjs`. Full skill bodies with paths rewritten to `${CLAUDE_PLUGIN_ROOT}`. | Never by hand — rebuild |
| `cursor.rar`, `cursor-updated.rar` | Old archives of this repo. Not used by anything. | **Safe to delete** |

> `.mcp.json` needs `GITHUB_PAT`, `POSTGRES_READONLY_URL` (a **SELECT-only**
> role), and optionally `CONTEXT7_API_KEY` in your environment.

---

## 4. `.cursor/` — the source of truth

### `.cursor/skills/` — 97 skills

**This is where skills live.** Each is a directory containing `skill.md`. Cursor
reads them directly; Claude Code reads generated shims in `.claude/skills/`.

> **Editing rule: always edit `.cursor/skills/`, never `.claude/skills/`.**
> After adding, renaming or deleting a skill, run
> `node .claude/hooks/sync-skills.mjs`. CI fails the PR if you forget.

#### Understanding existing code

| Skill | Answers |
|---|---|
| `feature-trace` | "How does this feature work today?" — one capability end-to-end: React route → component → hook → API client → endpoint → handler → repository → tables → jobs → events. Caches the result. |
| `impact-analysis` | "If I change this, what breaks?" — blast radius, with **silent** breaks separated from compile errors |
| `feature-inventory` | "What does this system even do?" — harvests every entry point, clusters into capabilities, finds orphans and duplicates |
| `spec-drift-audit` | "Does the code still match what we said?" — claim by claim, with a verdict on which side is wrong |
| `repo-discovery` | Structural map of the repo → `repo-map.json` |
| `context-builder` | "What files does this specific task touch?" |
| `pattern-finder` | "What is the nearest existing example to imitate?" — Step 0 of every generator |
| `context-sync` | Rebuilds memory-bank Tier 1 from the live codebase |

#### Planning and decomposition

| Skill | Use |
|---|---|
| `speckit-analyze` | Turn a vague request into a structured analysis + open questions |
| `speckit-clarify` | Turn those questions into options with tradeoffs and a decision record |
| `speckit-options` | Options-driven elicitation for a single decision |
| `speckit-constitution` | The feature's non-negotiables |
| `speckit-specify` | The authoritative spec — if it is not here, it is not in scope |
| `speckit-plan` | Plan variants + slicing strategy → validated task board |
| `speckit-tasks` | Sync the board into `memory-bank/progress.md` as a kanban |
| `speckit-taskstoissues` | Board → `gh issue create` script |
| `speckit-implement` | Generate code for **one** task |
| `speckit-checklist` | Pre-commit quality gate |
| `speckit-adr` | Record an architecture decision |
| `speckit-retro` | Feature retrospective |
| `work-breakdown` | **Decompose anything** — spec, traced feature, impact analysis, bug, refactor, migration — into agent-sized tasks |
| `threat-model` | STRIDE at design time, before the code exists |
| `prompt-quality-audit` | Score a request or spec for ambiguity before it enters the pipeline |

#### Generating .NET

`dotnet-endpoint-gen` · `dotnet-dapper-gen` · `dotnet-migration` ·
`dotnet-background-job-gen` · `dotnet-caching-gen` · `dotnet-messaging-gen` ·
`dotnet-multi-db-gen` · `dotnet-observability-gen` · `dotnet-iac-gen` ·
`dotnet-test-gen`

#### Generating React

`react-component-gen` · `react-hook-gen` · `react-api-layer-gen` ·
`react-state-machine-gen` · `react-storybook-gen` · `react-i18n-rtl-gen` ·
`react-module-federation-gen` · `react-test-gen`

#### Auditing quality

| Skill | Checks |
|---|---|
| `dotnet-clean-code-guard` / `react-clean-code-guard` | Coding standards, per stack |
| `dotnet-perf-profile` / `react-perf-audit` | Performance red flags (micro-benchmark scope) |
| `load-test-gen` | Throughput under concurrency — k6/NBomber, thresholds from your SLOs |
| `dotnet-query-optimizer` | One EF/Dapper query |
| `dotnet-schema-diff` | Two environments' schemas |
| `database-audit` | EF/Dapper/schema consistency repo-wide |
| `api-consistency-audit` | Cross-endpoint consistency on a shipped API |
| `compliance-audit` | SAMA / ZATCA / mada |
| `devops-audit` | CI/CD, IaC, Kubernetes |
| `react-accessibility-audit` | a11y beyond the RTL guard |
| `dotnet-dependency-audit` | Vulnerable and deprecated packages |
| `dependency-upgrade-guard` | Cross-stack safety before a version bump |
| `docs-guard` | Do the docs' references still resolve? |
| `technical-debt-tracker` | The living debt ledger |
| `code-review-assistant` | A PR/diff against the spec |
| `enterprise-report-gen` | Aggregates the above into one executive report. Modes include `refactor` and `security-perf` (these absorbed two former standalone skills) |

#### Verifying

| Skill | Use |
|---|---|
| `task-verify` | **Is this task actually done?** Runs the verify command, checks AC coverage, reads tests for the failure modes a tool cannot catch, optionally runs mutation testing. **Blocking.** |
| `refactor-apply` | Apply audit findings to real files |

#### Shipping and running

| Skill | Use |
|---|---|
| `production-readiness-review` | Blocking Go/No-Go across 7 dimensions |
| `operability-gen` | SLIs/SLOs, error-budget policy, alerts linked to a runbook, the runbook |
| `release-safety` | Flag lifecycle, rollout rings, rollback, expand→migrate→contract |
| `delivery-metrics` | DORA four keys + rework rate — is delivery improving? |
| `postmortem` | Incident → permanent compile-time guard |
| `changelog-gen` | Keep-a-Changelog entry for developers |
| `release-notes-gen` | Customer-facing notes, no implementation detail |
| `architecture-map-gen` | Live diagrams: dependency graph, ERD, C4, sequence |
| `onboarding-doc-gen` | README / CONTRIBUTING from the real codebase |

#### Git and platform maintenance

`speckit-git-initialize` · `speckit-git-feature` · `speckit-git-commit` ·
`speckit-git-remote` · `speckit-git-validate` · `skill-maturity-audit` ·
`platform-health-validator`

---

### `.cursor/rules/` — 12 guard rules

`.mdc` files. **Cursor loads these automatically** by glob. Claude Code does not
— the routing table in `CLAUDE.md` and in every skill shim tells it which to read.

| Rule | Scope | Enforces |
|---|---|---|
| `00-memory-think` | always | Read memory-bank before doing anything non-trivial |
| `05-planning-rigor` | always | No plan without options and tradeoffs |
| `09-minimal-changes` | always | Change only what the task requires |
| `10-evidence-and-dependency-guard` | always | Verify symbols exist; never add an unrequested package |
| `01-specify-rules` | `specs/**` | No implementation without a spec |
| `02-dotnet-architecture-guard` | `*.cs` | Clean Architecture layer boundaries; handlers never touch `DbContext` |
| `03-react-architecture-guard` | `*.tsx`, `*.ts` | No `fetch` in components; feature boundaries |
| `04-security-guard` | all source | Injection, secrets, auth, token storage |
| `06-database-provider-guard` | `*.cs`, `*.sql` | Parameterized SQL, correct dialect per provider |
| `07-audit-trail-guard` | `*.cs` | `decimal` for money; who/when/what-changed |
| `08-rtl-i18n-guard` | `*.tsx`, `*.css` | Logical CSS properties, locale-aware formatting |

---

### `.cursor/tools/` — 10 validators

Plain Node, no dependencies, cross-platform. These are what make the rules
checkable rather than hopeful.

| Tool | Answers | Key commands |
|---|---|---|
| `feature-map.mjs` | *Is this trace still true?* Stores the content hash of every file a trace covers, so staleness is computed, not guessed. | `list` · `verify` · `query --file X` · `upsert` |
| `task-graph.mjs` | *Is this task small enough to finish?* Rejects >8 files or >2 layers, finds dependency cycles, computes critical path and parallel batches. | `validate <plan.md>` · `graph` · `next` · `split` |
| `ac-trace.mjs` | *Is every acceptance criterion covered by a test that can fail?* Reads the `// AC-N:` comments the test generators emit. | `check` · `matrix` · `lint` |
| `delivery-metrics.mjs` | *Is delivery improving?* DORA four keys + rework rate from git. Labels every number **MEASURED** or **PROXY**. | `report --days 90` · `trend` |
| `flag-debt.mjs` | *Which feature flags outlived their purpose?* | `scan` · `scan --strict` |
| `docs-lint.mjs` | *Is the documentation graph intact?* Broken links, ghost skill references, stale counts, orphan docs. | `check` · `check --strict` · `graph` |
| `build-plugin.mjs` | *Builds the distributable plugin.* Inlines full skill bodies and rewrites every path to `${CLAUDE_PLUGIN_ROOT}`, because a shim pointing at `.cursor/` breaks the moment the plugin is installed elsewhere. | `build` · `check` |

All exit non-zero on failure, so CI can gate on them.

---

### `.cursor/docs/` — reference

| Doc | Read it when |
|---|---|
| `START-HERE.md` | **"I want to do X" → which skill.** The one to keep open. |
| `skill-catalog.md` | Full 76-skill catalog with auto-routing categories |
| `skill-graph.md` | Which skills call which |
| `shared-execution-pipeline.md` | Canonical order: discovery → pattern → generate → validate |
| `NEW-PROJECT.md` | Bootstrapping a brand-new app repo |
| `APPLY-TO-PROJECT.md` | **Give this to the agent** to bootstrap an existing repo |
| `DUAL-AGENT-SETUP.md` | How Cursor and Claude Code share one source of truth |
| `mcp-ecosystem.md` | MCP servers, env vars, and the ⚠ 2026 corrections |
| `GOVERNANCE_REPORT.md` | How 24 proposed rules became 11 | <!-- count-ok: describes a frozen proposal, not the live rule set -->
| `PROPOSAL-REVIEW.md` | Architectural review of ~150 proposed additions — approved, rejected, and why |
| `ENTERPRISE_MATURITY_REPORT.md`, `MIGRATION_NOTES_PASS1.md`, `PHASE5_GAP_ANALYSIS.md` | Historical build records. Point-in-time; counts in them are deliberately not updated. |

---

### `.cursor/cache/` — machine-owned, gitignored

| File | Owner | Never |
|---|---|---|
| `repo-map.json` | `/repo-discovery` | hand-edit |
| `feature-map.json` | `/feature-trace`, `/feature-inventory` | hand-edit |

Both are blocked by the `PreToolUse` write guard. Write to `feature-map.json`
only through `feature-map.mjs upsert` — the freshness check depends on hashes the
tool stamps, and a hand-edit silently breaks it for every feature.

### `.cursor/settings.local.json` — gitignored

Your local Cursor settings and MCP servers. Mirrors `.mcp.json`. The
`.bak-*` file is a backup from the MCP correction; safe to delete.

---

## 5. `.claude/` — the Claude Code layer

### `.claude/skills/` — 77 generated shims

Each `SKILL.md` is frontmatter plus "read `.cursor/skills/<name>/skill.md`".
Claude Code needs YAML frontmatter to discover a skill; the `.cursor` files have
none. **Never edit these by hand.**

`_descriptions.json` holds 16 hand-written description overrides for skills whose
auto-extracted description read badly. Description quality *is* the routing
mechanism — if Claude picks the wrong skill, fix the description here.

### `.claude/agents/` — 14 subagents

Read-only specialists that run in **their own context window** and return only
findings. On a large repo this is the difference between finishing a task and
running out of context mid-refactor.

| Agent | Delegate when |
|---|---|
| `feature-analyst` | "How does X work?" / "What breaks if I change X?" — a real trace reads 30–50 files |
| `ops-reviewer` | "Is this ready to ship?" — readiness, SLOs, rollout safety |
| `pattern-scout` | Before any generator — finds the canonical local example |
| `repo-cartographer` | Structural discovery, `context-sync` refreshes |
| `dotnet-auditor` | Any .NET audit over ~5 files |
| `react-auditor` | Any React/TS audit over ~5 files |
| `security-auditor` | Secrets, injection, authZ/IDOR, supply chain |
| `db-auditor` | Schema, migrations, dialects, query plans |

### `.claude/hooks/` — 7 scripts

| Hook | Fires | Does |
|---|---|---|
| `session-start.mjs` | session start | Injects memory-bank digest + cache freshness. **Makes rule 00 automatic.** |
| `guard-write.mjs` | before Write/Edit | Blocks edits to the caches, `.env`, Tier 2 memory-bank, and hardcoded credentials |
| `guard-bash.mjs` | before Bash | Blocks `dotnet add package`, `npm install <pkg>`, `ef database update`, force-push, `DROP TABLE` |
| `post-edit-verify.mjs` | after Write/Edit | Fast tripwires on the file just written — money as `double`, `DateTime.Now`, sync-over-async, interpolated SQL, `fetch` in a component, physical CSS |
| `stop-memory-check.mjs` | on stop | Blocks once if source changed but `activeContext.md` did not |
| `sync-skills.mjs` | manual | Regenerates the shims |
| `_lib.mjs` | — | Shared helpers |

Optional heavier checks:

```bash
CLAUDE_HOOK_DOTNET_FORMAT=1   # dotnet format on touched .cs files
CLAUDE_HOOK_ESLINT=1          # eslint --fix on touched .ts/.tsx files
```

### `.claude/settings.json`

Wires the hooks, plus a permission `deny` list (never read `.env`, secrets,
certificates) and an `ask` list (confirm before `git push`, `gh pr merge`,
`npm publish`). **Committed** — the team depends on it. Personal overrides go in
`.claude/settings.local.json`, which is gitignored.

---

## 6. `memory-bank/` — what the agent knows

Two tiers, with different owners. Getting this wrong is the most common way the
platform underperforms.

### Tier 1 — dynamic, machine-maintained

Regenerated by `/context-sync`, kept current by the agent. Injected at session
start.

`activeContext.md` · `progress.md` · `techContext.md` · `systemPatterns.md` ·
`projectbrief.md` · `productContext.md` · `techDebt.md` · `WORKING_ON.md`

### Tier 2 — static, human-authored

**Your team's decisions.** The agent reads these and never rewrites them — the
write guard blocks it. This is where the platform learns *your* conventions.

| File | Holds |
|---|---|
| `architecture.md` | Layer names, module boundaries |
| `codingStandards.md` | Naming, formatting, structure |
| `businessRules.md` | Domain rules in business language |
| `technologyStack.md` | Pinned versions — Context7 resolves docs from this |
| `databaseConventions.md` | Providers, naming, migration policy |
| `apiConventions.md` | Routes, versioning, error shape |
| `frontendConventions.md` | Component structure, state, data fetching |
| `backendConventions.md` | Handler/CQRS shape |
| `securityStandards.md` | Auth, secrets, encryption |
| `performanceGuidelines.md` | Budgets and targets |
| `testingStandards.md` | Frameworks, naming, coverage expectations |
| `deploymentNotes.md` | Environments, release process |
| `decisionLog.md` | ADRs |
| `commonMistakes.md` | **Mistakes caught twice.** `/postmortem` writes here. |
| `glossary.md` | Domain terms, EN + AR |

`README.md` explains the tier split. **Filling in Tier 2 is the single highest-value
thing you can do** — it is the difference between generic boilerplate and code
that looks like the rest of your repo.

---

## 7. `templates/` — build gates for app repos

Copy into a **target application repo**, not this one. These turn the prose
rules into compiler errors and red CI.

| File | Turns into |
|---|---|
| `dotnet/Directory.Build.props` | `TreatWarningsAsErrors`, nullable enforced, MSBuild targets that **fail the build** on a Clean Architecture violation |
| `dotnet/Directory.Packages.props` | Central Package Management — a `.csproj` cannot name a version, so a new dependency requires a reviewable one-line diff (NU1010) |
| `dotnet/.editorconfig` | Analyzer severities escalated to `error` — SQL injection, weak crypto, locale-less formatting, sync-over-async |
| `dotnet/BannedSymbols.txt` | `DateTime.Now`, `Task.Wait()`, `BinaryFormatter`, `System.Data.SqlClient` banned at compile time. **The cheapest tool here — add a line every time a review catches the same thing twice.** |
| `dotnet/ArchitectureTests/LayerBoundaryTests.cs` | Rule 02 as failing tests (NetArchTest) |
| `dotnet/ArchitectureTests/ConventionTests.cs` | Money as `decimal`, audit fields present, no entities on the wire, `CancellationToken` plumbed |
| `dotnet/ArchitectureTests/ArchitectureTests.csproj` | The one project allowed to reference every layer |
| `react/eslint.config.mjs` | Rules 03/04/08 as lint errors — no `fetch` in components, no token in `localStorage`, no physical CSS |
| `mutation/stryker-config.json`, `stryker.conf.json` | Mutation testing configs, scoped |
| `mutation/README.md` | Which modules are worth mutating, and why to read survivors not the score |
| `ci/quality-gates.yml` | GitHub Actions: build gates, security, **and a `platform` job that validates the agent config itself** |

**Install one at a time.** Turning them all on at once on an existing repo
produces hundreds of errors and someone disables the lot. Order is in
`templates/README.md`.

---

## 8. How the pieces fit

```
You ask for something
        ↓
AGENTS.md / CLAUDE.md            route the request to a skill
        ↓
SessionStart hook                injects memory-bank so rule 00 is automatic
        ↓
pattern-finder / pattern-scout   finds the local example to imitate
        ↓
the skill generates              guard rules constrain what it may write
        ↓
PreToolUse hooks                 block forbidden writes and commands
        ↓
PostToolUse tripwires            catch money-as-double, DateTime.Now, fetch-in-component
        ↓
task-verify + ac-trace           prove the acceptance criteria are actually covered
        ↓
build gates in CI                the same rules, enforced for everyone
        ↓
Stop hook                        nudges the memory-bank update so the next session knows
```

---

## 9. Two caches, five validators

| Question | Answered by |
|---|---|
| What is in this repo? | `repo-map.json` ← `/repo-discovery` |
| What does it **do**? | `feature-map.json` ← `/feature-trace` |
| Is that still true? | `feature-map.mjs verify` |
| Is this task finishable? | `task-graph.mjs validate` |
| Is every AC really covered? | `ac-trace.mjs check` |
| Is delivery improving? | `delivery-metrics.mjs report` |
| Which flags are dead weight? | `flag-debt.mjs scan` |
| Is the doc graph intact? | `docs-lint.mjs check` |

---

## 10. Building a new project with this

### Step 1 — Install the platform

**Claude Code — as a plugin (recommended):**

```
/plugin marketplace add omareismail/cursor-platform
/plugin install cursor-platform@cursor-platform
```

Skills, subagents, hooks, rules, validators and MCP config arrive together,
version-pinned, updatable with `/plugin marketplace update`. Nothing to copy and
nothing to drift.

**Cursor, or vendoring it in:**

```
your-app/
  AGENTS.md          ← from this repo
  CLAUDE.md          ← from this repo
  .mcp.json          ← from this repo
  .cursor/           ← from this repo (skills, rules, docs, tools)
  .claude/           ← from this repo (shims, agents, hooks, settings)
  memory-bank/       ← from this repo, then customise Tier 2
  src/               ← your code
```

Either way, set `GITHUB_PAT` and `POSTGRES_READONLY_URL` in your environment.

**What the plugin never ships, and why:** `memory-bank/`. Every generator reads
it, so a generic copy would make the agent imitate somebody else's conventions
rather than yours. Create it from this repo's template — Step 2.

Verify the agent can see it:

```
claude
> /skills     # should list 76
> /agents     # should list 8
```

If `/skills` is empty: `node .claude/hooks/sync-skills.mjs`, then restart.

### Step 2 — Fill in Tier 2 memory-bank

**Do this before generating anything.** Replace the `> EXAMPLE —` blocks in
`architecture.md`, `codingStandards.md`, `technologyStack.md`,
`databaseConventions.md`, `apiConventions.md`, `frontendConventions.md`,
`backendConventions.md`, `securityStandards.md`, `testingStandards.md`,
`glossary.md`.

An hour here saves days. Skip it and the agent generates plausible code that
looks nothing like the rest of your repo.

### Step 3 — Establish the skeleton, then map it

```
/repo-discovery full        # structural map
/context-sync               # populate Tier 1 memory-bank
```

### Step 4 — Install the build gates, one at a time

From `templates/`, in this order, green before moving on:

```
1. .editorconfig                → dotnet format --verify-no-changes
2. Directory.Build.props        → start with TreatWarningsAsErrors=false
3. BannedSymbols.txt            → add bans incrementally
4. Directory.Packages.props     → migrate versions out of the .csproj files
5. ArchitectureTests            → expect real failures; they are findings
6. eslint.config.mjs            → --max-warnings=999 first, walk it to 0
7. mutation/                    → one critical module; measure before gating
8. ci/quality-gates.yml         → last
```

### Step 5 — Build the first feature

```
/speckit-analyze                       # vague request → structured analysis
/speckit-clarify                       # open questions → options with tradeoffs
/speckit-specify                       # the authoritative spec (numbered AC-1..N)
/threat-model specs/features/<slug>.md # STRIDE, while a fix is still a design change
/speckit-plan                          # variants + slicing → validated task board
```

Then per task:

```
/speckit-implement T-01                # generate code + tests for ONE task
/task-verify T-01                      # blocking — no Done without evidence
```

Before it reaches production:

```
/operability-gen "<feature>"           # SLOs, alerts, runbook
/release-safety "<change>"             # flags, rings, rollback
/production-readiness-review "<scope>" # blocking Go/No-Go
```

### Step 6 — Keep it honest

```bash
node .cursor/tools/delivery-metrics.mjs report --days 90 --deploy-tag 'v*'
```

Record the baseline in `progress.md`. Re-read it monthly. If deployment
frequency and change failure rate are both climbing, the verification layer is
too thin — tighten `templates/`, do not add more generators.

---

## 11. Applying this to an existing project

Same Step 1, then **map before you change anything**:

```
/repo-discovery full
/context-sync
/feature-inventory full                  # what capabilities exist at all
/feature-trace "<the one that scares you>"
/impact-analysis "<the change you were about to make>"
/work-breakdown "<that change>"          # into finishable tasks
```

The fastest route is to hand `.cursor/docs/APPLY-TO-PROJECT.md` to the agent —
it is written as an agent-executable playbook.

**Expect real failures when you install the build gates.** An existing codebase
will light up. Those are findings, not false positives. Take them one gate at a
time and keep `TreatWarningsAsErrors=false` until the backlog is clear.

---

## 12. Daily commands

```bash
# Understand
/feature-trace "premium calculation"
/impact-analysis "add IsActive to Broker"

# Plan
/work-breakdown premium-calculation
node .cursor/tools/task-graph.mjs validate specs/plans/<slug>-tasks.md
node .cursor/tools/task-graph.mjs graph    specs/plans/<slug>-tasks.md   # batches + critical path
node .cursor/tools/task-graph.mjs next     specs/plans/<slug>-tasks.md --done T-01

# Build
/dotnet-endpoint-gen "POST /api/v1/refunds"
/react-component-gen RefundForm

# Verify
/task-verify T-04
node .cursor/tools/ac-trace.mjs check  specs/features/<slug>.md
node .cursor/tools/ac-trace.mjs matrix specs/features/<slug>.md
node .cursor/tools/ac-trace.mjs lint

# Ship
/production-readiness-review premium-calculation
node .cursor/tools/flag-debt.mjs scan

# Health
node .cursor/tools/feature-map.mjs list
node .cursor/tools/delivery-metrics.mjs trend --days 180
node .cursor/tools/docs-lint.mjs check
/platform-health-validator
```

---

## 13. Maintaining the platform

| When | Do |
|---|---|
| Added / renamed / deleted a skill | `node .claude/hooks/sync-skills.mjs`, then `node .cursor/tools/build-plugin.mjs build` |
| Shipping a new plugin version | Bump `version` in `.claude-plugin/plugin.json` **and** `marketplace.json`, rebuild, commit |
| A skill routes badly in Claude Code | Fix its entry in `.claude/skills/_descriptions.json`, re-sync |
| A review catches the same mistake twice | Add a line to `templates/dotnet/BannedSymbols.txt` |
| After an incident | `/postmortem` — output is a compile-time guard, not a document |
| Monthly | `/delivery-metrics --trend`, `/platform-health-validator` |
| Traces going stale | `node .cursor/tools/feature-map.mjs verify`, re-trace what it names |

---

## 14. Gotchas

**97 skills costs ~7k tokens of always-on context** in Claude Code, and routing
accuracy drops as near-duplicate descriptions accumulate. `/skill-maturity-audit all`
shows the overlaps. Prune rather than keep adding.

**Claude Code does not auto-load `.mdc` rules.** The routing table tells it which
to read, but that is an instruction, not a loader. This is exactly why the hooks
and build gates exist — the important half of each rule is enforced mechanically,
so a missed read is caught rather than shipped.

**Auto-extracted skill descriptions can read badly.** 16 are hand-written for
that reason. If routing misses, that is where to look first.

**Tier 2 memory-bank is where the value is.** Every generator reads it. Left as
the shipped examples, you get generic code.

**Weak-test detection in `ac-trace` is heuristic.** It will miss shapes nobody
anticipated and occasionally flag a legitimate `NotBeNull()`. Treat a hit as a
prompt to look, not a verdict — and add patterns as you find new ways tests fail
to fail.

**`delivery-metrics` proxies are labelled for a reason.** Git cannot observe
deployments or incidents. Wire `--deploy-tag` and `--fix-pattern` to your real
conventions before drawing conclusions.

**Do not soften a NO-GO** from `/production-readiness-review`, and do not mark a
task Done without a `/task-verify` DONE verdict. A gate that has never blocked
anything is a form, not a control.
