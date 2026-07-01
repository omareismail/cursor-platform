# Coding Standards
**Last Updated:** [YYYY-MM-DD]

## C# / .NET
- `record` for DTOs and value objects, `class` for entities with identity.
- Nullable reference types enabled project-wide; no `#nullable disable`.
- Async all the way down; no `.Result` / `.Wait()` / `async void` outside event handlers.
- `CancellationToken` is the last parameter on every async method that crosses an I/O
  boundary, and it gets passed through — not a fresh `default`.
- No `ConfigureAwait(false)` needed in ASP.NET Core (no SynchronizationContext), but
  required in any code shipped as a reusable library/NuGet package.
- Exceptions are for exceptional cases; expected failure paths use `Result<T>` (or
  `OneOf<T, Error>`), not control-flow exceptions.
- One public type per file. File name matches type name.

## TypeScript / React
- `strict: true` in tsconfig — no exceptions checked into shared config.
- No `any`; use `unknown` and narrow, or generate types from the OpenAPI spec.
- Components are named functions, not arrow consts, for readable stack traces.
- Props interfaces are named `[Component]Props`, colocated above the component.
- No inline object/array literals as prop values without `useMemo` if the component
  is wrapped in `React.memo` — defeats memoization silently otherwise.

## Naming
- .NET: PascalCase types/methods, camelCase locals/params, `I` prefix for interfaces
  only when a concrete default implementation exists alongside it (`IClock`/`SystemClock`),
  not for every interface reflexively.
- React: PascalCase components, camelCase hooks prefixed `use`, kebab-case file names
  except component files which match the component name.
- No abbreviations in domain types (`PolicyNumber`, not `PolNo`) — abbreviations are
  acceptable in loop variables and local scratch values only.

## Magic values
Any string/number compared more than once, or that has business meaning (status codes,
thresholds, currency codes), becomes a named constant or enum. `code-review-assistant`
flags repeated literals as a finding, not a suggestion.
