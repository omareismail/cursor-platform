---
name: feature-inventory
description: "Runs the feature-inventory workflow. Invoked as /feature-inventory."
---

<!-- GENERATED from the cursor-platform source skill "feature-inventory".
     Do not edit here - edit the source and re-run the plugin build. -->

# Skill: feature-inventory

**Invocation:** `/feature-inventory [scope] [--depth shallow|deep]`
Example: `/feature-inventory full` · `/feature-inventory Tamkeen.Payments` · `/feature-inventory full --depth deep`

---

## Overview

**Memory references:** `.cursor/cache/repo-map.json` (from `repo-discovery`,
Step 0 freshness applies), `.cursor/cache/feature-map.json` (this skill seeds it),
`memory-bank/productContext.md`, `memory-bank/businessRules.md`,
`memory-bank/glossary.md`, `memory-bank/architecture.md`

`feature-inventory` answers **"what does this system actually do?"** It harvests
every entry point in the codebase — HTTP endpoints, UI routes, background jobs,
scheduled tasks, message consumers, CLI commands, report definitions — clusters
them into business capabilities, and produces a capability map with an honest
coverage figure.

This is the breadth counterpart to `feature-trace`'s depth. Trace tells you how
one thing works; inventory tells you what things there are. On an inherited
codebase, inventory comes first: you cannot prioritise what to trace until you
know what exists, and "we thought there were about 30 endpoints, there are 214"
is a common and load-bearing discovery.

It also produces the thing nobody has: a list of capabilities that are **in the
code but in nobody's head** — endpoints nothing calls, jobs whose schedule was
disabled years ago, flags permanently on, routes with no navigation entry.

**Depth modes:**

- `shallow` (default) — harvest and cluster entry points only. Fast, whole-repo,
  no per-feature tracing. Seeds `feature-map.json` with `status: "stub"` entries.
- `deep` — additionally trace the top capabilities by risk (money, auth, external
  integration) via `feature-trace`. Slower; use on a scoped module, not `full`.

Read-only against source. Writes only `.cursor/cache/feature-map.json` via the tool.

---

## Steps

**Step 0 — Prerequisites.**

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/feature-map.mjs init
node ${CLAUDE_PLUGIN_ROOT}/tools/feature-map.mjs list
```

`repo-map.json` must exist and be fresh — inventory over a stale structural map
misses whole projects. If it is missing, run `/repo-discovery full` first.

If features are already stubbed from a previous run, this run **updates** rather
than replaces: new entry points get added, disappeared ones get flagged as
removed, and existing `status: "traced"` entries are left alone (never downgrade
a real trace to a stub).

**Step 1 — Harvest entry points.**

Every way the system can be invoked. Grep-driven, no file reading beyond what is
needed to attribute each hit:

| Kind | Find by |
|---|---|
| HTTP endpoint | `MapGet\|MapPost\|MapPut\|MapDelete\|MapPatch`, `[Http(Get\|Post\|Put\|Delete\|Patch)]`, `[Route(` |
| UI route | Router config — `createBrowserRouter`, `<Route path=`, Next.js `app/`/`pages/` file conventions |
| Background job | `BackgroundService`, `IHostedService`, `RecurringJob.AddOrUpdate`, Quartz `IJob`, `[DisallowConcurrentExecution]` |
| Scheduled task | Cron expressions in config, Azure Functions `[TimerTrigger]`, K8s `CronJob` manifests |
| Message consumer | `IConsumer<`, `IHandleMessages<`, `[ServiceBusTrigger]`, Kafka subscriber registration |
| Integration event | `IntegrationEvent` subclasses, outbox table writers, `IPublishEndpoint.Publish` |
| CLI / admin | `IHostedService` with args, `System.CommandLine`, custom `Program.cs` switches |
| Report / export | Report definition files, `.rdl`, export endpoints, scheduled export jobs |
| Webhook | Inbound endpoints with signature verification, `AllowAnonymous` + HMAC checks |

For each hit record: kind, ref (route/name), `file:line`, auth policy or
`[AllowAnonymous]`, and the owning project/module from `repo-map.json`.

**Step 2 — Cluster into business capabilities.**

Raw entry points are not features. `GET /brokers`, `POST /brokers`,
`PUT /brokers/{id}` and `BrokerListPage.tsx` are one capability: *broker
management*.

Cluster by, in priority order:

1. **Shared domain entity or aggregate** — strongest signal
2. **Module / bounded context** from `repo-map.json`
3. **Route prefix** (`/api/v1/policies/*`)
4. **Shared handler or service**

Name each cluster in **the team's language**, taken from
`memory-bank/glossary.md` and `productContext.md` — not invented. If the glossary
has no word for a cluster, that is itself a finding: report it under *Undocumented
capabilities* rather than coining a term and pretending it is canonical.

**Step 3 — Attach risk signals, cheaply.**

Per capability, without deep tracing — these are the inputs to "what should we
trace first":

- **Money** — does it touch `decimal` fields, payment/settlement/commission
  tables, or an external payment provider?
- **Auth exposure** — any `[AllowAnonymous]`, any endpoint with no policy at all
- **External dependency** — outbound HTTP clients, third-party SDKs
- **Data mutation** — write endpoints, jobs that `UPDATE`/`DELETE`
- **Compliance surface** — PII, SAMA/ZATCA/mada-relevant flows (cross-reference
  `/compliance-audit` scope)
- **Test coverage** — does any test file reference these entry points at all?
- **Churn** — `git log --oneline --since=1.year -- <paths> | wc -l`. High churn +
  low coverage is where incidents come from.
- **Age** — `git log -1 --format=%ci`. Untouched for years is not necessarily
  dead, but combined with zero callers it is a strong signal.

**Step 4 — Find the dark corners. This is the differentiating output.**

- **Orphan endpoints** — no frontend call site, no test, no external consumer
  documented. Candidates for deprecation; verify before deleting (mobile clients
  and partner integrations do not appear in this repo).
- **Orphan UI routes** — reachable by URL but absent from every navigation
  component.
- **Dormant jobs** — registered but with a disabled schedule, or a cron that
  never fires.
- **Permanently-set feature flags** — a flag that is `true` in every environment
  config is not a flag, it is dead branching. List both branches' fate.
- **Duplicate capabilities** — two clusters doing the same business thing (a
  legacy and a v2 path). The single highest-value finding here; flag loudly.
- **Undocumented capabilities** — in code, absent from `productContext.md` and
  `glossary.md`.

**Step 5 — Seed the feature map.**

Upsert each capability as a stub so later `/feature-trace` runs have identity and
`/impact-analysis` has an index to query:

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/feature-map.mjs upsert /tmp/inventory.json
```

Stubs use `status: "stub"`, `confidence: "low"`, `files[]` limited to the entry
points actually found. **Never mark a stub `traced`** — the difference between
"we know this exists" and "we know how this works" is the whole point of the
status field, and collapsing it makes the map lie.

Payload shape: `{ "features": { "<id>": { ... }, ... } }`.

**Step 6 — Report coverage honestly.**

State what fraction of capabilities are traced vs stubbed, and what the harvest
could not see: anything invoked by reflection, endpoints registered by a
convention scanner, routes generated at build time, capabilities living in a
different repo. An inventory presenting itself as complete when it is not is
worse than no inventory.

---

## Example Invocation

**Command:** `/feature-inventory Tamkeen.Payments`

Agent harvests 63 endpoints, 9 jobs, 4 message consumers and 22 UI routes;
clusters them into 11 capabilities; finds that *settlement export* exists twice
(a 2021 controller and a 2024 minimal-API version, both live, both wired into
different reports), that 3 endpoints are `AllowAnonymous` with no justifying
comment, and that the `payments-v2` flag has been `true` in every environment for
14 months. Seeds 11 stubs and recommends tracing settlement export first.

---

## Output

- **Console report:**

```
## Feature inventory: <scope>

**Entry points:** <n> endpoints, <n> routes, <n> jobs, <n> consumers, <n> reports
**Capabilities:** <n>   **Traced:** <n>   **Stubbed this run:** <n>
**Coverage:** <n>% of capabilities have a real trace

### Capability map
| Capability | Entry points | Module | Money | Auth gap | External | Tests | Churn (1y) |
|---|---|---|---|---|---|---|---|

### Trace these first (ranked by risk x ignorance)
| # | Capability | Why it ranks here |

### Duplicate capabilities
| Capability | Implementation A | Implementation B | Both live? |

### Dark corners
| Kind | Item | Evidence | Recommended check before removing |
(orphan endpoints, orphan routes, dormant jobs, permanent flags)

### Undocumented capabilities
<in code, absent from productContext.md / glossary.md>

### What the harvest could not see
<reflection-registered handlers, convention scanners, build-time routes,
capabilities in other repos - be specific>
```

- **Cache:** `.cursor/cache/feature-map.json` seeded with stub entries via
  `node ${CLAUDE_PLUGIN_ROOT}/tools/feature-map.mjs upsert`
- **Optional doc:** if the user asks for a shareable version, hand off to
  `/onboarding-doc-gen` — do not duplicate its templating here

