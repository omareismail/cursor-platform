# Skill: flutter-screen-gen

**Invocation:** `/flutter-screen-gen [screen name/description]`

---

## Overview

`flutter-screen-gen` generates a full screen: the screen widget itself, the
Riverpod provider(s) backing its state, and the `go_router` route
registration wiring it in — in one pass, so the screen is reachable and
functional immediately rather than left as an orphaned widget.

**Memory references:** `memory-bank/architecture.md`,
`memory-bank/techContext.md`, `memory-bank/domainRules.md`

**Guard rules:** `01-flutter-architecture-guard.mdc`,
`02-flutter-state-guard.mdc`, `04-flutter-test-guard.mdc`.

**Depends on:** `flutter-provider-gen` (Step 2), `flutter-route-gen`
(Step 4) — this skill orchestrates both rather than duplicating their logic.

---

## Steps

**Step 0 — Find the pattern.** Run `pattern-scout` for the nearest existing
screen in the same feature area (or the closest structural analog) to match
folder layout, `AsyncNotifier` usage, loading/error handling shape, and
`AppBar`/scaffold conventions already established.

**Step 1 — Confirm scope with the user (planning-rigor applies).** If the
screen has non-trivial state or navigation implications, run the
elicitation pass from `05-planning-rigor.mdc` before generating (state
approach, whether data is fetched on entry vs passed in, error-handling
shape).

**Step 2 — Generate the backing provider.** Delegate to
`flutter-provider-gen`'s pattern: an `AsyncNotifier` (or `Notifier` for
synchronous state) that owns the screen's data and the operations the
screen triggers.

**Step 3 — Generate the screen widget.**

```dart
class OrderHistoryScreen extends ConsumerWidget {
  const OrderHistoryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ordersAsync = ref.watch(orderHistoryProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Order History')),
      body: ordersAsync.when(
        data: (orders) => orders.isEmpty
            ? const _EmptyOrders()
            : ListView.builder(
                itemCount: orders.length,
                itemBuilder: (context, i) => OrderTile(order: orders[i]),
              ),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, st) => ErrorRetryView(
          message: 'Could not load orders.',
          onRetry: () => ref.invalidate(orderHistoryProvider),
        ),
      ),
    );
  }
}
```

Every screen handles all three `AsyncValue` states explicitly (loading,
error with retry, data including the empty-list case) — a screen that only
handles the happy path is incomplete.

**Step 4 — Register the route.** Delegate to `flutter-route-gen`'s pattern
to add the `GoRoute` entry, including any path parameters and the
`redirect`/guard logic if the screen requires auth.

**Step 5 — Generate tests.** A widget test per `04-flutter-test-guard.mdc`
covering loading, error+retry, empty, and populated states with
`ProviderScope` overrides — not just the happy path.

**Step 6 — Update memory-bank.** Note the new screen and its route in
`memory-bank/activeContext.md` per the always-on `00-memory-think` rule.

---

## Example

Request: "Generate an order history screen."

Output: `lib/features/orders/presentation/order_history_screen.dart`,
provider added to `lib/features/orders/application/order_history_provider.dart`
(or `.g.dart` companion if codegen), a `GoRoute` added to the router config,
and `test/features/orders/order_history_screen_test.dart` covering all four
`AsyncValue` states.
