# Skill: speckit-options

**Invocation:** `/speckit-options [decision topic]`

---

## Overview

`speckit-options` is the standalone decision-support skill that produces a
structured options-with-recommendation block for any architectural or
technology decision. It can be invoked directly by the user, or called
internally by `speckit-clarify`, `speckit-plan`, `speckit-constitution`, and
any .NET or React generation skill that hits an ambiguous fork (e.g. caching
tier, message bus choice, IaC tool, state management library). The core
principle is that the agent must never pick silently — every consequential
decision is surfaced as a set of labeled, trade-off-aware options with one
recommended path, and the user makes the final call. This implements the
elicitation protocol defined in `.cursor/rules/05-planning-rigor.mdc`.

---

## Steps

**Step 1 — Identify the decision and constraints.**

Read:
- `memory-bank/systemPatterns.md` — is there an established precedent for this type of decision?
- `memory-bank/techContext.md` — what is already in the stack that limits options?
- The active spec / constitution / plan — what context does this decision live in?

If a clear precedent exists in `systemPatterns.md`, flag it in the recommendation:
> "The project already uses [pattern X], so Option B aligns with the existing
> approach and avoids a mixed pattern."

**Step 2 — Generate 2-4 mutually exclusive options.**

Each option must be:
- Genuinely distinct from the others (not just minor variations)
- Practical given the project's tech context
- Described in 1-2 sentences of what it means in practice (not in the abstract)

**Step 3 — Score each option across standard trade-off dimensions.**

| Dimension | What it measures |
|-----------|-----------------|
| Complexity | Implementation effort and cognitive load for the team |
| Performance | Runtime performance characteristics |
| Cost | Infrastructure or license cost |
| Time to implement | Calendar time to production |
| Long-term maintainability | Ease of change 12+ months from now |
| Risk | Risk of failure or regression |

**Step 4 — Output the options block.**

```markdown
## Decision: [Topic]
**Context:** [one sentence on why this decision is needed now]
**Existing precedent:** [from systemPatterns.md, or "None — first time this pattern is used"]

### Option A — [Label]
[1-2 sentence description of what adopting this option means in practice]

| Dimension | Rating | Note |
|-----------|--------|------|
| Complexity | Low / Med / High | [why] |
| Performance | Low / Med / High | [why] |
| Cost | Low / Med / High | [why] |
| Time to implement | Low / Med / High | [why] |
| Maintainability | Low / Med / High | [why] |
| Risk | Low / Med / High | [why] |

### Option B — [Label]
[description]
[trade-off table]

### Option C — [Label] (if applicable)
[description]
[trade-off table]

### Recommendation: Option [X] — [Label]
[One-sentence rationale tying the recommendation to the project's context,
existing patterns, and stated constraints. If this deviates from systemPatterns.md,
flag it explicitly.]

_(You can also describe your own approach instead of A/B/C.)_
```

**Step 5 — Wait for selection.**

After presenting the options block, output:
> Please select an option (A / B / C) or describe your own approach.
> I will not proceed with any code or spec changes until a selection is made.

**Step 6 — Record the decision.**

Once the user selects an option, append the decision to:
- The active clarification file (if in `speckit-clarify`)
- The constitution file (if in `speckit-constitution`)
- The plan file (if in `speckit-plan`)
- Or `docs/adr/` directly (if invoked standalone for an architecturally significant decision)

---

## Example Invocation

**User runs:** `/speckit-options caching tier for product catalog queries`

**Agent outputs:**

```markdown
## Decision: Caching tier for product catalog read queries
**Context:** GetProductCatalogQuery is called ~500 times/minute; adding a
cache will reduce DB load and improve P99 latency.
**Existing precedent:** None — first time a cache is introduced in this project.

### Option A — In-process IMemoryCache
Stores cached data in the .NET process memory. Zero infrastructure cost.
Works well for single-instance deployments.

| Complexity | Low | Just DI registration + cache-aside code |
| Performance | Very high | Sub-millisecond reads (in-process) |
| Cost | Free | No additional infrastructure |
| Time to implement | 2 hours | |
| Maintainability | Med | Invalidation tricky in multi-instance; cache lost on redeploy |
| Risk | Low for single instance; High for scale-out | |

### Option B — Distributed Redis (via FusionCache + StackExchange.Redis)
Stores cached data in a Redis instance, shared across all app instances.
Survives redeploys, works with horizontal scaling.

| Complexity | Med | Redis infra required; FusionCache wraps Redis nicely |
| Performance | High | ~1ms network round-trip vs DB's 50ms |
| Cost | Med | Redis instance (~$15/mo on Azure Cache for Redis Basic) |
| Time to implement | 4 hours (incl. Redis setup) | |
| Maintainability | High | Clear invalidation API via FusionCache |
| Risk | Low | |

### Option C — ASP.NET Core Output Caching (response-level)
Caches full HTTP responses at the API layer. No code changes in Application layer.

| Complexity | Low | Attribute on endpoint only |
| Performance | Very high | Bypasses entire pipeline |
| Cost | Free | |
| Time to implement | 1 hour | |
| Maintainability | Low | Can't do fine-grained invalidation; bad for user-scoped data |
| Risk | Med | Easy to cache the wrong thing for the wrong user |

### Recommendation: Option B — Distributed Redis (FusionCache)
The product will be deployed to Azure Container Apps (from techContext.md),
meaning multiple instances will run during peak hours. Option A would serve
stale data across instances. Option C can't safely be used for per-broker
catalog variants. FusionCache with Redis provides a clean cache-aside API,
L1+L2 caching (memory + Redis), and explicit invalidation hooks.
```

---

## Output

- Terminal: options block (blocking — waits for selection before any code is written)
- After selection: decision appended to the active clarification / constitution / plan file
