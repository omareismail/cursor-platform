# Skill: release-safety

**Invocation:** `/release-safety [feature/change]`

---

## Overview

`release-safety` plans how a mobile change reaches users without a
big-bang cutover, and how it gets pulled back if something's wrong — the
mobile-specific version of this concern, since a shipped app binary can't
be hotfixed the way a backend deploy can. Covers staged store rollout,
feature flags, and a rollback plan that's honest about what a store
rollback does and doesn't undo.

**Memory references:** `memory-bank/architecture.md`,
`memory-bank/techContext.md` (confirm what remote-config/feature-flag
mechanism, if any, is already in the app).

**Guard rules:** `05-planning-rigor.mdc` (elicitation before committing to
a rollout plan).

---

## Steps

**Step 1 — Staged rollout via the store console.** Both major stores
support a percentage-based phased rollout:
- **Google Play Console** — staged rollout percentage (e.g. 5% → 20% → 50%
  → 100%), with the ability to halt at any stage if crash-free rate or
  ANR rate regresses.
- **App Store Connect** — phased release over up to 7 days, similarly
  halt-able, though Apple's phased release only applies to updates for
  users with automatic updates enabled — some users still get the update
  immediately if they check manually.

State explicitly: a store-level halt stops *new* installs of that version
from progressing to more users, it does **not** un-install the version
from devices that already updated — that's the "rollback doesn't undo"
point client-side releases share with schema migrations.

**Step 2 — Feature flags for anything riskier than a UI tweak.** If a
remote-config/feature-flag mechanism is already in the app
(`memory-bank/techContext.md`), gate new/risky functionality behind a flag
with an explicit **owner** and **expiry** — an un-owned, permanent flag is
technical debt from the day it ships. If no flag mechanism exists, this
skill does not introduce one unilaterally (dependency safety,
`10-evidence-and-dependency-guard.mdc`) — flag it as a recommendation.

**Step 3 — Define the rollback plan up front, before rollout starts.**
```markdown
## Rollback Plan — [feature]

**Kill switch:** [remote-config flag name] flips the feature off without a
new binary release — for anything that isn't behind a flag, rollback means
halting the staged rollout, which only affects *new* installs going forward.

**What rollback does NOT undo:**
- Users already on the new version keep it until they update again
- Any data written in the new format by users who got the update (if the
  feature changed a local DB schema or an API payload shape) — this needs
  its own backward-compatibility plan, not just a flag flip

**Monitoring during rollout:** crash-free session rate, ANR rate (via
whatever crash-reporting tool is wired — see `production-readiness-review`),
compared against the pre-release baseline at each rollout stage.
```

**Step 4 — API/backend compatibility.** If the change requires a backend
API change, confirm the rollout order is additive-first: the backend
accepts both the old and new client payload shapes *before* any client
starts sending the new shape, and continues accepting the old shape until
the staged rollout reaches 100% and enough time has passed that old-version
clients are negligible — mirrors expand-migrate-contract for a schema.

**Step 5 — Report the plan** in the format above, plus the specific
rollout percentages/stages and what triggers a halt at each stage.

---

## Example

Request: "Plan the rollout for the new payment provider integration."

Output: a staged Play Console/App Store Connect rollout plan (5%→25%→100%
gated on crash-free rate), a feature flag gating the new provider with a
named owner and a 60-day expiry, and an explicit note that the old payment
provider code path stays in the app until the flag is fully retired.
