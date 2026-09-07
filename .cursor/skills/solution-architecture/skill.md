# Skill: solution-architecture

**Invocation:** `/solution-architecture`

---

## Overview

**Memory references:** `memory-bank/architecture.md, memory-bank/technologyStack.md, memory-bank/systemPatterns.md`

`solution-architecture` chooses the product's architecture from at least two
fully-costed variants and records why the winner won, then traces every
non-functional requirement to the design element that delivers it. It is the
product-level counterpart to `speckit-constitution`, which settles the technical
contract for one feature: this settles the one every feature will inherit.
Its output is promoted into `memory-bank/architecture.md` at Gate 3, which is
what makes it binding — once the layering is there, `02-dotnet-architecture-guard`
enforces it on every `.cs` file for the life of the project.

---

## Steps

**Step 1 — Read everything phase 2 produced.**

`docs/analysis/domain-model.md`, `use-cases.md`, `workflows.md`, `risks.md`,
plus `docs/product/nfr.md`. Note especially the risks marked "retire in Phase 3"
— this skill is where they are answered.

**Step 2 — Produce at least two genuine variants.**

`05-planning-rigor.mdc` is binding and this is the most consequential decision in
the project. Use `/speckit-options`. The variants must be genuinely different —
modular monolith vs services, one database vs read/write split, synchronous vs
event-driven — not the same shape with different names.

For each: what it means in practice, the trade-off matrix, and the specific NFR
it serves better than the others.

**Step 3 — Wait for the choice. Do not pick.**

The user chooses. Record the choice, the date, and the reason, and note what
would have to change for the losing option to become right — that sentence is
what makes the decision revisitable in two years instead of mysterious.

**Step 4 — Trace every NFR to a mechanism.**

| NFR | Target | Delivered by | Verified in phase 5 by |
|---|---|---|---|
| NFR-03 P99 < 500ms on quote | 500ms | Redis cache on rating tables + covering index on VehicleId | `/load-test-gen` threshold |

An NFR with no mechanism is an NFR that will not be met. This table is checked
at Gate 3 criterion 8.

**Step 5 — Answer the phase 3 risks.**

For each risk from `risks.md` marked "retire in Phase 3", state the design
decision that retires it, or move it to a later phase with a reason.

**Step 6 — Draw the architecture.**

C4 context and container levels as Mermaid, plus a component view for anything
non-obvious. Name the layers with this team's own names from
`memory-bank/architecture.md` if it is already populated —
`/architecture-map-gen` will later regenerate these from the code, and the labels
must match or the two diagrams will silently disagree.

**Step 7 — Decide the cross-cutting concerns explicitly.**

Authn/authz, transaction boundaries (from the aggregates), caching *and its
invalidation*, messaging and delivery guarantees, background jobs and their
idempotency, logging, tracing, metrics, configuration and secrets, and the
migration strategy for a live database.

A caching decision with no invalidation strategy is a future bug with a
performance improvement attached — the same rule `/dotnet-caching-gen` enforces
at generation time, applied here where it is cheaper.

**Step 8 — Write `docs/design/architecture.md`, and one ADR per fork.**

Use `/speckit-adr` for the ADRs in `docs/design/adr/`. Every consequential
decision gets one: context, options, decision, consequences.

**Step 9 — Prepare the promotion, do not perform it.**

Show the diff for `memory-bank/architecture.md` and `technologyStack.md`, get the
user's word, then apply with `CLAUDE_ALLOW_TIER2_EDIT=1`. This is the most
important promotion in the lifecycle: it is the moment the design becomes
enforceable rather than merely written.

---

## Front-matter — required on every document this skill writes

Open each file with this block. It is the machine-readable half of a
human-written document: the prose stays prose, and `artifact-schema.mjs` reads
this to know what the document is and where it sits in the chain.

```yaml
---
type: architecture
phase: DESIGN
defines: [ADR]
traces: [<repo-relative paths of the documents this was derived from>]
owner: solution-architect
---
```

`defines` names the ID prefixes this document **owns**. It is what stops the
first cell of a traceability table being mistaken for a second definition — a
citation of `S-1` in a use-case table is a reference, not a redeclaration.

Validate before reporting done:

```bash
node .cursor/tools/artifact-schema.mjs validate
node .cursor/tools/artifact-schema.mjs check
```

`check` fails on an ID cited but never defined, and on a chain that stops — a
requirement no story implements, a story no use case covers, a use case no
endpoint serves. Those are gate criteria, computed rather than judged, and
`lifecycle.mjs check` now fails on them too.

---

## Output

- `docs/design/architecture.md`, `docs/design/adr/*.md`
- Proposed diffs for `memory-bank/architecture.md`, `technologyStack.md`
- Terminal: NFRs with no mechanism, phase 3 risks still unanswered
