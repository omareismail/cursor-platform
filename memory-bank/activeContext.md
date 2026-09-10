# Active Context
**Last Updated:** 2026-09-10
**Current branch:** platform-ui
**Recently modified files:** `guard-bash.mjs` nested parse, `feature-map.mjs` CAS/dependsOn/prune, `_policy.mjs explain`, dashboard Host/RTL/`/api/simulate`, `identity.mjs --author`, `release-evidence.mjs` bundle redact, CI matrix, `CONTRIBUTING.md` / `SECURITY.md` / `docs/reviews/`, plugin rebuild `01d0a9b23424e47b`
**Active feature:** Next increment of ideas 1–14 plus optional H01–H22

## Latest work — 2026-09-10

Implemented the next increment of the 14 improvement ideas and the focused
H01–H22 slices from the project review. Full suite: 24 suites, zero failures.
Self-audit `run` PASS. Plugin rebuilt (`01d0a9b23424e47b`). Committed as
`6b551ac`. Integrity PASS (26 attested files).

Durable reviews live under `docs/reviews/` (see `docs/reviews/README.md` and
`docs/reviews/findings-tracker.md`). Do not treat `derived-status.mjs` output
as replacing that commentary.

## What shipped this wave

| Id | Slice |
|---|---|
| H01 | Nested `sh -c` / flag-after-ref force-push refused via shared tokenize |
| H02 | 14 agents: advisory notice; none declare Write/Edit |
| H03/H04 | Catalog/index/shim agreement; `phaseExceptions` on classify |
| H05 | `_policy.mjs explain` with visible `alwaysAllow` exemptions |
| H06/H07 | Feature-map `commitJson` CAS; `dependsOn`; `prune`; catalog snapshot |
| H08 | Dashboard HTTP Host/405, skip-link, RTL CSS, `/api/simulate` |
| H10 | Session-start freshness vs policy/source mtimes |
| H12 | License remains an owner decision (README / SECURITY) |
| H13 | CI: Node 22+24 syntax; Windows+Linux guards; failure artifact |
| H14 | Locked `dotnet restore`; Stylelint labelled advisory |
| H16 | SQL template grants are SELECT-only (no live Postgres) |
| H17 | `schemas/feature-map.schema.json` + conformance tests |
| H19–H22 | `templates/memory-bank/`, CONTRIBUTING, SECURITY, reviews index |
| ideas 9–14 | worktreeDigest; why/asData; `--author`; isolated `upgrade`; bundle `--redact` |

## Tests

```
node tests/run.mjs
node .cursor/tools/self-audit.mjs run
node .cursor/tools/self-audit.mjs integrity
```

## Next logical step

Push `platform-ui` if you want this on the remote. Remaining work is the
leftover H slices and the larger idea visions (see `progress.md` backlog).

Do not treat derived-status output as replacing human commentary.

## Open questions for the human

- The development escape is enabled in this process. Keep its use scoped
  to this platform.
- License file is still an owner choice (H12).
