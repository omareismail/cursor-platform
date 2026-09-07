---
name: e2e-test-gen
description: "e2e-test-gen generates browser end-to-end specs for the critical journeys, built directly from the Given/When/Then acceptance criteria written in phase 1 and carrying the // AC-N: comments that ac-trace.mjs matches on. It is the layer the rest of the test suite cannot substitute for: unit tests prove the units agree with themselves and integration tests prove a handler reaches its database,... Invoked as /e2e-test-gen."
---

<!-- GENERATED from the cursor-platform source skill "e2e-test-gen".
     Do not edit here - edit the source and re-run the plugin build. -->

# Skill: e2e-test-gen

**Invocation:** `/e2e-test-gen [journey | story-id]`

---

## Overview

`e2e-test-gen` generates browser end-to-end specs for the critical journeys,
built directly from the Given/When/Then acceptance criteria written in phase 1
and carrying the `// AC-N:` comments that `ac-trace.mjs` matches on. It is the
layer the rest of the test suite cannot substitute for: unit tests prove the
units agree with themselves and integration tests prove a handler reaches its
database, but only this one proves a person can complete the journey the product
was commissioned to deliver. It generates against the real API — an E2E test that
stubs the backend is testing the test double.

---

## Steps

**Step 1 — Confirm the runner exists. Do not install one.**

```bash
node -e "console.log(Object.keys({...require('./package.json').dependencies,...require('./package.json').devDependencies}).filter(d=>/playwright|cypress|puppeteer/.test(d)))"
```

`10-evidence-and-dependency-guard` forbids adding a package that is not already
in the repo, and the `PreToolUse` Bash hook blocks the install command. If no
runner is present, stop and tell the user which one the strategy assumes and that
they need to add it. That block is a signal to ask, not to find a workaround.

**Step 2 — Read the inputs.**

`docs/testing/strategy.md` (which journeys are critical — generate for those
only), `docs/product/story-map.md` (the acceptance criteria), and
`docs/design/ux/screen-inventory.md` (the screens and their states).

**Step 3 — One spec per journey, not per story.**

E2E follows a person from start to finish. A spec per story produces forty
browser sessions that each log in, and a suite nobody waits for.

**Step 4 — Map criteria to steps, and cite them.**

Every acceptance criterion the journey covers becomes an assertion carrying its
ID:

```ts
// AC-3: Given a 2019 Corolla with comprehensive cover and no claims,
// the premium is 2,340.00 SAR and the no-claims line shows 15%
await expect(page.getByTestId('premium-total')).toHaveText('2,340.00 SAR');
await expect(page.getByTestId('ncd-line')).toContainText('15%');
```

The comment format is a contract: `ac-trace.mjs` parses exactly this and Gate 5
fails on an AC no test claims. Do not paraphrase the ID.

**Step 5 — Select by role or test id, never by styling.**

`getByRole`, `getByLabel`, `getByTestId`. Never a CSS class or a DOM path —
those break on the next redesign and train the team to ignore red.

For a bilingual product, never select by visible text: the same test must pass
in EN and AR. Where the journey has an RTL variant per the screen inventory,
generate both and assert direction, not just content.

**Step 6 — Make the data deterministic.**

Each spec sets up its own data through the API and tears it down. No shared
fixture that one spec mutates and another reads — that is the usual source of a
suite that passes alone and fails in parallel.

**Step 7 — Assert the unhappy paths the criteria name.**

The declined payment, the timeout, the expired session. These come from the
unhappy-path criteria phase 1 required; if none exist, that is a phase 1 gap and
should be reported rather than invented here.

**Step 8 — Write to `tests/e2e/<journey>.spec.ts` and verify the trace.**

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/ac-trace.mjs check specs/features/<slug>.md
node ${CLAUDE_PLUGIN_ROOT}/tools/ac-trace.mjs lint
```

`lint` catches the failure this skill is most prone to: a test that claims an AC
and asserts nothing. Fix those before reporting done.

---

## Output

- `tests/e2e/<journey>.spec.ts`, one per critical journey
- Terminal: `ac-trace` results, and any acceptance criteria still unclaimed

