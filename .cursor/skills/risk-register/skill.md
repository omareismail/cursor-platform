# Skill: risk-register

**Invocation:** `/risk-register`

---

## Overview

`risk-register` produces the phase 2 risk register: what could make this product
fail, how likely, how bad, who owns it, and — the part that makes it useful —
which phase is responsible for retiring each risk. It is deliberately broader
than `/threat-model`, which runs in phase 3 and covers only what an attacker
could do. Most products do not fail because they were attacked; they fail
because a dependency was never available, a regulation was discovered late, or
the one person who understood the legacy schema left. Those risks have no
STRIDE category and no owner unless a register creates one.

---

## Steps

**Step 1 — Read the analysis so far.**

`docs/product/brief.md` (constraints, open questions), `prd.md`,
`docs/analysis/domain-model.md`, `use-cases.md`, `workflows.md`.

Every unanswered open question in the brief is already a risk. Start there.

**Step 2 — Sweep the categories.**

| Category | Ask |
|---|---|
| Business | What if the assumption in the brief is wrong? |
| Regulatory | Which approval is on the critical path? Who grants it, how long? |
| Data | Where does existing data come from, and how bad is it? |
| Integration | Which external system must cooperate, and what is its actual SLA? |
| Technical | What is being used here for the first time by this team? |
| Operational | Who runs this at 3am, and do they exist yet? |
| Delivery | What is the single point of knowledge failure? |

**Step 3 — Score, and be honest about the scale.**

Likelihood and impact as Low/Medium/High, each with a sentence of justification.
An unjustified score is a guess wearing a table.

**Step 4 — Assign an owner and a retiring phase.**

Every High risk names a person — not a team, a person — and the phase in which it
stops being a risk:

| Retired in | Typically |
|---|---|
| Phase 3 Design | Technical and integration risks — a design decision answers them |
| Phase 4 Development | Data quality — a migration spike answers it |
| Phase 5 Testing | Performance and capacity — a load test answers it |
| Phase 6 Production | Operational — a runbook and an on-call rota answer it |
| Never | Accepted. Say so explicitly, with who accepted it. |

A risk with no retiring phase will be discovered in production.

**Step 5 — Mark what phase 3 must answer.**

Risks retiring in Design become inputs to `/solution-architecture` and
`/threat-model`. List them separately so phase 3 cannot miss them; this list is
checked at Gate 3.

**Step 6 — Write `docs/analysis/risks.md`.**

```markdown
| ID | Risk | Cat | L | I | Owner | Retire in | Mitigation |
|---|---|---|---|---|---|---|---|
| R-04 | Legacy MOTORS schema has no referential integrity on VehicleId; migration may orphan policies | Data | H | H | <name> | Phase 4 | Profiling spike before the migration task is estimated |
```

Then a detail entry per High risk: what it would look like if it happened, the
early-warning signal, and the fallback.

**Step 7 — Report the unowned.**

Any High risk without a named owner is a Gate 2 blocker.

---

## Front-matter — required on every document this skill writes

Open each file with this block. It is the machine-readable half of a
human-written document: the prose stays prose, and `artifact-schema.mjs` reads
this to know what the document is and where it sits in the chain.

```yaml
---
type: risks
phase: ANALYSIS
defines: [R]
traces: [<repo-relative paths of the documents this was derived from>]
owner: business-analyst
---
```

`defines` names the ID prefixes this document **owns**. It is what stops the
first cell of a traceability table being mistaken for a second definition — a
citation of `S-1` in a use-case table is a reference, not a redeclaration.

Validate before reporting done:

```bash
node .cursor/tools/artifact-schema.mjs validate
node .cursor/tools/artifact-schema.mjs check
```

`check` fails on an ID cited but never defined, and on a chain that stops — a
requirement no story implements, a story no use case covers, a use case no
endpoint serves. Those are gate criteria, computed rather than judged, and
`lifecycle.mjs check` now fails on them too.

---

## Output

- `docs/analysis/risks.md`
- Terminal: High risks with no owner, risks with no retiring phase, and the
  list phase 3 must answer
