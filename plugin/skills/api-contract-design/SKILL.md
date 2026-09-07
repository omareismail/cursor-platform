---
name: api-contract-design
description: "Runs the api-contract-design workflow. Invoked as /api-contract-design."
---

<!-- GENERATED from the cursor-platform source skill "api-contract-design".
     Do not edit here - edit the source and re-run the plugin build. -->

# Skill: api-contract-design

**Invocation:** `/api-contract-design`

---

## Overview

**Memory references:** `memory-bank/apiConventions.md, memory-bank/systemPatterns.md`

`api-contract-design` produces the endpoint catalogue — every route, its use
case, its auth, its request and response shapes and its error contract — and
decides the conventions once, before any endpoint exists. It is the preventive
counterpart to `/api-consistency-audit`, which exists because APIs written
endpoint-by-endpoint over months drift into three pagination styles and four
error shapes. Deciding pagination, errors, versioning and naming here costs an
hour; discovering them inconsistent after forty endpoints costs a breaking
change.

---

## Steps

**Step 1 — Read the inputs.**

`docs/analysis/use-cases.md`, `docs/design/architecture.md`,
`docs/product/nfr.md`. Every endpoint must trace to a use case.

**Step 2 — Settle the conventions first, once.**

Use `/speckit-options` where there is a real choice, and check
`memory-bank/apiConventions.md` for an existing precedent before inventing one.

| Convention | Decide |
|---|---|
| Resource naming | Plural nouns, casing, nesting depth limit |
| Versioning | URL segment, header, or none — and the deprecation policy |
| Pagination | Offset or cursor; parameter names; where the total goes |
| Filtering and sorting | Syntax, and which fields are sortable |
| Errors | RFC 7807 ProblemDetails; the extension members; the code vocabulary |
| Idempotency | Which verbs, which header, how long keys are retained |
| Dates and money | ISO 8601 with offset; money as string or scaled integer, never float |
| Correlation | The header, and that it flows to logs and downstream calls |

**Step 3 — Write the catalogue, one row per endpoint.**

```markdown
| ID | Method | Route | Use case | Auth | Idempotent | Notes |
|---|---|---|---|---|---|---|
| EP-07 | POST | /api/v1/policies | UC-04 | Underwriter | Yes (Idempotency-Key) | Issues a policy |
```

**Step 4 — Specify the shapes.**

Per endpoint: request body with types and validation rules, success response
with status code, and every error it can return with the condition that produces
it. Validation rules come from the domain invariants — cite the `INV-*` or `BR-*`
ID rather than restating the rule, so there is one source of truth.

**Step 5 — Cover the non-happy responses.**

401 vs 403 (unauthenticated vs unauthorised — endpoints that conflate them leak
information), 404 vs 403 for records the caller may not know exist, 409 for state
conflicts, 422 for semantic failures, 429 with its retry policy.

**Step 6 — Check coverage both ways.**

Every use case has an endpoint; every endpoint cites a use case. Report both —
Gate 3 criterion 2.

**Step 7 — Write `docs/design/api-design.md`, and prepare the promotion.**

The conventions from Step 2 go into `memory-bank/apiConventions.md` — show the
diff, get the user's word, apply with `CLAUDE_ALLOW_TIER2_EDIT=1`. Phase 4's
`/dotnet-endpoint-gen` reads that file, so this promotion is what makes the
conventions actually happen.

---

## Front-matter — required on every document this skill writes

Open each file with this block. It is the machine-readable half of a
human-written document: the prose stays prose, and `artifact-schema.mjs` reads
this to know what the document is and where it sits in the chain.

```yaml
---
type: api-design
phase: DESIGN
defines: [EP]
traces: [<repo-relative paths of the documents this was derived from>]
owner: solution-architect
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

- `docs/design/api-design.md`
- A proposed diff for `memory-bank/apiConventions.md`
- Terminal: use cases with no endpoint, endpoints with no use case, endpoints
  with an undefined error contract

