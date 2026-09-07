# Skill: lifecycle

**Invocation:** `/lifecycle [product | status | start | advance | rollback]`

---

## Overview

`lifecycle` is the entry point to the six-phase product lifecycle: it reports
which phase a product is in, which gates a human has approved, and what the
agent is therefore allowed to do next. It is the product-level counterpart to
the feature-level pipeline in `01-specify-rules.mdc` — that one gates a single
feature from analyze to commit, this one gates the whole product from an idea to
production. Every other lifecycle skill reads the state this one maintains.

---

## Steps

**Step 0 — Orient, on any product repo.**

```bash
node .cursor/tools/lifecycle.mjs product
```

Phase, gates, governance profile, stack, integrations, owners, open change
requests, active overrides. Every line is read from whatever already owns it —
nothing is declared by hand, so nothing can silently disagree with `state.json`.

**Step 1 — Read the state.**

```bash
node .cursor/tools/lifecycle.mjs status
```

If it reports no `lifecycle/state.json`, this repo has not adopted the
lifecycle. That is a valid configuration — say so, and offer `start` rather than
assuming the user wants it.

**Step 2 — Route on the sub-command.**

| Sub-command | Do this |
|---|---|
| `product` | `node .cursor/tools/lifecycle.mjs product` — the one-screen briefing. Read it out, and lead with the governance flags: they decide what is enforced for the rest of the session. Stop there. |
| `status` (default) | Report the phase, the gate ladder, and whether the design gate blocks source writes. Stop there. |
| `start` | Go to Step 3. |
| `advance` | Go to Step 4. |
| `rollback` | Go to Step 5. |

**Step 3 — `start`: initialise.**

Establish two things before touching the tool, because both are irreversible in
practice:

1. **The product name.** Ask if not given.
2. **Greenfield or brownfield.** Do not guess — check. If `src/`, `backend/` or
   a solution file already exists, it is brownfield.

```bash
node .cursor/tools/lifecycle.mjs init --name "<product>"            # greenfield
node .cursor/tools/lifecycle.mjs init --name "<product>" --existing # brownfield
```

Brownfield marks phases 1-3 `INHERITED`, which clears the design gate. That is
deliberate: an existing system did not skip those phases, it did them informally
years ago, and blocking all work on a live codebase would be absurd. Say this
plainly rather than letting the user think the gates were approved.

Then hand off to the phase owner — `/product-brief` for greenfield,
`/feature-inventory` then `/context-sync` for brownfield.

**Step 4 — `advance`: move to the next phase.**

Never advance without the gate. The order is fixed:

```bash
node .cursor/tools/lifecycle.mjs check <PHASE>     # do the artifacts exist
```
then `/lifecycle-gate <PHASE>` — presence is not quality. It judges the
artifacts and records its verdict, which is the second consent. Then, and only
after the user says the word:
```bash
node .cursor/tools/lifecycle.mjs approve <PHASE> --by "<name>"
node .cursor/tools/lifecycle.mjs advance
```

`approve` refuses unless all three consents are present, the phase is the
current one, and the previous phase is cleared. There is no `--force`. If a gate
genuinely must be bypassed, that is an override — a record with an owner, a risk
level and an expiry date:

```bash
node .cursor/tools/lifecycle.mjs override <PHASE> \
  --reason "..." --risk LOW|MED|HIGH --by "<name>" --expires <days>
```

Never propose one. It exists for a human who has decided to accept a specific
risk, and it lapses on its own.

**Step 5 — `rollback`: reopen a phase.**

```bash
node .cursor/tools/lifecycle.mjs rollback <PHASE> --reason "<why>"
```

Every later phase resets to `NOT_STARTED`. Rolling back to `DESIGN` re-blocks
source writes — warn the user before running it, not after.

Use this when a phase's conclusions turn out to be wrong, not for ordinary
iteration. A failing test in phase 5 does **not** roll back to development: 4
and 5 are a loop and the lifecycle stays in `TESTING`.

**Step 6 — Report.**

The ladder shows a three-letter consent column — `M` mechanical, `J` judgement,
`H` human, with a dot for each one missing. Read it out when a phase is not
approved: `··H` and `MJ·` are very different problems.

**`STALE` is not a synonym for "not done".** It means the phase *was* approved
and something it was approved against has since changed — an artifact edited, a
gate criterion tightened, an override expired. The status line names which. Do
not offer to re-approve it; offer to re-review it, because the approval that
lapsed was granted against text that no longer exists.


Show the ladder, name the current phase's owner subagent and its skills, and
state whether source writes are blocked. If they are, say what would unblock
them rather than leaving the user to work it out.

---

## Output

- Terminal: phase ladder, gate status, the next legitimate command
- `lifecycle/state.json` updated (by the tool — never by hand; `guard-write.mjs`
  blocks direct edits)
