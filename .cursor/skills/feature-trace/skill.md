# Skill: feature-trace

**Invocation:** `/feature-trace [feature-name-or-entry-point]`
Example: `/feature-trace "premium calculation"` · `/feature-trace "POST /api/v1/policies/{id}/renew"` · `/feature-trace BrokerCommissionHandler`

---

## Overview

**Memory references:** `.cursor/cache/repo-map.json` (from `repo-discovery`, Step 0
freshness check applies), `.cursor/cache/feature-map.json` (this skill owns it),
`memory-bank/architecture.md`, `memory-bank/businessRules.md`,
`memory-bank/glossary.md`, `memory-bank/databaseConventions.md`

`feature-trace` answers the question the rest of this platform does not:
**"how does this feature actually work today?"** It follows one business
capability end-to-end through every layer it passes — React route → component →
hook → API client → HTTP endpoint → handler/command → domain logic → repository →
`DbContext` → tables, plus the background jobs, integration events, feature flags
and auth policies attached to it — and writes the result to a report *and* to
`.cursor/cache/feature-map.json` so the next question about the same feature is
free.

This is deliberately the inverse of the rest of the skill library. `speckit-*`
and `*-gen` build things that do not exist yet; `*-audit` judges the quality of
things that do. Neither explains what the code currently *does*. On a large
legacy fintech codebase that explanation is the prerequisite for almost every
task — you cannot safely change premium calculation until you know that it also
runs inside a nightly reconciliation job and that one of its three callers
bypasses the validator.

**How it differs from the neighbouring skills:**

- **`repo-discovery`** — repo-wide structure. "What projects exist?" Machine map.
- **`context-builder`** — task-scoped, forward-looking. "What do I need to know
  before I *build* refund processing?" Assembles context for work not yet done.
- **`pattern-finder`** — one artifact. "What is the nearest example to imitate?"
- **`architecture-map-gen service-interaction`** — call graph between *services*,
  drawn from structure. Says nothing about business meaning.
- **`feature-trace`** — one *business capability*, backwards from what exists,
  across every layer, with the semantics attached.

Read-only against source. The only file it writes is
`.cursor/cache/feature-map.json`, via the tool — never by hand.

---

## Steps

**Step 0 — Freshness and prior work.**

```bash
node .cursor/tools/feature-map.mjs init      # no-op if it already exists
node .cursor/tools/feature-map.mjs list
```

If the feature is already traced and `list` reports it **fresh**, do not re-trace.
Show the cached trace (`show <id>`) and ask whether the user wants a refresh. If
it reports **STALE**, run `verify <id>` — the tool names the exact files whose
content changed since the trace. Re-trace only those paths and their immediate
neighbours rather than starting from zero.

Also confirm `.cursor/cache/repo-map.json` is present and fresh (Step 0 of
`/repo-discovery`). Tracing without the structural map means grepping blind.

**Step 1 — Resolve the request to a concrete entry point.**

The user will usually give a business name ("premium calculation"), not a symbol.
Resolve it to one or more real entry points before tracing anything:

| Given | Resolve by |
|---|---|
| Business term | `memory-bank/glossary.md` first — the team's word for it may not be the code's word. Then grep for the term and its Arabic/English variants. |
| Endpoint path | Grep `MapPost`/`MapGet`/`[HttpPost]` + route literal |
| UI screen | Grep the router config for the path, then the lazy-imported component |
| Symbol name | Direct |
| Job / schedule | Grep `IHostedService`, `BackgroundService`, Hangfire/Quartz registrations |

**If the term resolves to nothing, stop and say so.** Do not trace a plausible
neighbour and present it as the answer — a confidently wrong trace is worse than
no trace, because it will be cached and trusted. Offer the closest candidates and
ask the user which one they meant.

If it resolves to **several** entry points (common: an endpoint, a job, and a
report all compute premium), trace all of them and record the divergence — that
divergence is very often the actual bug the user is hunting.

**Step 2 — Walk the stack, recording every hop.**

Follow real references, not naming conventions. At each hop record `file:line`.

Frontend (if the entry point is a UI route):

1. Route definition → lazy import → page component
2. Component → hooks it calls → API-layer function
3. API function → HTTP method + path + request/response types
4. Client-side validation, permission gates, feature-flag checks

Backend:

5. Endpoint/controller action → auth attribute + policy name
6. Request DTO → validator → command/query object
7. Handler → the domain services and entities it touches
8. Domain logic → the actual business rules (this is the part users care about)
9. Repository / Dapper query / `DbContext` → SQL → **tables and columns**
10. Anything published: integration events, outbox rows, notifications
11. Anything scheduled: jobs that read or write the same tables

Cross-cutting, at every layer: feature flags, config keys, caching (and its
invalidation), retry/idempotency, audit-trail writes, transaction boundaries.

**Depth discipline.** Stop descending when you reach a generic framework or
infrastructure primitive (`IMediator.Send`, `DbSet<T>`, `HttpClient`). Trace
breadth over depth: every caller of the handler matters, the internals of the
mediator do not. Cap at roughly 40 file reads — on a bigger surface, trace the
primary path fully, list the secondary paths as untraced, and say so.

**Step 3 — Extract the business rules, in the team's own language.**

Convert the code you read into statements a domain expert would recognise:

> "Premium = base rate × risk multiplier, rounded to 2dp **half-away-from-zero**;
> brokers on legacy contracts (`Broker.ContractVersion < 3`) get the pre-2023
> multiplier table instead" — `PremiumCalculator.cs:88-134`

Every such statement carries `file:line`. Then diff them against
`memory-bank/businessRules.md`:

- Rule in code but not documented → **undocumented rule** (report it)
- Rule documented but not in code → **drift** (report it; this is what
  `/spec-drift-audit` exists to chase systematically)
- Both, and they disagree → **critical finding**, surface it loudly

**Step 4 — Identify risk without editorialising.**

Note only what you can point at: money handled as `double`, a rule duplicated in
three places that could diverge, a path with no test coverage, a mutation with no
audit trail, a cache with no invalidation, an `AllowAnonymous` with no comment.
Cite `file:line` for each. Do not speculate about performance or correctness you
have not evidenced — mark genuine uncertainty as an open question instead.

**Step 5 — Persist the trace.**

Write the feature object to a temp JSON file and upsert it. The tool stamps
content hashes so freshness is computable later:

```bash
node .cursor/tools/feature-map.mjs upsert /tmp/<feature-id>.json
node .cursor/tools/feature-map.mjs verify <feature-id>
```

Required shape (ids are kebab-case; `files[]` must be non-empty and every path
must exist):

```json
{
  "id": "premium-calculation",
  "name": "Premium calculation",
  "summary": "One-sentence, business-readable.",
  "status": "traced",
  "confidence": "high",
  "entryPoints": [
    { "kind": "endpoint", "ref": "POST /api/v1/policies/{id}/premium",
      "file": "src/Co.API/Endpoints/Policies/PremiumEndpoint.cs:31" },
    { "kind": "job", "ref": "NightlyReconciliationJob",
      "file": "src/Co.Infrastructure/Jobs/NightlyReconciliationJob.cs:44" }
  ],
  "files": [
    { "path": "src/Co.API/Endpoints/Policies/PremiumEndpoint.cs", "role": "endpoint" },
    { "path": "src/Co.Application/Policies/CalculatePremiumHandler.cs", "role": "handler" },
    { "path": "src/Co.Domain/Pricing/PremiumCalculator.cs", "role": "domain" },
    { "path": "frontend/src/features/policies/PremiumPanel.tsx", "role": "ui" }
  ],
  "dataTouched": {
    "tables": ["Policies", "PremiumLines", "RiskFactors"],
    "columns": ["Policies.BasePremium", "PremiumLines.Amount"],
    "contexts": ["PolicyDbContext"]
  },
  "featureFlags": ["premium-v2"],
  "authPolicies": ["UnderwriterPolicy"],
  "externalDeps": ["RiskScoringApi"],
  "businessRules": [
    { "rule": "Rounded 2dp half-away-from-zero", "at": "src/Co.Domain/Pricing/PremiumCalculator.cs:112",
      "documented": false }
  ],
  "risks": [
    { "risk": "Job and endpoint use different rounding", "at": "NightlyReconciliationJob.cs:88", "severity": "high" }
  ],
  "openQuestions": ["Is the legacy multiplier table still in use after the 2024 migration?"]
}
```

Set `confidence` honestly: `high` only when you followed every hop to a concrete
symbol; `medium` when some resolution was by naming convention; `low` when
reflection, DI-by-convention, or dynamic dispatch defeated static tracing. Set
`status` to `partial` if you capped out on file reads.

**Step 6 — Report, and hand off.**

Print the report below. Then route the user onward rather than guessing what they
want next:

- about to change it → `/impact-analysis <feature-id>`
- code does not match the spec → `/spec-drift-audit <feature-id>`
- want the whole picture → `/feature-inventory`
- ready to build on it → `/context-builder`, then the relevant `*-gen` skill

---

## Example Invocation

**Command:** `/feature-trace "broker commission"`

Agent resolves "broker commission" via `glossary.md` to `CommissionCalculator`,
finds three entry points (an endpoint, a nightly job, and an export report),
traces all three, and discovers the export report applies commission *before* tax
while the other two apply it after. That divergence is recorded as a `high`
severity risk with two `file:line` citations, and the trace is cached so the
follow-up `/impact-analysis` costs nothing.

---

## Output

- **Console report:**

```
## Feature trace: <name>

**Entry points:** <n>   **Files:** <n>   **Confidence:** high|medium|low
**Cached as:** <feature-id>   **Untraced:** <anything capped out, or "none">

### What it does
<3-5 sentences a domain expert would agree with>

### Flow
<numbered end-to-end walk, each hop with file:line>

### Data touched
| Table | Columns | Read/Write | Via |

### Business rules found in code
| Rule | Location | In businessRules.md? |

### Cross-cutting
| Concern | Where | Notes |
(feature flags, auth policies, caching, audit trail, transactions, retries)

### Divergences
<same capability implemented differently in >1 place - the highest-value finding>

### Risks
| Risk | Location | Severity |

### Open questions
<what static tracing could not resolve - ask the human>
```

- **Cache:** `.cursor/cache/feature-map.json` updated via
  `node .cursor/tools/feature-map.mjs upsert` (never hand-edited — the
  `PreToolUse` write guard blocks direct writes to it)
