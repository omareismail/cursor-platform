# CLAUDE.md

Claude Code entry point for the **cursor-platform** workspace.

Claude Code does not read `AGENTS.md`, `.cursor/rules/*.mdc`, or
`.cursor/skills/*/skill.md`. This file bridges that gap: it imports the shared
contract and adds the Claude-only wiring (skills, subagents, hooks).

**The shared contract is imported below — read it as if it were inline:**

@AGENTS.md

---

## Claude-specific layer

| Concern | Cursor | Claude Code |
|---|---|---|
| Contract | `AGENTS.md` | `CLAUDE.md` (imports `AGENTS.md`) |
| Skills | `.cursor/skills/<n>/skill.md` | `.claude/skills/<n>/SKILL.md` (shim → same file) |
| Rules | `.cursor/rules/*.mdc` (auto-glob) | **§ Always-on rules** below + per-skill table |
| Context isolation | — | `.claude/agents/*.md` subagents |
| Enforcement | prose only | `.claude/hooks/*.mjs` (deterministic) |
| MCP | `.cursor/settings.local.json` | `.mcp.json` (project) |

`.claude/skills/` contains **shims only**. Every skill file says "read
`.cursor/skills/<name>/skill.md`". Never fork the content — edit the `.cursor`
copy and both agents stay in sync. If you add a skill, run
`node .claude/hooks/sync-skills.mjs` to regenerate the shim.

---

## Always-on rules (Cursor's `alwaysApply: true` set)

Claude Code has no glob-scoped rule loader, so the four global rules are
restated here. **The `.mdc` files remain authoritative** — read the full file
before any non-trivial application.

**`00-memory-think`** — Before generating code, writing specs, running a skill,
or answering any non-trivial question: read `memory-bank/activeContext.md`,
`progress.md`, `techContext.md`, `systemPatterns.md`. The `SessionStart` hook
injects a digest of these automatically; if the digest says a file is stale or
`repo-map.json` is missing, run `/repo-discovery` or `/context-sync` before
proceeding. Never re-implement something `progress.md` marks Done.

**`05-planning-rigor`** — No plan, spec, or constitution without an elicitation
pass first. Present options with explicit tradeoffs; never a single option
presented as the only one.

**`09-minimal-changes`** — Change only what the task requires. No unrelated
reformatting, no drive-by refactors, no scope creep. Minimise the diff.

**`11-lifecycle-gate`** — On a repo with `lifecycle/state.json`, the product is in
one of six phases and you may not run work belonging to a later one. The
`SessionStart` hook injects the current phase. Until the DESIGN gate is
`APPROVED` or `INHERITED`, `guard-phase.mjs` blocks every write under `src/`,
`backend/` and `frontend/` — tests, specs and docs are never blocked. Never
approve a gate on the user's behalf; `approve` requires `--by "name"` for that
reason. A repo with no state file never adopted the lifecycle and this rule is
inert there. Full text: `.cursor/rules/11-lifecycle-gate.mdc`. Phases and gates:
`.cursor/docs/LIFECYCLE.md`.

**`10-evidence-and-dependency-guard`** — Confirm classes, interfaces, tables,
packages and config keys **exist** before referencing them (grep first). Never
add a NuGet/npm package that is not already in the repo unless the user
explicitly asked. The `PreToolUse` Bash hook blocks package-install commands —
that block is a signal to stop and ask, not to find a workaround.

### Glob-scoped rules — read on demand

| If you are touching | Read before generating |
|---|---|
| `**/*.cs`, `**/*.csproj` | `.cursor/rules/02-dotnet-architecture-guard.mdc` |
| `**/*.tsx`, `**/*.ts` | `.cursor/rules/03-react-architecture-guard.mdc` |
| any source, config, or CI file | `.cursor/rules/04-security-guard.mdc` |
| `**/*.cs`, `**/*.sql` | `.cursor/rules/06-database-provider-guard.mdc` |
| `**/*.cs` touching money/policy | `.cursor/rules/07-audit-trail-guard.mdc` |
| `**/*.tsx`, `**/*.css` | `.cursor/rules/08-rtl-i18n-guard.mdc` |
| `specs/**` | `.cursor/rules/01-specify-rules.mdc` |

---

## Subagents — use them, they protect the context window

`.claude/agents/` holds read-only specialists. Delegating to them keeps
thousands of lines of scanned source **out of the main conversation** — only
the findings come back. On a large .NET + React repo this is the difference
between finishing a task and running out of context mid-refactor.

| Subagent | Delegate when |
|---|---|
| `feature-analyst` | **"How does X work?" / "What breaks if I change X?"** — end-to-end tracing and blast-radius analysis. A real trace reads 30-50 files; this is the delegation that pays for itself fastest. |
| `ops-reviewer` | **"Is this ready to ship?"** — production readiness, SLO/alert/runbook derivation, rollout and rollback safety. |
| `pattern-scout` | Before any `*-gen` skill — finds the canonical local example. Replaces inlining `pattern-finder`'s file reads. |
| `repo-cartographer` | Structural mapping / `repo-discovery` / `context-sync` refreshes. |
| `dotnet-auditor` | Any `.NET` audit spanning more than ~5 files. |
| `react-auditor` | Any React/TS audit spanning more than ~5 files. |
| `security-auditor` | Security, compliance, or audit-trail sweeps. |
| `db-auditor` | Schema, EF/Dapper consistency, query review, migration safety. |
| `lifecycle-controller` | **Any session on a product repo** — which phase, which gates, whether the request belongs to a later one. Cheapest way to learn the design gate has not passed. |
| `product-manager` | Phase 1 — requirements, personas, NFRs, story map with testable acceptance criteria. |
| `business-analyst` | Phase 2 — greenfield domain model, use cases, business rules, risks. Not `feature-analyst`: that one reads code, this one models a business. |
| `solution-architect` | Phase 3 — architecture, API contract, physical data model, NFR-to-mechanism tracing. |
| `ux-bridge` | Phase 3 UI — screen inventory, states, RTL/i18n contract, design tokens. Reads the Figma MCP server when connected. |
| `test-engineer` | Phase 5 — test strategy, and proving every acceptance criterion has a test that asserts it. |

Do **not** delegate file-writing work — subagents here are read-only by design.
Generation stays in the main thread where the guard rules and hooks apply.

---

## The product lifecycle — which phase are we in

`01-specify-rules.mdc` gates one **feature**. `11-lifecycle-gate.mdc` gates the
whole **product**. They nest: phases 4 and 5 are a loop that runs the feature
pipeline once per feature, phases 1-3 and 6 run once per product.

```
1 REQUIREMENTS -> 2 ANALYSIS -> 3 DESIGN -> 4 DEV <-> 5 TEST -> 6 PRODUCTION
                                    ^
                    the only gate with a hook behind it
```

```bash
node .cursor/tools/lifecycle.mjs status                    # where are we, and is it still true
node .cursor/tools/lifecycle.mjs check [PHASE]             # consent 1: artifacts exist
node .cursor/tools/lifecycle.mjs record-gate PHASE --verdict GO --by "lifecycle-gate"
node .cursor/tools/lifecycle.mjs approve PHASE --by "name" # consent 3: the human
node .cursor/tools/lifecycle.mjs advance
node .cursor/tools/lifecycle.mjs rollback PHASE --reason "..."
```

A gate needs three consents and no one of them is enough: mechanical (the
artifacts exist and are not templates, recomputed at approve time), judgement
(`/lifecycle-gate` records a GO or NO-GO, stamped with the gate file's own hash),
and human (`approve --by`). `approve` refuses without all three, out of order, or
while the previous phase is uncleared. There is no `--force` — a bypass is an
`override` with an owner, a risk level and an expiry.

**Status is derived, not stored.** Approval hashes every required artifact. Edit
an approved design document and the phase reads `STALE` on the next command, and
`guard-phase.mjs` starts blocking `src/` writes again. When something is `STALE`,
offer to re-review it, never to re-approve it.

| Question | Skill |
|---|---|
| Where are we, what is next? | `/lifecycle` |
| Is this phase done? | `/lifecycle-gate [PHASE]` |
| I have an idea | `/product-brief`, then phase 1 |
| Build the next feature | `/feature-pipeline next` |
| Plan the cutover | `/go-live plan` |

**Phases 1-3 promote into `memory-bank/`.** That is the point of them: a decision
in `docs/design/architecture.md` is a document, the same decision in
`memory-bank/architecture.md` is enforced by rule 02 on every `.cs` file. Tier 2
is human-authored and `guard-write.mjs` blocks agent writes, so promotion is
explicit — show the diff, get the user's word, apply with
`CLAUDE_ALLOW_TIER2_EDIT=1`.

A repo with no `lifecycle/state.json` never adopted this. That is valid; say so
and carry on. Full detail: `.cursor/docs/LIFECYCLE.md`,
`.cursor/docs/IDEA-TO-PRODUCTION.md`.

---

## Understanding existing code before changing it

Four skills answer questions about what the codebase already **does**, as
opposed to generating something new or judging quality. On a legacy repo this is
the prerequisite for almost everything else.

| Question | Skill |
|---|---|
| How does this feature work today? | `/feature-trace "<name>"` |
| What breaks if I change this? | `/impact-analysis "<change>"` |
| What does this system even do? | `/feature-inventory [scope]` |
| Does the code match the spec? | `/spec-drift-audit [spec\|feature-id]` |

They share `.cursor/cache/feature-map.json` — a **behavioural** layer over
`repo-map.json`'s structural one. Traces record the content hash of every file
they cover, so freshness is computed, not guessed:

```bash
node .cursor/tools/feature-map.mjs list      # coverage + freshness
node .cursor/tools/feature-map.mjs verify    # which traces went stale, and why
```

The `SessionStart` hook reports coverage and staleness automatically. The map is
machine-owned: the `PreToolUse` write guard blocks direct edits, so write to it
only through `feature-map.mjs upsert`.

---

## Breaking work into tasks

| Situation | Skill |
|---|---|
| New feature, full spec pipeline | `/speckit-plan` |
| Anything else — bug, refactor, migration, traced-feature change | `/work-breakdown [source]` |
| A task is too big to execute | `/work-breakdown --split T-04` |

Task size is **enforced, not estimated**. S/M/L say how long work takes; they say
nothing about whether you can finish it in one session. A task touching 25 files
does not take longer — it fails partway and leaves a half-applied change behind.
`.cursor/tools/task-graph.mjs` rejects that:

```bash
node .cursor/tools/task-graph.mjs validate <plan.md>   # ≤8 files, ≤2 layers, verify cmd, no cycles
node .cursor/tools/task-graph.mjs graph    <plan.md>   # parallel batches + critical path
node .cursor/tools/task-graph.mjs next     <plan.md> --done T-01
node .cursor/tools/task-graph.mjs split    <plan.md> T-04
```

**Never present a board that failed validation** — fix it and re-run first.

### Verifying a task is actually done

`task-graph` requires a `Verify` command on every task but only checks it
*exists*. `/task-verify` runs it, and checks what it was supposed to prove:

```bash
node .cursor/tools/ac-trace.mjs check specs/features/<slug>.md   # AC <-> test gaps
node .cursor/tools/ac-trace.mjs matrix specs/features/<slug>.md  # the RTM
node .cursor/tools/ac-trace.mjs lint                             # vacuous/weak tests
```

### The other half of the chain

`ac-trace` spans acceptance criterion to test. `artifact-schema.mjs` spans
requirement to endpoint, over the same documents the phase skills already write:

```bash
node .cursor/tools/artifact-schema.mjs check      # dangling / duplicate / misplaced / unlinked
node .cursor/tools/artifact-schema.mjs trace S-07 # one id, up and down
node .cursor/tools/artifact-schema.mjs graph      # everything, and where the chains stop
```

Chain: `FR -> S -> UC -> EP, SC` and `NFR -> ADR, EP`, declared in
`schemas/id-grammar.json`.

**Definition of Ready.** `/task-verify` already refuses to mark a task done
without evidence; nothing asked the question at the other end, where the cheaper
mistake lives:

```bash
node .cursor/tools/artifact-schema.mjs ready S-7    # may this story enter DEVELOPMENT
node .cursor/tools/artifact-schema.mjs ready        # every story
```

It computes eight of the ten items from the graph - requirement, acceptance
criteria, use case, business rules, endpoint, screen, security design, data
design - and reports the two it cannot (dependency order and task sizing, both
`task-graph.mjs`) as manual rather than dropping them. `/feature-pipeline`
refuses to start an unready story. The Markdown stays Markdown — this reads the ids the
skills already emit plus a small YAML front-matter block, exactly the way
`// AC-N:` comments work. **`lifecycle.mjs check` fails on a broken chain**, so
gate criteria like "every story traces to a use case" are now part of the
mechanical consent rather than something a reviewer judges.

### Changing something already approved

`rollback` reopens a phase and resets every later one — right for "the
architecture is wrong", useless for "the customer changed one payment rule".
For that, `/change-request` walks the id graph and names the blast radius:

```bash
node .cursor/tools/change-request.mjs impact BR-4      # forecast, records nothing
node .cursor/tools/change-request.mjs open --changes "BR-4" --reason "..." --by "<name>"
```

It forecasts and records; it never invalidates. A phase goes `STALE` because its
artifact hashes moved, which `lifecycle.mjs` derives on its own — a second,
weaker invalidation path would only disagree with the first.

`ac-trace` reads the `// AC-N:` comments both test generators already emit and
fails on: an AC no test claims, a test claiming an AC the spec dropped, an AC
whose only test is skipped, a claiming test with no assertion, and assertions
that cannot fail.

**A task may only move to Done on a DONE verdict from `/task-verify`**, and the
`progress.md` entry records the evidence. When an agent wrote both the code and
the tests, a green suite proves the two agree — not that either is right. That
is the whole reason this gate exists.

`graph` gives the parallel batches: everything in a batch has its dependencies
satisfied and can run at once. With `Agent(isolation: "worktree")` that is one
agent per task within a batch. The critical path is the floor on elapsed time
however many you run.

---

## Shipping and running it — the outer loop

Everything above optimises the inner loop: spec → generate → verify → merge.
These four ask the other question — *can we run this, and is delivery actually
improving?*

| Question | Skill |
|---|---|
| Is this ready to ship? | `/production-readiness-review` — blocking Go/No-Go, 7 dimensions |
| Does it hold up under load? | `/load-test-gen` — k6/NBomber, thresholds from your SLOs |
| What do we monitor, page on, and do at 3am? | `/operability-gen` — SLIs/SLOs, error-budget policy, alerts, runbook |
| How does this reach users without a big-bang? | `/release-safety` — flags, rings, rollback, expand→migrate→contract |
| What could an attacker do with this design? | `/threat-model` — STRIDE, before the code exists |
| Is delivery getting better or worse? | `/delivery-metrics` — DORA + rework rate |
| Something broke — how do we make it impossible? | `/postmortem` — findings become compile-time guards |

```bash
node .cursor/tools/delivery-metrics.mjs report --days 90   # DORA + rework, MEASURED vs PROXY labelled
node .cursor/tools/delivery-metrics.mjs trend  --days 180  # direction of travel
node .cursor/tools/flag-debt.mjs scan                      # expired flags exit 1
node .cursor/tools/docs-lint.mjs check                     # broken links, ghost skills, stale counts
```

**Why this matters in this repo specifically.** DORA's 2025/2026 research found
AI adoption raises throughput 2–18% while stability degrades — change failure
rate 8% → 14% in one study, PR size +154%, review time +91%. A 75-skill platform
is a throughput amplifier, which is exactly that configuration. Run
`/delivery-metrics` rather than assuming which way this one is going.

Two rules when using these:

- **Never soften a NO-GO.** A gate that has never blocked anything is a form,
  not a control.
- **`/postmortem` output is a `BannedSymbols.txt` entry, an analyzer severity, a
  convention test or a hook tripwire** — not a document. Aim as high up that
  ladder as the finding allows.

---

## Hooks — what is enforced mechanically

Prose rules are advisory; hooks are not. `.claude/settings.json` wires:

| Event | Effect |
|---|---|
| `SessionStart` | Injects the current lifecycle phase, memory-bank Tier 1 digest + `repo-map.json` freshness. Rules `00` and `11` become automatic. |
| `PreToolUse` (Write/Edit) | **Blocks** hand-edits to `.cursor/cache/repo-map.json` and `lifecycle/state.json`, writes to `.env`/secret files, and hardcoded connection-string passwords. |
| `PreToolUse` (Write/Edit) | **Blocks** every write under `src/`, `backend/`, `frontend/` while the lifecycle DESIGN gate is unapproved. Escape: `LIFECYCLE_OVERRIDE=1`, set by a human on purpose. |
| `PreToolUse` (Bash) | **Blocks** `dotnet add package`, `npm/yarn/pnpm install <pkg>`, `git push --force`, and `ef database update` against non-local connections. |
| `PreToolUse` (`mcp__.*`) | **Blocks** MCP calls that violate `.cursor/mcp-policy.json`: writes to a read-only server, anything on a deny list (`merge_*`, `delete_*`, `*force*`), a non-SELECT statement or a second statement after a `;`, and tools used outside their allowed lifecycle phase. Cursor attaches the same guard to `beforeMCPExecution`. |
| `PostToolUse` (Write/Edit) | Runs `dotnet format` / `eslint --fix` on the touched file and feeds failures back. |
| `Stop` | Warns if source changed but `memory-bank/activeContext.md` was not updated. |

If a hook blocks you, **stop and tell the user why**. Do not route around it
with a different tool.

---

## Working on a target application repo

This repo is the *platform*, not an application. When applied to an app repo
(see `.cursor/docs/APPLY-TO-PROJECT.md`), also install the build gates in
`templates/` — they turn the guard rules into compiler and CI failures that
hold whether or not an agent wrote the code. See `templates/README.md`.
