---
name: lifecycle-gate
description: "lifecycle-gate evaluates whether a phase's artifacts are good enough to build on, and returns a blocking GO or NO-GO. It is the judgement half of a two-part check: lifecycle.mjs check proves the required documents exist and are not still templates, which is mechanical and takes milliseconds; this skill reads the criteria in .cursor/lifecycle/gates/ and decides whether they are worth anything,... Invoked as /lifecycle-gate."
---

<!-- GENERATED from the cursor-platform source skill "lifecycle-gate".
     Do not edit here - edit the source and re-run the plugin build. -->

# Skill: lifecycle-gate

**Invocation:** `/lifecycle-gate [PHASE]`

---

## Overview

`lifecycle-gate` evaluates whether a phase's artifacts are good enough to build
on, and returns a blocking GO or NO-GO. It is the judgement half of a two-part
check: `lifecycle.mjs check` proves the required documents exist and are not
still templates, which is mechanical and takes milliseconds; this skill reads
the criteria in `.cursor/lifecycle/gates/` and decides whether they are worth
anything, which needs to actually read them. A gate passes only when both halves
agree and a human then approves — three independent consents, because a gate one
party can clear alone is not a gate.

---

## Steps

**Step 1 — Establish the phase.**

Use the argument if given, otherwise the current phase from
`node ${CLAUDE_PLUGIN_ROOT}/tools/lifecycle.mjs status`.

**Step 2 — Run the mechanical check first.**

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/lifecycle.mjs check <PHASE> --json
```

If it fails, stop. Report the missing artifacts and name the skill that produces
each one. There is nothing to judge yet, and reading half a phase produces a
verdict worse than no verdict.

**Step 3 — Read the gate definition.**

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/lifecycle.mjs gate <PHASE>
```

Read that file in full. Its criteria are the contract; do not substitute your
own, add criteria it does not list, or drop ones it does.

**Step 4 — Read every artifact the phase produced.**

Read them, do not skim them. For phases 4-6, delegate the code-reading criteria
to the read-only subagents rather than pulling thousands of lines into the main
context:

| Criterion | Delegate to |
|---|---|
| Spec-vs-code agreement | `feature-analyst` |
| Architecture conformance | `dotnet-auditor`, `react-auditor` |
| Security and compliance | `security-auditor` |
| Schema and migration safety | `db-auditor` |
| Production readiness | `ops-reviewer` |

**Step 5 — Judge each criterion independently.**

For every criterion in the gate file, record: PASS or FAIL, the evidence
(file and line, or the command and its output), and for a FAIL, the specific
change that would turn it into a PASS.

Two failure modes to avoid, both of which make the gate useless:

- **Charity.** "Mostly covers it" is a FAIL. The criteria are written so a
  reasonable document passes; one that needs an argument does not.
- **Pedantry.** Do not fail a criterion the gate file does not state. If a real
  problem is not covered by any criterion, report it separately as an
  observation and propose adding a criterion.

**Step 6 — Run the phase's own tooling where it exists.**

| Phase | Also run |
|---|---|
| 4 Development | `node ${CLAUDE_PLUGIN_ROOT}/tools/flag-debt.mjs scan`, `/spec-drift-audit` |
| 5 Testing | `node ${CLAUDE_PLUGIN_ROOT}/tools/ac-trace.mjs check`, `node ${CLAUDE_PLUGIN_ROOT}/tools/ac-trace.mjs lint` |
| 6 Production | `/production-readiness-review` — its verdict is quoted verbatim |

**Step 7 — Emit the verdict in the gate file's own format.**

Every gate file ends with a verdict block. Use it exactly.

**Step 8 — Record the verdict. This is a consent, not a comment.**

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/lifecycle.mjs record-gate <PHASE> \
  --verdict GO|NO-GO --by "lifecycle-gate" \
  --criteria "<n>/<total>" --note "<one line>"
```

This is what makes the judgement consent real: `approve` refuses without it, and
the record is stamped with the gate definition's own hash, so tightening a
criterion later invalidates every approval granted under the looser version. It
also writes a machine-readable copy to `lifecycle/evidence/`, which is how "why
was this allowed?" stays answerable months later.

Record the verdict you actually reached. A NO-GO is recorded exactly like a GO;
recording only the outcomes that let work proceed makes the whole record
worthless.

**Step 9 — Stop.**

Do not run `approve`. Do not offer to. Print the command and let the user run
it, or say the words themselves:

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/lifecycle.mjs approve <PHASE> --by "<name>"
```

On GO for `DESIGN`, add one line: approving this unblocks `guard-phase.mjs` and
source writes become possible. The user should know what they are authorising.

---

## Rules

**Never soften a NO-GO.** Same rule as `/production-readiness-review`. A gate
that has never blocked anything is a form, not a control.

**A NO-GO names the fix.** "Criterion 4 fails" is useless. "Criterion 4 fails:
`nfr.md` says 'highly available' with no number; state a target and a measurement
window" is actionable.

**Never approve on the user's behalf.** The tool requires `--by` for this reason.
Recording a verdict is yours to do; granting approval is not.

**A GO is not permanent.** It is recorded against the current gate file and the
current artifact hashes. If either changes the phase reads `STALE` and must be
reviewed again — never treat a previous GO as still valid because you remember
giving it.

---

## Output

- Terminal: the verdict block from the gate definition, plus per-criterion
  evidence
- `lifecycle/evidence/<phase>-<timestamp>.json` — the machine-readable record
- The judgement consent recorded in `lifecycle/state.json`, via the tool
- No source or artifact writes. This skill judges; it does not fix.

