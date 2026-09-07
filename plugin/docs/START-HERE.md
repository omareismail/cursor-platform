# START HERE — Workspace Quick Reference

97 skills, 12 rules, 14 subagents. This card tells you which to use for common tasks.
Full skill catalog: `${CLAUDE_PLUGIN_ROOT}/docs/skill-catalog.md`
New app repo bootstrap: `${CLAUDE_PLUGIN_ROOT}/docs/NEW-PROJECT.md`
Existing repo bootstrap (give to model): `${CLAUDE_PLUGIN_ROOT}/docs/APPLY-TO-PROJECT.md`
Agent session brief: `AGENTS.md` (copy to each app repo)
Full dependency model: `${CLAUDE_PLUGIN_ROOT}/docs/skill-graph.md`
Full execution sequence: `${CLAUDE_PLUGIN_ROOT}/docs/shared-execution-pipeline.md`

---

## Starting a new session

```
/repo-discovery quick        # Check cache freshness (fast if already current)
```

If you're about to start a feature spanning multiple files:

```
/context-builder [task description]   # Task-scoped working set
```

---

## "I have an idea and want to build it"

The product lifecycle. Six phases, six gates, one command to find out where you
are. Full runbook: `${CLAUDE_PLUGIN_ROOT}/docs/IDEA-TO-PRODUCTION.md`.

| Question | Skill |
|---|---|
| Where are we? What is allowed next? | `/lifecycle` |
| Start a new product | `/lifecycle start` |
| Is this phase finished? | `/lifecycle-gate [PHASE]` |
| **1** I have an idea | `/product-brief "<the idea>"` |
| **1** Who is this for? | `/persona-gen` |
| **1** What must it do? | `/product-requirements` |
| **1** Break it into stories | `/user-story-map` |
| **2** What are the entities and rules? | `/domain-model-gen` |
| **2** How does the business flow? | `/use-case-gen` |
| **2** Collect the business rules | `/business-rules-gen` |
| **2** What could make this fail? | `/risk-register` |
| **3** What shape is the system? | `/solution-architecture` |
| **3** What are the endpoints? | `/api-contract-design` |
| **3** How is it stored? | `/data-model-design` |
| **3** Turn designs into a contract | `/ux-design-bridge` |
| **4** Build the next feature | `/feature-pipeline next` |
| **5** What should we test, where? | `/test-strategy` |
| **5** Test a critical journey | `/e2e-test-gen "<journey>"` |
| **6** Build the CI/CD pipeline | `/deployment-pipeline-gen` |
| **6** Plan and run the cutover | `/go-live plan` |

> The design gate is enforced, not requested. Until it is approved, every write
> under `src/`, `backend/` and `frontend/` fails with exit code 2. Tests, specs
> and docs are never blocked.

---

## "I want to understand code that already exists"

The most common task on an inherited codebase, and the one to run *before*
building or changing anything.

| Question | Skill |
|---|---|
| How does this feature work? | `/feature-trace "<feature name>"` |
| What breaks if I change this? | `/impact-analysis "<proposed change>"` |
| What does this system even do? | `/feature-inventory [scope]` |
| Does the code match the spec? | `/spec-drift-audit [spec-file\|feature-id]` |
| Where is the nearest example to copy? | `/pattern-finder [what you are building]` |
| What files does this task touch? | `/context-builder [task description]` |

---

## "I want to break work into small tasks"

| Situation | Skill |
|---|---|
| New feature, full spec pipeline | `/speckit-plan` (after `/speckit-specify`) |
| Anything else — bug, refactor, migration, change to a traced feature | `/work-breakdown [source]` |
| A task is too big to execute | `/work-breakdown --split T-04` |
| Sync the board to the kanban | `/speckit-tasks` |
| Turn the board into GitHub issues | `/speckit-taskstoissues` |
| Execute one task | `/speckit-implement T-01` |
| **Is the task actually done?** | `/task-verify T-01` |

Verification is blocking: a task cannot move to Done without a recorded passing
run and acceptance criteria covered by tests that *can fail*.

```
node ${CLAUDE_PLUGIN_ROOT}/tools/ac-trace.mjs check specs/features/<slug>.md   # AC <-> test gaps
node ${CLAUDE_PLUGIN_ROOT}/tools/ac-trace.mjs matrix specs/features/<slug>.md  # the RTM
node ${CLAUDE_PLUGIN_ROOT}/tools/ac-trace.mjs lint                             # vacuous/weak tests
```

`ac-trace` reads the `// AC-N:` comments both test generators already emit and
fails on: an AC no test claims, a test claiming an AC the spec dropped, an AC
whose only test is skipped, and assertions that cannot fail. When the same
process wrote the code and the tests, a green suite proves they agree — not that
either is right.

Both produce the same validated board format. Size is enforced, not estimated —
max 8 files and 2 layers per task, a verify command on every row:

```
node ${CLAUDE_PLUGIN_ROOT}/tools/task-graph.mjs validate specs/plans/<slug>-tasks.md
node ${CLAUDE_PLUGIN_ROOT}/tools/task-graph.mjs graph    specs/plans/<slug>-tasks.md   # batches + critical path
node ${CLAUDE_PLUGIN_ROOT}/tools/task-graph.mjs next     specs/plans/<slug>-tasks.md --done T-01
node ${CLAUDE_PLUGIN_ROOT}/tools/task-graph.mjs split    specs/plans/<slug>-tasks.md T-04
```

Slicing strategy (vertical / horizontal / risk-first) is presented as an explicit
choice with tradeoffs — it decides when the work first becomes demoable and where
integration risk lands.

```
# Typical sequence on an unfamiliar repo
/repo-discovery full                     # structure
/feature-inventory full                  # what capabilities exist
/feature-trace "premium calculation"     # how one of them works
/impact-analysis "add tiered rates"      # what changing it would break
```

Freshness is checked automatically — traces record the content hash of every
file they cover, so `/feature-trace` on an already-traced feature is a cache
hit, and a stale trace names the exact files that moved:

```
node ${CLAUDE_PLUGIN_ROOT}/tools/feature-map.mjs list      # coverage + freshness
node ${CLAUDE_PLUGIN_ROOT}/tools/feature-map.mjs verify    # which traces went stale, and why
```

**Claude Code:** delegate these to the `feature-analyst` subagent. A real trace
reads 30-50 files; run inline it fills the context window before you can act on
the answer.

---

## "I want to build something new"

| Task | Skill |
|---|---|
| New .NET API endpoint | `/dotnet-endpoint-gen` |
| New Dapper repository | `/dotnet-dapper-gen` |
| New EF Core migration | `/dotnet-migration` |
| New background job | `/dotnet-background-job-gen` |
| Add caching | `/dotnet-caching-gen` |
| Add messaging (MQ/bus) | `/dotnet-messaging-gen` |
| New React component | `/react-component-gen` |
| New React hook | `/react-hook-gen` |
| New API client layer | `/react-api-layer-gen` |
| New state machine | `/react-state-machine-gen` |
| New Storybook story | `/react-storybook-gen` |
| New IaC (Bicep/Terraform) | `/dotnet-iac-gen` |
| Observability/telemetry | `/dotnet-observability-gen` |

All of these call `pattern-finder` as Step 0 — they imitate an existing
real example before generating anything.

---

## "I want to write a spec before building"

```
/prompt-quality-audit [request]     # Sanity-check the request first
/speckit-constitution               # Project values and constraints
/speckit-specify                    # Full feature spec
/speckit-clarify                    # Resolve ambiguities in a spec
/speckit-options                    # Generate architectural options
/speckit-plan                       # Implementation plan
/speckit-tasks                      # Task breakdown
/speckit-implement                  # Execute against spec
/speckit-adr                        # Record an architectural decision
```

---

## "I want to ship it and run it"

Everything above optimizes the inner loop — spec, generate, verify, merge. This
is the outer loop: does it survive production, and is delivery actually
improving?

| Question | Skill |
|---|---|
| Is this ready to ship? | `/production-readiness-review [scope]` |
| What do we monitor, alert on, and do at 3am? | `/operability-gen [feature]` |
| How do we roll it out without a big-bang? | `/release-safety [change]` |
| What could an attacker do with this design? | `/threat-model [spec\|feature]` |
| Is delivery getting better or worse? | `/delivery-metrics [--trend]` |
| Something broke — how do we stop it recurring? | `/postmortem [incident]` |

```
node ${CLAUDE_PLUGIN_ROOT}/tools/delivery-metrics.mjs report --days 90   # DORA + rework rate
node ${CLAUDE_PLUGIN_ROOT}/tools/delivery-metrics.mjs trend  --days 180  # direction of travel
node ${CLAUDE_PLUGIN_ROOT}/tools/flag-debt.mjs scan                      # expired flags fail CI
node ${CLAUDE_PLUGIN_ROOT}/tools/docs-lint.mjs check                     # broken links, ghost skills, stale counts
```

**Why this matters here specifically.** DORA's 2025/2026 research found AI
adoption raises throughput 2–18% while stability degrades — change failure rate
rising from 8% to 14% in one study, PR size +154%, review time +91%. A 75-skill
platform is a throughput amplifier, which is exactly the configuration that
finding describes. `/delivery-metrics` exists so you can tell which way yours is
going instead of assuming.

**Claude Code:** delegate these to the `ops-reviewer` subagent.

---

## "I want to audit something"

| Audit | Skill |
|---|---|
| Full production readiness | `/enterprise-report-gen production-readiness [scope]` |
| Release readiness | `/enterprise-report-gen release-readiness [scope]` |
| Security + performance | `/enterprise-report-gen security-perf [scope]` |
| Database consistency (EF/Dapper/cross-provider) | `/database-audit [scope]` |
| Schema drift between environments | `/dotnet-schema-diff` |
| Slow queries | `/dotnet-query-optimizer` |
| Runtime performance (micro-benchmark) | `/dotnet-perf-profile` |
| Throughput under concurrency (load/stress/soak) | `/load-test-gen [feature]` |
| React performance | `/react-perf-audit` |
| Accessibility | `/react-accessibility-audit` |
| API surface consistency | `/api-consistency-audit [scope]` |
| DevOps / CI / IaC / K8s | `/devops-audit [scope]` |
| SAMA / ZATCA / mada compliance | `/compliance-audit [scope] [framework]` |
| Architecture diagrams / ERD | `/architecture-map-gen [type] [scope]` |
| Technical debt | `/technical-debt-tracker report` |
| Refactoring priorities (all stacks) | `/enterprise-report-gen refactor [scope]` |
| Code review | `/code-review-assistant` |
| Dependency health | `/dotnet-dependency-audit` |
| Spec vs. reality drift | `/spec-drift-audit [spec-file\|feature-id]` |
| Orphan endpoints / dead features | `/feature-inventory [scope]` |
| Production readiness (Go/No-Go) | `/production-readiness-review [scope]` |
| Security of a *design*, before building | `/threat-model [spec\|feature]` |
| Delivery performance (DORA) | `/delivery-metrics [--trend]` |
| Expired / permanent feature flags | `/release-safety --flag-debt` |

---

## "I want to fix issues an audit found, not just read about them"

```
/refactor-apply [scope]              # Applies safe fixes automatically,
                                      # walks risky ones one at a time
```
Reuses `dotnet-clean-code-guard` / `react-clean-code-guard` /
`enterprise-report-gen refactor` output rather than re-scanning. The three audit
skills above stay read-only on purpose — this is the only skill that
writes.

---

## "I want to check the workspace itself"

```
/skill-maturity-audit all           # Are skills wired to shared infra?
/platform-health-validator          # Naming, duplicates, orphaned docs, rule conflicts
```

---

## "I want to generate documentation"

```
/onboarding-doc-gen                 # New-joiner onboarding doc
/changelog-gen                      # CHANGELOG from git history
/release-notes-gen                  # Release notes
/speckit-retro                      # Sprint retrospective
/architecture-map-gen dependency-graph    # Dependency graph
/architecture-map-gen erd [scope]         # Entity relationship diagram
/architecture-map-gen service-map         # Async event/messaging graph
/architecture-map-gen service-interaction # Sync call graph
/architecture-map-gen c4 full             # C4 Context + Container diagrams
```

---

## The 12 rules (automatic — you don't invoke these)

Four rules apply **every session** (`alwaysApply: true`). Seven apply when
matching files are in context (globs). None are slash commands.

| Rule | Scope |
|---|---|
| `00-memory-think` | **Global** — memory-bank + repo-map freshness; routes to `skill-catalog.md` |
| `05-planning-rigor` | **Global** — options-with-tradeoffs before plans/specs/ADRs |
| `09-minimal-changes` | **Global** — only change what the task requires |
| `10-evidence-and-dependency-guard` | **Global** — verify before referencing; no new packages |
| `01-specify-rules` | `specs/**`, `src/**`, `frontend/**` — spec-first |
| `02-dotnet-architecture-guard` | `**/*.cs`, `**/*.csproj` — layer boundaries |
| `03-react-architecture-guard` | `**/*.tsx`, `**/*.ts` — component architecture |
| `04-security-guard` | `.cs`, `.tsx`, `.ts`, `.json`, `.yml`, `.yaml` — OWASP |
| `06-database-provider-guard` | `**/*.cs`, `**/*.sql` — dialect correctness |
| `07-audit-trail-guard` | `**/*.cs` — audit trails + financial domain invariants |
| `08-rtl-i18n-guard` | `**/*.tsx`, `**/*.css` — RTL/bilingual layout correctness |

---

## Key shared infrastructure docs

- `AGENTS.md` — agent session instructions (copy to each app repo root)
- `${CLAUDE_PLUGIN_ROOT}/docs/NEW-PROJECT.md` — bootstrap a new application repo
- `${CLAUDE_PLUGIN_ROOT}/docs/skill-catalog.md` — full 66-skill catalog and routing categories
- `${CLAUDE_PLUGIN_ROOT}/docs/skill-graph.md` — who depends on whom
- `${CLAUDE_PLUGIN_ROOT}/docs/shared-execution-pipeline.md` — canonical execution order
- `${CLAUDE_PLUGIN_ROOT}/docs/MIGRATION_NOTES_PASS1.md` — full change history + what was deliberately NOT built
- `${CLAUDE_PLUGIN_ROOT}/docs/ENTERPRISE_MATURITY_REPORT.md` — platform maturity scores + recommendations
- `.cursor/cache/repo-map.json` — live structural map (don't hand-edit; regenerated by `repo-discovery`)
- `memory-bank/README.md` — Tier 1 vs Tier 2 memory model explained
