---
name: react-storybook-gen
description: "react-storybook-gen generates Storybook stories covering every meaningful prop and state combination for a component, so visual review is possible without running the full application. It reads the component's TypeScript props interface to enumerate variants, and generates one story per significant combination: default, loading, error, empty, disabled, and RTL where applicable. Invoked as /react-storybook-gen."
---

# react-storybook-gen

> **Registration shim.** Canonical instructions live in
> `.cursor/skills/react-storybook-gen/skill.md` - single source of truth, shared with Cursor.
> This file exists only so Claude Code discovers and auto-routes the skill.
> Regenerate with `node .claude/hooks/sync-skills.mjs`; never edit by hand.

## How to run this skill

1. **Read `.cursor/skills/react-storybook-gen/skill.md` now** and follow every step literally.
2. Apply the platform contract in `AGENTS.md`:
   - **Category:** A (generates/modifies files) - announce, then wait for go-ahead
   - Announcement (unless Category D): `**Matched skill:** react-storybook-gen - [one-line description].`
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
