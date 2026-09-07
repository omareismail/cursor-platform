---
name: postmortem
description: "Runs a blameless incident review and converts each finding into the highest mechanical enforcement available - a BannedSymbols entry, an analyzer severity, an architecture test, a lint rule, or a hook tripwire - rather than a document nobody reads. Builds the timeline from git and calls out the impact-to-detected and detected-to-diagnosed gaps. Use after an incident, outage, production bug, or regression. Invoked as /postmortem."
---

<!-- GENERATED from the cursor-platform source skill "postmortem".
     Do not edit here - edit the source and re-run the plugin build. -->

# Skill: postmortem

**Invocation:** `/postmortem [incident-description|incident-id]`
Example: `/postmortem "duplicate settlement postings on 12 Jul"` · `/postmortem INC-204` · `/postmortem --from-commit abc1234`

---

## Overview

**Memory references:** `memory-bank/commonMistakes.md`,
`memory-bank/decisionLog.md`, `memory-bank/techDebt.md`,
`memory-bank/businessRules.md`, `.cursor/cache/feature-map.json`,
`${CLAUDE_PLUGIN_ROOT}/rules/` (all guards), `templates/dotnet/BannedSymbols.txt`

`postmortem` runs a blameless incident review **and converts what was learned
into something mechanical**. That second half is the whole point.

Most postmortems produce a document, a list of action items, and — within two
quarters — a repeat of the same class of incident. The document is written by
people who already understand the problem, and read by nobody at the moment it
would have helped. This skill treats a well-written postmortem as an *input*, not
an output: every finding is pushed toward the layer that will catch it without
anyone remembering it exists.

The escalation ladder, strongest first:

| Preferred | Mechanism | Catches it |
|---|---|---|
| 1 | `BannedSymbols.txt` entry | At compile time, forever, for every author |
| 2 | Analyzer severity in `.editorconfig` | At compile time |
| 3 | Architecture/convention test | In CI, on every PR |
| 4 | ESLint rule / AST ban | At lint time |
| 5 | `PostToolUse` hook tripwire | While the agent is writing it |
| 6 | Guard rule in `${CLAUDE_PLUGIN_ROOT}/rules/` | At generation time — advisory |
| 7 | `commonMistakes.md` entry | Read by the agent via memory-bank |
| 8 | A line in a document nobody reads | Nothing |

**Aim as high up that ladder as the finding allows.** "Add it to the coding
standards" is rung 8 wearing a hat. If a finding genuinely cannot be mechanised,
say so explicitly rather than settling quietly.

Blameless is not a nicety — it is what makes the mechanism work. People describe
what actually happened only when describing it is safe. Name systems, never
individuals; "the deploy process allowed X" not "Ahmed deployed X".

---

## Steps

**Step 0 — Establish the timeline from evidence, not memory.**

```bash
git log --since=<date> --until=<date> --oneline
node ${CLAUDE_PLUGIN_ROOT}/tools/feature-map.mjs query --file <file involved>
node ${CLAUDE_PLUGIN_ROOT}/tools/delivery-metrics.mjs report --days 30
```

Build a timeline with timestamps: change merged → deployed → first impact →
first *detected* → first *diagnosed* → mitigated → resolved.

The two gaps that matter most are usually the ones nobody records:

- **impact → detected** — this is a monitoring failure, separate from the bug
- **detected → diagnosed** — this is an observability or runbook failure

Both are independently fixable and both recur. A postmortem that only fixes the
bug leaves them untouched.

**Step 1 — Establish impact in the terms the business uses.**

Users affected, transactions affected, money mis-posted or delayed, data
corrupted or lost, duration, regulatory reportability. Say "unknown" where it is
unknown — a confident wrong impact figure ends the investigation early.

**Step 2 — Find contributing causes. Plural, deliberately.**

There is no single root cause. An incident reaching production means several
defences were absent or ineffective, and each one is a separate fix:

| Layer | Question |
|---|---|
| The change | What was wrong with it? |
| Review | Why did review not catch it? Was the PR too large to review properly? |
| Automated checks | Which analyzer, test or guard *could* have caught it and did not exist? |
| Testing | Which test would have failed? Why was it not written? |
| Rollout | Was it a big-bang release? Would rings have contained it to 1%? |
| Detection | Why did monitoring not fire? Was there an SLI for this at all? |
| Diagnosis | Why did it take that long to understand? What was missing from the traces? |
| Mitigation | Why did recovery take that long? Was rollback tested? |

Ask "why was that possible?" at each layer until you reach something you can
change mechanically. Stop when you get there — not before, and not at "human
error", which is a description of an outcome, not a cause.

**Step 3 — For each cause, climb the ladder.**

Walk the escalation table and pick the highest rung that genuinely applies. Be
concrete about the artifact:

> **Cause:** the settlement job retried a non-idempotent posting operation.
> **Rung 3 — convention test:** `Retriable_Operations_Are_Idempotent` asserting
> every `[Retriable]`-attributed handler declares an idempotency key.
> **Rung 5 — hook tripwire:** flag retry configuration on a handler that writes
> to a money table without an idempotency key.
> **Not rung 1** — this is a shape, not a banned symbol.

Where the finding is a specific API that should never be used again, that is a
`BannedSymbols.txt` line, and it is the cheapest permanent fix available:

```
M:System.Threading.Tasks.Task.Wait;<incident ref> — deadlocked the settlement job under load
```

**Step 4 — Write the actions with owners, dates, and a verification.**

Every action needs: owner, date, and **how you will know it worked**. An action
item with no verification is a wish. Prefer actions that change the system over
actions that ask for more care.

Then schedule them properly:

```bash
/work-breakdown "postmortem actions for <incident>"
```

The task board makes them visible and sized; a bullet list at the end of a
document does not.

**Step 4b — Record the incident and the guard it bought.**

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/incidents.mjs open \
  --title "<what happened, in the business's words>" \
  --detected alert|monitoring|customer|reconciliation|manual \
  --guard "templates/dotnet/BannedSymbols.txt#<symbol>" \
  --guard "tests/Arch/<Rule>.cs#<Test_Name>" \
  --falsifies "NFR-3,AC-12" --postmortem "docs/postmortems/<file>.md" \
  --by "<name>"
```

This is the step that makes step 6's warning survivable. Step 6 says teams
delete useful defences during cleanups **because nobody recorded that they
helped** — and until now nobody did. `incidents.mjs check` re-reads every guard
named here and fails when one is gone, commented out, or sitting inside a test
somebody marked `Skip`. That last state is the worst of the three: the record
still says the guard is there.

Three things it does at the moment you open it:

- **Classifies the guard by rung**, from where it lives. If the strongest one is
  rung 7 or 8, it says so — that is the "rung 8 wearing a hat" case, and it is
  the moment to climb, not the moment to move on. If the finding genuinely
  cannot be mechanised, `--unmechanisable "<why>"` records that in words, which
  is a different thing from settling quietly.
- **Checks for recurrence.** If another incident already named this guard or
  falsified the same id, it names it. A guard that was supposed to prevent this
  and did not was either never built, removed, or does not cover this case —
  three different postmortems, and you have to find out which.
- **Records what production falsified.** `--falsifies NFR-3` means the document
  still asserts something reality settled. `incidents.mjs learned` puts that in
  front of the gate 1 and gate 5 reviewers, who cannot know it from the document.

**Step 5 — Write it back into the memory-bank.**

- `memory-bank/commonMistakes.md` — the pattern, in one paragraph, with a link
  to the postmortem. This is what the agent reads on future sessions.
- `memory-bank/decisionLog.md` — any design decision changed as a result
- `memory-bank/techDebt.md` — debt that contributed, now with an incident
  attached to it, which is the only thing that reliably gets debt prioritised

**Do not edit Tier 2 files directly** — the `PreToolUse` write guard blocks it,
correctly. Propose the exact text and let a human apply it.

**Step 6 — Ask the two questions that get skipped.**

1. **What went right?** Which control worked, which alert fired, what made
   recovery faster than it could have been? Teams delete useful defences during
   cleanups because nobody recorded that they helped.
2. **Where else does this pattern exist?** The same mistake is rarely in one
   place. Run `/impact-analysis` or `grep` on the pattern across the repo — a
   postmortem that fixes one instance of a class is half a postmortem.

---

## Example Invocation

**Command:** `/postmortem "duplicate settlement postings on 12 Jul"`

Agent builds the timeline from git and finds impact→detected was 9 hours: there
was no correctness SLI on settlement, only availability, so the system looked
perfectly healthy while posting duplicates. Five contributing causes, four
mechanised: a `BannedSymbols.txt` entry for the retry helper used without an
idempotency key; a `Retriable_Operations_Are_Idempotent` convention test; a
correctness SLI via `/operability-gen`; and a hook tripwire for retry config on
money-table writes. The fifth — "the release went out at 100% with no ring" —
becomes a `/release-safety` requirement for that service. Grep finds the same
retry pattern in two other jobs, neither of which has failed yet. What went
right: the reconciliation report caught it at all, and it had been proposed for
deletion the previous sprint.

---

## Output

- File: `docs/incidents/<date>-<slug>-postmortem.md`
- Proposed diffs for `memory-bank/commonMistakes.md`, `decisionLog.md`,
  `techDebt.md` (for a human to apply)
- Proposed additions to `templates/dotnet/BannedSymbols.txt`, `.editorconfig`,
  architecture tests, or `.claude/hooks/post-edit-verify.mjs`
- Console:

```
## Postmortem: <incident>

**Impact:** <users / transactions / money / duration>
**Detected by:** <alert | customer | reconciliation | by accident>
**Blameless:** systems named, not people

### Timeline
| Time | Event | Gap |
|---|---|---|
(merged, deployed, impact began, DETECTED, diagnosed, mitigated, resolved -
with the impact→detected and detected→diagnosed gaps called out)

### Contributing causes
| # | Layer | Cause | Why it was possible |

### Mechanised prevention
| # | Cause | Rung | Artifact | Where it goes |

### Could not be mechanised
| Cause | Why | Best available mitigation |

### Actions
| # | Action | Owner | Due | How we will know it worked |

### Same pattern elsewhere
| Location | Has it failed yet? |

### What went right
<controls that worked - so they do not get deleted in the next cleanup>
```

