# Gate 3 — Design

**Blocks:** phase 4 (Development) — **mechanically**, not by convention.
**Mechanical check:** `node .cursor/tools/lifecycle.mjs check DESIGN`
**Judgement:** `/lifecycle-gate`.

This is the only gate with a hook behind it. Until the DESIGN phase derives to
`APPROVED` or `INHERITED`, `guard-phase.mjs` returns exit code 2 on every write
under `src/`, `backend/` and `frontend/` — and it goes back to blocking the
moment an approved design document changes.

It is the hard one because it is the last point where a wrong decision is still
cheap. After this gate the same decision is a migration, a deprecation and a
rewrite.

---

## Judgement criteria

**1. The architecture was chosen, not assumed.**
PASS: at least two named variants with a trade-off matrix, and a recorded reason
for the winner — the protocol in `05-planning-rigor.mdc`.
FAIL: one architecture presented as the only one. If no alternative was
considered, no decision was made.

**2. Every use case maps to a concrete endpoint.**
PASS: `artifact-schema.mjs check` reports no unlinked `UC-*`, and the endpoint
catalogue gives each row a method, route, auth, request and response shape.

> **Now computed, not judged.** `node .cursor/tools/artifact-schema.mjs check`
> decides this one from the ids in the documents, and `lifecycle.mjs check`
> fails on it — so it is part of the mechanical consent and cannot be argued
> with. Read the output; do not re-derive it by hand.

FAIL: an endpoint nothing asked for, or a use case no endpoint serves.

**3. The API contract is internally consistent.**
PASS: one pagination convention, one error shape (ProblemDetails), one
versioning scheme, one naming convention — decided here, once.
FAIL: leaving it to whoever writes each endpoint. `/api-consistency-audit`
exists because that is what happens.

**4. Every entity has a physical home.**
PASS: schema covering all entities, with keys, indexes, nullability and
precision for money; provider roles assigned where there is more than one
database (OLTP vs read-only secondary).
FAIL: a logical model with no physical design. EF Core will invent one.

**5. `/threat-model` has been run.**
PASS: STRIDE output exists and its findings are answered in
`security-design.md`. Mandatory when the product touches money, PII or auth —
which, in this domain, it does.
FAIL: deferring security to a phase 5 audit, where every finding is a rewrite.

**6. Authn/authz is designed, not named.**
PASS: token type, lifetime, refresh, storage (never `localStorage`), role and
permission model, and which endpoints enforce what.
FAIL: "we'll use JWT".

**7. Every screen names its endpoints.**
PASS: `ux/screen-inventory.md` lists each screen, the endpoints it calls, its
states (loading, empty, error, partial) and its RTL/bilingual treatment.
FAIL: a Figma link with no contract. Design that codegen cannot consume is
decoration.

**8. Non-functional requirements are answered by the design.**
PASS: each NFR from phase 1 is traced to the design element that delivers it —
the cache, the index, the read replica, the queue. Every caching decision names
its invalidation.
FAIL: NFRs restated in the design document without a mechanism.

**9. Deployment shape is decided.**
PASS: runtime target, scaling model, configuration and secret management,
migration strategy for a live database.
FAIL: leaving it to phase 6, when the architecture no longer permits the answer.

**10. Decisions are recorded as ADRs.**
PASS: every consequential fork is an ADR in `docs/design/adr/` with context,
options, decision and consequences. `/speckit-adr` generates these.
FAIL: decisions that live only in a chat log.

---

## Promotion (requires the user's word — this one matters most)

| From | Into |
|---|---|
| Layering, boundaries, folder structure | `memory-bank/architecture.md` |
| Frameworks and exact versions | `memory-bank/technologyStack.md` |
| Provider roles, dialect rules | `memory-bank/databaseConventions.md` |
| Token handling, data classification | `memory-bank/securityStandards.md` |
| API conventions decided in criterion 3 | `memory-bank/apiConventions.md` |

This promotion is what makes the design binding. Once the layering is in
`architecture.md`, rule 02 enforces it on every `.cs` file for the rest of the
project's life. Skip it and the design is a document; do it and the design is a
compiler error.

---

## Verdict

```
GATE 3 — DESIGN: GO | NO-GO
Mechanical:  <pass/fail>
Criteria:    <n>/10 pass
Threat model: <run / NOT RUN — automatic NO-GO if not run>
Unmapped:    <use cases with no endpoint, entities with no table, screens with no endpoints>
Promotion:   <which memory-bank files this will change>
Blocking:    <criterion, file, what is wrong, what would fix it>
Record:      node .cursor/tools/lifecycle.mjs record-gate DESIGN --verdict GO|NO-GO \
                  --by "lifecycle-gate" --criteria "<n>/<total>"
Then:        node .cursor/tools/lifecycle.mjs approve DESIGN --by "<name>"
             ^ this unblocks guard-phase.mjs. Say so explicitly when reporting GO.
```
