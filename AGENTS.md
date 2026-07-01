# Agent instructions

You work in a **cursor-platform** workspace: 66 skills, guard rules, and a
memory-bank. Follow this file before generating or changing code.

## Session start (mandatory)

1. Read `memory-bank/activeContext.md`, `progress.md`, `techContext.md`,
   `systemPatterns.md` (in that order; stop once you have enough context).
2. If Tier 1 files are empty or still placeholders → run `/context-sync`
   (after `/repo-discovery full` if `repo-map.json` is missing).
3. If unsure whether the structural map is current → `/repo-discovery quick`.
4. When routing a request to a skill → read `.cursor/docs/skill-catalog.md`
   (full catalog) or `.cursor/docs/START-HERE.md` (quick task map).

## How to work

| Situation | Action |
|-----------|--------|
| User asks to build or generate | Match a skill in `skill-catalog.md`; announce; wait if Category A or E |
| User asks to audit or review | Category B skill → announce, then proceed |
| Multi-file or cross-cutting task | `/context-builder [task description]` before editing |
| New endpoint, component, handler | Use the matching `*-gen` skill — `pattern-finder` runs first |
| Plan or architecture decision | `/speckit-analyze` → clarify → plan; options with tradeoffs required |
| Fix findings from an audit | `/refactor-apply` — do not blindly re-run guards |

**Announcement format (required for every matched skill except Category D):**

> **Matched skill:** `skill-name` — [one-line description].

Category A/E: announce, then wait for go-ahead. Category B/C: announce, then
proceed. Category D (`repo-discovery`, `context-builder`, `context-sync`,
`pattern-finder`): run silently.

## Rules (`.cursor/rules/` — you do not invoke these)

**Always active (every session):** `00-memory-think`, `05-planning-rigor`,
`09-minimal-changes`, `10-evidence-and-dependency-guard`.

**Active when matching files are in context (globs):** `01-specify-rules`,
`02-dotnet-architecture-guard`, `03-react-architecture-guard`,
`04-security-guard`, `06-database-provider-guard`, `07-audit-trail-guard`,
`08-rtl-i18n-guard`.

Non-negotiables:

- Confirm classes, interfaces, tables, packages, and config keys exist before
  referencing them. No new NuGet/npm packages unless already in the repo or
  explicitly requested.
- Only change what the task requires — no unrelated reformatting or scope creep.
- **.NET:** Clean Architecture — handlers never use `DbContext` directly.
- **React:** No `fetch` in components; API layer + React Query.
- **Security:** No secrets in source; no JWT in `localStorage`; parameterized SQL.
- **Financial/policy mutations:** Audit who/when/what-changed; use `decimal` for money.
- **Arabic/RTL UI:** Logical CSS properties; locale-aware number/date formatting.
- **Multi-DB:** One `DbContext` per data source; correct SQL dialect per provider.

## Memory-bank

| Layer | Location | Owner |
|-------|----------|-------|
| Machine | `.cursor/cache/repo-map.json` | `/repo-discovery` — never hand-edit |
| Tier 1 (dynamic) | `memory-bank/techContext.md`, `progress.md`, … | `/context-sync` |
| Tier 2 (standards) | `architecture.md`, `businessRules.md`, … | Team — ask if undocumented |

## After significant work

Update `memory-bank/activeContext.md` and `memory-bank/progress.md` with what
changed and the next logical step.

## More detail

- [START-HERE.md](.cursor/docs/START-HERE.md) — task → skill map
- [skill-catalog.md](.cursor/docs/skill-catalog.md) — all 66 skills
- [NEW-PROJECT.md](.cursor/docs/NEW-PROJECT.md) — bootstrap a new repo with this platform
- [APPLY-TO-PROJECT.md](.cursor/docs/APPLY-TO-PROJECT.md) — bootstrap an existing repo (agent-run playbook)
