---
name: impact-analysis
description: "Determines the blast radius of a proposed change before it's made - every widget, provider, repository, route, and test that references the changed symbol, classified as breaking/behavioral/cosmetic, including golden-test and generated-code impact. Use before editing existing code, or when asked what breaks if something changes. Invoked as /impact-analysis."
---

# impact-analysis

> **Registration shim.** Canonical instructions live in
> `.cursor/skills/impact-analysis/skill.md` - single source of truth, shared with Cursor.
> This file exists only so Claude Code discovers and auto-routes the skill.
> Regenerate with `node .claude/hooks/sync-skills.mjs`; never edit by hand.

## How to run this skill

1. **Read `.cursor/skills/impact-analysis/skill.md` now** and follow every step literally.
2. Apply the platform contract in `AGENTS.md`:
   - **Category:** B (read-only analysis) - announce, then proceed
   - Announcement (unless Category D): `**Matched skill:** impact-analysis - [one-line description].`
3. Guard rules in `.cursor/rules/` are binding. Claude Code does not auto-load
   `.mdc` files, so read the matching rule before generating:

   | Files touched | Read first (in `.cursor/rules/`) |
   |---|---|
   | `**/*.dart` (widgets, screens, features) | `01-flutter-architecture-guard.mdc` |
   | `**/*.dart` (providers, notifiers, state) | `02-flutter-state-guard.mdc` |
   | any source or config file | `03-flutter-security-guard.mdc` |
   | `**/*_test.dart` | `04-flutter-test-guard.mdc` |

   Rules `00`, `05`, `09`, `10` are always binding - summarised in `CLAUDE.md`
   and injected by the `SessionStart` hook.
4. After significant work, update `memory-bank/activeContext.md` and
   `memory-bank/progress.md`.
