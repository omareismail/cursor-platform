---
name: repo-discovery
description: "repo-discovery is the hard precondition every generator and auditor skill in this workspace now depends on. Before this phase, context-sync did discovery as a side effect of writing techContext.md, and every other skill just trusted that memory-bank was current — true on a small repo, false on a repo with hundreds of projects where memory-bank can go stale between runs. Invoked as /repo-discovery."
---

# repo-discovery

> **Registration shim.** Canonical instructions live in
> `.cursor/skills/repo-discovery/skill.md` - single source of truth, shared with Cursor.
> This file exists only so Claude Code discovers and auto-routes the skill.
> Regenerate with `node .claude/hooks/sync-skills.mjs`; never edit by hand.

## How to run this skill

1. **Read `.cursor/skills/repo-discovery/skill.md` now** and follow every step literally.
2. Apply the platform contract in `AGENTS.md`:
   - **Category:** D (housekeeping) - run silently, no announcement
   - Announcement (unless Category D): `**Matched skill:** repo-discovery - [one-line description].`
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
