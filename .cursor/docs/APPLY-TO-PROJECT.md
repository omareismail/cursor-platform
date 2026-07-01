# Bootstrap cursor-platform on an existing project

**You are the agent.** Execute this document step by step on the target
repository. Do not skip verification gates. Ask the human only when a
decision requires their authority (secrets, production deploy, branch merge).

**Target project (default):**
- Path: `D:\repos\MotorsReports`
- Solution: `Reports.sln`
- Stack: .NET 8, Oracle, motor/travel insurance reports (RDLC + QuestPDF)
- Mode: `MODE=dotnet` (no React in this repo)

**Platform source:**
- Local: `D:\repos\cursor`
- Remote: https://github.com/omareismail/cursor-platform.git

**Companion docs (read after install):**
- `AGENTS.md` — every-session agent brief
- `.cursor/docs/START-HERE.md` — task → skill map
- `.cursor/docs/skill-catalog.md` — all 66 skills

---

## Phase 0 — Preconditions

1. Confirm workspace root is the **application repo** (`D:\repos\MotorsReports`),
   not the cursor-platform template repo.
2. Confirm `Reports.sln` exists at workspace root.
3. Announce: **Matched skill:** `repo-discovery` — structural map (Phase 4).

**Stop if:** workspace is wrong folder — tell human to open `D:\repos\MotorsReports`.

---

## Phase 1 — Install platform files

Copy from platform source into **project root**:

```powershell
# Run from D:\repos\MotorsReports
Copy-Item -Recurse D:\repos\cursor\.cursor .
Copy-Item -Recurse D:\repos\cursor\memory-bank .
Copy-Item D:\repos\cursor\AGENTS.md .
```

If local platform path unavailable:

```powershell
git clone https://github.com/omareismail/cursor-platform.git $env:TEMP\cursor-platform
Copy-Item -Recurse $env:TEMP\cursor-platform\.cursor .
Copy-Item -Recurse $env:TEMP\cursor-platform\memory-bank .
Copy-Item $env:TEMP\cursor-platform\AGENTS.md .
```

**Verify (must all pass):**
- [ ] `.cursor/skills/` contains 66 subfolders
- [ ] `.cursor/rules/` contains 11 `.mdc` files
- [ ] `memory-bank/` contains 24 `.md` files
- [ ] `AGENTS.md` at project root
- [ ] `.cursor/cache/.gitkeep` exists

---

## Phase 2 — Git ignore (do not commit secrets or cache)

Append to project `.gitignore` if missing:

```gitignore
# cursor-platform
.cursor/settings.local.json
.cursor/cache/*
!.cursor/cache/.gitkeep
```

**Verify:**
- [ ] `.gitignore` updated
- [ ] `git status` does NOT list `.cursor/settings.local.json` or `repo-map.json`

---

## Phase 3 — Customize memory-bank Tier 2 (team truth)

Replace template examples. **Do not invent** domain rules — infer from code
where possible; mark assumptions explicitly.

### 3.1 `memory-bank/projectbrief.md`
- Product: MotorsReports — insurance report generation APIs
- Users: internal systems, agent portal consumers
- Scope: PDF/RDLC policy and related documents from Oracle data

### 3.2 `memory-bank/productContext.md`
- Motor insurance reports (AR/EN templates)
- Travel policy documents (QuestPDF)
- Libya deployment context if confirmed in branch/config (e.g. `lybia-report`)

### 3.3 `memory-bank/architecture.md` (critical — match reality, not template)

Document **actual** layout:

```
Reports.sln
├── Reports/                  → Reports.Apis (main API, net8.0)
├── Reports.Agents.Apis/      → Agents API (net8.0)
├── Report.Busniess/          → MotorReports.Business
├── Report.Business/          → Report.Business (note: second business project)
└── RDLC_GEN/                 → Desktop/report tooling (net8.0-windows)
```

Rules for this repo:
- APIs reference Business projects directly (not Clean Architecture layers).
- **Do not** generate MediatR/CQRS/Domain projects unless human requests migration.
- `pattern-finder` must imitate existing controllers/services in this solution.
- Arabic report templates: `*.AR.rdlc`; English: `*.EN.rdlc`.

### 3.4 `memory-bank/technologyStack.md`
- .NET 8, ASP.NET Core Web API
- Autofac 8, JWT Bearer 8.0.6
- EF Core 8.0.4 (where used)
- QuestPDF, ReportViewerCore.NETCore 15.1.22
- Swashbuckle 6.6.1
- Oracle (`rhodes` TNS)

### 3.5 `memory-bank/databaseConventions.md`
- Provider: **Oracle** (not SQL Server)
- Connections (names only in docs — **no passwords**):
  - `OracleConnection` → `INSURANCE_ONLINE` schema (Reports.Apis)
  - `OracleConnection` / `UserOracleConnection` → Agents API
- SQL dialect: Oracle (`FETCH`, `ROWNUM`, `||`, etc.) — never `TOP` or `LIMIT`

### 3.6 `memory-bank/apiConventions.md`
- Document both APIs: `Reports.Apis`, `Reports.Agents.Apis`
- Swagger/OpenAPI via Swashbuckle
- JWT authentication pattern as implemented in `Program.cs`

### 3.7 `memory-bank/backendConventions.md`
- Autofac registration style (follow existing `Program.cs` / modules)
- Service naming in `MotorReports.Business`

### 3.8 `memory-bank/securityStandards.md`
- Non-negotiable: no connection strings with passwords in committed config
- JWT validation on protected endpoints
- Parameterized SQL only

### 3.9 `memory-bank/businessRules.md`
- List report types and any audit-required entities (ask human if unclear)
- Policy document generation rules

### 3.10 `memory-bank/glossary.md`
- AR/EN report terminology
- Insurance domain terms used in RDLC names

Delete all `> EXAMPLE —` blocks after replacement.

**Verify:**
- [ ] No placeholder `[YYYY-MM-DD]` left in Tier 2 files you edited
- [ ] `architecture.md` describes MotorsReports, not generic Clean Architecture only

---

## Phase 4 — Discovery and context sync (mandatory)

Run in order:

```
/repo-discovery full
/context-sync
```

Then:

```
/skill-maturity-audit all
```

**Verify:**
- [ ] `.cursor/cache/repo-map.json` created (gitignored)
- [ ] `memory-bank/techContext.md` lists real packages from `.csproj` files
- [ ] `memory-bank/systemPatterns.md` describes Autofac + API→Business pattern
- [ ] `memory-bank/activeContext.md` updated with project name, branch, date

Optional:

```
/architecture-map-gen dependency-graph
```

---

## Phase 5 — Security audit (flag to human; do not commit secrets)

Scan `**/appsettings*.json` for:
- Hardcoded `password=` in connection strings
- Real hostnames/IPs in committed files

**If found (expected in MotorsReports):**
1. **Flag to human** — passwords in git history may be compromised; rotate Oracle credentials.
2. Propose refactor plan (separate task):
   - Move secrets to User Secrets (dev) / environment variables (deploy)
   - Leave empty placeholders in committed `appsettings.json`
3. **Do not** paste real passwords into memory-bank or chat.

Announce: **Matched skill:** `devops-audit` — proceed after flagging.

---

## Phase 6 — Local MCP setup (human action)

Create **locally only** (never commit):

`.cursor/settings.local.json`

See `.cursor/docs/mcp-ecosystem.md`. Minimum optional env vars:
- `GITHUB_PAT` — GitHub MCP
- Oracle read-only MCP only if team provides a **read-only** connection string

---

## Phase 7 — Git commit (wait for human approval)

Suggest branch: `chore/cursor-platform`

Files to commit:
- `.cursor/` (except `settings.local.json` and `cache/*` except `.gitkeep`)
- `memory-bank/`
- `AGENTS.md`
- `.cursor/docs/APPLY-TO-PROJECT.md` (copy of this file, optional)
- `.gitignore` changes

**Do not commit without explicit human request.**

Suggested message:

```
chore: add cursor-platform (skills, rules, memory-bank)

Bootstrap agent infrastructure for MotorsReports. No application code changes.
```

---

## Phase 8 — How to work after bootstrap

### Every session
1. Read `AGENTS.md` + `memory-bank/activeContext.md`
2. `/repo-discovery quick`

### Common tasks (MotorsReports)

| Task | Skill |
|------|--------|
| New report API endpoint | `/dotnet-endpoint-gen` |
| Oracle query performance | `/dotnet-query-optimizer` |
| EF/schema consistency | `/database-audit` |
| New feature with spec | `/speckit-analyze` → `/speckit-plan` → `/speckit-implement` |
| Fix audit findings | `/refactor-apply` |
| Before release | `/enterprise-report-gen production-readiness` |

### Rules (automatic)
- **Global:** `00-memory-think`, `05-planning-rigor`, `09-minimal-changes`, `10-evidence-and-dependency-guard`
- **When `.cs` files in context:** `02`, `04`, `06`, `07` (adapt architecture rule to *documented* MotorsReports layout)
- **React rules:** N/A unless frontend added later

### Generation constraints for this repo
- Use `pattern-finder` — copy existing controller/service patterns
- No new NuGet packages without human approval
- Minimal diffs on production-deployed code
- Oracle SQL only in data access code

---

## Phase 9 — Completion report

When finished, output this checklist to the human:

| Item | Done? |
|------|-------|
| Platform files copied | |
| `.gitignore` updated | |
| Tier 2 memory-bank customized for MotorsReports | |
| `/repo-discovery full` + `/context-sync` run | |
| `repo-map.json` generated | |
| Secrets flagged (not copied to docs) | |
| `activeContext.md` updated | |
| Git commit (if approved) | |

**Next recommended human actions:**
1. Review and merge `chore/cursor-platform` branch
2. Rotate Oracle passwords if they were in committed appsettings
3. Start first task: e.g. "add endpoint for X" with `/dotnet-endpoint-gen`

---

## Troubleshooting

| Problem | Action |
|---------|--------|
| Agent invents classes | `/repo-discovery full`; read `repo-map.json` |
| Agent forces Clean Architecture | Point to `memory-bank/architecture.md` |
| Guards not firing | Open relevant `.cs` files in editor |
| Skills not announced | Follow `AGENTS.md` Step 2.5; read `skill-catalog.md` |
| Wrong workspace | Open `D:\repos\MotorsReports` in Cursor |

---

## Adapting for a different project

Replace **Target project** in Phase 0 and Phase 3 with the new repo's paths,
solution name, stack, and architecture. Keep Phases 1–2, 4, 6–9 unchanged.
