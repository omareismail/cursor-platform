# Skill: flutter-test-gen

**Invocation:** `/flutter-test-gen [target file/widget/provider]`

---

## Overview

`flutter-test-gen` scaffolds widget or unit tests for an existing
widget/screen/Notifier/repository that doesn't have coverage yet, following
`04-flutter-test-guard.mdc` — `ProviderScope` overrides for widget tests,
`ProviderContainer` for Notifier tests, fakes/mocks for repositories.
Other `*-gen` skills already generate a test alongside new code; this skill
is for backfilling tests onto existing code, or expanding coverage an audit
flagged as thin.

**Memory references:** `memory-bank/techContext.md` (mocktail vs mockito).

**Guard rules:** `04-flutter-test-guard.mdc` (primary).

---

## Steps

**Step 0 — Identify what's under test and its dependencies.** Read the
target file. List every provider/repository/service it depends on — each
needs an override or fake in the test.

**Step 1 — Widget under test.** Wrap in `ProviderScope` with overrides for
every provider it reads (directly or transitively through a watched
Notifier), per the pattern in `04-flutter-test-guard.mdc`. Cover:
- The happy-path render with representative data
- Loading state (if the widget watches an `AsyncValue`)
- Error state with retry, if the widget has a retry action
- Empty-data state, if meaningfully different from populated

**Step 2 — Notifier/AsyncNotifier under test.** Use a `ProviderContainer`
with the repository provider overridden to a fake. Assert the emitted
`state` sequence for each public method — success and at least one failure
path.

**Step 3 — Repository under test.** Mock the HTTP client
(`mocktail`/`mockito`, whichever is already a dev dependency — confirm,
don't add a new one). Assert the success path maps JSON correctly and at
least one error path maps to the correct typed exception.

**Step 4 — Do not test implementation details.** No asserting on a
`Notifier`'s private fields, no asserting a `build()` method was called a
specific number of times, no testing that a mock was constructed a certain
way if the test doesn't also assert the resulting behavior. Every
assertion must be able to fail for a real reason — a test that can never
fail (asserting on a constant, or on a value the test itself just set) adds
false coverage.

**Step 5 — Name tests by behavior, not by method.** `'shows retry button
when fetch fails'`, not `'test build method'` — the test name is the
first thing a failing-CI reader sees.

---

## Example

Request: "This repository has no tests, add coverage."

Output: `test/features/orders/data/api_order_repository_test.dart` with
cases for successful fetch, 404 mapped to `OrderNotFoundException`, and
timeout mapped to `OrderNetworkException` — using the mock HTTP client
package already present in `pubspec.yaml`.
