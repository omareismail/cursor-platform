# Skill: react-clean-code-guard

**Invocation:** `/react-clean-code-guard [path]`
Default path: entire `src/` folder if none specified.

---

## Overview

**Memory references:** `memory-bank/codingStandards.md, memory-bank/frontendConventions.md`

`react-clean-code-guard` performs a comprehensive static review of a React/TypeScript
codebase against the architecture rules in `03-react-architecture-guard.mdc`, TypeScript
best practices, accessibility basics, and code quality standards. Like its .NET counterpart,
every finding includes the file location, a one-sentence problem description, and a
one-sentence fix. It reads `memory-bank/systemPatterns.md` to flag deviations from the
project's established naming and structure conventions. Findings are separated into three
tiers: MUST FIX, SHOULD FIX, and INFO.

---

## Steps

**Step 1 — Determine scope and load context.**

If a path is given, scan that path. Otherwise scan all `*.ts` and `*.tsx` under `src/`,
excluding `*.test.*`, `*.spec.*`, `*.stories.*`, and generated files.

Read `memory-bank/systemPatterns.md` for naming conventions and folder structure.

**Step 2 — Scan for findings.**

**Step 3 — Output findings in structured format.**

```
[SEVERITY] src/path/to/File.tsx:LINE
Category: [Architecture | TypeScript | Hooks | Accessibility | Performance | Style]
Issue: [specific problem description]
Fix:   [one-sentence correction]
```

---

## Findings Checklist

### MUST FIX

| Pattern | Detection |
|---------|-----------|
| Direct `fetch`/`axios` in component body | `fetch(` or `axios.` inside `*.tsx` outside `api/` folder |
| `any` type | `: any` or `as any` outside `.d.ts` files |
| Business logic in JSX render | Complex expressions (ternary chains, reduce, filter) directly in JSX |
| `useEffect` with `eslint-disable-next-line react-hooks/exhaustive-deps` | Comment suppression |
| `dangerouslySetInnerHTML` without DOMPurify | Import of DOMPurify not found |
| Prop drilling > 2 levels | Same prop name passed through 3+ component files |
| No error boundary on async-data component | Component using `useQuery` with no `isError` handling |

### SHOULD FIX

| Pattern | Detection |
|---------|-----------|
| Component > 200 lines | Line count |
| Hook returning an array instead of a named object | `return [data, fn]` from custom hook |
| Missing loading / empty / error state handling | `isLoading`/`isError` from query but no conditional render |
| No accessibility attributes on icon-only buttons | `<button>` or `<a>` with only an icon child and no `aria-label` |
| Hardcoded strings in JSX that should be i18n keys | Sentence-case or Title Case string literals in JSX |
| Missing JSDoc on exported utility functions in `utils/` | Public function in `utils/` with no JSDoc |
| `console.log` in non-test source files | Found outside `*.test.*` and `*.spec.*` |

### INFO

| Pattern | Detection |
|---------|-----------|
| Test coverage gaps | Exported component with no `.test.tsx` found |
| Inconsistent naming vs systemPatterns.md | Component/hook name pattern deviates from convention |
| Missing Storybook story for shared component | Component in `components/` with no `.stories.tsx` |

---

## Example Invocation

**Command:** `/react-clean-code-guard src/features/brokers/`

**Sample output:**

```
[MUST FIX] src/features/brokers/components/BrokerList.tsx:22
Category: Architecture
Issue: Direct fetch() call inside component body instead of using a React Query hook.
Fix:   Move the fetch to src/api/brokers.ts and create useBrokerList() in hooks/.

[MUST FIX] src/features/brokers/hooks/useBrokerExport.ts:14
Category: TypeScript
Issue: Return type uses `any`: return { data: data as any, isLoading }.
Fix:   Define BrokerExportResponse interface in src/types/api.ts and use it as the return type.

[SHOULD FIX] src/features/brokers/components/BrokerCard.tsx:1
Category: Architecture
Issue: Component is 243 lines — exceeds 200-line limit.
Fix:   Extract BrokerCardActions and BrokerCardDetails into separate components.

════════════════════════════════
MUST FIX:   2 findings
SHOULD FIX: 1 finding
INFO:       1 finding
════════════════════════════════
```

---

## Output

- Terminal: structured findings list with severity, location, and fix instructions
- Terminal: summary table (MUST FIX / SHOULD FIX / INFO counts)
