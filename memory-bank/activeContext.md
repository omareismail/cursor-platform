# Active Context
**Last Updated:** 2026-09-12
**Current branch:** platform-ui
**Recently reviewed implementation:** `project.mjs`, `_project-model.mjs`, `_project-txn.mjs`, `dashboard.mjs`, project suites; plugin digest `470b08b025141c2c`
**Active feature:** Project Command Center (`IDEA-001`, IMPLEMENTING)

## Latest independent verification — 2026-09-12

**PCC-G01–G10 are partial/reopened, not closed.** Compared all 52 original prompt
sections, all eleven review gaps and ten optional enhancements. Nine isolated
negative cases reproduced incorrect recovery, catalog, health, evidence graph,
trace, risk-mapping, identity-confidence and read-only behavior. Source review
also found validation, release semantics and UI/test coverage gaps. No application
fixes were made in this verification.

Evidence: 139 focused assertions; 26 suites, zero failures; self-audit run PASS;
latest local API and Edge desktop/mobile smoke PASS. Passing those checks does
not close the reproduced cases. Integrity remains FAIL on the three existing
enforcement changes; no human attestation performed.

Report: [current verification and acceptance criteria](../docs/reviews/project-command-center-verification-2026-09-12.md).

## Implementation increment — 2026-09-12

Added implementation slices for PCC-G06–G10 from
[the Command Center review](../docs/reviews/project-command-center-review-2026-09-10.md):
discovery source refs and stack class, complete graph/roadmap node kinds,
health adapters, portable CI page smoke, and the decision/waiver/cancellation
contract. Command Center assertions: 139 + 9 UI. Full suite: 26 suites, zero
failures. Plugin rebuilt (`470b08b025141c2c`). Self-audit `run` PASS.

G11 remains owner-only. It is not the only remaining work; see the verification above.

## Latest increment — 2026-09-10

Added implementation slices for high-priority Command Center gaps PCC-G01–G05 from
[the review](../docs/reviews/project-command-center-review-2026-09-10.md):
journaled multi-file writes, catalog/phase CLI, risk-register readiness,
`trace ID`, and delivery/ideas/evidence schemas. Command Center assertions:
113. Full suite: 25 suites, zero failures.

## Latest verification — 2026-09-10

Reviewed the user's 52-section Command Center prompt against the implementation.
Corrected readiness/evidence acceptance, unstable recommendation IDs, brownfield
phase assumptions, core state validation, idea transitions, source adapters,
feature projections, and dashboard detail/mobile/navigation behavior.
Report: [Command Center review](../docs/reviews/project-command-center-review-2026-09-10.md).

## What this is

```
Existing artifacts (lifecycle, feature-map, id graph, evidence)
          ↓
Canonical overlay (project/*.json)     ← journaled by _project-txn.mjs
          ↓
Derived intelligence (readiness, recommendations, graph, timeline, health)
          ↓
Project Command Center UI (dashboard.mjs)
```

This repo is initialised `--existing`: delivery `PHASE-007` Post-Release is
`IN_PROGRESS`; earlier phases are `NEEDS_REVIEW` (not fabricated COMPLETED).
Checkpoints are `NOT_STARTED`. Ideas: IDEA-001 Command Center IMPLEMENTING,
IDEA-002 license PARKED, IDEA-003–005 leftover H slices CAPTURED.

## Tests

```
node tests/run.mjs
node .cursor/tools/self-audit.mjs run
node .cursor/tools/self-audit.mjs integrity
node .cursor/tools/dashboard.mjs serve --no-open
```

## Next logical step

Correct journal containment/recovery and read-path mutation first, then health,
canonical trace resolution and evidence identity. Follow PCC-V01–V12 acceptance
criteria in the current verification, convert reproduced defects into regression
tests, and repeat requirement coverage before declaring the feature complete.

After reviewing the enforcement-surface changes, a human may attest them:

```
node .cursor/tools/self-audit.mjs integrity --write --by "<name>"
```

G01–G10 remain reopened. Do not treat derived-status output or a green suite as
replacing human commentary and requirement-level verification.

## Open questions for the human

- Integrity is FAIL until `_lib.mjs`, `write-policy.json`, and gate
  `06-production.gate.md` (99-skill count) are re-attested.
- License file is still an owner choice (IDEA-002 / H12).
- The development escape is enabled in this process. Keep its use scoped
  to this platform.
