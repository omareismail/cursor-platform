---
name: feature-pipeline
description: "feature-pipeline walks the approved story map feature by feature in dependency order, running the full speckit chain on each one and stopping at every point where a human decision is required. It is the phase 4 orchestrator: it does not generate anything itself, it decides *which* feature is next and refuses to start one whose dependencies are unfinished. Invoked as /feature-pipeline."
---

<!-- GENERATED from the cursor-platform source skill "feature-pipeline".
     Do not edit here - edit the source and re-run the plugin build. -->

# Skill: feature-pipeline

**Invocation:** `/feature-pipeline [story-id | next | status]`

---

## Overview

`feature-pipeline` walks the approved story map feature by feature in dependency
order, running the full speckit chain on each one and stopping at every point
where a human decision is required. It is the phase 4 orchestrator: it does not
generate anything itself, it decides *which* feature is next and refuses to start
one whose dependencies are unfinished. Without it, phase 4 is a person
remembering which of forty stories is done, which is how features get built twice
and how the one story everything else depends on gets built last.

---

## Steps

**Step 1 — Check the gate.**

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/lifecycle.mjs status
```

If the DESIGN row is anything other than `APPROVED`, `INHERITED` or
`INHERITED_UNVERIFIED`, stop. A
`STALE` there means the design changed after it was approved — the features you
are about to build were planned against a document that no longer says what it
said.
`guard-phase.mjs` will block every source write anyway; say so plainly rather
than letting the user watch a hook fire. The fix is `/lifecycle-gate DESIGN`,
not an override.

**Step 2 — Build the dependency order, once.**

Derive it from the story map and the domain model:

- A story writing an aggregate comes before any story reading it
- Auth and identity come before anything they protect
- Shared reference data comes before anything that references it
- Within a story, layer order is fixed: Domain, Application, Infrastructure,
  API, React

Record it in `memory-bank/progress.md` so it survives the session.

**Step 3 — Route on the argument.**

| Argument | Do |
|---|---|
| `status` | Report done / in progress / blocked / not started, and what is next. Stop. |
| `next` | Pick the first story whose dependencies are all Done. |
| a story ID | Verify its dependencies are Done. If not, name them and stop. |

**Step 4 — Definition of Ready. Refuse an unready story.**

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/artifact-schema.mjs ready <STORY-ID>
```

It answers, from the traceability graph, whether the story has a requirement,
acceptance criteria, a use case, the rules that constrain it, an endpoint, and
the project-level design work it depends on. A `~` on UI is a warning, not a
failure: not every story has a screen, but confirm this one is genuinely
backend-only rather than a screen nobody designed.

**A NOT READY story does not enter the chain.** Report exactly which line failed
and offer to fix it upstream — a missing use case is `/use-case-gen`, missing
acceptance criteria are `/user-story-map`, a missing endpoint is
`/api-contract-design`. A story that enters development half-specified costs a
rewrite; one that fails here costs a paragraph.

Two items the tool cannot compute, so check them yourself and say you did:

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/task-graph.mjs graph    specs/plans/<slug>-plan.md   # what must land first
node ${CLAUDE_PLUGIN_ROOT}/tools/task-graph.mjs validate specs/plans/<slug>-plan.md   # no task over 8 files
```

The plan does not exist yet at this point for a new story — run these after
`/speckit-plan` and before `/speckit-implement`.

**Step 5 — Run the chain for one story. One story only.**

Never batch. The chain is `01-specify-rules.mdc`'s and it is sequential:

```
/speckit-analyze     <- the story and its acceptance criteria
/speckit-clarify     <- Category E: announce, then WAIT
/speckit-constitution
/speckit-plan        <- WAIT for the variant and slicing choice
/speckit-specify
node ${CLAUDE_PLUGIN_ROOT}/tools/task-graph.mjs validate specs/plans/<slug>-plan.md
/speckit-implement <TASK-ID>   <- one task at a time
/task-verify
/speckit-checklist
```

Two rules that are easy to lose in the middle of a long run: never present a
board that failed `task-graph validate`, and a task moves to Done only on a DONE
verdict from `/task-verify` — never from a green suite alone, because when one
agent wrote both the code and the tests, green proves they agree, not that either
is right.

**Step 6 — Carry the design forward into every feature.**

Before `/speckit-constitution`, re-read the design decisions this story inherits:
its endpoints from `api-design.md`, its tables from `database-design.md`, its
screens from `screen-inventory.md`. A feature that quietly re-decides something
phase 3 settled is spec drift arriving at the source, and `/spec-drift-audit`
will find it at Gate 4 when it is expensive.

**Step 7 — Record and report.**

Update `memory-bank/progress.md` and `activeContext.md`. Report the story just
finished, what is unblocked by it, and the next story — then stop. Do not start
the next one; the user decides when to continue.

---

## Output

- One completed feature per invocation, spec through checklist
- `memory-bank/progress.md` and `activeContext.md` updated
- Terminal: the dependency order, what is blocked, and what is next

