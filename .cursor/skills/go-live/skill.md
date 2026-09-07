# Skill: go-live

**Invocation:** `/go-live [plan | execute | verify]`

---

## Overview

`go-live` produces and then runs the cutover: the ordered sequence of steps that
takes a system from tested to serving real users, with the abort criteria and the
rollback written before anything starts. It is deliberately separate from
`/production-readiness-review`, which judges whether the system *should* go live,
and from `/release-safety`, which designs how change reaches users over time.
This one is about a single Tuesday morning — the order of operations, who does
what, what "it worked" means, and the point past which rolling back stops being
possible.

---

## Steps

**Step 1 — Refuse to plan a cutover for a system that is not ready.**

```bash
node .cursor/tools/lifecycle.mjs status
```

The `TESTING` gate must be `APPROVED`. If it is not, stop and say so. Then run
`/production-readiness-review` and quote its verdict verbatim. A NO-GO ends this
skill; do not soften it, and do not produce a plan "to be ready when it passes" —
that plan is the softening.

**Step 2 — `plan`: write the runbook.**

```markdown
# Cutover — <product> <version>

**Window:** <date, time, timezone>   **Duration:** <estimate>
**Commander:** <name>   **Approver:** <name>   **On call after:** <name>

## Point of no return
<The step after which rollback becomes data recovery rather than a redeploy.
Everything reversible happens before it.>

## Sequence
| # | Step | Owner | Duration | Verify | Rollback |
|---|---|---|---|---|---|
| 1 | Enable maintenance page | | 2m | 503 with the right copy, both languages | Disable |
| 2 | Backup and verify restore | | 20m | Restore into scratch, row counts match | — |
| 3 | Run migrations | | 10m | Migration history matches expected | Restore |
| 4 | Deploy, all flags off | | 5m | Health checks green | Redeploy previous |
| 5 | Smoke tests | | 10m | The critical journeys pass | Redeploy previous |
| 6 | Enable flags, first ring | | 2m | Ring metrics within budget | Flags off |
| 7 | Remove maintenance page | | 1m | Real traffic served | Maintenance on |

## Abort criteria
<Named, measurable, decided now — not judged live at 3am under pressure.>

## Verification
| Check | Expected | Owner |
|---|---|---|

## Comms
| When | Who | Channel | Message |
|---|---|---|---|
```

The abort criteria are the part that gets skipped and the part that matters.
Decided in advance they are a rule; decided during the incident they are an
argument.

**Step 3 — `execute`: run it, one step at a time.**

Announce each step before it runs, run it, verify it, record the actual time.
Never run ahead. If a verify fails, stop and state the abort criterion — do not
continue on the assumption it will resolve.

Anything touching production is the user's to run. Migrations against a
non-local connection are blocked by the Bash hook, and that block is correct:
present the command, let a human execute it.

**Step 4 — `verify`: prove it after traffic arrives.**

Health checks, the critical journeys against production, error rate and latency
against the phase 1 NFRs, and the first entries appearing in the audit trail.

Watch for the first full business cycle, not the first ten minutes. Most
cutover failures in this domain appear at the first scheduled job or the first
end-of-day reconciliation.

**Step 5 — Close the phase.**

Record the actual timings against the estimates — that is what makes the next
cutover plan realistic. Then:

```bash
node .cursor/tools/lifecycle.mjs approve PRODUCTION --by "<name>"
```

Say plainly that the lifecycle is now complete and what happens next:
`/postmortem` for anything that broke, `/delivery-metrics` to find out whether
any of this is working, and a `rollback DEVELOPMENT --reason "..."` when the next
release starts.

---

## Output

- `docs/design/cutover-<version>.md`
- Terminal: the sequence with actual timings, verification results, and the
  post-live watch list
