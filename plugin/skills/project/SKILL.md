---
name: project
description: "Project Command Center CLI: init/scan identity, delivery phases, checkpoints, ideas, readiness and evidence-based recommendations. Canonical state is project/*.json; the dashboard is a projection. Use when asked where the project is, what is being delivered, what blocks a phase, or what happened to an idea. Invoked as /project."
---

<!-- GENERATED from the cursor-platform source skill "project".
     Do not edit here - edit the source and re-run the plugin build. -->

# Skill: project

**Invocation:** `/project` · `/project init` · `/project status` · `/project scan`

---

## Overview

`project` is the Project Command Center: identity, delivery phases (the
outcome being shipped), checkpoints, ideas, and deterministic recommendations.
It does **not** replace the six-phase product lifecycle. Lifecycle is the
engineering stage; delivery is the work package. Canonical state is
`project/*.json`, written only by `${CLAUDE_PLUGIN_ROOT}/tools/project.mjs`. The dashboard
is a projection.

Use when the user asks where the project is, what is being delivered, what
blocks a phase, what happened to an idea, or to initialise project intelligence
on a repo.

---

## Source of truth

| Question | Owner |
|---|---|
| Engineering stage / gates | `lifecycle/state.json` via `lifecycle.mjs` |
| Traced behaviour | `.cursor/cache/feature-map.json` |
| Requirements / stories / endpoints | id graph (`artifact-schema.mjs`) |
| Delivery phases, checkpoints, ideas | `project/` via this tool |
| Recommendations, graph, timeline, health | **Derived** on each read |

Never copy a feature, approval or ADR into `project/` — link by id.

---

## Steps

**Step 1 — Status**

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/project.mjs status --json
```

If `project/` is missing, offer init. Do not invent completion.

**Step 2 — Init (new or existing repo)**

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/project.mjs init --name "<product>"
node ${CLAUDE_PLUGIN_ROOT}/tools/project.mjs init --name "<product>" --existing
```

`--existing` sets every delivery phase to `NEEDS_REVIEW` and leaves the current
phase unknown. Select the actual phase with `delivery start PHASE-NNN`.
It does not mark checkpoints PASSED or infer production status.

Then scan:

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/project.mjs scan --json
```

Detection is `detected` / `confirmed` / `unknown`. Never a fake percentage.

**Step 3 — Mutations go through the CLI**

Delivery: `delivery list|show|start|complete|objective|catalog|phase`

Checkpoints: `checkpoint list|show|verify|pass|fail|waive` — `pass` on an
evidence-required checkpoint needs an existing repository file via `--evidence`
or a successful, non-skipped, current `verify`. Failed or stale evidence cannot pass.

Identity: `identity show|confirm --field F --value V|confirm --detection DET-id|reject --field F`

Trace: `trace ID` — every hop present or missing; idea VERIFIED does not
verify the bound feature. Tasks, code, tests, evidence, decisions and
release membership are labelled when linked.

Ideas: `idea add|list|show|evaluate|approve|reject|park|specify|implement|verify|release`
Implement may take `--task`, `--code` and `--test` refs.

Recommendations: `recommend list|show|accept|dismiss` (dismiss is a
disposition; the rule can still fire)

Roadmap: `roadmap show|add --idea ID --phase ID|milestone --title T --date D|feature --feature ID --phase ID`

Delivery cancel: `delivery cancel PHASE --reason "..."` — cancellation does
not satisfy dependents. `checkpoint waive` needs `--reason` and `--by`.

The dashboard never runs these. Compose and paste, same as lifecycle actions.

**Step 4 — UI**

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/dashboard.mjs serve
# or
node ${CLAUDE_PLUGIN_ROOT}/tools/project.mjs dashboard
```

---

## Output

- `project/project.json`, `delivery.json`, `ideas.json` — authored; written together through `project/.txn.json` when a command touches more than one file. Interrupted writes complete on the next command.
- JSON snapshots for the dashboard (`snapshot --json`)
- `trace ID` and `check` for missing hops and dangling canonical refs
- Risks from `docs/analysis/risks.md` (not incidents)
- No writes to `lifecycle/state.json` or feature-map

