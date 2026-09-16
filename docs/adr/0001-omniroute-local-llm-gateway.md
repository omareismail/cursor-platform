# Architecture Decision Records

Decisions about the platform itself. `.cursor/tools/decision-memory.mjs` indexes
every `##` section in this directory, so each ADR is one such section and its id
opens the heading.

---

## ADR-0001: OmniRoute as an optional local LLM gateway, read but never run

**Status:** Accepted
**Date:** 2026-09-16
**Deciders:** omar.ismail
**Context record:** `memory-bank/activeContext.md`, the dated OmniRoute section

---

### Context

[OmniRoute](https://github.com/diegosouzapw/OmniRoute) is an MIT-licensed local
LLM gateway: one Anthropic- and OpenAI-compatible endpoint on `localhost:20128`
that routes to 352 providers with automatic fallback, per-key spend analytics and
token compression. Running Claude Code through it buys provider fallback, a cost
ceiling and the ability to send cheap work to a cheap model.

Three facts decide the shape of this decision.

The platform's own code never calls a model. Every tool under `.cursor/tools/` is
a deterministic Node script, no hook or CI job talks to an inference endpoint, and
the only LLM in the loop is the host agent. So there is no call site to point at a
gateway; the gateway is a property of the *session*, set in the environment before
the agent starts.

The gateway can silently change who reviews a gate. `ANTHROPIC_DEFAULT_OPUS_MODEL`
and its siblings remap what Claude Code's opus, sonnet and haiku tiers resolve to,
and OmniRoute surfaces non-Claude models as `claude/<provider>/<model>` aliases.
The six lifecycle gates name a reviewer each, every reviewer is an agent with a
declared `model:`, and the three-consent design assumes that reviewer is competent
and independent. A verdict recorded by a small free model under a Claude-shaped
alias is a form, not a control, and nothing in the repository would have said so.

**This is the architecture the platform rejected one day earlier.** On 2026-09-15
`docs/reviews/token-tools-assessment-2026-09-15.md` declined `caveman` and
`headroom` — "sit at `ANTHROPIC_BASE_URL`, rewrite the traffic, hand the model
less than the agent sent" — and its decision says the platform does not install,
run, wrap itself in, or route its traffic through either one. OmniRoute sits in
the same position, and ships twelve token-compression engines, a visual pipeline
editor for them, payload-manipulation rules, and an input sanitiser with a
blocking mode. Adopting it without addressing that would overturn a reviewed
decision by not mentioning it.

The distinction this ADR draws is between **routing** and **rewriting**. The
earlier assessment's objections were to a proxy that changes what the model
receives: it deletes the evidence the platform runs on, because every checking
tool emits a flat `findings[]` array and dozens of similar `warn` rows are
exactly what a compressor is built to summarise, and `/task-verify` exists to
read raw test output and refuse a DONE verdict without it. A gateway that picks
*which* provider answers and passes the bytes through untouched does not do that.
A gateway with compression on is `caveman` with more providers, and the earlier
decision applies to it unchanged.

It is a large, capable, network-facing dependency. 77 direct npm dependencies, a
`postinstall` script, `node-machine-id` and `@ngrok/ngrok` among them; `serve`
binds `0.0.0.0` by default with no API key required and a placeholder admin
password; and it ships a stealth layer — TLS-fingerprint impersonation, header
synthesis, a transparent MITM proxy that installs a root CA — whose documented
purpose is to present consumer subscription accounts (Claude Code OAuth, Codex,
Cursor, Copilot) as API providers. socket.dev flagged six behaviours at 3.8.5,
mitigated in 3.8.6; the capabilities remain because they are the product.

### Decision

Adopt OmniRoute as an **optional, human-run** gateway, on eight rules.

1. **The platform never installs, starts or configures it**, from an agent or from
   CI. A human does, on their own machine. Docker bound to loopback is the
   recommended shape; `guard-bash.mjs` refuses the commands from the agent's shell.
2. **Sessions enter it with `omniroute launch`**, which injects `ANTHROPIC_BASE_URL`
   and `ANTHROPIC_AUTH_TOKEN` into one process and writes nothing. Never
   `omniroute configure` or `setup-claude`, which write `~/.claude/profiles/<name>/settings.json`
   outside this repository's reviewed surface; run the gateway with
   `CLI_ALLOW_CONFIG_WRITES=false`.
3. **Providers are API keys.** Never a consumer subscription's OAuth session. Every
   stealth, TLS-fingerprint and MITM flag stays off.
4. **Gate-reviewer tiers stay on native `claude-*` ids** served by Anthropic. Today
   that is opus and sonnet; the tiers are derived from the gate files, not
   hardcoded, so adding a haiku reviewer protects haiku too. The haiku tier is the
   one a cheap or free model may take. For products whose governance profile says
   `PII` or `regulated`, nothing is remapped.
5. **The platform only ever reads.** One `GET /v1/models` against a loopback host,
   short timeout, no redirects, never a completion, never a write. A non-loopback
   base URL is refused before a socket opens.
6. **MCP access is `read-only` with enumerated allows**, over HTTP so `.mcp.json`
   never spawns the package, with a scoped token, and with the gateway's own
   `MCP_TOOL_ALLOW` mirroring the policy.
7. **In an adopter application the gateway is an external HTTP dependency**: the
   client keeps its own timeout, retry, circuit breaker and idempotency key.
   Gateway-side fallback does not satisfy `failure-modes.mjs`, which reads the
   registration site.
8. **It routes; it does not rewrite.** Every compression engine off, no payload
   manipulation rules, the input sanitiser left in `warn` and never `block`, and
   no request-side PII or credential rewriting. A gateway that edits the traffic
   is the tool the platform declined on 2026-09-15, and turning any of this on
   re-opens that decision rather than working around it.

`.cursor/tools/omniroute.mjs` makes rule 4 checkable: `tiers` answers from the
environment alone and exits 1 when a reviewer tier is remapped, and
`/lifecycle-gate` stops before `record-gate` on that exit.

### Consequences

**Positive:**
- Provider fallback and a cost ceiling for sessions that want them, without any
  change to how the platform is written or tested.
- The thing that was previously invisible — which model answered as "sonnet" —
  becomes a checkable, blocking condition at the one place it matters.
- The decision is enforced rather than described: two shell rules, one MCP policy
  entry, one adversarial suite.

**Negative / trade-offs accepted:**
- Every prompt and every file the agent reads transits a third-party process that
  can route to providers nobody vetted. Tier pinning bounds which model answers;
  it does not bound which process sees the bytes. That is why the gateway is
  optional and why `PII`/`regulated` work pins all three tiers.
- One deliberate departure from the Graphify precedent: this adapter makes a
  network call. A live service has no file to hash, so freshness cannot be
  derived. It is bounded to one loopback GET with a 1500 ms timeout, and the
  gate-blocking path never needs it.
- Registering the MCP server edits `.mcp.json` and `.cursor/mcp-policy.json`, both
  attested in `lifecycle/integrity.json`. A human must re-attest. Graphify avoided
  that cost; a network-facing dependency does not get to.

**Neutral / watch points:**
- The tool proves a model *id* is Anthropic-native. It cannot prove which upstream
  credential the gateway routes `claude-*` to — that is rule 3, and rule 3 is a
  human's discipline, not a check.
- **Rules 3 and 8 are documented, not enforced, and that is the residual risk.**
  The 2026-09-15 assessment's sharpest objection was that a process outside the
  repository which rewrites every request is a control `lifecycle/integrity.json`
  cannot hash. That objection survives here in full: nothing in this repository
  can see the gateway's compression settings or which credential it used. What
  changed is that the gateway is optional, the tier check is blocking, and the
  configuration that would make it a rewriter is written down as forbidden rather
  than left to be discovered. Anyone reviewing a session behind a gateway should
  read the gateway's own settings, not only this repository's output.
- OmniRoute's CLI moves fast (8,500 commits, weekly releases). Command names and
  environment variables in `.cursor/docs/OMNIROUTE.md` are pinned to v3.8.5x and
  should be re-read against its docs before trusting them.
- Claude Code assumes a 200K context window for ids it does not recognise, so a
  remapped tier without `CLAUDE_CODE_AUTO_COMPACT_WINDOW` compacts at the wrong
  point. The adapter warns.

### Alternatives Considered

**Option A — the platform installs and launches it (Rejected).** It would make
setup one command, and it would put a gateway holding every provider key under a
session no human configured. Rule 10 and `guard-bash.mjs` already refuse package
installs from an agent for smaller reasons than this one.

**Option B — MCP registration only, no adapter (Deferred, then included).** The
MCP server answers questions about the gateway, but it cannot answer the one that
matters — what *this session* is pinned to — because that lives in the session's
environment, not in the gateway. The adapter is the part that makes rule 4 real;
MCP is the part that makes the gateway's own telemetry reachable.

**Option C — decline it (Rejected).** The cost ceiling and fallback are real, the
gateway is optional, and a platform that refuses to look at what its sessions are
already configured to do has the same blind spot with or without this decision.

### Links

- Operating guide: `.cursor/docs/OMNIROUTE.md`
- Adapter: `.cursor/tools/omniroute.mjs`
- Precedent for a read-only third-party adapter: `.cursor/tools/graphify.mjs`
- Supersedes: N/A
- Superseded by:
