---
name: dotnet-query-optimizer
description: "dotnet-query-optimizer reviews an EF Core LINQ query or a Dapper SQL statement for performance issues and produces a before/after with the actual execution plan characteristics that change — not just 'this should be faster.' It is distinct from dotnet-perf-profile (which covers in-process/allocation concerns); this skill is specifically about what happens once the query reaches the database... Invoked as /dotnet-query-optimizer."
---

# dotnet-query-optimizer

> **Registration shim.** Canonical instructions live in
> `.cursor/skills/dotnet-query-optimizer/skill.md` - single source of truth, shared with Cursor.
> This file exists only so Claude Code discovers and auto-routes the skill.
> Regenerate with `node .claude/hooks/sync-skills.mjs`; never edit by hand.

## How to run this skill

1. **Read `.cursor/skills/dotnet-query-optimizer/skill.md` now** and follow every step literally.
2. Apply the platform contract in `AGENTS.md`:
   - **Category:** C (docs/diagrams) - announce, then proceed
   - Announcement (unless Category D): `**Matched skill:** dotnet-query-optimizer - [one-line description].`
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
