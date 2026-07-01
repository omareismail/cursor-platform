# Performance Guidelines
**Last Updated:** [YYYY-MM-DD]

## Backend
- No N+1 queries: every EF Core query touched by a list endpoint reviewed for
  `.Include()` completeness or projected directly to a DTO (`Select` before
  materializing), whichever avoids the round-trip.
- `AsNoTracking()` on every read-only query.
- Bulk operations (>100 rows) use `ExecuteUpdate`/`ExecuteDelete` (EF Core 7+) or
  Dapper bulk insert, not a loop of individual `SaveChangesAsync()` calls.
- Caching: short-TTL in-memory for hot, rarely-changing lookups (vehicle categories,
  config); Redis for anything shared across instances. Cache invalidation strategy
  documented at the point the cache is added — "I'll figure out invalidation later"
  is a tech debt entry, not a deferred decision.

## Frontend
- Bundle size budget: [set a number per route, e.g. 250KB gzipped initial route chunk]
- TanStack Query `staleTime` set deliberately per query — not left at default 0 for
  data that rarely changes (causes unnecessary refetch storms).
- `React.memo`/`useMemo`/`useCallback` only where profiling shows a real re-render
  cost — not applied reflexively, since unnecessary memoization adds complexity and
  occasionally makes things slower.

## Database
- Every foreign key has a supporting index (not automatic in all providers — check
  explicitly, especially for Oracle legacy schemas).
- Query plans reviewed for any query expected to run against >100k rows before it
  ships, not after it's slow in production.
