---
name: repo-discovery
description: "Scans a Flutter repository's pubspec.yaml, lib/ structure, and actual state-management/routing/testing conventions in use, and writes the structural map other skills and context-sync read from. Use at the start of a session in an unmapped repo. Invoked as /repo-discovery."
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
   | `**/*.dart` (widgets, screens, features) | `01-flutter-architecture-guard.mdc` |
   | `**/*.dart` (providers, notifiers, state) | `02-flutter-state-guard.mdc` |
   | any source or config file | `03-flutter-security-guard.mdc` |
   | `**/*_test.dart` | `04-flutter-test-guard.mdc` |

   Rules `00`, `05`, `09`, `10` are always binding - summarised in `CLAUDE.md`
   and injected by the `SessionStart` hook.
4. After significant work, update `memory-bank/activeContext.md` and
   `memory-bank/progress.md`.
