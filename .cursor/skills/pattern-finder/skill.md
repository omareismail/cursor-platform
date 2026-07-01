# Skill: pattern-finder

**Invocation:** `/pattern-finder [target-description]`
Example: `/pattern-finder new CQRS command handler for refund processing`

---

## Overview

**Memory references:** reads `.cursor/cache/repo-map.json` (from
`repo-discovery`, must be fresh — Step 0 of that skill applies here too) plus
the relevant Tier 2 convention files (`backendConventions.md` /
`frontendConventions.md` / `apiConventions.md`) for *what the rule says*, then
finds the *actual file* that's the best example of it.

This is the gap Phase 1 discovery flagged directly: every `*-gen` skill cites
which memory-bank file it follows for conventions, but conventions describe
the rule in prose — they go stale, they're sometimes aspirational rather than
descriptive, and prose can't capture things like exact validation-attribute
ordering or how error responses are actually shaped in this repo's 40
existing endpoints. `pattern-finder` closes that gap: it is now a **required
first step inside every `*-gen` skill**, not an optional nice-to-have.

`dotnet-endpoint-gen`, `dotnet-dapper-gen`, `dotnet-messaging-gen`,
`dotnet-background-job-gen`, `dotnet-caching-gen`, `react-component-gen`,
`react-hook-gen`, `react-api-layer-gen`, `react-state-machine-gen` — all of
these should call `pattern-finder` before writing a line of new code, and
should imitate the returned example's structure, not just its existence.

---

## Steps

**Step 1 — Classify the target.**

Map the free-text description to a concrete artifact type already known to
this workspace's generator skills (command handler, query handler, Dapper
repository, React hook, presentational component, API client function, etc.).
If the description doesn't map cleanly to one of these, ask one clarifying
question rather than guessing — a wrong category produces a confidently wrong
example.

**Step 2 — Search `repo-map.json`'s conventions fingerprint for candidates.**

Use the naming pattern already fingerprinted by `repo-discovery` (e.g.
`{Entity}Command` / `{Entity}CommandHandler`) to shortlist real files matching
that shape, filtered to:
- Same layer/project the new code will live in
- Same or most-similar database provider, if data-access is involved
  (an Oracle Dapper repository is not a good template for a PostgreSQL one —
  type mapping and pagination syntax differ)
- Most recently modified among matches — prefer the pattern the team is
  *currently* converging on over an older outlier, unless the older one is
  more prevalent (if 18 handlers use one shape and 2 use another, the 2 are
  probably tech debt, not the standard — flag this rather than picking
  silently)

**Step 3 — Rank and present 1-3 candidates, not just the top match.**

```
Target: CQRS command handler for refund processing

1. RefundController... no match — searching Application layer instead.
2. Tamkeen.Payments.Application/Commands/VoidPayment/VoidPaymentCommandHandler.cs
   — same bounded context, same FulfillmentSaga integration pattern. BEST MATCH.
3. Tamkeen.Payments.Application/Commands/CapturePayment/CapturePaymentCommandHandler.cs
   — same context, slightly older validation style (FluentValidation v10 vs v11).
```

If the top two candidates disagree on structure, say so explicitly instead of
silently picking one — this is itself a signal worth a `technical-debt-tracker`
entry if it's never been flagged before.

**Step 4 — Extract the imitable shape, not just point at the file.**

Summarize what the new code must match: constructor injection style, where
validation lives (attribute vs. FluentValidation vs. domain guard clause),
return type convention (`Result<T>` vs. throwing vs. `OneOf<T>`), logging
calls, how the handler participates in `FulfillmentSaga` if relevant, test
file location and naming for the matching test.

**Step 5 — Hand off to the calling `*-gen` skill.**

`pattern-finder`'s output is consumed, not narrated separately to the user
unless invoked standalone — when called from inside `dotnet-endpoint-gen` etc.,
its findings should appear folded into that skill's own output, with the
matched file cited as "imitating `VoidPaymentCommandHandler.cs`" rather than
shown as a separate report.

---

## Example Invocation

**Command:** `/pattern-finder new CQRS command handler for refund processing`

**Context:** Standalone check before manually writing a handler, outside of
`dotnet-endpoint-gen`'s normal flow.

Agent classifies target as "command handler," searches `repo-map.json` for
`Tamkeen.Payments.Application/Commands/**/*CommandHandler.cs`, finds
`VoidPaymentCommandHandler.cs` as the closest analog by bounded context and
saga integration, and returns its structural shape: constructor injection of
`IPaymentGatewayClient` + `IUnitOfWork`, FluentValidation in a sibling
`Validator.cs` file, `Result<RefundResult>` return type, and a
`FulfillmentSaga.Compensate` call on the failure path.

---

## Output

- 1-3 ranked candidate files with the reasoning for the ranking
- Extracted structural conventions to imitate (DI style, validation
  placement, return type, error handling, test pairing)
- A flagged note if candidates disagree on convention (possible drift —
  surfaced for `technical-debt-tracker`, not silently resolved)
