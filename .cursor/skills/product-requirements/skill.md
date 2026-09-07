# Skill: product-requirements

**Invocation:** `/product-requirements`

---

## Overview

**Memory references:** `memory-bank/businessRules.md, memory-bank/securityStandards.md`

`product-requirements` produces the PRD — the functional and non-functional
requirements, the MVP boundary, and the regulatory surface — from the brief and
the personas. It is the document every later phase validates against, so it
holds two rules absolutely: every non-functional requirement carries a number
with a unit and a measurement point, and every scope decision states what is
excluded as well as what is included. "Highly available" and an open-ended
feature list are the two failures that survive all the way to phase 6, where
they become an outage and an argument respectively.

---

## Steps

**Step 1 — Read the inputs.**

`docs/product/brief.md`, `docs/product/personas.md`. Stop if either is missing.

**Step 2 — Derive functional requirements from persona jobs.**

Each requirement traces to a persona and a job. A requirement no persona needs
is scope creep with a justification attached; say so rather than writing it down.

**Step 3 — Quantify every non-functional requirement.**

Never accept an adjective. For each, elicit the number using `/speckit-options`
if the user does not have one — offering "P99 < 500ms / < 2s / < 5s at the API
edge" with the cost of each gets an answer where "how fast?" gets a shrug.

| Category | Must state |
|---|---|
| Performance | P50/P99, at which boundary, under what concurrency |
| Availability | Target, over what window, excluding what |
| Capacity | Peak concurrent users, records at year 3, growth rate |
| Durability | RPO and RTO, in minutes |
| Retention | Per data class, in days, and what happens at expiry |
| Residency | Which jurisdiction, which regulation requires it |
| Security | Authn method, session lifetime, PII classes held |
| Accessibility | Standard and level; RTL and bilingual as a requirement, not a nicety |
| Observability | What must be answerable in production, and how fast |

**Step 4 — Mark money, PII and auth at the requirement level.**

Every requirement touching them gets a flag. Phase 2 turns those flags into
`decimal` types and audit-required entities; phase 3 turns them into a mandatory
`/threat-model`. Discovering them in phase 4 means `07-audit-trail-guard` firing
on a handler never designed to be auditable.

**Step 5 — Draw the MVP boundary.**

Write `docs/product/scope.md` with three lists: MVP, next, and not doing. The
third is the one that matters. For each exclusion give a reason and a revisit
trigger.

**Step 6 — Write the files.**

`docs/product/prd.md`:

```markdown
# Product requirements — <name>

## Summary
## Actors
## Functional requirements
| ID | Requirement | Persona | Job | Priority | Money/PII/Auth |
|---|---|---|---|---|---|

## Non-functional requirements
(see nfr.md)

## Business rules discovered
| ID | Rule | Source | Audit required |
|---|---|---|---|

## Assumptions
| # | Assumption | If wrong |
|---|---|---|

## Out of scope
(see scope.md)
```

`docs/product/nfr.md` — the quantified table from Step 3, one row per NFR, each
with an ID that phase 3 will trace against and phase 5 will load-test against.

`docs/product/scope.md` — the three lists from Step 5.

**Step 7 — Report unquantified NFRs as Gate 1 blockers.**

---

## Next

`/user-story-map`, then `/lifecycle-gate`.

---

## Front-matter — required on every document this skill writes

Open each file with this block. It is the machine-readable half of a
human-written document: the prose stays prose, and `artifact-schema.mjs` reads
this to know what the document is and where it sits in the chain.

```yaml
---
type: product-requirements
phase: REQUIREMENTS
defines: [FR]
traces: [<repo-relative paths of the documents this was derived from>]
owner: product-manager
---
```

`defines` names the ID prefixes this document **owns**. It is what stops the
first cell of a traceability table being mistaken for a second definition — a
citation of `S-1` in a use-case table is a reference, not a redeclaration.

Validate before reporting done:

```bash
node .cursor/tools/artifact-schema.mjs validate
node .cursor/tools/artifact-schema.mjs check
```

`check` fails on an ID cited but never defined, and on a chain that stops — a
requirement no story implements, a story no use case covers, a use case no
endpoint serves. Those are gate criteria, computed rather than judged, and
`lifecycle.mjs check` now fails on them too.

---

## Output

- `docs/product/prd.md`, `docs/product/nfr.md`, `docs/product/scope.md`
- Terminal: unquantified NFRs, unflagged money/PII/auth requirements
