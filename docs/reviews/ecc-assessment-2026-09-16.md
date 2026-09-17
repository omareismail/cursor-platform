# ECC: five mechanisms re-implemented, the rest declined

**Assessed:** 2026-09-16 · **Recorded:** 2026-09-17 · **By:** omar.ismail

**Question.** [affaan-m/ecc](https://github.com/affaan-m/ecc) — "the agent
harness operating system", MIT, 68 agents, 292 skill files, 94 commands, 24
hooks, targeting Claude Code, Codex, Cursor and ten more harnesses — has
features this platform does not. Which of them should this repository have?

**Verdict: adopt five mechanisms, install nothing.** The ECC plugin is not
installed, its packages are not fetched, and no file of it is vendored. Five
things it does that this platform did not do at all were re-implemented here, as
files in this repository, covered by this repository's tests, wiring audit and
integrity manifest. Everything else was declined, and the reasons are below.

Nothing here says ECC is bad. It is a large, careful, well-documented project
with two hundred and sixty thousand stars. It is declined **as an install**, for
what installing it would do to a repository whose whole argument is that every
control is a reviewed file with a hash.

---

## What was evaluated

| | |
|---|---|
| Project | `affaan-m/ecc`, MIT, npm `ecc-universal`, Claude marketplace `ecc@ecc` |
| Shape | a plugin (hooks + skills + agents), a Cursor adapter, a universal installer, a memory vault, a security scanner (`agentshield`) |
| Read | README, the shortform/longform/security guides, `hooks/hooks.json` and its metadata sidecar, `scripts/hooks/*`, `scripts/lib/hook-flags.js`, `scripts/ci/*`, `.cursor/hooks/*`, the continuous-learning and unified-memory skills, `MCP-CONNECTOR-POLICY.md` |
| Not run | nothing was installed, fetched or executed. The evaluation is a reading of published source. |

## The tests it was put to

The same five this repository applied to caveman and headroom on 2026-09-15.
Nothing new was invented for this assessment.

1. **The rule of thumb in `mcp-ecosystem.md`** — connect only for information
   otherwise unobtainable.
2. **The "deliberately omitted" precedent** — every server and every skill
   description rides into the window on every turn, and a crowded namespace
   degrades routing. `server-memory` was already rejected for creating a
   competing store.
3. **The Graphify precedent** — a third-party tool may be *read* without being
   installed, and its agent installers are refused when they write outside the
   reviewed surface.
4. **Rule 10** — no package that is not already in the repo.
5. **The enforcement surface** — every control is a file under
   `lifecycle/integrity.json`, and `self-audit.mjs` must be able to see it.

## Findings

### Installing it fails tests 2, 4 and 5

- **24 hooks arrive unreviewed.** They are good hooks. They are also 24 scripts
  that run on every tool call and are covered by no hash in this repository's
  manifest, so `self-audit.mjs integrity` would keep reporting a clean
  enforcement surface while two dozen unattested scripts ran beside it. That is
  the inverse of the defect `self-audit` was written for — not a control that
  exists and is unreachable, but a control that is reachable and was never
  reviewed — and it is the same argument the OmniRoute ADR makes against a
  rewriting gateway.
- **292 skill description lines enter every session.** The 2026-09-15
  measurement found this platform's own 99 description lines to be ~40 KB, half
  the always-on cost on Claude Code and the largest single line item. Tripling
  the catalogue is the opposite of what that measurement concluded.
- **The installers are refused here already.** `npx ecc-universal@… setup` and
  `./install.sh` are exactly the shapes `guard-bash.mjs` refuses, and
  `/plugin install` writes outside the reviewed surface. Routing around that to
  install a security tool would be the least defensible way to acquire one.

### Five mechanisms this platform genuinely lacked

Confirmed absent by inventory before anything was written:

| Gap | ECC's version |
|---|---|
| No `PreCompact` or `SessionEnd` hook; `Stop` nudges and persists nothing; no record of a session survives it, and switching host mid-feature loses everything | `pre-compact.js`, `session-end.js`, and the prior-session block in `session-start.js` |
| Nothing reads the CONTENT of skills, agents, rules, `settings.json`, `.mcp.json` or CI. `integrity.json` detects *change*, never *meaning*. `project-analysis` has carried "injection-to-action paths" and "no test covers the instruction channel" as open findings | AgentShield's rule families, plus `check-unicode-safety.js`, `validate-agents.js`, `validate-no-personal-paths.js`, `validate-workflow-security.js` |
| `guard-bash.mjs` did not refuse `git commit --no-verify` | `before-shell-execution-block-no-verify.js` |
| An agent could weaken the build gates `/postmortem` writes findings into | `config-protection.js` |
| No secret detection on the prompt; the sensitive-file read rule lived only in `.claude/settings.json`, so Cursor and every plugin install had none | `before-submit-prompt.js`, `before-read-file.js`, `before-tab-file-read.js` |

The last one is the finding that matters most, and it was ours, not ECC's:
**a control that was real on one host and absent on the others, while every
document described it as the platform's.** That is precisely the shape
`self-audit.mjs` exists to catch, sitting in the platform's own configuration.

## Decision

Re-implement those five natively. No install, no vendored file, no fetch, no
MCP registration. Each control is a file in this repository, wired in both
hosts and in the built plugin, covered by an adversarial suite, and named in
`lifecycle/integrity.json`.

## What was taken

| Bundle | Files | Pinned by |
|---|---|---|
| Session continuity | `.claude/hooks/session-end.mjs`, the prior-session block in `session-start.mjs` | `tests/adversarial/session.test.mjs` (53 assertions) |
| Harness self-scan | `.cursor/tools/harness-scan.mjs`, a CI job, composed into `self-audit run` and the dashboard | `tests/adversarial/harness-scan.test.mjs` (40 assertions) |
| Git hook-bypass refusal | two rules in `guard-bash.mjs` | `tests/adversarial/bash.test.mjs` (295 assertions) |
| Quality-gate protection | `qualityConfig` in `write-policy.json`, `isQualityConfig()` in `_lib.mjs`, rule 2b in `guard-write.mjs`, self-audit **A12** | `tests/adversarial/write.test.mjs` (99 assertions) |
| Prompt and read guards | `guard-prompt.mjs`, `guard-read.mjs`, `secretFiles` in `write-policy.json`, self-audit **A13** | `tests/adversarial/prompt.test.mjs` (37), `read.test.mjs` (57) |

Four decisions inside those are worth recording, because each was a place the
obvious implementation would have been wrong.

**No LLM call in any hook.** ECC's `session-end.js` calls Claude to summarise
the transcript when context runs low. Every line of this platform's summary is
derived by reading. A hook that spends tokens to describe a session is a hook
somebody switches off on a slow day, and a control nobody can afford is not a
control.

**Warn, never block, on the prompt.** Exit 2 on `UserPromptSubmit` does not warn
— it erases the message the person typed. The guard is built on regular
expressions, so false positives are certain, and deleting somebody's words for a
false positive is worse than the leak. It names the class of credential and
never the value: a hook that prints a secret in order to report one has made a
second copy.

**No escape variable on `guard-read.mjs`.** Every other guard has one, because
every other guard refuses an *action* a human might legitimately want taken.
This one refuses a *read*, and a read that succeeds puts the value in the
transcript — the outcome the guard exists to prevent. An escape would not enable
the work; it would only move the leak.

**The scan was narrowed twice, against this repository, before it was trusted.**
Its first run produced 97 warnings, every one of them the generated
`Do not edit here` banner that opens all 99 plugin skills. Two heuristics were
dropped outright — "always run X" is how half the skills legitimately describe a
pipeline step, and "never mention X" is how `release-notes-gen` legitimately
describes writing for end users. **A warning that fires on correct work is a
warning somebody switches off, and then the real one is off too.** The suite's
last case runs the scan against this repository and requires zero blocking
findings, so that calibration cannot silently rot.

Nothing in the scan is scored. There is no grade, no percentage and no baseline
file — the same reasoning as `delivery-intel.mjs`: a number reported as good
becomes a number to hit, and the cheapest way to hit one here is to stop looking.

## Deliberately not done

| ECC feature | Why not |
|---|---|
| Install `ecc@ecc` / `npx ecc-universal` | 24 unattested hooks and 292 description lines; the installers are refused by `guard-bash.mjs` and rule 10 |
| Hook profiles, `ECC_HOOK_PROFILE`, `ECC_DISABLED_HOOKS`, `ECC_HOOKS_ENABLED` | The guards here deliberately have no off switch. A documented environment variable that disables a named guard is a lock with the key hanging beside it. The per-rule escapes that exist (`CURSOR_PLATFORM_DEV`, `CLAUDE_ALLOW_TIER2_EDIT`, `CLAUDE_ALLOW_QUALITY_CONFIG_EDIT`, `LIFECYCLE_OVERRIDE`) each unlock one rule for one reason, which is a different thing |
| Continuous-learning v2 "instincts" | Needs a background observer that calls Haiku on the session transcript; this platform never asks a completion of anything. ECC's own documentation records that the observer cannot survive on native Windows, which is this machine. And confidence is a score — see above. `speckit-retro` and `decision-memory.mjs` remain the answer; the session summary is now their raw material |
| Unified memory vault (`ecc.memory.v1`, project/team/user scopes) | A competing store beside `memory-bank/`, which is the reason `server-memory` was already on the omitted list. Only the *handoff* idea was taken, and deliberately as a per-machine cache under `.cursor/cache/` that is never committed, never promoted and never cited as evidence |
| `contexts/` via `claude --system-prompt "$(cat …)"` | An unreviewed prompt surface outside the repository, the same class as a rewriting gateway. No hash covers it and no audit can reach it |
| GateGuard "fact forcing" | It blocks the first call and allows the retry regardless of what was actually presented. That is a speed bump, not a control — and Claude Code's Edit tool already requires the file to have been read |
| `verification-loop` and its checkpoint command | `/task-verify`, `ac-trace.mjs` and `risk-profile.mjs` already do this, and they check what the verification was supposed to prove rather than that it ran |
| Supply-chain IOC scanner | A hardcoded list of ~100 compromised package versions and four file hashes. It was accurate the day it was written; it goes stale silently, and a stale IOC list reports clean |
| Cost tracking in USD | A hardcoded rate table per model family. `context-cost.mjs` measures bytes and estimates tokens and prices nothing, for the same reason |
| Skill-run and MCP audit logs, per-session token counts | Not rejected — deferred by the owner for this increment. They sit on the same `_lib.mjs` foundation (`cachePath`, `sessionId`, `appendJsonl`-shaped writes) and can be added without touching anything else |
| `plan-canvas`, `desktop-notify`, `pm2`, package-manager detection, worktree orchestrator | Not applicable to this repository |

## One thing this evaluation found in our own guard

Searching for ECC's adversarial phrasing meant running a `grep` whose *pattern*
contained a download-piped-to-a-shell shape. `guard-bash.mjs` refused the whole
command, because every rule matches anywhere in the command text.

That is **B11-3**, recorded as a known limitation on 2026-09-15 and deliberately
not fixed then. This is the second time it has refused a read-only command for
talking about a dangerous one. It is still not fixed here — widening a guard is
a decision that deserves its own evidence, and inheriting a limitation is not
the same as widening it — but it now has two dated occurrences rather than one.

## Links

- [ADR-0002](../adr/0002-ecc-mechanisms-adopted-natively.md) — the decision
- [token-tools-assessment-2026-09-15.md](token-tools-assessment-2026-09-15.md) — the five tests, and the measurement that made the description-line cost visible
- [ADR-0001](../adr/0001-omniroute-local-llm-gateway.md) — the routing-versus-rewriting distinction this reuses
