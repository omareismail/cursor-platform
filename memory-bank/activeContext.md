# Active Context
**Last Updated:** 2026-09-16
**Current branch:** platform-ui
**Recently reviewed implementation:** `omniroute.mjs`, the MCP policy and guard-bash gateway rules, `context-cost.mjs`, `guard-bash.mjs` B11 rules; plugin digest `6aee0c3b8b2a2a77`
**Active feature:** Project Command Center (`IDEA-001`, IMPLEMENTING)

## OmniRoute adopted as a router, never a rewriter — 2026-09-16

Assessed [OmniRoute](https://github.com/diegosouzapw/OmniRoute) (MIT, 66.5k
stars, npm `omniroute@3.8.50`) and **adopted it as an optional, human-run local
LLM gateway** on eight rules, recorded as
[ADR-0001](../docs/adr/0001-omniroute-local-llm-gateway.md) and `IDEA-006`. The
platform never installs, starts, configures or asks a completion of it; a human
runs it, Docker on loopback preferred.

**This is the architecture the platform declined the day before**, in the
caveman/headroom assessment above — sit at `ANTHROPIC_BASE_URL`, rewrite the
traffic. The ADR addresses that head-on rather than around it: the distinction
is routing versus rewriting. Rule 8 forbids every compression engine, payload
rule, `INPUT_SANITIZER_MODE=block` and request-side PII or credential rewriting,
because those delete the evidence `findings[]` and `/task-verify` run on. A
gateway with compression on is caveman with more providers and the earlier
decision applies unchanged. Rules 3 and 8 are documented and **not** checkable
from here, which is the honest residual risk and is written into the ADR's watch
points.

**What makes rule 4 real.** `ANTHROPIC_DEFAULT_*_MODEL` silently remaps what
Claude Code's tiers resolve to, and OmniRoute surfaces non-Claude models as
`claude/<provider>/<model>` aliases, so a gate verdict could come from a small
free model wearing a Claude-shaped name. `.cursor/tools/omniroute.mjs` derives
the protected tiers from each gate file's `**Reviewed by:**` and that agent's
`model:` (today opus and sonnet, from six gates; no gates means an `assumed`
opus+sonnet), and exits 1 when one is remapped. `native` is
`/^claude-[a-z0-9][a-z0-9.-]*$/` — no slash, so the alias fails it. `tiers` is
environment-only and is what `/lifecycle-gate` step 7a and `/lifecycle` step 1a
call; `status` and `models` add ONE loopback `GET /v1/models`, 1500 ms, no
redirects, never a completion, nothing written. A non-loopback base URL is
refused before a socket opens. `api.anthropic.com` is classified `direct`, not a
gateway — found by running the tool against this very session, which has
`ANTHROPIC_BASE_URL` set to it.

Surface: new `.cursor/tools/omniroute.mjs`, `.cursor/docs/OMNIROUTE.md` (shipped,
added to `SHIPPED_DOCS`), `docs/adr/0001`, one START-HERE row, one skill-catalog
paragraph, a README row and MCP env row, two skills wired, and — unlike the
Graphify adapter — **the enforcement surface was edited**: `.mcp.json` (HTTP
transport, `${OMNIROUTE_MCP_KEY}`), `.cursor/mcp-policy.json` (read-only, one
`allow`, deny globs in three groups), two `guard-bash.mjs` rules refusing
`serve|launch|configure|setup-*|connect|tokens|--mcp` and the docker forms, and
one environment-only `session-start.mjs` notice. `integrity --check` therefore
reports `.mcp.json`, `.cursor/mcp-policy.json`, `session-start.mjs` and
`guard-bash.mjs` CHANGED and **needs a human `--write`**.

Evidence: 76 assertions in `tests/adversarial/omniroute.test.mjs`, 18 added to
`mcp.test.mjs` (92 total) and 21 to `bash.test.mjs` (272 total). Eleven deliberate
mutations of the tool were each caught; three earlier mutations survived and each
exposed a real defect rather than a test gap — `reach` and `cfg.loopback` were two
sources of truth for one decision (merged), the probe had only a socket timeout
(a wall-clock bound added), and whitespace-only base URLs were untested (case
added). The fake gateway runs in a child process on purpose: `runTool` uses
`spawnSync`, so an in-process server never accepts and every case would have
passed or failed on "unreachable" regardless of the tool. docs-lint baseline held
(53 errors, all under untracked `project-analysis/`). Plugin `6aee0c3b8b2a2a77`.

Not done: `memory-bank/technologyStack.md` needs one "Under evaluation" row and
is Tier 2, so it is proposed and not applied — `CLAUDE_ALLOW_TIER2_EDIT` is unset
and that is the team's call. Not verified against a live OmniRoute: none was
available, so the catalog parser follows the documented OpenAI `data[]` shape and
the `x-omniroute-*` header.

## Token tools assessed, and what came of it — 2026-09-16

Assessed [caveman](https://github.com/juliusbrussee/caveman) and
[headroom](https://github.com/headroomlabs-ai/headroom) for the platform.
**Neither is adopted**: nothing installs, runs, wraps itself in or routes traffic
through either, and no MCP entry was added. Both proxies sit at
`ANTHROPIC_BASE_URL` and rewrite what the model reads, which is a control
`lifecycle/integrity.json` cannot hash; both collapse repetitive arrays and drop
non-error log lines, which is the shape of every `findings[]` list here and of
the raw test output `/task-verify` refuses a DONE verdict without. caveman's
skill half is an always-on directive forbidding preamble, which contradicts the
`**Matched skill:**` announcement and rule 05. Full argument, per-tool:
[docs/reviews/token-tools-assessment-2026-09-15.md](../docs/reviews/token-tools-assessment-2026-09-15.md);
two rows added to mcp-ecosystem's "Deliberately omitted".

Two things came out of it, both shipped here.

**`.cursor/tools/context-cost.mjs`** — read-only measurement of what a session
carries before the first user word, per host and never summed (Claude Code reads
CLAUDE.md, Cursor reads the rules; adding them double-counts). Bytes measured,
tokens estimated at chars/4, nothing scored. The digest is measured by *running*
`session-start.mjs`, not re-derived. It found what nobody had counted: the name
and description of all 99 skills and 14 agents is **46,787 B** of every Claude
Code session, roughly half that host's always-on cost. Claude Code 94,287 B
(~23,472 tok); Cursor 56,148 B (~13,942 tok).

**guard-bash gap B11, closed.** Surveying the two tools' install instructions
showed `curl | sh`, `irm | iex` and global npm installs already refused, and two
doors open: Python installers (`pip`/`pip3`/`python -m pip`/`pipx`/`uv pip`
install, `uv add`, `uv tool install`), the ephemeral runners (`uvx`,
`uv tool run`, `pipx run`), and remote skill installers (`npx|dlx|bunx skills
add|install`, which with `-g` writes an always-on skill outside the repository).
Declared restores stay allowed: `-r <file>`, `-e .` and paths including
drive-lettered ones, `uv sync`/`lock`/`run`, `pip list`, bare `uvx --version`.
`npx -y skills add` reports the remote-skill reason, not the lockfile one, and
that ordering is asserted. Inherited, not widened: whole-command-text matching
(B11-3). Not covered: pipenv, poetry, conda, `uv run --with`, and
`claude plugin install` / `claude mcp add` — the same class of front door, left
as a decision nobody has taken.

Evidence: 62 assertions in `tests/adversarial/context-cost.test.mjs`, nine tool
mutations killed (two survivors exposed real fixture flaws — the same file was
never imported twice, and the two skills sorted the same way by name and by
size); 251 in `bash.test.mjs` plus rows in `guards.test.mjs`, six guard
mutations killed (one survivor exposed a missing Windows-path case, and one
mutation silently failed to apply because the hook is CRLF). `docs-lint` holds
its baseline: 53 errors, all under the untracked `project-analysis/`, none
outside. Plugin rebuilt, `0d2d2c8a8a232f41`, `check` in sync.

`guard-bash.mjs` is on the protected list. The edit was made with
`CURSOR_PLATFORM_DEV=1`, which was already set in this environment; **integrity
is FAIL until a human reviews the hook diff and attests.**

## Graphify read-only adapter — 2026-09-15

Assessed [Graphify](https://github.com/Graphify-Labs/graphify) for the platform.
Decision: the platform never installs or runs it, from an agent or from CI, and
never uses `graphify claude install` / `graphify cursor install` (an always-on
directive plus a Glob/Grep hook outside the reviewed enforcement surface). Added
`.cursor/tools/graphify.mjs`, which reads a human-built
`graphify-out/graph.json`: `status`, `neighbours`, `communities`, `hubs`, `path`.
Freshness is derived from git content hashes pinned in
`.cursor/cache/graphify-snapshot.json`; a file modified after graph.json was
written but before the first pin stays stale until a rebuild. Paths from a scan
of the root or of one top-level directory are placed; deeper scans, foreign
paths and URLs are refused or reported.

Wired as an optional, explicitly degrading step into `feature-trace`,
`impact-analysis`, `context-builder` and `architecture-map-gen`, plus one row
in START-HERE and one paragraph in skill-catalog. No new skill and no hook or
policy edit, so no new integrity entry. `graphify-out/` is gitignored.
`feature-map.mjs` now also exports `worktreeShas`.

Evidence: 36 assertions in `tests/adversarial/graphify.test.mjs`; seven
deliberate mutations of the tool were each caught; the full suite passed, 27 suites
with 0 failed and 1,229 assertions; docs-lint adds no error outside the untracked
`project-analysis/`; self-audit wiring OK; plugin `d02eefb06f39414e`. The suite ran
in this working tree, which takes the Command Center journal lock under `project/`
(audit finding B18-1); no journal was pending, and a hash listing shows no file
changed beyond this increment's 26 modified and 3 new files. Not verified against
real Graphify output: none was available, so the parser follows the documented
node/edge shape and NetworkX `links`.

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

- Graphify follow-up needs a human: a SessionStart freshness line lives in a
  protected hook (edit, then re-attest integrity). Gap B11 is closed, below.
- Integrity is FAIL until `_lib.mjs`, `write-policy.json`, gate
  `06-production.gate.md` (99-skill count) and now `guard-bash.mjs` are
  re-attested. The hook diff for B11 is this increment's; review it before
  signing rather than signing the batch.
- License file is still an owner choice (IDEA-002 / H12).
- The development escape is enabled in this process. Keep its use scoped
  to this platform.
