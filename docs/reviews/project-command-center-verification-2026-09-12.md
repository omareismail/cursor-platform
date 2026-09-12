# Project Command Center — independent implementation verification

Date: 2026-09-12. Reviewed branch: `platform-ui`, HEAD `2b3f46d`, including the
current uncommitted implementation. This report supersedes the completion claims
in the September 10 review's follow-up sections and the September 12 memory notes.

## Verdict

**The implementation does not yet satisfy every point in the Markdown.**
Substantial functionality exists and all current repository tests pass. However,
nine isolated reproductions demonstrate incorrect behavior. Additional source
inspection shows incomplete validation, release semantics, and UI/test coverage.
PCC-G01–G10 are therefore **partial/reopened**, not closed. PCC-G11 remains an
owner-only integrity review. This is not a complete-implementation sign-off.

The comparison covers both the original 52-section Command Center prompt and
all eleven gaps plus ten enhancement ideas in
[the earlier review](project-command-center-review-2026-09-10.md).
The ten enhancement ideas were explicitly proposed after the required fixes;
they are not all implemented and should not be silently counted as complete.

This verification changed review documentation and project memory. It did not
change application behavior, advance project state, approve gates, sign a release,
or re-attest enforcement files. The defects below remain open.

## What the latest increments actually added

- A write-ahead transaction journal, crash recovery, revision conflict checks,
  and two-process writer tests.
- Delivery catalog export/preview/apply and phase/checkpoint metadata commands.
- Risk-register parsing; identity detection provenance and confirm/reject commands.
- Trace CLI/API, additional graph node kinds, milestones and roadmap scheduling.
- Delivery, ideas, evidence and catalog schemas; cross-source and contract checks.
- Health adapters, additional recommendation rules, labelled detail panels,
  focus styles, and portable page-source tests.

These are useful implementations. Their presence alone does not establish the
correctness or completeness of the corresponding requirement.

## Reproducible defects

P1 means a correctness or safety issue to resolve before treating this capability
as complete. P2 means a material behavior gap. All cases below ran against
throwaway fixtures or pure model inputs; malformed journals never touched the
real repository's project state.

### PCC-V01 — P1: journal recovery can escape its state directory

Source: `.cursor/tools/_project-txn.mjs:62–82`.

Give a fixture journal an entry with `name: "../outside.json"`, expected revision
0 and next revision 1. Recovery joins that name to `project/` without an allowlist
or containment check. The fixture's sibling `outside.json` was overwritten and no
error was raised. A malformed persisted journal can therefore write beyond the
three canonical project documents. This requires a journal to be present; it is
not a claim that an unauthenticated HTTP client can submit arbitrary journal data.

Close when both commit and recovery allow only the canonical document names,
validate the entire journal before any write, and reject traversal, absolute
paths, duplicate targets, invalid revisions and invalid document bodies.

### PCC-V02 — P1: recovery accepts different content at the intended revision

Source: `.cursor/tools/_project-txn.mjs:80`.

Put revision 1 with name `DIFFERENT CONTENT` on disk, and an interrupted journal
whose intended revision 1 contains `INTENDED CONTENT`. Recovery considered that
file committed solely because its revision matched. It removed the journal and
retained the different body. The revision number does not prove that the
transaction's intended write landed.

Close when recovery compares the intended content/digest, detects conflicts
without discarding the journal, and preflights every member before applying any
member. Also exercise readers interleaved with a multi-document writer; separate
per-file reads do not establish a coherent snapshot.

### PCC-V03 — P2: catalog preview accepts exit criteria that apply discards

Sources: `_project-model.mjs:1712`, `:1768`, `:1883`, `:1894` under
`.cursor/tools/`.

Export the default catalog and add a required `EXIT-1` exit criterion to its
first phase. Preview returned `ok: true`; apply retained an empty exit-criteria
array. Export omits these criteria as well. Preview also lists only a subset of
the fields that apply changes: dependencies, entry criteria and objectives can
change without a corresponding field-level preview.

Close when supported criteria round-trip, unsupported input is rejected rather
than discarded, and preview describes the exact changes that apply will make.
The start command also needs an explicit contract for evaluating entry criteria.

### PCC-V04 — P1: health turns insufficient evidence into measured success

Sources: `.cursor/tools/project.mjs:294–376` and
`.cursor/tools/_project-model.mjs:1055–1083`.

In an initialized fixture, create a TODO security-design document and an empty
`tests/load` directory. Snapshot reported Security and Performance as
`kind: "measured"`, value `"no blocking findings"`. Security came from an incidents
check saying `"no incident records"`; Performance explicitly noted that there was
no evidenced performance checkpoint. Neither establishes those broad health claims.

Source inspection also found that successful-process output with no valid finding
envelope can be accepted by `loadAdapter`, and release health checks signature
presence without verifying signature/evidence freshness.

Close when adapter results validate their envelopes and retain their actual
scope. Missing measurements must remain Unknown/Insufficient evidence. Empty
folders, present documents and absence of incident records must not establish
security or performance success. Verify the release record before reporting it
as current release evidence.

### PCC-V05 — P1: graph evidence IDs merge unrelated records

Source: `.cursor/tools/_project-model.mjs:929–939`.

Use two checkpoints, each with locally allocated `EV-001`: the first evidence
passes and references `first.md`; the second fails and references `second.md`.
The graph produced one evidence node, labelled `first.md` with status `ok`, and
connected both checkpoints to it. The second checkpoint's failed evidence was
represented by the first checkpoint's successful evidence.

Close when graph identity includes the evidence owner plus local ID, preserving
both sources and results. Apply the same namespace rule consistently to trace
queries, links and other locally allocated IDs.

### PCC-V06 — P1: a trace can be complete while its targets do not exist

Sources: `.cursor/tools/_project-model.mjs:1993–2000`,
`.cursor/tools/project.mjs:379–392`, `:1435–1445`.

Query an idea with `ADR-404`, `does-not-exist.mjs` and `missing.test.mjs`, supplying
no canonical decisions. All three hops were `present`, `missing` was empty, and
`complete` was true. Code/test strings become fabricated target objects; an
unresolved decision receives a similar fallback.

The task adapter constructs task objects from references rather than resolving
canonical task records. The CLI trace call does not pass tasks at all. The query
is also a collection of immediate links, not the complete requested journey;
feature test references and several downstream links are not followed.

Close when every hop resolves against its actual source, unavailable sources
remain unknown, missing files/IDs remain missing, and CLI/API/UI produce the same
result for a complete fixture journey and for a broken link at every stage.

### PCC-V07 — P2: canonical risk phase notation remains ambiguous

Source: `.cursor/tools/_project-model.mjs:1630–1689`.

Parse the repository's risk-register columns with an open HIGH risk whose
`Retire in` value is `Phase 4`. The risk remains `phaseId: null` after delivery
linking. The risk-register workflow uses lifecycle phase notation, while this
linker matches delivery IDs/slugs/names. Those are different concepts.

This reproduction establishes an unresolved mapping, not that Discovery must
be blocked by every Phase 4 risk. An explicit lifecycle/delivery scope contract
is needed; guessing a numeric delivery phase would also be incorrect. The parser
also reports unrecognized/empty content as a successfully parsed empty register.

Close when canonical phase notation is preserved, explicit delivery/checkpoint
links are supported, unresolved mappings are visible, and applicable blocking
risks propagate without treating unreadable or unrecognized data as zero risks.

### PCC-V08 — P2: confirming one detection confirms unrelated values

Source: `.cursor/tools/_project-model.mjs:1303–1312`.

Start with detected languages `["C#", "TypeScript"]`; confirm only the C# detection
from `Api.csproj`. Both languages then share `confidence: "confirmed"`, with only
the C# source attached. TypeScript was never confirmed by the reviewer.

Close when confirmation and source references belong to individual values, or
when a field-wide confirmation explicitly requires review of every value.
Also cover rescan after rejection. The current repeated scans share one file
budget, so earlier extension scans can exhaust it before later manifest scans;
larger depth options are additionally capped by individual scan calls.

### PCC-V09 — P1: a read command silently mutates canonical state

Sources: `.cursor/tools/project.mjs:71–74`, `:95–99`, `:437–442`.

Leave a legitimate crash-injected journal in a fixture, then run `snapshot`.
The command changed the stored project name from `Before` to `Recovered by read`
and removed the journal. This was directly reproduced through the CLI. Dashboard
GET collection calls the same readers, so GET-only routing does not establish
read-only filesystem behavior. The startup banner's `Nothing is written` claim
is consequently too broad.

Close when read paths return a consistent view or an explicit recovery-required
state without writing canonical records; perform validated recovery through the
controlled writer workflow. Add a GET test that compares filesystem bytes before
and after a pending-journal request, including a malformed journal.

## Additional source-backed gaps

These are not counted in the nine isolated reproductions above.

| ID | Gap | Evidence and required closure |
|---|---|---|
| PCC-V10 | Published schemas and runtime validation are not equivalent | `_project-model.mjs:1549–1592` checks core shapes but not evidence-entry schemas; `validateCanonicalRefs:2055` skips unavailable sources and omits binding/milestone reference checks. `project.mjs:1341–1359` accepts milestone dates and feature/release strings without validating their meaning. Use shared validation at every write boundary, and report unvalidated sources explicitly. |
| PCC-V11 | Release can promote an unverified feature | `project.mjs:1196–1209` permits idea verification with a supporting file, then changes every binding for that idea to RELEASED after verifying a referenced signed release. It does not first establish feature verification or that the signed release's contents include this implementation. `contractFindings` then sees the promoted status. Require independent feature evidence and matching release contents; attaching a release reference must not manufacture feature completion. This path was source-reviewed, not exercised with a newly signed release. |
| PCC-V12 | UI and durable tests do not cover the full contract | Phase details (`dashboard.mjs:2000`) omit the requested feature/task/checkpoint/risk/evidence/exit-criteria details. Improvements (`:2448`) omit evidence, priority and disposition status. Graph source paths are displayed as text; nodes are capped at 60 per kind and edges at 80 without a complete source-navigation workflow. `project-ui.test.mjs:51–77` checks HTML/CSS strings and pure graph construction, not browser interactions or large-repository API latency. Complete those views and add durable behavioral tests. |

## Reconciliation of every gap in the earlier Markdown

| Item | Current status | Reason it cannot be closed yet |
|---|---|---|
| PCC-G01 — transactions | Partial / reopened | V01, V02, V09: unsafe recovery targets, revision-only acceptance, writes from readers; coherent snapshot coverage missing |
| PCC-G02 — configurable delivery | Partial / reopened | V03: discarded exit criteria and incomplete preview; entry-criteria contract incomplete |
| PCC-G03 — risks | Partial / reopened | V07: lifecycle versus delivery phase mapping; unrecognized register handling |
| PCC-G04 — full trace | Partial / reopened | V06, V11: fabricated targets, task source mismatch, incomplete journey and release proof |
| PCC-G05 — validation | Partial / reopened | V05, V10: namespace collision, shallow runtime validation, missing cross-source checks |
| PCC-G06 — discovery | Partial / reopened | V08: confirmation scope; scan-budget/depth and rescan behavior require correction |
| PCC-G07 — graph/roadmap | Partial / reopened | V05, V06, V10, V12: inaccurate nodes, incomplete source navigation and milestone validation |
| PCC-G08 — health/rules | Partial / reopened | V04: broad success from narrow checks or mere artifact presence |
| PCC-G09 — browser/scale tests | Partial / reopened | V12: static page tests and an in-memory graph budget do not meet the stated browser/large-repository acceptance criteria |
| PCC-G10 — semantic contract | Partial / reopened | V11: documented idea/feature distinction is undermined by release promotion; full mutation history/ownership remains incomplete |
| PCC-G11 — integrity | Open, owner-only | Integrity currently fails on the same three enforcement files; no new attestation was performed |

## Coverage of all 52 original prompt sections

Implemented means the stated area has working evidence within this review's
scope. Partial means something works but a named requirement is missing or
incorrect. It is not a percentage and does not claim exhaustive proof of an
implemented area's every possible edge case.

| Section | Assessment | Implementation evidence or remaining requirement |
|---|---|---|
| 1 Core objective | Partial | Command Center answers many status questions; reliable full trace and health remain open (V04, V06). |
| 2 Architecture | Implemented | Existing Node tools/dashboard and canonical sources reused; no replacement framework. |
| 3 Project model | Partial | Identity/delivery/ideas overlay exists; canonical task/evidence/release joins incomplete. |
| 4 Identity | Partial | Detected/confirmed/unknown fields and commands exist; confirmation overreaches (V08). |
| 5 Lifecycle | Implemented integration | Existing six-stage lifecycle reused; no duplicate lifecycle approval mechanism. |
| 6 Delivery phases | Partial | Eight defaults and customization exist; exit criteria and exact preview incomplete (V03). |
| 7 Objectives | Partial | Required objective status drives progress; catalog criteria editing is incomplete. |
| 8 Checkpoints | Partial | Types, states, owners, evidence and transitions exist; configurable entry/completion-criteria handling remains limited. |
| 9 Checkpoint gates | Partial | Core pass/fail/evidence gates work; complete criteria and canonical-risk enforcement remain open. |
| 10 Evidence | Partial | Files/hashes and tool outcomes are checked; graph identity and runtime evidence schema gaps remain. |
| 11 Matrix | Implemented core | Phase/type matrix and keyboard-operated checkpoint detail exercised in Edge. |
| 12 Delivery command center | Partial | Active phase, progress and readiness exist; full selected-phase context missing. |
| 13 Blockers | Partial | Objectives/checkpoints/dependencies/features contribute; risk/task propagation incomplete. |
| 14 Checkpoint history | Partial | Status history exists; full editing/ownership/evidence history is not uniformly represented. |
| 15 Features | Partial | Traced features plus overlay states exist; complete metadata/verification/release semantics incomplete. |
| 16 Ideas | Partial | Requested status commands exist; evidence and release transition semantics need V06/V11. |
| 17 Idea-to-implementation trace | Partial | Trace CLI/API present; full canonical journey and missing-target reporting are incorrect (V06). |
| 18 Four recommendation categories | Implemented | Missing, enhancement, risk and opportunity are distinguished. |
| 19 Explained recommendations | Partial | Model carries reasons/evidence/actions; unreliable inputs and incomplete UI disclosure remain. |
| 20 Health | Incorrect in confirmed cases | V04 violates the requirement to show Unknown when measurement is insufficient. |
| 21 Command Center UI | Implemented foundation | Existing dashboard extended and launched successfully. |
| 22 Main UI sections | Implemented core | Required subject areas are represented across new and existing panels. |
| 23 Overview | Partial | Identity/lifecycle/delivery/checkpoints are visible; complete active-task and risk context remains limited. |
| 24 Active work | Partial | Features are inspectable; canonical tasks and the complete per-work progress/blocker view are missing. |
| 25 Ideas panel | Partial | States and detail panel exist; complete history/source-resolved trace is incomplete. |
| 26 Delivery panel | Partial | Selected phase detail does not expose all nine requested detail groups (V12). |
| 27 Improvement panel | Partial | What/why/next appear; evidence, priority, affected entities and status are not all exposed. |
| 28 Timeline | Partial | Existing dated events are projected; uniform metadata/feature mutation history is incomplete. |
| 29 Knowledge graph | Partial | More node kinds and relationship buttons exist; collisions, reference resolution and source navigation remain. |
| 30 Discovery | Partial | Bounded source detection exists; confirmation, scan budgets and ambiguity handling require V08. |
| 31 New project workflow | Partial integration | Overlay defaults work; lifecycle/requirements/decisions still use separate existing workflows and need a complete tested onboarding journey. |
| 32 CLI commands | Implemented core | Existing command convention covers the suggested verbs; deeper semantics are assessed separately. |
| 33 Local server | Implemented core | Latest server launched; refresh and panel loads work. No large-repository latency claim. |
| 34 API | Partial | Read routes return data and POST is refused; reads can still mutate state (V09). |
| 35 Data integrity | Partial | Stable local IDs/revision checks exist; evidence collisions and incomplete reference validation remain. |
| 36 Source of truth | Partial | Ownership is documented; fabricated task/trace targets and feature promotion violate that intent. |
| 37 Readiness engine | Partial | Deterministic core rejects missing objectives/checkpoints; criteria/risk/release-proof gaps remain. |
| 38 Recommendation engine | Partial | Expanded deterministic rules exist; coverage and confidence depend on incomplete adapters. |
| 39 AI optional | Implemented | Required features run without an AI service. |
| 40 Idea generation | Partial / optional extension | Rule-based suggestions exist. Optional AI-generated suggestions are absent and are not a required blocker. |
| 41 Roadmap | Partial | Ideas, phases, features, milestones and release buckets exist; task integration and validation incomplete. |
| 42 Decisions | Partial | Existing decision index is read and IDs can be attached; unresolved IDs and inline/canonical ownership need correction. |
| 43 Security | Incorrect in confirmed cases | V01 and V09 violate containment and no-silent-mutation requirements. |
| 44 Testing | Partial | 26 suites pass; nine reproduced defects and browser/scale coverage gaps remain. |
| 45 Documentation | Partial | Guide/commands/ownership documented; earlier completion statements required this correction. |
| 46 UX/accessibility | Partial | Desktop/mobile smoke and two keyboard interactions pass; full drill-down/source navigation/accessibility audit incomplete. |
| 47 Incremental strategy | Followed | Coherent increments extend the existing project. This does not imply all requirements are complete. |
| 48 Repository consistency | Implemented core | Native modules, CLI conventions and generated plugin reuse; self-audit passes. |
| 49 Migration | Partial | Brownfield starts NEEDS_REVIEW; existing state preserved, but recovery safety/consistency remain open. |
| 50 Definition of done | Not satisfied | Confirmed safety, health, traceability and evidence failures prevent full completion. |
| 51 Avoid overengineering | Followed | No additional framework, graph database or mandatory AI dependency. |
| 52 Execute and verify | Partial overall | Actual functionality and tests exist; this independent review finds required corrections still outstanding. |

## Status of all ten proposed enhancements

| Idea from the earlier review | Current status | Useful next increment |
|---|---|---|
| 1 Evidence-backed next action | Partial | Existing reasons/actions help; rank the smallest real blocker-removal action and link its validated evidence. |
| 2 Change impact preview | Partial | Existing file/database impact explorer helps; extend it to show phase/checkpoint/release evidence that a proposed change would stale. |
| 3 Increment templates | Partial foundation | Catalog import is reusable configuration; reviewed API/migration/UI templates and override validation are not provided as a complete workflow. |
| 4 Saved filtered views | Missing | Persist useful reviewer/implementer/release filters over the same canonical data. |
| 5 Per-feature verification bundles | Missing as proposed | Existing release bundles are useful groundwork; add reproducible feature-specific inputs, tests and evidence. |
| 6 Recommendation-to-workflow conversion | Missing | Accept/dismiss stores a disposition; it does not create linked work with acceptance criteria and owner. |
| 7 Historical comparisons | Missing | Timeline shows events; add a revision-to-revision readiness/evidence/ownership comparison. |
| 8 Scenario preview | Partial foundation | Catalog preview exists; delivery/release scenario analysis without real-state mutation remains absent. |
| 9 Source-aware search | Partial | Existing decision search is narrower than cross-entity search over features/risks/evidence with freshness. |
| 10 Optional AI explanation layer | Optional, not implemented | Add only after deterministic data is trustworthy; preserve provenance and the normal write/review workflow. |

## Verification performed

| Check | Result and scope |
|---|---|
| Focused Command Center suite | 139 assertions passed. |
| Complete repository regression run | 26 suites, zero failures, including 9 portable page checks. |
| Self-audit `run` | PASS: documentation, metadata, wiring and generated plugin checks. Reviewed plugin digest: `470b08b025141c2c`. |
| Integrity | FAIL: `.claude/hooks/_lib.mjs`, `.cursor/lifecycle/write-policy.json`, `.cursor/lifecycle/gates/06-production.gate.md`. These changes predate this verification. |
| Independent negative cases | Nine of nine suspected defects reproduced. Local script/results: `.cursor/cache/pcc-reverify-2026-09-12.mjs` and `.json`. These are audit reproductions, not passing regression coverage for corrected behavior. |
| Live latest API | Eleven GET endpoints returned 200; POST `/api/project` returned 405. This covers routing, not filesystem immutability. |
| Actual browser | Installed Edge, fresh headless profile: ten panels, four detail interactions, checkpoint Enter/focus, graph Enter, latest-request behavior, widths 1440 and 390; no page script errors. Desktop/mobile screenshots inspected. |

The earlier local browser script initially expected raw JSON detail elements;
the latest UI uses labelled details. Updating those obsolete test selectors made
the real interaction checks pass. That was a review-script correction, not an
application defect. The repository's nine portable UI assertions still do not
execute a browser.

No deployed environment, live database, full screen-reader audit, or representative
large-repository API latency benchmark was verified. Full-suite success does not
close the negative cases above. No commit, push or human attestation was made.

## Recommended implementation order

1. Contain and validate journal recovery; remove canonical writes from read paths;
   establish a coherent snapshot boundary (V01, V02, V09).
2. Correct health scope, source resolution, evidence identity and feature/release
   proof before adding more derived claims (V04–V06, V11).
3. Finish schema/write validation, catalog round-tripping, risk scope and detection
   confidence, with the reproduced cases converted into regression tests
   (V03, V07, V08, V10).
4. Complete the required detail views, durable browser checks and representative
   latency tests (V12); then repeat the requirement matrix review.
5. After code verification, the owner reviews enforcement drift and decides
   whether to attest it. Optional product enhancements can follow separately.

The best next investment is trustworthy evidence and traceability. The existing
architecture can support that work without another framework or a redesign.
