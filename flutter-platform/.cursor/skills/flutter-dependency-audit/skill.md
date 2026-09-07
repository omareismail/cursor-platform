# Skill: flutter-dependency-audit

**Invocation:** `/flutter-dependency-audit`

---

## Overview

`flutter-dependency-audit` reviews `pubspec.yaml` for unused packages,
outdated pinned versions, and packages worth checking against pub.dev's
own advisory/scoring signals — the dependency-hygiene analog of
`dotnet-dependency-audit` in the sibling .NET platform. Read-only. Does not
run `flutter pub upgrade` or modify `pubspec.yaml` — recommends changes for
the developer to apply deliberately, per `10-evidence-and-dependency-
guard.mdc`.

**Memory references:** `memory-bank/techContext.md` (pinned Flutter/Dart
SDK version — some package version bumps require a newer SDK floor).

**Guard rules:** `10-evidence-and-dependency-guard.mdc` (this audit informs
that rule's dependency-safety checks, it does not override them).

---

## Steps

**Step 1 — Unused packages.** For each dependency in `pubspec.yaml`
(excluding `flutter`, `flutter_test`, and SDK packages), grep `lib/` for
an `import 'package:<name>/...'`. A dependency with zero import sites is a
candidate for removal — flag it rather than removing it, since a
transitive-use case (a build plugin invoked only from `pubspec.yaml`
itself, e.g. `flutter_launcher_icons`) can look unused by grep alone.

**Step 2 — Version currency.** For each pinned dependency, note whether
it's pinned to an exact version (`1.2.3`) vs a caret range (`^1.2.3`) vs
`any`. Exact pins on packages with no stated reason (no comment explaining
why) are a finding — they silently prevent picking up patch fixes. This
audit does not fetch live pub.dev version data unless a web-fetch tool is
available in the current environment; if it isn't, say so explicitly
rather than guessing a "latest version."

**Step 3 — Duplicate-purpose packages.** Check for two packages doing the
same job (`http` and `dio` both present, `provider` and `flutter_riverpod`
both present) — a strong signal of an incomplete migration or drift from
the platform's stated Riverpod default. Flag which one appears to be the
active convention (more recent imports, more usage sites) and which looks
like the leftover.

**Step 4 — dev_dependencies hygiene.** Confirm `build_runner`,
`freezed`, `json_serializable`, `riverpod_generator` (if used) are in
`dev_dependencies`, not `dependencies` — a codegen-only package in
`dependencies` bloats the shipped app for no reason.

**Step 5 — Report.**

```markdown
## Flutter Dependency Audit

| Severity | Package | Issue | Recommendation |
|---|---|---|---|
| Medium | `http: ^0.13.0` | No import sites found in lib/ | Confirm unused, then remove |
| Medium | `dio` + `http` both present | Duplicate HTTP clients — `dio` used in 9 files, `http` in 1 (legacy) | Migrate the remaining `http` call site to `dio`, drop `http` |
| Low | `intl: 0.18.1` | Exact-pinned with no comment | Consider `^0.18.1` unless there's a known reason to hold |

### Summary
[N] findings. This audit does not modify `pubspec.yaml` — apply changes
deliberately and run `flutter pub get` + the full test suite after.
```

---

## Example

Request: "Audit our dependencies."

Output: a table flagging the unused/duplicate/stale packages found, with
explicit acknowledgment of what this audit could and couldn't verify
(e.g. "no live pub.dev advisory check available in this environment —
cross-check manually for security advisories on flagged packages").
