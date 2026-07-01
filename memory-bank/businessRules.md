# Business Rules
**Last Updated:** [YYYY-MM-DD]
**Owner:** product + lead architect — this is domain truth, not implementation detail

Generated code (especially `dotnet-endpoint-gen`, `speckit-specify`) must check
assumptions against this file before inventing business logic. If a rule isn't here
and isn't in the spec, the agent should ask rather than assume.

## Format
Each rule: plain-language statement, then the enforcement point (where it's checked).

---
### Example domain: motor insurance + payments (replace with your actual domain)

**BR-001 — A policy cannot be issued without a successful payment confirmation.**
Enforcement: `IssuePolicyCommandHandler` checks `PaymentStatus == Confirmed` before
writing the policy; webhook handler is the only writer of `PaymentStatus`.

**BR-002 — Webhook events must be verified via HMAC signature before processing.**
Enforcement: middleware in Infrastructure, rejects with 401 before reaching the handler.
(This was previously disabled in production — see `commonMistakes.md` CM-001.)

**BR-003 — Duplicate webhook deliveries must not double-process a payment.**
Enforcement: idempotency key (provider event ID) stored and checked before handling.

**BR-004 — Vehicle category to third-party UUID mapping is many-to-one, never the reverse.**
Enforcement: unique constraint on the mapping table's third-party UUID column only.

**BR-005 — Motor model name matching for deduplication uses a fuzzy threshold, but
exact matches always win over fuzzy ones regardless of score.**
Enforcement: dedup service checks exact match first, falls back to fuzzy only if none found.
