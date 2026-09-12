# Project Command Center: implementation review and corrections

Date: 2026-09-10. Baseline: branch `platform-ui`, HEAD `2b3f46d`, including the
uncommitted Command Center implementation present when this review started.
Contract: the user's attached 52-section Staff/Principal Engineer prompt.

**Current status (2026-09-12):** The independent
[implementation verification](project-command-center-verification-2026-09-12.md)
supersedes completion claims in the follow-up sections below. The increments
exist, but PCC-G01–G10 are partial/reopened: nine negative cases reproduced
incorrect behavior despite 26 passing suites. PCC-G11 remains owner-only.

## Verdict

**A working foundation is implemented, but the complete prompt is not yet satisfied.**
The original implementation contained completion and evidence checks that could
produce misleading results despite its passing tests. This review corrected the
confirmed failures below and verified the CLI, API, browser interactions, and
existing regression suite. It does not certify the unfinished requirements as done.

The architecture is appropriate: dependency-free Node tools, authored project
state, projections of existing lifecycle/feature sources, and the existing
localhost dashboard. A replacement framework or an external AI service is not
needed to finish this feature.

The live platform currently reports delivery **not ready**. The saved selection
is Post-Release Improvement, its objectives are UNKNOWN, and its checkpoints are
NOT_STARTED. That phase was selected by the previous brownfield initializer;
the saved selection needs review and is not evidence that the platform has
completed the earlier delivery phases.

## What is implemented

| Area | Evidence in the repository | Assessment |
|---|---|---|
| Authored identity, delivery, ideas | `.cursor/tools/project.mjs`, `project/*.json` | Working versioned state and CLI writer |
| Existing lifecycle integration | `project.mjs:loadLifecycle`, `lifecycle.mjs` | Existing six-stage lifecycle reused; no second gate system |
| Delivery model | `_project-model.mjs:buildDefaultDelivery` | Eight default phases, objectives, dependencies and checkpoints |
| Checkpoint workflow | `project.mjs:checkpoint` | Inspect/add/verify/pass/fail/waive; evidence and transition history |
| Ideas | `project.mjs:idea` | Capture, evaluate, approve, reject, park, specify, implement, verify, release |
| Derived intelligence | `_project-model.mjs` | Readiness, four recommendation categories, health, blockers, graph, timeline, roadmap |
| Read-only API | `dashboard.mjs` | Eleven checked API reads, localhost restrictions, no mutation endpoint |
| Dashboard | `dashboard.mjs` | Existing panels preserved; delivery, ideas, checkpoints, health, timeline, roadmap and map added |
| Distribution | `build-plugin.mjs`, generated `plugin/` | Canonical tools/docs/skill are included in the generated distribution |
| Tests | `tests/adversarial/project.test.mjs` | Expanded from 46 to 71 checks, including rejection and stale-evidence cases |

## Corrections applied in this review

| ID | Original error | Corrected behavior and location |
|---|---|---|
| PCC-01 | UNKNOWN objectives, missing dependencies and missing risks could satisfy readiness. IMPLEMENTED was accepted where a feature had to be verified. Extra exit criteria were ignored. | Required objectives/extra criteria must be complete; missing/open dependencies and unresolved linked risks block; required features must be VERIFIED/RELEASED. Removed the configuration bypass. `_project-model.mjs:phaseReadiness`, `project.mjs:delivery` |
| PCC-02 | A nonexistent path or failed tool result counted as passing evidence. Older success could survive newer failure. | Manual evidence must be a real in-repository file and is hashed. Tool results must explicitly succeed without being skipped. Failed, stale, malformed and missing evidence do not qualify. `project.mjs:manualEvidence/validateEvidence/checkpoint`, `_project-model.mjs:checkpointEvidenceReady` |
| PCC-03 | Security was mapped to a narrow dependency scan; release checking could succeed without establishing a signed release. | Those broad checkpoints require manual review. Automated results are supporting evidence, not blanket security/release certification. `_project-model.mjs:AUTOMATED_VERIFY` |
| PCC-04 | Sequential recommendation IDs shifted when earlier findings disappeared, transferring accept/dismiss decisions. | Stable IDs derive from rule plus affected entity; CLI refuses nonexistent recommendation targets. `_project-model.mjs:recommend`, `project.mjs:recommend` |
| PCC-05 | `init --existing` assumed Post-Release was already in progress. | All phases start NEEDS_REVIEW and the active phase remains unknown until explicitly selected. Existing saved state is preserved. `emptyIdentity`, `project.mjs:init` |
| PCC-06 | Valid JSON with invalid shapes/statuses/links could enter the model; missing ideas could appear as an empty list. Corrupt JSON used a process-exit path inside an API reader. | Validate core document shapes, versions, enums, duplicate IDs, current pointers, phase links and dependency cycles. Missing/corrupt state is an error, not an empty project. Readers throw recoverable errors. `validateState`, `validateRelations`, `project.mjs` |
| PCC-07 | An idea could enter implementation with a nonexistent phase and become VERIFIED without evidence. SPECIFIED/RELEASED were unreachable through the CLI. | Validate implementation phase before writes, require a feature, require real review evidence to verify, expose specify/release. Release links an existing signed record and verifies it. `project.mjs:idea` |
| PCC-08 | Source adapters could read the wrong root; stale traces were always shown fresh; skipped/vacuous ACs were omitted from the uncovered count; dangling IDs used a nonexistent checker; incidents were counted as risks. | Root-scoped source worker, actual feature freshness, meaningful uncovered counts, real dangling references, and honest unknown risk health. `project.mjs:assemble/sources/loadAc/loadRequirements` |
| PCC-09 | CLI completion passed an empty feature collection while the dashboard used real features; multiple bindings duplicated a feature; planned overlays were absent from the Features page. | CLI readiness uses the same assembled projection, overlays deduplicate while retaining links, and Features includes planned work. `project.mjs:delivery`, `projectFeatures`, `dashboard.mjs:collectFeatures` |
| PCC-10 | Delivery phases and map nodes were not inspectable; matrix cells were symbols without accessible details. | Selectable phase/feature/map details and labelled, keyboard-operable checkpoint cells. `dashboard.mjs` |
| PCC-11 | Mobile navigation occupied almost the entire screen. Slow responses could overwrite a more recently selected page. API errors could render as empty data. | Compact horizontal mobile navigation, latest-request-wins rendering and explicit error handling. `dashboard.mjs` |
| PCC-12 | Documentation instructed users to replace canonical phase JSON despite a writer-only guard, and described unsupported behavior as complete. | Document actual CLI capabilities, stricter evidence semantics, safe migration expectations, and remaining limitations. Command Center guide and project skill |

Manual evidence is still a review assertion supported by a file. A file's hash
proves its bytes have not changed; it does not prove that its conclusions are true.
Automated evidence now binds to worktree inputs, but it does not attest the external
runtime, databases, or deployment environment.

## Coverage against all sections of the prompt

This is requirement coverage, not a fabricated completion percentage.

| Prompt sections | Status after corrections | Remaining work |
|---|---|---|
| 1–2: purpose and architecture | Implemented foundation | The product cannot yet answer every traceability question end to end |
| 3: canonical model | Partial | Tasks, risks, decisions, evidence and releases are not all joined into one complete projection |
| 4: identity | Partial | No supported confirmation/edit workflow for all identity fields; discovery is bounded and incomplete |
| 5: lifecycle | Implemented integration | Full lifecycle behavior is tested in the existing lifecycle suites |
| 6: configurable delivery | Partial | Defaults work; arbitrary phase configuration/import/editing is missing |
| 7–10: objectives, checkpoints, readiness, evidence | Working core, partial full contract | Structured criteria editing, entry-criteria enforcement and full risk/evidence/quality-policy integration remain |
| 11–14: matrix, overview, blockers, history | Partial | Matrix/details work; complete risk/requirement/task blocker propagation and all editing histories do not |
| 15: features | Partial | Overlay plus traced features work; a complete feature-state/metadata CLI and release membership are missing |
| 16–17: ideas and end-to-end trace | Partial | Status commands work; tasks, code/test references and canonical decisions are not fully linked or verified |
| 18–19: recommendations and explanations | Implemented core | Stable identity fixed; rule set remains narrower than requested |
| 20: project health | Partial | Security/performance/debt/risk/release health lack complete canonical adapters; unknown is shown |
| 21–26: dashboard sections and details | Partial | Sections exist and tested selections work; many details remain raw JSON, and some relationships cannot be navigated |
| 27: improvements | Partial | CLI dispositions work; no full improvement-to-task/roadmap acceptance workflow |
| 28: timeline | Partial | Existing dated events are projected; not every requested event/source is represented |
| 29: project graph | Partial | Inspectable nodes/edges, not yet a complete visual, source-linked graph |
| 30–31: discovery and initialization | Partial | Honest brownfield initialization fixed; complete discovery and guided confirmation remain |
| 32: CLI | Implemented core verbs | Metadata editing, phase customization and richer roadmap/features remain |
| 33–34: server and API | Implemented core | GET-only localhost server and requested slices work; large-repo latency needs profiling |
| 35–36: stable IDs and definitions | Partial | Local IDs validated and recommendation IDs fixed; full cross-source referential integrity missing |
| 37: readiness engine | Partial full contract | Core unsafe success paths fixed; custom policy/risk/quality checks still incomplete |
| 38: recommendation rules | Partial | Dedicated performance, observability and security-verification gaps need more rules |
| 39–40: no AI dependency / optional AI source | Implemented design boundary | No external AI dependency; optional AI generation is not implemented or required |
| 41: roadmap | Partial | Phase/idea buckets; feature milestones, release targets and complete scheduled work missing |
| 42: decisions | Partial | Index is read; inline idea verdicts coexist with canonical ADR/decision IDs and need a clearer ownership contract |
| 43: safe operation | Implemented API restrictions; persistence gap | No arbitrary write API. Multi-file operations are not crash-atomic |
| 44: testing | Partial full contract | Core negative tests and browser smoke pass; durable CI browser, scale and crash-recovery tests remain |
| 45–46: docs and UX | Improved, partial | Corrected misleading docs and mobile layout; polished semantic details and full accessibility audit remain |
| 47–49: implementation, consistency, migration | Partial | Existing tools reused; safe automatic migration/import/recovery needs more work |
| 50: definition of done | Not satisfied in full | Open requirements above prevent a complete-prompt sign-off |
| 51–52: avoid overengineering / execute and verify | Followed for this review | Reused architecture; implemented corrections and ran checks; limitations are explicit |

## Prioritized unfinished work

These are requirements or reliability gaps, not optional polish. Ownership is
suggested by role; no individual owner or delivery date has been assigned.

| ID | Priority | Gap and practical consequence | Next verifiable outcome |
|---|---|---|---|
| PCC-G01 | High | Multi-file writes commit independently. An interruption after delivery is saved but before identity/ideas can leave a partial transition. | Recoverable transaction journal or one canonical revision boundary, with crash-injection and two-writer tests |
| PCC-G02 | High | No supported phase configuration/metadata editor. Custom criteria can be represented but cannot be managed fully through the CLI. | Validated preview/apply CLI that preserves IDs/history, rejects invalid links, and cannot import fabricated approval/evidence |
| PCC-G03 | High | The canonical risk register is not parsed into readiness. Linked risk IDs therefore remain unresolved and block completion; unlinked register risks are not propagated. | Read `docs/analysis/risks.md`, retain source/owner/status and connect blocking risks to phases/checkpoints |
| PCC-G04 | High | Feature, task, requirement, idea, code/test and release relationships are incomplete. An idea's VERIFIED status does not automatically prove its entire feature is VERIFIED. | One source-aware trace query that follows every requested hop and labels each missing link |
| PCC-G05 | High | The JSON schema covers identity only; local validation does not validate all cross-source references or semantic claims. | Schemas for delivery/ideas/evidence plus shared validation against canonical requirements, tasks, ADRs and releases |
| PCC-G06 | Medium | Discovery uses bounded file/pattern scans, counts some ambiguous project/endpoint types and lacks confirmation editing. | Per-detection source references, scan limits, accurate stack classification, and explicit confirm/reject commands |
| PCC-G07 | Medium | Graph/roadmap are incomplete projections. They lack task/code/test/evidence nodes, full source navigation, milestones and release planning. | A complete connected sample journey visible in graph and roadmap, verified by browser tests |
| PCC-G08 | Medium | Health and recommendations omit requested policy areas. | Canonical adapters and explainable rules for security, performance, observability, debt and release evidence; explicit unavailable states |
| PCC-G09 | Medium | Browser smoke checks are local review artifacts, not durable CI coverage. Performance on large repositories is unmeasured. | Portable browser smoke suite, keyboard/contrast checks and a large fixture with recorded response-time budgets |
| PCC-G10 | Medium | Decision ownership, complete transition history and verification scope need a single documented contract. | Canonical decision references; explicit semantics for manual verification, feature completion, cancellation, waivers and release membership |
| PCC-G11 | Release check | Integrity differs from the owner's recorded attestation on three enforcement files. | Owner reviews the changed enforcement files and re-attests if accepted; an agent must not perform that attestation |

## Suggested enhancements after the gaps above

| Order | Idea | Why it would improve this platform |
|---|---|---|
| 1 | Evidence-backed next action | Show the smallest action that removes a real blocker, with the source and verification command |
| 2 | Change impact preview | Before applying a change, show which phases, evidence, checkpoints and releases will become stale |
| 3 | Increment templates | Reuse reviewed delivery/checkpoint templates for API changes, migrations and UI features with project-specific overrides |
| 4 | Saved filtered views | Give reviewers, implementers and release owners useful views of the same canonical facts |
| 5 | Verification bundles per feature | Export the exact inputs, tests and review evidence needed to reproduce a feature's verification |
| 6 | Recommendation-to-workflow conversion | Convert an accepted recommendation into a linked idea/task with explicit acceptance criteria and an owner |
| 7 | Historical comparisons | Explain what became ready, regressed, changed ownership or lost evidence between two revisions |
| 8 | Scenario preview | Show which checkpoints and dependencies prevent a proposed release date or phase selection without changing real state |
| 9 | Source-aware search | Find features, decisions, risks and evidence by IDs and terms with provenance and stale indicators |
| 10 | Optional AI explanation layer | Explain deterministic findings and draft suggestions, clearly labelled and requiring the normal review/write workflow |

The first investment should be reliable state transitions and complete traceability.
More dashboards or AI suggestions would otherwise amplify incomplete facts.

## Verification evidence

- Initial Command Center suite: 46 assertions passed before the review; passing
  those assertions did not establish the requested negative behavior.
- Expanded Command Center suite: **71 assertions passed** after the core fixes.
- Complete repository regression run: **25 suites, zero failures**.
- Wiring, documentation, metadata and packaged-tree audit: **PASS** after rebuild.
- Live local API smoke: **11 GET endpoints returned 200**, and POST `/api/project`
  returned **405**.
- Browser smoke: installed Edge in a fresh headless profile; ten panels loaded,
  four detail interactions passed, and no page script errors were reported.
  Desktop width 1440 and mobile width 390 were exercised. Mobile inspection led
  to the navigation correction. Final browser recheck is recorded separately in
  the session's local review output.
- Integrity: **FAIL**, correctly, for `.claude/hooks/_lib.mjs`,
  `.cursor/lifecycle/write-policy.json`, and
  `.cursor/lifecycle/gates/06-production.gate.md`. These were already modified
  when this review began. No human-only attestation was performed.

No live database, deployed environment, external integration, or large-repository
performance test was performed. Browser smoke is not a full accessibility audit.
Tests mutate isolated fixtures; existing project approvals, checkpoints and ideas
were not advanced to make the results appear green. No commit or publication was made.

## Compatibility and follow-up

Legacy evidence without a recorded hash or successful result is preserved but
does not establish current readiness; re-record legitimate evidence. Legacy
position-based recommendation dispositions are preserved but ignored because
their former entity cannot be recovered reliably. Existing phase selections are
preserved and should be reviewed if they came from the old brownfield initializer.

The review fixes are concentrated in `project.mjs`, `_project-model.mjs`,
`dashboard.mjs`, the project regression suite, the Command Center guide and the
project skill. Generated plugin copies were rebuilt through the existing builder.
The user's other uncommitted implementation work was retained.

## Follow-up increment — high-priority gaps (same day)

Implemented against PCC-G01–G05. Command Center assertions are now **113**.
Full suite: 25 suites, zero failures. Integrity is unchanged (still FAIL on the
three enforcement files; still not attested here).

| ID | What shipped | Verify |
|---|---|---|
| PCC-G01 | `project/.txn.json` write-ahead journal (`_project-txn.mjs`). Multi-file commands recover forward. Crash-injection and two-writer tests. | `tests/adversarial/project.test.mjs` txn sections |
| PCC-G02 | `delivery catalog export\|preview\|apply --file` and `delivery phase add\|set`. Catalogs cannot import completion, evidence or history. | catalog tests + CLI apply refusal |
| PCC-G03 | `docs/analysis/risks.md` parsed into readiness, blockers, health and graph nodes. Incidents still are not the register. | risk-register tests |
| PCC-G04 | `project.mjs trace ID` and `GET /api/trace?id=`. Idea VERIFIED does not verify the bound feature. | trace tests |
| PCC-G05 | `schemas/delivery.schema.json`, `ideas`, `evidence`, `delivery-catalog` plus `validateCanonicalRefs` / `project.mjs check`. | schema + canonical-ref tests |

At implementation handoff, only PCC-G11 was reported open. PCC-G06–G10 received
later implementation slices. Independent verification subsequently reopened
PCC-G01–G10; see the current-status note above.

## Follow-up increment — remaining gaps (2026-09-12)

Implemented against PCC-G06–G10 (plus G01–G05 residuals that fit the same increment). Command Center assertions are now **139** plus **9** portable UI checks. Full suite: 26 suites, zero failures. Integrity is unchanged (still FAIL on the three enforcement files; still not attested here).

| ID | What shipped | Verify |
|---|---|---|
| PCC-G06 | Per-detection source refs, `--max-files`/`--max-depth`, stack class, `identity confirm --detection` | discovery section in `project.test.mjs` |
| PCC-G07 | Graph/roadmap nodes for task, code, test, evidence, milestone, release; labelled dashboard details | graph/roadmap section + dashboard page |
| PCC-G08 | Security/performance/observability/debt/release adapters and named recommendation rules | health adapter tests |
| PCC-G09 | Portable page smoke, focus-visible, contrast AA, large-graph budget in CI | `tests/adversarial/project-ui.test.mjs` |
| PCC-G10 | Verification contract in the guide and `project.mjs check`; cancel/waiver/`--by`; release membership on overlay bindings | contract/cancel/waive tests |

PCC-G11 is owner-only. It is not the only remaining work: the subsequent
[independent verification](project-command-center-verification-2026-09-12.md)
reopened PCC-G01–G10 and records the required corrections.
