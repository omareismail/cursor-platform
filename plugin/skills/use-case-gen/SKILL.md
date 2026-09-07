---
name: use-case-gen
description: "use-case-gen expands every story in the map into a use case with actors, preconditions, a main flow, the alternate and exception flows, and post conditions — plus a Mermaid sequence diagram for anything crossing a system boundary. Its real output is the traceability table: story to use case, both directions, with no unmatched rows. Invoked as /use-case-gen."
---

<!-- GENERATED from the cursor-platform source skill "use-case-gen".
     Do not edit here - edit the source and re-run the plugin build. -->

# Skill: use-case-gen

**Invocation:** `/use-case-gen`

---

## Overview

`use-case-gen` expands every story in the map into a use case with actors,
preconditions, a main flow, the alternate and exception flows, and post
conditions — plus a Mermaid sequence diagram for anything crossing a system
boundary. Its real output is the traceability table: story to use case, both
directions, with no unmatched rows. A use case no story asked for is scope creep
arriving through the back door; a story no use case covers is a hole that
surfaces in phase 4 as "we never thought about that".

---

## Steps

**Step 1 — Read the inputs.**

`docs/product/story-map.md`, `docs/analysis/domain-model.md`.

**Step 2 — One use case per story, at minimum.**

A story with several distinct triggers becomes several use cases. Never merge
two stories into one use case to keep the count down — the merge hides a decision.

**Step 3 — Write the flows, unhappy paths included.**

```markdown
### UC-04 — Issue policy
**Actor:** Underwriter    **Story:** S-07    **Aggregate:** Policy
**Trigger:** Application passes underwriting
**Preconditions:** Application is in state Approved; premium calculated
**Postconditions:** Policy exists in state Issued; PolicyNumber assigned;
                    audit entry written (INV-03, BR-11)

**Main flow**
1. Underwriter opens the approved application
2. System verifies every linked payment is Settled       -> INV-03
3. System generates a PolicyNumber                        -> BR-11
4. System writes the Policy and the audit entry atomically
5. System notifies the customer

**Alternate flows**
A1. Payment partially settled -> hold in PendingPayment, notify broker
A2. Customer is a returning policyholder -> reuse the existing customer record

**Exception flows**
E1. Number generation collides -> retry three times, then fail the operation
     and alert; never issue two policies with one number
E2. Notification fails -> policy stands, notification queued for retry

**Data touched:** Policy (create), Application (update), AuditEntry (create)
```

Every step that enforces a rule cites the rule ID. That citation is what lets
Gate 2 verify the model and the flows agree.

**Step 4 — Diagram anything crossing a boundary.**

Where a flow involves the browser, the API, a queue, a payment gateway or a
legacy system, add a Mermaid `sequenceDiagram`. Where it does not, prose is
better — a diagram of two steps is noise.

**Step 5 — Build the traceability table.**

```markdown
| Story | Use cases | Requirement | Aggregate |
|---|---|---|---|
| S-07 | UC-04, UC-05 | FR-12 | Policy |
```

Then list the unmatched rows in both directions. These are Gate 2 blockers.

**Step 6 — Write `docs/analysis/use-cases.md` and `docs/analysis/workflows.md`.**

Use cases are the unit of behaviour; workflows are the end-to-end business
processes that chain them — quote to issue, claim to settlement — showing where
each one waits, branches, or hands off to a human.

---

## Front-matter — required on every document this skill writes

Open each file with this block. It is the machine-readable half of a
human-written document: the prose stays prose, and `artifact-schema.mjs` reads
this to know what the document is and where it sits in the chain.

```yaml
---
type: use-cases
phase: ANALYSIS
defines: [UC]
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

- `docs/analysis/use-cases.md`, `docs/analysis/workflows.md`
- Terminal: the traceability table and both sets of unmatched rows

