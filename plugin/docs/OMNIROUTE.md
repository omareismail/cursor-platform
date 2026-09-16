# OmniRoute — running a session behind an LLM gateway

[OmniRoute](https://github.com/diegosouzapw/OmniRoute) is an MIT-licensed local
LLM gateway: one Anthropic- and OpenAI-compatible endpoint that routes to
hundreds of providers with automatic fallback, per-key spend analytics and token
compression. Running Claude Code through it buys provider fallback, a cost
ceiling, and the ability to send cheap work to a cheap model.

It is **optional**, and it is **yours to run**. Decision and reasoning: ADR-0001,
in `docs/adr/0001-omniroute-local-llm-gateway.md` at the root of the platform
repository.

---

## What the platform does, and does not do

Eight rules. They are the decision; everything below is how to keep them.

1. **The platform never installs, starts or configures it**, from an agent or
   from CI. You do, on your own machine. `guard-bash.mjs` refuses the commands
   from the agent's shell, and that refusal is a signal to hand the command to a
   human, not to find another way to run it.
2. **Sessions enter it with `omniroute launch`**, which injects two environment
   variables into one process and writes no files. Never `omniroute configure` or
   `omniroute setup-claude`: they write `~/.claude/profiles/<name>/settings.json`,
   outside the enforcement surface this repository reviews.
3. **Providers are API keys.** Never a consumer subscription's OAuth session.
   Every stealth, TLS-fingerprint and MITM flag stays off.
4. **Gate-reviewer tiers stay on Anthropic model ids.** Today that is opus and
   sonnet. Haiku is the tier a cheap or free model may take.
5. **The platform only ever reads.** One `GET /v1/models` against a loopback
   host, 1500 ms, no redirects, never a completion, nothing written.
6. **MCP access is read-only** with enumerated allows, over HTTP, with a scoped
   token.
7. **In an adopter application the gateway is an external HTTP dependency** and
   keeps its own timeout, retry, breaker and idempotency key.
8. **It routes; it does not rewrite.** Compression engines off, no payload rules,
   the input sanitiser in `warn` and never `block`. See the next section — this
   is the rule most likely to be broken by accident, because the features are
   advertised as savings.

---

## The one rule that is easy to break: routing is not rewriting

On 2026-09-15 this platform assessed two token-reduction proxies, `caveman` and
`headroom`, and declined both. Their architecture was: sit at
`ANTHROPIC_BASE_URL`, rewrite the traffic, hand the model less than the agent
sent. The decision was that the platform does not install, run, wrap itself in,
or route its traffic through either one. The full reasoning is in
`docs/reviews/token-tools-assessment-2026-09-15.md`.

OmniRoute sits in the same position and ships the same capability: twelve
compression engines advertised at 15–95% savings, a visual editor for chaining
them, payload-manipulation rules, and an input sanitiser that can reject a
request outright.

**A gateway that chooses a provider and passes the bytes through is a router.
A gateway with compression on is `caveman` with more providers**, and the
earlier decision applies to it unchanged. The objection was never about saving
tokens; it was that every checking tool here emits a flat `findings[]` array,
that dozens of similar `warn` rows are precisely what a compressor is built to
summarise, and that `/task-verify` exists to read raw test output and refuse a
DONE verdict without it. A fitness run whose forty findings arrive as "about
forty similar findings" has had its purpose removed, silently.

So, on the gateway:

| Leave it off | What it would do |
|---|---|
| Every compression engine, RTK, Caveman packs, LLMLingua, and Compression Studios pipelines | Hands the model less than the agent sent |
| `OMNIROUTE_PAYLOAD_RULES_PATH` rules | Edits requests in flight, hot-reloaded, from a file no attestation covers |
| `INPUT_SANITIZER_MODE=block` (leave the default `warn`) | Rejects a request the agent made, as a 400 the agent cannot distinguish from a real failure |
| `PII_REDACTION_ENABLED`, `CREDENTIAL_REDACTION_ENABLED`, `PII_RESPONSE_SANITIZATION` | Rewrites request and response bodies |

**None of this is checkable from here.** Nothing in this repository can read the
gateway's compression settings, and that is the honest residual risk: the
2026-09-15 assessment's sharpest point was that a process outside the repository
which rewrites every request is a control `lifecycle/integrity.json` cannot hash.
That is still true. What this adoption adds is that the gateway is optional, the
reviewer-tier check is blocking, and the configuration that would turn a router
into a rewriter is written down as forbidden instead of left to be discovered.

The one tool involved is read-only:

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/omniroute.mjs tiers     # env only, no network — the one the skills call
node ${CLAUDE_PLUGIN_ROOT}/tools/omniroute.mjs status    # adds one loopback GET /v1/models
node ${CLAUDE_PLUGIN_ROOT}/tools/omniroute.mjs models    # the catalog, grouped by provider
```

`tiers` exits 1 when a tier a gate reviewer runs on resolves to something that is
not an Anthropic model id. With no gateway configured, all three say so and exit
without touching the network.

---

## Hardening checklist — once, before the first session

Defaults worth changing. Every item is something OmniRoute ships permissive.

| Do this | Because |
|---|---|
| Run the Docker image, published to loopback: `-p 127.0.0.1:20128:20128` | `omniroute serve` from npm binds `0.0.0.0`. For the npm path set `OMNIROUTE_SERVER_HOST=127.0.0.1` |
| `REQUIRE_API_KEY=true` | Defaults to `false`: any local process can spend your provider keys |
| Change the initial dashboard password | `INITIAL_PASSWORD` ships as a well-known placeholder |
| Set `JWT_SECRET`, `API_KEY_SECRET`, `OMNIROUTE_WS_BRIDGE_SECRET` | Session cookies, key encryption at rest, and the internal bridge |
| `CLI_ALLOW_CONFIG_WRITES=false` | Defaults to `true`, which lets the gateway rewrite your CLI configs |
| Leave `ENABLE_TLS_FINGERPRINT`, `CLI_COMPAT_*` and the MITM/TPROXY features off | They exist to present consumer subscription accounts as API providers. That is a terms-of-service problem, and OmniRoute's own docs report accounts banned for it |
| Add providers as **API keys** only | Same reason. An API key is a product Anthropic and others sell; a subscription login is not |
| `OMNIROUTE_DISABLE_CREDENTIAL_HEALTH_CHECK=1` unless you want the sweep | Otherwise it probes every configured provider every five minutes |
| Pin the image or package version | `update-notifier` contacts the npm registry on its own |
| Install it as its own user, or in the container — never `npm i -g` on the dev box | 77 direct dependencies and a `postinstall` script. socket.dev flagged six behaviours at 3.8.5 — a root-CA installer, OS-keychain credential import, a child-process and privilege-elevation toolkit, a service supervisor, and cloud-sync credential write-back. 3.8.6 mitigated them; the capabilities are the product and remain |

Its CLI moves fast. Check the flags above against its own docs before trusting
them — the names here were read at v3.8.5x.

---

## Running a Claude Code session through it

Export the tier block, then launch. `omniroute launch` injects
`ANTHROPIC_BASE_URL` (the root, with no `/v1` suffix) and `ANTHROPIC_AUTH_TOKEN`
into that one process.

```bash
export ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-5       # reviewer tier — keep it Anthropic
export ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-5   # reviewer tier — keep it Anthropic
export ANTHROPIC_DEFAULT_HAIKU_MODEL=<any model>        # the only tier a cheap or free model may take
export CLAUDE_CODE_AUTO_COMPACT_WINDOW=<below that model's real window>
export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1     # lets /model list the gateway's claude* ids
omniroute launch
```

Then, as the first command of the session:

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/omniroute.mjs status
```

**Why the reviewer tiers are pinned.** Each of the six gates names the agent that
judges it, and each of those agents declares a model tier. A verdict recorded by
a small free model wearing a Claude-shaped name is a form, not a control — and
`claude/<provider>/<model>` is exactly the shape OmniRoute gives a non-Claude
model. The tiers are read from the gate files and the agent definitions on every
run, so adding a haiku reviewer protects haiku from the next run onwards, with no
edit here.

**Two limits worth stating plainly.** The tool proves a model *id* is Anthropic's
own shape and that the gateway does not serve it from some other provider. It
cannot prove which upstream credential the gateway uses for `claude-*` — that is
rule 3, and rule 3 is your discipline, not a check. And it verifies configuration
and the catalog, never traffic: which model answered a given request is in
OmniRoute's `X-OmniRoute-*` response headers, which reach Claude Code and not
this repository.

**Governance profiles.** `node ${CLAUDE_PLUGIN_ROOT}/tools/lifecycle.mjs product` derives the
flags. When a product reports `PII` or `regulated`, pin all three tiers: a
free-tier provider with unknown retention is a sub-processor nobody signed for.

**If context compaction fires early**, that is `CLAUDE_CODE_AUTO_COMPACT_WINDOW`.
Claude Code assumes 200K for any id it does not recognise, so a remapped tier
without that variable compacts at the wrong point. `status` warns.

---

## Cursor

There is no environment path: Cursor stores its model configuration in an opaque
SQLite database, and OmniRoute's own docs say so. For Cursor, only the MCP server
below applies. Mirror it by hand in `.cursor/settings.local.json` (gitignored)
under the same server name `omniroute`, so `guard-mcp.mjs` governs it there too.

---

## The MCP server

OmniRoute ships an MCP server with 110 tools across 33 scopes, and its scope
enforcement is **off by default**. If it is registered in `.mcp.json`:

- `.cursor/mcp-policy.json` gives it `read-only` with an enumerated `allow` list
  and a broad `deny` list. Health, catalog, quota and routing-explanation tools
  are reads; anything that sends a completion, fetches the web, writes config, or
  mints a token is refused, and stays refused even if someone raises the level.
- Mirror that on the gateway with `OMNIROUTE_MCP_ENFORCE_SCOPES=1` and
  `MCP_TOOL_ALLOW`. That lock is the server's to keep; the policy file is the one
  that fails the build.
- Use HTTP transport with a scoped token
  (`omniroute tokens create --name claude-mcp --scope read`), so `.mcp.json`
  never spawns the npm package.

`omniroute_route_request` is denied on purpose. A completion fetched through MCP
is a second model in the loop that no record names.

**If you do not run the gateway, the entry costs you one line of noise.** It is
committed in `.mcp.json`, so a session on a machine with no gateway reports
`omniroute` as a server that failed to connect, once, at startup. That is
harmless and the session continues. If you would rather not see it, delete the
`omniroute` block from `.mcp.json` and keep the one in `.cursor/mcp-policy.json`:
the policy entry is the control, and with `unlisted: "deny"` a server nobody
wrote a policy for cannot be used at all, so leaving it in place means the day
someone does run the gateway it is already governed.

---

## Adopter applications

When a product this platform governs calls an LLM through the gateway, the
gateway is an external HTTP dependency like any other, and
`memory-bank/technologyStack.md` already requires Polly around those.

```csharp
services.AddHttpClient<LlmGatewayClient>(c =>
{
    c.BaseAddress = new Uri(cfg["Llm:GatewayUrl"]!);   // loopback, or a private address you own
    c.Timeout = TimeSpan.FromSeconds(60);
}).AddStandardResilienceHandler();
```

Frontend calls go through the API layer, never `fetch` in a component
(`${CLAUDE_PLUGIN_ROOT}/rules/03-react-architecture-guard.mdc`); the equivalent registration is
`axios.create({ baseURL, timeout })`.

**Gateway-side fallback does not count.** `${CLAUDE_PLUGIN_ROOT}/tools/failure-modes.mjs` reads
the registration site and looks for timeout, retry, breaker, idempotency and
fallback markers *inside that statement*. OmniRoute's combos and circuit breakers
live in another process — the one that is itself the dependency that fails. Run
`node ${CLAUDE_PLUGIN_ROOT}/tools/failure-modes.mjs explain LlmGatewayClient` to see what is
still missing. Put an `Idempotency-Key` on any request that spends money: a
retried call that is not idempotent pays twice.

Give each application its own scoped key
(`omniroute tokens create --name <app> --scope read`) so spend is attributable.

---

## Verifying

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/omniroute.mjs status          # 0 pinned · 1 a blocking finding · 2 no gateway
node ${CLAUDE_PLUGIN_ROOT}/tools/omniroute.mjs tiers --json    # what each tier resolves to, and which are protected
node ${CLAUDE_PLUGIN_ROOT}/tools/omniroute.mjs models --filter claude
node ${CLAUDE_PLUGIN_ROOT}/tools/lifecycle.mjs product         # integrations, derived from .mcp.json
node tests/run.mjs omniroute                     # the adapter's own adversarial suite
```
