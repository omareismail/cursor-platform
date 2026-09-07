---
name: speckit-git-remote
description: "speckit-git-remote pushes the feature branch and generates a complete gh pr create command with a PR body auto-generated from the feature spec. The PR body includes the feature overview, the acceptance criteria checklist, a link to the spec file, and the spec compliance checklist from the PR template — so reviewers have full context without having to hunt for the spec. Invoked as /speckit-git-remote."
---

# speckit-git-remote

> **Registration shim.** Canonical instructions live in
> `.cursor/skills/speckit-git-remote/skill.md` - single source of truth, shared with Cursor.
> This file exists only so Claude Code discovers and auto-routes the skill.
> Regenerate with `node .claude/hooks/sync-skills.mjs`; never edit by hand.

## How to run this skill

1. **Read `.cursor/skills/speckit-git-remote/skill.md` now** and follow every step literally.
2. Apply the platform contract in `AGENTS.md`:
   - **Category:** E (spec pipeline) - announce, then wait for go-ahead
   - Announcement (unless Category D): `**Matched skill:** speckit-git-remote - [one-line description].`
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
