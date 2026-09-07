---
name: user-story-map
description: "Runs the user-story-map workflow. Invoked as /user-story-map."
---

<!-- GENERATED from the cursor-platform source skill "user-story-map".
     Do not edit here - edit the source and re-run the plugin build. -->

# Skill: user-story-map

**Invocation:** `/user-story-map`

---

## Overview

**Memory references:** `memory-bank/businessRules.md`

`user-story-map` turns the PRD into a story map — user journeys across the top,
the stories that make each step work beneath them — where every story carries
Given/When/Then acceptance criteria concrete enough to generate a test from. It
is the hinge of the whole lifecycle: phase 2 traces use cases back to these
stories, phase 4 slices work from them, and phase 5's `ac-trace` proves every
one of these criteria has a test that asserts it. An acceptance criterion written
vaguely here becomes an untestable requirement in phase 5, by which point the
cost of fixing it is the cost of rewriting the feature.

---

## Steps

**Step 1 — Read the inputs.**

`docs/product/prd.md`, `personas.md`, `scope.md`. Stop if any is missing.

**Step 2 — Lay out the journeys first, stories second.**

The top row is what a persona does end to end, in order — *quote, apply,
underwrite, pay, issue, service, renew*. Stories hang beneath the step they
serve. A story that fits under no step is either a missing step or not needed.

**Step 3 — Write acceptance criteria that could fail.**

Every criterion is Given/When/Then with concrete values: an amount, a state, a
role, a date. The test is simple — could a tester deliberately break this? If
not, rewrite it.

```
BAD   Then the premium is calculated correctly
GOOD  Given a 2019 Toyota Corolla with comprehensive cover and no claims
      When the broker requests a quote
      Then the premium is 2,340.00 SAR and the no-claims discount line
      shows 15%
```

Number them `AC-1`, `AC-2` within each story. Phase 4's test generators emit
`// AC-N:` comments and `ac-trace.mjs` matches on exactly these IDs — the
numbering is a contract, not decoration.

**Step 4 — Mark the unhappy paths.**

For each story, at least one criterion for what happens when it fails: declined,
timed out, partially paid, cancelled mid-flow. The unhappy paths are where the
business rules actually live, and phase 2 will need them.

**Step 5 — Slice the MVP horizontally.**

Draw a line across the map. Everything above it is release 1. A horizontal slice
crosses every journey step thinly — a customer can complete the whole journey,
badly. A vertical slice builds one step perfectly and ships nothing usable.

**Step 6 — Write `docs/product/story-map.md`.**

```markdown
# Story map — <name>

## Journey: <persona> — <outcome>

| Step 1 | Step 2 | Step 3 |
|---|---|---|
| <story IDs> | <story IDs> | <story IDs> |

--- MVP LINE ---

## Stories

### S-01 — <title>
**As a** <persona> **I want** <capability> **so that** <outcome>
**Step:** <journey step>   **Requirement:** <FR ID>   **Release:** MVP
**Flags:** money / PII / auth

- **AC-1** Given ... When ... Then ...
- **AC-2** Given ... When ... Then ...
- **AC-3** (unhappy) Given ... When ... Then ...
```

**Step 7 — Check coverage both ways.**

Every functional requirement has at least one story; every story cites a
requirement. Report both mismatches — they are Gate 1 blockers.

---

## Next

`/lifecycle-gate REQUIREMENTS`. Optionally `/speckit-taskstoissues` to push the
MVP stories into Linear or GitHub.

---

## Front-matter — required on every document this skill writes

Open each file with this block. It is the machine-readable half of a
human-written document: the prose stays prose, and `artifact-schema.mjs` reads
this to know what the document is and where it sits in the chain.

```yaml
---
type: story-map
phase: REQUIREMENTS
defines: [S, AC]
traces: [<repo-relative paths of the documents this was derived from>]
owner: product-manager
---
```

`defines` names the ID prefixes this document **owns**. It is what stops the
first cell of a traceability table being mistaken for a second definition — a
citation of `S-1` in a use-case table is a reference, not a redeclaration.

Validate before reporting done:

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/artifact-schema.mjs validate
node ${CLAUDE_PLUGIN_ROOT}/tools/artifact-schema.mjs check
```

`check` fails on an ID cited but never defined, and on a chain that stops — a
requirement no story implements, a story no use case covers, a use case no
endpoint serves. Those are gate criteria, computed rather than judged, and
`lifecycle.mjs check` now fails on them too.

---

## Output

- `docs/product/story-map.md`
- Terminal: requirements with no story, stories with no requirement, stories
  whose criteria are not testable

