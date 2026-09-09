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

**You are not the reviewer. The gate file names the reviewer.** Each gate is
judged by a subagent that did not write the artifacts it is judging — phase 1 is
judged by `business-analyst`, phase 3 by `security-auditor`, and so on. This
skill is the procedure that reviewer follows. Run as anyone else and
`record-gate` refuses the verdict.

---

## Steps

**Step 1 — Establish the phase.**

Use the argument if given, otherwise the current phase from
`node .cursor/tools/lifecycle.mjs status`.

**Step 2 — Run the mechanical check first.**

```bash
node .cursor/tools/lifecycle.mjs check <PHASE> --json
```

If it fails, stop. Report the missing artifacts and name the skill that produces
each one. There is nothing to judge yet, and reading half a phase produces a
verdict worse than no verdict.

**Step 3 — Read the gate definition, and find out who may judge it.**

```bash
node .cursor/tools/lifecycle.mjs gate <PHASE>
```

That prints the gate file, who authored the phase, and **who reviews it**. Read
the gate file in full. Its criteria are the contract; do not substitute your own,
add criteria it does not list, or drop ones it does.

Then decide where you are:

- **You are the main thread.** Stop. Launch the named reviewer as a subagent and
  give it this skill and the phase. It must reach the criteria through the
  documents, not through the conversation that produced them — that is the whole
  reason the review is a separate context.
- **You are already that reviewer.** Continue at step 4. Do not read back over
  the authoring conversation even if it is available to you.
- **You are a different subagent.** Stop and say so. `record-gate` will refuse
  your verdict, and a verdict that cannot be recorded is a wasted read.

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
| 4 Development | `node .cursor/tools/flag-debt.mjs scan`, `/spec-drift-audit` |
| 5 Testing | `node .cursor/tools/ac-trace.mjs check`, `node .cursor/tools/ac-trace.mjs lint` |
| 6 Production | `/production-readiness-review` — its verdict is quoted verbatim |

**Step 7 — Emit the verdict in the gate file's own format.**

Every gate file ends with a verdict block. Use it exactly.

**Step 8 — Record the verdict. This is a consent, not a comment.**

```bash
node .cursor/tools/lifecycle.mjs record-gate <PHASE> \
  --verdict GO|NO-GO --by "<the reviewer the gate names>" \
  --criteria "<n>/<total>" --note "<one line>"
```

`--by` must be the role from the gate file's `**Reviewed by:**` line. Anything
else is refused, and if the name you pass is one of the phase's authors the
refusal says so.

This is what makes the judgement consent real: `approve` refuses without it, and
the record is stamped with the gate definition's own hash, so tightening a
criterion later invalidates every approval granted under the looser version. It
also hashes every artifact you just read, so an edit made between your verdict
and the signature voids the verdict rather than riding along with it. It writes a
machine-readable copy to `lifecycle/evidence/`, which is how "why was this
allowed?" stays answerable months later.

Record the verdict you actually reached. A NO-GO is recorded exactly like a GO;
recording only the outcomes that let work proceed makes the whole record
worthless.

**Step 9 — Stop.**

Do not run `approve`. Do not offer to. Print the command and let the user run
it, or say the words themselves:

```bash
node .cursor/tools/lifecycle.mjs approve <PHASE> --by "<a human — not you>"
```

`approve` refuses a signature from the same party that recorded the verdict. Two
consents held by one name is one consent. And `guard-bash.mjs` refuses the
command itself when it comes from the agent's shell — `approve`, `override`,
`init --existing`, `release-evidence.mjs sign` — so typing it with the user's
name is not a shortcut, it is a refusal with a log line.

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

**Never judge what you wrote.** If you authored any artifact in this phase, you
are the wrong reviewer for it, however carefully you read. An author re-reading
their own work still has all of the author's reasons in context and never finds
the thing they did not think of the first time. Say so and name the reviewer the
gate file declares.

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
