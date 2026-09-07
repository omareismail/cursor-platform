# Skill: threat-model

**Invocation:** `/threat-model [spec-file|feature-id|service]`
Example: `/threat-model specs/features/refunds.md` · `/threat-model premium-calculation` · `/threat-model Tamkeen.Payments`

---

## Overview

**Memory references:** `memory-bank/securityStandards.md`,
`memory-bank/architecture.md`, `memory-bank/businessRules.md`,
`memory-bank/decisionLog.md`, `.cursor/cache/feature-map.json`,
`.cursor/rules/04-security-guard.mdc`, `.cursor/rules/07-audit-trail-guard.mdc`

`threat-model` applies **STRIDE at design time** — before the code exists, when
the fix is a design change rather than a rewrite. Security flaws caught in the
design phase cost roughly 100x less than the same flaw found in production, and
STRIDE remains the most widely used framework for this in 2026; Microsoft's SDL
still references it.

This is the one security activity the platform did not have. Everything existing
is **reactive**: `04-security-guard` catches anti-patterns as code is written,
`security-auditor` sweeps what already exists, `compliance-audit` checks against
SAMA/ZATCA after the fact. All of those find flaws in a design that is already
committed. None of them ask "what could an attacker do with this design?" while
the design is still cheap to change.

Sits in the spec pipeline between `/speckit-specify` and `/speckit-plan`: you
need the contract to model against, and the threats change the plan.

Read-only. Produces a model and a set of mitigations to schedule.

---

## Steps

**Step 0 — Get the design.**

From a spec: the API contract, data model, trust boundaries, auth requirements.
From an existing feature: `node .cursor/tools/feature-map.mjs show <id>` — a
fresh trace already lists entry points, data touched, auth policies and external
dependencies, which is most of what you need.

If neither exists, stop and ask. Threat modelling a system you are imagining
produces imaginary threats.

**Step 1 — Draw the data flow and, above all, the trust boundaries.**

Identify:

- **External entities** — users, partner systems, third-party APIs
- **Processes** — endpoints, handlers, jobs, consumers
- **Data stores** — tables, caches, queues, blob storage, logs
- **Data flows** — what moves between them, and in which direction
- **Trust boundaries** — every point where data crosses from less-trusted to
  more-trusted

**Threats live on trust boundaries.** Everything crossing one is where STRIDE
applies. Typical boundaries in a .NET + React fintech system: browser → API,
API → database, service → service, service → partner API, job → shared table,
and the one most often missed — **tenant A's data → tenant B's request path**.

Emit the diagram as Mermaid so it lives in the repo. Do not hand off to
`/architecture-map-gen` — that draws structure, this draws trust.

**Step 2 — Apply STRIDE per element.**

| Letter | Threat | Violates | Ask, concretely |
|---|---|---|---|
| **S** | Spoofing | Authentication | Can someone claim to be another user, service, or tenant? Is service-to-service traffic authenticated, or trusted because it is "internal"? |
| **T** | Tampering | Integrity | Can data be modified in transit, at rest, or in a queue? Can a client change a field the server then trusts — price, amount, tenant id? |
| **R** | Repudiation | Non-repudiation | Can someone deny having done it? Is there an audit record with who, when, and what changed — and can it be edited? |
| **I** | Information disclosure | Confidentiality | Can data leak via responses, error messages, logs, timing, or a shared cache key? Does an over-posted entity return fields the caller should not see? |
| **D** | Denial of service | Availability | Can one caller exhaust a shared resource — connections, queue depth, an unbounded query, an expensive export? |
| **E** | Elevation of privilege | Authorization | Can a user act as an admin, or reach another tenant's resource by changing an id? |

**The threat to look hardest for in multi-tenant fintech is E, specifically
IDOR** — a resource fetched by route id with no server-side check that the caller
owns it. It is the highest-frequency, highest-impact finding class in this domain
and it is invisible to every scanner because the code looks correct.

Two more worth forcing yourself to ask, because they are consistently missed:

- **Business-logic abuse.** Not a technical flaw: refund the same transaction
  twice, exploit a rounding rule, order operations so a validation is skipped,
  race two concurrent requests past a balance check. STRIDE will not surface
  these unless you deliberately walk the business rules in
  `memory-bank/businessRules.md` and ask "how would I abuse this for money?"
- **Insider and compromised-credential paths.** Assume valid credentials. What
  can a support user, a DBA, or a stolen service token reach?

**Step 3 — Rate each threat, and be explicit that the rating is a judgment.**

| Risk | Meaning |
|---|---|
| **Critical** | Exploitable by an unauthenticated or low-privileged actor, with money, PII, or regulatory impact |
| **High** | Exploitable with valid credentials; significant impact |
| **Medium** | Requires unusual conditions, or impact is contained |
| **Low** | Theoretical, or already mitigated by something outside this design |

Rate on impact × likelihood, and **say what you assumed** about likelihood. A
rating with hidden assumptions cannot be argued with, which means it cannot be
corrected.

**Step 4 — Decide a response per threat. Four options, all legitimate.**

| Response | When | Requires |
|---|---|---|
| **Mitigate** | Default | A specific control, and where it goes |
| **Transfer** | The risk belongs elsewhere | Who accepts it, and confirmation they know |
| **Accept** | Cost of mitigating exceeds the risk | Written acceptance by a named owner, with a date to revisit |
| **Eliminate** | The feature can work without the risky capability | The design change |

**Accept is a valid answer, but only in writing with a name on it.** An
undocumented accepted risk is indistinguishable from an oversight, and six months
later nobody can tell which it was.

Every mitigation must be concrete enough to become a task: *"authorization filter
on `BrokerId` in the query itself, not in the handler after fetch —
`BrokerClientRepository.GetByIdAsync`"*, not *"add proper authorization"*.

**Step 5 — Cross-check what already exists.**

Before proposing a control, check whether the codebase already has one — an
existing policy, a base handler that filters by tenant, a middleware. Proposing a
second mechanism for something already solved creates two ways to do it, which is
its own security problem. Use `pattern-scout` or `/pattern-finder`.

Then check the guard rules: a threat that `04-security-guard`,
`06-database-provider-guard` or `07-audit-trail-guard` already blocks at
generation time is mitigated by construction — say so and move on. A threat none
of them cover is a candidate for a **new rule or a `BannedSymbols.txt` entry**,
which is how a one-off finding becomes permanent.

**Step 6 — Hand off.**

- Mitigations to schedule → `/work-breakdown` (each becomes a task with a verify
  command)
- Regulatory overlap → `/compliance-audit` for SAMA/ZATCA/mada specifics
- Verify the mitigations landed → `security-auditor` subagent after implementation
- Accepted risks → record in `memory-bank/decisionLog.md` with owner and date
- The plan changes as a result → re-run `/speckit-plan`

---

## Example Invocation

**Command:** `/threat-model specs/features/refunds.md`

Agent draws the flows and finds four trust boundaries, including broker →
broker's-own-clients, which the spec does not mention. STRIDE surfaces 11
threats. Two Critical: **E** — the refund endpoint takes a `transactionId` with
no check that it belongs to the caller's broker (classic IDOR, and the spec's
auth policy does not cover it); and business-logic abuse — the refund state
machine allows two concurrent requests to both pass the "not already refunded"
check because the check and the write are not in one transaction. Both are design
changes, cheap now. It also notes the audit-trail requirement is already enforced
by `07-audit-trail-guard`, so **R** is mitigated by construction, and proposes
one new `BannedSymbols.txt` entry.

---

## Output

- File: `docs/security/<slug>-threat-model.md`
- Console:

```
## Threat model: <scope>

**Elements:** <n> processes, <n> stores, <n> external   **Trust boundaries:** <n>
**Threats:** <critical>C / <high>H / <medium>M / <low>L
**Already mitigated by existing guards:** <n>

### Data flow
```mermaid
<flow diagram with trust boundaries marked>
```

### Threats
| # | Element | STRIDE | Threat | Risk | Response | Mitigation (concrete) |

### Critical - design changes, cheap now, expensive later
<expanded, one per threat, with the exact control and where it goes>

### Business-logic abuse
<double-spend, rounding, ordering, race conditions - not covered by STRIDE
letters but where the money actually goes>

### Accepted risks
| # | Threat | Why accepted | Owner | Revisit by |

### Mitigated by construction
<threats the guard rules or existing patterns already block - so nobody
re-implements a control that exists>

### Assumptions behind the ratings
<what was assumed about attacker capability, exposure and likelihood>
```
