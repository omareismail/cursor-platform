# Skill: react-perf-audit

**Invocation:** `/react-perf-audit [path]`
Default: `src/` if no path given.

---

## Overview

**Memory references:** `memory-bank/performanceGuidelines.md`

`react-perf-audit` reviews a React component tree for unnecessary re-renders,
missed memoization opportunities, and bundle-size concerns — recommending targeted
fixes rather than a blanket "add `useMemo` everywhere" sweep. Unnecessary memoization
adds cognitive complexity without measurable benefit; this skill distinguishes between
cases where memoization will genuinely prevent a re-render and cases where it will not.
Where the benefit is uncertain, it flags the item as "measure first" with a specific
React DevTools profiler or Lighthouse command, rather than prescribing a fix that might
make things worse.

---

## Steps

**Step 1 — Identify memoization candidates.**

Scan component files for patterns that cause unnecessary re-renders:

| Pattern | Problem | Fix |
|---------|---------|-----|
| Inline object literal passed as prop to `React.memo` child | New reference on every render defeats memo | `useMemo` the object |
| Inline array literal passed as prop | Same | `useMemo` |
| Inline arrow function passed as prop to memoized child | Same | `useCallback` |
| `React.memo` on a component that receives children | `children` always new reference | Memo won't help; restructure instead |
| `useMemo`/`useCallback` with empty `[]` deps | Should be a constant or moved outside component | Extract as module-level constant |
| `useMemo` wrapping a cheap computation (< 5 operations) | Adds complexity without benefit | Remove memo, it's not needed |

**Step 2 — Check bundle-size imports.**

Scan imports for known heavy libraries where tree-shaking may fail:

| Pattern | Issue | Fix |
|---------|-------|-----|
| `import _ from 'lodash'` | Imports entire 70KB lodash | `import debounce from 'lodash/debounce'` |
| `import * as d3 from 'd3'` | 500KB+ if not tree-shaken | Import individual d3 packages |
| Component used only on one route but imported at root | Bundle bloat | `React.lazy()` + `Suspense` |
| Large icon library fully imported | Imports all icons | Use individual icon imports |

**Step 3 — Check list rendering.**

```tsx
// ❌ No key — React can't reconcile
{items.map(item => <Item {...item} />)}

// ❌ Index as key — breaks on reorder/delete
{items.map((item, i) => <Item key={i} {...item} />)}

// ✅ Stable entity ID as key
{items.map(item => <Item key={item.id} {...item} />)}
```

**Step 4 — Identify "measure first" candidates.**

If the component is in a list rendered < 100 times with simple props,
memoization almost never pays off. Flag as:
```
[MEASURE FIRST] src/components/BrokerCard.tsx
Memoizing this component may not reduce renders in practice.
Profile in React DevTools Profiler (record a typical interaction, check
"Highlight updates when components render"). Memoize only if BrokerCard shows
frequent wasted renders in the profiler.
```

**Step 5 — Output findings.**

```
[MUST FIX] src/features/orders/components/OrderTable.tsx:45
Category: Performance
Issue: Inline object { sortBy, direction } passed as prop to memoized SortableHeader
       — new reference on every render defeats React.memo.
Fix:   const sortConfig = useMemo(() => ({ sortBy, direction }), [sortBy, direction]);
       Then pass sortConfig to SortableHeader.

[SHOULD FIX] src/features/catalog/CatalogPage.tsx:12
Category: Bundle size
Issue: import _ from 'lodash' — imports full 70KB library; only debounce is used.
Fix:   import debounce from 'lodash/debounce';

[MEASURE FIRST] src/components/PolicyCard.tsx
Category: Performance
Issue: React.memo wrapping PolicyCard, but it receives `children` prop —
       memo will never skip a render because children is always a new reference.
Fix:   Measure in React DevTools Profiler first. If PolicyCard renders frequently,
       lift its content, remove children, and memoize only the stable inner shell.
```

---

## Example Invocation

**Command:** `/react-perf-audit src/features/brokers/`

Agent scans 8 component files, finds: 1 inline object defeating memo (MUST FIX),
1 full lodash import (SHOULD FIX), 1 `useMemo` on a 2-operation calculation
(remove — overhead exceeds benefit), 2 "measure first" candidates.

---

## Output

- Terminal: findings list with MUST FIX / SHOULD FIX / MEASURE FIRST categories
- Terminal: summary count per category
