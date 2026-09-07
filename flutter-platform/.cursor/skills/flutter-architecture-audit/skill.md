# Skill: flutter-architecture-audit

**Invocation:** `/flutter-architecture-audit [scope]`

---

## Overview

`flutter-architecture-audit` reviews a Flutter codebase (or a specified
feature/directory) for layering violations against
`01-flutter-architecture-guard.mdc`: business logic leaking into widgets,
data-layer classes imported directly by presentation, providers declared in
the wrong scope, and feature-first boundary violations (one feature
importing another feature's internals instead of its public surface).
Read-only — produces a findings report, does not fix anything (see
`flutter-widget-gen`/`flutter-provider-gen` or a manual fix for that).

**Memory references:** `memory-bank/architecture.md` (the convention this
audit checks against).

**Guard rules:** `01-flutter-architecture-guard.mdc` (this audit *is* that
rule's enforcement mechanism).

---

## Steps

**Step 0 — Confirm the established layering.** Read
`memory-bank/architecture.md`. If it's missing or a placeholder, run
`/repo-discovery` first — auditing against a convention that was never
recorded produces unreliable findings.

**Step 1 — Scan widgets for business logic.** Grep for repository/API
client construction or calls inside `build()` methods
(`Repository(`, direct `http.get`/`dio.get` calls), and for `switch`/
multi-branch conditionals inside widget files that look like they encode a
business rule rather than a rendering decision.

**Step 2 — Scan for direct data-layer imports in presentation.** Grep
presentation-layer files for imports of `data/` (or `.../data/...`) files
that bypass a repository interface — a widget or provider importing an
`ApiClient` directly instead of going through the bound repository
provider.

**Step 3 — Scan provider placement.** For each provider, check whether it
is consumed only within its own feature folder or by multiple features. A
single-feature provider declared in a shared/global providers file (or
vice versa — a genuinely cross-feature provider duplicated per-feature) is
a finding.

**Step 4 — Feature-first boundary check (if the repo uses feature-first
layout).** Grep for cross-feature imports that reach into another
feature's `data/`/`application/` internals rather than a re-exported public
widget/provider — this is the mobile analog of a bounded-context leak.

**Step 5 — Report.**

```markdown
## Flutter Architecture Audit — [scope]

### Findings

| Severity | File | Issue | Fix |
|---|---|---|---|
| High | lib/features/cart/presentation/cart_screen.dart:34 | Widget calls `CartRepository().checkout()` directly in `build()` | Move to `CartNotifier.checkout()`, widget calls `ref.read(cartProvider.notifier).checkout()` |
| Medium | lib/features/orders/application/order_provider.dart | Provider only consumed by `orders` feature but declared in `lib/shared/providers/` | Move to `lib/features/orders/application/` |

### Summary
[N] high, [N] medium, [N] low findings across [N] files scanned.
```

Severity: **High** = business logic in a widget or a broken dependency
direction (compiles but violates the architecture in a way that will
compound). **Medium** = misplaced provider scope. **Low** = naming/
placement inconsistency with no functional risk.

---

## Example

Request: "Audit the orders feature for architecture violations."

Output: a findings table scoped to `lib/features/orders/`, each row with a
file:line, the specific violation, and a concrete fix referencing the
correct target (provider, repository interface) — never a vague "refactor
this" without a destination.
