# Dual-agent setup — Cursor + Claude Code on one platform

How this workspace now serves both agents from one set of source files, and what
each agent needs that the other does not.

---

## The problem this solves

The platform was Cursor-shaped: `AGENTS.md`, `.cursor/rules/*.mdc`,
`.cursor/skills/*/skill.md`. **Claude Code reads none of those.**

- It looks for `CLAUDE.md`, not `AGENTS.md`. (Anthropic's own guidance is
  `ln -s AGENTS.md CLAUDE.md`, which does not work well on Windows — we use the
  `@AGENTS.md` import instead.)
- It has no `.mdc` loader and no glob-scoped rule mechanism.
- It discovers skills at `.claude/skills/<name>/SKILL.md` and requires YAML
  frontmatter with `name` and `description`. The skill files had no
  frontmatter at all, so Claude Code could not see a single one.

Opening this repo in Claude Code before these changes gave you a generic coding
agent with no rules, no skills, and no memory-bank discipline.

---

## Source-of-truth map

Nothing is duplicated. Each artifact has exactly one home.

| Artifact | Lives in | Cursor reads it | Claude Code reads it |
|---|---|---|---|
| Agent contract | `AGENTS.md` | directly | via `@AGENTS.md` import in `CLAUDE.md` |
| Structural cache | `.cursor/cache/repo-map.json` | both — owned by `/repo-discovery` | both |
| Behavioural cache | `.cursor/cache/feature-map.json` | both — owned by `/feature-trace`, written via `.cursor/tools/feature-map.mjs` | both |
| Skill instructions | `.cursor/skills/<n>/skill.md` | directly | via shim at `.claude/skills/<n>/SKILL.md` |
| Guard rules | `.cursor/rules/*.mdc` | auto, glob-scoped | on demand — routing table in `CLAUDE.md` + every shim |
| Memory-bank | `memory-bank/` | rule `00` instructs it to read | `SessionStart` hook injects a digest |
| MCP servers | `.mcp.json` (committed) | mirrored in `.cursor/settings.local.json` | directly |

**The rule: edit `.cursor/`, never `.claude/skills/`.** After adding, renaming,
or deleting a skill:

```bash
node .claude/hooks/sync-skills.mjs
```

That regenerates all shims and deletes orphans. CI fails the PR if you forget
(the `platform` job in `templates/ci/quality-gates.yml`).

---

## Enforcement runs on both hosts

This section used to be titled "what Claude Code gets that Cursor does not", and
listed subagents and hooks. That is no longer true: Cursor supports agents,
skills, rules, commands, hooks and MCP natively, so the platform now wires the
**same scripts** into both.

| | Cursor | Claude Code |
|---|---|---|
| Contract | `AGENTS.md` | `CLAUDE.md` (imports `AGENTS.md`) |
| Rules | `.cursor/rules/*.mdc`, auto-applied by glob | restated in `CLAUDE.md` + injected at session start |
| Skills | `.cursor/skills/<n>/skill.md` — **the source** | `.claude/skills/<n>/SKILL.md` shims |
| Subagents | `.claude/agents/*.md` | same files |
| Hook wiring | `.cursor/hooks.json` | `.claude/settings.json` |
| Hook scripts | `.claude/hooks/*.mjs` | **the same files** |
| MCP | `.cursor/settings.local.json` | `.mcp.json` |

The scripts are host-agnostic because `_lib.mjs` normalises what the two hosts
disagree about — where the file path sits in the payload, where the shell command
sits, how a hook says "deny", how it injects context, and how it learns the
workspace root. A guard expresses a rule and never branches on which editor is
running it. Two copies of a rule, one per host, is how one of them silently stops
being enforced.

One mapping is genuinely better on Cursor: shell commands go through
`beforeShellExecution`, a purpose-built event that fires only for shell, carries
the command at the top level, and can answer `ask` as well as `deny`. Claude Code
has to route the same guard through a `Bash` matcher on `PreToolUse`.

### 1. Subagents (`.claude/agents/`)

Fourteen read-only specialists that run in **their own context window** and return
only findings:

| Agent | Purpose |
|---|---|
| `feature-analyst` | "How does X work?" / "What breaks if I change X?" — end-to-end tracing and blast radius |
| `ops-reviewer` | "Is this ready to ship?" — production readiness, SLO/alert derivation, rollout safety |
| `pattern-scout` | Step 0 of every `*-gen` skill — finds the canonical local example |
| `repo-cartographer` | Structural discovery / `context-sync` refreshes |
| `dotnet-auditor` | .NET sweeps (layers, async, money, N+1) |
| `react-auditor` | React/TS sweeps (architecture, perf, a11y, RTL) |
| `security-auditor` | Secrets, injection, authZ/IDOR, supply chain |
| `db-auditor` | Schema, migrations, provider dialects, query plans |

This is the single biggest practical win on a large repo. `/database-audit` on a
40-project solution reads a *lot* of files; run it inline and the main
conversation is full before you get to the fix. Delegated, the main thread sees
a 60-line report and still has room to act on it. The same applies doubly to
`feature-analyst`: a genuine end-to-end trace reads 30-50 files across every
layer, and the answer is 100 lines.

They are readers by convention, not a sandbox. The `tools:` list is what the
host is asked to offer; it is not enforced on every editor. Generation stays in
the main thread where the guard rules and hooks apply.

### 2. Hooks (`.claude/hooks/`) — enforcement that does not depend on the model

Event names below are Claude Code's. The Cursor column shows where the same
script attaches; the wiring lives in `.cursor/hooks.json`.

| Hook | Claude Code | Cursor | What it does |
|---|---|---|---|
| `session-start.mjs` | `SessionStart` | `sessionStart` | memory + lifecycle phase injection |
| `guard-write.mjs` | `PreToolUse` Write/Edit | `preToolUse` | machine-owned files, secrets, Tier 2 |
| `guard-phase.mjs` | `PreToolUse` Write/Edit | `preToolUse` | no source before the design gate |
| `guard-bash.mjs` | `PreToolUse` Bash | `beforeShellExecution` | package installs, live-DB, force-push |
| `guard-mcp.mjs` | `PreToolUse` `mcp__.*` | `beforeMCPExecution` | MCP policy: read-only servers, deny lists, SQL verbs, phase coupling |
| `post-edit-verify.mjs` | `PostToolUse` Write/Edit | `afterFileEdit` | tripwires on the file just written |
| `stop-memory-check.mjs` | `Stop` | `stop` | source changed, `activeContext.md` did not |

> `stop` differs by more than a name. Claude Code lets a Stop hook surface an
> advisory by exiting 2; Cursor's only output there is `followup_message`, which
> auto-submits a new user turn. Hijacking someone's session to deliver a reminder
> is worse than the reminder being missed, so on Cursor that hook stays advisory
> on stderr.

| Hook | Event | What it does |
|---|---|---|
| `session-start.mjs` | `SessionStart` | Injects memory-bank Tier 1 digest, `repo-map.json` freshness, and feature-map coverage. **Rule `00` becomes automatic** rather than a request the model may skip. |
| `guard-write.mjs` | `PreToolUse` Write/Edit | Blocks hand-edits to `repo-map.json` and `feature-map.json`, writes to `.env`/secrets files, edits to Tier 2 memory-bank, and hardcoded credentials in content. |
| `guard-bash.mjs` | `PreToolUse` Bash | Blocks `dotnet add package`, `npm install <pkg>`, `dotnet ef database update`, force-push, `git reset --hard`, `DROP TABLE`. |
| `post-edit-verify.mjs` | `PostToolUse` Write/Edit | Fast tripwires on the file just written — money as `double`, `DateTime.Now`, sync-over-async, interpolated SQL, `fetch` in a component, token in `localStorage`, physical CSS. Optional `dotnet format` / `eslint --fix`. |
| `stop-memory-check.mjs` | `Stop` | Blocks the stop once if source changed but `activeContext.md` did not. |
| `sync-skills.mjs` | manual | Regenerates the skill shims. |

`session-start.mjs` also reports feature-map coverage and names any traced
feature that went stale, and `guard-write.mjs` blocks hand-edits to
`feature-map.json` — its freshness depends on content hashes the tool stamps, so
an edit by hand silently breaks staleness detection for every feature.

Plain Node, no dependencies, cross-platform. Enable the slower checks with:

```bash
CLAUDE_HOOK_DOTNET_FORMAT=1   # dotnet format on touched .cs files
CLAUDE_HOOK_ESLINT=1          # eslint --fix on touched .ts/.tsx files
```

If a hook path does not resolve on your machine, switch the commands in
`.claude/settings.json` to `node "$CLAUDE_PROJECT_DIR/.claude/hooks/<file>.mjs"`.

The scripts still live under `.claude/hooks/` even though they are no longer
Claude-only. Renaming that folder means touching `settings.json`,
`.cursor/hooks.json`, `build-plugin.mjs`, every doc and the generated plugin tree
— and then moving them a second time when the `core/` + `adapters/` split
happens. It is deliberately left for that change.

---

## What each tool is actually better at

Not interchangeable. Worth splitting work deliberately:

| Task | Better in | Why |
|---|---|---|
| Multi-file refactor across 20+ files | **Claude Code** | Subagent delegation; no editor context ceiling |
| Long audits (`/database-audit`, `/compliance-audit`) | **Claude Code** | Isolated context; findings come back distilled |
| Anything needing deterministic enforcement | **Claude Code** | Hooks. Cursor has no equivalent. |
| Tight edit loops on a file you are reading | **Cursor** | Inline diffs, Tab completion, instant apply |
| Rule discovery by file type | **Cursor** | `.mdc` globs load automatically; Claude needs the routing table |
| CI / scripted / headless runs | **Claude Code** | `claude -p` in a pipeline |
| Reviewing a diff before commit | **Cursor** | Native diff UI |

Both read the same `memory-bank/`, so switching mid-feature loses nothing.

---

## First run

```bash
# 1. Verify Claude Code sees the platform
claude
> /skills            # should list 77
> /agents            # should list 8

# 2. Confirm the SessionStart hook fired — the first response should already
#    know what memory-bank/activeContext.md says without reading it.

# 3. On a target application repo
> /repo-discovery full
> /context-sync
> /skill-maturity-audit all

# 4. On an INHERITED codebase, map behaviour before touching anything
> /feature-inventory full
> /feature-trace "<the capability that scares you most>"
> /impact-analysis "<the change you were about to make>"

# 5. Before marking any task Done
> /task-verify T-01              # runs the verify cmd + AC coverage + test quality

# 6. Before anything reaches production
> /threat-model "<the design>"
> /operability-gen "<feature>"
> /production-readiness-review "<scope>"
> /delivery-metrics --trend      # is the platform helping, or just faster?
```

If `/skills` shows nothing, run `node .claude/hooks/sync-skills.mjs` and restart.

---

## Known rough edges

- **98 skills is a lot.** Each description costs ~100 tokens of always-on
  context at startup — roughly 7k tokens before you type anything. That is
  affordable but not free, and routing accuracy drops as near-duplicate
  descriptions accumulate. `/skill-maturity-audit all` will show you the
  overlaps; consolidating the `*-audit` family into fewer, argument-driven
  skills is the obvious next trim.
- **Auto-extracted descriptions.** `sync-skills.mjs` pulls the description from
  each skill's Overview paragraph. Nine were hand-written because extraction
  produced rationale text instead of a description. Re-read any that look odd —
  **description quality is the entire routing mechanism.**
- **Rule loading is manual in Claude Code.** The routing table in `CLAUDE.md`
  and in every shim tells the agent which `.mdc` to read for which file type,
  but it is an instruction, not a loader. This is exactly why the hooks and the
  build gates in `templates/` exist: the important half of each rule is enforced
  mechanically, so a missed read is caught rather than shipped.
