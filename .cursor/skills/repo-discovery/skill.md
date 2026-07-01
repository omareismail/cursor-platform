# Skill: repo-discovery

**Invocation:** `/repo-discovery [full|quick|path]`
Example: `/repo-discovery full` · `/repo-discovery quick` · `/repo-discovery src/Tamkeen.Payments`

---

## Overview

**Memory references:** writes `.cursor/cache/repo-map.json` (machine-checkable,
new in this phase); read by `memory-bank/techContext.md` via `context-sync`,
not the other way around.

`repo-discovery` is the **hard precondition** every generator and auditor skill
in this workspace now depends on. Before this phase, `context-sync` did
discovery as a side effect of writing `techContext.md`, and every other skill
just trusted that memory-bank was current — true on a small repo, false on a
repo with hundreds of projects where memory-bank can go stale between runs.
`repo-discovery` separates the two concerns:

- **`repo-discovery`** — fast, cached, machine-readable. Produces
  `repo-map.json`: the structural truth of the repo right now.
- **`context-sync`** — narrative, human-readable. Reads `repo-map.json` (Step 1
  of `context-sync` now delegates here instead of re-scanning) and turns it
  into the 8 Tier 1 memory-bank files with prose, rationale, and examples.

Any skill whose overview says "Memory references" now also implicitly depends
on `repo-map.json` being fresh. Skills check freshness themselves (Step 0
below) rather than assuming — this is what makes the workspace viable at
500+ project scale, where a full rescan on every single skill invocation
would be too slow to use.

**MCP tools:** `filesystem` (already configured) for directory walks on large
repos instead of relying on default indexing alone; `git` MCP server, if
connected, to scope discovery to files changed since the last run (see
Step 0).

---

## Steps

**Step 0 — Freshness check (every skill does this, not just `/repo-discovery`).**

Before any other skill reads `repo-map.json`, it checks:

```
1. Does .cursor/cache/repo-map.json exist? If not → run repo-discovery now.
2. Compare repo-map.json's "signatureHash" field against a fresh hash of the
   signature file set (below). If it differs → repo-map.json is stale, run
   repo-discovery before proceeding.
3. If repo-map.json is < 1 hour old AND signature files are unchanged → use
   it as-is, do not rescan.
```

**Signature file set** (cheap to hash, changes whenever discovery-relevant
state changes): all `*.csproj`, `*.sln`, `Directory.Build.props`,
`Directory.Packages.props`, `global.json`, `package.json`, `tsconfig*.json`,
`vite.config.*`, `docker-compose*.yml`, `Dockerfile*`, `.github/workflows/*.yml`,
`*.bicep`, `*.tf`, `helm/**/*.yaml`, `k8s/**/*.yaml`, `appsettings*.json`.

This means `repo-discovery` is invoked far more often than `context-sync` (it's
the dependency-checked precondition), but almost always as a no-op cache hit.

**Step 1 — Solution & project topology.**

Walk `*.sln` and every `*.csproj`:
- Solution → project membership
- Project → project references (build the dependency graph; flag cycles —
  feeds `architecture-guard` and the future `refactor-assistant`)
- Project → target framework, `<OutputType>`, package references
- `Directory.Build.props` / `Directory.Packages.props` → centrally managed
  versions, analyzers, nullable/implicit-usings settings inherited repo-wide

For frontend: `package.json` workspaces/monorepo packages, `tsconfig.json`
path aliases and project references, `vite.config.ts`/bundler config.

**Step 2 — Infrastructure & data layer surface.**

- Database providers in use, per project (Oracle / PostgreSQL / SQL Server /
  SQLite / MySQL) — detected via connection-string provider names in
  `appsettings*.json` and via `DbContext` `UseOracle`/`UseNpgsql`/`UseSqlServer`
  calls, not assumed from one global setting (a repo can run more than one
  provider — RHODES + Tamkeen already do).
- EF Core: `DbContext` classes, migration folders, configured entities.
- Dapper: repository classes, embedded/`.sql` file queries.
- Messaging: MassTransit/RabbitMQ/Kafka/Azure Service Bus config presence.
- Caching: Redis registration, `IMemoryCache` usage density.
- Background services: `IHostedService`/`BackgroundService` implementations.
- Observability: OpenTelemetry exporters, health check registrations.
- IaC: Bicep/Terraform/Helm/K8s manifests present, and which environments
  they target.

**Step 3 — Conventions fingerprint.**

Not a copy of `codingStandards.md` (that's Tier 2, human-authored) — this is
what's *actually* in the code right now, for `pattern-finder` to use:
- Folder layout per layer (`Domain/`, `Application/`, `Infrastructure/`,
  `Api/`, or whatever this repo actually calls them)
- Naming patterns observed (e.g. `{Entity}Command`, `{Entity}CommandHandler`,
  `I{Entity}Repository`) sampled from real files, not assumed from a template
- React: folder-per-feature vs folder-per-type, hook naming, API client
  pattern in use

**Step 4 — Write `repo-map.json`.**

```json
{
  "generatedAt": "2026-06-30T12:00:00Z",
  "signatureHash": "sha256:...",
  "solutions": [...],
  "projects": [
    {
      "name": "Tamkeen.Payments.Api",
      "references": ["Tamkeen.Payments.Application", "Tamkeen.Payments.Infrastructure"],
      "targetFramework": "net8.0",
      "layer": "presentation"
    }
  ],
  "dependencyGraph": { "cycles": [] },
  "databaseProviders": ["oracle", "sqlserver"],
  "dataAccess": { "efCoreContexts": [...], "dapperRepositories": [...] },
  "messaging": ["masstransit+rabbitmq"],
  "iac": ["bicep"],
  "conventionsFingerprint": {
    "backendNaming": "{Entity}Command / {Entity}CommandHandler",
    "frontendStructure": "feature-folder"
  }
}
```

Present a short summary in chat (project count, providers detected, any
dependency cycles found) — never dump the full JSON into the conversation.

**Step 5 — Flag discovery anomalies, don't silently resolve them.**

If two projects use the same `DbContext` against different providers, or a
project references something outside its expected layer, surface it as a
finding for `02-dotnet-architecture-guard.mdc` / `database-audit` to act on —
`repo-discovery`'s job is to map reality accurately, not to judge it.

---

## Example Invocation

**Command:** `/repo-discovery quick`

**Context:** Starting a session on RHODES before generating a new endpoint.

Agent checks `repo-map.json` freshness against the signature file set, finds
it's 4 days old and two new `.csproj` files exist since → reruns full
discovery, updates `repo-map.json`, reports: "187 projects, 2 DB providers
(Oracle, SQL Server), 1 dependency cycle detected in `Rhodes.Reporting` →
`Rhodes.Core` → `Rhodes.Reporting` (flagged for architecture-guard)."

---

## Output

- `.cursor/cache/repo-map.json` (machine-readable, git-ignored — regenerated,
  not hand-edited)
- Chat summary of scope, providers, and any anomalies found
- Anomalies handed to `02-dotnet-architecture-guard.mdc`, `06-database-provider-guard.mdc`,
  or `database-audit` as applicable — `repo-discovery` itself never blocks or
  refuses anything
