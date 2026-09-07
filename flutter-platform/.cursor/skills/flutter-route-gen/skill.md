# Skill: flutter-route-gen

**Invocation:** `/flutter-route-gen [route path/screen]`

---

## Overview

`flutter-route-gen` registers a new route in the app's `go_router`
configuration — path, name, builder, any path/query parameters, and an
auth guard via `redirect` if the route requires it. Used standalone for a
route added to an existing screen, or as Step 4 of `flutter-screen-gen`.

**Memory references:** `memory-bank/architecture.md` (router file
location, guard convention).

**Guard rules:** `01-flutter-architecture-guard.mdc`.

---

## Steps

**Step 0 — Confirm `go_router` is the routing package in use.** Check
`pubspec.yaml`. If the repo uses `Navigator` 1.0/2.0 directly or another
package, follow that existing convention instead — do not introduce
`go_router` to a repo that doesn't already use it.

**Step 1 — Find the router configuration file** (commonly
`lib/router/app_router.dart` or `lib/routing/router.dart` — confirm via
Glob rather than assuming the path).

**Step 2 — Add the route.**

```dart
GoRoute(
  path: '/orders/:orderId',
  name: 'orderDetail',
  builder: (context, state) {
    final orderId = state.pathParameters['orderId']!;
    return OrderDetailScreen(orderId: orderId);
  },
),
```

- Path parameters are extracted via `state.pathParameters`, never parsed
  by hand from the raw path string.
- Use `name:` and navigate with `context.goNamed(...)`/`pushNamed(...)`
  rather than hardcoded path strings scattered across the codebase — this
  is what keeps a later path change a one-line edit.

**Step 3 — Add an auth/eligibility guard if required.** If the screen
requires authentication, use the router's existing `redirect` mechanism
(a top-level `redirect` checking auth state, or a per-route guard if the
repo already has that pattern) — do not add a second, inconsistent
ad-hoc check inside the screen's `initState`/`build`.

```dart
redirect: (context, state) {
  final isLoggedIn = ref.read(authStateProvider).isAuthenticated;
  final isLoggingIn = state.matchedLocation == '/login';
  if (!isLoggedIn && !isLoggingIn) return '/login';
  if (isLoggedIn && isLoggingIn) return '/';
  return null;
},
```

**Step 4 — Nested routes / shell routes.** If the new screen belongs under
a bottom-nav or tab shell, add it as a child of the existing
`ShellRoute`/`StatefulShellRoute` rather than as a top-level route that
would escape the shell's persistent UI.

**Step 5 — Generate a navigation test.** A test asserting that navigating
to the route's path (or calling `goNamed`) renders the expected screen, and
— if a guard was added — that an unauthenticated navigation redirects
correctly.

---

## Example

Request: "Add a route for the order detail screen at /orders/:orderId,
requires login."

Output: `GoRoute` added to the existing router config under the
authenticated shell, with `redirect` reusing the app's existing
`authStateProvider` check, and a routing test asserting the redirect.
