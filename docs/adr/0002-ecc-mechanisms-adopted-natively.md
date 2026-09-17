# ADR-0002 — ECC mechanisms re-implemented natively

`.cursor/tools/decision-memory.mjs` indexes every `##` section under `docs/adr/`,
so the decision itself is the section below and its id opens the heading.

---

## ADR-0002: ECC mechanisms re-implemented natively, never installed

**Status:** Accepted
**Date:** 2026-09-17
**Deciders:** omar.ismail
**Context record:** `docs/reviews/ecc-assessment-2026-09-16.md`

### Context

[affaan-m/ecc](https://github.com/affaan-m/ecc) is an MIT-licensed "agent harness
operating system" — 68 agents, 292 skill files, 24 hooks, a Cursor adapter, a memory
vault and a security scanner, targeting a dozen harnesses. An inventory of this
repository against it found five things it does that this platform did not do at
all:

1. Nothing survived the end of a session. `Stop` nudged the agent to update
   `memory-bank/activeContext.md` and persisted nothing itself, so what actually
   happened lived only in the transcript. Switching between Cursor and Claude
   Code mid-feature lost it entirely.
2. Nothing read the **content** of the files that instruct the agent.
   `lifecycle/integrity.json` proves a hook is the one a human signed; it cannot
   say what a skill file means. `project-analysis` had carried
   "injection-to-action paths" and "no test covers the instruction channel" as
   open findings.
3. `guard-bash.mjs` did not refuse `git commit --no-verify`.
4. An agent could weaken the build gates that `/postmortem` writes findings into
   and `incidents.mjs check` re-reads.
5. The refusal to read `.env` and friends lived only in `.claude/settings.json`
   `permissions.deny`, which nothing but Claude Code reads. **Cursor and every
   plugin install had no such rule**, while every document described it as a
   property of the platform.

The fifth is the one that decided this ADR. It is not a missing feature; it is a
control that exists on one host and is unreachable on the others — the exact
defect class `self-audit.mjs` was written to find — sitting in the platform's
own configuration, undetected because nothing was looking there.

**Installing ECC to get these would contradict the platform's own argument.** The
plugin brings 24 hooks that run on every tool call and are covered by no hash in
`lifecycle/integrity.json`, and 292 skill description lines into a window where
this platform's existing 99 already account for roughly half the always-on cost
on Claude Code (measured 2026-09-16). Its installers are the shapes
`guard-bash.mjs` already refuses. Routing around a guard in order to install a
security tool is the least defensible way to acquire one.

### Decision

Take the mechanisms, install nothing. Eight rules:

1. **Nothing from ECC is installed, fetched, vendored or run.** No plugin, no
   npm package, no MCP registration, no copied file. The evaluation is a reading
   of published source, and it is recorded rather than the code imported.
2. **Every adopted control is a file in this repository**, wired in
   `.claude/settings.json`, `.cursor/hooks.json` and both plugin emitters, and
   named in `lifecycle/integrity.json`. A control this repository cannot hash is
   not adopted.
3. **No hook asks a completion of anything.** ECC's `session-end.js` calls an
   LLM to summarise a transcript when context runs low. Every line of this
   platform's summary is derived by reading. A hook that spends tokens to
   describe a session gets switched off on a slow day, and a control nobody can
   afford is not a control.
4. **A session summary is data, not memory and not evidence.** It lives under
   gitignored `.cursor/cache/sessions/`, is per-machine, is redacted before it is
   written, is capped, is swept after 14 days, and is injected under a heading
   that says it is historical and unverified. `memory-bank/` remains the record
   of what the team decided; when the two disagree, `memory-bank/` is right.
5. **Nothing the scan reports is scored.** No grade, no percentage, no baseline
   file. Findings are `block`, `warn` or `info` with a file and a line. A number
   reported as good becomes a number to hit, and the cheapest way to hit one
   here is to stop looking.
6. **A heuristic that fires on correct work is removed, not tolerated.** The
   scan is calibrated against this repository, and its suite's last case
   requires zero blocking findings here, so the calibration cannot rot quietly.
7. **The prompt guard warns and never blocks.** Exit 2 on `UserPromptSubmit`
   erases the message a person typed. It names the class of credential and never
   the value.
8. **Both hosts get the same scripts.** A rule that exists for one editor is the
   defect this ADR is mostly about, so `guard-read.mjs` and `guard-prompt.mjs`
   are wired on Cursor as well, and self-audit **A13** keeps the policy list
   equal to Claude Code's native deny list so they cannot drift apart again.

### Consequences

**Positive:**

- A session leaves a record, and the next session on that worktree — in either
  editor — starts from it.
- The instruction channel has a checker and a test suite for the first time;
  two long-open `project-analysis` findings now have a mechanism behind them.
- `.env`, certificates and keys are unreadable on Cursor and in plugin installs,
  not only in this repository under Claude Code.
- The build gates bought by past incidents cannot be quietly weakened by the
  agent, which is what `incidents.mjs check` always assumed.
- Skipping the git hooks is refused, closing the one bypass that made every
  other pre-commit control optional.
- `self-audit run` now composes four checkers rather than three, and A12
  generalises the policy-versus-fallback comparison so a fourth section does not
  become a fourth hand-written check.

**Negative / trade-offs accepted:**

- Three new hook scripts and one new tool to maintain, and a hook count that
  went from 7 to 10. Every one of them is a file somebody has to review.
- `lifecycle/integrity.json` reports the enforcement surface as CHANGED until a
  human re-attests. That is the manifest working, and it is not something this
  agent may do.
- The `SessionStart` digest grows by up to 2 KB when a prior summary exists.
  `context-cost.mjs` measures it; it is reported rather than estimated.
- The base64 heuristic excludes `/` from its character set, so a payload
  containing one is missed. Allowing `/` made every namespaced path in the
  repository a candidate, and a warning that fires on every file list is a
  warning nobody reads.
- A terminal killed outright writes no summary. `SessionEnd` cannot fire, and
  the fallback is `git status` at the next session start, which is honest.

**Neutral / watch points:**

- The Cursor `beforeSubmitPrompt` reply shape (`{continue: boolean}`, not
  `{permission}`) is taken from vendor documentation dated 2026-09-17 and
  recorded in `.cursor/docs/DUAL-AGENT-SETUP.md`. Re-check it before relying on
  a field no test exercises.
- `beforeTabFileRead` spawns a node process per Tab read. Wired `failClosed`;
  measure, and drop it if Tab becomes unusable.
- Bundle D of the assessment — skill-run and MCP audit logs, per-session token
  counts — was deferred, not rejected. It sits on the same `_lib.mjs`
  foundation.

### Alternatives Considered

**Option A — install the ECC plugin (Rejected).** It is the fastest route to all
five mechanisms and several more. It also adds 24 hooks outside the integrity
manifest and triples the skill-description cost that this platform measured and
named as its largest always-on line item one day earlier. A repository whose
argument is that every control is a reviewed file cannot acquire controls by
installing unreviewed ones.

**Option B — adopt only the scanner (Rejected).** The scanner is the most
obviously valuable piece, and taking it alone was tempting. But the
session-continuity gap is the one users feel every day, and the read-guard gap
was an actual hole in this repository's protection on two of its three
distribution shapes. Fixing the interesting problem and leaving the real one is
how a platform accumulates the wrong kind of maturity.

**Option C — decline everything and record the assessment (Rejected).** Defensible
for the vault, the instincts and the profiles, and that is what happened to them.
Not defensible for a read guard that Cursor never had.

### Links

- Assessment: `docs/reviews/ecc-assessment-2026-09-16.md`
- Precedent for reading a third-party tool without installing it: `docs/adr/0001-omniroute-local-llm-gateway.md`
- The measurement that decided against a larger catalogue: `docs/reviews/token-tools-assessment-2026-09-15.md`
- Supersedes: N/A
- Superseded by:
