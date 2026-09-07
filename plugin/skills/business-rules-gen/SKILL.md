---
name: business-rules-gen
description: "Runs the business-rules-gen workflow. Invoked as /business-rules-gen."
---

<!-- GENERATED from the cursor-platform source skill "business-rules-gen".
     Do not edit here - edit the source and re-run the plugin build. -->

# Skill: business-rules-gen

**Invocation:** `/business-rules-gen`

---

## Overview

**Memory references:** `memory-bank/businessRules.md, memory-bank/glossary.md`

`business-rules-gen` collects every constraint scattered across the brief, the
PRD, the story acceptance criteria, the domain invariants and the use case flows
into one numbered catalogue, and prepares it for promotion into
`memory-bank/businessRules.md`. That promotion is the point: a rule sitting in an
analysis document is a note, while the same rule in the memory-bank is read by
`07-audit-trail-guard` and enforced on every handler for the rest of the
project's life. This is the skill that turns phase 2's conclusions into something
the compiler-adjacent parts of the platform can act on.

---

## Steps

**Step 1 — Harvest from every source.**

| Source | Look for |
|---|---|
| `docs/product/brief.md` | Constraints, regulatory surface |
| `docs/product/prd.md` | The business-rules table, money/PII/auth flags |
| `docs/product/story-map.md` | Rules hiding inside acceptance criteria |
| `docs/analysis/domain-model.md` | Invariants (`INV-*`) |
| `docs/analysis/use-cases.md` | Rules cited in flow steps |

Rules hide in acceptance criteria more than anywhere else. "Then the no-claims
discount shows 15%" contains a rule nobody wrote down.

**Step 2 — Deduplicate and reconcile.**

The same rule stated twice in different words is normal. Two rules that
*contradict* each other is the finding this skill exists to surface — report it
rather than picking one, because choosing silently is how a system ends up
enforcing a rule nobody agreed to.

**Step 3 — Classify each rule.**

| Class | Meaning | Enforced where |
|---|---|---|
| Invariant | Must always hold | Domain entity |
| Constraint | Limits an input | Validation |
| Derivation | Computes a value | Domain service |
| Process | Governs a transition | Handler / state machine |
| Regulatory | Externally imposed | Handler + audit trail |

The class decides the layer. A regulatory rule enforced only in the UI is a
finding, not a design.

**Step 4 — Write each rule so a test could fail it.**

```
BR-11  A PolicyNumber is unique across all policies, generated at issue,
       and never reused — including after cancellation.
       Class: Invariant   Source: UC-04 step 3   Audit: yes
       Regulatory: SAMA policy-register requirements
```

**Step 5 — Mark audit and precision.**

Every rule touching money names its precision and currency. Every rule whose
subject must record who/when/what-changed is flagged. These two flags are what
rule 07 consumes.

**Step 6 — Write `docs/analysis/business-rules.md`.**

One table plus the detail entries, and a section listing contradictions found
in Step 2 with the pair of sources for each.

**Step 7 — Prepare the promotion, do not perform it.**

`memory-bank/businessRules.md` is Tier 2 and human-authored;
`guard-write.mjs` blocks agent writes to it. Produce the exact diff, show it,
and ask. Only on the user's word:

```bash
CLAUDE_ALLOW_TIER2_EDIT=1   # then apply the agreed diff
```

Never promote silently. The block is the design working.

---

## Front-matter — required on every document this skill writes

Open each file with this block. It is the machine-readable half of a
human-written document: the prose stays prose, and `artifact-schema.mjs` reads
this to know what the document is and where it sits in the chain.

```yaml
---
type: business-rules
phase: ANALYSIS
defines: [BR]
traces: [<repo-relative paths of the documents this was derived from>]
owner: business-analyst
---
```

`defines` names the ID prefixes this document **owns**. It is what stops the
first cell of a traceability table being mistaken for a second definition — a
citation of `S-1` in a use-case table is a reference, not a redeclaration.

Validate before reporting done:

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/artifact-schema.mjs validate
node ${CLAUDE_PLUGIN_ROOT}/tools/artifact-schema.mjs check
```

`check` fails on an ID cited but never defined, and on a chain that stops — a
requirement no story implements, a story no use case covers, a use case no
endpoint serves. Those are gate criteria, computed rather than judged, and
`lifecycle.mjs check` now fails on them too.

---

## Output

- `docs/analysis/business-rules.md`
- A proposed diff for `memory-bank/businessRules.md`, applied only on approval
- Terminal: contradictions, unclassified rules, money rules with no precision

