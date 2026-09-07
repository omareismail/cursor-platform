# Gate 4 — Development

**Blocks:** phase 5 (Testing) closing, not opening — testing runs *alongside*
development. This gate asks whether the MVP is actually built.
**Mechanical check:** `node .cursor/tools/lifecycle.mjs check DEVELOPMENT`
**Judgement:** `/lifecycle-gate`.

Phases 4 and 5 are a loop. Work moves between them continuously; this gate is
evaluated once, when the MVP scope from phase 1 is claimed complete.

---

## Judgement criteria

**1. Every MVP story is implemented and specified.**
PASS: each story in `scope.md`'s MVP list has a merged spec in `specs/features/`
and a `/speckit-checklist` that passed.
FAIL: implemented without a spec. `01-specify-rules` forbids it; this is where it
is checked at the product level.

**2. Every MVP story passed Definition of Ready before it was built.**
PASS: `node .cursor/tools/artifact-schema.mjs ready` reports every MVP story
READY. Run it now, not from memory - a story can lose readiness after the fact
when its use case or endpoint is revised.
FAIL: a story that entered development without a use case, an endpoint or
acceptance criteria. It was built against an assumption, and nobody wrote the
assumption down.

> **Computed, not judged.** The graph decides this one.

**3. `/spec-drift-audit` is clean.**
PASS: the code does what the spec says. Run it per feature, not once at the end.
FAIL: specs that describe an earlier intention. A spec nobody maintained is
worse than none — phase 5 will generate tests from it.

**4. No task is stranded.**
PASS: no `TASK` sits `In Progress` in `memory-bank/progress.md`, and every `Done`
carries `/task-verify` evidence.
FAIL: Done marked from a green suite alone. When one agent wrote both the code
and its tests, green proves they agree — not that either is right.

**5. Architecture guards report no blockers.**
PASS: `/dotnet-clean-code-guard` and `/react-clean-code-guard` clean, or every
finding has a recorded, accepted justification — **and**
`node .cursor/tools/fitness.mjs check` reports no new violation of the layering
promoted at gate 3.
FAIL: findings deferred to "later". Later is phase 6, where they are incidents.

> `check` compares against `lifecycle/fitness-baseline.json`, so on an existing
> codebase it fails on *new* decay rather than on all of history. The baseline is
> a dated record of accepted architectural debt, not a suppression file: its
> count may fall and never rise, and swapping a fixed violation for a new one is
> refused even though the count is unchanged.

**6. The build is reproducible.**
PASS: clean clone, documented commands, build and test pass with no local-only
step.
FAIL: it works on the machine it was written on.

**7. Migrations are reviewed.**
PASS: every migration inspected for destructive change, missing index and
large-table risk — `/dotnet-migration` does this.
FAIL: auto-generated and never read.

**8. No new dependency arrived unannounced.**
PASS: every package added since the design gate is justified against
`technologyStack.md`. Rule 10 and the Bash hook block installs; this catches
anything that got in another way.
FAIL: a transitive surprise discovered by `/dotnet-dependency-audit` in phase 5.

**9. Feature flags have expiry.**
PASS: `node .cursor/tools/flag-debt.mjs scan` exits 0.
FAIL: flags that will outlive the people who added them.

---

## Verdict

```
GATE 4 — DEVELOPMENT: GO | NO-GO
Mechanical:  <pass/fail>
Criteria:    <n>/9 pass
MVP:         <stories done>/<stories in MVP scope>
Drift:       <features where spec and code disagree>
Stranded:    <tasks In Progress, tasks Done without task-verify evidence>
Blocking:    <criterion, file, what is wrong, what would fix it>
Record:      node .cursor/tools/lifecycle.mjs record-gate DEVELOPMENT --verdict GO|NO-GO \
                  --by "lifecycle-gate" --criteria "<n>/<total>"
Then:        node .cursor/tools/lifecycle.mjs approve DEVELOPMENT --by "<name>"
```
