# Skill: feature-trace

**Invocation:** `/feature-trace "[screen/flow name]"`

---

## Overview

`feature-trace` answers "how does this screen/flow actually work today" by
tracing the real widget tree, provider graph, and repository calls behind
it — from route entry to data source — rather than guessing from file
names. In a mobile app the equivalent of a .NET request trace is: route →
screen widget → providers it watches → Notifiers those providers wrap →
repositories those Notifiers call → the API/local data source underneath,
plus any navigation the flow triggers.

**Memory references:** `memory-bank/architecture.md`.

**Guard rules:** none — read-only tracing.

---

## Steps

**Step 0 — Locate the entry point.** Find the route (`go_router`
`GoRoute`) or the widget that starts the flow. If the request names a
screen, Glob for its file directly; if it names a user-facing flow
("checkout"), start from the route table and follow forward.

**Step 1 — Trace the widget tree.** Read the screen widget. List every
provider it `ref.watch`/`ref.listen`s, every child widget that itself
watches a provider, and every navigation call (`context.go`/`push`) it can
trigger and where each leads.

**Step 2 — Trace each provider to its Notifier.** For each provider
watched, read the backing `Notifier`/`AsyncNotifier`. List its public
methods (what user actions call them) and what each method does.

**Step 3 — Trace each Notifier method to its repository call(s).** List
which repository methods are called, in what order, and what happens on
success vs failure (does it re-fetch, optimistically update, roll back).

**Step 4 — Trace the repository to its data source.** API endpoint(s) hit,
local cache/database involved (if any), and how errors are mapped.

**Step 5 — Produce the trace report.**

```markdown
## Feature Trace — Checkout Flow

**Entry:** `GoRoute('/checkout')` → `CheckoutScreen`
(`lib/features/checkout/presentation/checkout_screen.dart`)

**Widget tree → providers:**
- `CheckoutScreen` watches `checkoutProvider` (AsyncNotifier<CheckoutState>)
- `PromoCodeField` watches `promoValidationProvider`, calls
  `ref.read(checkoutProvider.notifier).applyPromo(code)` on submit

**Provider → repository:**
- `CheckoutNotifier.submitOrder()` calls
  `OrderRepository.createOrder(cart, paymentMethod)`, then on success calls
  `CartNotifier.clear()` and navigates to `/orders/:id/confirmation`
- `CheckoutNotifier.applyPromo()` calls `PromoRepository.validate(code)`,
  updates `CheckoutState.discount` on success, leaves state unchanged +
  surfaces a `SnackBar` on `PromoInvalidException`

**Repository → data source:**
- `OrderRepository` → `POST /orders` via the shared pinned `Dio` client
- `PromoRepository` → `GET /promos/:code/validate`

**Files touched by this flow (8):** [list]
```

---

## Example

Request: `/feature-trace "checkout"` — produces the report above, giving
the caller everything needed before making a change (`/impact-analysis`
next) without re-deriving it from scratch.
