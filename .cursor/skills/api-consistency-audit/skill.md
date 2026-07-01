# Skill: api-consistency-audit

**Invocation:** `/api-consistency-audit [scope]`
Example: `/api-consistency-audit Tamkeen.Payments` · `/api-consistency-audit full`

---

## Overview

**Memory references:** `memory-bank/apiConventions.md`,
`.cursor/cache/repo-map.json` (from `repo-discovery`)

This is a genuine gap, not an overlap — `02-dotnet-architecture-guard.mdc`
checks layering, `04-security-guard.mdc` checks auth/injection,
`dotnet-endpoint-gen` generates new endpoints matching convention via
`pattern-finder`, but nothing currently audits the **existing, already-shipped
API surface** for consistency across endpoints written at different times by
different people. A repo with 40+ endpoints accumulates drift even with a
disciplined generator skill in place — endpoints written before a convention
was tightened, or written by hand outside the skill entirely.

**MCP tools:** if a `github`/OpenAPI-aware MCP server is connected, pull the
live Swagger/OpenAPI document directly rather than parsing controller
attributes by hand.

---

## Steps

**Step 1 — Inventory every endpoint in scope.**

From `repo-map.json` plus a direct scan of controllers/minimal API
registrations, build the endpoint list: method, route, auth policy,
request/response DTOs, declared status codes.

**Step 2 — Status code consistency.**

- Success codes match the operation type (`201 Created` with a `Location`
  header for POST-creates, not a blanket `200`; `204 No Content` for
  deletes that return nothing, not `200` with an empty body)
- Error responses consistently shaped — flag any endpoint returning a raw
  exception message or a bespoke error shape instead of the repo's
  established Problem Details (RFC 7807) format, if that's the convention
  `apiConventions.md` documents
- 404 vs 400 vs 422 used consistently for "not found" vs "malformed
  request" vs "valid request, semantically invalid" across modules — flag
  endpoints in different modules handling the same conceptual error
  differently

**Step 3 — Route and naming consistency.**

- Plural vs. singular resource naming consistent across modules
  (`/api/v1/brokers` vs. a stray `/api/v1/broker/{id}`)
- Path parameter naming consistent (`{id}` vs `{brokerId}` for the same
  conceptual resource in different routes)
- Versioning applied consistently — every endpoint under the same
  versioning scheme (`/api/v1/...` prefix, header-based, or query-param
  based — whichever `apiConventions.md` establishes), flag any endpoint
  that skipped versioning entirely
- Action verbs not leaking into REST routes (`/api/v1/payments/cancel`
  instead of `POST /api/v1/payments/{id}/cancellation` or an equivalent
  resource-oriented form, per whatever this repo's convention actually is —
  this check only fires if `apiConventions.md` establishes resource-oriented
  routing as the standard; if the team has deliberately chosen action-based
  routes for command-style operations, that's a valid documented choice,
  not a violation)

**Step 4 — Pagination, filtering, sorting consistency.**

- Every list endpoint exposes pagination the same way (`page`/`pageSize` vs
  cursor-based — pick whichever this repo uses, flag the other)
- Filter/sort query parameter naming consistent across modules
- Pagination metadata in the response shaped consistently (total count,
  page info location — header vs. response body wrapper)

**Step 5 — Auth/authz consistency.**

- Every endpoint has an explicit policy, no bare `[Authorize]` with no
  policy on anything beyond clearly public endpoints (also checked by
  `04-security-guard.mdc` — this step cross-references rather than
  re-flagging independently, citing that skill's findings if already run)
- Endpoints operating on the same resource type use the same policy unless
  there's a documented reason for the difference (read vs. write
  distinction is fine and expected; an unexplained difference is a finding)

**Step 6 — DTO and OpenAPI consistency.**

- Request/response DTO naming follows one consistent pattern
  (`{Action}{Resource}Request`/`Response` vs. inconsistent ad hoc naming)
- Swagger/OpenAPI annotations present and accurate — flag endpoints with no
  XML doc comments or `[ProducesResponseType]` attributes feeding the
  OpenAPI spec, since an incomplete spec actively misleads API consumers
  rather than just being unhelpfully sparse
- Nullable/required field declarations in DTOs match actual validator
  behavior — flag a DTO marking a field nullable that the validator
  actually requires (or vice versa), since this produces a misleading
  OpenAPI contract

**Step 7 — Classify and report.**

- **Breaking-if-fixed** — inconsistencies that are now load-bearing for
  existing API consumers; fixing them is itself a breaking change requiring
  a version bump or deprecation path, not a quick patch
- **Safe to fix** — internal inconsistency with no consumer-facing contract
  implication (e.g. inconsistent internal status code on an error path no
  client branches on)
- **New-endpoint guidance** — patterns this audit confirms as the
  established convention, useful as input back into `pattern-finder`/
  `dotnet-endpoint-gen` for future generation

---

## Example Invocation

**Command:** `/api-consistency-audit Tamkeen.Payments`

**Context:** Pre-v2 API review before exposing the payments API to a new
partner integration.

Agent inventories 34 endpoints, finds 31 use `page`/`pageSize` pagination
but 3 older reporting endpoints use a custom `skip`/`take` pattern with no
total-count metadata, and finds 2 endpoints return raw exception messages
instead of Problem Details — the pagination inconsistency is classified
Breaking-if-fixed (an existing internal dashboard already depends on
`skip`/`take`), the exception-message issue is classified Safe to fix.

---

## Output

- Findings table (endpoint, issue, classification, affected consumers if
  known)
- A confirmed "established convention" summary, useful as a sharper input
  to `apiConventions.md` if it's currently vague on any of these points
- Findings handed to `technical-debt-tracker` for anything not addressed
  immediately, especially Breaking-if-fixed items needing a deprecation plan
