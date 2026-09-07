---
name: delivery-metrics
description: "Measures whether the platform is improving delivery or just producing code faster. Computes DORA four keys plus rework rate, change size and churn hotspots from git history via delivery-metrics.mjs, labelling each metric MEASURED or PROXY. Use when asked about deployment frequency, lead time, change failure rate, MTTR, DORA, engineering productivity, or whether delivery is getting better or worse. Invoked as /delivery-metrics."
---

<!-- GENERATED from the cursor-platform source skill "delivery-metrics".
     Do not edit here - edit the source and re-run the plugin build. -->

# Skill: delivery-metrics

**Invocation:** `/delivery-metrics [--days 90] [--trend]`
Example: `/delivery-metrics` · `/delivery-metrics --days 180 --trend` · `/delivery-metrics --deploy-tag 'v*'`

---

## Overview

**Memory references:** `memory-bank/progress.md`, `memory-bank/techDebt.md`,
`memory-bank/deploymentNotes.md`, `.cursor/cache/feature-map.json`

`delivery-metrics` measures whether the platform is actually improving delivery,
or just producing more code faster. It runs `${CLAUDE_PLUGIN_ROOT}/tools/delivery-metrics.mjs`
over git history and interprets the result.

**Why this matters more here than in a normal repo.** DORA's 2025/2026 research
found AI-assisted delivery raises throughput 2–18% while stability *degrades* —
one study measured change failure rate rising from 8% to 14% after Copilot
adoption, alongside PR size +154% and review time +91%. Lightrun's 2026 report
found 43% of AI-generated changes still needed manual debugging in production
after passing QA and staging. DORA's own summary: *"AI improves outcomes only
when the underlying delivery system is already working well."*

This workspace is 97 skills of throughput amplification. That is exactly the
configuration the research warns about. Without a number, "is this helping?" gets
answered by whoever is most confident — which is not a control system.

The tool is deliberately honest: every metric is labelled **MEASURED** or
**PROXY**, and each proxy is named. Your job in this skill is to keep it that way
when you interpret. A confident reading of a proxy is how a dashboard starts
lying.

---

## Steps

**Step 0 — Run it.**

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/delivery-metrics.mjs report --days 90
node ${CLAUDE_PLUGIN_ROOT}/tools/delivery-metrics.mjs trend  --days 180 --bucket 30
```

Improve the inputs before interpreting, if you can find them:

```bash
# real deploys instead of merge commits
node ${CLAUDE_PLUGIN_ROOT}/tools/delivery-metrics.mjs report --deploy-tag 'v*'
# the team's actual incident/hotfix convention
node ${CLAUDE_PLUGIN_ROOT}/tools/delivery-metrics.mjs report --fix-pattern '\b(hotfix|INC-[0-9]+)\b'
```

Check `deploymentNotes.md` and `git tag -l` for the real release convention
before falling back to the default. Ten minutes finding the right tag glob is
worth more than any amount of interpretation of the wrong one.

**Step 1 — Read the trend, not the level.**

A single reading tells you almost nothing. A team at "Medium" and improving is in
a better position than a team at "High" and sliding. Report direction first.

**Step 2 — Look for the specific failure pattern this exists to catch.**

The signature of generating faster than you verify:

| Signal | What it means |
|---|---|
| Deployment frequency ↑ **and** change failure rate ↑ | Shipping more, breaking more. Net negative — the extra throughput is being spent on rework. |
| Rework rate ↑ | Re-touching recently written code. The clearest single indicator that verification is lagging generation. |
| Change size ↑ | Larger changes are harder to review and correlate with higher failure rates. AI-assisted work grows PRs by default; it needs deliberate counter-pressure. |
| Lead time ↑ while deploys ↑ | Work is queuing somewhere — usually review. Verification, not generation, is the bottleneck. |
| Churn concentrated in a few files | Those files are either under-specified or genuinely hard. Candidates for `/feature-trace` and then a proper redesign. |

Cross-reference: if rework is high, run `/delivery-metrics` alongside
`/feature-inventory` and see whether the churn hotspots are capabilities nobody
has traced. Undocumented behaviour and repeated rework are usually the same
problem.

**Step 3 — Interpret honestly, including against the platform itself.**

State plainly if the numbers suggest the platform is not helping. The whole point
of measuring is to be able to find that out; a report that always concludes
"things are fine" is not worth running. If change failure rate rose after skills
were adopted, say so and propose tightening the verification layer (build gates
in `templates/`, more of the `*-audit` skills in CI) rather than adding more
generators.

Equally, do not over-claim causation. Team size, release cadence, a migration, or
one bad quarter all move these numbers. Correlate with `progress.md` and
`decisionLog.md` before attributing anything.

**Step 3b — Read the governance records, not only git.**

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/delivery-intel.mjs report
node ${CLAUDE_PLUGIN_ROOT}/tools/delivery-intel.mjs questions
```

DORA measures the codebase. That is half the picture, and it is the half that
cannot tell you whether the *process* is working or merely being performed. The
lifecycle has been accumulating the other half all along — gate verdicts and
their attempt counts, overrides and whether they lapsed, release records and who
signed them, incidents and how they were found, the architectural-debt baseline
and whether it ever moved — and until now every one of those was read alone.

`questions` is the part to bring into the report. It prints observations with
**both** readings each permits and the evidence that separates them: eight
verdicts and no NO-GO is either unusually good work or a review that has never
been in a position to say no, and the tool refuses to decide which. Nothing there
is scored, because a number reported as good becomes a number to hit — and the
cheapest way to hit "no failed gates" is to stop looking.

Two of its findings pair directly with DORA:

- **Incidents found by a customer or by reconciliation** — the monitoring did not
  fire. That is a finding about the alerts, and it inflates MTTR in a way the
  DORA number alone attributes to the fix.
- **Releases that shipped under an override** — where change failure rate has an
  explanation that is written down, dated, and has an owner's name on it.

**Step 4 — Recommend at most three actions.**

Tie each to the specific metric that motivated it, and prefer actions that change
the *system* over actions that ask people to try harder:

- Change size climbing → enforce smaller tasks (`/work-breakdown`, and the ≤8
  file ceiling in `task-graph`)
- CFR climbing → the verification layer is too thin; install more of
  `templates/` in CI, and gate on `/production-readiness-review`
- Lead time climbing with review as the bottleneck → move baseline checks off
  human eyes (analyzers, hooks, CI) so review is spent on intent and
  architectural fit, which is where humans actually add value
- Rework concentrated → trace and redesign the hotspot, do not keep patching it

**Step 5 — Record the reading.**

Append the headline numbers and date to `memory-bank/progress.md` so the next run
has a baseline. Without a recorded history, every run is a first run.

---

## Caveats to state in every report

- Git history cannot observe deployments or incidents. Proxies are named on each
  line; repeat them rather than hiding them.
- Fewer than ~30 commits or ~10 deploys in the window makes every ratio noise.
  Say so instead of computing a percentage from four data points.
- Squash-merge workflows destroy branch history, which degrades lead time to a
  weak proxy. That is a property of the workflow, not a bug in the tool.
- Change failure rate depends entirely on commit-message hygiene. If the team
  does not label fixes, the number is close to meaningless — and *that* is the
  finding worth reporting.

---

## Example Invocation

**Command:** `/delivery-metrics --days 180 --trend`

Agent finds deployment frequency up 40% over two quarters, change failure rate up
from 9% to 16%, rework rate up from 12% to 22%, and median change size up from
180 to 420 lines. It reports that throughput and stability are moving in opposite
directions — the documented AI-adoption failure mode — identifies three churn
hotspots that have never been traced, and recommends exactly three things: the
`task-graph` file ceiling to force smaller changes, the `templates/` build gates
in CI, and `/feature-trace` on the worst hotspot before it is touched again.

---

## Output

```
## Delivery metrics: last <n> days on <branch>

**Direction:** improving | flat | degrading   (state this first)

| Metric | Now | Prior window | DORA band | Measured? |
|---|---|---|---|---|
| Deployment frequency | | | | |
| Lead time for changes | | | | |
| Change failure rate | | | | |
| Time to restore | | | | |
| Rework rate | | | | |
| Change size (median) | | | | |

### What the trend says
<2-4 sentences. Lead with any case of throughput and stability diverging.>

### Churn hotspots
| File | Re-touched | Traced? | Suggested action |

### Three things to change
| # | Action | Metric it targets | Why this rather than trying harder |

### What these numbers cannot tell you
<the named proxies, the sample size, the workflow limitations - specifically,
not as boilerplate>
```

Record the headline numbers in `memory-bank/progress.md` before finishing.

