# Memory Bank

This folder is the agent's persistent context for this Flutter project. It
is split into two tiers because they change at different rates and are
owned by different processes.

There's also a machine-readable layer underneath both tiers —
`.cursor/cache/repo-map.json`, owned by `/repo-discovery`. It is the
structural source of truth `/context-sync` reads to produce Tier 1's prose.
Don't hand-edit `repo-map.json` — it's regenerated, not authored.

## Tier 1 — Dynamic (regenerated from the live codebase)

These files describe **the actual state of this specific repo right now**.
They are written by `/context-sync` on first run and kept current by
`00-memory-think.mdc` after every significant change. Edit
`activeContext.md` freely — it's meant to be touched constantly.

| File | Owner | Refresh trigger |
|---|---|---|
| `techContext.md` | `/context-sync` | New package, SDK upgrade, state-management convention change |
| `progress.md` | `/context-sync`, `00-memory-think.mdc` | Task completed/started |
| `activeContext.md` | `00-memory-think.mdc` | Every session |

## Tier 2 — Static reference (written once by the team, rarely regenerated)

These are **standards and conventions**, not a snapshot of code. A human
decides what they say; skills and rules read them as ground truth to check
generated code against. Regenerating these automatically would be wrong —
"what's our folder convention" is a decision, not an observation.

| File | Read by |
|---|---|
| `architecture.md` | `01-flutter-architecture-guard.mdc`, all `flutter-*-gen` skills, `pattern-scout` |
| `domainRules.md` | all `flutter-*-gen` skills, `feature-trace`, `impact-analysis` |
| `securityStandards.md` | `03-flutter-security-guard.mdc`, `mobile-security-auditor` |

## First run on a new project

1. Run `/repo-discovery` to scan the actual codebase into
   `.cursor/cache/repo-map.json`.
2. Run `/context-sync` to populate Tier 1 (`techContext.md`, `progress.md`,
   `activeContext.md`) from that scan.
3. Review the Tier 2 files — they ship with `> EXAMPLE —` placeholder
   blocks so the format is clear, but the *content* is a starting point,
   not your project's truth. Replace the examples with your team's actual
   decisions and delete the `> EXAMPLE —` blocks.

## Why "domainRules.md" instead of "businessRules.md"

The sibling `cursor-platform` (.NET + React, fintech-flavored) calls this
file `businessRules.md`. This platform is general-purpose — a to-do app and
a fintech app both have domain rules, but "business rules" carries a
specific regulated-industry connotation this platform doesn't assume.
Same role, more neutral name.
