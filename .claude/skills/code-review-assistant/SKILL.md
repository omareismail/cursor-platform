---
name: code-review-assistant
description: "code-review-assistant produces a structured review of a pull request or diff against the active spec and the architecture/security rules. It is distinct from speckit-checklist (which is a pre-commit self-gate by the author) — this skill is for reviewing someone else's PR, or doing a second pass before requesting review on your own. Invoked as /code-review-assistant."
---

# code-review-assistant

> **Registration shim.** Canonical instructions live in
> `.cursor/skills/code-review-assistant/skill.md` - single source of truth, shared with Cursor.
> This file exists only so Claude Code discovers and auto-routes the skill.
> Regenerate with `node .claude/hooks/sync-skills.mjs`; never edit by hand.

## How to run this skill

1. **Read `.cursor/skills/code-review-assistant/skill.md` now** and follow every step literally.
2. Apply the platform contract in `AGENTS.md`:
   - **Category:** C (docs/diagrams) - announce, then proceed
   - Announcement (unless Category D): `**Matched skill:** code-review-assistant - [one-line description].`
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
