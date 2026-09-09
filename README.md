# cursor-platform

An agent platform for **.NET + React** development in GCC fintech contexts (RHODES, Tamkeen, and similar codebases). It provides 98 skills, 12 guard rules, 14 subagents, 7 enforcement hooks, and a two-tier memory-bank so the agent discovers real repo structure, imitates existing patterns, and enforces architecture, security, audit trails, and RTL/i18n discipline.

It runs a product through **six gated phases** — requirements, analysis, design, development, testing, production — where each gate needs the artifacts to exist, a review to pass, and a named human to approve. The design gate is enforced by a hook, not a convention: nothing under `src/` can be written before it. See [LIFECYCLE.md](.cursor/docs/LIFECYCLE.md).

**Works in both Cursor and Claude Code from one set of source files** — see [DUAL-AGENT-SETUP.md](.cursor/docs/DUAL-AGENT-SETUP.md).

**Repository:** [github.com/omareismail/cursor-platform](https://github.com/omareismail/cursor-platform)

---

## Quick start

1. Open this folder in **Cursor** or **Claude Code**.
2. Read the contract for your agent:
   - Cursor → [`AGENTS.md`](AGENTS.md)
   - Claude Code → [`CLAUDE.md`](CLAUDE.md) (imports `AGENTS.md`, adds subagents + hooks)
3. Read [`HANDBOOK.md`](HANDBOOK.md) — every file explained, plus the new-project and existing-project workflows.
4. Read [`.cursor/docs/START-HERE.md`](.cursor/docs/START-HERE.md) — task-oriented map of skills and rules.
5. **New app repo?** Follow [`.cursor/docs/NEW-PROJECT.md`](.cursor/docs/NEW-PROJECT.md).
6. On a **target application repo**, run:
   ```
   /repo-discovery full
   /context-sync
   ```
7. Customize Tier 2 standards in [`memory-bank/`](memory-bank/) (see [`memory-bank/README.md`](memory-bank/README.md)).
8. On an inherited codebase, map what exists before changing it:
   ```
   /feature-inventory full                  # what capabilities are there
   /feature-trace "<the risky one>"         # how one of them works
   /impact-analysis "<proposed change>"     # what changing it would break
   /work-breakdown "<proposed change>"      # split it into finishable tasks
   ```
9. Before it reaches production:
   ```
   /threat-model "<the design>"             # STRIDE, while a fix is still cheap
   /operability-gen "<feature>"             # SLOs, alerts, runbook
   /release-safety "<change>"               # flags, rings, rollback
   /production-readiness-review "<scope>"   # blocking Go/No-Go
   ```
10. Install the build gates from [`templates/`](templates/README.md) so the guard rules hold in CI, not just at generation time.

---

## Structure

```
AGENTS.md            # agent contract — Cursor reads this
CLAUDE.md            # Claude Code entry point — imports AGENTS.md, adds Claude wiring
.mcp.json            # project MCP servers (committed; ${ENV_VAR} only, no secrets)

.cursor/
  hooks.json         # Cursor hook wiring -> the same scripts as .claude/settings.json
  mcp-policy.json    # what an agent may do THROUGH an MCP server
  skills/            # 98 slash-command skills — SINGLE SOURCE OF TRUTH
  rules/             # 12 .mdc guard rules (5 global + 7 glob-scoped)
  docs/              # skill-graph, execution pipeline, governance, START-HERE
  tools/             # feature-map, task-graph, ac-trace, delivery-metrics,
                     #   flag-debt, docs-lint, lifecycle, platform-metadata,
                     #   artifact-schema, change-request
                     #   (22 validators + build-plugin)
  cache/             # repo-map.json (structure) + feature-map.json (behaviour)
                     #   both generated; gitignored except .gitkeep
  lifecycle/gates/   # 6 gate definitions - what each phase must satisfy
  lifecycle/write-policy.json  # which artifacts may be written in which phase

schemas/             # front-matter contract + the id grammar (FR -> S -> UC -> EP)

lifecycle/           # per-project state.json (committed, machine-owned)
                     #   evidence/ gate verdicts · overrides/ · changes/ CRs

.claude/
  skills/            # 97 generated shims → .cursor/skills/ (never edit by hand)
  skills/_descriptions.json  # hand-written description overrides
  agents/            # 14 read-only subagents (context isolation)
  hooks/             # 7 enforcement hooks + sync-skills.mjs (plain Node, no deps)
                     #   incl. guard-phase.mjs - enforces the phase write policy
  settings.json      # hook wiring + permission deny/ask lists (committed)

memory-bank/
  Tier 1 (dynamic)   # techContext, progress, activeContext — filled by /context-sync
  Tier 2 (static)    # architecture, businessRules, securityStandards — team-authored

templates/           # build gates for TARGET app repos: analyzers, CPM,
                     # architecture tests, ESLint boundaries, mutation testing,
                     # CI quality gates
```

> **Editing rule:** skills live in `.cursor/skills/`. After adding, renaming, or
> deleting one, run `node .claude/hooks/sync-skills.mjs`. CI fails the PR if the
> shims drift.

| Doc | Purpose |
|-----|---------|
| [HANDBOOK.md](HANDBOOK.md) | **Every file explained + how to build a new project with this.** Start here. |
| [HANDBOOK.ar.md](HANDBOOK.ar.md) | الدليل الكامل بالعربية — same coverage, in Arabic |
| [LIFECYCLE.md](.cursor/docs/LIFECYCLE.md) | The six phases, their gates, owners and artifacts |
| [IDEA-TO-PRODUCTION.md](.cursor/docs/IDEA-TO-PRODUCTION.md) | **One idea, every command in order.** The runbook. |
| [AGENTS.md](AGENTS.md) | Agent instructions — copy to each app repo root |
| [NEW-PROJECT.md](.cursor/docs/NEW-PROJECT.md) | Bootstrap checklist for a new application repo |
| [APPLY-TO-PROJECT.md](.cursor/docs/APPLY-TO-PROJECT.md) | **Give to the model** — full bootstrap on an existing repo (e.g. MotorsReports) |
| [START-HERE.md](.cursor/docs/START-HERE.md) | "I want to do X" → which skill to run |
| [skill-catalog.md](.cursor/docs/skill-catalog.md) | Full 77-skill catalog and auto-routing |
| [skill-graph.md](.cursor/docs/skill-graph.md) | Skill dependencies and wiring |
| [shared-execution-pipeline.md](.cursor/docs/shared-execution-pipeline.md) | Canonical order: discovery → pattern → generate → validate |
| [GOVERNANCE_REPORT.md](.cursor/docs/GOVERNANCE_REPORT.md) | How 24 proposed governance rules map to 11 actual rules <!-- count-ok: figures frozen at the time of that report --> |
| [PROPOSAL-REVIEW.md](.cursor/docs/PROPOSAL-REVIEW.md) | Architectural review of ~150 proposed additions — what was approved, rejected, and why |
| Historical records | [ENTERPRISE_MATURITY_REPORT.md](.cursor/docs/ENTERPRISE_MATURITY_REPORT.md) · [MIGRATION_NOTES_PASS1.md](.cursor/docs/MIGRATION_NOTES_PASS1.md) · [PHASE5_GAP_ANALYSIS.md](.cursor/docs/PHASE5_GAP_ANALYSIS.md) — point-in-time, counts deliberately frozen |
| [mcp-ecosystem.md](.cursor/docs/mcp-ecosystem.md) | MCP servers, env vars, and **⚠ 2026 corrections** (two previously-recommended servers are archived) |
| [DUAL-AGENT-SETUP.md](.cursor/docs/DUAL-AGENT-SETUP.md) | How Cursor and Claude Code share one source of truth |
| [templates/README.md](templates/README.md) | Build gates — guard rules as compiler errors and CI failures |

---

## Local setup (MCP)

`.mcp.json` (committed, Claude Code) and `.cursor/settings.local.json` (gitignored, Cursor) configure the same four servers. See [mcp-ecosystem.md](.cursor/docs/mcp-ecosystem.md) for the rationale and the deliberately-omitted list.

| Variable | Used by | Notes |
|----------|---------|-------|
| `GITHUB_PAT` | github (official remote server) | Fine-grained PAT, read-only scopes by default |
| `POSTGRES_READONLY_URL` | postgres (Postgres MCP Pro) | **Must be a SELECT-only role** |
| `CONTEXT7_API_KEY` | context7 | Optional; raises rate limits |

> **⚠ If you are running an older copy of this platform:** the previously
> configured `@modelcontextprotocol/server-github` and
> `@modelcontextprotocol/server-postgres` are archived and unmaintained, and the
> Postgres one shipped a SQL-injection flaw that bypassed its own read-only
> mode. Update your local config and rotate that credential.

---

## Using in another project

### Recommended — install as a plugin

```
/plugin marketplace add omareismail/cursor-platform
/plugin install cursor-platform@cursor-platform
```

Skills, subagents, hooks, rules, validators and MCP config all arrive together,
version-pinned and updatable with `/plugin marketplace update`. No copied
directories to drift between repos.

Two things the plugin deliberately does **not** ship, because they are yours:

```
your-app/
  CLAUDE.md      ← your entry point (imports your AGENTS.md)
  memory-bank/   ← your architecture, standards, business rules, glossary
  src/           ← your code
```

`memory-bank/` is the important one. Every generator reads it, so a generic copy
would make the agent imitate somebody else's conventions. Create it from this
repo's template and fill in Tier 2 before generating anything.

### Alternative — copy the directories

If you are on Cursor, or want the platform vendored into the repo:

```
your-app/
  AGENTS.md  CLAUDE.md  .mcp.json  .cursor/  .claude/  memory-bank/  src/
```

### Either way

Install the build gates from [`templates/`](templates/README.md) — one at a
time, in the order listed there — then run `/repo-discovery full` and
`/context-sync` to populate Tier 1 memory and `.cursor/cache/repo-map.json`.

---

## Inventory

- **98 skills** — generators (`dotnet-endpoint-gen`, `react-component-gen`, …), auditors (`database-audit`, `compliance-audit`, …), **feature analysis** (`feature-trace`, `impact-analysis`, `feature-inventory`, `spec-drift-audit`), **work breakdown** (`work-breakdown` + speckit), **verification** (`task-verify`), **outer loop** (`production-readiness-review`, `operability-gen`, `release-safety`, `threat-model`, `delivery-metrics`, `postmortem`)
- **12 rules** — 5 global (`00`, `05`, `09`, `10`, `11-lifecycle-gate`) + 7 glob-scoped (architecture, security, DB, audit, RTL, specs)
- **14 subagents** — `feature-analyst`, `ops-reviewer`, `pattern-scout`, `repo-cartographer`, `dotnet-auditor`, `react-auditor`, `security-auditor`, `db-auditor`, plus the lifecycle phase owners `lifecycle-controller`, `product-manager`, `business-analyst`, `solution-architect`, `ux-bridge`, `test-engineer` (all read-only, isolated context)
- **2 cache layers** — `repo-map.json` (structure, from `/repo-discovery`) and `feature-map.json` (behaviour, from `/feature-trace`); freshness computed from file content hashes
- **22 validators** — `feature-map.mjs` (is this trace still true?), `task-graph.mjs` (is this task small enough to finish?), `ac-trace.mjs` (is every acceptance criterion covered by a test that can fail?), `delivery-metrics.mjs` (is delivery improving?), `flag-debt.mjs` (which flags outlived their purpose?), `docs-lint.mjs` (is the documentation graph intact?), `lifecycle.mjs` (which phase are we in, and were its artifacts ever produced?), `platform-metadata.mjs` (does any document still claim a count that stopped being true?), `artifact-schema.mjs` (does every requirement reach a story, every story a use case, every use case an endpoint?), `change-request.mjs` (if this rule changes, what stops being true?), `release-evidence.mjs` (what shipped, what proved it, and who signed?), `risk-profile.mjs` (where is being wrong expensive, and do the tests know it?), `failure-modes.mjs` (what happens when something you do not control fails?), `fitness.mjs` (does the promoted architecture still hold?), `incidents.mjs` (is the guard that incident bought still standing?), `delivery-intel.mjs` (is the process producing anything, or being performed?), `self-audit.mjs` (is every control actually reachable, has any fail-closed copy drifted, and does anything run without a human remembering?), `dashboard.mjs` (can I see the whole project on one screen?), `memory-bank.mjs` (what does the memory bank contain, and is any of it real?)
- **7 hooks** — memory + lifecycle-phase injection at session start, write/bash/phase/MCP guards, post-edit tripwires, memory-update check at stop
- **Build gates** — MSBuild layer guards, `BannedSymbols.txt`, Central Package Management, NetArchTest suites, ESLint boundaries, CI quality gates

Full rule table: [START-HERE.md § The 12 rules](.cursor/docs/START-HERE.md).

---

## First run checklist

- [ ] `/repo-discovery full` on target codebase
- [ ] `/context-sync` to populate Tier 1 memory-bank
- [ ] Replace `> EXAMPLE —` blocks in Tier 2 files with your team's decisions
- [ ] `/skill-maturity-audit all` to verify skill wiring
- [ ] Claude Code: confirm `/skills` lists 66 and `/agents` lists 6
- [ ] Install `templates/` build gates one at a time (see [templates/README.md](templates/README.md))
- [ ] Optional: `/architecture-map-gen dependency-graph` for a live dependency diagram

---

## License

Add a license file if you intend to open-source or share this platform beyond your team.
