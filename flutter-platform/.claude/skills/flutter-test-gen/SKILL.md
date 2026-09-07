---
name: flutter-test-gen
description: "Backfills widget, Notifier, or repository tests onto existing Flutter code using ProviderScope overrides, ProviderContainer, and mocktail/mockito fakes, covering loading/error/empty states and asserting behavior rather than implementation. Use when asked to add test coverage to existing code. Invoked as /flutter-test-gen."
---

# flutter-test-gen

> **Registration shim.** Canonical instructions live in
> `.cursor/skills/flutter-test-gen/skill.md` - single source of truth, shared with Cursor.
> This file exists only so Claude Code discovers and auto-routes the skill.
> Regenerate with `node .claude/hooks/sync-skills.mjs`; never edit by hand.

## How to run this skill

1. **Read `.cursor/skills/flutter-test-gen/skill.md` now** and follow every step literally.
2. Apply the platform contract in `AGENTS.md`:
   - **Category:** A (generates/modifies files) - announce, then wait for go-ahead
   - Announcement (unless Category D): `**Matched skill:** flutter-test-gen - [one-line description].`
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
