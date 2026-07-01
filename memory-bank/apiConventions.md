# API Conventions
**Last Updated:** [YYYY-MM-DD]

## Routing
`api/v{version}/{resource-plural}/{id}` — versioned from day one even with a single
consumer; see `dotnet-iac-gen`/API Versioning skill (Phase 2 candidate) for the
header-vs-URL-segment decision.

## Response shape
- Success: the resource or `Results<Ok<T>, ...>` typed union — no envelope wrapper
  (`{ data: ... }`) unless the frontend's TanStack Query layer specifically expects one.
- Errors: RFC 7807 `ProblemDetails` always. `type` field maps to a stable error code
  the frontend can switch on — never parse the `title` string for logic.

## Auth
Every endpoint has an explicit `[Authorize]` (with policy name) or `[AllowAnonymous]`
with a one-line comment justifying anonymous access. No endpoint ships without one or
the other — `04-security-guard.mdc` blocks generation otherwise.

## Idempotency
Any endpoint that can be safely retried (payment confirmation, webhook receivers) must
accept/derive an idempotency key and short-circuit duplicate processing. See
`businessRules.md` BR-003.

## Pagination
Cursor-based for any list endpoint expected to exceed ~1000 rows; offset/limit
acceptable for small, bounded admin lists. Page size capped server-side regardless of
what the client requests.

## OpenAPI
Every endpoint annotated such that the generated OpenAPI spec is complete enough for
`react-api-layer-gen` to generate a typed client without hand-editing — this is the
contract between backend and frontend generation, not optional documentation.
