# Project Command Center

The dashboard at `http://127.0.0.1:7777` is a **projection** of files that
already have owners, plus a small authored overlay for concepts the rest of
the platform did not have: delivery phases, checkpoints, and ideas.

Canonical authored files live in [`project/`](../../project/README.md) and are
written only by `project.mjs`.

```
Existing artifacts (lifecycle, feature-map, id graph, evidence)
          ↓
Canonical overlay (project/*.json)     ← project.mjs is the only writer
          ↓
Derived intelligence (readiness, recommendations, graph, timeline, health)
          ↓
Project Command Center UI (dashboard.mjs, GET only)
```

## Two clocks, not one

| Clock | Question | Canonical file |
|---|---|---|
| **Lifecycle** | What engineering stage is the product in? | `lifecycle/state.json` |
| **Delivery** | What outcome / work package are we shipping? | `project/delivery.json` |

A product can be in lifecycle `DEVELOPMENT` and delivery `PHASE-003` at the
same time. Do not store lifecycle status inside a delivery phase.

## Where state lives

| Path | Canonical? | Writer |
|---|---|---|
| `project/project.json` | Yes — identity, pointers, rec dispositions | `project.mjs` |
| `project/delivery.json` | Yes — phases, checkpoints, feature overlay | `project.mjs` |
| `project/ideas.json` | Yes — ideas and their transitions | `project.mjs` |
| `lifecycle/state.json` | Yes — engineering gates | `lifecycle.mjs` |
| `.cursor/cache/feature-map.json` | Derived from traces | `feature-map.mjs` |
| `docs/adr`, `memory-bank/decisionLog.md` | Yes — decisions | humans / `/speckit-adr` |
| Dashboard JSON | Derived | none (GET) |

Identity fields are `{ value, confidence }` with confidence `detected`,
`confirmed`, or `unknown`. Scan never invents a percentage.

## Commands

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/project.mjs init [--name N] [--existing]
node ${CLAUDE_PLUGIN_ROOT}/tools/project.mjs status|scan|snapshot|map|check [--json]
node ${CLAUDE_PLUGIN_ROOT}/tools/project.mjs scan [--max-files N] [--max-depth N] [--write]
node ${CLAUDE_PLUGIN_ROOT}/tools/project.mjs dashboard

node ${CLAUDE_PLUGIN_ROOT}/tools/project.mjs delivery list|show|start|complete|objective|catalog|phase
node ${CLAUDE_PLUGIN_ROOT}/tools/project.mjs checkpoint list|show|verify|pass|fail|waive|set
node ${CLAUDE_PLUGIN_ROOT}/tools/project.mjs idea add|list|show|evaluate|approve|reject|park|specify|implement|verify|release
node ${CLAUDE_PLUGIN_ROOT}/tools/project.mjs identity show|confirm|reject
node ${CLAUDE_PLUGIN_ROOT}/tools/project.mjs trace ID
node ${CLAUDE_PLUGIN_ROOT}/tools/project.mjs recommend list|show|accept|dismiss
node ${CLAUDE_PLUGIN_ROOT}/tools/project.mjs roadmap show|add|milestone|feature
```

`--existing` initialises every delivery phase as `NEEDS_REVIEW` and leaves the
current phase unknown. Select the actual phase with `delivery start PHASE-NNN`.
It does not infer production readiness from the mere existence of a repository.
Existing saved selections are preserved; review selections made by older init versions.

A phase cannot `complete` until required objectives are COMPLETE, required
checkpoints pass or have explicit waivers, dependencies are COMPLETED, linked
risks are resolved, required features are VERIFIED/RELEASED, and additional exit
criteria are satisfied. UNKNOWN blocks completion. Cancellation of a dependency
does not prove its outcome was delivered. The old `allowCompleteWithoutReady`
configuration flag no longer bypasses readiness.

`checkpoint pass --evidence docs/review.md --reviewer Name` records a real file
inside this repository and its SHA-256 hash. A manual review is a named assertion
supported by that file; it is not proof that automated tests ran. Changed or
missing files invalidate evidence. Remote URLs are not accepted as verified
evidence; save the review result in the repository and cite its source there.

`checkpoint waive CHK --reason "..." --by Name` records a named exception. It is
not PASSED. `delivery cancel PHASE --reason "..."` records CANCELLED;
dependents stay unready until they are re-planned.

Alternatively, run `checkpoint verify CHK-NNN`. Only a successful, non-skipped
structured verifier report qualifies. Failed, skipped, malformed, or stale
results cannot pass a checkpoint. Tool evidence records the checked worktree
digest, including dirty and untracked files except authored `project/` state.
Re-run verification when inputs change. A newer failure supersedes an older pass.
Security and release readiness require manual review: a dependency scan alone
does not establish security, and an unsigned release is not ready to ship.

`idea verify IDEA-NNN --evidence docs/verification.md` requires a linked feature
and a real review file. `idea release IDEA-NNN --release v1.2.3` links an existing
signed lifecycle release after verifying it and stamps overlay feature bindings
with that release id; it does not sign or publish anything.

## Decision and verification contract

| Fact | Meaning |
|---|---|
| Manual evidence | Hashed in-repo file + named reviewer. Assertion, not proof of the conclusion. |
| Automated evidence | Binds to the worktree digest. Does not attest runtime or deploy. |
| Idea VERIFIED | Review of that idea. Bound features stay unverified until VERIFIED/RELEASED. |
| Feature complete | Required features satisfy a phase only at VERIFIED or RELEASED. |
| Waiver | `--reason` and `--by`. Not PASSED, not silence. |
| Cancellation | CANCELLED on a dependency does not satisfy readiness. Only COMPLETED does. |
| Release membership | RELEASED ideas cite a signed record; overlay bindings carry the same id. |
| Decisions | Canonical ids live in `docs/adr` / decision-memory. `idea.decision` is an inline verdict note. |

`project.mjs check` prints contract findings beside relation errors.

## Dashboard / API

`GET` only, `127.0.0.1`, localhost Host. Same security model as before.

| Route | Panel |
|---|---|
| `/api/overview` | Command Center overview |
| `/api/project` | Full derived snapshot |
| `/api/delivery` | Phases + DORA/releases |
| `/api/ideas` `/api/checkpoints` `/api/roadmap` `/api/health` `/api/timeline` `/api/graph` `/api/recommendations` `/api/risks` | slices |
| `/api/trace?id=` | Source-aware hops from one id; missing links labelled |

Actions composes a subset of mutations. The full CLI above is the supported
write surface; the dashboard never executes mutations. Phase, feature, idea,
checkpoint and graph-node selections reveal their details.

## Recommendation engine

Deterministic rules in `_project-model.mjs` (`recommend()`). Each item has
`rule`, `what`, `why`, `evidence`, `impact`, `effort`, `risk`, `nextAction`,
and `source` (`rule` or `detected-gap`). AI is not a source of truth.

Recommendation IDs use a stable hash of the rule and affected entity. Accepting
or dismissing one item cannot transfer that decision to another after a refresh.
Old position-based `REC-001` dispositions are retained in saved state but ignored;
they cannot be migrated safely because their original target was not recorded.
List recommendations and reapply those decisions using current IDs.

## Default delivery catalog

Init seeds Discovery → Foundation → Core → Integration → Hardening → Release
Preparation → Production Launch → Post-Release Improvement. Export the current
structure with `delivery catalog export`, preview a replacement with
`delivery catalog preview --file <catalog.json>`, then apply. The catalog
carries ids, names, objectives, dependencies and checkpoint types. It cannot
import completion, evidence, reviewers or history — those stay on the live
delivery document. `delivery phase add --name --slug` appends one phase.
Do not bypass the writer by editing canonical JSON.

## Health

`healthView()` only emits values it can compute. Unknown metrics say
"Not measured" / "Insufficient evidence". No invented percentages.
Security, performance, observability, flag-debt and release adapters are
canonical tools or documents (`incidents`/`threat-model`, evidenced
performance checkpoints, `failure-modes.mjs`, `flag-debt.mjs`,
`lifecycle/releases`). Missing adapters stay unknown.

Scan records per-detection source paths, scan limits and a stack class
(dotnet / react / fullstack / node-esm). Confirm with
`identity confirm --detection DET-…` or `--field`. TSX without a React
manifest is not classified as a React app.

## Current limits

Runtime state validation covers versions, statuses, core shapes, duplicate IDs,
phase/checkpoint relationships, dependency cycles, milestones, and (when those
sources exist) dangling requirement, decision, release, task and risk ids.
`project.mjs check` prints relation errors and the verification contract.

`docs/analysis/risks.md` is the preferred register; `docs/analysis/risk-register.md`
and `docs/risks.md` are read if the preferred file is absent. Status values such
as In Progress / Won't fix / Mitigated are normalised. Incidents are not a
substitute register.

State files are written through `project/.txn.json`. Concurrent writers lose
with `ECONFLICT` / `ELOCKED`; they do not silently overwrite.

`project.mjs trace ID` walks idea → feature → requirement → task →
code/test → evidence → checkpoint → release hops and labels each missing link.
The graph and roadmap include those node kinds plus milestones and release
membership. Portable page smoke (skip-link, keyboard focus, contrast, graph
budget) lives in `tests/adversarial/project-ui.test.mjs` and runs in CI with
the rest of the suite. Integrity attestation of enforcement files remains a
human command.

## Extension points

| Want | Change |
|---|---|
| Custom delivery phases | `delivery catalog` / `delivery phase add` — keep existing stable IDs |
| A new checkpoint type mapped to a tool | `AUTOMATED_VERIFY` in `_project-model.mjs` |
| A new recommendation | A named rule inside `recommend()` — `what` / `why` / `evidence` / `nextAction` required |
| AI suggestions later | Separate `source: "ai"` items; never overwrite authored state |

Do not add those rules to `schemas/id-grammar.json`. That chain is FR → S → UC → EP.
