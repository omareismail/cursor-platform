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
reason. Never judge a gate for a phase you wrote: each gate file names the
reviewer, and it is never one of that phase's authors. A repo with no state file never adopted the lifecycle and this rule is
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
node .cursor/tools/lifecycle.mjs product                   # start here: the one-screen briefing
node .cursor/tools/lifecycle.mjs status                    # where are we, and is it still true
node .cursor/tools/lifecycle.mjs check [PHASE]             # consent 1: artifacts exist
node .cursor/tools/lifecycle.mjs gate PHASE                # who may judge it, and why
node .cursor/tools/lifecycle.mjs record-gate PHASE --verdict GO --by "<the reviewer>"
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

**Three consents means three parties.** Every phase owner used to review its own
gate, which is one consent signed twice. Each gate file now names its reviewer,
`record-gate` refuses a verdict from anyone else, `approve` refuses a signature
from the party that recorded the verdict, and the verdict is bound to the hashes
of the documents the reviewer actually read — edit one before signing and the
signature is refused.

| Gate | Written by | Judged by |
|---|---|---|
| 1 Requirements | `product-manager`, `ux-bridge` | `business-analyst` |
| 2 Analysis | `business-analyst` | `solution-architect` |
| 3 Design | `solution-architect`, `ux-bridge` | `security-auditor` |
| 4 Development | the speckit pipeline | `test-engineer` |
| 5 Testing | `test-engineer` | `product-manager` |
| 6 Production | `ops-reviewer` | `security-auditor` |

`lifecycle.mjs gate PHASE` prints the pair and the reason. Launch the reviewer as
a fresh subagent: it has to reach the criteria through the documents, not through
the conversation that produced them.

**Orient with `product` first.** It is one screen: phase and gate ladder, the
governance profile, the stack, the integrations, the phase owners, and any open
change request or active override. Nothing in it is declared by hand — the phase
comes from `state.json`, the stack from `memory-bank/technologyStack.md`, the
integrations from `.mcp.json`, and the governance flags are derived from the
phase 1 documents. A hand-written manifest would be a fourth copy of facts that
already have owners.

The governance profile is the part that changes what is enforced: `money` makes
rule 07 strict and `decimal` mandatory, `PII` makes `/threat-model` mandatory at
gate 3, `regulated` brings `/compliance-audit` into scope with the regimes
named. If it reports the flags cannot be derived, phase 1 has produced nothing
readable yet — say that rather than assuming "no".

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

That question is **flat**, though — it gives the same answer for "the header
shows the broker's name" and "the settlement transfers 1,500 SAR to a mada
account", so 100% AC coverage can be a real number over a suite that is adequate
for one of them. `risk-profile.mjs` asks the other half:

```bash
node .cursor/tools/risk-profile.mjs profile     # every criterion ranked, and why
node .cursor/tools/risk-profile.mjs check       # gate 5: is the depth where the cost is
node .cursor/tools/risk-profile.mjs explain AC-12
```

Tiers come from explicit rules over the criterion's own words — money, identity,
permission, a named regime, something that cannot be taken back — and from how
many documents cite the ids it implements. T2 also needs a test asserting the
**failure** path; T3 also needs two layers. Every tier prints the rule that
produced it, because a reason can be argued with and a score cannot.

**The ladder only ratchets up.** T1 is the existing rule, so nothing this tool
decides can justify testing something *less* — a tier that looks too high costs
some diligence; one that looks too low is the one worth arguing about. And it
cannot see a criterion that is expensive for a reason nobody wrote down: that is
a reason to reword the criterion, since a human tester would be misled the same
way.

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

**Every release, not just the first.** Gate 6 is approved once; releases happen
forever. A release is the phase 4-5 loop closing again — merging a feature moves
`specs/features/`, so DEVELOPMENT goes `STALE` on its own and the next release is
blocked until it is re-reviewed. Re-approve the stale phase **in place**; never
`rollback DEVELOPMENT` for a release, because that also resets TESTING and
PRODUCTION and discards two approvals that are still true.

```bash
node .cursor/tools/release-evidence.mjs cut --version v1.2.0   # derived: commits, gates, overrides, open CRs
node .cursor/tools/release-evidence.mjs sign v1.2.0 --by "<name>"
node .cursor/tools/release-evidence.mjs verify                 # do the records still stand up
```

`cut` refuses on a dirty tree, an uncleared DEVELOPMENT or TESTING gate, or a
TESTING approval *older* than the DEVELOPMENT one — two green gates in the wrong
order, which is how a feature ships with no test. `sign` refuses to authorise a
release shipping under an active override unless the signer names it with
`--accept-override OV-XXXX`. Records live in `lifecycle/releases/`, are
immutable, and are committed.

**The architecture, as an assertion.** Gate 3 promises that promoting the design
into `memory-bank/architecture.md` makes it "a compiler error rather than a
document". Until now that meant an agent read rule 02 and chose to comply, which
is probabilistic, plus a subagent sweep when someone remembered to ask.

```bash
node .cursor/tools/fitness.mjs rules            # what was derived, and from where
node .cursor/tools/fitness.mjs check            # gate 4 / CI: NEW violations only
node .cursor/tools/fitness.mjs baseline --accept
```

The rules are **read from** `memory-bank/architecture.md` — the layering block
names each layer and what it may depend on; the frontend block says `shared/`
cannot import from `features/`. Nothing is configured here, because a
`fitness.json` would be a fourth source of architectural truth beside that file,
rule 02 and the ADRs. If the file is still the template, the tool says so and
checks nothing: an un-promoted architecture is a skipped gate, not a violation.

It asserts layer direction over `using` directives and `<ProjectReference>`
elements (with the transitive closure, so Infrastructure using Domain is not a
false positive), domain purity against infrastructure packages, the frontend
boundary, import cycles, and whether the architecture-test project the file
claims as a build gate actually exists.

**The baseline is a ratchet, and it is what makes this survivable.** Point a new
checker at an existing codebase and it returns four hundred violations and is
switched off that afternoon. `check` fails only on what is NEW since
`lifecycle/fitness-baseline.json`. The count may fall and never rise, and
swapping a fixed violation for a fresh one is refused even though the count is
unchanged. It is a dated record of architectural debt, not a suppression file.

**What happens when something you do not control fails.** Every test above is
about *this* system's behaviour on bad input. Nothing was asking the other
question — what the system does when the mada gateway stops answering, ZATCA
returns 503 for four hours, or the queue redelivers a message that already moved
money.

```bash
node .cursor/tools/failure-modes.mjs scan     # every dependency, and what protects it
node .cursor/tools/failure-modes.mjs check    # gates 3 and 6
```

It reads the **registration site** — `AddHttpClient`, `AddDbContext`,
`AddMassTransit`, `axios.create` — not the file, so a `Timeout` belonging to
something else is not counted as protection. `AddStandardResilienceHandler` is
understood. Three findings block:

- **No timeout.** A dependency that fails returns an error you can handle; one
  that goes *slow* fills the thread pool and takes the service with it.
  `new HttpClient()` waits 100 seconds by default.
- **Retry without idempotency on a money path.** `AddStandardResilienceHandler`
  retries by default. A retried transfer that is not idempotent pays twice, and
  the second payment is invisible until reconciliation.
- **Nothing makes it fail in a test.** Every test has the dependency working, so
  the fallback has never run — including for whoever wrote the runbook.

Production chaos experiments are deliberately out of scope. Against live
SAMA-regulated traffic that is a formal change with a named owner, not something
a repository tool authorises. Gate 6 asks instead for a failure **rehearsed** in
staging with the runbook open.

```bash
node .cursor/tools/delivery-metrics.mjs report --days 90   # DORA + rework, MEASURED vs PROXY labelled
node .cursor/tools/delivery-intel.mjs questions            # is the process working, or being performed
node .cursor/tools/delivery-metrics.mjs trend  --days 180  # direction of travel
node .cursor/tools/flag-debt.mjs scan                      # expired flags exit 1
node .cursor/tools/docs-lint.mjs check                     # broken links, ghost skills, stale counts
```

**DORA is half the picture.** It measures the codebase. `delivery-intel.mjs`
reads the other half — the lifecycle's own records, which have been accumulating
gate verdicts and their attempt counts, overrides and whether they lapsed,
release signatures, incidents and how they were found, and the architectural-debt
baseline, every one of them read alone until now.

Its `questions` output is the point: each observation with **both** readings it
permits and the evidence that separates them. Eight verdicts and no NO-GO is
either unusually good work or a review that has never been in a position to say
no; the tool prints both and refuses to pick. **Nothing there is scored**, because
a number reported as good becomes a number to hit, and the cheapest way to hit
"no failed gates" is to stop looking. It also states its own n and will not use
the word "trend" below five data points.

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
  ladder as the finding allows, then **record which guard it was**:

```bash
node .cursor/tools/incidents.mjs open --title "..." --detected reconciliation \
     --guard "templates/dotnet/BannedSymbols.txt#<symbol>" --falsifies NFR-3 --by "<name>"
node .cursor/tools/incidents.mjs check      # gate 6 / CI: are those guards still there
node .cursor/tools/incidents.mjs learned    # what production disproved
```

`/postmortem` step 6 already names the failure this closes: *"teams delete useful
defences during cleanups because nobody recorded that they helped."* Nobody did.
`check` re-reads every guard an incident bought and fails when it is gone,
commented out, or inside a test somebody marked `Skip` — that last state being
the worst, because the record still claims the guard is there.

It also asks the question nobody asks later: opening an incident that names a
guard another incident already named prints the recurrence. A guard that was
meant to prevent this and did not was either never built, removed, or does not
cover this case — three different postmortems.

And `--falsifies NFR-3` records that a written id is now **wrong**, not at risk.
Gate 1's NFR criterion reads `learned` for exactly this: a reviewer cannot tell
from `nfr.md` that production already contradicted it.

---

## Is any of this actually connected?

```bash
node .cursor/tools/self-audit.mjs run       # wiring + docs-lint + metadata + plugin check
node .cursor/tools/self-audit.mjs wiring    # only the wiring
```

Written for a defect that really happened: `guard-phase.mjs` was written, tested,
documented and copied into the distributable plugin — and never added to the
plugin's generated hook wiring. For everyone who installed the plugin rather than
cloning the repo, **the design gate blocked nothing at all**, and every document
said it did.

That is the most dangerous class of defect here — a control that exists but is
not reachable — because **a missing control is noticed and a disconnected one is
trusted**, and this whole platform rests on the mechanical consent being the one
that cannot be argued with.

It checks only wiring, because `docs-lint.mjs` owns links and ghost references,
`platform-metadata.mjs` owns counts, and `build-plugin.mjs check` owns the built
tree; `run` invokes all three so there is one command. What it adds:

- every hook script is wired in **both** `.claude/settings.json` and
  `.cursor/hooks.json`, and the two wire the **same set** — `.cursor/hooks.json`
  states that risk in its own comment ("two copies of a guard, one per editor, is
  how one of them silently stops being enforced") and nothing checked it
- the built plugin wires them too — the original bug
- **and carries the data those tools read**, not only the tools. The plugin
  shipped `lifecycle.mjs`, `guard-phase.mjs`, `write-policy.json` and six
  documents describing six gates — and no gate definitions, so `record-gate`
  died with "cannot record a verdict against nothing" and the whole six-phase
  layer was unusable from a plugin install. `lifecycle.mjs` now resolves the
  project's gate copy first and the shipped one second, so the default travels
  without taking the customisation away
- every gate's reviewer is a real agent and is never one of its authors
- no orphan tool: something built and then wired to nothing
- and that this audit itself runs in CI, since an audit nobody runs is exactly
  the defect it exists to find

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
