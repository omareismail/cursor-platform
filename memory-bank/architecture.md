# Architecture
**Last Updated:** [YYYY-MM-DD]
**Owner:** lead architect (human-edited; not auto-regenerated)

## Layering (Clean Architecture default)
```
src/
  [Project].Domain/         no dependencies — entities, value objects, domain events
  [Project].Application/    depends on Domain only — CQRS handlers, interfaces, DTOs
  [Project].Infrastructure/ depends on Application — EF Core, Dapper, external clients
  [Project].API/            depends on Application + Infrastructure — composition root only
```
**Hard rule:** Domain references nothing. Application references Domain only.
Infrastructure and API may depend inward, never the reverse. `02-dotnet-architecture-guard.mdc`
enforces this and `*.ArchitectureTests` (NetArchTest) makes it a build gate, not a guideline.

## Module boundaries (multi-database / multi-service projects)
If a project talks to more than one database (e.g. SQL Server for OLTP + read-only
Oracle for legacy data), the boundary lives in Infrastructure: one `DbContext` /
connection factory per data source, never shared. Application layer code must not know
which provider it's hitting — see `databaseConventions.md`.

## Frontend module boundaries
```
src/
  features/[name]/    components, hooks, api fetchers for one feature — can import from shared/
  shared/              cross-feature components, hooks, utils — cannot import from features/
  app/                 routing, providers, layout shell
```
A feature folder owning its own `api/` fetchers (not a global `services/` folder) keeps
ownership unambiguous and makes Module Federation extraction (see
`react-module-federation-gen`) a folder move, not a rewrite.

## Cross-cutting decisions belong in decisionLog.md, not here
This file is the current state. `decisionLog.md` is why it's the current state and
what was considered instead.
