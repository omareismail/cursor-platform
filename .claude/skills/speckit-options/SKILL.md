---
name: speckit-options
description: "speckit-options is the standalone decision-support skill that produces a structured options-with-recommendation block for any architectural or technology decision. It can be invoked directly by the user, or called internally by speckit-clarify, speckit-plan, speckit-constitution, and any .NET or React generation skill that hits an ambiguous fork (e.g. Invoked as /speckit-options."
---

# speckit-options

> **Registration shim.** Canonical instructions live in
> `.cursor/skills/speckit-options/skill.md` - single source of truth, shared with Cursor.
> This file exists only so Claude Code discovers and auto-routes the skill.
> Regenerate with `node .claude/hooks/sync-skills.mjs`; never edit by hand.

## How to run this skill

1. **Read `.cursor/skills/speckit-options/skill.md` now** and follow every step literally.
2. Apply the platform contract in `AGENTS.md`:
   - **Category:** E (spec pipeline) - announce, then wait for go-ahead
   - Announcement (unless Category D): `**Matched skill:** speckit-options - [one-line description].`
3. Guard rules in `.cursor/rules/` are binding. Claude Code does not auto-load
   `.mdc` files, so read the matching rule before generating:

   | Files touched | Read first (in `.cursor/rules/`) |
   |---|---|
   | `**/*.cs`, `**/*.csproj` | `02-dotnet-architecture-guard.mdc`, `07-audit-trail-guard.mdc` |
   | `**/*.tsx`, `**/*.ts` | `03-react-architecture-guard.mdc`, `08-rtl-i18n-guard.mdc` |
   | `**/*.sql`, `**/*.cs` | `06-database-provider-guard.mdc` |
   | any of the above | `04-security-guard.mdc` |

   Rules `00`, `05`, `09`, `10` are always binding - summarised in `CLAUDE.md`
   and injected by the `SessionStart` hook.
4. After significant work, update `memory-bank/activeContext.md` and
   `memory-bank/progress.md`.
