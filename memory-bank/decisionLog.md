# Decision Log
**Last Updated:** [YYYY-MM-DD]
**Owner:** `speckit-adr` writes new entries; nothing here is auto-regenerated or deleted.

Format: one ADR per decision — what was decided, what alternatives were considered,
why this one won, and what would make us revisit it.

---
## ADR-001 — [Title]
**Date:** [date] | **Status:** Accepted
**Context:** [the problem/tension forcing a decision]
**Decision:** [what was chosen]
**Alternatives considered:** [option] — rejected because [reason]
**Revisit if:** [the condition that would invalidate this decision]

---
> EXAMPLE:
> ## ADR-003 — Vertical Slice over Clean Architecture for feature organization
> **Date:** 2026-02 | **Status:** Accepted
> **Context:** 40+ planned features; Clean Architecture's cross-cutting Application/
> folder was becoming a navigation bottleneck — finding "everything about policy
> renewal" meant jumping between 5 folders.
> **Decision:** Vertical Slice — each feature owns its command/query/handler/validator
> in one folder; Domain layer stays shared underneath.
> **Alternatives considered:** Staying with Clean Architecture and accepting the
> navigation cost — rejected, team velocity feedback was consistently negative.
> **Revisit if:** team grows past ~15 engineers and cross-feature consistency
> becomes harder to enforce without the forced separation.
