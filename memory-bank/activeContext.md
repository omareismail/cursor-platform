# Active Context
**Last Updated:** 2026-09-09 14:30
**Current branch:** main (uncommitted working tree)
**Recently modified files:** `.claude/hooks/{_lib,_sql,guard-write,guard-bash,guard-mcp,guard-phase}.mjs`, `.cursor/mcp-policy.json`, `.cursor/lifecycle/write-policy.json`, `.cursor/hooks.json`, `.cursor/tools/{lifecycle,self-audit,build-plugin,platform-metadata,artifact-schema}.mjs`, `tests/**`, `templates/postgres/readonly-role.sql`, `.github/workflows/platform-checks.yml`, docs (`CLAUDE.md`, `HANDBOOK*.md`, rule 11, `lifecycle-gate` skill, `mcp-ecosystem.md`, `lifecycle/README.md`), `plugin/` (rebuilt)
**Active feature:** Governance hardening, Phase A (P0) — complete, awaiting commit and Phase B go-ahead

## What was just done (Phase A)

- **E-01** `guard-mcp.mjs`: unknown server/tool → deny; policy v2 access levels (`deny` / `read-only` / `restricted-write` / `full`); camelCase-aware read/write classification; missing or corrupt policy denies everything.
- **E-02** `_sql.mjs`: tokenizer-based statement classifier (CTE writes, `EXPLAIN ANALYZE`, multi-statement behind comments/literals, `FOR UPDATE`, `SELECT INTO`, denied functions); scans every argument field; `psql` rule in `guard-bash`; `templates/postgres/readonly-role.sql` as the system-boundary layer.
- **E-03** Protected paths (`write-policy.json → protected.paths`, fallback in `_lib.mjs`): `guard-write` (all tools incl. Delete) and `guard-bash` (redirects, cmdlets, rm/mv/cp/sed, interpreters, git checkout/restore, cd-rebased, parent dirs) refuse agent writes to hooks, wiring, policies, `lifecycle.mjs`, `.mcp.json`, lifecycle records. Escape `CURSOR_PLATFORM_DEV=1`.
- **E-04** `relPath` / `fileUrlPath` fixed for Windows drive-letter case and plugin `file:` URLs; `artifact-schema.mjs` fallback path fixed.
- **E-05** `lifecycle.readStateInfo()`: corrupt state ≠ missing; `guard-phase` / `guard-mcp` fail closed; `lifecycle.mjs` no longer suggests `init` over a corrupt file.
- **E-06** `failClosed: true` on the four guards in `.cursor/hooks.json` and the generated plugin wiring; `_lib.ok()` answers `{"permission":"allow"}` on Cursor deciding events (Cursor treats silent exit 0 as failure); self-audit **A10** (failClosed + allow line) and **A11** (protected list vs fallback).
- **E-07** `guard-bash` refuses `lifecycle.mjs approve|override|init --existing` and `release-evidence.mjs sign` from the agent shell, no escape.
- **E-27** `tests/_harness.mjs`, `tests/run.mjs`, `tests/adversarial/{sql,mcp,bash,write,state,paths}.test.mjs` — 342 assertions, 7 suites; CI `guards` job runs `tests/run.mjs`; self-audit A7 requires it.

## Next logical step

1. Human review + commit of the working tree (agent cannot edit hooks/policies any more — by design).
2. Phase B — Lifecycle integrity (P1) from the analysis report: recursive content hashes + `anyOf` (E-08), typed artifact evidence + traceability at `approve` (E-09), atomic writes + `revision` CAS (E-10), `INHERITED` basis / `INHERITED_UNVERIFIED` (E-11), actor capture on approvals (E-12), `session-start` derives status via `lifecycle.mjs` (E-13), `feature-map.mjs reasons()` crash (E-14), integrity manifest `lifecycle/integrity.json` (E-15).

## Open questions for the human

- Whether `CURSOR_PLATFORM_DEV=1` should be set in this (platform) repo's editor environment, so the platform's own maintenance sessions can edit hooks — or whether hook edits should always go through a human.
