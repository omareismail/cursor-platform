# Skill: prompt-quality-audit

**Invocation:** `/prompt-quality-audit [prompt-text-or-spec-reference]`
Example: `/prompt-quality-audit "build a refund endpoint"` · `/prompt-quality-audit specs/features/refund-processing.md`

---

## Overview

**Memory references:** `memory-bank/businessRules.md`, `memory-bank/glossary.md`

`05-planning-rigor.mdc` already forces an elicitation pass before any plan,
spec, or constitution is produced, and `speckit-clarify` already does
structured clarification inside the speckit pipeline. This skill is not a
third implementation of the same idea — it's the standalone, ad hoc version:
something you can point at *any* prompt (a one-line chat request, a draft
spec, an issue description someone else wrote) outside the speckit pipeline,
without first committing to running the full spec-driven flow. Use this when
you want a quick quality check on a request before deciding whether it needs
the full `speckit-specify` treatment at all.

This skill never executes the prompt it's reviewing — it only evaluates and
improves it.

---

## Steps

**Step 1 — Check for ambiguity.**

Identify terms or requirements that could reasonably be interpreted more
than one way. Flag each with the specific alternative readings, not just
"this is ambiguous":

```
"build a refund endpoint" — ambiguous on:
- Full refund only, or partial refund amount support?
- Does this require gateway-side reversal (DirectPay refund API call), or
  is it an internal ledger-only adjustment?
- Synchronous response, or does refund processing happen async with a
  status the caller polls?
```

**Step 2 — Check for missing assumptions.**

What is the prompt implicitly assuming that isn't stated? Cross-reference
`businessRules.md`/`glossary.md` for established terms the prompt uses
loosely (e.g. "refund" may have a specific defined meaning in this domain
that differs from a generic understanding).

**Step 3 — Check for missing constraints.**

- Regulatory constraints this domain typically has (cross-reference
  `compliance-audit`'s scope — does this prompt's feature touch
  SAMA/ZATCA/mada-relevant territory and the prompt doesn't mention it?)
- Performance/scale constraints (expected volume, latency requirement)
- Security constraints (who's authorized to trigger this)

**Step 4 — Check for missing edge cases.**

Enumerate the edge cases a feature like this typically needs and flag which
ones the prompt doesn't address: partial failure mid-operation, the
already-refunded case, the gateway-timeout-but-money-actually-moved case,
concurrent refund attempts on the same transaction.

**Step 5 — Check for missing acceptance criteria.**

Does the prompt define what "done" looks like in a testable way, or only
describe the feature in general terms? Flag the absence, don't invent
acceptance criteria on the prompt's behalf — that's a decision for whoever
owns the requirement.

**Step 6 — Check hallucination risk for the *agent* executing this prompt.**

Specifically: does the prompt contain enough repository-grounding that an
agent executing it would be forced to use `pattern-finder`/`context-builder`
rather than inventing a plausible-sounding implementation from general
training knowledge? A prompt like "build a refund endpoint" with no
reference to the existing payment flow invites exactly that risk — flag it.

**Step 7 — Produce the improved version.**

Rewrite the prompt incorporating answers to Steps 1-6 where the answer is
inferable from existing memory-bank/repo context, and as explicit open
questions where it isn't:

```
## Improved prompt

Build a refund endpoint for the DirectPay gateway that:
- Supports partial refunds up to the original transaction amount
- Calls DirectPay's reversal API synchronously; if the gateway times out
  after the call was sent, the transaction enters a "RefundPending"
  state for ReconciliationJob to resolve (per existing void-payment pattern)
- Requires "PaymentOperator" auth policy or stricter (see context-builder
  open question on whether refund needs a stricter policy than void)
- Records a full audit trail per 07-audit-trail-guard.mdc (audit-required
  entity)
- Handles: already-refunded transaction (reject with 409), concurrent
  refund attempts (optimistic concurrency check), gateway timeout
  (RefundPending state, not silent failure)

## Open questions (not inferable from repo context)
1. Is there a maximum number of partial refunds allowed per transaction?
2. Does finance need a separate approval step for refunds above a SAR
   threshold?
```

---

## Example Invocation

**Command:** `/prompt-quality-audit "add caching to the broker search endpoint"`

**Context:** Quick sanity check before handing this off to
`dotnet-caching-gen`.

Agent flags: no TTL specified, no cache-invalidation trigger specified (does
a broker update need to bust the cache?), and confirms `dotnet-caching-gen`'s
own Step 1 (verify read-only) will catch the side-effect risk separately —
doesn't duplicate that check here, just flags it's relevant.

---

## Output

- Findings grouped by the six check categories above
- An improved prompt incorporating inferable answers
- An explicit open-questions list for anything not inferable from repo
  context — never silently filled in
