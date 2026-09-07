# Skill Catalog — flutter-platform

19 skills across 5 categories. Every skill's canonical instructions live at
`.cursor/skills/<name>/skill.md`; the `.claude/skills/<name>/SKILL.md` files
are generated shims pointing back at them (see
`.claude/hooks/sync-skills.mjs`).

**Categories** (announcement/wait behavior, per `AGENTS.md`):
- **A** — generates/modifies files: announce, then wait for go-ahead
- **B** — read-only analysis/audit: announce, then proceed
- **C** — planning/docs: announce, then proceed
- **D** — housekeeping: run silently

---

## Generators (A)

| Skill | Description |
|---|---|
| `flutter-widget-gen` | Generates a single reusable, presentation-only widget matching this repo's conventions, with a `const` constructor, accessibility labels, and a widget test. |
| `flutter-screen-gen` | Generates a full screen in one pass: screen widget, backing `AsyncNotifier`/`Notifier`, and `go_router` route registration, handling all `AsyncValue` states. |
| `flutter-provider-gen` | Scaffolds a Riverpod `Notifier`/`AsyncNotifier` (codegen or manual, matching repo convention) with `AsyncValue.guard`-wrapped mutations. |
| `flutter-repository-gen` | Generates a data-layer repository: abstract interface, API-client-backed implementation with typed error mapping, and provider binding. |
| `flutter-model-gen` | Generates an immutable `freezed` + `json_serializable` model with correct `@JsonKey` mapping and a round-trip test. |
| `flutter-route-gen` | Registers a new `go_router` route (path, params, auth `redirect` guard, shell nesting). |
| `flutter-test-gen` | Backfills widget/Notifier/repository tests onto existing code using `ProviderScope` overrides and fakes. |
| `flutter-l10n-gen` | Adds `.arb` localization keys with ICU placeholders, flags untranslated locales, wires the generated `AppLocalizations` accessor. |

## Auditors (B)

| Skill | Description |
|---|---|
| `flutter-architecture-audit` | Layering violations — business logic in widgets, data-layer bypassing repository interfaces, misplaced provider scope, feature-boundary leaks. |
| `flutter-performance-audit` | Missing `const`, over-broad `ref.watch`, `ListView`/`Column` vs `.builder`, image caching, expensive work in `build()`. |
| `flutter-accessibility-audit` | Missing `Semantics` labels, sub-48dp tap targets, contrast candidates, unlabeled form fields. |
| `flutter-dependency-audit` | `pubspec.yaml` unused/stale/duplicate-purpose packages, dev-only codegen packages misplaced. |

## Feature analysis / planning (B / C)

| Skill | Description |
|---|---|
| `feature-trace` | Traces how an existing screen/flow works — route → widget → providers → Notifiers → repositories → data source. |
| `impact-analysis` | Blast radius of a proposed change — every reference, classified breaking/behavioral/cosmetic, including goldens and generated code. |
| `work-breakdown` | Decomposes work into a sized task board (≤8 files, ≤2 layers/task) with slicing-option elicitation first. |

## Outer loop — shipping and running it (B / C)

| Skill | Description |
|---|---|
| `release-safety` | Staged Play Console/App Store Connect rollout, feature-flag lifecycle (owner + expiry), explicit rollback plan. |
| `production-readiness-review` | Go/No-Go gate: crash reporting wired, offline/error-state handling, store submission checklist. |

## Bootstrap / housekeeping (D)

| Skill | Description |
|---|---|
| `repo-discovery` | Scans `pubspec.yaml`, `lib/` structure, and the actual state-management/routing/testing conventions in use; writes `repo-map.json`. |
| `context-sync` | Populates Tier 1 memory-bank files from the `repo-discovery` scan and git state, without touching Tier 2. |

---

## Subagents (Claude Code context isolation)

| Subagent | Use for |
|---|---|
| `pattern-scout` | Canonical local example before any `flutter-*-gen` skill. |
| `flutter-auditor` | Architecture/state/performance review spanning >5 files. |
| `mobile-security-auditor` | Secrets, secure storage, platform-channel, deep-link review. |
| `repo-cartographer` | Structural scan for `repo-discovery`/`context-sync`. |

## Rules

| Rule | Scope |
|---|---|
| `00-memory-think` | always-on |
| `05-planning-rigor` | always-on |
| `09-minimal-changes` | always-on |
| `10-evidence-and-dependency-guard` | always-on |
| `01-flutter-architecture-guard` | `**/*.dart` |
| `02-flutter-state-guard` | `**/*.dart` |
| `03-flutter-security-guard` | any source/config |
| `04-flutter-test-guard` | `**/*_test.dart` |
