# Token-reduction tools: caveman and headroom — not adopted

**Assessed:** 2026-09-15. **Recorded:** 2026-09-16.
**Question asked:** should this platform adopt either tool?
**Verdict:** no, neither — and the evaluation exposed one real gap and one
unmeasured cost, both of which were closed in the same increment.

Two third-party token-reduction tools were put to the platform's own adoption
tests. Neither passes. This file records why, so the next person to find them
does not have to repeat the work, and so the two things worth taking from them
are attributable to something.

## What was evaluated

Facts below were read from each project's public README on 2026-09-15 and are
recorded as observed on that date, not as a standing claim about either project.

| | caveman | headroom |
|---|---|---|
| Repository | `juliusbrussee/caveman` | `headroomlabs-ai/headroom` |
| What it is | A terse-output skill, plus an optional local proxy that compresses tool output | A local proxy and SDK that compresses everything an agent reads |
| Shape | Node CLI + agent skill + MCP server | Python package + proxy + MCP server + TS SDK |
| Licence | Skill and CLI MIT; engine, proxy and MCP server BSL-1.1 until 2030-06-21 | Apache-2.0 |
| Install paths offered | `npx skills add … -g`, `npm install -g`, `curl … \| bash`, `irm … \| iex` | `pip install`, `uv tool install`, Docker, `headroom wrap claude` |
| Telemetry | On by default; opt out per its own docs | Beacon on by default; opt out per its own docs |

Both are substantial, actively developed projects with real benchmark work
behind them. Neither is rejected here for being bad. They are rejected because
of what they would have to do to this repository to function.

## The tests they were put to

The platform already has an adoption doctrine; nothing new was invented for
this.

1. **[mcp-ecosystem.md](../../.cursor/docs/mcp-ecosystem.md) § "Rule of thumb"** —
   connect something only when it gives the agent information it cannot
   otherwise obtain.
2. **Same file, § "Deliberately omitted — and why"** — more servers is not
   better; every connected server injects its tool schema on every turn, and a
   crowded namespace measurably degrades routing. `server-memory` was rejected
   there for creating a second, competing store beside an existing one.
3. **The Graphify precedent** (`memory-bank/activeContext.md`) — a third-party
   tool may be *read* without being installed or run, and its own agent
   installers are refused when they write outside the reviewed enforcement
   surface.
4. **[Rule 10](../../.cursor/rules/10-evidence-and-dependency-guard.mdc)** — no
   dependency that is not already in the repo unless the user asked for it.
5. **The enforcement surface** (`.cursor/lifecycle/write-policy.json`) — the
   hooks, their wiring, the policies they read and the records they produce are
   hashed in `lifecycle/integrity.json`. A control that changes behaviour and is
   not in that hash is the defect class `self-audit.mjs` exists to catch.

## Findings — the caveman skill

The skill is an always-on directive that persists for a whole session and tells
the agent to drop filler, fragments-are-fine, and in particular to emit no
preamble, no plan and no progress note before or between tool calls, and no
decorative tables.

- **It contradicts the announcement contract.** `AGENTS.md` requires
  `**Matched skill:** name — description` for every matched skill outside
  Category D, and requires Category A and E skills to announce and then *wait*.
  An instruction to fire tool calls with no preamble is the opposite
  instruction. Neither is conditional on the other, so which one wins on a given
  turn would be decided by sampling.
- **It contradicts [rule 05](../../.cursor/rules/05-planning-rigor.mdc).** No
  plan or spec without an elicitation pass, and always options with explicit
  tradeoffs. That is preamble by definition.
- **It buys the cheap side.** The skill costs roughly a thousand input tokens on
  every call to reduce output. The JetBrains result its own README cites is 8.5%
  fewer output tokens over 86 real tasks. On this platform output is the small
  half of the bill — see the measurement below.
- **Its cheapest installer is the one this repo cannot see.**
  `npx skills add … -g` fetches a skill from a remote repository and, with `-g`,
  writes it into global agent configuration outside this repository entirely.
  Nothing here would show it in a diff.

There is a good idea inside it, and it is not the compression: its own honest
numbers section tells you to measure your workload first and turn the thing off
if it loses. That idea was taken; see *What was taken* below.

## Findings — both proxies

Caveman's proxy and headroom are different implementations of one architecture:
sit at `ANTHROPIC_BASE_URL`, rewrite the traffic, hand the model less than the
agent sent.

- **They are unhashable controls.** `lifecycle/integrity.json` attests hooks,
  wirings, policies, gate definitions and `lifecycle.mjs`. A process outside the
  repository that rewrites every request is a change to agent behaviour that no
  attestation covers and no `self-audit` check can reach. `self-audit.mjs` was
  written for exactly the inverse failure — a control that exists but is not
  connected — on the reasoning that a missing control is noticed and a
  disconnected one is trusted. An invisible *added* control is the same problem
  facing the other way.
- **They delete the evidence this platform runs on.** Both advertise collapsing
  repetitive arrays and dropping non-error log lines. Every checking tool here
  emits a flat `findings[]` array through
  [`_findings.mjs`](../../.cursor/tools/_findings.mjs), and dozens of similar
  `warn` rows is precisely the shape a compressor is designed to summarise.
  `/task-verify` exists to read raw test output and refuse a DONE verdict
  without it. A fitness or ac-trace run whose forty findings arrive as "about
  forty similar findings" has had its purpose removed silently.
- **Their MCP tools are denied here anyway.**
  [`mcp-policy.json`](../../.cursor/mcp-policy.json) denies unlisted servers, and
  each tool registers three (`*_compress`, `*_retrieve`, `*_stats`). Listing them
  would mean a policy edit on the protected surface, for tools the platform has
  no use for.
- **Their install paths run into rule 10.** headroom needs Python plus an ONNX
  runtime fetched from a CDN plus a model from HuggingFace. caveman's proxy is
  BSL-1.1, which is source-available, not open source, until 2030-06-21.

headroom specifically, beyond the above:

- appends verbosity steering to the end of the system prompt;
- lowers reasoning effort on turns it classifies as routine resumption after a
  tool result — a gate review immediately after a file read is exactly that
  shape, and is not a turn to spend less thought on;
- installs a second semantic-navigation server into `~/.claude.json` at user
  scope as part of wrapping the agent, which is a global, cross-project change
  made on behalf of one repository;
- documents API-key auth for the Claude Code path, and ships a switch that
  relaxes strict certificate validation for corporate inspection.

None of this is hidden by either project; all of it is in their own
documentation. It is simply incompatible with a repository whose thesis is that
the mechanical consent is the one that cannot be argued with.

## What a session actually costs

The compression pitch is only worth testing against a real number, and this
repository did not have one. Measured here, then automated as
`.cursor/tools/context-cost.mjs` so it is never a hand-typed figure again.

Bytes are MEASURED. Tokens are an ESTIMATE at four characters each; no host
tokenizer is run.

Counts are **per host** and must not be summed. Claude Code reads `CLAUDE.md`,
which restates the always-on rules inline, and never reads `.cursor/rules/`.
Cursor reads the rules and `AGENTS.md`, and never reads `CLAUDE.md`.

Measured by the tool on 2026-09-16, after this increment's own edits.

| Claude Code, before the first user word | Bytes | ~Tokens |
|---|---|---|
| `CLAUDE.md` | 36,262 | 9,019 |
| `AGENTS.md`, its one import | 5,658 | 1,399 |
| Name and description of 99 skill shims, in the system prompt | 39,671 | 9,885 |
| Name and description of 14 agents, likewise | 7,116 | 1,779 |
| SessionStart digest | 5,576 | 1,391 |
| **Total** | **94,283** | **~23,472** |

| Cursor, before the first user word | Bytes | ~Tokens |
|---|---|---|
| `AGENTS.md` | 5,658 | 1,399 |
| Five always-on rules | 44,910 | 11,152 |
| SessionStart digest | 5,576 | 1,391 |
| **Total** | **56,144** | **~13,942** |

Only the first four rows of each table are fixed. The digest is generated per
session from memory-bank content, so it moves whenever that content does — which
is the reason the tool runs the hook instead of quoting a number from here.
Re-run `node .cursor/tools/context-cost.mjs report` rather than trusting this
table as it ages.

The catalog lines are an estimate in both directions, which is why the tool
labels them and does not pretend otherwise: the host may truncate a long
description, and it wraps each one in framing this repository cannot observe.

**The finding that matters is the third row.** Forty-seven kilobytes of skill and
agent descriptions ride into every Claude Code session, and no document here had
ever counted them. That is half the always-on cost on that host, it is generated
from frontmatter nobody reviews for length, and it grows with every skill added.
It is a larger and more tractable target than anything a compressor could
recover from the other end of the pipe, and it was invisible until someone asked
what a session costs.

For scale: caveman's skill is about a thousand tokens always-on; the largest
skill body here is 12,980 bytes and loads only when that skill is invoked.

## Decision

Neither tool is adopted. The platform does not install, run, wrap itself in, or
route its traffic through either one, and adds no MCP entry for either.

Two rows were added to mcp-ecosystem's "Deliberately omitted" table so the next
person meets the answer where they would look for it.

## What was taken

- **The measurement.** `.cursor/tools/context-cost.mjs report` — read-only, it
  reports what a session carries before the first user word, per host, with
  bytes measured and tokens estimated. Nothing is scored and nothing is
  thresholded, on the same reasoning as `delivery-intel.mjs`: a number reported
  as good becomes a number to hit.
- **The gap.** Evaluating the install paths showed that `curl … | bash`,
  `irm … | iex` and global npm installs were already refused by
  `guard-bash.mjs`, while Python installers and remote skill installers were
  not. That is backlog item B11, open since the Graphify assessment, plus a
  second front door nobody had listed. Both are now refused, with the
  requirements-file and editable-install cases left open so the guard stays
  usable.

## Deliberately not done

- **No output-style or terse-mode rule.** The reason to reject caveman's skill
  was that an always-on style directive collides with the announcement and
  planning contracts. Writing our own would collide with them identically.
- **No refusal of `claude plugin install` or `claude mcp add`.** They are the
  same class of front door as the remote skill installer and are worth a
  decision, but they were not part of this change and a rule invented in passing
  is a rule nobody reviewed.
- **No fix for the whole-command-text matching in `guard-bash.mjs`.** Every rule
  there matches anywhere in the command string, so a note *about* a refused
  command is refused too. That is finding B11-3, it is pre-existing, and the new
  rules inherit it rather than widening it.
- **Nothing was changed about how findings or test output are read.** The point
  of the rejection is that they are not rewritten.
