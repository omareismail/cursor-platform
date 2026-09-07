# Gate 6 — Production

**Blocks:** going live.
**Mechanical check:** `node .cursor/tools/lifecycle.mjs check PRODUCTION`
**Judgement:** `/lifecycle-gate`, wrapping `/production-readiness-review`.
**Authored by:** `ops-reviewer`
**Reviewed by:** `security-auditor` — never an author of the artifacts above.

This is the one gate that must never be automated away, and the one where the
pressure to soften a NO-GO is highest. `AGENTS.md` already says it: do not
soften a NO-GO. A gate that has never blocked anything is a form, not a control.

---

## Who reviews this, and why

`security-auditor` judges this gate. Not because it is senior, but because of what it
loses if this gate passes on bad work:

Production is where the design's security assumptions meet real traffic and real
secrets. And a runbook's author is the worst possible judge of whether someone
else can follow it at three in the morning.

Launch it as a **fresh subagent**. It has to reach these criteria through the
documents, not through the conversation that produced them — an author
re-reading their own work still has all of the author's reasons in context,
and never finds the thing they did not think of the first time.

`record-gate` refuses a verdict filed under any other role, and `approve`
refuses a signature from the same party that filed the verdict.

---

## Judgement criteria

**1. `/production-readiness-review` returns GO.**
PASS: GO across all seven dimensions, unsoftened.
FAIL: anything else. A conditional GO is a NO-GO with better manners.

**2. The pipeline builds, tests, scans and deploys.**
PASS: CI runs build, test, security scan and the lifecycle gate check, and
deployment is a pipeline run, not a person with credentials.
FAIL: a manual step nobody documented.

**3. Secrets are in a vault.**
PASS: nothing in source, nothing in the image, everything injected at runtime;
rotation documented.
FAIL: a value in `appsettings.Production.json`.

**4. Migrations are safe on a live database.**
PASS: reviewed for destructive change and lock duration; anything risky uses
expand -> migrate -> contract; large tables have a batching plan.
FAIL: `ef database update` against production. The Bash hook blocks it — that
block is a signal to stop, not to find another route.

**5. Observability is live before traffic is.**
PASS: `/operability-gen` output deployed — SLIs, SLOs, error-budget policy,
alerts that fire on symptoms and link to a runbook.
FAIL: alerts added after the first incident.

**6. Health checks are wired to the orchestrator.**
PASS: liveness and readiness distinguished; readiness actually checks
dependencies.
FAIL: a `/health` returning 200 unconditionally.

**7. Rollback is tested and fast.**
PASS: a tested procedure with a stated time-to-rollback, and a plan for data
written by the bad version.
FAIL: "redeploy the previous tag" with no data story.

**8. Rollout is staged.**
PASS: `/release-safety` output — flags, rings or canary, with the criterion that
promotes each stage.
FAIL: big-bang to all users.

**9. Someone is on call and knows.**
PASS: a named owner, a runbook they have read, an escalation path.
FAIL: the team finds out from a customer.

**10. Compliance evidence is filed.**
PASS: SAMA/ZATCA/mada evidence produced and stored where an auditor will look.
FAIL: reconstructing it after the fact.

---

## After the gate

Approval is not the end of the lifecycle — it is the start of the part that runs
forever.

| Event | Skill |
|---|---|
| Something broke | `/postmortem` — output is a compile-time guard, not a document |
| A release shipped | `/changelog-gen`, `/release-notes-gen` |
| Is delivery improving | `/delivery-metrics` — DORA plus rework rate |
| A new feature | `rollback DEVELOPMENT --reason "..."`, then the feature pipeline |

DORA's 2025/2026 research found AI adoption raises throughput while stability
degrades — change failure rate 8% to 14% in one study. A 96-skill platform is a
throughput amplifier, which is exactly that configuration. Run
`/delivery-metrics` rather than assuming which way this one is going.

---

## Verdict

```
GATE 6 — PRODUCTION: GO | NO-GO
Mechanical:   <pass/fail>
Criteria:     <n>/10 pass
Readiness:    <GO/NO-GO from /production-readiness-review, verbatim>
Rollback:     <tested on: date, environment, time-to-rollback>
On call:      <named owner>
Blocking:     <criterion, what is wrong, what would fix it>
Record:      node .cursor/tools/lifecycle.mjs record-gate PRODUCTION --verdict GO|NO-GO \
                  --by "security-auditor" --criteria "<n>/<total>"
Then:        node .cursor/tools/lifecycle.mjs approve PRODUCTION --by "<a human, not security-auditor>"
```

A NO-GO here is the system working. Report it plainly.
