# flutter-platform

A lean, dual-agent (Cursor + Claude Code) agent-config platform for
Flutter/Dart mobile development — a sibling to the `.NET` + React
`cursor-platform` at the repo root, same architecture and discipline,
different stack. General-purpose mobile app development, not a
regulated-industry/compliance-framework platform.

## Inventory

| Layer | Count | Location |
|---|---|---|
| Skills | 19 | `.cursor/skills/<name>/skill.md` (canonical), `.claude/skills/<name>/SKILL.md` (generated shims) |
| Rules | 8 (4 always-on + 4 glob-scoped) | `.cursor/rules/*.mdc` |
| Subagents | 4 | `.claude/agents/*.md` |
| Hooks | 2 wired (`SessionStart`, `PreToolUse`) via 4 `.mjs` files | `.claude/hooks/` |

Skill breakdown (19): 8 generators, 4 auditors, 3 feature-analysis/planning,
2 outer-loop (release/readiness), 2 bootstrap. Full list in
[`.cursor/docs/skill-catalog.md`](.cursor/docs/skill-catalog.md).

State management: **Riverpod** is the assumed default across every
generator (`Notifier`/`AsyncNotifier`, `riverpod_generator`/`@riverpod`
style where the target repo has already adopted codegen).

## Quick start

1. Point Cursor or Claude Code at this folder (or copy it into a Flutter
   repo's root — see "Using in another project" below).
2. Run `/repo-discovery` to scan the target Flutter codebase.
3. Run `/context-sync` to populate `memory-bank/techContext.md`,
   `progress.md`, `activeContext.md` from that scan.
4. Fill in the Tier 2 memory-bank files (`architecture.md`,
   `domainRules.md`, `securityStandards.md`) with your team's actual
   conventions — they ship with `> EXAMPLE —` placeholder blocks, not real
   defaults.
5. Start generating: `/flutter-screen-gen`, `/flutter-provider-gen`, etc.
   See [`.cursor/docs/START-HERE.md`](.cursor/docs/START-HERE.md) for the
   full task → skill map.

## Structure

```
flutter-platform/
  AGENTS.md              # shared contract (Cursor + Claude Code both read this)
  CLAUDE.md               # imports AGENTS.md, adds Claude-only wiring
  README.md               # this file
  .mcp.json               # documented-empty; no mature Flutter-specific MCP server exists yet
  .cursor/
    rules/                # 8 .mdc guard rules (4 always-on, 4 glob-scoped)
    skills/<name>/skill.md  # 19 skills, canonical source for both agents
    docs/
      START-HERE.md        # task -> skill quick map
      skill-catalog.md     # full catalog
  .claude/
    skills/<name>/SKILL.md  # generated shims -> point back at .cursor/skills
    skills/_descriptions.json  # hand-written description overrides
    agents/                # 4 read-only subagents
    hooks/                 # sync-skills.mjs, session-start.mjs, guard-write.mjs, _lib.mjs
    settings.json           # wires the hooks above
  memory-bank/
    README.md              # two-tier pattern explained
    techContext.md, progress.md, activeContext.md   # Tier 1 (dynamic)
    architecture.md, domainRules.md, securityStandards.md  # Tier 2 (standards)
```

## Dual-agent architecture

Cursor reads `.cursor/skills/<name>/skill.md` directly. Claude Code reads
`.claude/skills/<name>/SKILL.md` — thin shims that point back at the
`.cursor` source. **Never fork skill content into the shim** — edit the
`.cursor` copy and regenerate:

```bash
node .claude/hooks/sync-skills.mjs
```

The same applies to rules (`.cursor/rules/*.mdc` is authoritative; `CLAUDE.md`
restates the always-on ones since Claude Code has no glob-scoped rule
loader) and agents (subagents are Claude Code-only context isolation —
Cursor doesn't need an equivalent since it doesn't have the same context-
window pressure from a single long-running session).

## Using this in another Flutter repo

This is a first-cut, copy-the-directories setup — no plugin/marketplace
packaging yet (that's a stretch goal, not required for v1):

1. Copy `AGENTS.md`, `CLAUDE.md`, `.cursor/`, `.claude/`, `memory-bank/`
   from this folder into the target repo's root.
2. Run `/repo-discovery` then `/context-sync` in the target repo — do not
   reuse this platform's own (empty) memory-bank starter files as if they
   describe the target app.
3. Fill in the three Tier 2 files with the target repo's real conventions.

## What's deliberately not included

- No SAMA/ZATCA/audit-trail-style compliance content — this is a
  general-purpose platform. Standard mobile security hygiene (secrets,
  `flutter_secure_storage`, pinning) is in scope; a regulated-industry
  compliance framework is not.
- No `task-graph.mjs`/`feature-map.mjs` tooling layer like the sibling
  `cursor-platform` — `work-breakdown`'s sizing rules (≤8 files, ≤2 layers
  per task) are enforced by the agent directly against a checklist rather
  than a separate validator script, to keep this platform lean.
- No fictitious Flutter-specific MCP server in `.mcp.json` — see that file
  for what's honestly available instead.
