# cursor-platform

A Cursor agent platform for **.NET + React** development in GCC fintech contexts (RHODES, Tamkeen, and similar codebases). It provides 66 skills, 11 always-on guard rules, and a two-tier memory-bank so the agent discovers real repo structure, imitates existing patterns, and enforces architecture, security, audit trails, and RTL/i18n discipline.

**Repository:** [github.com/omareismail/cursor-platform](https://github.com/omareismail/cursor-platform)

---

## Quick start

1. Open this folder in **Cursor**.
2. Read [`.cursor/docs/START-HERE.md`](.cursor/docs/START-HERE.md) — task-oriented map of skills and rules.
3. On a **target application repo**, run:
   ```
   /repo-discovery full
   /context-sync
   ```
4. Customize Tier 2 standards in [`memory-bank/`](memory-bank/) (see [`memory-bank/README.md`](memory-bank/README.md)).

---

## Structure

```
.cursor/
  skills/          # 66 slash-command skills (generators, auditors, speckit pipeline)
  rules/             # 11 always-on .mdc guard rules
  docs/              # skill-graph, execution pipeline, governance, START-HERE
  cache/             # repo-map.json (generated; gitignored except .gitkeep)

memory-bank/
  Tier 1 (dynamic)   # techContext, progress, activeContext — filled by /context-sync
  Tier 2 (static)    # architecture, businessRules, securityStandards — team-authored
```

| Doc | Purpose |
|-----|---------|
| [START-HERE.md](.cursor/docs/START-HERE.md) | "I want to do X" → which skill to run |
| [skill-graph.md](.cursor/docs/skill-graph.md) | Skill dependencies and wiring |
| [shared-execution-pipeline.md](.cursor/docs/shared-execution-pipeline.md) | Canonical order: discovery → pattern → generate → validate |
| [GOVERNANCE_REPORT.md](.cursor/docs/GOVERNANCE_REPORT.md) | How 24 proposed governance rules map to 11 actual rules |
| [mcp-ecosystem.md](.cursor/docs/mcp-ecosystem.md) | Recommended MCP servers and env vars |

---

## Local setup (MCP)

`settings.local.json` is **not committed** (see `.gitignore`). Create `.cursor/settings.local.json` locally and configure MCP servers per [mcp-ecosystem.md](.cursor/docs/mcp-ecosystem.md).

Common environment variables:

| Variable | Used by |
|----------|---------|
| `GITHUB_PAT` | GitHub MCP server |
| `POSTGRES_READONLY_URL` | Postgres schema exploration (read-only role only) |
| `CONTEXT7_API_KEY` | Context7 docs lookup (optional) |

---

## Using in another project

Copy into the **root** of your application repository:

```
your-app/
  .cursor/       ← copy from this repo
  memory-bank/   ← copy from this repo; then customize Tier 2
  src/           ← your existing code
```

After copying, run `/repo-discovery full` and `/context-sync` on the target repo to populate Tier 1 memory and `.cursor/cache/repo-map.json`.

---

## Inventory

- **66 skills** — generators (`dotnet-endpoint-gen`, `react-component-gen`, …), auditors (`database-audit`, `compliance-audit`, …), speckit pipeline, meta-audits (`skill-maturity-audit`, `platform-health-validator`)
- **11 rules** — always-on guards for memory/context, architecture, security, planning, database providers, audit trails, RTL/i18n, minimal changes, evidence/dependencies

Full rule table: [START-HERE.md § The 11 rules](.cursor/docs/START-HERE.md).

---

## First run checklist

- [ ] `/repo-discovery full` on target codebase
- [ ] `/context-sync` to populate Tier 1 memory-bank
- [ ] Replace `> EXAMPLE —` blocks in Tier 2 files with your team's decisions
- [ ] `/skill-maturity-audit all` to verify skill wiring
- [ ] Optional: `/architecture-map-gen dependency-graph` for a live dependency diagram

---

## License

Add a license file if you intend to open-source or share this platform beyond your team.
