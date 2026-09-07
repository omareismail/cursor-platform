# Skill: impact-analysis

**Invocation:** `/impact-analysis "[proposed change]"`

---

## Overview

`impact-analysis` determines the blast radius of a proposed change before
it's made — which widgets, providers, repositories, routes, and tests are
affected — so a change that looks local (e.g. "rename this field on the
`Order` model") doesn't silently break three screens and a golden test.
Run this **before** editing existing code, per `AGENTS.md`.

**Memory references:** `memory-bank/architecture.md`.

**Guard rules:** none directly — this is the pre-check that lets
`09-minimal-changes.mdc` and `01-flutter-architecture-guard.mdc` be
respected with full information.

---

## Steps

**Step 0 — Run (or reuse) a `feature-trace`** if the change touches an
existing flow — don't re-derive the trace from scratch if one was just
produced in this session.

**Step 1 — Find every reference to the changed symbol.** Grep the whole
`lib/` and `test/` tree for the class/field/provider/route name being
changed. Distinguish:
- **Direct consumers** — code that reads/calls it
- **Test consumers** — tests that assert on it directly or via a fixture
- **Generated-code consumers** — `.g.dart`/`.freezed.dart` files that will
  regenerate, and any code depending on their generated shape (e.g. a
  `copyWith` call site)

**Step 2 — Classify each reference by risk.**

| Risk | Meaning |
|---|---|
| Breaking | Won't compile / will throw at runtime without a matching change |
| Behavioral | Compiles, but behavior changes (a default value shift, a status enum reorder affecting a `switch`) |
| Cosmetic | No functional effect (a rename that's purely internal) |

**Step 3 — Check `.arb`/localization keys** if the change touches
user-facing text — a removed model field that was interpolated into a
localized string leaves a dangling placeholder.

**Step 4 — Check golden tests.** If the repo has golden tests
(`goldens/` present) and the change affects a widget's visual output, flag
that goldens will need regeneration — this is a deliberate step
(`flutter test --update-goldens`), not implied by the code change alone.

**Step 5 — Report.**

```markdown
## Impact Analysis — Rename `Order.totalAmount` → `Order.total`

**Breaking (6):**
- lib/features/orders/data/api_order_repository.dart:22 (`@JsonKey` mapping)
- lib/features/orders/presentation/order_detail_screen.dart:41
- test/features/orders/domain/order_test.dart:14, 19

**Behavioral (0)**

**Cosmetic (1):**
- lib/features/orders/domain/order.dart (the field declaration itself)

**Also regenerate:** `order.freezed.dart`, `order.g.dart` via `build_runner`

**Recommendation:** touches 7 files across 2 layers — within
`work-breakdown`'s single-task limit (≤8 files, ≤2 layers) if done as one
task; do it in one pass rather than splitting, since a partial rename
leaves the codebase non-compiling.
```

---

## Example

Request: `/impact-analysis "remove the guest-checkout code path"` —
produces a full reference list across screens, providers, routes, and
tests, classified by risk, so the removal is planned rather than
discovered-by-compiler-error one file at a time.
