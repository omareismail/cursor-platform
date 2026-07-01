# Skill: speckit-retro

**Invocation:** `/speckit-retro [feature-slug]`

---

## Overview

`speckit-retro` closes the loop after a feature ships by comparing plan estimates
to actuals, capturing lessons learned, and proposing specific additions to
`memory-bank/systemPatterns.md` so future planning cycles start with more
accurate data. It is the "learning" step of the pipeline — skipping it means
the team repeats the same friction on the next feature. It does not auto-modify
`systemPatterns.md`; instead it presents a concrete diff for human approval so
the pattern library evolves intentionally, not accidentally.

---

## Steps

**Step 1 — Read the feature record.**

- `specs/features/[feature-slug].md` — spec and acceptance criteria
- `specs/plans/[feature-slug]-plan.md` — estimated task sizes and selected variant
- `memory-bank/progress.md` — actual task status and any blockers encountered
- `git log --oneline feature/[feature-slug]` (or merged branch) — actual commit history
- `speckit-checklist` output (if recorded) — any quality gate failures

**Step 2 — Calculate estimate vs. actual.**

Compare planned task sizes against actual time (inferred from commit timestamps
in git log or from timestamps in progress.md if recorded).

Output a comparison table:
```markdown
| Task ID | Description | Estimated | Actual | Delta | Notes |
|---------|-------------|-----------|--------|-------|-------|
| TASK-001 | Domain entity | S (~1.5h) | ~45m | -45m | Simpler than expected |
| TASK-006 | Repo impl | M (~3h) | ~5h | +2h | EF Core fluent config more complex |
```

**Step 3 — Ask the retrospective questions.**

Present 3-5 questions (one at a time, waiting for answers):

```
Retro Q1: Was anything harder or more time-consuming than estimated?
(What specifically caused the overrun? Wrong sizing? Unexpected dependency?
Missing context in the spec?)

Retro Q2: Was anything easier than expected?
(Could a similar task be sized down in future plans?)

Retro Q3: Is there a pattern, utility, or template that emerged during this
feature that would save time on the next similar feature?

Retro Q4: Did the spec adequately describe the feature, or were there
ambiguities discovered during implementation?

Retro Q5: Were there any quality gate failures (checklist failures, test
failures, architecture violations) that could have been caught earlier?
```

**Step 4 — Propose systemPatterns.md updates.**

Based on retro answers, identify any new patterns worth standardizing.
Present as a diff — never auto-apply.

**Step 5 — Archive the feature working files.**

Output archive commands (do not run automatically):
```bash
# Archive working files (run manually after retro)
mkdir -p specs/archive/[feature-slug]
mv specs/clarifications/[feature-slug].md specs/archive/[feature-slug]/
mv specs/constitutions/[feature-slug]-constitution.md specs/archive/[feature-slug]/
mv specs/plans/[feature-slug]-plan.md specs/archive/[feature-slug]/
# Keep specs/features/[feature-slug].md in place — it is the permanent record
```

---

## Example Invocation

**Scenario:** `broker-client-csv-export` has been merged to main and deployed.

Agent reads plan (17 tasks, Plan B, 30pts estimated), reads progress.md timestamps,
calculates actuals (~35pts = ~4.5 days actual vs 3.75 estimated). Presents 5 retro
questions. User answers that the CsvHelper streaming setup took longer than expected
(2 extra hours) and suggests adding a "StreamingCsvWriter" helper to systemPatterns.md.
Agent proposes a diff to systemPatterns.md adding the pattern. Saves the retro file.

---

## Output

- File: `specs/retros/[feature-slug]-retro.md`
- Terminal: estimate vs. actual comparison table
- Terminal: proposed `systemPatterns.md` diff (awaits human approval)
- Terminal: archive commands (run manually)
