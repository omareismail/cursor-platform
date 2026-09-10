# Governance hardening — done vs remaining

Status of the platform hardening work started 2026-09-09.
Source of the backlog: the analysis report (items E-01 … E-27) and the
2026-09-10 project review (`docs/reviews/project-review-2026-09-10.md`).

**Last updated:** 2026-09-10 (R01–R13 corrections)

Statuses are separate on purpose: **implemented** is code in the tree,
**verified** is a passing behavioural suite, **attested** is a human
`integrity --write`, **committed** is on the branch.

| Phase | Scope | Implemented | Verified | Attested | Committed |
|---|---|---|---|---|---|
| A — Security fixes | E-01 … E-07 + E-27 | yes | yes | 2026-09-09 | yes |
| B — Lifecycle integrity | E-08 … E-15 | yes | yes | 2026-09-09 | yes |
| C — Evidence model | E-16, E-24, E-19 | yes | yes | 2026-09-09 | yes |
| Review-fix | R1 … R14 (2026-09-09) | yes | yes | 2026-09-09 | yes |
| D — Orchestration | E-20, E-21 + R09 | yes | yes (`tests/run.mjs` 2026-09-10) | no (index/docs changed) | no |
| E — Brownfield intelligence | E-22, E-23 + R04, R06–R08 | yes | yes (`tests/run.mjs` 2026-09-10) | no | no |
| F — Enterprise governance | E-17, E-18, E-25, E-26 + R01, R02, R05 | yes | yes (`tests/run.mjs` 2026-09-10) | no | no |
| 2026-09-10 review | R01–R13 | yes | yes (`tests/run.mjs` 19/0) | no | no |

Integrity `--check` is **not** green until a human re-attests the current
bytes of `guard-bash.mjs`, `guard-phase.mjs`, `write-policy.json`,
`lifecycle.mjs`, and `_state.mjs`.

Verify locally:

```bash
node tests/run.mjs
node .cursor/tools/self-audit.mjs run
node .cursor/tools/self-audit.mjs integrity
```

```bash
node tests/run.mjs
node .cursor/tools/self-audit.mjs run
node .cursor/tools/self-audit.mjs integrity    # attested 2026-09-09 by omar ismail
```

---

## Human steps still open

1. **Decide `CURSOR_PLATFORM_DEV=1`.** It is set globally on this machine (`setx`). Right for *this* repo (platform maintenance). Wrong for any adopter repo opened in the same editor. Prefer a per-workspace env.
2. **Re-attest** after reviewing the R01–R13 bytes (including `_state.mjs`): `node .cursor/tools/self-audit.mjs integrity --write --by "<name>"`
3. Commit the intended tree (plugin already rebuilt).

The previous attestation (2026-09-09, `--by "omar ismail"`) does not cover the current enforcement-surface bytes. `--check` fails until step 2.

---

## Done

### Phase A — Security fixes (P0)

| ID | What shipped |
|---|---|
| E-01 | `guard-mcp`: unknown server/tool denied; access levels (`deny` / `read-only` / `restricted-write` / `full`); camelCase-aware read/write classification; missing or corrupt policy denies everything |
| E-02 | `_sql.mjs` tokenizer classifier; scans every MCP argument field; `psql` rule in `guard-bash`; `templates/postgres/readonly-role.sql` |
| E-03 | Protected paths (`write-policy.json → protected.paths`) in `guard-write` (incl. Delete) and `guard-bash` (redirects, cmdlets, `rm`/`sed`, interpreters, parent dirs). Escape: `CURSOR_PLATFORM_DEV=1` |
| E-04 | Windows-safe `relPath` / `fileURLToPath` for plugin `file:` URLs and drive-letter case |
| E-05 | Corrupt `lifecycle/state.json` is a **closed** gate, not a missing one. `status` names the corruption and does not suggest `init` |
| E-06 | `failClosed: true` on Cursor deciding events; `_lib.ok()` emits `{"permission":"allow"}` so a silent exit is not treated as a failed hook |
| E-07 | Human-only from the agent shell: `approve`, `override`, `init --existing`, `sign` (later also `integrity --write` and `evidence reseal`) |
| E-27 | `tests/run.mjs` + adversarial suites; CI `guards` job |

Also landed in A (not in the original IDs): read-tool exemption in `guard-write` (Read/Grep/Glob were being blocked as writes); synchronous `emit()` in `_lib.mjs` so Windows hooks flush before `exit`.

### Phase B — Lifecycle integrity (P1)

| ID | What shipped |
|---|---|
| E-08 | Directory artifacts hash by **content**, recursively (`dir2:`). Recorded `dir:` hashes keep v2 semantics until re-approved. Every present `anyOf` alternative is hashed |
| E-09 | Typed artifacts (`document`, `adr-set`, `spec-set`, `source-tree`, `test-suite`, `task-board`, `pipeline`). `approve` runs the id-chain check and `ac-trace` for TESTING; failures need `--accept-check <tool>` |
| E-10 | `_state.mjs`: atomic write (temp + rename), `revision` compare-and-swap, lock, `nextSequentialId` (max+1). Schema v3 |
| E-11 | `INHERITED` needs `--by` + `--review-by`. Otherwise `INHERITED_UNVERIFIED` (source writes open; `sign` needs `--accept-inherited PHASE`). `init --existing` refuses an empty repo |
| E-12 | `recordedBy` (os / git / email / ci / host) beside `--by`; mismatch is a warning, not a refusal |
| E-13 | `session-start.mjs` derives status through `lifecycle.mjs` (`APPROVED` / `INHERITED` / `u` / `STALE` / corrupt) |
| E-14 | `feature-map.mjs reasons()` no longer crashes on a stale trace |
| E-15 | `self-audit.mjs integrity` → `lifecycle/integrity.json`. `--write` is human-only. CI job here (strict) and in the adopter template (skips if absent) |

### Phase C — Evidence model (P2)

| ID | What shipped |
|---|---|
| E-16 | `_evidence.mjs` + `lifecycle/index.jsonl`. Every record is chained. `lifecycle.mjs evidence` walks it. `approve` / `sign` refuse on a broken chain. Repair: `evidence reseal --by --reason` (human-only) |
| E-24 | `release-evidence cut` refuses a FAILED checker unless `--accept-check <tool.mjs>`. Exit 2 (nothing to check) is skipped, not failed |
| E-19 | `schemas/finding.schema.json` + `_findings.mjs`. Every checker’s `--json` is one envelope. Dashboard Findings panel consumes it |

**Tests (this tree):** `node tests/run.mjs`. Plugin rebuilt with the source. `self-audit.mjs integrity` is green only while `lifecycle/integrity.json` matches the attested files — re-attest after changing `_evidence.mjs` or `release-evidence.mjs`.

---

### Review-fix — 2026-09-09 project review (R1–R14)

Source: `.cursor/cache/project-review-2026-09-09.md`. These were runtime failures in guarantees the existing suite did not cover. They are not Phase D.

| ID | What shipped |
|---|---|
| R1 | `lifecycle/integrity.json`, `lifecycle/index.jsonl`, `_state.mjs`, `_evidence.mjs`, `self-audit.mjs`, `release-evidence.mjs` protected in `write-policy.json` and `PROTECTED_FALLBACK`. Tests name each path (direct write, Delete, fallback). |
| R2 | `writeState()` asserts the on-disk `state.json` still matches the evidence chain (under the lock) before replacing it. `record-gate` no longer absorbs a CHANGED file. |
| R3 | Release checkers resolve as siblings of the running tool. A missing required checker is a failure. Plugin-only cut still sees `flag-debt`. |
| R4 | Integrity enumerates plugin files from the tool's install directory. Empty or incomplete coverage is FAIL; a deleted attested guard is still MISSING. |
| R5 | `derivePhase()` stales when a new `anyOf` root appears (`frontend/` after `src/`, `e2e/` after `tests/`). |
| R6 | AC ids are `slug:AC-N`. Bare AC-N in another feature cannot borrow coverage. |
| R7 | `describe.skip` (brace-matched) marks contained tests skipped. |
| R8 | Adopter CI `node -e` override reporter is valid JS (`process.exit`, no top-level `return`). |
| R9 | Bootstrap docs copy `.claude`, `schemas`, and `CLAUDE.md`, not only `.cursor` / `memory-bank` / `AGENTS.md`. |
| R10 | `cut` refuses untracked files under approved source/test/spec roots. |
| R11 | SQL classifier recognises quoted and schema-qualified function ids (`"pg_sleep"`, `pg_catalog."lo_unlink"`). |
| R12 | `guard-phase` shares `isReadTool` with `guard-write`. |
| R13 | Incidents `--json` fails on a weak (rung-7) guard the same way as text (exit 1). |
| R14 | `toBeDefined` next to a real assertion is not weak-alone. |

### Follow-up — 2026-09-09 (`followup-review-2026-09-09.md`)

| ID | What shipped |
|---|---|
| F1 | `commitIndexedRecord()` locks the file, asserts the chain still matches, then writes and indexes. `change-request close` and `release-evidence` cut/sign use it. A tampered CR is no longer absorbed by close. |
| F2 | Skipped-suite brace matching ignores `{`/`}` inside strings and comments. |
| F3 | `PayTests.cs` maps to spec slug `pay` in both global and scoped `ac-trace check`. |

### Phase D — Orchestration (E-20, E-21)

| ID | What shipped |
|---|---|
| E-20 | `.cursor/skills.index.json` generated by `sync-skills` / `_skills-index.mjs`. Category, phase, capability, workflow, requires. SessionStart prints a one-line capability summary. `docs-lint` fails if the index is missing, stale, or a live skill has no catalog row. `change-request` added to `skill-catalog.md`. Retired skills (`refactor-assistant`, `security-perf-report`) recorded in the index and `skill-graph.md`. Plugin ships `skills.index.json`. |
| E-21 | `docs-lint` matches hyphenated `N-skill` counts, cited `.mdc` files, and Arabic `مهارة` / `المهارات الـN` in `HANDBOOK.ar.md`. `count-ok` skips a frozen figure. |

### Phase E — Brownfield intelligence (E-22, E-23)

| ID | What shipped |
|---|---|
| E-22 | `feature-map` schema v2: `dataObjects`, `byObject`, `lineage <feature\|object\|table>`. v1 maps still load. `database-audit` Step 4b upserts catalog objects. `/impact-analysis` walks `query --object` and `lineage` |
| E-23 | Write-policy and the BUILTIN fallback also match `lib/**`, `apps/**`, `packages/**`, `services/**`. `lifecycle.mjs status` prints a layout hint (and `--json` `layout`) when a detected source root is not gated |

### Phase F — Enterprise governance (E-17, E-18, E-25, E-26)

| ID | What shipped |
|---|---|
| E-17 | Opt-in `templates/ci/signed-lifecycle.yml`: GitHub-verified signatures on commits that touch `lifecycle/**`. Not wired into this repo's CI |
| E-18 | `guard-bash`: `+` refspec, `--force` with `--force-with-lease`, `psql < file` / `cat \| psql`, `TRUNCATE` without `TABLE`, `DROP INDEX/VIEW/FUNCTION`, `Remove-Item -Recurse` of `/` `C:\` `~`, `curl \| sh`, `iex (irm …)`, `npx --yes` |
| E-25 | Dashboard refuses a Host header that is not localhost / `127.0.0.1` / `[::1]` |
| E-26 | Every agent states read-only is advisory. `repo-cartographer` no longer declares `Write`; the map is persisted by the main thread |

---

### Review-fix — 2026-09-10 project review (R01–R13)

Source: `docs/reviews/project-review-2026-09-10.md`. Runtime and packaging
failures the existing suite did not cover. Behavioural regressions live under
`tests/adversarial/` (bash, brownfield, enterprise, plugin, hash, orchestration,
concurrency).

| ID | What shipped |
|---|---|
| R01 | `guard-bash` tokenizes statements and argv; `--force` / `-f` / quoted `+refspec` denied; `--force-with-lease` still allowed |
| R02 | PowerShell `Remove-Item` classified from named/positional args in any order; aliases `ri`/`rm`/`rd`/`rmdir`/`del`/`erase`; `-Path`/`-LiteralPath` |
| R03 | `build-plugin --out` refuses repo root, ancestors, forbidden tops, and unmarked directories before recursive delete |
| R04 | One `SOURCE_ROOTS` list for lifecycle DEVELOPMENT `anyOf`, hashing, inheritance, and adopter CI `find` |
| R05 | `signed-lifecycle-range.mjs` uses full push `before..after` / PR base..head; invalid range fails (no `\|\| true`) |
| R06 | Reciprocal feature-map lineage: table index walks objects; callers via `byObject` without duplicating `features[]` |
| R07 | Object `definitionFiles` in freshness/indexing; catalog-only objects stamp `definitionSource` |
| R08 | `sourceLayout()` uses effective policy (local or BUILTIN); reports covered / exempt / uncovered |
| R09 | Skill categories from `skill-catalog.md` headings; `code-review-assistant` and `dotnet-schema-diff` require `repo-discovery` |
| R10 | `build-plugin check` digests installed bytes (except BUILD) and compares to the stamp plus a source rebuild |
| R11 | Path rewrite limited to shipped docs; `architecture-map-gen` still writes `.cursor/docs/architecture/` in the consuming repo |
| R12 | Plugin ships `IDEA-TO-PRODUCTION.md` and `LIFECYCLE.md`; packaged docs are link-checked; historical reports marked platform-only |
| R13 | `_state.mjs` lock retries `EPERM`/`EBUSY`/`EACCES` then throws `ELOCKED` instead of an uncaught error |

**Verified:** `node tests/run.mjs` — 19 suites, 0 failed (2026-09-10). Plugin rebuilt and `check` in sync.

---

## Remaining

E-01 … E-27 from the 2026-09-09 analysis and R01–R13 from the 2026-09-10
review are implemented and verified. The plugin was rebuilt. Human
attestation and commit are still open. Optional H01–H22 remain backlog.

```
node .cursor/tools/self-audit.mjs integrity --write --by "omar ismail"
```

---

## See also

- [LIFECYCLE.md](LIFECYCLE.md) — six phases, gates, inheritance, integrity, evidence chain
- [lifecycle/README.md](../../lifecycle/README.md) — what lives under `lifecycle/`
- [IDEA-TO-PRODUCTION.md](IDEA-TO-PRODUCTION.md) — one idea, every command
