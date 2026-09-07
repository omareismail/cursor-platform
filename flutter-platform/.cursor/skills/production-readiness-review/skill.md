# Skill: production-readiness-review

**Invocation:** `/production-readiness-review [feature/app]`

---

## Overview

The Go/No-Go gate before a Flutter app or feature ships. Reviews crash
reporting, ANR/crash budget, offline handling, and the store-review
checklist, and returns a blocking verdict with evidence — never a softened
"mostly ready." Mirrors the sibling platform's production-readiness-review
but scoped to what's specific to a mobile client rather than a backend
service (no SLO/error-budget infra review here — see `release-safety` for
rollout and `flutter-performance-audit` for runtime performance).

**Memory references:** `memory-bank/architecture.md`,
`memory-bank/securityStandards.md`.

**Guard rules:** none directly — this synthesizes findings other skills
already have rules for (`03-flutter-security-guard.mdc`,
`04-flutter-test-guard.mdc`).

---

## Steps

**Step 1 — Crash reporting wired.** Confirm a crash-reporting SDK
(Firebase Crashlytics, Sentry, or whatever's already in `pubspec.yaml`) is
initialized in `main.dart` before `runApp`, that `FlutterError.onError` and
`PlatformDispatcher.instance.onError` are both wired to report uncaught
Dart and platform errors, and that it's active in release builds (not
accidentally gated behind a debug-only flag). No crash reporting = No-Go,
full stop — flying blind on production crashes is not a "nice to have."

**Step 2 — ANR/crash budget.** If the app has a prior release to compare
against (via the crash-reporting dashboard, described conceptually here
since this skill has no live dashboard access), state the crash-free
session rate / ANR rate threshold this release must not regress past. If
there's no established baseline yet, flag that as a gap to close before
this becomes a repeatable gate, not a reason to skip the check this time.

**Step 3 — Offline handling.** For each screen/flow in scope, confirm:
- A network failure surfaces a retry-able error state (per
  `flutter-provider-gen`'s `AsyncValue.guard` pattern), not a silent hang
  or an uncaught exception crashing the screen
- Any locally-cached/offline-first data has a clear staleness indicator if
  the app claims offline support (don't show week-old data as if it's
  live with no signal to the user)

**Step 4 — Store review checklist.** Platform-specific items that block
submission or cause rejection, checked against what's actually in the app
(not assumed):
- Privacy policy URL present and accessible (both stores require this)
- Permission usage strings (`NSCameraUsageDescription`,
  `AndroidManifest.xml` permission declarations) match what the app
  actually does — a requested permission with no matching usage in-app is
  a common rejection reason
- App icons/screenshots present for required device sizes
- If the app collects data, the store's data-safety/privacy nutrition
  label content matches what's actually collected — check against
  `memory-bank/securityStandards.md` for what's collected

**Step 5 — Verdict.**

```markdown
## Production Readiness Review — [feature/app]

| Dimension | Status | Evidence |
|---|---|---|
| Crash reporting | ✅ PASS | Crashlytics initialized in main.dart:14, onError wired |
| Offline handling | ❌ FAIL | order_history_screen.dart has no error state — AsyncValue.error case unhandled |
| Store checklist | ⚠ PARTIAL | Camera permission declared but no matching usage string found |

## Verdict: NO-GO

Blocking: offline error handling missing on order history screen; camera
permission usage string missing (App Store rejection risk).

Not blocking, track separately: no established crash-free-rate baseline
yet for future releases to compare against.
```

Never soften a NO-GO into a "ready with caveats" — a blocked verdict stays
blocked until the blocking items are fixed and re-checked.

---

## Example

Request: "Is the 2.4.0 release ready to ship?"

Output: the table and verdict above, scoped to whatever changed in 2.4.0,
with each row backed by a specific file/line or an explicit "could not
verify — no dashboard access in this environment" rather than a guess.
