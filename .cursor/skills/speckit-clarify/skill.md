# Skill: speckit-clarify

**Invocation:** `/speckit-clarify`

---

## Overview

**Memory references:** `memory-bank/businessRules.md, memory-bank/glossary.md`

`speckit-clarify` converts the Open Questions list from `speckit-analyze` into
a structured Q&A record where every question is presented as 2-4 labeled options
with trade-offs and a clear recommendation — never an open blank. It enforces
the elicitation protocol defined in `.cursor/rules/05-planning-rigor.mdc`,
scaling question count to feature complexity. By the time this skill completes,
every consequential decision for the feature is documented with the reasoning
behind the chosen option, producing a traceable record that survives long after
the original conversation is forgotten. This is the primary gate before
`speckit-constitution` and `speckit-plan` can run.

---

## Steps

**Step 1 — Load context.**

Read:
- The analysis document produced by `speckit-analyze` (inline or from the terminal)
- `memory-bank/systemPatterns.md` — to inform recommendations (prefer patterns already in use)
- `memory-bank/techContext.md` — to tie recommendations to real stack constraints

**Step 2 — Determine required question count.**

| Feature scope | Minimum |
|---------------|---------|
| Small, ≤ 3 files, no auth/payments | 5 |
| Standard full-stack feature | 10 |
| Touches auth, payments, migrations, cross-service | 10 |
| Breaking API change or multi-service | 12 |

Open Questions from the analysis are the starting point, but the agent must
expand or split any compound question before presenting.

**Step 3 — Present questions using the mandatory options format.**

Present questions **one at a time** — wait for the user to answer each before
showing the next. Record each answer before proceeding.

Required format per question (from `05-planning-rigor.mdc`):

```
Q[n]: [The decision to be made]

Option A — [Label]:
  [1-2 sentences describing what this means in practice]
  Trade-off: [gain | cost]

Option B — [Label]:
  [description]
  Trade-off: [gain | cost]

Option C — [Label]:
  [description]
  Trade-off: [gain | cost]

Recommended: Option [X] — [one-sentence reasoning tied to systemPatterns.md or techContext.md]

(You can also describe your own approach.)
```

**For .NET features, questions must cover:**
- Authentication/authorization requirements (roles, policies, claims)
- Breaking vs. additive API contract change
- Performance requirements (expected RPS, latency SLA)
- Database migration required? (additive / destructive / backfill)
- Integration events emitted to other services?
- Rollback strategy for failed deployment

**For React features, questions must cover:**
- Target user flow step by step
- New API endpoints needed or existing?
- Loading, empty, and error states for every async UI element
- Feature flag required?
- Devices/viewports to support
- Accessibility requirements (WCAG level, screen reader, keyboard nav)

**For full-stack features:** ask all of the above.

**Step 4 — Produce the decisions recap.**

After all questions are answered, output the recap table and wait for
explicit confirmation before the pipeline advances.

```markdown
## Decisions Recap — [Feature Name]

| # | Question | Chosen Option | Label |
|---|----------|---------------|-------|
| Q1 | ... | Option B | Cookie-based session |
| Q2 | ... | Option A | Additive migration |
...

**Ready to advance to:** `/speckit-constitution`

Please confirm ("yes" / "go ahead") or correct any decision above.
```

**Step 5 — Save the clarification record.**

After confirmation, write `specs/clarifications/[feature-slug].md` with the
complete Q&A — including options that were presented and which was chosen,
plus the user's free-text reasoning where provided.

---

## Example Invocation

**Context:** `/speckit-analyze` has been run for "broker-client-csv-export".
Agent has 7 open questions. User confirmed this is a full-stack feature.

```
Q1: Scope of the export — which clients should be included?

Option A — All clients for the broker:
  Export includes every client record the authenticated broker owns, ignoring
  any active filter state in the UI.
  Trade-off: Simple to implement | May produce very large files

Option B — Filtered clients (match current UI filter state):
  Export honours the same server-side filter params as the current list view.
  Trade-off: Precise, users get what they see | Filter state must be serialised
  and passed to the export endpoint

Option C — User-selectable (checkboxes in the UI):
  Brokers check individual clients before clicking Export.
  Trade-off: Most flexible | Significant extra UI work (select-all, pagination)

Recommended: Option B — Exporting the filtered view is consistent with how
every other data export in the system works (see systemPatterns.md §DataExport).

> User replies: "Option B"

Q2: Export generation strategy — synchronous or asynchronous?
...
```

---

## Output

- Terminal: one question at a time, blocking until answered
- Terminal: decisions recap table before advancing
- File: `specs/clarifications/[feature-slug].md` (saved after confirmation)
