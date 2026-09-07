---
name: speckit-implement
description: "speckit-implement generates production-ready code for a single task from the plan task board — one task at a time, never batching multiple tasks in one call. Before generating any code it runs a mandatory pre-flight check: the spec must exist, all dependency tasks must be Done, and the project type must be confirmed. Invoked as /speckit-implement."
---

# speckit-implement

> **Registration shim.** Canonical instructions live in
> `.cursor/skills/speckit-implement/skill.md` - single source of truth, shared with Cursor.
> This file exists only so Claude Code discovers and auto-routes the skill.
> Regenerate with `node .claude/hooks/sync-skills.mjs`; never edit by hand.

## How to run this skill

1. **Read `.cursor/skills/speckit-implement/skill.md` now** and follow every step literally.
2. Apply the platform contract in `AGENTS.md`:
   - **Category:** E (spec pipeline) - announce, then wait for go-ahead
   - Announcement (unless Category D): `**Matched skill:** speckit-implement - [one-line description].`
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
