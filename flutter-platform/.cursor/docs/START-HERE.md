# Start Here — task → skill map

Quick lookup: find what you want to do on the left, run the skill on the
right. For the full catalog with descriptions, see
[skill-catalog.md](skill-catalog.md).

## First time in a repo

| I want to... | Run |
|---|---|
| Understand a Flutter repo I haven't mapped yet | `/repo-discovery` |
| Populate the memory-bank from that scan | `/context-sync` |

## Build something new

| I want to... | Run |
|---|---|
| Add a reusable widget (card, tile, button variant) | `/flutter-widget-gen` |
| Add a full screen with state and navigation | `/flutter-screen-gen` |
| Add Riverpod state management for something | `/flutter-provider-gen` |
| Add a data-layer repository / API client | `/flutter-repository-gen` |
| Add a data model (freezed + json_serializable) | `/flutter-model-gen` |
| Wire a new route into go_router | `/flutter-route-gen` |
| Add missing test coverage to existing code | `/flutter-test-gen` |
| Localize new user-facing strings | `/flutter-l10n-gen` |

## Understand or change existing code

| I want to... | Run |
|---|---|
| Know how a screen or flow works today | `/feature-trace "<name>"` |
| Know what breaks if I change something | `/impact-analysis "<change>"` |
| Break a feature/bug/refactor into sized tasks | `/work-breakdown [source]` |

## Review and audit

| I want to... | Run |
|---|---|
| Check for layering/architecture violations | `/flutter-architecture-audit` |
| Check for rebuild/jank/performance issues | `/flutter-performance-audit` |
| Check for screen-reader/tap-target/contrast issues | `/flutter-accessibility-audit` |
| Check pubspec.yaml for unused/stale/duplicate packages | `/flutter-dependency-audit` |

## Ship it

| I want to... | Run |
|---|---|
| Know if this is ready to ship | `/production-readiness-review` |
| Plan a staged rollout and rollback | `/release-safety` |

## Not sure which skill?

Read [skill-catalog.md](skill-catalog.md) for the full list with
one-line descriptions, or just describe the task — `AGENTS.md`'s routing
table and `.cursor/rules/00-memory-think.mdc` cover the match logic.
