# Skill: product-brief

**Invocation:** `/product-brief [the idea, in one sentence]`

---

## Overview

**Memory references:** `memory-bank/projectbrief.md, memory-bank/productContext.md`

`product-brief` turns one sentence of intent into a bounded problem statement —
who is underserved, how, what success would look like, and what is deliberately
not being built. It is the first skill of the lifecycle and the only one that
may be run on an empty repository. Its entire job is to refuse to let the
project proceed on an idea that has not been interrogated: every downstream
phase inherits this document's assumptions, and an assumption nobody stated is
one nobody can challenge.

---

## Steps

**Step 1 — Check the phase.**

```bash
node .cursor/tools/lifecycle.mjs status
```

If there is no state, offer `/lifecycle start`. If the phase is past
`REQUIREMENTS`, say so and ask whether the user means to reopen it — that is a
`rollback`, not a silent overwrite.

**Step 2 — Elicit, before writing anything.**

`05-planning-rigor.mdc` is binding here and this is a product-level decision, so
ask at least 10 questions. Every one as 2-4 labeled options with a recommendation
— never an open blank. Cover at minimum:

1. Who is the primary user, and who is explicitly *not* a user?
2. What do they do today instead? (If the answer is "nothing", the problem may
   not be real.)
3. What makes today's way bad enough to pay to replace?
4. What does success look like in a number, at a date?
5. Who else must be satisfied — regulator, finance, operations, an auditor?
6. What is fixed and non-negotiable — an existing system, a contract, a deadline?
7. Which regulatory regimes apply — SAMA, ZATCA, mada, PCI-DSS, none?
8. Where must the data live?
9. Bilingual EN/AR, and is RTL a first-class requirement or a later nicety?
10. What would make you abandon this after three months?

Question 10 is the one people skip and the one that most often reveals the real
constraint.

**Step 3 — Name the anti-scope.**

Before any feature is listed, write down what this product will not do. A scope
with no boundary is a wish, and it will be relitigated in phase 4 at ten times
the cost.

**Step 4 — Write `docs/product/brief.md`.**

```markdown
# Product brief — <name>

## The problem
<Who is underserved, how, and how they cope today. In their words.>

## Who this is for
| Actor | What they need | Not a user |
|---|---|---|

## Why now
<What changed that makes this worth building today.>

## Success
| Measure | Today | Target | By |
|---|---|---|---|

## Constraints
| Constraint | Source | Consequence if ignored |
|---|---|---|

## Regulatory surface
<SAMA / ZATCA / mada / PCI-DSS / none — and where data must reside.
"Not yet decided" is not an answer; it is a risk with an owner.>

## Explicitly not building
| Not doing | Why | Revisit when |
|---|---|---|

## Open questions
| # | Question | Blocks | Owner |
|---|---|---|---|
```

**Step 5 — Report the open questions as blockers.**

Any question in that last table blocks Gate 1. List them and say who must answer.

---

## Next

`/persona-gen`, then `/product-requirements`, then `/user-story-map`.

---

## Front-matter — required on every document this skill writes

Open each file with this block. It is the machine-readable half of a
human-written document: the prose stays prose, and `artifact-schema.mjs` reads
this to know what the document is and where it sits in the chain.

```yaml
---
type: product-brief
phase: REQUIREMENTS
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

- `docs/product/brief.md`
- Terminal: the open-question list, and the next skill
