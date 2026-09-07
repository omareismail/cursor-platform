---
name: react-i18n-rtl-gen
description: "react-i18n-rtl-gen wires internationalization into a component or feature while treating RTL layout as a first-class requirement, not an afterthought. Physical CSS direction properties (margin-left, padding-right, text-align: left) are replaced with logical equivalents (margin-inline-start, padding-inline-end, text-align: start) so the layout inverts correctly when dir='rtl' is applied. Invoked as /react-i18n-rtl-gen."
---

# react-i18n-rtl-gen

> **Registration shim.** Canonical instructions live in
> `.cursor/skills/react-i18n-rtl-gen/skill.md` - single source of truth, shared with Cursor.
> This file exists only so Claude Code discovers and auto-routes the skill.
> Regenerate with `node .claude/hooks/sync-skills.mjs`; never edit by hand.

## How to run this skill

1. **Read `.cursor/skills/react-i18n-rtl-gen/skill.md` now** and follow every step literally.
2. Apply the platform contract in `AGENTS.md`:
   - **Category:** A (generates/modifies files) - announce, then wait for go-ahead
   - Announcement (unless Category D): `**Matched skill:** react-i18n-rtl-gen - [one-line description].`
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
