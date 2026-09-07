---
name: work-breakdown
description: "Decomposes any unit of work - a spec, a traced feature, an impact-analysis result, a bug, a refactor, or a migration - into a validated board of tasks small enough for one agent session to finish. Presents vertical / horizontal / risk-first slicing options with tradeoffs, then enforces sizing with task-graph.mjs: max 8 files, max 2 layers, a verify command per task, no dependency cycles. Use when asked to break down, split, decompose, plan out, or sequence work, or when a task is too big to execute. Invoked as /work-breakdown."
---

# work-breakdown

> **Registration shim.** Canonical instructions live in
> `.cursor/skills/work-breakdown/skill.md` - single source of truth, shared with Cursor.
> This file exists only so Claude Code discovers and auto-routes the skill.
> Regenerate with `node .claude/hooks/sync-skills.mjs`; never edit by hand.

## How to run this skill

1. **Read `.cursor/skills/work-breakdown/skill.md` now** and follow every step literally.
2. Apply the platform contract in `AGENTS.md`:
   - **Category:** A (generates/modifies files) - announce, then wait for go-ahead
   - Announcement (unless Category D): `**Matched skill:** work-breakdown - [one-line description].`
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
