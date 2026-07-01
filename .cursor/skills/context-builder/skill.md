# Skill: context-builder

**Invocation:** `/context-builder [task-description]`
Example: `/context-builder implement refund processing for DirectPay gateway`

---

## Overview

**Memory references:** `.cursor/cache/repo-map.json` (from `repo-discovery`),
output of `pattern-finder` if already run for the same task, relevant Tier 2
convention files.

`context-builder` is distinct from both existing foundational skills, not a
restatement of either:

- **`repo-discovery`** answers "what does the whole repo look like?" — one
  structural map, repo-wide, cached, rarely re-read in full by a human.
- **`pattern-finder`** answers "what's the single nearest example to imitate
  for this one artifact type?" — narrow, ranked, 1-3 candidates.
- **`context-builder`** answers a different question: **"for this specific
  task, what is the complete set of files, interfaces, and cross-cutting
  concerns I need to be aware of before touching anything?"** — broader than
  pattern-finder's single-example match, but scoped to the task rather than
  the whole repo. A refund-processing task needs to know about the existing
  `PaymentTransaction` entity, its DTOs, the validators touching it, any
  feature flag gating refund eligibility, the auth policy on the endpoint
  that will expose it, the background job that reconciles failed refunds,
  and the tests already covering adjacent payment flows — `pattern-finder`
  alone would only surface the nearest *handler*, not this whole working set.

Every `*-gen` skill already calls `pattern-finder`. As of this phase,
multi-file or cross-cutting tasks (new feature spanning endpoint + handler +
entity + tests + background job, not a single artifact) should call
`context-builder` first, then let the individual `*-gen` skills' own
`pattern-finder` calls handle each artifact's specific shape. Use
`context-builder` for the "what am I working with" pass, `pattern-finder` for
the "how does this repo write this specific thing" pass.

---

## Steps

**Step 1 — Classify the task's blast radius.**

From the task description, identify every cross-cutting concern category
that's plausibly relevant: entities/DTOs, repositories/services, validators,
configuration, middleware, DI registration, auth/authz policy, feature
flags, caching, background services, SignalR, logging. Not every task
touches every category — a pure UI-layout change touches almost none of
these; a new payment flow touches most.

**Step 2 — Resolve each relevant category against `repo-map.json`.**

For each category flagged in Step 1, find matching files:
- Entities/DTOs — search by the task's named domain concept (e.g. "refund")
  against entity/DTO naming patterns in the conventions fingerprint
- Repositories/services — same domain concept, against repository/service
  naming patterns
- Validators — paired validator files for any matched command/DTO
- Configuration — `appsettings*.json` sections matching the domain concept
  or the infra it touches (e.g. a new gateway integration → gateway-specific
  config section)
- Middleware/DI — registration sites that would need a new entry (DI
  container setup, middleware pipeline ordering) if this task adds a new
  service
- Auth/authz — existing policy definitions the new code should reuse, not
  reinvent
- Feature flags — existing flag-check patterns, if this repo gates rollout
  behind flags
- Caching/background services/SignalR — only if the task description or
  Step 1 classification suggests it's relevant
- Tests — existing test files for the closest adjacent functionality, so
  new tests follow the same structure

**Step 3 — Surface conflicts and gaps, don't silently fill them in.**

If two related entities use inconsistent patterns (one uses `Result<T>`,
an adjacent one throws exceptions), or a needed piece simply doesn't exist
yet (no existing feature-flag pattern, but the task implies one is needed),
report this explicitly rather than picking a default — this is exactly the
kind of decision `05-planning-rigor.mdc` exists to force through proper
elicitation, not something to resolve silently inside context assembly.

**Step 4 — Produce a structured context object.**

```
## Context for: "implement refund processing for DirectPay gateway"

**Entities/DTOs:**
- PaymentTransaction (Tamkeen.Payments.Domain/Entities/PaymentTransaction.cs)
- RefundRequestDto — does not exist yet, no existing pattern to imitate;
  nearest analog is VoidPaymentRequestDto

**Services/Repositories:**
- IPaymentGatewayClient (interface) + DirectPayGatewayClient (impl)
- PaymentTransactionRepository (Dapper, Oracle)

**Validators:**
- VoidPaymentCommandValidator — closest existing pattern for a similar
  state-transition command

**Config:**
- appsettings.json → "DirectPay" section already has webhook secret config

**Auth:**
- "PaymentOperator" policy used on VoidPayment endpoint — refund likely
  needs the same or a stricter policy; flagged for explicit decision

**Feature flags:**
- No existing flag pattern found for payment operations — refund
  rollout-gating, if needed, is a new pattern, not an extension of one

**Background services:**
- ReconciliationJob (Hangfire) already polls PaymentTransaction.Status —
  confirm whether refund needs a corresponding state it should pick up

**Audit trail (per 07-audit-trail-guard.mdc):**
- PaymentTransaction is audit-required; refund mutation must follow the
  same audit pattern as VoidPayment

**Tests:**
- VoidPaymentCommandHandlerTests — structural template for refund's tests

**Open questions before implementation:**
1. Should refund use the same "PaymentOperator" auth policy as void, or a
   stricter one given it moves money back out?
2. No feature-flag pattern exists in this codebase — is one needed for
   refund rollout, or ship without gating?
```

**Step 5 — Hand off, don't duplicate downstream work.**

This context object is consumed by whichever `*-gen` skills implement the
individual pieces — it doesn't generate code itself, and its findings about
specific artifact shape (e.g. "what does a validator look like here")
defer to that artifact type's own `pattern-finder` call rather than
re-deriving it.

---

## Example Invocation

**Command:** `/context-builder implement refund processing for DirectPay gateway`

**Context:** Kickoff of a new feature spanning multiple files, before
running `speckit-specify` or any individual `*-gen` skill.

Agent classifies the task as touching entities, services, validators,
config, auth, background services, and audit trail; resolves each against
`repo-map.json`; surfaces two open questions (auth policy strictness,
absence of a feature-flag pattern) rather than guessing; hands off the
structured context for `speckit-specify`/`dotnet-endpoint-gen` to consume.

---

## Output

- Structured context object (categories above, only populated where
  relevant — not padded with empty sections)
- Explicit list of open questions/conflicts found, not silently resolved
- No code generated — this is an assembly step, consumed by generation
  skills, not a generator itself
