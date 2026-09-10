# Project review — 2026-09-10

The platform has substantial working infrastructure, but the current implementation should not be described as
completely correct.
This review found 12 implementation defects and one intermittent Windows locking failure, plus documentation
and completion gaps.
Phase D is committed; Phase E and Phase F are present in the working tree. Their implementation still needs
corrections and
verification before final attestation.

This is a review, not a lifecycle approval. No production code, policies, signatures, commits, or real
database records were
changed by this review. Reproductions used disposable repositories or a plugin copy under the ignored review
cache. Dangerous
shell examples were submitted only to the guard classifier; they were never executed.

## Scope and evidence

Reviewed branch `platform-ui`, based on commit `3d62f8c`, including the uncommitted E/F work. Inventoried 547
existing tracked or
pending files before adding this report. Coverage combined repository-wide structural checks with detailed
review and isolated
reproductions of the enforcement, orchestration, database mapping, packaging, and adoption workflows. It does
not mean that every
prose sentence or external host integration was exercised.

| Check | Result |
|---|---|
| JavaScript syntax | All 88 existing `.mjs` files parsed |
| JSON syntax | All 28 existing JSON files parsed |
| Skill structure | All 98 skills checked; dashboard lacks the standard Output section |
| Rules | All 12 rule names and required frontmatter fields checked |
| Full test run | 18 suites; 17 passed, concurrency failed; 839 assertions passed and 2 failed |
| Concurrency retry | All 30 assertions passed; initial failure remains a recorded intermittent issue |
| Platform self-audit | PASS, including docs-lint, platform metadata, and plugin build-stamp comparison |
| Integrity | FAIL: four protected files differ from the human attestation |
| Additional behavior checks | Reproduced the failures described below despite the existing checks passing in those areas |

Tests ran on Windows with Node 24.19.0. The repository's CI uses Linux with Node 22. This review did not run
GitHub Actions,
install application-template dependencies, connect to a database, or exercise a live Cursor/Claude installation.

Local evidence is retained in the ignored cache:

- Behavior reproductions — `D:/repos/cursor/.cursor/cache/review-repros-2026-09-10.json` and reproduction script —
  `D:/repos/cursor/.cursor/cache/review-repros-2026-09-10.mjs`.
- Structural scan — `D:/repos/cursor/.cursor/cache/review-scan-2026-09-10.json` and reviewed source hashes —
  `D:/repos/cursor/.cursor/cache/full-review-snapshot-2026-09-10.json`.
- Full test log — `D:/repos/cursor/.cursor/cache/full-review-tests-2026-09-10.log`, concurrency retry —
  `D:/repos/cursor/.cursor/cache/full-review-concurrency-retry-2026-09-10.log`, self-audit —
  `D:/repos/cursor/.cursor/cache/full-review-self-audit-2026-09-10.log`, and integrity result —
  `D:/repos/cursor/.cursor/cache/full-review-integrity-2026-09-10.log`.
- Plugin drift reproduction — `D:/repos/cursor/.cursor/cache/plugin-drift-repro-2026-09-10.log`. The
  deliberately altered plugin
  is a review copy, not the distributable.

## Findings requiring correction

P1 means fix before relying on the affected protection or workflow. P2 means a functional or verification
defect that should be
corrected before calling the hardening complete.

### R01 — P1: Force-push checks accept ordinary shell separators and quoted refspecs

guard-bash.mjs:203 — `D:/repos/cursor/.claude/hooks/guard-bash.mjs:203`

The guard denies `git push --force`, but allows `git push --force; echo done` and `git push -f&&echo done`. The new flag
expression accepts whitespace or end-of-input after the flag, but not shell command separators. It also allows
`git push origin
"+main:main"`, because the refspec expression expects the plus directly after whitespace.

These are equivalent destructive operations expressed with normal shell syntax. Tokenize command segments and
arguments before
classifying them. Add regression cases for separators, quoting, and argument variants while retaining the permitted
`--force-with-lease` case. Host-level permission prompts may offer another boundary; they do not make this
guard correct.

### R02 — P1: PowerShell recursive-delete detection depends on argument order

guard-bash.mjs:227 — `D:/repos/cursor/.claude/hooks/guard-bash.mjs:227`

The guard denies `Remove-Item -Recurse C:\ -Force` but allows `Remove-Item C:\ -Recurse -Force`. The
expression only recognizes a
dangerous target after `-Recurse`. PowerShell permits the target first.

Parse named and positional arguments independently of order, then classify the resolved target. Cover aliases and
`-Path`/`-LiteralPath` variants. These examples were classified in a fixture only; no deletion was executed.

### R03 — P1: Plugin build can recursively delete an unsafe output directory

build-plugin.mjs:123 — `D:/repos/cursor/.cursor/tools/build-plugin.mjs:123`

`build --out` joins arbitrary input to the repository root and recursively removes the resulting directory at
line 129. There is
no check rejecting the repository root, an ancestor, or an unrelated directory. For example, `--out .`
resolves to the repository
itself. This finding is based on source inspection; the destructive case was not run.

Validate the resolved output path before removal. Reject the repository root, source trees, ancestors, and
paths outside the
intended build area; require a recognizable generated-output marker before replacing an existing directory.
Add tests that prove
rejected paths remain untouched.

### R04 — P1: New source roots are recognized by the hook but not by the complete lifecycle

lifecycle.mjs:135 — `D:/repos/cursor/.cursor/tools/lifecycle.mjs:135` and lifecycle-gates.yml:72 —
`D:/repos/cursor/templates/ci/lifecycle-gates.yml:72`

Phase E adds `lib/`, `apps/`, `packages/`, and `services/` to source-write policy. However, the DEVELOPMENT
source artifact still
only accepts `src`, `backend`, `frontend`, or `client`. An isolated project with `packages/api/main.ts` is
reported as having no
application source even though status calls `packages` covered.

The adopter CI design check also searches the old root list and omits the four new roots. It can overlook
source in those folders
before DESIGN is approved. Artifact hashing and change detection likewise derive from the narrower artifact list.

Use one source-root definition across hook policy, lifecycle artifact checks, hashing, inheritance, and CI.
Test a project that
has only a newly supported root, plus adding that root after approval.

### R05 — P1: Signed-lifecycle CI examines only the last commit on push

signed-lifecycle.yml:49 — `D:/repos/cursor/templates/ci/signed-lifecycle.yml:49`

For push events, the workflow sets its range to `HEAD^..HEAD`. A push containing an unsigned lifecycle change
followed by a
documentation-only commit produces an empty lifecycle commit list. The isolated Git-history reproduction
confirms that the
lifecycle-changing commit is not selected. In addition, `git log ... || true` converts a bad range into a
successful empty result.

Determine the complete pushed range from the event's before/after commits, handle first pushes and manual runs
explicitly, and
fail on an invalid range. Exercise the shell step against fixture histories rather than only checking that the
YAML contains
signature-related strings.

### R06 — P1: Database lineage misses callers and catalog-only table connections

feature-map.mjs:546 — `D:/repos/cursor/.cursor/tools/feature-map.mjs:546`

A feature declares `lineage.calls: ["dbo.usp_Settle"]`; the catalog object declares `tables: ["Payments"]`.
Both are accepted by
upsert. `query --object dbo.usp_Settle` correctly finds the feature. However, `lineage dbo.usp_Settle` returns
no features, and
`lineage Payments` returns no objects or features.

Object traversal relies on a duplicate `object.features` list, while table indexing only indexes objects'
explicitly listed
features. A caller that knows only its procedure should not also have to duplicate the procedure's table
dependencies for
traversal to work.

Build reciprocal edges from every supported declaration and seed table traversal directly. Add catalog-first,
one-sided-link, and
procedure-only-caller cases; the current tests duplicate both tables and feature links, masking these failures.

### R07 — P2: SQL definition changes do not invalidate mapped objects or their consumers

feature-map.mjs:203 — `D:/repos/cursor/.cursor/tools/feature-map.mjs:203` and feature-map.mjs:441 —
`D:/repos/cursor/.cursor/tools/feature-map.mjs:441`

Upsert stores hashes for object `definitionFiles`, but freshness verification only examines feature `files`.
After changing the
saved procedure definition from `Payments` to `OtherAccounts`, `verify` exits successfully and reports the
consumer fresh. `query
--file db/settle.sql` also returns no hits.

Include object definitions in file indexing and freshness checks, and expose affected consumers. For live
catalog objects without
files, record the source and snapshot freshness explicitly so absence of a definition file is not treated as
evidence of unchanged
behavior.

### R08 — P2: Source-layout diagnostics disagree with actual policy enforcement

lifecycle.mjs:587 — `D:/repos/cursor/.cursor/tools/lifecycle.mjs:587`

`sourceLayout()` flattens rule matches from the local policy and checks a synthetic `x.cs` path. It does not account for
`alwaysAllow`, relevant rule semantics, or the hook's fallback policy.

Two fixtures demonstrate the mismatch: adding `packages/**` to `alwaysAllow` leaves status saying the root is
covered while the
hook allows the write before DESIGN; omitting the local policy makes status say the root is uncovered while
the built-in policy
correctly denies it.

Share effective-policy resolution and classification with the hook. Distinguish gated, intentionally exempt,
and unrecognized
paths in the status output.

### R09 — P2: Fifteen generated skill categories contradict the routing catalog

_skills-index.mjs:114 — `D:/repos/cursor/.cursor/tools/_skills-index.mjs:114`

The classifier uses name suffixes and incomplete sets instead of the documented category assignments. This
affects capabilities,
generated skill guidance, and the category summary. The lint check regenerates the same classification, so it
cannot detect
semantic disagreement.

| Skills | Catalog | Generated index |
|---|---|---|
| operability-gen, release-safety, postmortem, enterprise-report-gen, load-test-gen | B | A |
| dotnet-perf-profile, dotnet-query-optimizer, dotnet-schema-diff, code-review-assistant, technical-debt-tracker, platform-health-validator | B | C |
| architecture-map-gen, onboarding-doc-gen, changelog-gen, release-notes-gen | C | A |

Resolve categories in one authoritative source and generate other representations from it. Some catalog labels
themselves deserve
review: a section described as strictly read-only includes skills that generate artifacts. Do not assume that
simply copying every
existing label settles the semantic contract.

### R10 — P2: Plugin verification compares saved stamps rather than installed content

build-plugin.mjs:423 — `D:/repos/cursor/.cursor/tools/build-plugin.mjs:423`

`check` compares the existing BUILD stamp with a fresh build's stamp. It does not recompute the existing
tree's digest. After a
disposable plugin was built, its dashboard skill was edited without updating BUILD. `check` still exited 0 and
reported “in sync.”

Recompute the installed tree's digest or compare complete manifests and bytes, including missing and extra
files. The platform's
separate CI rebuild-and-diff step offers additional protection, but the standalone checker and callers such as
self-audit remain
misleading.

### R11 — P2: Plugin rewriting moves project output into the installation directory

build-plugin.mjs:84 — `D:/repos/cursor/.cursor/tools/build-plugin.mjs:84` and packaged architecture skill:173 —
`D:/repos/cursor/plugin/skills/architecture-map-gen/SKILL.md:173`

The builder rewrites every `.cursor/docs/` path to the plugin root. In `architecture-map-gen`, that path is
the destination for
generated project diagrams, not a bundled reference. The installed skill consequently tells the agent to write
project diagrams
under `${CLAUDE_PLUGIN_ROOT}/docs/architecture/`.

Keep generated project artifacts in the consuming repository. Distinguish bundled inputs from project-owned
outputs before
rewriting paths. Test the installed skill's output contract, not just whether a source rebuild produces identical text.

### R12 — P2: The packaged entry point links to an omitted lifecycle runbook

build-plugin.mjs:51 — `D:/repos/cursor/.cursor/tools/build-plugin.mjs:51` and packaged START-HERE:40 —
`D:/repos/cursor/plugin/docs/START-HERE.md:40`

The packaged START-HERE document directs users to `${CLAUDE_PLUGIN_ROOT}/docs/IDEA-TO-PRODUCTION.md`, but the
shipping whitelist
omits that file. Other links point to intentionally omitted historical reports. Source docs-lint skips the
generated plugin, and
build checking only compares the expected generation.

Ship required runtime documentation and remove or redirect references to intentionally unshipped history.
Validate packaged
reference targets. The architecture diagram example flagged by the structural scan is an output example, not
an additional missing
reference; its actual problem is R11.

### R13 — P2, intermittent: Windows lock contention can escape as an uncaught error

_state.mjs:120 — `D:/repos/cursor/.cursor/tools/_state.mjs:120`

The full suite's concurrent gate writers produced `EPERM` opening `state.json.lock`. The lock loop handles
`EEXIST` but propagates
this Windows error, yielding an uncaught stack trace instead of the intended conflict/refusal response. Two
assertions failed. A
focused retry passed all 30 assertions.

Investigate transient sharing failures separately from permanent access errors, then provide bounded retry or
a clear refusal.
Preserve exclusive-lock semantics. This review did not observe lost decisions or corrupted state; it
establishes an intermittent
error-handling defect, not data loss.

## Completion and documentation gaps

1. **Integrity is currently failing.** Changed files are `guard-bash.mjs`, `guard-phase.mjs`, `write-policy.json`, and
  `lifecycle.mjs`. Correct and review the implementation before a human re-attests it. Existing attestations
  do not cover the
  current bytes.
2. **Status documentation contradicts the checks.** HARDENING-STATUS marks D/E/F Done and states that
  integrity is green, then
  later says re-attestation remains necessary. Use separate statuses for implemented, verified, attested, and
  committed. Record
  the findings in this review as open work.
3. **Tier 1 memory is incomplete.** `techContext.md` and `systemPatterns.md` still contain
  application-template placeholders even
  though this repository is a Node-based platform. The structural map was refreshed during review. Keep
  adopter templates distinct
  from the platform's own live context; do not replace human-owned standards with inferred examples.
4. **Dependency and rule documentation has drifted.** The skill graph says `code-review-assistant` and
  `dotnet-schema-diff`
  explicitly depend on discovery, but neither skill spells out that prerequisite. Shared-execution-pipeline
  calls several rules
  `alwaysApply` although their actual frontmatter uses `alwaysApply: false` and file globs. Align the
  instructions and their
  descriptions.
5. **Dashboard skill format is incomplete.** It lacks the standard `## Output` section. The header scan found
  no other missing
  Overview/Steps/Output section among the 98 skills.
6. **The hardening status page lacks an inbound filename reference in the scanned source docs.** Link it from
  an entry point.
  Template files flagged by a simple filename scan are generally linked through `templates/README.md` or
  directory references;
  they are not proven dead files and should not be deleted automatically.

## Folder coverage and enhancement backlog

The improvements below extend the platform beyond fixing R01–R13. They are proposals, not claims that those
capabilities already
exist or that every item is required for this release.

| Area | Reviewed / present | Enhancement or missing follow-through |
|---|---|---|
| `.claude/hooks/` | Common host adapter, SQL classifier, write/phase/shell/MCP controls; adversarial tests | H01: Add argument-order, quoting, separator, alias, and nested-command test matrices. Use shared parsing where possible instead of adding unrelated regular expressions. |
| `.claude/agents/` | All 14 advisory notices present; cartographer no longer declares Write | H02: Exercise actual host tool restrictions in an installed-host smoke test. Keep advisory instruction separate from enforceable permissions. |
| `.claude/skills/` | Generated shims and descriptions | H03: Validate routing category, prerequisite, and target-path semantics, not merely generated file counts. |
| `.cursor/skills/`, `.cursor/skills.index.json` | 98 skills, generated category/phase/capability/dependency metadata | H04: Define explicit metadata for prerequisites and phase constraints, including cross-phase exceptions; validate catalog, index, and skill body agreement. |
| `.cursor/rules/`, `.cursor/lifecycle/` | Twelve rule files, gate templates, protected paths and source policy | H05: Use one effective policy model for host guards, status, artifact coverage, and adoption CI. Make intentional exemptions visible. |
| `.cursor/tools/` | Syntax checked; runtime coverage through 18 suites and targeted reproductions | H06: Extend atomic revision-aware writes to feature-map updates; test two concurrent feature/object upserts and interruption during save. |
| `.cursor/tools/feature-map.mjs` | v2 catalog objects, v1 migration, queries and lineage | H07: Add explicit data-source identity, provider-aware identifier handling, object-to-object dependencies, and live-catalog snapshot provenance. Evaluate large-graph performance with representative fixtures. |
| `.cursor/tools/dashboard.mjs` | Host allowlist passes its direct cases; command composition stays separate from execution | H08: Add HTTP-level tests for Host handling, response methods, error envelopes, and packaged installations; add keyboard, narrow-screen, and Arabic/RTL UI checks. |
| `.cursor/docs/` | Catalog, dependency graph, workflow and adoption documentation; source lint passes | H09: Generate factual inventories from structured metadata; check bundled links and distinguish frozen historical records from current status. |
| `.cursor/cache/` | Structural map and review evidence; deliberately ignored | H10: Broaden discovery freshness inputs to relevant source/config additions and removals. Keep durable review conclusions outside this disposable cache. |
| `plugin/` | Self-contained generated tools, hooks, skills, rules and schemas; build-stamp check passes | H11: Add an end-to-end plugin-only adopter fixture with no local `.cursor/tools`, including generated artifact destinations and package reference resolution. |
| `.claude-plugin/` | Plugin and marketplace manifests | H12: Establish release/version notes and explicit distribution terms. The manifest points to a README license statement, while the README asks the owner to add a license. This is an owner decision, not a license selected by this review. |
| `.github/workflows/` | Syntax, guards, audit, integrity, evidence and plugin jobs | H13: Add Windows alongside Linux and cover the supported Node versions. Preserve the original failure log when a rerun succeeds. |
| `templates/ci/` | Quality, lifecycle, and opt-in signature workflows | H14: Execute extracted workflow steps against fixtures, especially commit ranges and source layouts. Keep locked dependency restore strict when selected; the current .NET restore falls back to an unlocked restore. Document advisory gates such as Stylelint honestly. |
| `templates/dotnet/`, `templates/react/`, `templates/mutation/` | Analyzer, architecture, lint and mutation templates inspected; not built against installed dependencies | H15: Maintain minimal adopter applications that compile and run these templates. Test that valid same-feature imports pass, forbidden imports fail, and component/API overrides preserve unrelated lint restrictions. Verify mutation and coverage gates actually reject a failing sample. |
| `templates/postgres/` | Read-only-role template; no live database execution | H16: Add disposable database integration checks for role grants and destructive-query denial, including deployment-specific schemas and newly created objects. |
| `schemas/` | Three JSON schema documents parsed; finding-envelope coverage in tests | H17: Add schema-conformance tests for emitted reports and versioned feature-map payloads, including malformed objects, migration round trips, and unknown fields. JSON syntax alone is not schema validation. |
| `tests/` | Eighteen suites; targeted D/E/F additions exist | H18: Add each review reproduction as a behavioral regression. Avoid checking only that implementation strings exist; test observable results and failure paths. |
| `memory-bank/` | Active/progress records plus example/reference files | H19: Separate installable memory templates from the platform's real Tier 1 context, and track review findings with owners and completion evidence. |
| `lifecycle/` | Human integrity manifest and documentation; no product state | H20: Keep the absence of product state valid for this platform. Add recovery drills for interrupted state/evidence writes and define the attestation procedure for corrected releases. |
| Root docs and configuration | README, English/Arabic handbooks, agent entry points, line-ending and ignore rules | H21: Add concise contributor/setup guidance, supported runtime information, and a vulnerability-reporting route if distributing the platform. Keep language editions and installation modes consistent. |
| `docs/` | No existing application documents were found; this review is now stored here | H22: Retain durable reviews and decisions with links from progress tracking, while leaving logs and disposable fixtures in the ignored cache. |
| `.git/` | Read only for branch, tracked-file inventory and history context | Repository internals were excluded from content modification and source-quality scanning. No cleanup or rewrite is proposed. |

The generated index had no dependency cycles, and no skill Overview sections were exact duplicates. These
mechanical results are
not proof that all narrative workflows are semantically independent.

## Phase D / E / F assessment

| Phase | What is implemented and exercised | What prevents a complete verdict |
|---|---|---|
| D | Index generation, session summary, catalog-presence checks, expanded documentation lint | R09 classification conflicts; semantic metadata and dependency checks remain incomplete |
| E | v2 objects, v1 loading, query/lineage commands, additional source globs, layout output | R04 and R06–R08; current tests over-specify graph links and miss complete monorepo lifecycle behavior |
| F | Additional shell patterns, optional signature workflow, dashboard Host filter, agent notices | R01, R02 and R05; integration coverage is weaker than the completion claims |

## Recommended order

1. Correct destructive-operation and unsafe-output-path checks: R01–R03.
2. Correct lifecycle/source and signature coverage: R04–R05.
3. Correct lineage, freshness, policy diagnostics and routing: R06–R09.
4. Correct packaged-content verification, output paths and documentation: R10–R12.
5. Investigate R13, add behavioral regressions, then rerun the full suite on the supported operating systems.
6. Reconcile status/memory, rebuild and verify the actual plugin bytes, and only then have a human attest the corrected
  enforcement surface and commit the intended changes.

Optional enhancements H01–H22 can then be prioritized by adopter needs. None of the passing structural checks
should be used to
waive the concrete failures above.
