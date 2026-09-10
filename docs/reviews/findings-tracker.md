# Findings tracker — H01–H22

Owner: platform maintainers. Evidence is a passing suite plus the cited tool or
document. This file is commentary; `derived-status.mjs` must not overwrite it.

**How to read status:** `slice` means the useful increment shipped; it is not the
full original H item. `partial` / `owner` / `out of scope` mean work remains or
is deliberately not done here.

| Id | Status | What is written and tested | Still left from the original item |
|---|---|---|---|
| H01 | slice | Nested `sh -c` and flag-after-ref force-push refused via shared tokenize (`bash.test.mjs`, `guards.test.mjs`, `next.test.mjs`) | Quoting, separator, and alias matrices |
| H02 | slice | All 14 agent files: advisory notice; no Write/Edit in `tools:` | Installed-host smoke that the editor actually withholds Write |
| H03 | slice | Catalog, generated index, and skill folders/shims agree | Prerequisite and target-path *semantics*, not only presence |
| H04 | slice | `phaseExceptions` on `_skills-index.mjs` (e.g. threat-model / ANALYSIS) | Broader catalog-vs-skill-body agreement beyond exceptions |
| H05 | slice | `_policy.mjs explain` lists verdict, rule, earliest, `alwaysAllow` | One generated model driving hooks, status, routing, and adopter CI |
| H06 | slice | Feature-map save uses `commitJson` CAS; stale revision is `ECONFLICT` | Two live concurrent upserts plus mid-save interruption drill |
| H07 | slice | `dataSource`, `dependsOn`, catalog snapshot fields, `prune` | Large-graph performance fixtures; fuller provider-aware ids |
| H08 | slice | HTTP Host/405, skip-link, RTL/narrow CSS, `/api/simulate` | Packaged-install HTTP, keyboard walkthrough, Arabic UI copy |
| H09 | prior | `platform-metadata.mjs` / `docs-lint.mjs` inventories | Historical vs current status still needs care in older reports |
| H10 | slice | Session-start warns when repo-map is older than policy/source roots | Broader added/removed-root discovery than those paths |
| H11 | slice | Plugin-only smoke in `eval.test.mjs` | Full plugin-only adopter workflow (trace/verify/upgrade) |
| H12 | owner | README + SECURITY: no license selected | Owner adds `LICENSE` if distributing |
| H13 | slice | Syntax Node 22+24; guards Ubuntu+Windows; failure artifact | Confirm logs survive a *successful rerun* in Actions |
| H14 | partial | `dotnet restore --locked-mode` (no unlocked fallback); Stylelint advisory | Execute extracted workflow steps against fixtures |
| H15 | fixture | Architecture template forbids Domain→Infrastructure as text | Compile/run minimal adopter apps; mutation/coverage reject samples |
| H16 | out of scope here | `readonly-role.sql` grants SELECT only; no INSERT/UPDATE/DELETE | Disposable live Postgres grant/deny checks |
| H17 | slice | `schemas/feature-map.schema.json` + finding envelope tests | Full JSON Schema validator (no Ajv); more malformed cases |
| H18 | ongoing | Behavioural suites under `tests/adversarial/` including `next.test.mjs` | Keep adding observable regressions, not string-presence checks |
| H19 | slice | `templates/memory-bank/README.md` vs live `memory-bank/` | Richer installable Tier 1 templates if adopters need them |
| H20 | slice | Concurrency crash drills; no product `lifecycle/state.json` here | Attestation procedure for a *corrected release* after a bad attest |
| H21 | slice | `CONTRIBUTING.md`, `SECURITY.md`, Node 22+ | Point both handbooks at those files the same way |
| H22 | slice | `docs/reviews/README.md` linked from `progress.md` | Keep new reviews here, not only in `.cursor/cache/` |

Ideas 1–14: **first useful + this increment** are in the tools and `ideas.test.mjs` /
`next.test.mjs`. The L-sized visions in `platform-improvement-ideas-2026-09-10.md`
are **not** complete.
