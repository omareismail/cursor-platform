# Governance hardening — done vs remaining

Status of the platform hardening work started 2026-09-09.
Source of the backlog: the analysis report (items E-01 … E-27).
Implementation lives in this working tree. The enforcement surface was attested 2026-09-09 by omar ismail (`lifecycle/integrity.json`).

**Last updated:** 2026-09-09 (Phase D — E-20, E-21)

| Phase | Scope | Status |
|---|---|---|
| A — Security fixes | E-01 … E-07 + E-27 | **Done** (Phase A committed; later A extras in this landing) |
| B — Lifecycle integrity | E-08 … E-15 | **Done** |
| C — Evidence model | E-16, E-24, E-19 | **Done** |
| Review-fix | R1 … R14 from 2026-09-09 project review | **Done** (plugin rebuilt; attested) |
| D — Orchestration | E-20, E-21 | **Done** |
| E — Brownfield intelligence | E-22, E-23 | **Not started** |
| F — Enterprise governance | E-17, E-18, E-25, E-26 | **Not started** |

Verify locally:

```bash
node tests/run.mjs
node .cursor/tools/self-audit.mjs run
node .cursor/tools/self-audit.mjs integrity    # attested 2026-09-09 by omar ismail
```

---

## Human steps still open

1. **Decide `CURSOR_PLATFORM_DEV=1`.** It is set globally on this machine (`setx`). Right for *this* repo (platform maintenance). Wrong for any adopter repo opened in the same editor. Prefer a per-workspace env.

The enforcement surface was attested on 2026-09-09 (`lifecycle/integrity.json`, 26 files, `--by "omar ismail"`). `--check` is green.

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

---

## Remaining

Say **"OK, implement Phase E"** (then F) to continue.

### Phase E — Brownfield intelligence (P2)

| ID | What to do | Why |
|---|---|---|
| **E-22** | `feature-map` schema v2: `dataObjects` / lineage. `database-audit` catalog-driven proc/trigger step. `impact-analysis` walks lineage | A brownfield change today traces files, not data objects. Stored procs and triggers are invisible |
| **E-23** | Write-policy: also `lib/**`, `apps/**`, `packages/**`, `services/**`. `lifecycle.mjs status` prints a layout hint when no rule matches the detected source roots | `guard-phase` only knows `src/`, `backend/`, `frontend/`. A monorepo writes under `packages/` with the design gate “closed” and nothing blocked |

### Phase F — Enterprise governance (P2 / P3)

| ID | What to do | Why | Priority |
|---|---|---|---|
| **E-17** | Opt-in CI job: signed commits for `lifecycle/**` | Identity on records is still `--by` + `recordedBy`. Signed git is the next rung | P2, opt-in |
| **E-18** | Close remaining `guard-bash` gaps: refspec `+`, `--force-with-lease` + `--force`, `psql -c/-f` DML leftovers, `TRUNCATE` without `TABLE`, `DROP INDEX/VIEW/FUNCTION`, `Remove-Item -Recurse`, `curl \| sh`, `iex`, `npx` | Several shell bypasses the Phase A suite did not pin | P2 — keep regexes precise; false positives block real work |
| **E-25** | Dashboard `Host` header validation | Localhost UI should not answer a forged Host | P3 |
| **E-26** | Agents: state that “read-only” is advisory; drop `Write` from `repo-cartographer` if it only calls tools | Subagents are not mechanically read-only | P3 |

---

## Suggested order from here

```
1. You: re-attest integrity (`session-start.mjs` and `sync-skills.mjs` changed), then commit Phase D
2. Agent: Phase E   (E-22, E-23)
3. Agent: Phase F   (E-18, then E-17, E-25, E-26)
```

Each remaining phase should end with `node tests/run.mjs`, `node .cursor/tools/self-audit.mjs run`, plugin rebuild, and (after you re-attest) `integrity --check`.

---

## See also

- [LIFECYCLE.md](LIFECYCLE.md) — six phases, gates, inheritance, integrity, evidence chain
- [lifecycle/README.md](../../lifecycle/README.md) — what lives under `lifecycle/`
- [IDEA-TO-PRODUCTION.md](IDEA-TO-PRODUCTION.md) — one idea, every command
