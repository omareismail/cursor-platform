# Skill: dashboard

**Invocation:** `/dashboard` · `/dashboard snapshot`

---

## Overview

`dashboard` opens a localhost UI over the project's platform state: lifecycle
phase and gates, traced features, requirement traceability, test and risk
coverage, delivery metrics, memory-bank fill, and platform health. It is a
viewer and a **command composer**, not a source of truth and not an executor.
Every panel is assembled from JSON that the existing validators already emit.
If a panel looks wrong, the fix is in that validator, not in this skill.

The Actions panel (and the contextual buttons on Lifecycle, Delivery,
Traceability, Quality and Overview) builds the exact CLI for every governance
action — record-gate, approve, advance, rollback, override, cut/sign a
release, open a change request or incident, accept a fitness baseline — and
pre-flights it. You paste the command into your terminal. The server never
runs it.

The server is `.cursor/tools/dashboard.mjs`. It binds `127.0.0.1` only, accepts
GET only, never writes `lifecycle/state.json`, never records a gate, and never
mutates a cache. `approve` refusals come from the same `approveRefusals`
export that `lifecycle.mjs approve` uses, so a green light here and a CLI
refusal cannot silently disagree.

Use when the user asks to see the project, the lifecycle, features, gates,
coverage, or "the whole picture" in a browser, or to compose a governance
command without the page executing it.

---

## Steps

**Step 1 — Confirm the working tree is the target repo.**

The dashboard reads `CLAUDE_PROJECT_DIR` or `git rev-parse --show-toplevel`.
Run it from the application repo (or this platform repo, which will show
empty-state panels for lifecycle and feature maps that do not exist yet).

**Step 2 — Start the server, or take a headless snapshot.**

Default — open the UI:

```bash
node .cursor/tools/dashboard.mjs serve
```

Options: `--port 7777` (default), `--no-open` (do not launch a browser).

Headless JSON of every panel (for agents, CI, or a paste into chat):

```bash
node .cursor/tools/dashboard.mjs snapshot --json
```

**Step 3 — Read the empty states as instructions, not errors.**

A missing `lifecycle/state.json` is a valid configuration. The Overview and
Lifecycle panels name the command that would populate them
(`lifecycle.mjs init`). Same for an untraced feature map (`/feature-trace`),
an unfilled memory-bank (`/context-sync`), and an un-promoted architecture
(`fitness.mjs` skips it). Do not treat those panels as failures.

**Step 4 — Compose, do not execute.**

The Actions drawer copies a command. It does not approve, record-gate,
override, cut a release, or open a change request. If the drawer says
WOULD BE REFUSED, the CLI will refuse the same way — fix the reason or
do not run it. After the user pastes and runs a command, Refresh so the
panels re-read disk (`?fresh=1` bypasses the 30s cache).

**Step 5 — Stop.**

Ctrl+C in the terminal that ran `serve`. Nothing was written by the dashboard
itself.
