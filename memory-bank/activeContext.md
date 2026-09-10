# Active Context
**Last Updated:** 2026-09-10
**Current branch:** platform-ui
**Recently modified files:** `guard-bash.mjs`, `lifecycle.mjs`, `_state.mjs`, `build-plugin.mjs`, `feature-map.mjs`, `_skills-index.mjs`, `signed-lifecycle-range.mjs`, `plugin/`, `tests/adversarial/*`
**Active feature:** R01–R13 corrections from the 2026-09-10 project review

## Latest work — 2026-09-10

Implemented the twelve defects plus the Windows lock retry from
`docs/reviews/project-review-2026-09-10.md`. Full suite `node tests/run.mjs`:
19 suites, 0 failed. `build-plugin.mjs check` is in sync (`ad2590f82243fd88`).
`self-audit.mjs run` PASS. Integrity remains FAIL until a human attests.

## What shipped (R01–R13)

- **R01/R02** Tokenized `guard-bash` force-push and PowerShell `Remove-Item`.
- **R03/R10/R11/R12** Safe `--out`, installed-tree digest, project-owned
  `.cursor/docs/architecture/`, shipped `IDEA-TO-PRODUCTION.md` + `LIFECYCLE.md`.
- **R04/R08** Shared `SOURCE_ROOTS` and effective-policy `sourceLayout()`.
- **R05** `signed-lifecycle-range.mjs` for full push/PR ranges.
- **R06/R07** Reciprocal lineage and object-definition freshness.
- **R09** Catalog-heading skill categories.
- **R13** Bounded retry on Windows lock `EPERM`/`EBUSY`/`EACCES`.

## Tests

```
node tests/run.mjs
node .cursor/tools/self-audit.mjs run
node .cursor/tools/self-audit.mjs integrity
```

Integrity `--check` fails until:

```
node .cursor/tools/self-audit.mjs integrity --write --by "omar ismail"
```

## Next logical step

1. Human reviews the R01–R13 enforcement-surface bytes and attests integrity.
2. Commit Phases D/E/F plus the review fixes (do not attest from the agent shell).
3. Optional: prioritize H01–H22.

## Open questions for the human

- Whether `CURSOR_PLATFORM_DEV=1` should stay set globally.
