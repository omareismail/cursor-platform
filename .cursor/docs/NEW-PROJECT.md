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

**Existing codebase:** clone the repo and continue at Step 2.

---

## Step 2 — Install cursor-platform

Clone the platform and copy into your **project root**:

**Linux / macOS:**

```bash
git clone https://github.com/omareismail/cursor-platform.git /tmp/cursor-platform
cp -r /tmp/cursor-platform/.cursor .
cp -r /tmp/cursor-platform/memory-bank .
cp /tmp/cursor-platform/AGENTS.md .
```

**Windows (PowerShell):**

```powershell
git clone https://github.com/omareismail/cursor-platform.git $env:TEMP\cursor-platform
Copy-Item -Recurse $env:TEMP\cursor-platform\.cursor .
Copy-Item -Recurse $env:TEMP\cursor-platform\memory-bank .
Copy-Item $env:TEMP\cursor-platform\AGENTS.md .
```

Verify:

- [ ] `.cursor/skills/` — 66 skill folders
- [ ] `.cursor/rules/` — 11 `.mdc` rule files
- [ ] `memory-bank/` — 24 files
- [ ] `AGENTS.md` at project root (agent session instructions)
- [ ] Create `.cursor/settings.local.json` locally (not committed) — see
      [mcp-ecosystem.md](mcp-ecosystem.md)

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
.cursor/cache/*
!.cursor/cache/.gitkeep
```

- [ ] Commit `.cursor/`, `memory-bank/`, and `AGENTS.md`
- [ ] Do **not** commit `settings.local.json` or `repo-map.json`

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
- [ ] `.gitignore` excludes cache and local settings
- [ ] Platform files in first commit
