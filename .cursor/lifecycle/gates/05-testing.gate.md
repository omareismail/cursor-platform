# Gate 5 — Testing

**Blocks:** phase 6 (Production).
**Mechanical check:** `node .cursor/tools/lifecycle.mjs check TESTING`
**Judgement:** `/lifecycle-gate`.
**Authored by:** `test-engineer`
**Reviewed by:** `product-manager` — never an author of the artifacts above.

The question is not "do tests pass" — they always do by the time anyone asks.
It is whether the tests test what phase 1 promised.

---

## Who reviews this, and why

`product-manager` judges this gate. Not because it is senior, but because of what it
loses if this gate passes on bad work:

This gate asks whether the tests prove what phase 1 asked for. Whoever wrote the
acceptance criteria is the only one who knows what they meant — and, not having
written the tests, is free to say that they do not.

Launch it as a **fresh subagent**. It has to reach these criteria through the
documents, not through the conversation that produced them — an author
re-reading their own work still has all of the author's reasons in context,
and never finds the thing they did not think of the first time.

`record-gate` refuses a verdict filed under any other role, and `approve`
refuses a signature from the same party that filed the verdict.

---

## Judgement criteria

**1. Every acceptance criterion has a test that asserts it.**
PASS: `node .cursor/tools/ac-trace.mjs check specs/features/<slug>.md` clean for
every MVP feature.
FAIL: an AC no test claims, a test claiming an AC the spec dropped, an AC whose
only test is skipped. This is the criterion that closes the loop back to phase 1;
if it fails, the product was not built to its requirements whatever the coverage
figure says.

**2. No vacuous tests.**
PASS: `node .cursor/tools/ac-trace.mjs lint` clean — no claiming test without an
assertion, no assertion that cannot fail.
FAIL: coverage produced by tests that execute code without checking it.

**3. Every layer in the strategy exists.**
PASS: `docs/testing/strategy.md` names unit, integration, E2E and load layers,
and each one has real suites.
FAIL: a pyramid with a missing floor. Unit tests alone prove the units agree
with themselves.

**4. E2E covers the critical journeys end to end.**
PASS: the journeys phase 1 called critical run against a real browser and a real
API — register, quote, pay, issue. Generated from acceptance criteria by
`/e2e-test-gen`.
FAIL: E2E that stubs the API. That tests the test double.

**5. Load tested against the phase 1 NFRs.**
PASS: `/load-test-gen` thresholds come from `nfr.md`, and the run meets them.
FAIL: a load test with invented thresholds, which can only pass.

**6. Security and compliance clean.**
PASS: the `security-auditor` subagent reports no unresolved finding, and
`/compliance-audit` is clean for whichever of SAMA,
ZATCA and mada phase 1 said apply.
FAIL: findings triaged as "accepted" without a named accepter.

**7. Independent review on the release PR.**
PASS: a reviewer that did not write the code has signed off. GitHub Copilot code
review reads `AGENTS.md`, so the same guard rules constrain it — use it as the
second opinion, with a human on anything it approves that touches money or auth.
FAIL: the author reviewing their own work, or an agent reviewing its own output.

**8. Mutation score meets the threshold.**
PASS: at or above the threshold in `templates/mutation/`.
FAIL: high line coverage with a low mutation score — the signature of tests that
run code without constraining it.

**9. Rollback was executed, not written down.**
PASS: someone rolled back a deployment in a non-production environment and it
worked.
FAIL: a rollback section in a document. Untested rollback is not rollback.

---

## Verdict

```
GATE 5 — TESTING: GO | NO-GO
Mechanical:  <pass/fail>
Criteria:    <n>/9 pass
AC trace:    <ACs with no test> / <tests claiming dropped ACs> / <skipped>
Layers:      unit <y/n>  integration <y/n>  e2e <y/n>  load <y/n>
Mutation:    <score> vs <threshold>
Blocking:    <criterion, file, what is wrong, what would fix it>
Record:      node .cursor/tools/lifecycle.mjs record-gate TESTING --verdict GO|NO-GO \
                  --by "product-manager" --criteria "<n>/<total>"
Then:        node .cursor/tools/lifecycle.mjs approve TESTING --by "<a human, not product-manager>"
```
