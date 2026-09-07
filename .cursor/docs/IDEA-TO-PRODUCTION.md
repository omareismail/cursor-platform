# Idea to production — the runbook

One idea, all six phases, every command in order. Read
[LIFECYCLE.md](LIFECYCLE.md) first for why the phases are shaped this way.

The worked example throughout is *"a platform where customers buy and manage
vehicle insurance online"* — a real shape for this codebase: .NET + React, a SAR
currency, an Arabic UI, SAMA and ZATCA in scope, and a legacy Oracle schema to
read from.

---

## 0 — Start

```bash
node .cursor/tools/lifecycle.mjs init --name "motors-online"
```

Brownfield instead? `--existing`. Phases 1-3 become `INHERITED`, the design gate
clears, and you start in `DEVELOPMENT`. Then run `/feature-inventory full` and
`/context-sync` before anything else.

---

## 1 — Requirements

```
/product-brief   a platform where customers buy and manage vehicle insurance online
/persona-gen
/product-requirements
/user-story-map
```

Expect to be asked at least ten questions in `/product-brief`, each as labeled
options. That is `05-planning-rigor.mdc`, and it is the cheapest hour in the
project.

**Produces:** `docs/product/` — `brief.md`, `personas.md`, `prd.md`, `nfr.md`,
`scope.md`, `story-map.md`

**Close the phase:**

```bash
node .cursor/tools/lifecycle.mjs check REQUIREMENTS
```
```
/lifecycle-gate REQUIREMENTS
```
```bash
node .cursor/tools/lifecycle.mjs record-gate REQUIREMENTS --verdict GO \\
  --by "business-analyst" --criteria "<n>/<total>"
node .cursor/tools/lifecycle.mjs approve REQUIREMENTS --by "Ezzdeen"
node .cursor/tools/lifecycle.mjs advance
```

Optional, once the map is approved: `/speckit-taskstoissues` pushes the MVP
stories into Linear or GitHub.

---

## 2 — Analysis

```
/domain-model-gen
/use-case-gen
/business-rules-gen
/risk-register
```

**Produces:** `docs/analysis/` — `domain-model.md` (with a Mermaid ERD),
`use-cases.md`, `workflows.md`, `business-rules.md`, `risks.md`

**Promotion:** `/business-rules-gen` proposes a diff for
`memory-bank/businessRules.md` and `glossary.md`. Read it, agree it, apply it.
This is what makes rule 07 enforce your audit requirements in phase 4.

**Close the phase:** `check ANALYSIS` -> `/lifecycle-gate` (records the verdict)
-> `approve` -> `advance`.

---

## 3 — Design

```
/solution-architecture
/threat-model     "the design"
/api-contract-design
/data-model-design
/ux-design-bridge
```

`/solution-architecture` presents architecture variants and **waits**. It will
not pick for you.

`/threat-model` is not optional here. This product touches money, PII and auth;
a design gate reached without STRIDE output is an automatic NO-GO.

**Produces:** `docs/design/` — `architecture.md`, `api-design.md`,
`database-design.md`, `security-design.md`, `adr/`, `ux/screen-inventory.md`,
`ux/design-tokens.md`

**Promotion — the important one:** diffs for `memory-bank/architecture.md`,
`technologyStack.md`, `databaseConventions.md`, `apiConventions.md`,
`securityStandards.md`. Applying them turns the design from a document into
something rules 02, 03, 04 and 06 enforce on every file from here on.

**Close the phase:**

```bash
node .cursor/tools/lifecycle.mjs check DESIGN
```
```
/lifecycle-gate DESIGN
```
```bash
node .cursor/tools/lifecycle.mjs record-gate DESIGN --verdict GO \\
  --by "security-auditor" --criteria "<n>/<total>"
node .cursor/tools/lifecycle.mjs approve DESIGN --by "Ezzdeen"
node .cursor/tools/lifecycle.mjs advance
```

**This approval unblocks `guard-phase.mjs`.** Until it lands, every write under
`src/`, `backend/` and `frontend/` fails with exit code 2. That is the design
working, not a bug.

---

## 4 — Development

```
/feature-pipeline status      # what is done, what is next
/feature-pipeline next        # start the next unblocked story
```

Per feature, `/feature-pipeline` runs the chain from `01-specify-rules.mdc` and
stops wherever a decision is yours:

```
/speckit-analyze -> /speckit-clarify -> /speckit-constitution -> /speckit-plan
  -> /speckit-specify -> /speckit-implement <TASK> -> /task-verify
  -> /speckit-checklist -> /speckit-git-commit
```

Two rules that get lost in a long run:

```bash
node .cursor/tools/task-graph.mjs validate specs/plans/<slug>-plan.md
```
never present a board that failed this — and a task moves to Done only on a DONE
verdict from `/task-verify`, never from a green suite alone.

**Close the phase:** `check DEVELOPMENT` -> `/lifecycle-gate` (records the
verdict) -> `approve` -> `advance`. Gate 4 runs `/spec-drift-audit` and
`flag-debt scan`.

---

## 5 — Testing

```
/test-strategy
/e2e-test-gen           <journey>
/load-test-gen          <endpoint>
/compliance-audit
```

Delegate the security sweep to the `security-auditor` subagent — it reads far
more files than belong in the main context and returns findings, not the files.
```

`/e2e-test-gen` needs a browser runner already in `package.json`. Rule 10 and the
Bash hook prevent installing one — if it is missing, add it yourself first.

**The number that matters:**

```bash
node .cursor/tools/ac-trace.mjs check specs/features/<slug>.md
node .cursor/tools/ac-trace.mjs lint
```

100% AC coverage is non-negotiable. It is the criterion that closes the loop back
to the acceptance criteria you wrote in phase 1.

Open the release PR and let an independent reviewer see it. GitHub Copilot code
review reads `AGENTS.md`, so your guard rules constrain it too — but a human
signs off anything touching money or auth.

**Close the phase:** `check TESTING` -> `/lifecycle-gate` (records the verdict)
-> `approve` -> `advance`.

---

## 6 — Production

```
/deployment-pipeline-gen both
/operability-gen        <feature>
/release-safety         <change>
/production-readiness-review <scope>
/go-live plan
```

`/production-readiness-review` returns a blocking Go/No-Go. **Never soften a
NO-GO** — a gate that has never blocked anything is a form, not a control.

Then, in the window:

```
/go-live execute
/go-live verify
```

Anything touching production is yours to run. Migrations against a non-local
connection are blocked by the Bash hook, and that block is correct.

**Close the lifecycle:**

```bash
node .cursor/tools/lifecycle.mjs record-gate PRODUCTION --verdict GO \\
  --by "security-auditor" --criteria "<n>/<total>"
node .cursor/tools/lifecycle.mjs approve PRODUCTION --by "Ezzdeen"
```

---

## After live

| Event | Command |
|---|---|
| Something broke | `/postmortem` — the output is a compile-time guard, not a document |
| A release shipped | `/changelog-gen`, `/release-notes-gen` |
| Is any of this working | `/delivery-metrics` — DORA plus rework rate |
| Next release starts | `node .cursor/tools/lifecycle.mjs rollback DEVELOPMENT --reason "release 2"` |

---

## When you get stuck

| Symptom | Cause | Fix |
|---|---|---|
| `BLOCKED: ... DESIGN gate is not cleared` | Working ahead of the phase | `check DESIGN`, then the gate. Not `LIFECYCLE_OVERRIDE`. |
| `DESIGN gate: STALE — <file> changed since approval` | An approved design document was edited after approval | Re-review it and record a fresh verdict. Do not re-approve without reading the change. |
| `approve` refuses | One of the three consents is missing | The refusal names which. `··H` means only the human consent exists. |
| `No /lifecycle-gate verdict recorded` | The judgement consent was skipped | Run `/lifecycle-gate <PHASE>` — it records the verdict itself |
| `The verdict was recorded against an older <gate>.md` | A gate criterion was tightened after the review | Re-run `/lifecycle-gate` against the current criteria |
| `BLOCKED: lifecycle/state.json is ... owned by lifecycle.mjs` | Hand-editing state | Use the tool |
| `BLOCKED: memory-bank/architecture.md is Tier 2` | Promoting silently | Show the diff, ask, then `CLAUDE_ALLOW_TIER2_EDIT=1` |
| Agent starts coding in phase 2 | The lifecycle was never initialised | `lifecycle.mjs init` |
