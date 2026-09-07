# Skill: release-safety

**Invocation:** `/release-safety [feature-id|change|release]`
Example: `/release-safety premium-calculation` · `/release-safety "tiered pricing rollout"` · `/release-safety --flag-debt`

---

## Overview

**Memory references:** `.cursor/cache/feature-map.json`,
`memory-bank/deploymentNotes.md`, `memory-bank/businessRules.md`,
`memory-bank/databaseConventions.md`, `memory-bank/architecture.md`

`release-safety` plans how a change reaches users **without a big-bang cutover**,
and how it gets pulled back when something is wrong. It covers four things:

1. **Feature flag lifecycle** — creation with a named owner and an expiry date,
   through rollout, stabilisation, and the step everyone skips: cleanup
2. **Progressive rollout rings** — 1% → 5% → 25% → 50% → 100%, with the gate
   metrics that decide whether to widen or stop, defined *before* the rollout
   starts
3. **Rollback** — the exact action, its time-to-effect, and what it does not undo
4. **Migration reversibility** — expand → migrate → contract, so no intermediate
   state is undeployable

The core idea, which the 2026 progressive-delivery literature is unanimous on:
**rolling back from 5% affects 5% of users.** Deploy and release are separate
events. Deploying puts code on servers; releasing exposes behaviour to users. If
those happen at the same instant, every deploy is a bet.

Backed by `.cursor/tools/flag-debt.mjs`, which fails CI on flags past their
expiry — because a flag that has been 100% on for fourteen months is not a flag,
it is permanent dead branching that every future reader and every future agent
has to carry.

---

## Steps

**Step 0 — Understand what is changing and what it can break.**

```bash
node .cursor/tools/feature-map.mjs show <feature-id>
node .cursor/tools/flag-debt.mjs scan
```

Run `/impact-analysis` if it has not been run. A rollout plan for a change whose
blast radius is unknown is a plan for the happy path only — and the reason you
need a rollout plan is the unhappy path.

Classify the change, because the safe strategy differs sharply:

| Change type | Safe strategy |
|---|---|
| Additive behaviour (new endpoint, new screen) | Flag + rings |
| Modified behaviour on an existing path | Flag + rings + **explicit comparison** against the old result |
| Schema change | Expand → migrate → contract. Never a single destructive migration. |
| Contract/API change | Version it. Deprecate on a date. Never break in place. |
| Config/infrastructure | Canary by instance or region, not by user — or blue-green (Step 2b) |
| Data backfill | Batched, resumable, idempotent, with a dry-run mode |

**Step 1 — Feature flag lifecycle.**

Every non-permanent flag gets declared where the tool can see it:

```csharp
// FLAG: premium-v2 owner=@mahmoud expires=2026-09-30
// reason: tiered pricing rollout; remove once 100% for 14 days
```

The five stages, and what actually happens at each:

| Stage | State | Exit condition |
|---|---|---|
| **Creation** | Declared with owner + expiry, reviewed in the PR | Merged, off in production |
| **Development** | Off in prod, on in dev/staging | Feature complete behind the flag |
| **Rollout** | Progressive rings, gate metrics watched at each | 100%, gates green |
| **Stabilisation** | 100% for 7–14 days | No incidents attributable to it |
| **Cleanup** | **Flag removed, old code path deleted** | Both branches gone from the codebase |

Cleanup is a task on the board, not an intention. Add it in `/work-breakdown`
with the expiry date as its due date. The failure mode is never "we decided to
keep the flag"; it is that nobody was assigned to remove it.

Set the expiry at creation, and set it to when the *rollout* should be finished —
not to a comfortable distance. An expiry that is always six months out never
fires.

**Step 2 — Define the rings and their gates. Before starting, not during.**

| Ring | Audience | Bake time | Gate — widen only if all hold |
|---|---|---|---|
| 0 | Internal / staff only | 1 day | No errors attributable to the change |
| 1 | 1% of users | 1 day | Error rate within SLO, p95 latency within budget |
| 2 | 5% | 2 days | Same, plus the business metric is not worse |
| 3 | 25% | 2 days | Same, plus no support-ticket spike |
| 4 | 50% | 2 days | Same |
| 5 | 100% | 14 days | Then cleanup |

Two rules that make this real:

- **Define the gate metrics before the rollout begins.** Metrics chosen while
  watching a rollout get chosen to justify continuing.
- **Name the abort condition, not just the success condition.** "Roll back if
  error rate exceeds X for Y minutes" is actionable at 3am; "monitor closely"
  is not.

Pick the cohort deliberately: random percentage, internal users first, one tenant,
one region, or lowest-value traffic first. For multi-tenant fintech, **do not
sample randomly across tenants** — one tenant fully on is a cleaner signal and a
cleaner blast radius than 5% of every tenant's traffic.

**Step 2b — Blue-green, when per-user rings are impractical.**

Rings need a way to route *this user* to the new behaviour. Some changes have no
such handle — a framework upgrade, a runtime change, a rewritten background
worker, a stateful service. For those the unit of rollout is the **environment**,
not the user.

| | Rings / canary | Blue-green |
|---|---|---|
| Unit of rollout | A cohort of users | The whole environment |
| Rollback | Flag to 0% — seconds | Switch traffic back — seconds |
| Blast radius during rollout | 1% → 5% → 25% | **100% at the moment of switch** |
| Cost | One environment | Two full environments |
| Best for | Feature behaviour, anything user-attributable | Infrastructure, runtime and framework upgrades, stateful services |

**The database is what decides this**, and it is the part people skip. Blue and
green share one database, so the schema must satisfy **both versions at once**
for the whole window. That is expand → migrate → contract (Step 4) — without it,
switching back to blue lands on a schema blue cannot read, and your instant
rollback is not a rollback.

A workable sequence:

1. Deploy green alongside blue; green takes **no** production traffic
2. Smoke green against the shared database — it must tolerate the current schema
3. Switch a small slice (a weight, or internal users by header) — this is the
   only place blue-green borrows from canary, and it is worth doing
4. Switch fully; **keep blue running and warm**
5. Hold blue for at least one full traffic cycle — including the nightly jobs.
   Tearing it down at the end of the working day removes the rollback exactly
   when the batch window starts.
6. Decommission blue, then contract the schema in a later release

**Combine the two rather than choosing.** Blue-green for the deploy, flags for
the behaviour: the infrastructure change and the feature change then roll back
independently, which is what you want at 3am when you do not yet know which one
broke.

**Step 3 — Write the rollback plan, and be precise about its limits.**

```markdown
**Trigger:** <the metric and threshold that means stop>
**Action:** <exact command or flag toggle>
**Time to effect:** <flag = seconds; redeploy = minutes; migration = ?>
**Who can pull it:** <role, and whether it needs approval at 3am>
**What rollback does NOT undo:**
  - rows already written in the new shape
  - messages already published to consumers
  - emails, webhooks or payments already sent
  - caches holding the new serialised shape
**Recovery for those:** <backfill, compensating action, or "accepted risk">
```

That last section is the one that matters. A flag toggle reverts *behaviour*
instantly and reverts *side effects* not at all. For anything that moves money or
notifies a third party, the compensating action is the real rollback plan.

**Step 4 — Migration reversibility.**

Expand → migrate → contract, with each phase separately deployable:

1. **Expand** — add the new column/table, nullable, no reader depends on it
2. **Dual-write** — write both old and new; old remains the source of truth
3. **Backfill** — batched, resumable, idempotent, verifiable
4. **Migrate readers** — behind the flag, per ring
5. **Flip source of truth** — new becomes authoritative; old still written
6. **Contract** — stop writing old, then drop it, in a *later* release

Every intermediate state must be deployable and rollbackable. If step N cannot be
rolled back to step N−1, the plan is wrong, not the constraint.

Never combine a destructive migration with an application deploy. `db-auditor`
flags data-loss operations; treat any of them appearing in the same release as
the app change as a blocker.

**Step 5 — Flag debt.**

```bash
node .cursor/tools/flag-debt.mjs scan          # expired flags fail
node .cursor/tools/flag-debt.mjs scan --strict # undeclared flags also fail
```

Report expired flags with their age and use sites. For each: either finish the
rollout and delete the old path, or push the expiry **with a written reason**.
Make it a decision, not a default — the drift into permanence happens through
inattention, never through a choice anyone would defend out loud.

**Step 6 — Hand off.**

- No SLOs or alerts to gate the rings on → `/operability-gen` first; you cannot
  gate on metrics you do not collect
- Not sure it should ship at all → `/production-readiness-review`
- Cleanup and backfill work to schedule → `/work-breakdown`
- Destructive migration concerns → `db-auditor` subagent

---

## Example Invocation

**Command:** `/release-safety premium-calculation`

Agent classifies it as modified behaviour on an existing money path plus a schema
change. Proposes: expand→migrate→contract across three releases; a `premium-v2`
flag expiring in 8 weeks; rings starting with one internal tenant rather than a
random 5%, because premium is per-tenant and random sampling would make the
signal unreadable. Gate metrics are quote-endpoint error rate, p95 latency, and —
critically — a **comparison SLI** on old-vs-new premium agreement, since a wrong
premium is invisible to every other metric. The rollback section notes the flag
does not un-issue policies already priced under the new rule, and specifies the
compensating re-pricing job. Flag scan finds two flags expired 200+ days ago,
both in the same file being changed.

---

## Output

- File: `docs/releases/<slug>-rollout.md`
- Console:

```
## Release safety: <change>

**Change type:** <classification>   **Strategy:** flag + rings | canary | expand-migrate-contract
**Flags:** <n> new, <n> expired in scope
**Reversible:** yes | partially | NO - <what cannot be undone>

### Flag lifecycle
| Flag | Owner | Expires | Stage | Cleanup task |

### Rollout rings
| Ring | Audience | Bake | Gate metrics | Abort if |

### Rollback
**Trigger:** ...  **Action:** ...  **Time to effect:** ...
**Does NOT undo:** ...
**Compensating action:** ...

### Migration phases
| # | Phase | Deployable alone? | Rollback to previous? |

### Flag debt in scope
| Flag | Overdue | Use sites | Action |

### Blockers
<anything that must be true before the rollout can start - missing SLOs,
untested rollback, destructive migration bundled with an app change>
```
