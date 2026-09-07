# Gate 2 — Analysis

**Blocks:** phase 3 (Design).
**Mechanical check:** `node .cursor/tools/lifecycle.mjs check ANALYSIS`
**Judgement:** `/lifecycle-gate`.

Phase 1 said what the product must do. Phase 2 works out how the *business*
behaves — the entities, the rules, the flows. Getting this wrong produces a
system that runs correctly and models the wrong world, which no amount of test
coverage detects.

---

## Judgement criteria

**1. Every story traces to at least one use case.**
PASS: `artifact-schema.mjs check` reports no unlinked `S-*` and no dangling ids.
FAIL: use cases that no story asked for (scope creep entering through the back
door) or stories no use case covers (a hole that surfaces in phase 4).

> **Now computed, not judged.** `node .cursor/tools/artifact-schema.mjs check`
> decides this one from the ids in the documents, and `lifecycle.mjs check`
> fails on it — so it is part of the mechanical consent and cannot be argued
> with. Read the output; do not re-derive it by hand.


**2. The domain model has no orphan entities.**
PASS: every entity participates in a relationship and appears in at least one
use case.
FAIL: an entity that exists because it seemed natural. It will become a table,
then a repository, then a maintenance burden nothing reads.

**3. Aggregates and their boundaries are explicit.**
PASS: each aggregate names its root and what may only be changed through it.
FAIL: a flat entity list. Without boundaries, phase 3 invents transaction scope
by accident and phase 4 discovers it under concurrency.

**4. Invariants are written as rules, not prose.**
PASS: "a policy may not be issued while its premium is unpaid" — stated as a
checkable condition with an ID that a test can cite.
FAIL: "policies should generally be paid before issue".

**5. Money is `decimal`, and it is written down.**
PASS: every monetary attribute names its type and currency handling.
FAIL: leaving it to phase 4, where `07-audit-trail-guard` catches it late — or
does not, because a `double` compiles fine.

**6. Audit-required entities are marked.**
PASS: every entity whose mutation must record who/when/what-changed is flagged,
feeding `memory-bank/businessRules.md` and therefore rule 07.
FAIL: deciding this per-handler during implementation.

**7. Workflows include the unhappy paths.**
PASS: rejection, timeout, partial payment, cancellation, and what the system does
about each.
FAIL: only the path where everything works. The unhappy paths are where the
business rules actually live.

**8. Risks have an owner and a mitigation.**
PASS: each high risk names a person and a concrete mitigation, and the ones that
are design problems are marked for phase 3.
FAIL: a risk list nobody is accountable for.

**9. Bilingual terms are captured where the UI is bilingual.**
PASS: EN/AR pairs for domain nouns, ready for `memory-bank/glossary.md` and
rule 08.
FAIL: translating in the component during phase 4, inconsistently.

---

## Promotion (requires the user's word)

| From | Into |
|---|---|
| Invariants, audit-required entities, money handling | `memory-bank/businessRules.md` |
| EN/AR domain terms | `memory-bank/glossary.md` |

---

## Verdict

```
GATE 2 — ANALYSIS: GO | NO-GO
Mechanical:  <pass/fail>
Criteria:    <n>/9 pass
Untraced:    <stories with no use case, use cases with no story>
Blocking:    <criterion, file, what is wrong, what would fix it>
Record:      node .cursor/tools/lifecycle.mjs record-gate ANALYSIS --verdict GO|NO-GO \
                  --by "lifecycle-gate" --criteria "<n>/<total>"
Then:        node .cursor/tools/lifecycle.mjs approve ANALYSIS --by "<name>"
```
