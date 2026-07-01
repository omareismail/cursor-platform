# Skill: platform-health-validator

**Invocation:** `/platform-health-validator`

No scope argument — this always checks the whole workspace, not a subset.

---

## Overview

**Memory references:** `.cursor/docs/skill-graph.md`,
`.cursor/docs/shared-execution-pipeline.md`, all `.cursor/skills/*/skill.md`,
all `.cursor/rules/*.mdc`, all `.cursor/docs/*.md`, `memory-bank/README.md`

This skill is the workspace-hygiene counterpart to `skill-maturity-audit`.
The distinction is precise and intentional:

- **`skill-maturity-audit`** asks: *does each skill file meet the
  shared-infrastructure contract?* (Does it call `repo-discovery`? Does it
  call `pattern-finder`? Does it state its convention sources?) — individual
  skill quality.
- **`platform-health-validator`** asks: *is the workspace as a whole
  consistent, non-redundant, and free of structural rot?* — cross-skill
  and cross-file integrity. A workspace where every individual skill file
  passes `skill-maturity-audit` can still have conflicting rules, an
  orphaned template nobody references, or a `skill-graph.md` that's drifted
  from reality.

Run this after any multi-file workspace enhancement pass (i.e. exactly
the situation this workspace is in after Phases 1-6) before declaring it
done, because enhancement passes are exactly when structural drift is most
likely to have been introduced.

---

## Steps

**Step 1 — Duplicate skill detection.**

Check for two distinct failure modes, not just one:

- *Exact-name* duplicates: two `skill.md` files under the same directory
  name (shouldn't be possible in a filesystem, but flag if somehow found).
- *Functional* duplicates: two skills whose `## Overview` section describes
  the same primary responsibility using different names. The test:
  "if a developer were searching for X, would both skill A and skill B
  appear equally valid?" — if yes, flag as a functional duplicate candidate
  for human review, not for automatic merger. Document the finding with both
  file paths and the specific overlap sentence; don't silently pick one.

**Step 2 — Naming and format consistency.**

- All skill directories: kebab-case (`[a-z0-9]+(-[a-z0-9]+)*`). Flag any
  that aren't.
- All rule files: numeric-prefix kebab-case (`NN-name.mdc`). Flag any that
  don't match.
- Rule frontmatter: every `.mdc` file must have `description` and
  `alwaysApply` fields. Flag any missing either.
- Skill header structure: every `skill.md` should have at minimum
  `## Overview`, `## Steps`, `## Output`. Flag any missing these three
  sections — not as a blocker, but as a Needs Work finding, since missing
  `## Output` is the most common source of unclear skill contracts.
- Markdown formatting: heading levels consistent (no `## Heading` followed
  by `#### Subheading` skipping `###`), no orphaned bold-only pseudo-headers
  (`**Something:**` used as a section break where `###` was intended).

**Step 3 — `skill-graph.md` drift check.**

For every claim in `skill-graph.md` (e.g. "pattern-finder is called by 12
generator skills"), verify it against the actual file content:
- Scan each claimed skill file for a line matching the claimed call
  (`pattern-finder`, `repo-discovery`, `context-builder`, etc.)
- Report claim vs. reality side by side — a doc that's wrong about its own
  system is actively harmful because developers trust it to make decisions

**Step 4 — Orphaned documentation check.**

For every `.md` file under `.cursor/docs/` and every template/checklist
file under `.cursor/`:
- Is it referenced (by filename) from at least one skill file, rule file,
  or other doc? If not, it's a candidate orphan.
- Distinguish genuine orphans (no references anywhere) from root-entry-point
  docs (like a README that refers to others rather than being referred to).
- Flag genuine orphans for human decision: archive, link, or delete.

**Step 5 — Conflicting rule check.**

Compare every pair of `alwaysApply: true` rules for logical conflicts:
- Does rule A require X in a case where rule B forbids X for the same file
  type? (e.g. a hypothetical future rule requiring `throw` on error vs.
  `04-security-guard.mdc` blocking certain exception patterns in the same
  `.cs` glob)
- Are any two rules' `globs` patterns identical *and* their described
  behavior contradictory? This is the structural signal for a conflict even
  before reading the rule bodies.
- Flag conflicts; don't resolve them — rule conflicts need human judgment
  about which rule takes precedence, not automatic resolution.

**Step 6 — Circular skill dependency check.**

From `skill-graph.md`'s declared dependency relationships, build the
directed graph and check for cycles — a cycle means two skills depend on
each other, which at best causes confusion about invocation order and at
worst causes infinite invocation loops. Flag any cycle with the full path
(A → B → A, or A → B → C → A).

**Step 7 — Dead template/checklist detection.**

Any template or checklist file not referenced by at least one active skill
is either dead weight or a missing reference in a skill that should use it.
Flag with the same "orphan or missing link?" framing as Step 4.

**Step 8 — Produce the Workspace Health Score.**

Score each dimension 0–100 based on this pass's findings, not aspirational
targets:

| Dimension | Scoring guide |
|---|---|
| Naming consistency | Start at 100, deduct 5 per non-conforming skill/rule name |
| Format consistency | Start at 100, deduct 3 per missing required section, 2 per formatting issue |
| Skill graph accuracy | Start at 100, deduct 10 per false claim in skill-graph.md |
| Documentation health | Start at 100, deduct 8 per genuine orphan, 5 per dead template |
| Rule integrity | Start at 100, deduct 15 per confirmed conflict, 5 per missing frontmatter field |
| Circular dependencies | 100 if none; 0 if any cycle exists (a cycle is a hard structural problem, not a minor deduction) |
| Functional duplicates | Start at 100, deduct 10 per confirmed functional duplicate |

**Overall Workspace Health Score** = weighted average:
Naming (15%) + Format (15%) + Skill graph accuracy (25%) + Documentation (15%) +
Rule integrity (15%) + Circular deps (10%) + Functional duplicates (5%)

Skill graph accuracy gets the highest weight because an inaccurate
dependency graph is the most operationally harmful finding — developers
make architectural decisions based on it.

**Step 9 — Report structure.**

```
# Platform Health Report — [date]

## Score: [N]/100

## Critical (fix before next enhancement pass)
[Circular dependencies, confirmed rule conflicts]

## Needs Work
[Orphaned docs, skill-graph drift, missing required sections]

## Informational
[Minor formatting issues, naming nits]

## Dimension Scores
[Table of dimension scores with finding counts]
```

---

## Relationship to `skill-maturity-audit`

Run **`skill-maturity-audit`** first when you want to know: *"is each skill
correctly wired into the shared infrastructure?"*

Run **`platform-health-validator`** when you want to know: *"is the
workspace itself structurally sound as a whole?"*

Both are needed. Running only one gives an incomplete picture — a workspace
where all skills are individually well-formed can still have a misleading
`skill-graph.md` and three orphaned docs nobody's deleted.

---

## Example Invocation

**Command:** `/platform-health-validator`

**Context:** Post-Phase-6 pass, before marking the workspace done.

Actual findings from the pre-build health check run during Phase 6:
- All 66 skills: correctly kebab-cased ✓
- All 11 rules: consistent `description`/`alwaysApply` frontmatter ✓
- Skill headers: `Overview / Steps / Example Invocation / Output` consistent ✓
- `MIGRATION_NOTES_PASS1.md` in `.cursor/docs/`: orphaned (0 inbound
  references) — flagged for linking from `skill-graph.md`'s changelog
  section or removal
- No circular dependencies found in `skill-graph.md`'s declared graph
- No functional duplicates found
- **Score: 94/100** (documentation health deduction for the single orphaned doc)

---

## Output

- Platform Health Report with per-dimension scores and an overall score
- Findings table with severity (Critical / Needs Work / Informational)
- No auto-applied fixes — structural workspace changes go through the same
  review process as any other consequential change
