# The product lifecycle

`01-specify-rules.mdc` gates one **feature**. This gates the whole **product**.

The two are nested, not competing. Phases 4 and 5 are a loop that runs once per
feature; phases 1-3 and 6 run once per product.

```
PRODUCT LIFECYCLE                                          once per product
  1 REQUIREMENTS -> 2 ANALYSIS -> 3 DESIGN -> 4 DEV <-> 5 TEST -> 6 PRODUCTION
       gate            gate         GATE        gate      gate       gate
                                     ^                |
                    the only one with a hook          |
                    behind it                         |
                                                      v
FEATURE PIPELINE (01-specify-rules.mdc)          once per feature
  analyze -> clarify -> constitution -> plan -> specify -> implement
          -> checklist -> commit
```

A failing test does **not** roll the product back to development. The lifecycle
stays in `TESTING`; the work moves between 4 and 5 freely.

---

## The state file

`lifecycle/state.json` is the single answer to "which phase are we in". It is
machine-owned — `guard-write.mjs` blocks hand-edits, because editing it by hand
lets a phase be marked approved without its artifacts existing.

```bash
node .cursor/tools/lifecycle.mjs status              # where are we
node .cursor/tools/lifecycle.mjs check [PHASE]       # do the artifacts exist
node .cursor/tools/lifecycle.mjs approve PHASE --by "name"
node .cursor/tools/lifecycle.mjs advance
node .cursor/tools/lifecycle.mjs rollback PHASE --reason "..."
```

The `SessionStart` hook injects the current phase automatically. A repo with no
`state.json` never adopted the lifecycle — that is a valid configuration, and
every part of this layer is inert there.

---

## Three consents per gate

A gate passes when all three agree. No one of them is sufficient.

| Consent | Recorded by | What it proves |
|---|---|---|
| Mechanical | `approve`, recomputed live | The required artifacts exist and are not still templates. Milliseconds. Cannot be argued with. |
| Judgement | `/lifecycle-gate` → `record-gate` | They are worth building on, against the criteria in `.cursor/lifecycle/gates/`. Needs reading them. |
| Human | `approve --by "name"` | Someone is accountable for the decision. |

`approve` refuses unless all three are present, the phase is the current one, and
the previous phase is cleared. A gate a machine can clear alone is not a gate.

The mechanical consent is **recomputed at approve time**, never read from an
earlier `check` — a passing check from an hour ago says nothing about now.

It covers more than presence. `lifecycle.mjs check` also runs the traceability
graph over the lifecycle documents, so a requirement no story implements, a story
no use case covers, or an id cited but never defined fails the mechanical consent
outright. Those were written as gate criteria for a reviewer to judge; they are
computable, and a computable criterion belongs where it cannot be argued with.

```bash
node .cursor/tools/artifact-schema.mjs check   # the full picture
node .cursor/tools/artifact-schema.mjs trace S-07
```

## Status Is Derived, Not Stored

The state file records evidence. The status is computed from it on every read,
because a stored `STALE` would itself need a flag saying whether it was still
true.

| Status | Means |
|---|---|
| `NOT_STARTED` / `IN_PROGRESS` | no approval yet |
| `APPROVED` | all three consents, all still valid |
| `INHERITED` | brownfield; done informally before the lifecycle was adopted |
| `STALE` | **was** approved; something it was approved against changed |
| `BLOCKED` | an earlier phase is not cleared |

Approval hashes every required artifact and stamps the gate definition's own
version. So:

```
DESIGN approved  ->  someone edits docs/design/api-design.md
                 ->  DESIGN is STALE on the next command
                 ->  guard-phase.mjs blocks src/ writes again
                 ->  later phases read BLOCKED
```

No sweeper, no cache, nothing to invalidate. Revert the edit and the hash matches
again and the phase is `APPROVED` — the evidence was never thrown away.

## Overrides, Not `--force`

There is no force flag. A bypass is a record:

```bash
node .cursor/tools/lifecycle.mjs override DESIGN \
  --reason "client demo Sunday" --risk HIGH --by "Ezzdeen" --expires 3
```

It has an id, an owner, a risk level, a list of exactly what it bypassed, and an
expiry of at most 90 days. When it lapses the phase goes `STALE` on its own, and
CI fails on an expired one. A permanent override is a deleted gate.

---

## Phases

| # | Phase | Owner | Produces | Gate |
|---|---|---|---|---|
| 1 | Requirements | `product-manager` | `docs/product/` — brief, personas, prd, nfr, scope, story-map | [01](../lifecycle/gates/01-requirements.gate.md) |
| 2 | Analysis | `business-analyst` | `docs/analysis/` — domain-model, use-cases, workflows, business-rules, risks | [02](../lifecycle/gates/02-analysis.gate.md) |
| 3 | Design | `solution-architect`, `ux-bridge` | `docs/design/` — architecture, api-design, database-design, security-design, adr, ux | [03](../lifecycle/gates/03-design.gate.md) |
| 4 | Development | main thread | `src/`, `frontend/`, `specs/features/`, migrations | [04](../lifecycle/gates/04-development.gate.md) |
| 5 | Testing | `test-engineer` | `docs/testing/strategy.md`, `tests/` | [05](../lifecycle/gates/05-testing.gate.md) |
| 6 | Production | `ops-reviewer` | `.github/workflows/`, runbooks, SLOs, cutover plan | [06](../lifecycle/gates/06-production.gate.md) |

Phase owners are **read-only** subagents, like every other agent in
`.claude/agents/`. They do the expensive reading and return findings; the writing
happens in the main thread where the guard rules and hooks apply.

---

## Skills by phase

| Phase | New in this layer | Already existed |
|---|---|---|
| 1 | `/product-brief` `/product-requirements` `/persona-gen` `/user-story-map` | `/prompt-quality-audit` `/work-breakdown` |
| 2 | `/domain-model-gen` `/use-case-gen` `/business-rules-gen` `/risk-register` | `/feature-inventory` `/impact-analysis` (brownfield only) |
| 3 | `/solution-architecture` `/api-contract-design` `/data-model-design` `/ux-design-bridge` | `/threat-model` `/speckit-adr` `/dotnet-iac-gen` `/dotnet-multi-db-gen` `/architecture-map-gen` |
| 4 | `/feature-pipeline` | the `speckit-*`, `dotnet-*-gen` and `react-*-gen` families, `/refactor-apply` |
| 5 | `/test-strategy` `/e2e-test-gen` | `/dotnet-test-gen` `/react-test-gen` `/load-test-gen` `/task-verify` `/compliance-audit` `/code-review-assistant` + the `security-auditor` subagent |
| 6 | `/deployment-pipeline-gen` `/go-live` | `/production-readiness-review` `/release-safety` `/devops-audit` `/operability-gen` `/postmortem` `/delivery-metrics` |

Control: `/lifecycle` and `/lifecycle-gate`.

---

## Promotion, not duplication

Phases 1-3 must not become a second home for truth `memory-bank/` already holds.
Each gate **promotes** its decisions into the Tier 2 files the guard rules read:

| Phase | Promotes into |
|---|---|
| 1 | `projectbrief.md`, `productContext.md`, `businessRules.md` |
| 2 | `businessRules.md`, `glossary.md` |
| 3 | `architecture.md`, `technologyStack.md`, `databaseConventions.md`, `apiConventions.md`, `securityStandards.md` |

This is what makes a design binding rather than adjacent. Once the layering is in
`memory-bank/architecture.md`, rule 02 enforces it on every `.cs` file for the
life of the project. Skip the promotion and the design is a document; do it and
the design is a compiler error.

Tier 2 is human-authored and `guard-write.mjs` blocks agent writes to it, so
promotion is explicit: show the diff, get the user's word, apply with
`CLAUDE_ALLOW_TIER2_EDIT=1`. Never silently.

---

## The design gate

`guard-phase.mjs` returns exit code 2 on any write the current phase does not
permit. The design gate is the most consequential of those rules, but no longer
the only one — the policy is data, in `.cursor/lifecycle/write-policy.json`:

| Artifact | Earliest phase | Needs cleared |
|---|---|---|
| `src/`, `backend/`, `frontend/` source | DEVELOPMENT | DESIGN |
| Database migrations | DEVELOPMENT | DESIGN |
| IaC — `*.tf`, `*.bicep`, `infra/` | DESIGN | ANALYSIS |
| CI pipelines — `.github/workflows/` | TESTING | DEVELOPMENT |
| Deployment manifests — `k8s/`, `helm/` | PRODUCTION | TESTING |

`earliest: X` means the phase **before** X must be `APPROVED` or `INHERITED`, so
the original source rule is a special case of a general one rather than
something that got replaced. `STALE` counts as not cleared: edit an approved
design document and source writes block again on the next call.

Not blocked: `tests/`, `specs/`, `docs/`, `memory-bank/`, `.cursor/`, `.claude/`,
`.github/`. Writing a test or a spec before the design gate is good practice.

Escape hatch: `LIFECYCLE_OVERRIDE=1`, the same pattern as
`CLAUDE_ALLOW_TIER2_EDIT`. A human sets it deliberately. An agent proposing it is
the failure the gate exists to prevent.

---

## Brownfield

A codebase that already exists did not skip phases 1-3 — it did them informally,
years ago, in people's heads.

```bash
node .cursor/tools/lifecycle.mjs init --name "<product>" --existing
```

marks them `INHERITED`, which clears the design gate and starts the product in
`DEVELOPMENT`. To upgrade a phase to `APPROVED`, produce its artifacts —
`/feature-inventory` and `/context-sync` reconstruct most of phases 1-2 from the
code — then `check` and `approve`.

---

## See also

- [IDEA-TO-PRODUCTION.md](IDEA-TO-PRODUCTION.md) — one idea, every command in order
- [`.cursor/rules/11-lifecycle-gate.mdc`](../rules/11-lifecycle-gate.mdc) — the binding rule
- [`.cursor/lifecycle/gates/`](../lifecycle/gates/) — what each gate requires
- [shared-execution-pipeline.md](shared-execution-pipeline.md) — the order *within* a phase 4 skill
