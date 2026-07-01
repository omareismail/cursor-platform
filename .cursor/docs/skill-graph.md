# Skill Dependency Graph

This makes explicit what was previously implicit convention: which skills
depend on which other skills' output before they should run. Added in this
phase because at 47+ skills, "everyone reads memory-bank" stopped being a
precise enough contract — some skills need a live structural map
(`repo-discovery`), some need a concrete example to imitate (`pattern-finder`),
some only need the narrative standards (Tier 2 memory-bank), and conflating
these caused real risk on large repos (stale assumptions, regenerated code
that doesn't match what's actually in the codebase today).

## Foundational layer (everything else may depend on these)

```
repo-discovery
  └── writes .cursor/cache/repo-map.json
  └── consumed by: context-sync, pattern-finder, context-builder,
                    database-audit, devops-audit, api-consistency-audit,
                    enterprise-report-gen, 02-dotnet-architecture-guard.mdc,
                    06-database-provider-guard.mdc, dotnet-dependency-audit,
                    technical-debt-tracker

pattern-finder
  └── depends on: repo-discovery (repo-map.json must be fresh)
  └── consumed by: dotnet-endpoint-gen, dotnet-dapper-gen, dotnet-messaging-gen,
                    dotnet-background-job-gen, dotnet-caching-gen,
                    dotnet-iac-gen, react-component-gen, react-hook-gen,
                    react-api-layer-gen, react-state-machine-gen,
                    react-storybook-gen, react-module-federation-gen
                    (12 skills total — see shared-execution-pipeline.md Step 2)

context-builder (added Phase 5)
  └── depends on: repo-discovery, optionally pattern-finder's output if
                  already run for the same task
  └── consumed by: multi-file/cross-cutting tasks, manually invoked —
                  not a hard dependency of single-artifact *-gen skills
                  (see shared-execution-pipeline.md Step 3 for when this
                  applies vs. when pattern-finder alone is sufficient)
```

## Narrative layer

```
context-sync
  └── depends on: repo-discovery (Step 1 delegates to it, no longer rescans)
  └── writes: memory-bank/{techContext,systemPatterns,projectbrief,
              productContext,progress}.md
  └── consumed by: 00-memory-think.mdc (every skill, indirectly)
```

## Generator skills (the `*-gen` family)

Every `*-gen` skill follows the same contract as of this phase — **and as of
Pass 2, this is now implemented in the 9 affected skill files themselves**,
not just documented here:

```
1. Confirm repo-discovery is fresh (Step 0 freshness check)
2. Call pattern-finder for the target artifact type (now Step 0 in each
   skill's own file: dotnet-endpoint-gen, dotnet-dapper-gen,
   dotnet-messaging-gen, dotnet-background-job-gen, dotnet-caching-gen,
   react-component-gen, react-hook-gen, react-api-layer-gen,
   react-state-machine-gen)
3. Read the relevant Tier 2 convention file(s) for the prose rule
4. Generate code matching the pattern-finder example AND the Tier 2 rule
   — if they conflict, surface the conflict rather than silently picking one
```

## Audit skills

```
database-audit     → depends on repo-discovery; reuses dotnet-schema-diff's
                      catalog queries rather than redefining them; now also
                      includes the cross-provider SQL syntax/migration
                      portability check (identity/sequences, pagination,
                      date functions, parameter syntax, quoting, booleans,
                      JSON support) as Step 5b — added Phase 5 as an
                      extension rather than a separate validator skill
devops-audit        → depends on repo-discovery for the iac/Docker/CI
                      inventory; independent of database-audit and
                      architecture-map-gen
api-consistency-audit (added Phase 5) → depends on repo-discovery for the
                      endpoint inventory; cross-references
                      04-security-guard.mdc's auth findings rather than
                      re-flagging them independently
dotnet-schema-diff  → depends on repo-discovery for project/provider inventory
dotnet-query-optimizer → independent; profiles at runtime, doesn't need the
                      static repo-map
dotnet-perf-profile → independent, same reason
react-perf-audit    → independent
react-accessibility-audit → independent
code-review-assistant → depends on repo-discovery (to know which conventions
                      apply to the file under review) + relevant Tier 2 files
technical-debt-tracker → receives flagged findings from repo-discovery,
                      database-audit, devops-audit, api-consistency-audit,
                      pattern-finder (convention drift), and the two
                      clean-code-guard skills, rather than re-detecting the
                      same issues independently
refactor-assistant  → depends on dotnet-clean-code-guard, react-clean-code-guard,
                      and technical-debt-tracker (scan mode); does no
                      detection of its own — pure aggregation/prioritization
security-perf-report → depends on 04-security-guard.mdc (audit mode),
                      dotnet-perf-profile, react-perf-audit,
                      react-accessibility-audit; same pure-aggregation
                      pattern as refactor-assistant, kept as a separate
                      skill since security/performance/accessibility need
                      different responders, not flattened into one queue
enterprise-report-gen (added Phase 5) → pure aggregation over every audit
                      skill above plus architecture/compliance findings;
                      produces the named report types (production-readiness,
                      release-readiness, repository-health, dependency-health,
                      code-quality) with a standard template and an explicit
                      Go/No-Go for composite types — never re-ranks a source
                      skill's severity to produce a more favorable result
skill-maturity-audit (added Phase 5) → meta-skill; audits this workspace's
                      own skill files against shared-execution-pipeline.md
                      and skill-graph.md's own claims, rather than auditing
                      a target repository
```

## Execution layer (applies fixes — distinct from the read-only audit skills above)

```
refactor-apply (added Phase 6) → depends on dotnet-clean-code-guard,
                      react-clean-code-guard, and/or refactor-assistant's
                      consolidated report for its input; never scans code
                      itself. Depends on 09-minimal-changes.mdc for its
                      Tier 1/2 scoping rule (a finding that can't be fixed
                      within its own reported location is automatically
                      Tier 2, never Tier 1). Writes to technical-debt-tracker
                      for anything skipped or flagged rather than letting it
                      disappear. This is the only skill in the workspace
                      that both reads audit findings AND modifies source —
                      keep it that way; do not add write capability to
                      dotnet-clean-code-guard, react-clean-code-guard, or
                      refactor-assistant themselves, or detection and
                      execution start coupling again.
```

## Guard rules (`.mdc`, always-apply)

```
00-memory-think.mdc           → triggers repo-discovery's freshness check
                                 implicitly; reads memory-bank before action
01-specify-rules.mdc          → specs/src/frontend — no implementation without spec
02-dotnet-architecture-guard  → reads repo-map.json's dependencyGraph.cycles;
                                 Clean Architecture layer boundaries
03-react-architecture-guard   → component architecture, separation of concerns
04-security-guard             → OWASP, secrets, injection, auth
05-planning-rigor             → elicitation before any plan/spec/ADR
06-database-provider-guard    → reads repo-map.json's databaseProviders;
                                 multi-provider SQL dialect correctness
07-audit-trail-guard          → reads businessRules.md + repo-map.json;
                                 audit trails on financial/policy mutations;
                                 extended Phase 7: business domain invariants
                                 (financial precision, transactional consistency,
                                 downstream effect tracing on calculation changes)
08-rtl-i18n-guard              → RTL/bilingual layout, logical CSS, locale-aware
                                 formatting
09-minimal-changes (new Ph7)  → only modify what the task requires; no
                                 unrelated reformatting, renames, scope creep;
                                 global scope (all file types)
10-evidence-and-dependency-guard (new Ph7) → evidence-based assertions;
                                 verify existence before referencing classes/
                                 interfaces/tables/columns/config keys;
                                 no new NuGet/npm packages unless already
                                 present or explicitly requested; global scope
```

## Compliance layer

```
compliance-audit → depends on businessRules.md being current (authoritative,
                    refuses to invent regulatory detail if undocumented);
                    cross-references 07-audit-trail-guard's findings for
                    SAMA retention checks and devops-audit's deployment
                    region findings for SAMA data-residency checks, rather
                    than re-deriving either independently
```

## What this graph does NOT yet cover

Skills not yet wired into the dependency model: `dotnet-iac-gen`,
`dotnet-observability-gen`, `dotnet-migration`, `react-i18n-rtl-gen`,
`react-module-federation-gen`, `react-storybook-gen`, all `speckit-*` skills,
`onboarding-doc-gen`, `docs-guard`, `changelog-gen`, `release-notes-gen`,
`dependency-upgrade-guard`. Most of these don't need repo-map.json (e.g.
`changelog-gen` reads git history, not repo structure) — `onboarding-doc-gen`
and `docs-guard` are the two genuine candidates to wire in next, since
onboarding docs should reflect the same structural truth `repo-discovery`
already computes.

## Documentation/visualization layer

```
architecture-map-gen → depends on repo-discovery (no discovery of its own);
                        reads database-audit's last catalog findings for
                        Dapper-only tables when rendering ERDs; writes to
                        .cursor/docs/architecture/, linked from architecture.md;
                        now also renders service-interaction (sync calls,
                        distinct from service-map's async messaging) and
                        data-flow (combines both, single named flow only,
                        never whole-repo) — added Phase 5
```

## Prompt/elicitation layer

```
05-planning-rigor.mdc → alwaysApply, forces options-with-tradeoffs
                        elicitation before plans/specs/ADRs
speckit-clarify        → structured clarification inside the speckit pipeline
prompt-quality-audit (added Phase 5) → standalone, ad hoc version usable
                        outside the speckit pipeline — point it at any raw
                        prompt/request before deciding whether the full
                        speckit-specify flow is warranted at all
```

## Change history

Full pass-by-pass changelog of what was added, enhanced, or wired across
all phases is in `.cursor/docs/MIGRATION_NOTES_PASS1.md`. Read that file
before any future enhancement pass — it records what was deliberately not
built (to avoid duplication) as well as what was built, which is equally
important context for not rebuilding it later.


Every gap identified in the Phase 1 report is closed and wired. Beyond the
original 15 phases, two additional real gaps specific to this workspace's
actual GCC fintech context were identified and closed:

- **Audit trail enforcement** (`07-audit-trail-guard.mdc`) — `securityStandards.md`
  documented the requirement but nothing enforced it at generation/review
  time; directly relevant given RHODES's known journal-entry audit trail
  history.
- **RTL/bilingual layout correctness** (`08-rtl-i18n-guard.mdc`) —
  `react-i18n-rtl-gen` generates correctly when explicitly invoked, but
  nothing prevented ordinary component generation from regressing it.
- **`compliance-audit`** — SAMA/ZATCA/mada-specific checks, intentionally
  separate from the generic `04-security-guard.mdc`/`security-perf-report`
  (OWASP-scope) skills, and intentionally refuses to invent regulatory
  detail not already documented in `businessRules.md`.

What's left is genuinely open-ended maintenance, not deferred-but-known
work: keeping `businessRules.md`'s SAMA/ZATCA/mada sections current as
requirements evolve (this skill audits against documented requirements, it
doesn't track regulatory changes itself), and deeper per-language pattern
libraries inside `pattern-finder` as the codebase grows past what a single
`repo-map.json` conventions fingerprint can capture.
