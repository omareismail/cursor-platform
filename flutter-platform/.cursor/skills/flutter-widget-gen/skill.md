# Skill: flutter-widget-gen

**Invocation:** `/flutter-widget-gen [widget name/description]`

---

## Overview

`flutter-widget-gen` generates a single, focused, presentation-only Flutter
widget — a reusable card, button variant, list tile, empty/error state, or
similar — following the repo's existing widget conventions (stateless vs
`ConsumerWidget`, file/folder placement, naming). It does not generate
screens, providers, or navigation — see `flutter-screen-gen` for a full
screen and `flutter-provider-gen` for state.

**Memory references:** `memory-bank/architecture.md`,
`memory-bank/techContext.md`

**Guard rules:** `01-flutter-architecture-guard.mdc` (no business logic in
the widget), `02-flutter-state-guard.mdc` (if the widget reads state),
`04-flutter-test-guard.mdc` (the accompanying test).

---

## When to Use

- A new reusable UI piece that will appear in more than one place, or is
  complex enough to deserve its own file (a card, a form field group, a
  chart).
- Not for one-off inline layout that only ever appears once inside a
  screen's `build()` — that stays inline.

---

## Steps

**Step 0 — Find the pattern.** Run `pattern-scout` (or search manually via
Glob/Grep) for the nearest existing widget of a similar kind (another card,
another list tile) to match this repo's actual conventions — file location,
whether widgets are `StatelessWidget` vs `ConsumerWidget` by default,
naming (`XxxCard`, `XxxTile`), and how they accept data (constructor
params vs reading a provider directly).

**Step 1 — Decide stateless vs state-aware.** If the widget only renders
data passed into its constructor, make it a `StatelessWidget`. If it needs
to watch a provider directly (rare — usually the parent screen watches and
passes data down), make it a `ConsumerWidget`. Never make it a
`StatefulWidget` unless it owns genuinely ephemeral local UI state per
`02-flutter-state-guard.mdc`.

**Step 2 — Generate the widget.**

```dart
class ProductCard extends StatelessWidget {
  const ProductCard({
    required this.product,
    this.onTap,
    super.key,
  });

  final Product product;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(product.name, style: theme.textTheme.titleMedium),
              const SizedBox(height: 4),
              Text('\$${product.price.toStringAsFixed(2)}'),
            ],
          ),
        ),
      ),
    );
  }
}
```

**Step 3 — Accessibility pass.** Add a `Semantics` label if the widget
conveys information not obvious from its child text (an icon-only button,
a status color), and confirm any tappable area meets the 48x48 logical-pixel
minimum target size — see `flutter-accessibility-audit` for the full check.

**Step 4 — Add `const` where possible.** Constructors and static subtrees
that don't depend on instance fields should be `const` — this is also what
`flutter-performance-audit` checks for.

**Step 5 — Generate the widget test.** A `pumpWidget` test asserting the
widget renders expected content for representative inputs (including an
edge case like a null `onTap` or empty text), per
`04-flutter-test-guard.mdc`.

---

## Example

Request: "Generate a status badge widget that shows order status with a
color."

Output: `lib/shared/widgets/status_badge.dart` (or the feature-local
equivalent per the repo's layout) with a `const`-constructible
`StatusBadge extends StatelessWidget`, a `Semantics` label describing the
status for screen readers, and `test/shared/widgets/status_badge_test.dart`
asserting text and color per status value.
