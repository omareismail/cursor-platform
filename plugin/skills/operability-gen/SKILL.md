---
name: operability-gen
description: "Generates the three artifacts that decide whether a feature can be RUN rather than merely built: SLI/SLO definitions with an error-budget policy, alert rules that link to a runbook, and the runbook itself. Alerts on symptoms not causes. Use when asked about SLOs, SLIs, error budgets, alerting, on-call, runbooks, monitoring thresholds, or what to do when a service breaks. Invoked as /operability-gen."
---

<!-- GENERATED from the cursor-platform source skill "operability-gen".
     Do not edit here - edit the source and re-run the plugin build. -->

# Skill: operability-gen

**Invocation:** `/operability-gen [feature-id|service|endpoint]`
Example: `/operability-gen premium-calculation` · `/operability-gen Tamkeen.Payments` · `/operability-gen "POST /api/v1/refunds"`

---

## Overview

**Memory references:** `.cursor/cache/feature-map.json` (from `feature-trace`),
`memory-bank/architecture.md`, `memory-bank/businessRules.md`,
`memory-bank/deploymentNotes.md`, `memory-bank/performanceGuidelines.md`,
`memory-bank/technologyStack.md`

`operability-gen` produces the three artifacts that decide whether a feature can
be *run*, as opposed to merely built: **SLIs and SLOs with an error-budget
policy**, **alert rules that link to a runbook**, and **the runbook itself**.

`dotnet-observability-gen` already wires structured logging, traces and metrics —
it makes the system *observable*. Nothing currently says what to *watch*, at what
threshold that is unacceptable, who gets woken, or what they should do at 3am.
Telemetry without an SLO is a dashboard nobody reads; an alert without a runbook
is a page nobody knows how to action.

Three principles this skill will not compromise on, because they are what
separates a real operability artifact from documentation theatre:

1. **Alert on symptoms, not causes.** Page on "checkout error rate above budget",
   not "CPU above 80%". High CPU may be fine; a failing checkout never is. Cause
   alerts are the main source of alert fatigue, and alert fatigue is how the real
   page gets missed.
2. **Every alert links to a runbook section.** An alert that does not tell the
   responder what to do is a notification, not an alert.
3. **The error budget must have a policy attached.** A number nobody acts on is
   decoration. The policy names what happens when the budget runs out.

---

## Steps

**Step 0 — Get the behaviour.**

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/feature-map.mjs show <feature-id>
```

If there is no fresh trace, run `/feature-trace` first. You cannot write a
meaningful SLI for a code path you have not read — you will pick the endpoint
that is easy to measure rather than the one users care about.

Identify from the trace: the **user-facing journeys** (not the internal calls),
the dependencies that can fail, the data mutations that must not be lost, and
anything already emitting metrics from `dotnet-observability-gen`.

**Step 1 — Choose SLIs. Fewer, and user-facing.**

An SLI is a ratio: good events ÷ valid events. Pick at most 2–4 per service.

| SLI type | Good definition | Bad definition (avoid) |
|---|---|---|
| Availability | successful requests ÷ valid requests, per user journey | "server uptime" — the box being up says nothing about whether checkout works |
| Latency | requests faster than threshold ÷ valid requests | "average response time" — averages hide the tail, and the tail is the user experience |
| Correctness | records reconciled ÷ records processed | "no exceptions logged" |
| Freshness | records processed within window ÷ total | "job ran" — running and succeeding are different |

For fintech specifically, **correctness and freshness SLIs matter more than
availability** and are almost always missing: a settlement that is late or wrong
is a worse incident than one that returned 503, because the 503 is visible and
the wrong number is not.

Exclude from "valid events": load tests, health checks, requests already rejected
as malformed by the client's own fault. Say what you excluded and why.

**Step 2 — Set SLO targets from business consequence, not from current
performance.**

Ask what actually breaks for the user at each level. If nobody can answer, that
is the finding — record it as an open question rather than inventing 99.9%
because it is a familiar number.

State the target, the window (28 or 30 rolling days), and the resulting budget:

| SLO | Target | Window | Error budget | In practice |
|---|---|---|---|---|
| Checkout availability | 99.9% | 30d rolling | 0.1% | ~43 min/month of failed checkouts |
| Quote latency p95 < 400ms | 99% | 30d rolling | 1% | ~7.2h/month above 400ms |

Show the budget in **minutes or requests**, never only as a percentage. "99.9%"
does not provoke a decision; "43 minutes a month" does.

**Step 3 — Write the error-budget policy. This is the part that gets skipped.**

The policy converts the number into an enforced action. Without it the SLO is a
wish:

```markdown
## Error budget policy — <service>

| Budget remaining | What happens |
|---|---|
| > 50% | Ship normally. Risky changes allowed behind flags. |
| 25–50% | Ship normally; new work must include its own rollback plan. |
| 10–25% | Feature work pauses. Reliability fixes and security patches only. |
| < 10% | Change freeze except reliability and security. Incident review before the next feature merge. |
| Exhausted | Freeze, plus a written plan with dates before it lifts. |

**Burn-rate pages** (fast burn matters more than slow depletion):
| Burn rate | Window | Action |
|---|---|---|
| 14.4x | 1h | Page immediately — the month's budget is gone in ~2 days |
| 6x | 6h | Page |
| 3x | 24h | Ticket, not a page |
| 1x | 72h | Ticket |

**Who can override:** <name a role, not "the team">
**Reviewed:** <date> — revisit if the target is missed twice in a row
```

An SLO nobody has ever missed is set too loose and is telling you nothing.

**Step 4 — Generate alert rules from the SLOs.**

Emit rules in the project's actual alerting format — Prometheus rule YAML,
Azure Monitor / App Insights alerts, or Grafana — resolved from
`technologyStack.md` and `deploymentNotes.md`. Do not invent a format.

Every rule must carry: severity, the SLO it defends, a **runbook link with an
anchor**, and the burn rate it corresponds to. Multi-window multi-burn-rate
alerting (short window confirms, long window qualifies) is the default, because
single-window alerts either flap or fire too late.

Alerts that page a human are for symptoms with a user impact. Everything else is
a ticket. If a rule cannot be tied to an SLO, ask what it is for — usually the
honest answer is "we were worried once", and it belongs on a dashboard instead.

**Step 5 — Write the runbook.**

One section per alert, each answering the same five questions in the same order,
because at 3am structure beats prose:

```markdown
### <Alert name>

**What is broken, from the user's point of view:** <one sentence>
**Severity / who is paged:** <sev, rota>

**1. Confirm it is real** — <query, dashboard link, or command>
**2. Assess blast radius** — how many users, which tenants, which regions
**3. Mitigate first, diagnose second** — the fastest safe action:
   - toggle flag `<name>` to 0%
   - roll back: `<exact command>`
   - scale / shed load / fail over: `<exact command>`
**4. Confirm recovery** — which metric returns to what, over what period
**5. If mitigation fails** — escalate to <role>, and the one thing not to do
   (e.g. "do not re-run the settlement job — it is not idempotent")

**Known false positives:** <what triggers this that is not an incident>
**Last exercised:** <date> — a runbook nobody has followed is a hypothesis
```

Cover the failure modes that actually recur: elevated latency, error-rate spike,
deployment rollback, queue backlog, third-party outage, certificate expiry,
database connection exhaustion, data corruption, capacity exhaustion, and — for
financial systems — reconciliation mismatch and duplicate payment.

Include the exact commands. A runbook that says "restart the service" and leaves
the responder to work out how has failed at the only moment it exists for.

**Step 6 — Take the inventory of what can fail without you.**

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/failure-modes.mjs scan
```

Every dependency this system does not control, what protects it, whether the
design says what happens when it fails, and whether any test has ever made it
fail. An alert and a runbook for a dependency whose failure behaviour was never
decided is a page that says "something is wrong" to somebody with no next step.

Three findings are worth stopping for:

- **No timeout.** The one that actually takes services down. A dependency that
  fails returns an error you can handle; one that goes *slow* fills the pool and
  takes you with it. `new HttpClient()` waits a hundred seconds by default.
- **Retry without idempotency.** `AddStandardResilienceHandler` retries by
  default. On a money path that pays twice, and the second payment is invisible
  until reconciliation.
- **Nothing makes it fail in a test.** Every test of that dependency has it
  working, so nobody has seen the fallback run — including the runbook's author.

Each one becomes a runbook entry, and the last one becomes the rehearsal gate 6
asks for. Production chaos is out of scope: against regulated traffic that is a
formal change with a named owner, not something this skill proposes.

**Step 7 — Flag what you could not determine.**

Do not invent an on-call rota, a paging target, a dependency SLA, or a business
tolerance. List them as **must be answered by a human before this is real**, with
the question phrased so it can be answered in one line.

---

## Example Invocation

**Command:** `/operability-gen premium-calculation`

Agent reads the cached trace, finds the capability runs in three places
(endpoint, nightly job, export report), and proposes four SLIs — quote-endpoint
availability and latency, plus a **correctness** SLI on job-vs-endpoint agreement
and a **freshness** SLI on the nightly reconciliation, neither of which had any
telemetry at all. It writes the budget policy, six Prometheus rules with runbook
anchors, and a runbook whose reconciliation-mismatch section says explicitly not
to re-run the job because it is not idempotent — a fact taken from the trace.
Three open questions go to the user, including who is paged out of hours.

---

## Output

- File: `docs/operability/<slug>-slo.md` — SLIs, SLOs, error-budget policy
- File: `docs/operability/<slug>-alerts.<yml|json>` — alert rules in the project's format
- File: `docs/operability/<slug>-runbook.md` — one section per alert
- Console:

```
## Operability: <feature/service>

**SLIs:** <n>   **SLOs:** <n>   **Alerts:** <n> (<n> page, <n> ticket)
**Source:** feature-map trace (fresh|stale) | direct read

### SLOs proposed
| SLI | Target | Window | Budget | In practice |

### Alerts
| Alert | Severity | Defends | Burn rate | Runbook anchor |

### Coverage gaps
<failure modes with no SLI, and paths with no telemetry to build one from>

### Must be answered by a human
<on-call rota, paging target, dependency SLAs, business tolerances - each as a
single answerable question>
```

Hand off: `/production-readiness-review` to check this is actually wired up
before shipping.

