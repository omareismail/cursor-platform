# Agent instructions

You work in a **flutter-platform** workspace: a lean skill library, guard
rules, and a memory-bank for Flutter/Dart mobile development. This is a
sibling platform to the .NET+React `cursor-platform` at the repo root — same
dual-agent architecture, same discipline, different stack. Follow this file
before generating or changing code.

## Session start (mandatory)

1. Read `memory-bank/activeContext.md`, `progress.md`, `techContext.md`,
   `architecture.md` (in that order; stop once you have enough context).
2. If Tier 1 files are empty or still placeholders → run `/context-sync`
   (after `/repo-discovery` if `repo-map.json` is missing).
3. When routing a request to a skill → read `.cursor/docs/skill-catalog.md`
   (full catalog) or `.cursor/docs/START-HERE.md` (quick task map).

## How to work

| Situation | Action |
|-----------|--------|
| User asks how an existing screen/flow works | `/feature-trace` — never answer from a guess about a codebase you have not read |
| User is about to change existing code | `/impact-analysis` **before** editing |
| Work is too big for one sitting | `/work-breakdown` — never hand-wave a multi-file change into one task |
| User asks if something is ready to ship | `/production-readiness-review` — and do not soften a NO-GO |
| User asks how a change reaches users | `/release-safety` — staged rollout, not a big-bang cutover |
| User asks to build or generate | Match a skill in `skill-catalog.md`; announce; wait for go-ahead |
| User asks to audit or review | Matching `*-audit` skill → announce, then proceed |
| New widget, screen, provider, repository, model, route, test | Use the matching `flutter-*-gen` skill — check `pattern-scout` output first |
| New repo, or repo without a memory-bank | `/repo-discovery` then `/context-sync` |

**Announcement format (required for every matched skill except housekeeping):**

> **Matched skill:** `skill-name` — [one-line description].

Generators and outer-loop skills (they write files or commit to a plan):
announce, then wait for go-ahead. Auditors and analysis skills (read-only):
announce, then proceed automatically. Housekeeping (`repo-discovery`,
`context-sync`): run silently.

## Rules (`.cursor/rules/` — you do not invoke these, they apply automatically)

**Always active (every session):** `00-memory-think`, `05-planning-rigor`,
`09-minimal-changes`, `10-evidence-and-dependency-guard`.

**Active when matching files are in context (globs):**
`01-flutter-architecture-guard` (`**/*.dart`),
`02-flutter-state-guard` (`**/*.dart`),
`03-flutter-security-guard` (any source/config file),
`04-flutter-test-guard` (`**/*_test.dart`).

Non-negotiables:

- Confirm packages, classes, providers, and config keys exist before
  referencing them. No new pub.dev package unless it is already in
  `pubspec.yaml` or explicitly requested by the user.
- Only change what the task requires — no unrelated reformatting or scope
  creep, no unrelated `dart format` sweeps across untouched files.
- **Architecture:** feature-first or layered (presentation/domain/data) —
  match whatever the repo already uses; no business logic inside widgets.
- **State:** Riverpod is the assumed default. Prefer `Notifier`/
  `AsyncNotifier` over `StateProvider` for anything with logic; `setState`
  is for pure-local, ephemeral UI state only (a text field's focus ring, an
  expansion tile's open/closed flag) — never for anything the app has a
  rule about.
- **Security:** no secrets in source; tokens and credentials go through
  `flutter_secure_storage`, never `SharedPreferences` in plaintext; no
  unvalidated input crossing a platform channel.
- **Tests:** widget tests wrap the tree in a `ProviderScope` with explicit
  `overrides`; assert behavior and rendered output, not provider internals.

## Memory-bank

| Layer | Location | Owner |
|-------|----------|-------|
| Machine (structure) | `.cursor/cache/repo-map.json` | `/repo-discovery` — never hand-edit |
| Tier 1 (dynamic) | `memory-bank/techContext.md`, `progress.md`, `activeContext.md` | `/context-sync` |
| Tier 2 (standards) | `architecture.md`, `domainRules.md`, `securityStandards.md` | Team — ask if undocumented |

## After significant work

Update `memory-bank/activeContext.md` and `memory-bank/progress.md` with what
changed and the next logical step.

## More detail

- [START-HERE.md](.cursor/docs/START-HERE.md) — task → skill map
- [skill-catalog.md](.cursor/docs/skill-catalog.md) — full skill catalog
- [memory-bank/README.md](memory-bank/README.md) — two-tier memory-bank pattern
