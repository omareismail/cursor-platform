# Skill: compliance-audit

**Invocation:** `/compliance-audit [scope] [framework]`
Example: `/compliance-audit Tamkeen.Payments zatca` · `/compliance-audit full sama` · `/compliance-audit full`

Framework can be `sama` | `zatca` | `mada` | `all` (default: `all`).

---

## Overview

**Memory references:** `memory-bank/businessRules.md`,
`memory-bank/securityStandards.md`, `memory-bank/databaseConventions.md`
(for audit-trail/retention requirements), `.cursor/cache/repo-map.json`

`compliance-audit` is deliberately separate from `04-security-guard.mdc` and
`security-perf-report`. Those cover generic security posture (OWASP Top 10,
secrets, injection) — this skill checks specific **regulatory** requirements
from SAMA (Saudi Central Bank), ZATCA (e-invoicing), and mada (the domestic
card scheme) that have no equivalent in a generic security checklist and
that a generic-trained model has no reliable default knowledge of. A repo
can be fully OWASP-compliant and still fail a SAMA examination or reject
mada transactions for a scheme-specific reason a generic audit wouldn't
catch.

**Honesty note on scope:** regulatory requirements change, and getting this
wrong has real compliance consequences — this skill checks code-level
*implementation patterns* against requirements already captured in
`businessRules.md`/`securityStandards.md` (human-verified, kept current by
your own compliance review process), not against this skill's own
out-of-context knowledge of what SAMA/ZATCA currently require. If
`businessRules.md` doesn't document a specific requirement yet, this skill
flags the gap and asks for it to be added — it does not invent regulatory
detail to fill the gap. Treat this skill's output as a code-level compliance
sanity check that complements your compliance team's sign-off, never as a
substitute for it.

---

## Steps

**Step 1 — Confirm the applicable framework(s) are documented.**

Check `businessRules.md` for an explicit section per requested framework. If
`sama`/`zatca`/`mada` is requested but `businessRules.md` has no
corresponding section, stop and report the gap rather than auditing against
assumed requirements:

```
⚠ No ZATCA section found in businessRules.md. This skill can audit code
  against documented requirements, not invent them. Add the relevant ZATCA
  e-invoicing requirements (UUID/hash chain, QR code spec, Phase 2
  integration requirements, etc.) to businessRules.md first, or scope this
  run to the frameworks that are documented.
```

**Step 2 — ZATCA e-invoicing checks (where documented).**

Against whatever `businessRules.md` specifies for this project, typically
covering:
- Invoice UUID and previous-invoice-hash chaining present and correctly
  ordered (a broken hash chain is a hard compliance failure, not a warning)
- QR code generation matches the documented TLV (tag-length-value) field
  order
- Invoice amounts in SAR with the documented decimal precision (ZATCA is
  specific about this — don't assume standard `decimal` rounding behavior
  is automatically compliant without checking what `businessRules.md` says)
- Simplified vs. standard tax invoice logic correctly branches per
  documented thresholds, not hardcoded to one invoice type
- Cryptographic stamp/signing implementation matches the documented
  Phase 2 integration requirement, not a placeholder

**Step 3 — SAMA checks (where documented).**

Typically covering:
- Data residency — flag any code path that could route customer financial
  data through infrastructure outside the documented approved jurisdiction
  (cross-reference `deploymentNotes.md` for actual deployment regions, via
  `repo-map.json`/`devops-audit` findings rather than re-deriving this)
- Audit trail retention period matches the documented SAMA-required minimum
  (cross-reference `07-audit-trail-guard.mdc`'s findings — this skill
  doesn't re-implement audit-trail detection, it checks the *retention
  policy* configured for that audit data, a distinct concern)
- Incident/breach notification hooks exist where `businessRules.md`
  documents a required notification trigger (e.g. automated alerting tied
  to a documented threshold)

**Step 4 — mada scheme checks (where documented).**

Typically covering:
- Transaction routing correctly distinguishes mada from other card schemes
  where `businessRules.md` specifies scheme-specific handling (fee
  structure, settlement timing, or message format differences)
- mada-specific response/error code handling isn't silently collapsed into
  generic gateway error handling if `businessRules.md` documents scheme-specific
  codes requiring distinct handling

**Step 5 — Classify and report.**

- **Compliance-blocking** — a documented hard requirement
  (`businessRules.md` marks it non-negotiable) that the code doesn't meet
- **Gap** — `businessRules.md` doesn't document the requirement at all for
  something this skill has reason to believe is regulatory-relevant (Step 1)
- **Risk** — implementation exists but doesn't fully match the documented
  spec (partial implementation, placeholder values)

Never silently resolve a Gap by assuming a reasonable default — regulatory
requirements are not the place for this skill to guess.

---

## Example Invocation

**Command:** `/compliance-audit Tamkeen.Payments zatca`

**Context:** Pre-launch check before a new e-invoicing feature goes live.

Agent confirms `businessRules.md` has a documented ZATCA section, checks the
generated invoice UUID/hash-chain implementation against it, finds the
previous-invoice-hash field is populated correctly but the QR code TLV field
order doesn't match what's documented (fields 4 and 5 are swapped) —
classified Compliance-blocking, since a malformed QR code fails ZATCA
validation outright.

---

## Output

- Per-framework findings table (requirement, documented spec reference,
  code location, classification)
- Explicit list of any requested framework with no documented requirements
  to audit against (a Step 1 gap, surfaced first, not buried in the report)
- No auto-generated fixes for compliance-blocking findings — these need
  human/compliance-team sign-off before any code change ships, consistent
  with `05-planning-rigor.mdc`'s treatment of consequential changes
