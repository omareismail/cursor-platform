# Skill: flutter-provider-gen

**Invocation:** `/flutter-provider-gen [provider name/description]`

---

## Overview

`flutter-provider-gen` scaffolds a Riverpod `Notifier` or `AsyncNotifier`
(or, only if the repo hasn't adopted codegen, a manually-declared
`NotifierProvider`) — the state-owning layer between a screen/widget and a
repository. Riverpod is the assumed default state-management approach for
this platform.

**Memory references:** `memory-bank/techContext.md` (codegen vs manual
style), `memory-bank/architecture.md` (provider placement).

**Guard rules:** `02-flutter-state-guard.mdc` (primary), `01-flutter-
architecture-guard.mdc` (placement).

---

## Steps

**Step 0 — Find the pattern.** Run `pattern-scout` for the nearest existing
`Notifier`/`AsyncNotifier` in the same or a similar feature to match error
handling shape, whether repository calls are wrapped in `AsyncValue.guard`,
and naming (`XxxNotifier` vs bare `Xxx` class name with `@riverpod`).

**Step 1 — Choose Notifier vs AsyncNotifier.** `AsyncNotifier` when the
initial state requires an async fetch (almost all data-backed screens);
plain `Notifier` for synchronous, already-available state (a filter
selection, a wizard's current step, an in-memory draft).

**Step 2 — Confirm codegen style.** Check `memory-bank/techContext.md` for
whether `riverpod_generator`/`@riverpod` is the established style. Default
to it if `build_runner` and `riverpod_generator` are already in
`pubspec.yaml`; otherwise use manually-declared providers. Never introduce
codegen to a repo that doesn't already use it without asking (dependency
safety, `10-evidence-and-dependency-guard.mdc`).

**Step 3 — Generate the Notifier (codegen style shown; manual style
follows the same shape with an explicit `NotifierProvider`/
`AsyncNotifierProvider` declaration).**

```dart
@riverpod
class OrderHistory extends _$OrderHistory {
  @override
  Future<List<Order>> build() {
    return ref.watch(orderRepositoryProvider).fetchOrders();
  }

  Future<void> refresh() async {
    ref.invalidateSelf();
    await future;
  }

  Future<void> cancelOrder(String orderId) async {
    final repo = ref.read(orderRepositoryProvider);
    state = const AsyncLoading<List<Order>>().copyWithPrevious(state);
    state = await AsyncValue.guard(() async {
      await repo.cancelOrder(orderId);
      return repo.fetchOrders();
    });
  }
}
```

**Step 4 — Wrap mutations in `AsyncValue.guard`.** Every async operation
that can fail sets loading state (preserving previous data via
`copyWithPrevious` so the UI doesn't flash to a blank loading screen) and
resolves through `AsyncValue.guard` so errors surface to the `AsyncValue`
rather than throwing uncaught into the widget tree.

**Step 5 — Depend on the repository interface, not the implementation.**
Read from `orderRepositoryProvider` (bound to an interface), never
construct `OrderRepositoryImpl()` directly inside the Notifier — this is
what keeps the Notifier testable with a fake repository.

**Step 6 — Generate the unit test.** A `ProviderContainer`-based test per
`04-flutter-test-guard.mdc` asserting the emitted state sequence for
success and failure paths, with the repository provider overridden to a
fake/mock.

---

## Example

Request: "Generate a provider for the shopping cart with add/remove."

Output: `lib/features/cart/application/cart_notifier.dart` (`@riverpod`
`AsyncNotifier<List<CartItem>>` with `addItem`/`removeItem`/`clear`
methods, each guarded), plus
`test/features/cart/application/cart_notifier_test.dart`.
