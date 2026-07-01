# Skill: react-i18n-rtl-gen

**Invocation:** `/react-i18n-rtl-gen [scope]`
Scope: a component name, feature folder, or "project" to wire the whole app.

---

## Overview

**Memory references:** `memory-bank/frontendConventions.md, memory-bank/glossary.md`

`react-i18n-rtl-gen` wires internationalization into a component or feature while
treating RTL layout as a first-class requirement, not an afterthought. Physical CSS
direction properties (`margin-left`, `padding-right`, `text-align: left`) are replaced
with logical equivalents (`margin-inline-start`, `padding-inline-end`, `text-align: start`)
so the layout inverts correctly when `dir="rtl"` is applied. Arabic locale support is
treated as the primary RTL use case given the project's GCC fintech context, but the
approach is locale-agnostic. If no i18n library is established, `/speckit-options` is
run to choose one before generating anything.

---

## Steps

**Step 1 — Detect i18n library.**

Read `package.json` for:
- `i18next` + `react-i18next` → use `useTranslation` hook
- `react-intl` → use `useIntl` hook and `<FormattedMessage>`
- Neither → run `/speckit-options` (i18next / react-intl / custom Context)

**Step 2 — Extract hardcoded strings.**

Scan the target component(s) for string literals in JSX:
- Button labels, headings, placeholder text, error messages, aria-labels
- Build a map: `[keyPath]: [original string]`
- Generate kebab-case i18n keys from the component name + text content

**Step 3 — Replace physical CSS direction classes with logical equivalents.**

Tailwind physical → logical mapping:

| Physical class | Logical equivalent | Notes |
|---------------|-------------------|-------|
| `ml-*` | `ms-*` (margin-inline-start) | |
| `mr-*` | `me-*` (margin-inline-end) | |
| `pl-*` | `ps-*` (padding-inline-start) | |
| `pr-*` | `pe-*` (padding-inline-end) | |
| `left-*` | `start-*` (inset-inline-start) | |
| `right-*` | `end-*` (inset-inline-end) | |
| `text-left` | `text-start` | |
| `text-right` | `text-end` | |
| `border-l-*` | `border-s-*` | |
| `border-r-*` | `border-e-*` | |
| `rounded-l-*` | `rounded-s-*` | |
| `rounded-r-*` | `rounded-e-*` | |
| `float-left` | `float-start` | |
| `float-right` | `float-end` | |

**Step 4 — Update the component to use translation keys.**

```tsx
// Before
<button className="ml-4 text-left">Submit Order</button>

// After
import { useTranslation } from 'react-i18next';

const { t } = useTranslation('orders');
<button className="ms-4 text-start">{t('submitButton')}</button>
```

**Step 5 — Create/update translation files.**

```json
// public/locales/en/orders.json
{
  "submitButton": "Submit Order",
  "cancelButton": "Cancel",
  "loadingMessage": "Loading orders...",
  "emptyState": "No orders found.",
  "errorMessage": "Failed to load orders. Please try again."
}

// public/locales/ar/orders.json
{
  "submitButton": "تقديم الطلب",
  "cancelButton": "إلغاء",
  "loadingMessage": "جارٍ تحميل الطلبات...",
  "emptyState": "لا توجد طلبات.",
  "errorMessage": "فشل تحميل الطلبات. يرجى المحاولة مرة أخرى."
}
```

**Step 6 — Verify date/number/currency formatting.**

Replace hardcoded format functions with `Intl` APIs:

```tsx
// Before
const formatted = `${amount} SAR`;
const date = new Date(createdAt).toLocaleDateString('en-US');

// After
const formatted = new Intl.NumberFormat('ar-SA', {
  style: 'currency', currency: 'SAR'
}).format(amount);

const date = new Intl.DateTimeFormat(i18n.language, {
  dateStyle: 'medium'
}).format(new Date(createdAt));
```

**Step 7 — Generate RTL layout test.**

```tsx
it('renders correctly in RTL layout', () => {
  const { container } = render(
    <div dir="rtl">
      <I18nextProvider i18n={createTestI18n('ar')}>
        <[ComponentName] {...defaultProps} />
      </I18nextProvider>
    </div>
  );
  // Verify no physical direction classes remain
  expect(container.innerHTML).not.toMatch(/class="[^"]*\bml-\d/);
  expect(container.innerHTML).not.toMatch(/class="[^"]*\btext-left\b/);
});
```

---

## Example Invocation

**Command:** `/react-i18n-rtl-gen BrokerDashboard`

Agent finds 12 hardcoded English strings, replaces with `t('brokerDashboard.*')` keys,
replaces `ml-4` → `ms-4`, `pr-2` → `pe-2`, `text-left` → `text-start` in 3 places,
creates `en/brokerDashboard.json` and `ar/brokerDashboard.json` translation files,
and generates an RTL layout test verifying no physical direction classes remain.

---

## Output

- Updated: component file(s) — strings replaced with `t()`, CSS classes replaced with logical
- New: `public/locales/en/[namespace].json`
- New: `public/locales/ar/[namespace].json`
- New: RTL layout test appended to component's test file
