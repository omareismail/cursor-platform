# Testing Standards
**Last Updated:** [YYYY-MM-DD]

## Backend
- Unit tests: handler logic, validators, domain entities — no database, no HTTP.
- Integration tests: full request pipeline against a real (TestContainers-provisioned)
  database instance matching the production provider — testing against SQLite/in-memory
  when production runs SQL Server or Oracle is explicitly disallowed; provider-specific
  bugs (case sensitivity, date handling) won't surface otherwise.
- Architecture tests (`*.ArchitectureTests`, NetArchTest) are a build gate, not optional.
- Naming: `MethodName_StateUnderTest_ExpectedBehavior`.

## Frontend
- Component tests (Vitest + Testing Library): test behavior/output, not implementation
  details — query by role/label, not by CSS class or test-id unless no accessible
  query exists.
- E2E (Playwright): critical paths only (login, policy issuance, payment flow) — not a
  replacement for component tests, which should cover the long tail.
- Mock at the network boundary (MSW) for component tests, not by mocking the fetcher
  module directly — keeps tests honest about the actual request shape.

## Coverage
Coverage percentage is a smell detector, not a target. A handler with 100% line
coverage and no assertion on the actual returned value is worse than 70% coverage
with meaningful assertions. `dotnet-test-gen`/`react-test-gen` generate assertions
against spec acceptance criteria, not just "doesn't throw."

## What must always have a test
Every webhook handler, every money-touching code path, every auth policy boundary.
