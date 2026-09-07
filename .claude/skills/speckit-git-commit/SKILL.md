---
name: speckit-git-commit
description: "speckit-git-commit generates a Conventional Commits-compliant commit message from the staged diff and the active feature context. It reads WORKING_ON.md to get the spec reference and feature name, analyses the staged changes to determine the correct type and scope, and detects breaking changes automatically. Invoked as /speckit-git-commit."
---

# speckit-git-commit

> **Registration shim.** Canonical instructions live in
> `.cursor/skills/speckit-git-commit/skill.md` - single source of truth, shared with Cursor.
> This file exists only so Claude Code discovers and auto-routes the skill.
> Regenerate with `node .claude/hooks/sync-skills.mjs`; never edit by hand.

## How to run this skill

1. **Read `.cursor/skills/speckit-git-commit/skill.md` now** and follow every step literally.
2. Apply the platform contract in `AGENTS.md`:
   - **Category:** E (spec pipeline) - announce, then wait for go-ahead
   - Announcement (unless Category D): `**Matched skill:** speckit-git-commit - [one-line description].`
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
