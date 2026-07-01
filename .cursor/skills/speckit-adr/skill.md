# Skill: speckit-adr

**Invocation:** `/speckit-adr [decision-slug]`

---

## Overview

**Memory references:** `memory-bank/decisionLog.md`

`speckit-adr` generates a lightweight Architecture Decision Record (ADR) after
a significant technical decision has been finalized — typically right after
`speckit-options` resolves or `speckit-constitution` locks in a pattern. ADRs
ensure that the reasoning behind decisions survives after `memory-bank/activeContext.md`
rotates to the next feature. A new developer six months from now can read why
Redis was chosen over in-process caching, why the outbox pattern was adopted,
or why a particular API versioning strategy was selected — without having to
reconstruct it from commit history. ADRs are numbered sequentially and linked
from the feature spec that introduced them.

---

## Steps

**Step 1 — Read existing ADRs.**

Scan `docs/adr/` for existing ADR files to determine the next sequential number.
If `docs/adr/` does not exist, create it.

**Step 2 — Pull the decision details.**

Read from:
- The clarification file: what options were presented, which was chosen, the reasoning
- The constitution file: technical details of the chosen approach
- `memory-bank/systemPatterns.md`: whether this is a new pattern or extension of an existing one

**Step 3 — Write the ADR using the standard template.**

```markdown
# ADR-[NNNN]: [Decision Title]

**Status:** Accepted
**Date:** [YYYY-MM-DD]
**Deciders:** [team members involved, or "not specified"]
**Feature context:** specs/features/[feature-slug].md

---

## Context

[2-4 sentences describing the problem that forced this decision.
What were the technical constraints? What were the business constraints?
Why is this a decision worth recording?]

## Decision

[What was decided. Be specific — name the exact technology, pattern, or
approach. "We will use FusionCache with Redis for distributed caching" not
"we chose caching option B".]

## Consequences

**Positive:**
- [benefit 1]
- [benefit 2]

**Negative / trade-offs accepted:**
- [cost 1]
- [cost 2]

**Neutral / watch points:**
- [thing to monitor — e.g. "Redis availability becomes a hard dependency; monitor uptime"]

## Alternatives Considered

### Option A — [Label] (Rejected)
[One sentence on what it was and why it was rejected]

### Option C — [Label] (Rejected / Deferred)
[One sentence on what it was and why it was rejected or deferred to a later decision]

## Links

- Clarification record: specs/clarifications/[feature-slug].md
- Feature spec: specs/features/[feature-slug].md
- Supersedes: ADR-[NNNN] (if this replaces an earlier decision, or "N/A")
- Superseded by: (leave blank — filled in if/when this ADR is reversed)
```

**Step 4 — Link the ADR from the feature spec.**

Append to `specs/features/[feature-slug].md` under a `## Architecture Decisions` section:
```markdown
## Architecture Decisions
- [ADR-0005: Distributed caching with FusionCache + Redis](docs/adr/0005-distributed-caching-fusioncache-redis.md)
```

**Step 5 — Propose an update to systemPatterns.md.**

If this ADR establishes a new pattern the project will use going forward, output
a proposed diff for `memory-bank/systemPatterns.md`. Never auto-apply — present
for human approval.

```
Proposed addition to memory-bank/systemPatterns.md:

+## Caching Pattern
+**Tier:** Distributed Redis via FusionCache (IFusionCache)
+**Registration:** Added in Infrastructure DI module
+**Invalidation:** Command handlers that mutate cached data call IFusionCache.RemoveAsync(key)
+**Key format:** "{resource}:{id}" (e.g. "catalog:product:abc123")
+**ADR:** docs/adr/0005-distributed-caching-fusioncache-redis.md

Apply this to systemPatterns.md? (yes / no)
```

---

## Example Invocation

**Command:** `/speckit-adr distributed-caching-fusioncache-redis`

**Context:** The caching tier decision was just resolved via `/speckit-options`
during `speckit-constitution` for the product catalog feature.

Agent scans `docs/adr/` → finds ADRs 0001-0004 → assigns number 0005.
Writes `docs/adr/0005-distributed-caching-fusioncache-redis.md`.
Appends link to `specs/features/product-catalog-search.md`.
Proposes `systemPatterns.md` update for human approval.

---

## Output

- File: `docs/adr/[NNNN]-[decision-slug].md`
- Edit: `specs/features/[feature-slug].md` (adds `## Architecture Decisions` link)
- Terminal: proposed `systemPatterns.md` diff (awaits human approval before applying)
