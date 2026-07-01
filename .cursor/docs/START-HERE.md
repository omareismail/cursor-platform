# START HERE — Workspace Quick Reference

66 skills, 11 rules. This card tells you which to use for common tasks.
Full skill catalog: `.cursor/docs/skill-catalog.md`
New app repo bootstrap: `.cursor/docs/NEW-PROJECT.md`
Existing repo bootstrap (give to model): `.cursor/docs/APPLY-TO-PROJECT.md`
Agent session brief: `AGENTS.md` (copy to each app repo)
Full dependency model: `.cursor/docs/skill-graph.md`
Full execution sequence: `.cursor/docs/shared-execution-pipeline.md`

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

## "I want to audit something"

| Audit | Skill |
|---|---|
| Full production readiness | `/enterprise-report-gen production-readiness [scope]` |
| Release readiness | `/enterprise-report-gen release-readiness [scope]` |
| Security + performance | `/security-perf-report [scope]` |
| Database consistency (EF/Dapper/cross-provider) | `/database-audit [scope]` |
| Schema drift between environments | `/dotnet-schema-diff` |
| Slow queries | `/dotnet-query-optimizer` |
| Runtime performance | `/dotnet-perf-profile` |
| React performance | `/react-perf-audit` |
| Accessibility | `/react-accessibility-audit` |
| API surface consistency | `/api-consistency-audit [scope]` |
| DevOps / CI / IaC / K8s | `/devops-audit [scope]` |
| SAMA / ZATCA / mada compliance | `/compliance-audit [scope] [framework]` |
| Architecture diagrams / ERD | `/architecture-map-gen [type] [scope]` |
| Technical debt | `/technical-debt-tracker report` |
| Refactoring priorities (all stacks) | `/refactor-assistant [scope]` |
| Code review | `/code-review-assistant` |
| Dependency health | `/dotnet-dependency-audit` |

---

## "I want to fix issues an audit found, not just read about them"

```
/refactor-apply [scope]              # Applies safe fixes automatically,
                                      # walks risky ones one at a time
```
Reuses `dotnet-clean-code-guard` / `react-clean-code-guard` /
`refactor-assistant` output rather than re-scanning. The three audit
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

## The 11 rules (automatic — you don't invoke these)

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
- `.cursor/docs/NEW-PROJECT.md` — bootstrap a new application repo
- `.cursor/docs/skill-catalog.md` — full 66-skill catalog and routing categories
- `.cursor/docs/skill-graph.md` — who depends on whom
- `.cursor/docs/shared-execution-pipeline.md` — canonical execution order
- `.cursor/docs/MIGRATION_NOTES_PASS1.md` — full change history + what was deliberately NOT built
- `.cursor/docs/ENTERPRISE_MATURITY_REPORT.md` — platform maturity scores + recommendations
- `.cursor/cache/repo-map.json` — live structural map (don't hand-edit; regenerated by `repo-discovery`)
- `memory-bank/README.md` — Tier 1 vs Tier 2 memory model explained
