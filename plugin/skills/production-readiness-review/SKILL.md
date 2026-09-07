---
name: production-readiness-review
description: "The Go/No-Go gate before a feature reaches production. Reviews seven dimensions - reliability and resilience, observability, deployability and reversibility, security and access, scalability and capacity, incident response, data and backups - and returns a blocking verdict with evidence. Use when asked whether something is ready to ship, ready for production, or safe to release. Invoked as /production-readiness-review."
---

<!-- GENERATED from the cursor-platform source skill "production-readiness-review".
     Do not edit here - edit the source and re-run the plugin build. -->

# Skill: production-readiness-review

**Invocation:** `/production-readiness-review [feature-id|service|release]`
Example: `/production-readiness-review premium-calculation` · `/production-readiness-review Tamkeen.Payments` · `/production-readiness-review v2.4.0`

---

## Overview

**Memory references:** `.cursor/cache/feature-map.json`,
`memory-bank/deploymentNotes.md`, `memory-bank/securityStandards.md`,
`memory-bank/performanceGuidelines.md`, `memory-bank/testingStandards.md`,
`memory-bank/businessRules.md`, `memory-bank/decisionLog.md`

`production-readiness-review` is the **Go / No-Go gate before a feature reaches
production**. It is the single most standard practice in enterprise engineering
that this platform did not have.

Everything else here answers *is the code correct?* — architecture guards, tests,
analyzers, audits. A PRR answers a different question: **can we run this, and can
we recover when it breaks?** Correct code with no rollback path, no alert, and no
runbook is not ready to ship. It just has not failed yet.

The verdict is binary and blocking. "Mostly ready" is how the gate stops being a
gate: once a review can be passed with open blockers, it becomes a form to fill
in. Conditional passes are allowed only with a named owner and a date.

Read-only. Produces a verdict and a report; changes nothing.

---

## Steps

**Step 0 — Establish scope and evidence.**

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/feature-map.mjs show <feature-id>
node ${CLAUDE_PLUGIN_ROOT}/tools/delivery-metrics.mjs report --days 90
```

State up front what you verified **by reading code or config** versus what you
are taking on trust. A PRR built on assertions is worthless — the whole value is
that someone actually checked. Anything you could not verify is a finding, not a
silent pass.

**Step 1 — Work the seven dimensions. Each gets a verdict with evidence.**

### 1. Reliability and resilience

- Timeouts set on **every** outbound call — a missing timeout is an unbounded
  hang under load, and it is the most common omission in this category
- Retries only on idempotent operations, with backoff and jitter, and a bounded
  attempt count
- Circuit breaker or bulkhead on dependencies that can be slow
- Graceful degradation: what still works when each dependency is down?
- Idempotency on anything that moves money or mutates state — including the
  retry path and the replayed message
- Health checks that reflect real readiness, not `return 200`. A liveness probe
  that always passes turns a broken pod into a silently broken pod.

### 2. Observability

- SLIs and SLOs defined with an error-budget policy (`/operability-gen`)
- Alerts on **symptoms**, each linked to a runbook section
- Traces span the whole path, including async and job boundaries
- Correlation id propagated end to end — without it you cannot reconstruct a
  single user's failed journey, which is the first thing you will want
- Logs structured, with no PII, card numbers, IBANs or tokens
- A dashboard that answers "is it healthy right now" without a query language

### 3. Deployability and reversibility

- **Rollback is tested, not assumed.** The question is not "can we roll back" but
  "when did we last actually do it, and how long did it take?"
- Database migrations are backwards-compatible with the previous app version, or
  the rollback plan explicitly covers the schema. Expand → migrate → contract.
- Deploy is automated and gated; no manual steps in the critical path
- Feature flag or progressive rollout for anything user-visible
  (`/release-safety`)
- Config differs from other environments only in values, never in shape

### 4. Security and access

- Every endpoint has an auth policy or a justified `[AllowAnonymous]`
- **Authorization checked server-side per resource** — the IDOR question, which
  is the highest-value finding class in multi-tenant fintech
- Secrets from a managed store, never config files; rotation path known
- Dependency scan clean of High/Critical (`dotnet list package --vulnerable`)
- Audit trail on financial and policy mutations: who, when, what changed
- Rate limiting on anything unauthenticated or expensive

Delegate the depth here to the `security-auditor` subagent rather than
re-deriving it.

### 5. Scalability and capacity

- **Load tested at expected peak, and at 2x.** Not "we think it will scale."
  If no load test exists, that is a blocker for anything on a critical path.
- Known limits documented: requests/sec, connection pool size, queue depth,
  memory ceiling
- Autoscaling configured, with limits that will not exhaust the database's
  connection pool — autoscaling into a fixed-size pool converts a traffic spike
  into a total outage
- N+1 queries and unbounded result sets checked (`db-auditor`)
- Peak-load behaviour of the batch/nightly jobs considered alongside interactive
  traffic

### 6. Incident response

- On-call rota exists and knows this service is theirs
- Runbook exists for each alert, and someone has followed it at least once
- Severity levels and escalation path defined
- Postmortem process agreed **before** the first incident, not after
- The one-line question worth asking out loud: *if this pages at 3am, does the
  person who answers have everything they need in the alert itself?*

### 7. Data and backups

- Backups run **and restores are tested** — an untested backup is a belief, not a
  backup, and restore is where they fail
- RPO and RTO stated and achievable, agreed with whoever owns the business risk
- Retention and deletion policy matches the regulatory requirement
  (cross-check `/compliance-audit` for SAMA/ZATCA)
- Migration reversibility: can this schema change be undone with data intact?
- PII inventory: what personal data does this touch, where does it land, who can
  read it

**Step 2 — Classify every finding.**

| Verdict | Meaning |
|---|---|
| **PASS** | Verified by reading code, config or a test result. Cite it. |
| **BLOCKER** | Ship-stopping. Not negotiable without an accepted, written risk. |
| **CONDITIONAL** | Can ship if a named owner completes a named action by a named date. Both parts required. |
| **N/A** | Genuinely not applicable — with the reason, so the next reviewer does not re-ask |
| **UNVERIFIED** | Could not check. **This is a finding, not a pass.** |

**Step 3 — Give the verdict.**

```
GO           — no blockers
GO WITH CONDITIONS — no blockers, n conditionals, each with owner + date
NO-GO        — n blockers
```

Do not soften a NO-GO. The purpose of the gate is to be capable of saying no; a
review that has never blocked anything is a form, not a control.

**Step 4 — Right-size the review.**

A PRR for an internal admin screen should not be the same as one for a payment
path. Scale it, and say which tier you applied:

| Tier | Applies to | Depth |
|---|---|---|
| **Full** | Money movement, PII, external-facing, regulated | All 7 dimensions, blockers enforced |
| **Standard** | Internal services with real users | All 7, dimensions 5 and 7 lighter |
| **Light** | Internal tooling, no PII, no money | Dimensions 1–4 only |

**Step 5 — Hand off the gaps.**

- Missing SLOs, alerts or runbook → `/operability-gen`
- Missing rollout/rollback plan → `/release-safety`
- Security depth → `security-auditor` subagent
- Capacity and query concerns → `db-auditor`, `/dotnet-perf-profile`
- Compliance → `/compliance-audit`
- Work to schedule → `/work-breakdown` on the blocker list

---

## Example Invocation

**Command:** `/production-readiness-review premium-calculation`

Agent applies the **Full** tier (money path). Passes reliability and security.
Finds three blockers: the nightly reconciliation job is not idempotent and the
retry path will double-post; no load test exists for the quote endpoint despite
it being on the checkout critical path; and backup restore has never been
exercised for `PolicyDbContext`. Two conditionals with owners and dates: alert
runbook anchors are missing for two of six alerts, and the correlation id is
dropped at the job boundary. **Verdict: NO-GO**, with the three blockers routed
into `/work-breakdown`.

---

## Output

```
## Production readiness review: <scope>

**Tier:** Full | Standard | Light
**Verdict:** GO | GO WITH CONDITIONS | NO-GO
**Blockers:** <n>   **Conditionals:** <n>   **Unverified:** <n>

### Blockers - must be resolved before shipping
| # | Dimension | Finding | Evidence (file:line / absence of) | What "resolved" looks like |

### Conditionals - may ship, owner and date required
| # | Finding | Owner | Due | Risk if it slips |

### Dimension summary
| # | Dimension | Verdict | Notes |
|---|---|---|---|
| 1 | Reliability & resilience | PASS/BLOCKED/... | |
| 2 | Observability | | |
| 3 | Deployability & reversibility | | |
| 4 | Security & access | | |
| 5 | Scalability & capacity | | |
| 6 | Incident response | | |
| 7 | Data & backups | | |

### Verified how
<what was checked by reading code or config, vs taken on trust - be specific>

### Unverified
| Item | Why it could not be checked | Who can confirm |

### The 3am question
<if this pages at 3am, does the responder have what they need? one honest
paragraph, not a checkbox>
```

