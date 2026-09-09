# Active Context
**Last Updated:** 2026-09-09 19:30
**Current branch:** platform-ui
**Recently modified files:** `_skills-index.mjs`, `docs-lint.mjs`, `sync-skills.mjs`, `session-start.mjs`, `build-plugin.mjs`, `skill-catalog.md`, `skill-graph.md`, `HANDBOOK.md`, `HANDBOOK.ar.md`, `START-HERE.md`, `README.md`, `CLAUDE.md`, `tests/adversarial/orchestration.test.mjs`
**Active feature:** Phase D (E-20, E-21) — skills index + docs-lint coverage

## What was just done (Phase D)

- **E-20** Generated `.cursor/skills.index.json` (category, phase, capability, workflow, requires) from `.cursor/skills/`. `sync-skills.mjs` writes it. SessionStart prints a one-line capability summary. `docs-lint` fails on a missing/stale index or a live skill with no catalog row.
- **E-21** `docs-lint` now matches hyphenated `N-skill` counts, cited `.mdc` files, and Arabic skill counts in `HANDBOOK.ar.md`.

## Tests

Run `node tests/run.mjs`, `node .cursor/tools/self-audit.mjs run`, then rebuild the plugin. Integrity `--check` will fail until you re-attest (`session-start.mjs` and `sync-skills.mjs` changed):

```
node .cursor/tools/self-audit.mjs integrity --write --by "omar ismail"
```

## Next logical step (human)

1. Re-attest integrity, then commit Phase D if the suite is green.
2. Phase E (E-22, E-23) when you want it.

## Open questions for the human

- Whether `CURSOR_PLATFORM_DEV=1` should stay set globally.
