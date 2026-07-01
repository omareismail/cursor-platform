# Memory Bank

This folder is the agent's persistent context for this project. It is split into two
tiers because they change at different rates and are owned by different processes.
Treating them the same was the original gap in this workspace — rules referenced
`memory-bank/*.md` files that nothing ever created.

**New in this phase:** there's now a third, machine-readable layer underneath
both tiers — `.cursor/cache/repo-map.json`, owned by `/repo-discovery`. It is
the structural source of truth `context-sync` reads to produce Tier 1's
prose, and what `pattern-finder`/`database-audit`/the architecture and
database-provider guards check directly rather than re-scanning the repo
themselves. See `.cursor/docs/skill-graph.md` for the full dependency map.
Don't hand-edit `repo-map.json` — it's regenerated, not authored.

## Tier 1 — Dynamic (regenerated from the live codebase)

These files describe **the actual state of this specific repo right now**. They are
written by `/context-sync` on first run and kept current by `00-memory-think.mdc`
after every significant change. Don't hand-edit them for long — the next
`/context-sync` run may overwrite stale sections. Edit `activeContext.md` and
`WORKING_ON.md` freely; they're meant to be touched constantly.

| File | Owner | Refresh trigger |
|---|---|---|
| `techContext.md` | `/context-sync` | New package, framework upgrade |
| `systemPatterns.md` | `/context-sync` | New architectural pattern adopted |
| `projectbrief.md` | `/context-sync` | Project scope changes |
| `productContext.md` | `/context-sync` | Product purpose/users change |
| `progress.md` | `/context-sync`, `00-memory-think.mdc` | Task completed/started |
| `activeContext.md` | `00-memory-think.mdc` | Every session |
| `techDebt.md` | `technical-debt-tracker` | Debt found/resolved |
| `WORKING_ON.md` | `speckit-git-feature` | Feature branch created/merged |

## Tier 2 — Static reference (written once by the team, rarely regenerated)

These are **standards and conventions**, not a snapshot of code. They don't get
scanned out of the repo — a human (you, or you-as-architect via Cursor chat) decides
what they say, and skills/rules read them as ground truth to check generated code
against. Regenerating these automatically would be wrong: "what's our naming
convention" is a decision, not an observation.

| File | Read by |
|---|---|
| `architecture.md` | `dotnet-architecture-guard`, `react-architecture-guard`, all `*-gen` skills |
| `codingStandards.md` | `dotnet-clean-code-guard`, `react-clean-code-guard`, `code-review-assistant` |
| `businessRules.md` | all `*-gen` skills, `speckit-specify`, `speckit-clarify`, `compliance-audit` |
| `technologyStack.md` | `speckit-plan`, `dotnet-iac-gen`, `dependency-upgrade-guard` |
| `databaseConventions.md` | `dotnet-migration`, EF Core/Dapper skills (Phase 2) |
| `apiConventions.md` | `dotnet-endpoint-gen`, `react-api-layer-gen` |
| `frontendConventions.md` | `react-component-gen`, `react-hook-gen`, `react-clean-code-guard`, `08-rtl-i18n-guard.mdc` |
| `backendConventions.md` | `dotnet-endpoint-gen`, `dotnet-messaging-gen`, `dotnet-background-job-gen` |
| `securityStandards.md` | `04-security-guard.mdc`, `07-audit-trail-guard.mdc`, `react-accessibility-audit` (auth flows), `compliance-audit` |
| `performanceGuidelines.md` | `dotnet-perf-profile`, `react-perf-audit` |
| `testingStandards.md` | `dotnet-test-gen`, `react-test-gen` |
| `deploymentNotes.md` | `dotnet-iac-gen`, `release-notes-gen` |
| `decisionLog.md` | `speckit-adr`, `05-planning-rigor.mdc` |
| `commonMistakes.md` | `code-review-assistant`, `00-memory-think.mdc` |
| `glossary.md` | `speckit-specify`, `speckit-clarify`, `onboarding-doc-gen` |

## First run on a new project

See [`.cursor/docs/NEW-PROJECT.md`](../.cursor/docs/NEW-PROJECT.md) for the
full bootstrap checklist. Short version:

1. Run `/context-sync` to populate Tier 1 from the actual codebase.
2. Review Tier 2 files — they ship with realistic fintech/.NET/React examples so the
   format is clear, but the *content* is a starting point, not your project's truth.
   Replace the examples with your team's actual decisions.
3. Delete the `> EXAMPLE —` callout blocks once you've replaced them.
