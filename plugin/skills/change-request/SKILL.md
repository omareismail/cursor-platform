---
name: change-request
description: "change-request records a change to a product that is already approved, and computes its blast radius from the traceability graph instead of guessing at it. It is the precise counterpart to lifecycle.mjs rollback, which reopens a phase and resets every later one: rollback is right for 'we got the architecture wrong' and useless for the thing that actually happens, where a customer changes one... Invoked as /change-request."
---

<!-- GENERATED from the cursor-platform source skill "change-request".
     Do not edit here - edit the source and re-run the plugin build. -->

# Skill: change-request

**Invocation:** `/change-request [what changed]`

---

## Overview

`change-request` records a change to a product that is already approved, and
computes its blast radius from the traceability graph instead of guessing at it.
It is the precise counterpart to `lifecycle.mjs rollback`, which reopens a phase
and resets every later one: rollback is right for "we got the architecture
wrong" and useless for the thing that actually happens, where a customer changes
one payment rule and somebody has to work out what that touches. This walks the
IDs — requirement to story to use case to endpoint — and names the documents,
the phases and the approvals that will stop being true, before the edit is made
rather than after.

---

## Steps

**Step 1 — Establish what actually changed, as IDs.**

Not "the payment rules changed" — `BR-4` changed. If the user describes the
change in prose, find the IDs it refers to:

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/artifact-schema.mjs graph
```

An ID that does not exist yet is not a change, it is a new requirement: that is
phase 1 work, not a change request. Say so rather than inventing an ID.

**Step 2 — Forecast before recording anything.**

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/change-request.mjs impact BR-4 FR-2
```

Read the output to the user before opening anything. Three things matter:

- **Impact** — the downstream IDs, with the citation path that reached each one
- **Documents to revise** — the concrete work
- **Re-approval required** — which approved phases will go `STALE`

If the answer is bigger than the user expected, that is the point of running it.

**Step 3 — Check whether this is a change request at all.**

| Situation | Use |
|---|---|
| An approved decision turned out wrong | `/change-request` |
| Nothing is approved yet | just edit the documents; there is nothing to invalidate |
| The whole architecture is wrong | `lifecycle.mjs rollback DESIGN --reason "..."` |
| A new capability nobody asked for yet | phase 1 — `/product-requirements`, `/user-story-map` |

**Step 4 — Open it.**

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/change-request.mjs open \
  --changes "BR-4" --reason "<why, in the requester's words>" \
  --by "<who asked>" --risk LOW|MED|HIGH
```

`--reason` is the requester's reason, not yours. "Customer changed the payment
rules: instalments are now allowed above 5,000 SAR" survives; "update business
rules" does not.

**Step 5 — Revise the documents, in phase order.**

Work upstream first — the requirement, then the story, then the use case, then
the design. Editing the endpoint before the rule that justifies it produces a
design nobody can trace.

Every phase whose documents you touch goes `STALE` on its own: `lifecycle.mjs`
derives that from the artifact hashes recorded at approval. Nothing needs to
invalidate it, and nothing here does — this skill forecasts and records; the
hashes enforce.

**Step 6 — Re-earn each approval.**

For every phase the forecast named:

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/lifecycle.mjs check <PHASE>
```
then `/lifecycle-gate <PHASE>` — a full review, not a formality. The previous GO
was recorded against text that no longer exists. Then the human approves again.

**Step 7 — Close it.**

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/change-request.mjs close CR-0001 --note "<what shipped>"
```

Close reports which phases the forecast said would need re-approval, so a
change closed while a phase is still `STALE` is visible rather than quiet.

---

## Rules

**Never open one without running `impact` first.** A change request whose blast
radius nobody looked at is a ticket, not a control.

**Never re-approve a phase because it used to be approved.** `STALE` means the
approval was granted against text that has since changed.

**One change request per reason.** Two unrelated changes in one record make the
impact list unreadable and the history unusable.

---

## Output

- `lifecycle/changes/CR-NNNN.json` — reason, requester, risk, the computed
  impact, the documents, and which phases need re-approval
- Terminal: the impact tree, the documents to revise, the approvals at stake

