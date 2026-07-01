# Skill: refactor-assistant

**Invocation:** `/refactor-assistant [scope]`
Example: `/refactor-assistant full` · `/refactor-assistant Tamkeen.Payments`

---

## Overview

**Memory references:** none directly — this skill reads *output*, not source.
It calls `dotnet-clean-code-guard`, `react-clean-code-guard`, and
`technical-debt-tracker` (`scan` mode) and consolidates their findings. It
does not re-implement god-class/dead-code/duplication detection — that logic
already exists in three places and stayed in those three places. The Phase 1
gap this closes is specifically: **nothing currently gives a single
prioritized view across both stacks plus tracked debt.** Without this, a
developer has to run three skills and manually cross-reference severity to
know what to actually work on first.

This is intentionally the thinnest skill in the workspace. If a finding looks
wrong, the fix belongs in `dotnet-clean-code-guard`, `react-clean-code-guard`,
or `technical-debt-tracker` — never patched locally inside this skill's own
logic, or the three sources of truth start drifting from each other again.

---

## Steps

**Step 1 — Run the three source skills against the given scope.**

```
/dotnet-clean-code-guard [scope's .NET path, if any]
/react-clean-code-guard [scope's frontend path, if any]
/technical-debt-tracker scan [scope]
```

If scope is `full`, run all three unscoped. If scope is a single
project/service name, resolve it to its backend and/or frontend paths via
`repo-map.json` (from `repo-discovery`) before invoking the three skills —
don't ask the developer to know the literal folder paths themselves.

**Step 2 — Normalize severities to one scale.**

The three source skills use compatible but not identical severity vocab
(`dotnet-clean-code-guard`'s MUST FIX/SHOULD FIX/INFO,
`react-clean-code-guard`'s equivalent tiers, `technical-debt-tracker`'s
risk-level scan results). Map all three onto one scale for this report:

| Source tier | Unified tier |
|---|---|
| MUST FIX / Blocking | **Critical** |
| SHOULD FIX / High risk | **High** |
| INFO / Medium risk | **Medium** |
| Tracked, low risk | **Low** |

Never silently re-rank a finding's severity — if a SHOULD FIX item looks more
urgent than a MUST FIX item once cross-referenced (e.g. the SHOULD FIX is in
a payment-critical path), say so as a note, but keep the source skill's
original tier visible alongside the unified one.

**Step 3 — De-duplicate overlapping findings.**

`technical-debt-tracker`'s `scan` mode and the two clean-code-guards can
legitimately flag the same underlying issue (e.g. a god class that's both a
`dotnet-clean-code-guard` MUST FIX and a `// TODO: refactor this` comment
`technical-debt-tracker` picked up). Merge these into one entry, citing both
sources, rather than listing the same problem twice with different wording.

**Step 4 — Prioritize, don't just list.**

Order the consolidated report by: Critical first, then within each tier by
how many call sites/files are affected (a duplication pattern hit in 6 files
ranks above one hit in 1 file, all else equal), then by which bounded context
it's in if `repo-map.json` shows it's payment-critical or
regulatory-adjacent (ZATCA, SAMA, mada-related code gets a visibility bump
even at the same nominal severity, since the blast radius of a bug there is
categorically different).

**Step 5 — Produce a single actionable report, not three reports stapled
together.**

Group by theme (god classes, duplication, dead code, async anti-patterns,
accessibility, etc.) across both stacks rather than by source language —
"Duplication" as one section covering both a repeated C# validation block
and a repeated React form-handling pattern is more useful for sprint
planning than separate "backend duplication" and "frontend duplication"
sections.

**Step 6 — Hand off anything not addressed immediately.**

Anything not fixed in the current pass should already be in
`memory-bank/techDebt.md` via `technical-debt-tracker` — this skill doesn't
write new tracker entries itself, it only confirms nothing surfaced in
Steps 1-2 is missing from the existing ledger, and flags it to
`technical-debt-tracker log` if it is.

---

## Example Invocation

**Command:** `/refactor-assistant Tamkeen.Payments`

**Context:** Sprint planning — deciding what refactoring work to schedule
alongside new feature work.

Agent runs all three source skills scoped to `Tamkeen.Payments`'s backend and
frontend paths, finds a god-class finding in `PaymentReconciliationService`
(MUST FIX from `dotnet-clean-code-guard`) that's also referenced in
`techDebt.md` as "reconciliation logic needs splitting — deferred for
DirectPay launch," merges them into one Critical entry citing both sources,
and ranks it above three Medium-severity React duplication findings since
it's in the payment-critical path and already has two independent sources
flagging it.

---

## Output

- One consolidated, prioritized findings report grouped by theme
- Each entry cites its original source skill(s) so the developer can drill
  into the full detail there if needed
- Confirmation that all findings are reflected in `memory-bank/techDebt.md`,
  or a note on what was added
- **Next step:** to actually apply the safe subset of these findings rather
  than just reading them, run `/refactor-apply [same scope]` — it reuses
  this report instead of re-scanning
