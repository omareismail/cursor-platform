---
name: react-clean-code-guard
description: "react-clean-code-guard performs a comprehensive static review of a React/TypeScript codebase against the architecture rules in 03-react-architecture-guard.mdc, TypeScript best practices, accessibility basics, and code quality standards. Like its .NET counterpart, every finding includes the file location, a one-sentence problem description, and a one-sentence fix. Invoked as /react-clean-code-guard."
---

# react-clean-code-guard

> **Registration shim.** Canonical instructions live in
> `.cursor/skills/react-clean-code-guard/skill.md` - single source of truth, shared with Cursor.
> This file exists only so Claude Code discovers and auto-routes the skill.
> Regenerate with `node .claude/hooks/sync-skills.mjs`; never edit by hand.

## How to run this skill

1. **Read `.cursor/skills/react-clean-code-guard/skill.md` now** and follow every step literally.
2. Apply the platform contract in `AGENTS.md`:
   - **Category:** B (read-only analysis) - announce, then proceed
   - Announcement (unless Category D): `**Matched skill:** react-clean-code-guard - [one-line description].`
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
