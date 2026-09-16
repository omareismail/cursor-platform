# New project — cursor-platform bootstrap

Follow this when creating a **new .NET / React / full-stack** repository and
wiring in [cursor-platform](https://github.com/omareismail/cursor-platform).

---

## Prerequisites

- [ ] Cursor IDE installed
- [ ] Git remote ready (GitHub, Azure DevOps, etc.)
- [ ] Optional: `gh auth login`, `GITHUB_PAT`, `POSTGRES_READONLY_URL` for MCP
      (see [mcp-ecosystem.md](mcp-ecosystem.md))

---

## Step 1 — Create the application repo

**Greenfield:** scaffold your solution and frontend per
`memory-bank/architecture.md` (Clean Architecture + feature folders).

**Existing codebase:** clone the repo and continue at Step 2, or give the
agent [APPLY-TO-PROJECT.md](APPLY-TO-PROJECT.md) to run the full bootstrap.

---

## Step 2 — Install cursor-platform

The supported install is the **plugin** (see `plugin/README.md`): it ships hooks, tools, schemas and wiring together. A copy of `.cursor` alone is not a working install — `.cursor/hooks.json` invokes `.claude/hooks/*.mjs`, and the tools read `schemas/`.

If you are copying from a checkout instead of installing the plugin, take the complete set:

**Linux / macOS:**

```bash
git clone https://github.com/omareismail/cursor-platform.git /tmp/cursor-platform
cp -r /tmp/cursor-platform/.cursor .
cp -r /tmp/cursor-platform/.claude .
cp -r /tmp/cursor-platform/schemas .
cp /tmp/cursor-platform/AGENTS.md .
cp /tmp/cursor-platform/CLAUDE.md .
mkdir -p memory-bank            # empty on purpose - see the note below
```

**Windows (PowerShell):**

```powershell
git clone https://github.com/omareismail/cursor-platform.git $env:TEMP\cursor-platform
Copy-Item -Recurse $env:TEMP\cursor-platform\.cursor .
Copy-Item -Recurse $env:TEMP\cursor-platform\.claude .
Copy-Item -Recurse $env:TEMP\cursor-platform\schemas .
Copy-Item $env:TEMP\cursor-platform\AGENTS.md .
Copy-Item $env:TEMP\cursor-platform\CLAUDE.md .
New-Item -ItemType Directory -Force memory-bank | Out-Null   # empty on purpose
```

> **`memory-bank/` is not copied, on purpose.** The platform's own copy is
> tracked, so a clone carries it: Tier 1 files describing "a **Node ESM tooling
> repo**, not a CQRS/.NET application", on the platform's branch, with its
> progress log. Every `*-gen` skill reads that directory, so copying it makes
> this project's agents imitate another codebase. The first session's digest
> will report the four Tier 1 files as missing — that is the correct starting
> state. Fill it with `/context-sync` in Step 4.

Verify:

- [ ] `.cursor/skills/` — 99 skill folders
- [ ] `.cursor/rules/` — 12 `.mdc` rule files
- [ ] `.claude/hooks/` — guard scripts (`guard-write.mjs`, `guard-phase.mjs`, `guard-bash.mjs`, `guard-mcp.mjs`, `_lib.mjs`, `_sql.mjs`)
- [ ] `schemas/` — finding and id-grammar schemas the copied tools read
- [ ] `memory-bank/` — 24 files
- [ ] `AGENTS.md` and `CLAUDE.md` at project root
- [ ] Create `.cursor/settings.local.json` locally (not committed) — see
      [mcp-ecosystem.md](mcp-ecosystem.md)
- [ ] `node .cursor/tools/doctor.mjs diagnose` reports an install mode (copy or plugin) and does not write files
- [ ] `node .cursor/tools/project.mjs init --name "<product>"` created `project/` (Command Center overlay; does not mark phases complete)

---

## Step 3 — Customize Tier 2 memory-bank

Replace example content; delete `> EXAMPLE —` blocks when done.

| File | Set |
|------|-----|
| `projectbrief.md`, `productContext.md` | Product name, users, scope |
| `architecture.md` | Layering, folders, module boundaries |
| `technologyStack.md` | .NET/React versions, databases |
| `databaseConventions.md` | Provider roles (OLTP vs read-only secondary) |
| `businessRules.md` | Domain rules + audit-required entities |
| `securityStandards.md` | SAMA/PCI/ZATCA context, webhook rules |
| `apiConventions.md`, `backendConventions.md`, `frontendConventions.md` | Team conventions |
| `glossary.md` | Bilingual terms (EN/AR) if applicable |

---

## Step 4 — First agent run

In Cursor, on the new project:

```
/repo-discovery full
/context-sync
/skill-maturity-audit all
```

- [ ] `.cursor/cache/repo-map.json` created (gitignored)
- [ ] `memory-bank/techContext.md` has real stack versions
- [ ] `activeContext.md` names the project and current branch

Optional:

```
/architecture-map-gen dependency-graph
/onboarding-doc-gen
```

---

## Step 5 — Git hygiene

Ensure project `.gitignore` includes:

```gitignore
.cursor/settings.local.json
.cursor/settings.local.json.bak-*
.claude/settings.local.json
.cursor/cache/*
!.cursor/cache/.gitkeep
project/.txn.json
project/.lock
```

- [ ] Commit `.cursor/`, **`.claude/`**, **`schemas/`**, **`CLAUDE.md`**,
      `memory-bank/`, and `AGENTS.md`
- [ ] Do **not** commit `settings.local.json`, its `.bak-*` backup, or `repo-map.json`

> **Why `.claude/`, `schemas/` and `CLAUDE.md` are on that list.** They were not,
> and the result is invisible: the person who ran the install keeps working
> guards, while every teammate who clones gets no `.claude/settings.json` (so no
> Claude Code hooks fire at all), a `.cursor/hooks.json` pointing at hook scripts
> that are not in the clone, and `artifact-schema.mjs` throwing `schema
> id-grammar.json not found` — which makes `lifecycle.mjs approve` refuse every
> phase. Nothing reports any of it.
>
> The `.bak-*` line matters for the same reason: the backup holds the same
> credentials as `settings.local.json`, and a pattern without the wildcard does
> not match it.

---

## Step 6 — First feature (recommended)

```
/prompt-quality-audit [feature idea]
/speckit-analyze
/speckit-clarify
/speckit-plan
```

Then `/speckit-implement` or the appropriate `*-gen` skill.

---

## Step 7 — Ongoing habits

| When | Command |
|------|---------|
| Start of session | `/repo-discovery quick` |
| Large cross-cutting change | `/context-builder [description]` |
| Before release | `/enterprise-report-gen production-readiness [scope]` |
| After shipping | Update `progress.md`; `/changelog-gen` if needed |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Agent invents types or packages | `/repo-discovery full`; rules `10-evidence-and-dependency-guard` |
| Agent skips skills | Reference `@AGENTS.md` and `@skill-catalog.md` in the first message |
| memory-bank stale | `/context-sync` |
| Architecture guards not firing | Open relevant `.cs` / `.tsx` files — guards 02–08 are glob-scoped |

---

## Checklist

- [ ] App repo created
- [ ] `.cursor/` + `memory-bank/` + `AGENTS.md` copied
- [ ] Tier 2 customized
- [ ] `/repo-discovery full` + `/context-sync` run
- [ ] `project.mjs init` run (greenfield or `--existing`)
- [ ] `.gitignore` excludes cache and local settings
- [ ] Platform files in first commit
