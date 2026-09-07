# CLAUDE.md

Claude Code entry point for the **flutter-platform** workspace.

Claude Code does not read `AGENTS.md`, `.cursor/rules/*.mdc`, or
`.cursor/skills/*/skill.md`. This file bridges that gap: it imports the shared
contract and adds the Claude-only wiring (skills, subagents, hooks).

**The shared contract is imported below — read it as if it were inline:**

@AGENTS.md

---

## Claude-specific layer

| Concern | Cursor | Claude Code |
|---|---|---|
| Contract | `AGENTS.md` | `CLAUDE.md` (imports `AGENTS.md`) |
| Skills | `.cursor/skills/<name>/skill.md` | `.claude/skills/<name>/SKILL.md` (shim → same file) |
| Rules | `.cursor/rules/*.mdc` (auto-glob) | **§ Always-on rules** below + per-skill table |
| Context isolation | — | `.claude/agents/*.md` subagents |
| Enforcement | prose only | `.claude/hooks/*.mjs` (deterministic) |
| MCP | — | `.mcp.json` (documented-empty, see file) |

`.claude/skills/` contains **shims only**. Every skill file says "read
`.cursor/skills/<name>/skill.md`". Never fork the content — edit the `.cursor`
copy and both agents stay in sync. If you add a skill, run
`node .claude/hooks/sync-skills.mjs` to regenerate the shim.

---

## Always-on rules (Cursor's `alwaysApply: true` set)

Claude Code has no glob-scoped rule loader, so the four global rules are
restated here. **The `.mdc` files remain authoritative** — read the full file
before any non-trivial application.

**`00-memory-think`** — Before generating code, writing specs, running a
skill, or answering any non-trivial question: read
`memory-bank/activeContext.md`, `progress.md`, `techContext.md`,
`architecture.md`. Never re-implement something `progress.md` marks Done.

**`05-planning-rigor`** — No plan or task board without an elicitation pass
first. Present options with explicit tradeoffs; never a single option
presented as the only one.

**`09-minimal-changes`** — Change only what the task requires. No unrelated
`dart format` sweeps, no drive-by refactors, no scope creep. Minimise the diff.

**`10-evidence-and-dependency-guard`** — Confirm classes, providers, routes,
and `pubspec.yaml` dependencies **exist** before referencing them (grep
first). Never add a pub.dev package that is not already in `pubspec.yaml`
unless the user explicitly asked. The `PreToolUse` Bash hook (if wired in the
target repo) blocks `flutter pub add` — that block is a signal to stop and
ask, not to find a workaround.

### Glob-scoped rules — read on demand

| If you are touching | Read before generating |
|---|---|
| `**/*.dart` (widgets, screens, features) | `.cursor/rules/01-flutter-architecture-guard.mdc` |
| `**/*.dart` (providers, notifiers, state) | `.cursor/rules/02-flutter-state-guard.mdc` |
| any source or config file | `.cursor/rules/03-flutter-security-guard.mdc` |
| `**/*_test.dart` | `.cursor/rules/04-flutter-test-guard.mdc` |

---

## Subagents — use them, they protect the context window

`.claude/agents/` holds read-only specialists. Delegating to them keeps
widget trees, provider graphs, and generated boilerplate **out of the main
conversation** — only the findings come back.

| Subagent | Delegate when |
|---|---|
| `flutter-auditor` | Architecture, state-management, or performance review spanning more than ~5 files. |
| `pattern-scout` | Before any `flutter-*-gen` skill — finds the canonical local example (widget, provider, repository, test) to imitate. |
| `repo-cartographer` | Structural mapping / `repo-discovery` / `context-sync` refreshes. |
| `mobile-security-auditor` | Secrets, secure storage, platform-channel, and permission review. |

Do **not** delegate file-writing work — subagents here are read-only by
design. Generation stays in the main thread where the guard rules apply.

---

## Understanding existing code before changing it

| Question | Skill |
|---|---|
| How does this screen/flow work today? | `/feature-trace "<name>"` |
| What breaks if I change this? | `/impact-analysis "<change>"` |

## Breaking work into tasks

| Situation | Skill |
|---|---|
| Work is too big for one sitting | `/work-breakdown [source]` |

## Shipping and running it

| Question | Skill |
|---|---|
| Is this ready to ship? | `/production-readiness-review` |
| How does this reach users without a big-bang? | `/release-safety` |

---

## Hooks — what is enforced mechanically

`.claude/settings.json` wires:

| Event | Effect |
|---|---|
| `SessionStart` | Runs `session-start.mjs` — prints a memory-bank digest so rule `00` becomes automatic. |
| `PreToolUse` (Write/Edit) | `guard-write.mjs` blocks hand-edits to `.cursor/cache/repo-map.json` and to generated `.claude/skills/*/SKILL.md` shims. |
| — | No `dotnet format`/`eslint --fix` equivalent is wired yet — if you add `dart format` or `flutter analyze` auto-fix on save, document it here. |

If a hook blocks you, **stop and tell the user why**. Do not route around it
with a different tool.

---

## Using this platform in another Flutter repo

Copy `flutter-platform/` (or its `.cursor/`, `.claude/`, `AGENTS.md`,
`CLAUDE.md`, and `memory-bank/` contents) into the target repo's root. Run
`/repo-discovery` then `/context-sync` to populate the memory-bank from the
real codebase before generating anything. See `README.md` for the full
quick-start.
