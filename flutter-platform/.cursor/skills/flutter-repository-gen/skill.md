# Skill: flutter-repository-gen

**Invocation:** `/flutter-repository-gen [resource name/description]`

---

## Overview

`flutter-repository-gen` generates the data layer for a resource: an
abstract repository interface, its concrete implementation backed by an API
client, typed error handling, and the provider binding — so the domain/
application layer only ever depends on the interface.

**Memory references:** `memory-bank/architecture.md`, `memory-bank/
techContext.md` (HTTP client: `dio` vs `http`), `memory-bank/domainRules.md`.

**Guard rules:** `01-flutter-architecture-guard.mdc` (data layer stays
below domain/application), `03-flutter-security-guard.mdc` (no secrets, use
the pinned/secure client if one exists).

---

## Steps

**Step 0 — Find the pattern.** Run `pattern-scout` for the nearest existing
repository (same or adjacent resource) to match the HTTP client already in
use, base-URL/interceptor setup, and error-mapping convention.

**Step 1 — Define the abstract interface.**

```dart
abstract class OrderRepository {
  Future<List<Order>> fetchOrders();
  Future<Order> fetchOrder(String id);
  Future<void> cancelOrder(String id);
}
```

**Step 2 — Define a typed failure/error model** (if the repo has an
established one — e.g. a sealed `Failure`/`AppException` hierarchy; do not
invent a new error-handling convention if one already exists,
`pattern-scout` should surface it).

```dart
sealed class OrderRepositoryException implements Exception {
  const OrderRepositoryException(this.message);
  final String message;
}
class OrderNotFoundException extends OrderRepositoryException {
  const OrderNotFoundException(super.message);
}
class OrderNetworkException extends OrderRepositoryException {
  const OrderNetworkException(super.message);
}
```

**Step 3 — Implement against the existing HTTP client.** Use whichever
client (`dio`, `http`) is already in `pubspec.yaml` — confirm before
generating. Map transport-level failures (timeout, 404, 5xx) to the typed
exceptions from Step 2 rather than letting a raw `DioException`/
`SocketException` propagate to the application layer.

```dart
class ApiOrderRepository implements OrderRepository {
  ApiOrderRepository(this._client);
  final Dio _client;

  @override
  Future<List<Order>> fetchOrders() async {
    try {
      final response = await _client.get('/orders');
      return (response.data as List)
          .map((json) => Order.fromJson(json as Map<String, dynamic>))
          .toList();
    } on DioException catch (e) {
      throw OrderNetworkException(e.message ?? 'Network error');
    }
  }
  // fetchOrder, cancelOrder follow the same shape
}
```

**Step 4 — Bind the provider to the interface.**

```dart
@riverpod
OrderRepository orderRepository(OrderRepositoryRef ref) {
  return ApiOrderRepository(ref.watch(dioClientProvider));
}
```

This is the seam `flutter-provider-gen`'s Notifiers depend on and that
tests override with a fake.

**Step 5 — Never bypass an existing pinned/secured client.** If the repo
already has certificate pinning or auth-header injection wired into a
shared `Dio` instance (`memory-bank/securityStandards.md`,
`03-flutter-security-guard.mdc`), the new repository uses that same
instance — it does not construct a second, unpinned client.

**Step 6 — Generate the test.** A unit test with a mocked HTTP client
(`mocktail`/`mockito`, whichever is already a dev dependency) asserting the
success path and at least one error-mapping path per
`04-flutter-test-guard.mdc`.

---

## Example

Request: "Generate a repository for fetching and cancelling orders."

Output: `lib/features/orders/domain/order_repository.dart` (interface),
`lib/features/orders/data/api_order_repository.dart` (implementation),
provider binding, and
`test/features/orders/data/api_order_repository_test.dart`.
