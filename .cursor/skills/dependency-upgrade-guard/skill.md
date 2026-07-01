# Skill: dependency-upgrade-guard

**Invocation:** `/dependency-upgrade-guard [package-name]`

---

## Overview

**Memory references:** `memory-bank/technologyStack.md`

`dependency-upgrade-guard` performs a cross-stack safety check before bumping a
shared-impact dependency — a major React/TypeScript version, a major .NET SDK
version, a core library like MediatR or TanStack Query. Unlike a simple vulnerability
scan, it checks for breaking changes against the project's *actual usage patterns*
rather than the changelog in the abstract. "The method signature changed" only matters
if your project calls that method. This specificity prevents both unnecessary deferrals
("we can't upgrade because of a breaking change we don't use") and surprise failures
("the upgrade looked fine until tests ran").

---

## Steps

**Step 1 — Identify upgrade parameters.**

Read:
- Current package version (from `*.csproj` or `package.json`)
- Proposed target version (from argument or latest stable)
- Changelog / migration guide URL for the package

**Step 2 — Extract breaking changes.**

Read the changelog between current and target version. For each breaking change, extract:
- What API/behaviour changed
- A code pattern that indicates usage of the changed API

**Step 3 — Grep the codebase for actual usage.**

For each breaking change, search the project for the affected pattern:

```bash
# Example: MediatR v12 removes IPipelineBehavior.Order property
grep -r "IPipelineBehavior" src/ --include="*.cs" -l

# Example: TanStack Query v5 renames isLoading to isPending for mutations
grep -r "mutation\.isLoading" src/ --include="*.ts" --include="*.tsx" -l
```

Build a table:

| Breaking Change | Affected Pattern | Files Affected | Effort |
|----------------|-----------------|---------------|--------|
| `isLoading` → `isPending` on mutations | `mutation.isLoading` | 7 files | Low |
| `cacheTime` → `gcTime` | `cacheTime:` | 3 files | Low |
| `useQuery(key, fn, opts)` → `useQuery({ queryKey, queryFn })` | `useQuery([` | 24 files | High |

**Step 4 — Assess real risk.**

| Files affected | Effort | Risk |
|---------------|--------|------|
| 0 | None | Safe to upgrade |
| 1-5 | Low | Upgrade with a targeted fix PR |
| 6-20 | Medium | Plan a dedicated upgrade sprint |
| 20+ | High | Use codemod or compatibility shim first |

**Step 5 — If risk is non-trivial, run `/speckit-options`.**

```
Q: How should we approach the [PackageName] upgrade?

Option A — Upgrade now with targeted fixes:
  Upgrade to target version. Fix all [N] affected files in the same PR.
  Trade-off: Clean result | [N] files to touch; risk of missing edge cases

Option B — Upgrade with compatibility shim first:
  Install compat shim/adapter for the breaking changes. Upgrade gradually.
  Trade-off: Lower risk | Extra dependency; may delay full upgrade

Option C — Defer with documented risk:
  Stay on current version. Document known incompatibilities and set a review date.
  Trade-off: No work now | Technical debt grows; security exposure if CVE involved
```

**Step 6 — Generate scoped test plan.**

```markdown
## Test Plan for [PackageName] Upgrade

### Before upgrading
- [ ] `dotnet build` / `npm run build` passes on current version
- [ ] All tests pass on current version (baseline)

### After upgrading
- [ ] `dotnet build` / `npm run build` passes
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] E2E critical paths pass

### Specific regressions to check
- [ ] Test: [test name covering breaking change 1]
- [ ] Test: [test name covering breaking change 2]
- [ ] Manual: verify [user flow affected by change]
```

---

## Example Invocation

**Command:** `/dependency-upgrade-guard @tanstack/react-query`

**Context:** Upgrading from v4 to v5. Agent reads the v4→v5 migration guide, identifies
4 breaking changes, greps the codebase: `useQuery` positional params used in 31 files
(High effort), `mutation.isLoading` used in 7 files (Low), `cacheTime` → `gcTime` in 3
files (Low). Offers `/speckit-options` with codemod vs manual vs defer. Generates test plan.

---

## Output

- Terminal: breaking change table with codebase impact assessment
- Terminal: effort and risk summary
- Terminal: `/speckit-options` block if risk is non-trivial (awaits selection)
- File: `specs/audits/upgrade-[package]-[YYYY-MM-DD].md`
