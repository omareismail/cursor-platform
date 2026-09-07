# Gate 1 — Requirements

**Blocks:** phase 2 (Analysis).
**Mechanical check:** `node .cursor/tools/lifecycle.mjs check REQUIREMENTS`
**Judgement:** `/lifecycle-gate` reads the criteria below and returns GO or NO-GO.
**Authored by:** `product-manager`, `ux-bridge`
**Reviewed by:** `business-analyst` — never an author of the artifacts above.

The mechanical check proves the documents exist. This file decides whether they
are worth anything. Both must pass, then a human approves — three independent
consents, because this is the cheapest point in the project to be wrong and the
most expensive one to be wrong *silently*.

---

## Who reviews this, and why

`business-analyst` judges this gate. Not because it is senior, but because of what it
loses if this gate passes on bad work:

Phase 2 has to build a domain model out of these documents. An ambiguity that
survives this gate becomes the analyst's problem in a fortnight — so let the
analyst find it now, while it still costs one sentence to fix.

Launch it as a **fresh subagent**. It has to reach these criteria through the
documents, not through the conversation that produced them — an author
re-reading their own work still has all of the author's reasons in context,
and never finds the thing they did not think of the first time.

`record-gate` refuses a verdict filed under any other role, and `approve`
refuses a signature from the same party that filed the verdict.

---

## Judgement criteria

**1. The problem is stated before the solution.**
PASS: `prd.md` opens with who is underserved and how, in the user's language.
FAIL: it opens with a feature list. A feature list is an answer to a question
nobody wrote down.

**2. Actors are named and bounded.**
PASS: every actor has a real name from the domain (broker, underwriter,
policyholder, ZATCA), and the list says who is explicitly *not* a user.
FAIL: "users" and "admins".

**3. Every requirement reaches a story.**
PASS: `artifact-schema.mjs check` reports no unlinked `FR-*`.
FAIL: a requirement no story implements is a promise nobody scheduled.

> **Now computed, not judged.** `node .cursor/tools/artifact-schema.mjs check`
> decides this one from the ids in the documents, and `lifecycle.mjs check`
> fails on it — so it is part of the mechanical consent and cannot be argued
> with. Read the output; do not re-derive it by hand.

**4. Every story has testable acceptance criteria.**
PASS: Given/When/Then, with concrete values — an amount, a state, a role.
FAIL: "the system should be fast", "the user can manage policies". If a tester
could not fail it, `/e2e-test-gen` cannot generate from it either, and Gate 5's
AC-to-test trace will have nothing to trace.

**5. MVP scope has an explicit out-of-scope list.**
PASS: `scope.md` names things a reasonable person would expect and says why they
are excluded for now.
FAIL: only an in-scope list. Scope without a boundary is not scope; it is a wish,
and it will be relitigated in phase 4 at ten times the cost.

**6. Non-functional requirements are quantified — and not already disproved.**
PASS: numbers with units and a measurement point — P99 latency at the API edge,
availability over a stated window, retention in days, concurrent users at peak.
And `node .cursor/tools/incidents.mjs learned` names no id this document still
asserts.
FAIL: "highly available", "scalable", "secure". Or a target production has
already contradicted: `nfr.md` says P99 under 400 ms, an incident recorded 1200
for six hours, and the document was never updated. That NFR is not at risk — it
is wrong, and nothing in the document itself can tell you so.

**7. Regulatory surface is decided, not deferred.**
PASS: `nfr.md` states whether SAMA, ZATCA, mada or PCI-DSS apply, and where data
must reside. If none apply, it says so and why.
FAIL: silence. In this domain silence means nobody asked, and the answer arrives
during phase 6.

**8. Money and identity are flagged at the requirement level.**
PASS: any story touching money, PII or auth is marked, so phase 2 knows what
needs `decimal`, an audit trail and a threat model.
FAIL: discovering it during implementation, when `07-audit-trail-guard` fires on
a handler that was never designed to be auditable.

---

## Promotion (requires the user's word — Tier 2 is human-authored)

| From | Into |
|---|---|
| Product name, users, elevator pitch | `memory-bank/projectbrief.md` |
| Problem, market, success measures | `memory-bank/productContext.md` |
| Business rules discovered while writing stories | `memory-bank/businessRules.md` |

Show the diff, get agreement, then apply with `CLAUDE_ALLOW_TIER2_EDIT=1`.

---

## Verdict

```
GATE 1 — REQUIREMENTS: GO | NO-GO
Mechanical:  <pass/fail, from lifecycle.mjs check>
Criteria:    <n>/8 pass
Blocking:    <criterion, file:line, what is wrong, what would fix it>
Record:      node .cursor/tools/lifecycle.mjs record-gate REQUIREMENTS --verdict GO|NO-GO \
                  --by "business-analyst" --criteria "<n>/<total>"
Then:        node .cursor/tools/lifecycle.mjs approve REQUIREMENTS --by "<a human, not business-analyst>"
```

A NO-GO names the fix, not just the fault. Never soften one.
