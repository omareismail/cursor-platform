# MCP Ecosystem

**Last Updated:** 2026-06-30 (verify package versions before relying on this —
the MCP ecosystem moves fast and package names/maintainers change)

This documents every MCP server recommended for this workspace: what it's for,
why it's the right pick over alternatives, install/config, and which skills it
plugs into. Three servers (`github`, `filesystem`, `memory`) were already
configured in `settings.local.json` before this phase — not duplicated here.

**Honesty note on maturity:** the database-exploration servers below split
into two tiers. Postgres, Playwright, Sequential Thinking, Context7, and Git
are official/well-maintained packages from Anthropic, Microsoft, or the
library's own maintainers — install with confidence. Oracle and SQL Server
schema exploration do not have an equivalently mature single official option
at the time of writing — recommendations there are flagged accordingly,
because over-trusting an unvetted community MCP server with read access to a
production-adjacent database (especially given this codebase's SAMA/PCI DSS
context) is a worse outcome than not having the integration yet.

---

## 1. PostgreSQL schema exploration

**Package:** `@modelcontextprotocol/server-postgres` (official, MCP steering group)
**Priority:** High — directly supports `dotnet-schema-diff`, `dotnet-dapper-gen`,
`dotnet-query-optimizer` for any project where Postgres is the system of record.

**Install/config** (add to `settings.local.json` → `cursor.features.mcpServers`):
```json
"postgres": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-postgres", "${env:POSTGRES_READONLY_URL}"]
}
```
Point the connection string at a **read-only** role, never the application's
write credentials — this server has no built-in write guard of its own, the
read-only-ness comes entirely from which database user you give it.
`templates/postgres/readonly-role.sql` creates that role: `SELECT` on the app
schema and nothing else, `default_transaction_read_only = on`, a 30s
`statement_timeout` (the database's answer to `pg_sleep`), no `TEMP`, no `CREATE`.

Two locks, and it is worth knowing which is which. `guard-mcp.mjs` is the
client-side one: it tokenizes every string in the call's arguments and refuses
anything that is not a single read — a `DELETE` inside a CTE, `EXPLAIN ANALYZE`,
a second statement behind a comment or a `';'` literal, `FOR UPDATE`, `SELECT
INTO`, and calls to `pg_sleep`, `lo_import`, `pg_read_file`, `set_config`,
`nextval`, `dblink_*`. It is a hook, so it holds only while the hook runs. The
role is the boundary: it holds when the hook is disabled, the server is swapped,
or the SQL arrives by a path nobody wrote a guard for. Run both. The policy for
the client side is `.cursor/mcp-policy.json`, where a server with no entry is
**denied** — register it with an explicit access level (`deny`, `read-only`,
`restricted-write`, `full`) before it runs anything.

**Example workflow:** running `/dotnet-schema-diff` against Postgres, the agent
can query `information_schema` live through this server instead of you
pasting catalog query output into chat — faster, and the agent sees the
actual current state rather than a stale snapshot.

---

## 2. Oracle schema exploration

**Recommendation:** Oracle's own **SQLcl MCP Server** — SQLcl (Oracle's
official command-line client, bundled with the Oracle SQL Developer VS Code
extension) can run as an MCP server directly. This is the right choice over
any of the community npm packages (`mcp-oracle-db`, `oracle-mcp-server`, etc.)
because it's maintained by Oracle itself, identifies its sessions distinctly
in `V$SESSION` for audit purposes, and logs all MCP-driven queries to a
`DBTOOLS$MCP_LOG` table in the connecting schema — meaningful for a project
under SAMA CSF scrutiny where "what did the AI agent actually query against
production" needs to be answerable.

**Priority:** High for any project reading the legacy MOTORS/INSURANCE_ONLINE-
style schemas — this directly replaces the manual DDL-extraction workflow
`dotnet-schema-diff` formalizes.

**Install:** Install/update SQLcl (via the Oracle SQL Developer VS Code
extension or standalone), then configure it as an MCP server per Oracle's
docs (`blogs.oracle.com` — "Introducing MCP Server for Oracle Database").
Exact CLI invocation depends on your SQLcl version; verify against Oracle's
current docs rather than a hardcoded command here, since this is a tool
release, not an npm package with a stable install line.

**Critical operational note (Oracle's own guidance, not just ours):** connect
this to a **read-only replica or a dedicated read-only user**, never directly
to a production schema with write grants — this matches exactly what
`databaseConventions.md` already specifies for the read-only-secondary role.

---

## 3. SQL Server schema exploration

**Recommendation:** flagged, not a confident pick. There is no single
official Microsoft MCP server for SQL Server schema exploration at the time
of writing — the options are community-maintained (`@bilims/mcp-sqlserver`,
`mssql-mcp-server`, several others), with meaningfully different feature
sets and security postures. Before adopting one:

1. Confirm it enforces read-only mode by default (query allowlist, not just
   documentation claiming "read-only").
2. Check it's been updated recently and has more than one maintainer/contributor.
3. Pin an exact version — do not use `@latest` in the MCP config for a tool
   with database credentials.

**If proceeding, a reasonable starting point** (verify current state before
installing):
```json
"sqlserver": {
  "command": "npx",
  "args": ["-y", "@bilims/mcp-sqlserver@<pinned-version>"],
  "env": {
    "SQLSERVER_HOST": "${env:SQLSERVER_READONLY_HOST}",
    "SQLSERVER_USER": "${env:SQLSERVER_READONLY_USER}",
    "SQLSERVER_PASSWORD": "${env:SQLSERVER_READONLY_PASSWORD}",
    "SQLSERVER_DATABASE": "${env:SQLSERVER_DATABASE}"
  }
}
```
**Priority:** Medium — useful for `dotnet-schema-diff`/`dotnet-query-optimizer`,
but the manual catalog-query path in those skills works fine without it, so
this isn't blocking.

---

## 4. Docker

**Recommendation:** the **Docker MCP Toolkit/Gateway**, built into Docker
Desktop — not one of the standalone community `docker-mcp` npm packages. This
matters for the same reason Docker itself gives for building it: standalone
packages typically run with full host access via npx with no isolation, while
the Toolkit runs each server in its own container with scoped permissions and
handles secrets without plaintext env vars.

**Priority:** Medium — most useful for `dotnet-iac-gen` (container resource
generation) and local environment debugging (the Postgres connection auth
issue and Module Federation deployment misconfiguration mentioned as ongoing
work are exactly the kind of thing "ask the agent to inspect running
containers and logs" helps with).

**Install:** Docker Desktop → MCP Toolkit tab → enable, create a profile,
connect Cursor as a client. Cursor then sees one `MCP_DOCKER` gateway server
that proxies whatever's in your active profile — not a single static config
line, since it's profile-based.

---

## 5. Playwright (covers both "Playwright" and "Browser automation")

**Package:** `@playwright/mcp` (official, Microsoft Playwright team)
**Priority:** High — this is the one place where the original request listed
two separate items ("Playwright" and "Browser automation") that are actually
the same tool. Recommending a second, different browser-automation MCP server
alongside this one would be redundant: `@playwright/mcp` already provides
structured, accessibility-tree-based browser control, which is the
higher-quality approach (no pixel/vision dependency) compared to most generic
browser-automation MCP servers.

**Install/config:**
```json
"playwright": {
  "command": "npx",
  "args": ["-y", "@playwright/mcp@latest"]
}
```

**Example workflow:** `react-test-gen`'s Playwright E2E test generation for
critical paths can drive an actual browser through this server while writing
the test — verifying selectors and flow resolve correctly before the test
file is finalized, rather than generating a test blind and finding out it's
wrong on first CI run.

---

## 6. OpenAPI

**Recommendation:** `openapi-mcp-generator` (npm, TypeScript) — but framed
correctly: this is **not** a static server you add to `mcpServers` once. It's
a generator you run once per project against your actual OpenAPI spec, which
produces a project-specific MCP server exposing your real endpoints as tools.

**Priority:** Medium-High — pairs directly with `apiConventions.md`'s
requirement that the OpenAPI spec be complete enough for client generation;
running this generator is itself a good test of that completeness (it fails
loudly on missing `operationId`s).

**Workflow:**
```bash
npx openapi-mcp-generator --openapi http://localhost:5000/swagger/v1/swagger.json \
  --output ./tools/api-mcp-server
```
Then add the generated server's entry to `mcpServers`. Re-run after API
changes — this is the kind of thing `dotnet-endpoint-gen` should remind about
when it changes the OpenAPI surface significantly.

---

## 7. Context7

**Package:** `@upstash/context7-mcp` (official, Upstash)
**Priority:** High — directly addresses a real failure mode in every `*-gen`
skill: generating code against a library API the agent's training data
remembers as of months ago, not the version actually pinned in this project's
`technologyStack.md`.

**Install/config:**
```json
"context7": {
  "command": "npx",
  "args": ["-y", "@upstash/context7-mcp"]
}
```
Optional API key for higher rate limits (`context7.com/dashboard`).

**Example workflow:** `react-component-gen` generating a TanStack Query hook
can resolve the exact pinned TanStack Query version from `technologyStack.md`,
pull that version's actual docs via Context7, and generate against the real
current API instead of a remembered one — directly prevents the class of bug
`commonMistakes.md` exists to catch after the fact.

---

## 8. Sequential Thinking

**Package:** `@modelcontextprotocol/server-sequential-thinking` (official)
**Priority:** Medium — this is a reasoning-structure tool, not a data
connector; it doesn't fetch anything external, it gives the agent a
structured place to work through multi-step reasoning with revisable steps.

**Install/config:**
```json
"sequential-thinking": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]
}
```

**Where it fits:** `05-planning-rigor.mdc` already forces a structured
elicitation pass before plans/specs/migrations. This server gives that pass
an explicit, revisable scratch space rather than reasoning being implicit in
prose — most useful for `speckit-options`-driven decisions with several
interacting constraints (e.g. the migration-strategy options in
`dotnet-migration`, or a multi-database architecture decision in
`dotnet-multi-db-gen`).

---

## 9. Git History

**Package:** `mcp-server-git` (official MCP reference server, Python — run via `uvx`)
**Priority:** Medium — distinct from the existing `github` MCP server, which
talks to the GitHub API (issues, PRs, remote state). This one reads the local
git history/blame/log directly, which is what `code-review-assistant` and
`onboarding-doc-gen` actually need most of the time and don't currently have
structured access to.

**Install/config:**
```json
"git": {
  "command": "uvx",
  "args": ["mcp-server-git", "--repository", "${workspaceFolder}"]
}
```

**Example workflow:** `onboarding-doc-gen` verifying that a documented command
still matches reality can check `git log` for when a script was last touched,
rather than trusting a possibly-stale README claim at face value.

---

## How these collaborate (not just a list)

A realistic multi-tool sequence for this codebase's actual recurring task —
reconciling a LIVE vs TEST Oracle schema discrepancy that's blocking a
feature deploy:

1. **Sequential Thinking** structures the investigation: what's the
   hypothesis, what needs checking, in what order.
2. **SQLcl MCP (Oracle)** pulls the live DDL from both environments —
   `dotnet-schema-diff` no longer needs hand-pasted catalog query output.
3. **Context7** confirms whether the Oracle.ManagedDataAccess/EF Core provider
   version in use has any relevant behavior change versus what the generated
   migration assumes.
4. **Git** checks whether the discrepancy was introduced by a specific
   migration commit, narrowing down when TEST diverged from LIVE.
5. **GitHub** (existing) opens an issue or links the finding to an existing
   one once the reconciliation plan is decided.

No single server does this — the value is in `00-memory-think.mdc` and the
relevant skill knowing which tool answers which sub-question, instead of one
server being asked to do everything.

---

## Updated `settings.local.json` (Phase 3 additions)

See the actual file for the complete, current configuration — `postgres`,
`playwright`, `sequential-thinking`, and `git` are added as direct, ready-to-
use entries since they're official/stable. `context7` is added but commented
with the optional API key note. Oracle, SQL Server, Docker, and OpenAPI are
documented here rather than hardcoded, for the reasons given above (separate
install path, or a deliberate caveat on maturity).

---

# ⚠ 2026 corrections — read this before trusting the sections above

Two servers recommended earlier in this document have since been **archived by
the MCP project and are no longer maintained or security-patched**. They now
live in `modelcontextprotocol/servers-archived`, which states plainly that *no
security guarantees are provided*.

| Server in old config | Status | Replace with |
|---|---|---|
| `@modelcontextprotocol/server-github` | Archived | GitHub's official server — remote `https://api.githubcopilot.com/mcp/`, or self-host `ghcr.io/github/github-mcp-server` |
| `@modelcontextprotocol/server-postgres` | Archived **+ known CVE-class flaw** | `postgres-mcp` (Postgres MCP Pro) with `--access-mode=restricted` |

**The Postgres one matters more than "unmaintained" suggests.** Datadog Security
Labs found a SQL-injection vulnerability in that reference server that **bypassed
its own read-only restriction** and allowed writes. If you pointed it at anything
but a genuinely SELECT-only role, the "read-only" label was not protecting you.
Rotate that credential and verify the role's grants.

`@modelcontextprotocol/server-filesystem` remains maintained, but see the
"deliberately omitted" table below before adding it to Claude Code.

## Canonical config

The corrected, committed configuration now lives in **`.mcp.json`** at the repo
root (Claude Code, project-scoped, no secrets — only `${ENV_VAR}` references).
`.cursor/settings.local.json` mirrors it for Cursor and stays gitignored.

Required environment variables:

| Variable | Used by | Notes |
|---|---|---|
| `GITHUB_PAT` | github | Fine-grained PAT. Read-only scopes unless you actually want the agent opening PRs. |
| `POSTGRES_READONLY_URL` | postgres | **A role with SELECT only.** `--access-mode=restricted` is defence in depth, not the boundary. |
| `CONTEXT7_API_KEY` | context7 | Optional; raises rate limits. |

## Deliberately omitted — and why

More MCP servers is not better. Every connected server injects its full tool
schema into the context window on **every** turn, and a crowded tool namespace
measurably degrades routing. These were dropped on purpose:

| Server | Why not |
|---|---|
| `server-filesystem` | Claude Code has native Read/Write/Edit/Glob/Grep that are faster and respect `.gitignore`. In Cursor it is redundant with the editor's own indexing. Pure context tax. |
| `server-memory` | It creates a **second, competing memory store** alongside `memory-bank/`. Two sources of truth about the project is strictly worse than one. `memory-bank/` is git-tracked, reviewable, and diffable; the MCP knowledge graph is none of those. |
| `server-sequential-thinking` | Both Cursor and Claude Code have native extended reasoning. This duplicates it and burns tokens re-implementing it as tool calls. |
| `mcp-server-git` | `git` via Bash is faster, more flexible, and already available. The MCP wrapper only narrows what you can do. |
| Oracle / SQL Server | **This entry is outdated — see § Correction below.** |

## Rule of thumb

Connect an MCP server only when it gives the agent information it **cannot
otherwise obtain**:

- `context7` → docs for the *exact pinned version* in `technologyStack.md` (not
  the version the model was trained on). This is the highest-value server here.
- `github` → PR/issue/CI state that is not in the working tree.
- `postgres` → real schema, real statistics, real query plans.
- `playwright` → what the rendered UI actually does, including RTL.

Everything else, the agent can already do with Bash and its file tools.

## Sources

- <https://github.com/modelcontextprotocol/servers-archived>
- <https://securitylabs.datadoghq.com/articles/mcp-vulnerability-case-study-SQL-injection-in-the-postgresql-mcp-server/>
- <https://github.com/github/github-mcp-server>
- <https://github.com/crystaldba/postgres-mcp>


---

# Correction — SQL Server and Oracle now have first-party options

An earlier revision of this document said "SQL Server — no mature official
option yet". **That is no longer true**, and leaving it uncorrected would have
kept a real capability off the table.

| Server | Status | Notes |
|---|---|---|
| **SQL MCP Server** (Microsoft, via Data API Builder 1.7+) | First-party | Entity abstraction, RBAC at the API layer, Key Vault integration, Entra auth, Redis caching, full telemetry. The most complete option for SQL Server / Azure SQL. |
| **Azure MCP Server** (Microsoft) | First-party | Covers Azure SQL plus the rest of the Azure surface — resource management, App Insights, Key Vault. Relevant here because `dotnet-iac-gen` targets Bicep and `operability-gen` reads App Insights. |
| **SQLcl MCP Server** (Oracle) | First-party | Ships with SQLcl, not an npm package — install separately and point the config at the binary. |

## Before you add any of them

The Postgres entry's discipline applies unchanged, and it matters more here
because these servers are more capable:

1. **A read-only role, always.** An access-mode flag is defence in depth, not the
   boundary. The boundary is what the credential is permitted to do. If the role
   can write, assume something eventually will.
2. **Never the application's own credentials.** A separate principal, so an
   agent's queries are distinguishable from the app's in an audit log — which for
   SAMA-scope data is not optional.
3. **Verify the version before adopting.** SQL MCP Server needs Data API Builder
   **1.7 or later**; earlier versions do not expose an MCP endpoint at all.
4. **Weigh the tool-surface cost.** Azure MCP Server is broad. Every connected
   server injects its full tool schema on every turn, and a crowded namespace
   measurably degrades routing. Connect it when you are doing Azure work, not
   permanently.

## Example configuration

Add to `.mcp.json` only what a given project actually uses.

```jsonc
{
  "mcpServers": {
    // SQL Server / Azure SQL via Data API Builder 1.7+.
    // MSSQL_READONLY_CONNECTION must be a login with SELECT only.
    "sqlserver": {
      "command": "dab",
      "args": ["start", "--config", "./dab-config.json"],
      "env": { "MSSQL_CONNECTION_STRING": "${MSSQL_READONLY_CONNECTION}" }
    },

    // Azure control plane. Enable per-project, not globally - large tool surface.
    "azure": {
      "command": "npx",
      "args": ["-y", "@azure/mcp@latest", "server", "start"]
    },

    // Oracle SQLcl. Installed separately; point at the binary on this machine.
    "oracle": {
      "command": "sql",
      "args": ["-mcp"],
      "env": { "ORACLE_CONNECTION": "${ORACLE_READONLY_CONNECTION}" }
    }
  }
}
```

Required environment variables, all pointing at **read-only** principals:
`MSSQL_READONLY_CONNECTION`, `ORACLE_READONLY_CONNECTION`. Azure MCP uses your
existing `az login` credentials — which means it inherits whatever your account
can do. Sign in with a least-privilege account before connecting it.

## Sources

- <https://devblogs.microsoft.com/azure-sql/introducing-sql-mcp-server/>
- <https://learn.microsoft.com/en-us/azure/data-api-builder/mcp/overview>
- <https://learn.microsoft.com/en-us/azure/developer/azure-mcp-server/tools/azure-sql>
