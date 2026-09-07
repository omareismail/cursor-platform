# Architectural review — proposed enhancements

**Reviewer:** Principal architect review, evidence-based
**Scope:** ~150 proposed additions across 18 categories
**Verdict:** **7 approved** (2 new artifacts, 5 merges into existing skills), **~130 rejected or already covered**
**Outcome:** the skill count moved from 76 to 77 and the validators from 5 to 6.
Every other approved item was an edit to a skill that already existed.

---

## The finding that decides most of this

**The proposal list is written for a knowledge-base repository. This is not one.**

That distinction is not pedantic — it changes the correct answer for almost every
item on the list.

A knowledge base is **documentation a human reads**: `caching/redis.md`,
`patterns/repository.md`, `security/owasp.md`. Its unit of value is an article.

This repository is an **agent platform**. Its unit of value is an *executable
artifact*: a skill the agent runs, a rule that constrains generation, a hook that
blocks a write, a validator that exits non-zero. Nothing here is written to be
read start-to-finish by a human.

Measured against the corpus as it stood at review time — 76 skill directories,
11 rules, 24 memory-bank files and the templates, 593 KB of source:

| Proposed topic | Mentions in the existing corpus | Where it lives |
|---|---|---|
| Versioning | 98 | `apiConventions.md`, `dotnet-endpoint-gen`, `api-consistency-audit` |
| Outbox | 47 | `dotnet-messaging-gen` |
| ADR / decision records | 39 | `speckit-adr`, `decisionLog.md` |
| Secret management | 33 | `04-security-guard`, `guard-write.mjs`, `security-auditor` |
| Docker / containers | 33 | `dotnet-iac-gen`, `devops-audit` |
| High availability / RPO / RTO | 32 | `production-readiness-review` |
| Retry strategies | 31 | `dotnet-messaging-gen`, `dotnet-background-job-gen` |
| Mediator / CQRS | 27 / 14 | `02-dotnet-architecture-guard`, `backendConventions.md` |
| Rollback | 26 | `release-safety` |
| Idempotency | 25 | `dotnet-background-job-gen`, `production-readiness-review` |
| Redis / distributed cache | 28 | `dotnet-caching-gen` |
| BenchmarkDotNet | 19 | `dotnet-perf-profile` |
| Feature flags | 19 | `release-safety`, `flag-debt.mjs` |

**Roughly 85% of the proposal is already here — as executable artifacts rather
than as prose.** Writing it again as documents would produce a second, parallel,
immediately-drifting copy that nobody reads, because humans read the code and the
agent reads the skills.

**The cost of the duplicate is not zero.** Every skill description costs ~100
tokens of always-on context in Claude Code. Every near-duplicate description
degrades routing accuracy — the agent has to choose between `caching/redis.md`
and `dotnet-caching-gen`, and it will sometimes choose wrong. Adding 150
documents to a repository whose main constraint is *selection accuracy under a
context budget* makes it measurably worse, not better.

**So the default verdict for a proposal is: if the substance already exists as a
skill or rule, do not write it as a document.** The exceptions are the seven
items below, each of which fills a gap the corpus scan proves is real.

---

## 1. Approved enhancements

Only seven. Two new artifacts; five are edits to existing skills.

### ✅ A1 — `docs-lint.mjs` (new tool)

**Covers:** Link Checker, Duplicate Detection, Documentation Coverage, Markdown Lint

**Why.** This is the one Documentation Automation item that fits the platform's
philosophy exactly — mechanical, deterministic, exits non-zero, gates CI. Corpus
evidence: 0 hits for `markdownlint`, 1 for `link check`. It genuinely does not
exist.

The proof it's needed is in this repository's own history: broken internal links
and stale skill references were hand-checked three separate times during recent
work. Anything checked by hand three times should be a script.

**Benefits.** Catches a class of rot nothing else does — a skill renamed but
still referenced in `START-HERE.md`, a doc linking to a deleted file, a count
that drifted, an orphan document nothing links to. Agent config has no compiler;
this is the closest thing.

**Drawbacks.** One more tool to maintain. Mitigated by keeping it dependency-free
and scoped to what actually breaks.

**Overlaps?** Partially with `docs-guard` — but that skill checks whether a doc's
claims about *code* still hold (semantic, agent-run). This checks whether the
*documentation graph itself* is intact (structural, mechanical). Different
failure modes, different runtimes. No merge.

**Priority:** P0 · **Effort:** ~2h

### ✅ A2 — `load-test-gen` (new skill)

**Covers:** Load Testing, Stress Testing

**Why.** The platform created a blocker for itself and left no way through it:

- `production-readiness-review` treats a missing load test as a **blocker** for
  anything on a critical path
- `dotnet-perf-profile` explicitly distinguishes what belongs in a micro-benchmark
  from "what needs a load test" — and then stops
- Corpus scan: **1 hit** for any load-testing tool (k6, NBomber, JMeter, Gatling),
  and it is the sentence declining to write one

So a PRR can block a release on a load test that no skill in the platform can
produce. That is an incoherence, not a preference.

**Benefits.** Closes the gap; derives the scenario from a `feature-trace` (real
entry points) and the thresholds from `operability-gen`'s SLOs, so the test
asserts the number you actually committed to rather than a made-up one.

**Drawbacks.** Load tests need an environment. The skill must be explicit that a
load test against a shared environment is a fine way to cause an incident.

**Overlaps?** No. `dotnet-perf-profile` is static analysis + micro-benchmark;
this is throughput under concurrency. The two are complementary and the boundary
is already documented in `dotnet-perf-profile`.

**Priority:** P0 · **Effort:** ~3h

### ✅ A3 — Distributed locks → merge into `dotnet-background-job-gen`

**Covers:** Distributed Locks, Scheduling

**Why.** Corpus: **0 hits** for "distributed lock". The skill scaffolds recurring
jobs with idempotency and retry, but says nothing about the failure that actually
happens: the job runs on three replicas simultaneously. In a settlement or
reconciliation job that is a duplicate-posting incident.

**Merge, do not create.** It is one section in a skill that already exists.

**Priority:** P1 · **Effort:** ~45m

### ✅ A4 — Compiled queries + bulk operations → merge into `dotnet-query-optimizer`

**Covers:** Compiled Queries, Bulk Operations

**Why.** Corpus: **0 hits** for compiled queries. Bulk operations appear 10 times
but never as `ExecuteUpdateAsync`/`ExecuteDeleteAsync` guidance. Both are the two
highest-leverage EF Core performance levers after fixing N+1, and the skill that
should own them does not mention them.

**Merge.** Two subsections in an existing skill.

**Priority:** P1 · **Effort:** ~45m

### ✅ A5 — OWASP Top 10 mapping → merge into `compliance-audit`

**Covers:** OWASP Top 10, Security Checklists

**Why.** Corpus: **2 hits** for OWASP, against 33 for secrets and 9 for JWT. The
*substance* is thoroughly covered by `04-security-guard` and `security-auditor`.
What is missing is the **mapping** — an auditor or a SAMA reviewer asks "show me
your OWASP coverage", and the honest answer today is a manual walk through three
files.

**Merge into `compliance-audit`**, which is already the "prove it to an external
framework" skill. Creating a separate OWASP document would duplicate the controls.

**Priority:** P1 · **Effort:** ~1h

### ✅ A6 — Blue-green → merge into `release-safety`

**Covers:** Blue-Green Deployment

**Why.** Corpus: **0 hits**. `release-safety` covers canary and rings thoroughly
but omits the one strategy that is often correct for a stateful .NET service
where per-user flagging is impractical.

**Merge.** One row in an existing table plus a short subsection on when
blue-green beats rings — and the database constraint that usually decides it.

**Priority:** P2 · **Effort:** ~30m

### ✅ A7 — Saga, inbox, DLQ → merge into `dotnet-messaging-gen`

**Covers:** Saga, Inbox, Dead Letter Queues, Distributed Transactions, Eventual Consistency

**Why.** Outbox is covered exhaustively (47 hits). Its counterparts are not:
**inbox 0**, **dead letter 2**, **eventual consistency 1**, **saga 7 (shallow)**.
Outbox without inbox gives you at-least-once delivery and no dedupe on the
consumer — which in a payments context means duplicate processing. That is a
correctness gap in an existing skill, not a new topic.

**Merge.** The skill already owns the messaging patterns; it is incomplete.

**Priority:** P1 · **Effort:** ~1.5h

---

## 2. Rejected enhancements

### ❌ The Design Patterns catalogue (16 items)

Repository · Specification · Mediator · Strategy · Factory · Builder · Observer ·
Adapter · Facade · Proxy · Decorator · State · Command · Composite ·
Template Method · Chain of Responsibility

**Why not.** This is textbook content, freely available and better written
elsewhere. More importantly, it competes with something strictly better that
already exists: **`pattern-finder` finds the actual implementation of the pattern
in *your* repository.** "Here is how this codebase writes a repository, at
`src/Co.Infrastructure/BrokerRepository.cs:34`" beats a generic GoF description
for every purpose an agent or a new joiner has.

Sixteen new skill descriptions would also cost ~1,600 tokens of always-on context
and create sixteen near-duplicate routing targets.

**Belongs elsewhere:** if a pattern is genuinely a house convention, one paragraph
in `memory-bank/backendConventions.md`. Not a document each.

### ❌ Technology explainers

RabbitMQ · Kafka · Azure Service Bus · MassTransit · NServiceBus · Hangfire ·
Quartz · Docker · Docker Compose · Kubernetes · Helm · Terraform · GitHub Actions ·
Azure DevOps · Prometheus · Grafana · Jaeger · Application Insights · Redis

**Why not.** Vendor documentation, maintained by people paid to maintain it, and
your copy is worse the day you write it and wrong within a year. Nineteen
documents that will be stale by the next major version.

**What is actually needed** — *which* of these this project uses and how it is
configured here — belongs in `memory-bank/technologyStack.md` and
`deploymentNotes.md`, which already exist and are read by every generator. That
is one line each, not a document each.

### ❌ Event Sourcing

**Why not.** Corpus: 0 hits, correctly. Event sourcing is a high-complexity,
high-regret architecture that is wrong for the large majority of systems that
adopt it. A skill that makes it *easier* to start is an active hazard — it lowers
the cost of the decision without lowering the cost of living with it.

If the team genuinely needs it, they need an architect and a spike, not a
generator.

### ❌ Sharding · Partitioning

**Why not.** Both are answers to a scale problem this platform's target codebases
do not have, and both are expensive to reverse. Premature partitioning is a
well-known way to make a system slower and much harder to change. If the data
volume ever justifies it, `db-auditor` plus a real DBA is the path — not a
scaffold.

**Revisit when** a `/dotnet-query-optimizer` finding is genuinely
partition-shaped and the table is above ~100M rows.

### ❌ Prompt Engineering · Prompt Library · AI Coding Standards · Review Prompts · Refactoring Prompts · Documentation Prompts · AI Workflow

**Why not.** **The skill library *is* the prompt library.** `AGENTS.md` and
`CLAUDE.md` *are* the AI coding standards. `code-review-assistant` *is* the review
prompt. `refactor-apply` *is* the refactoring prompt. `onboarding-doc-gen` *is*
the documentation prompt.

A second, prose copy of the same instructions is the worst possible outcome here:
it will drift from the executable version, and when the two disagree nobody will
know which one the agent actually followed.

### ❌ Knowledge Graph · Search Optimization · AI Retrieval Optimization

**Why not.** These solve a retrieval problem this repository does not have. The
retrieval layer already exists and is deliberate: `skill-catalog.md` for the
human, `_descriptions.json` + frontmatter for the agent, `feature-map.json` for
behavioural lookup, `repo-map.json` for structural.

Adding a knowledge graph would be a fourth index over the same content, with no
consumer.

**If retrieval ever does misfire**, the fix is description quality in
`_descriptions.json` — which is documented in `HANDBOOK.md` § 14 — not a new
indexing layer.

### ❌ Spell Checking · Automatic TOC

**Why not.** Spell-checking a corpus of C# identifiers, Arabic domain terms and
CLI flags produces a dictionary-maintenance chore with a poor signal ratio.
Auto-TOC is solved by every markdown renderer including GitHub's.

### ❌ Diagram Validation

**Why not.** Mermaid syntax errors fail visibly at render time. A validator adds
CI time to catch something that cannot ship silently.

---

## 3. Merged enhancements

Everything below is **already covered**. Listed so nobody proposes it again, with
where the substance lives.

| Proposed | Already lives in |
|---|---|
| **C4, Context/Container/Component/Deployment, Sequence, Data Flow, Dependency Graph** | `architecture-map-gen` — generates all of these *from the real codebase*, labelled with your own layer names. A hand-drawn diagram is stale on commit; a generated one is not. |
| **Request Lifecycle** | `feature-trace` — traces the actual request path end to end, which is the same artifact but true |
| **Naming Conventions, Folder Structure** | `memory-bank/codingStandards.md` (team-authored) + `templates/dotnet/.editorconfig` (enforced at compile time) |
| **Clean Code Checklist** | `dotnet-clean-code-guard`, `react-clean-code-guard` |
| **PR Checklist, Code Review Checklist** | `speckit-checklist` (pre-commit gate), `code-review-assistant` (diff vs spec) |
| **SQL Optimization, EF Core Performance, Query Optimization** | `dotnet-query-optimizer`, `db-auditor` |
| **Benchmarking** | `dotnet-perf-profile` (BenchmarkDotNet scaffold) |
| **Memory Cache, Redis, Distributed Cache, Cache-Aside, Write-Through, Write-Behind, Cache Invalidation** | `dotnet-caching-gen` — including the invalidation strategy, which is the part everyone omits |
| **JWT Security, Secret Management, Encryption, API Security** | `04-security-guard`, `security-auditor`, `guard-write.mjs` (blocks hardcoded credentials at write time) |
| **Versioning, Pagination, Filtering, Sorting, Searching, ProblemDetails, API Design Guidelines** | `memory-bank/apiConventions.md` + `dotnet-endpoint-gen` + `api-consistency-audit` |
| **Idempotency** | `dotnet-background-job-gen`, `production-readiness-review`, `dotnet-messaging-gen` |
| **Migration Strategy, Rollback Strategy** | `dotnet-migration`, `release-safety` (expand→migrate→contract), `db-auditor` |
| **Audit Trail** | `07-audit-trail-guard` + `ConventionTests.Auditable_Entities_Capture_Who_And_When` — enforced at compile time, not described |
| **Backup Strategy, High Availability** | `production-readiness-review` dimension 7 |
| **CQRS, Domain Events, Integration Events** | `02-dotnet-architecture-guard`, `memory-bank/backendConventions.md`, `dotnet-messaging-gen` |
| **Delivery Guarantees, Retry Strategies** | `dotnet-messaging-gen` |
| **Worker Services, Scheduling** | `dotnet-background-job-gen` |
| **Logging, Metrics, Tracing, OpenTelemetry, Correlation IDs, Health Checks** | `dotnet-observability-gen` (instrumentation) + `operability-gen` (what to alert on and what to do) |
| **CI/CD, Infrastructure as Code** | `templates/ci/quality-gates.yml`, `dotnet-iac-gen`, `devops-audit` |
| **Feature Flags** | `release-safety` + `flag-debt.mjs` (expired flags fail CI) |
| **Canary Deployment** | `release-safety` |
| **Unit, Integration, Component Testing** | `dotnet-test-gen`, `react-test-gen`, `memory-bank/testingStandards.md` |
| **Mutation Testing** | `templates/mutation/` + `task-verify --mutate` |
| **Architecture Testing** | `templates/dotnet/ArchitectureTests/` (NetArchTest) |
| **Entities, Value Objects, Aggregates, Bounded Contexts, Domain Services** | `02-dotnet-architecture-guard` + `ConventionTests` + `memory-bank/architecture.md`. Enforced, not described. |
| **Ubiquitous Language** | `memory-bank/glossary.md` — and `feature-trace` is required to use the team's terms from it |
| **ADR Templates, Decision History, Alternatives, Consequences** | `speckit-adr` + `memory-bank/decisionLog.md` |
| **Cross References, Internal Linking, Index Pages** | `START-HERE.md`, `skill-catalog.md`, `skill-graph.md`, `HANDBOOK.md` — and now enforced by `docs-lint.mjs` (A1) |
| **Mermaid Diagrams** | Already used in `architecture-map-gen` and `threat-model` |
| **Glossary** | `memory-bank/glossary.md` |
| **Documentation Coverage** | `docs-guard` + `docs-lint.mjs` (A1) |

---

## 4. Missing enhancements — genuine gaps the proposal did not include

Found while reviewing. Not implemented now; recorded so they are not lost.

| Gap | Why it matters | Verdict |
|---|---|---|
| **Consumer-driven contract testing** | Corpus: **0 hits** for Pact / consumer-driven. In a multi-service estate, `api-consistency-audit` checks shape but nothing verifies a consumer's actual expectations. Integration tests catch this only if both sides are in one repo. | 🟡 Valuable — P2, ~4h. Only worth it once there are ≥2 independently deployed services. |
| **Soft delete as a stated convention** | Corpus: **0 hits.** Not a skill — a *decision* with wide blast radius (every query needs a filter; a missed filter is a data-leak class bug). | 🟡 Belongs in `memory-bank/databaseConventions.md` as a team decision, plus a `db-auditor` check that global query filters are applied. P2, ~1h. |
| **Backup restore drill** | `production-readiness-review` asks "has a restore been tested?" and nothing helps you do it. An untested backup is a belief. | 🟠 Infra-ops, not code generation. Best as a runbook produced by `operability-gen`. P3. |
| **PII / data-classification map** | `compliance-audit` touches retention; nothing inventories *what personal data exists and where it lands*. SAMA-relevant. | 🟡 P2, ~3h. Fits as a mode of `feature-inventory`. |
| **SBOM / supply-chain provenance** | `dotnet-dependency-audit` covers vulnerabilities; nothing produces an SBOM or verifies build provenance. | 🟠 P3 — matters when a customer or regulator asks. |
| **Skill-count discipline** | 97 skills ≈ 9k tokens of always-on context, and routing accuracy degrades with near-duplicate descriptions. The proposal would have made this dramatically worse. | ✅ Already flagged in `HANDBOOK.md` § 14 and `DUAL-AGENT-SETUP.md`. Run `/skill-maturity-audit all` before adding anything. |

---

## 5. Structure — no change recommended

The proposal implies a topic-tree restructure (`architecture/`, `caching/`,
`security/`…). **Do not do this.**

The current structure is organised by **who consumes it**, which is the axis that
matters when two very different consumers share one repository:

```
.cursor/skills/     the agent executes      (76)
.cursor/rules/      the agent is constrained by  (11)
.cursor/tools/      CI and the agent verify with (5→6)
.cursor/docs/       humans navigate with
memory-bank/        both read for project truth  (24)
templates/          the target app repo installs
.claude/            Claude Code discovers through
```

A topic tree would cut across all six and force every artifact to choose between
its consumer and its subject. `dotnet-caching-gen` is a skill first and a caching
document never.

**One small cleanup, unrelated to the proposal:** `cursor.rar`,
`cursor-updated.rar` and `.cursor/settings.local.json.bak-20260725` are dead
weight in the root. Delete them.

---

## 6. Final prioritized roadmap

| # | Item | Type | Priority | Effort | Status |
|---|---|---|---|---|---|
| 1 | `docs-lint.mjs` + CI gate | New tool | P0 | 2h | **implemented** |
| 2 | `load-test-gen` | New skill | P0 | 3h | **implemented** |
| 3 | Saga / inbox / DLQ → `dotnet-messaging-gen` | Merge | P1 | 1.5h | **implemented** |
| 4 | Distributed locks → `dotnet-background-job-gen` | Merge | P1 | 45m | **implemented** |
| 5 | Compiled queries + bulk ops → `dotnet-query-optimizer` | Merge | P1 | 45m | **implemented** |
| 6 | OWASP mapping → `compliance-audit` | Merge | P1 | 1h | **implemented** |
| 7 | Blue-green → `release-safety` | Merge | P2 | 30m | **implemented** |
| 8 | Soft-delete convention + `db-auditor` check | Merge | P2 | 1h | deferred |
| 9 | PII / data-classification map | `feature-inventory` mode | P2 | 3h | deferred |
| 10 | Consumer-driven contract testing | New skill | P2 | 4h | deferred — needs ≥2 services |
| 11 | Backup restore drill runbook | `operability-gen` mode | P3 | 2h | deferred |
| 12 | SBOM / provenance | `dotnet-dependency-audit` mode | P3 | 2h | deferred |

**Total approved and built: ~10 hours of work, 2 new files.**
**Rejected: ~130 proposed documents, roughly 6 months of writing that would have
made the platform worse.**

---

## Reviewer's note

The instinct behind this proposal — *cover everything a senior engineer needs* —
is right. The mechanism is wrong for this repository.

Coverage here is not measured in documents. It is measured in **artifacts that
act**: a rule that refuses to generate the wrong thing, a hook that blocks the
write, a validator that fails the build. `07-audit-trail-guard` plus
`Money_Properties_Use_Decimal` in `ConventionTests.cs` gives you more real audit-
trail coverage than any document about audit trails ever will, because it is
impossible to merge code that violates it.

The right question for the next proposal is not *"is this topic important?"* —
almost everything on the list was. It is:

> **What executable artifact would make this impossible to get wrong,
> and does one already exist?**

If one exists, improve it. If none can exist, ask whether a document would
actually be read. Most of the time the honest answer is no.
