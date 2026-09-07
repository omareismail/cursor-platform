---
name: task-verify
description: "Decides whether a task is actually done, from evidence, and blocks Done otherwise. Runs the task's Verify command and records the result, checks acceptance-criteria coverage via ac-trace.mjs, reads the tests for the failure modes a tool cannot catch (asserting the implementation, testing the mock, encoding the same misunderstanding as the code), and optionally runs mutation testing scoped to changed files. Use when asked to verify, validate, check, or sign off a task or feature, or whether something is really finished. Invoked as /task-verify."
---

# task-verify

> **Registration shim.** Canonical instructions live in
> `.cursor/skills/task-verify/skill.md` - single source of truth, shared with Cursor.
> This file exists only so Claude Code discovers and auto-routes the skill.
> Regenerate with `node .claude/hooks/sync-skills.mjs`; never edit by hand.

## How to run this skill

1. **Read `.cursor/skills/task-verify/skill.md` now** and follow every step literally.
2. Apply the platform contract in `AGENTS.md`:
   - **Category:** B (read-only analysis) - announce, then proceed
   - Announcement (unless Category D): `**Matched skill:** task-verify - [one-line description].`
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
