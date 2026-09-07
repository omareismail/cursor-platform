# Skill: context-sync

**Invocation:** `/context-sync`

**Category:** Housekeeping — runs silently, no announcement.

---

## Overview

`context-sync` populates and refreshes the memory-bank's Tier 1 files
(`techContext.md`, `progress.md`, `activeContext.md`) from
`.cursor/cache/repo-map.json` and the current git state. It does not touch
Tier 2 (`architecture.md`, `domainRules.md`, `securityStandards.md`) —
those are human-authored and only read, never overwritten by automation.

**Memory references:** writes Tier 1; reads Tier 2 only to avoid
contradicting it (if `architecture.md` states a convention that
`repo-map.json` contradicts, flag the conflict instead of silently
overwriting either).

**Guard rules:** none directly — this is what keeps `00-memory-think.mdc`
enforceable by having current Tier 1 content to read.

---

## Steps

**Step 1 — Ensure `repo-map.json` is fresh.** If missing or stale (see
`repo-discovery` Step 7), run `/repo-discovery` first.

**Step 2 — Write `memory-bank/techContext.md`.**

```markdown
# Tech Context

**Last Updated:** 2026-08-08

- Flutter/Dart SDK: >=3.3.0 <4.0.0
- State management: flutter_riverpod, riverpod_generator (@riverpod codegen), AsyncNotifier is the dominant pattern
- Routing: go_router, ShellRoute in use for bottom-nav
- Models: freezed + json_serializable
- HTTP client: dio
- Secure storage: flutter_secure_storage (used for auth tokens)
- Testing: mocktail, ProviderScope overrides used consistently; no integration_test yet
```

**Step 3 — Write/update `memory-bank/progress.md`.** Cross-reference
`repo-map.json`'s `features` list against git branch names and any
existing task-board content — mark features with no open branch/task as
presumed Done, features with an active branch as In Progress. Never
downgrade a task a human previously marked Done based on automated
inference alone — flag a conflict instead of overwriting.

**Step 4 — Write/update `memory-bank/activeContext.md`.** Summarize: what
branch is checked out, what the most recent commits touched (`git log
--oneline -10`), and — if this is the first sync — a note that this is the
initial population and needs human review.

**Step 5 — Flag Tier 2 gaps.** If `memory-bank/architecture.md`,
`domainRules.md`, or `securityStandards.md` are still the starter
placeholder content (see `memory-bank/README.md`), report this explicitly
— Tier 2 is not auto-populated, and skills reading it will fall back to
"ask the team" per `10-evidence-and-dependency-guard.mdc` until someone
fills it in.

---

## Example

Request: "Set up the memory-bank for this repo." → Runs `/repo-discovery`
if needed, writes `techContext.md`/`progress.md`/`activeContext.md` from
the scan, and reports which Tier 2 files still need a human pass.
