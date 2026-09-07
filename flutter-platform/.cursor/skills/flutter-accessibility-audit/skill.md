# Skill: flutter-accessibility-audit

**Invocation:** `/flutter-accessibility-audit [scope]`

---

## Overview

`flutter-accessibility-audit` reviews widgets for screen-reader support
(`Semantics` labels), minimum tap-target size, and text contrast —
covering the accessibility issues that are cheap to catch statically
before a manual TalkBack/VoiceOver pass. Read-only — produces a findings
report.

**Memory references:** `memory-bank/securityStandards.md` is not relevant
here; no Tier 2 file is required unless the repo has documented specific
accessibility targets.

**Guard rules:** none directly — this audit implements the accessibility
expectations implicit in `flutter-widget-gen`'s Step 3.

---

## Steps

**Step 1 — Icon-only and image-only interactive elements.** Grep for
`IconButton`, `InkWell`/`GestureDetector` wrapping an `Icon` or `Image`
with no adjacent text, and check each has a `Semantics(label: ...)`
wrapper or a `tooltip`/`semanticLabel` argument — a screen-reader user
otherwise hears "button" with no indication of what it does.

```dart
// ❌
IconButton(icon: const Icon(Icons.favorite), onPressed: toggleFavorite)
// ✓
IconButton(
  icon: const Icon(Icons.favorite),
  tooltip: 'Add to favorites',
  onPressed: toggleFavorite,
)
```

**Step 2 — Tap target size.** Check interactive elements
(`GestureDetector`, `InkWell`, custom tap areas built from `Container` +
`onTap`) for an effective size below 48x48 logical pixels — Material's own
widgets (`IconButton`, `ElevatedButton`) already enforce this, so focus the
scan on custom-built tappable areas that skip `Material`/`InkWell`'s
built-in constraints.

**Step 3 — Text contrast.** For any hardcoded (non-`Theme.of(context)`)
color pairs used for text-on-background, flag for a manual contrast check
against WCAG AA (4.5:1 for normal text, 3:1 for large text) — this audit
does not compute contrast ratios itself (no image/pixel access), it flags
candidates: custom colors outside the app's `ColorScheme`, low-emphasis
text styles (`Colors.grey` on a light background) used for anything beyond
truly secondary/disabled content.

**Step 4 — Dynamic content announcements.** Check that state changes a
sighted user would notice visually but that don't move focus (a validation
error appearing, a snackbar, a loading spinner replacing content) use
`Semantics(liveRegion: true)` or an equivalent announcement mechanism where
the repo has one — flag if error text appears with no `Semantics` or
`SnackBar` (which does announce by default) equivalent.

**Step 5 — Form field labels.** Check `TextField`/`TextFormField` widgets
have a `labelText`/`hintText` or an external `Semantics(label:)` — an
unlabeled text field is unusable with a screen reader.

**Step 6 — Report.**

```markdown
## Flutter Accessibility Audit — [scope]

| Severity | File | Issue | Fix |
|---|---|---|---|
| High | lib/features/cart/presentation/cart_item_tile.dart:18 | Icon-only delete button has no label | Add `tooltip: 'Remove item'` |
| Medium | lib/features/checkout/presentation/promo_field.dart:9 | `TextField` has no `labelText` or hint | Add `decoration: InputDecoration(labelText: 'Promo code')` |
| Low | lib/shared/theme/colors.dart | `Colors.grey.shade400` text on white — verify contrast manually | Confirm ≥4.5:1 or use a theme token |

### Summary
[N] findings. High = screen-reader dead-end (no way to know what the
control does). Medium = missing label with a workable but degraded
experience. Low = needs a manual contrast check.
```

---

## Example

Request: "Audit the checkout flow for accessibility."

Output: findings scoped to `lib/features/checkout/`, prioritizing
icon-only buttons and unlabeled form fields (High/Medium) over contrast
flags that need manual verification (Low).
