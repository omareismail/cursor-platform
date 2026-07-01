# Skill: react-accessibility-audit

**Invocation:** `/react-accessibility-audit [path]`

---

## Overview

**Memory references:** `memory-bank/frontendConventions.md`

`react-accessibility-audit` performs a deeper accessibility pass than the baseline
check in `03-react-architecture-guard.mdc` — including full keyboard-navigation trace,
screen-reader label review, colour-contrast verification against actual Tailwind theme
tokens, focus management on modals/dialogs, and form error announcement. WCAG 2.2 AA is
the default compliance target. Findings that a lint tool cannot catch (focus management,
skip-links, screen reader announcements for dynamic content) are a particular focus of
this skill, because they are the accessibility issues that most commonly slip through
automated checks.

---

## Steps

**Step 1 — Keyboard navigation trace.**

For each interactive component in scope:
1. Tab order: verify all interactive elements are reachable via Tab
2. Activation: verify Enter/Space activates buttons and links
3. Arrow keys: verify custom widgets (dropdowns, tabs, carousels) use ARIA keyboard patterns
4. Escape: verify dialogs/dropdowns close on Escape
5. Focus trap: verify modals/drawers trap focus while open

Flag any interactive element that is only mouse-accessible.

**Step 2 — ARIA label review.**

| Pattern | Check |
|---------|-------|
| Icon-only button | Must have `aria-label` or visually hidden `<span>` |
| Icon + text button | `aria-label` not needed — text is the label |
| Image | Must have `alt` — empty `alt=""` for decorative images |
| Status/alert message | Must use `role="status"` or `role="alert"` + `aria-live` |
| Form field | Must have associated `<label htmlFor="id">` or `aria-label` |
| Custom listbox/combobox | Must follow ARIA listbox or combobox pattern |

**Step 3 — Colour contrast check.**

Read the project's Tailwind config (`tailwind.config.ts`) for custom colour tokens.
For each text/background combination found in the scoped components, verify the
contrast ratio meets WCAG 2.2 AA (4.5:1 for normal text, 3:1 for large text and UI
components). Output a table of combinations that fail.

```
[FAIL] src/components/Badge/Badge.tsx
Text: text-gray-500 (#6B7280) on bg-white (#FFFFFF)
Contrast ratio: 4.13:1 — FAILS WCAG AA (requires 4.5:1 for 14px text)
Fix: Use text-gray-600 (#4B5563) — contrast ratio 5.74:1 ✅
```

**Step 4 — Focus management on modals and dialogs.**

```tsx
// Check for:
// 1. Initial focus set to first interactive element inside modal
// 2. Focus trapped within modal while open (Tab wraps at end)
// 3. Focus returned to trigger element on close

// Required pattern:
useEffect(() => {
  if (open) {
    firstFocusableRef.current?.focus();
  } else {
    triggerRef.current?.focus(); // restore focus
  }
}, [open]);
```

**Step 5 — Form error announcements.**

```tsx
// ❌ Error shown visually only — screen reader doesn't announce it
{errors.email && <p className="text-red-600">{errors.email.message}</p>}

// ✅ Error announced to screen reader
{errors.email && (
  <p id="email-error" role="alert" aria-live="assertive" className="text-red-600">
    {errors.email.message}
  </p>
)}
// And the input must reference it:
<input aria-describedby="email-error" aria-invalid={!!errors.email} />
```

**Step 6 — Skip-link check.**

For page-level components, verify a skip-to-content link is present at the top of
the DOM (visually hidden, becomes visible on focus):

```tsx
<a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 ...">
  Skip to main content
</a>
```

**Step 7 — Propose checklist additions.**

If the same accessibility gap appears across multiple audits (e.g. icon button
labels consistently missing), propose a specific line to add to the
`speckit-checklist` React section.

---

## Example Invocation

**Command:** `/react-accessibility-audit src/features/brokers/`

Findings: 2 icon buttons without `aria-label`, 1 modal with no focus trap, 3 form
errors not announced to screen readers, 1 colour contrast failure. Also proposes
adding "icon-only buttons must have aria-label" to the speckit-checklist.

---

## Output

- Terminal: findings list (FAIL / WARNING per WCAG criterion)
- Terminal: colour contrast failure table
- Terminal: proposed `speckit-checklist` diff (awaits approval before adding)
