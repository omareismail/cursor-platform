# Skill: dotnet-dependency-audit

**Invocation:** `/dotnet-dependency-audit`

---

## Overview

**Memory references:** `memory-bank/technologyStack.md`

`dotnet-dependency-audit` runs and interprets `dotnet list package --vulnerable`
and `--deprecated`, then proposes a safe, batched upgrade path that respects
breaking-change boundaries. It never recommends a blind "upgrade everything" sweep,
because a single transitive breaking change in a production system is worse than
a known vulnerability that you've triaged and documented. Every flagged package
gets a severity rating, a changelog summary, and a specific upgrade recommendation.
If multiple safe upgrade paths exist, it invokes `/speckit-options` to let the
developer choose between upgrading now, upgrading with compatibility shims, or
deferring with a documented risk acceptance.

---

## Steps

**Step 1 — Run vulnerability and deprecation scans.**

```bash
dotnet list package --vulnerable --include-transitive
dotnet list package --deprecated
```

**Step 2 — Group findings by severity.**

| Severity | Action |
|----------|--------|
| Critical | Must fix before next release |
| High | Fix within current sprint |
| Moderate | Fix within next sprint or in a chore PR |
| Low | Document in tech debt; fix during next major upgrade |

**Step 3 — For each flagged package, analyse the upgrade path.**

For each package:
1. Identify the current version and the lowest safe version that resolves the CVE
2. Check if the safe version introduces breaking changes (inspect NuGet changelog)
3. Identify all project files that reference the package (including transitive)
4. Determine if an intermediate shim/adapter is available

**Step 4 — If multiple paths exist, invoke `/speckit-options`.**

```
Q: Upgrade path for [PackageName] (current: X.Y.Z, CVE: YYYY-NNNNN)?

Option A — Upgrade to [X.Y+1.Z] (patch/minor, no breaking changes):
  Direct drop-in upgrade. No code changes required.
  Trade-off: Safe | May not fix all related CVEs in the same package family

Option B — Upgrade to [X+1.0.0] (major, breaking changes in UseSomeMethod()):
  Fixes all known CVEs. Requires updating 3 call sites in Infrastructure project.
  Trade-off: Complete fix | 2-4 hours of code changes + test updates

Option C — Defer + document risk:
  Accept the CVE with a documented risk acceptance. Pin current version explicitly.
  Record in memory-bank/techDebt.md with review date.
  Trade-off: Zero work now | CVE remains; must review at agreed date
```

**Step 5 — Generate the audit report.**

```markdown
## .NET Dependency Audit — [YYYY-MM-DD]

### Critical (fix before next release)
| Package | Current | Safe Version | CVE | Breaking? | Action |
|---------|---------|-------------|-----|-----------|--------|
| SomePackage | 3.1.0 | 3.1.5 | CVE-2024-1234 | No | Upgrade immediately |

### High
| Package | ... |

### Moderate
...

### Deprecated (no security risk, but no longer maintained)
| Package | Current | Replacement | Migration effort |
|---------|---------|-------------|-----------------|
| OldPackage | 2.0.0 | NewPackage | Low — drop-in replacement |

### Recommended Upgrade Plan
**Sprint 1 (Critical):**
- `dotnet add package SomePackage --version 3.1.5`

**Sprint 2 (High):**
- Upgrade BigPackage to 5.0.0 (requires updating 3 call sites — see PR description)

**Deferred (documented):**
- MinorPackage CVE-2024-5678 — Low severity; risk accepted until Q2 review
  Logged: memory-bank/techDebt.md
```

**Step 6 — Log deferred items to tech debt.**

For any CVE or deprecation that is deferred:
```
/technical-debt-tracker log — "Deferred CVE: [package] [CVE] — accepted until [date]"
```

---

## Example Invocation

**Command:** `/dotnet-dependency-audit`

**Scenario:** Scan finds `Microsoft.AspNetCore.Authentication.JwtBearer` at
5.0.17 with Critical CVE, and `Swashbuckle.AspNetCore` deprecated (replaced
by Microsoft.AspNetCore.OpenApi). Agent runs speckit-options for Swashbuckle
migration (upgrade vs. switch to new OpenAPI package) and outputs the upgrade plan.

---

## Output

- Terminal: live scan output from `dotnet list package`
- File: `specs/audits/dotnet-dependencies-[YYYY-MM-DD].md`
- Side effect: deferred items logged via `/technical-debt-tracker log`
