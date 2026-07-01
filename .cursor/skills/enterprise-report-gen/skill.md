# Skill: enterprise-report-gen

**Invocation:** `/enterprise-report-gen [report-type] [scope]`
Example: `/enterprise-report-gen production-readiness Tamkeen.Payments` · `/enterprise-report-gen repository-health full`

Report types: `architecture` | `security` | `performance` | `database` |
`repository-health` | `technical-debt` | `production-readiness` |
`release-readiness` | `dependency-health` | `code-quality`

---

## Overview

**Memory references:** none directly — same pure-aggregation model as
`refactor-assistant` and `security-perf-report`. This skill detects nothing
new; it assembles a standardized executive-facing report from existing audit
skills' output, in one consistent template, so "give me a production
readiness report" doesn't require manually running 6 different skills and
reconciling their formats by hand.

| Report type | Sources (no re-detection — calls these directly) |
|---|---|
| `architecture` | `02-dotnet-architecture-guard.mdc` findings, `03-react-architecture-guard.mdc` findings, `architecture-map-gen` (dependency-graph cycles) |
| `security` | `04-security-guard.mdc` (audit mode), `compliance-audit` |
| `performance` | `dotnet-perf-profile`, `react-perf-audit` |
| `database` | `database-audit`, `dotnet-schema-diff` (latest run if available) |
| `repository-health` | `repo-discovery` (project/cycle counts), `technical-debt-tracker` (report mode), `dotnet-dependency-audit` |
| `technical-debt` | `technical-debt-tracker` (report mode) directly — effectively a passthrough with the standard template applied |
| `production-readiness` | `security`, `performance`, `database`, `devops-audit`, `compliance-audit` — the composite readiness gate |
| `release-readiness` | `production-readiness` sources + `release-notes-gen` + `dotnet-test-gen`/`react-test-gen` coverage signal if available |
| `dependency-health` | `dotnet-dependency-audit`, `dependency-upgrade-guard` |
| `code-quality` | `refactor-assistant` (already a consolidated view — passthrough with template applied) |

---

## Steps

**Step 1 — Resolve scope to concrete paths via `repo-map.json`.**

Same resolution pattern as `refactor-assistant`/`security-perf-report` —
don't ask for literal folder paths.

**Step 2 — Run or reuse the source skills for the requested report type.**

If a source skill has already been run this session against the same scope,
reuse its output rather than re-running it (most of these are not cheap —
re-running `database-audit` to produce a `production-readiness` report that
also independently needs `dotnet-perf-profile` output would be wasteful if
both were already run minutes ago). If no recent run exists, run it.

**Step 3 — Apply the standard template.**

Every report type uses the same shape, so a reader who's seen one knows how
to read all of them:

```
# [Report Type] — [Scope]
**Generated:** [date] | **Sources:** [list of skills consulted]

## Summary
[2-3 sentence executive summary — overall status, not a restatement of
every finding]

## Findings by Severity
[Critical / High / Medium / Low — using each source skill's own severity
classification, not reinvented here]

## Composite Readiness (production-readiness / release-readiness only)
[Go / No-Go / Go-with-conditions, with the specific blocking items listed
if not a clean Go]

## Detail
[Full findings, grouped by source skill, each citing that skill for
deeper investigation]

## Recommendations
[Prioritized next actions]
```

**Step 4 — Composite reports (`production-readiness`, `release-readiness`)
need an explicit Go/No-Go, not just a findings dump.**

- **Go** — no Critical or Blocking findings from any source
- **Go-with-conditions** — no Critical findings, but High-severity items
  exist with a documented mitigation/monitoring plan
- **No-Go** — any Critical or Blocking finding from any source (a single
  `compliance-audit` Compliance-blocking finding is sufficient for a No-Go
  on its own, regardless of how clean every other source is — regulatory
  blockers don't average out against good performance scores)

**Step 5 — Never let this skill's own aggregation logic override a source
skill's severity classification.** If `database-audit` calls something
Blocking, this report shows it as Blocking — this skill doesn't soften or
re-rank findings to produce a more favorable composite status.

---

## Example Invocation

**Command:** `/enterprise-report-gen production-readiness Tamkeen.Payments`

**Context:** Go/no-go decision before a new gateway integration ships.

Agent runs/reuses `security-perf-report`, `database-audit`, `devops-audit`,
and `compliance-audit` for the scope, finds one Compliance-blocking ZATCA
QR-code field-order finding and one Risk-level database finding, applies the
standard template, and reports **No-Go** — the compliance finding alone is
sufficient regardless of the database finding's lower severity — with the
specific fix required listed first in Recommendations.

---

## Output

- One standardized report matching the template above
- Explicit Go/No-Go/Go-with-conditions for composite report types
- Every finding still cites its originating skill, so detail/remediation
  guidance isn't duplicated here — this skill assembles and prioritizes, it
  doesn't re-explain
