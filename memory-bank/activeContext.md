# Active Context
**Last Updated:** 2026-09-09 18:30
**Current branch:** platform-ui
**Recently modified files:** governance tools and hooks, `lifecycle/integrity.json`, rebuilt `plugin/`
**Active feature:** Governance hardening — Phases A–C plus R1–R14; integrity attested 2026-09-09 by omar ismail

## What was just done (review-fix R1–R14)

The 9 September project review found 14 correctness issues in the uncommitted A–C work. Those are now fixed, with regressions in the adversarial suites. This is not Phase D.

- **R1** Protected integrity/index records and the new verifiers in both the policy and the fallback; tests name each path.
- **R2** `writeState` refuses to replace a `state.json` the chain already reports as CHANGED.
- **R3** Release checkers load as siblings of the running tool; missing required checker = failure; plugin-only adopter covered.
- **R4** Integrity enumerates from the plugin install directory; 0 files or a missing required guard is FAIL.
- **R5** A new present `anyOf` root stales an existing approval.
- **R6–R7, R14** AC ids are feature-scoped; skipped suites skip their tests; `toBeDefined` + a real assertion is not weak.
- **R8–R9** Adopter CI `node -e` parses; bootstrap copies `.claude`, `schemas`, `CLAUDE.md`.
- **R10** `cut` refuses untracked files under approved artifact roots.
- **R11** Quoted / schema-qualified SQL function identifiers are classified.
- **R12** `guard-phase` exempts Read the same way `guard-write` does.
- **R13** Weak incident guards fail JSON the same as text.

## Tests

`node tests/run.mjs`: **15 suites, 723 assertions, 0 failed.** Plugin rebuilt (`plugin/` digest from `build-plugin.mjs build`).

## Next logical step (human)

1. Phase D — Orchestration: skills index (E-20) and docs-lint hyphen / `.mdc` / Arabic patterns (E-21). Then E and F.

## Open questions for the human

- Whether `CURSOR_PLATFORM_DEV=1` should stay set globally. Right for this repo; wrong for any adopter repo opened in the same editor.
