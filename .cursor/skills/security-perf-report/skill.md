# Skill: security-perf-report

**Invocation:** `/security-perf-report [scope]`
Example: `/security-perf-report full` · `/security-perf-report Tamkeen.Payments`

---

## Overview

**Memory references:** none directly — same aggregation model as
`refactor-assistant`. This skill reads the output of `04-security-guard.mdc`'s
findings (run in audit mode across the scope, not just its normal
generation-time gating), `dotnet-perf-profile`, `react-perf-audit`, and
`react-accessibility-audit` (accessibility findings are included here rather
than spun into a fifth report, since they're frequently triaged alongside
performance work in practice) — and consolidates them into one
prioritized, point-in-time risk report.

This is lower-priority than `refactor-assistant` was, for a specific reason:
`04-security-guard.mdc` already blocks generation of insecure code in real
time, so the marginal value here is auditing *existing* code that predates
the guard or was written before a rule was tightened — not catching new
issues at the point of creation, which is already handled. Treat this
skill's findings as a backlog/audit artifact, not a replacement for the
always-on guard.

---

## Steps

**Step 1 — Run the source skills against the given scope.**

```
04-security-guard.mdc, in audit mode (review existing code in scope, not
  just gate new generation)
/dotnet-perf-profile [resolved backend path]
/react-perf-audit [resolved frontend path]
/react-accessibility-audit [resolved frontend path]
```

Resolve scope to concrete paths via `repo-map.json` (from `repo-discovery`)
the same way `refactor-assistant` does, rather than asking the developer to
supply literal folder paths.

**Step 2 — Tag each finding with its risk dimension.**

Unlike `refactor-assistant`'s single severity axis, this report keeps
security and performance/accessibility findings in separate columns even
after merging into one table — a Critical security finding and a Critical
performance finding require different responders (security review vs.
on-call performance triage) and shouldn't be flattened into one
undifferentiated "Critical" bucket.

| Dimension | Source |
|---|---|
| Security | `04-security-guard.mdc` audit pass |
| Performance | `dotnet-perf-profile`, `react-perf-audit` |
| Accessibility | `react-accessibility-audit` |

**Step 3 — Cross-reference for compounding risk.**

Some findings are worse in combination than either source skill scores them
individually — flag these explicitly rather than relying on the unified
severity column to capture it:
- A performance finding on an endpoint that's also flagged for missing rate
  limiting (security) — the performance issue makes that endpoint a cheaper
  target for a resource-exhaustion attack
- An accessibility finding on a form that's also flagged for missing CSRF
  protection — not directly compounding, but both indicate the same form
  predates current standards and is overdue for a full pass, not a
  piecemeal fix

**Step 4 — Prioritize with the same regulatory-adjacency bump
`refactor-assistant` uses.**

Findings touching mada/STC Pay/ZATCA/SAMA-adjacent code (per
`repo-map.json`'s bounded-context labeling, same source `refactor-assistant`
reads) get elevated visibility regardless of nominal severity — a Medium
security finding in payment-gateway code is not equivalent to a Medium
finding in an internal admin tool.

**Step 5 — Produce one report, security and performance sections clearly
separated, not interleaved.**

Security findings first (they're typically the harder blocking requirement
for a release), then performance, then accessibility, then the
cross-referenced compounding-risk callouts from Step 3 as a final section.

**Step 6 — Hand off to `technical-debt-tracker` for anything deferred,**
same as `refactor-assistant` and `devops-audit` — this skill doesn't write
new tracker entries, it confirms findings are reflected there.

---

## Example Invocation

**Command:** `/security-perf-report Tamkeen.Payments`

**Context:** Pre-release audit on the payments platform before a new gateway
integration ships.

Agent resolves `Tamkeen.Payments` to its backend/frontend paths, runs all
four source skills, finds a missing-rate-limiting finding on the new gateway
webhook endpoint (security) alongside an N+1 query finding on the same
endpoint's reconciliation path (performance), flags the combination as
compounding risk in Step 3, and elevates both given the mada-adjacency of
the webhook.

---

## Output

- One report with clearly separated Security / Performance / Accessibility
  sections plus a compounding-risk callout section
- Each finding cites its source skill for full detail
- Confirmation that deferred findings are reflected in `memory-bank/techDebt.md`
