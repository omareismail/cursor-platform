# Skill: speckit-git-initialize

**Invocation:** `/speckit-git-initialize`

---

## Overview

`speckit-git-initialize` sets up the full git workflow infrastructure for a new
project in a single run. It creates the commit-msg hook that enforces Conventional
Commits format, the PR template that auto-links to specs, and documents the branch
naming conventions used by the rest of the speckit pipeline. These artifacts are
written to disk — not just described — so the workflow is immediately active after
running this skill. It is designed to be idempotent: re-running it updates existing
files rather than failing.

---

## Steps

**Step 1 — Create `.git/hooks/commit-msg`.**

```bash
#!/bin/sh
# speckit commit-msg hook — enforces Conventional Commits format
# Valid types: feat|fix|refactor|test|docs|chore|perf|ci|style|build
# Valid scopes (examples — add project-specific scopes below):
#   .NET:  domain|application|infrastructure|api|tests|migrations|ci|docker
#   React: components|hooks|pages|api|store|styles|tests|config
#   Shared: ci|docs|deps|security

COMMIT_MSG_FILE=$1
COMMIT_MSG=$(cat "$COMMIT_MSG_FILE")

# Skip merge commits, revert commits, and fixup commits
if echo "$COMMIT_MSG" | grep -qE "^(Merge|Revert|fixup!)"; then
  exit 0
fi

PATTERN="^(feat|fix|refactor|test|docs|chore|perf|ci|style|build)(\([a-z0-9,/-]+\))?(!)?: .{1,72}"

if ! echo "$COMMIT_MSG" | grep -qE "$PATTERN"; then
  echo ""
  echo "❌ Commit message does not follow Conventional Commits format."
  echo ""
  echo "Required format: type(scope): description"
  echo "  Example: feat(application): add broker client export handler"
  echo "  Example: fix(api): correct authorization policy on export endpoint"
  echo "  Example: test(infrastructure): add integration tests for export repo"
  echo ""
  echo "Valid types: feat | fix | refactor | test | docs | chore | perf | ci | style | build"
  echo "Max description length: 72 characters"
  echo ""
  exit 1
fi

exit 0
```

**Step 2 — Make the hook executable.**

```bash
chmod +x .git/hooks/commit-msg
```

**Step 3 — Create `.github/PULL_REQUEST_TEMPLATE.md`.**

```markdown
## Summary

[What does this PR do? One paragraph.]

## Spec Reference

**Feature:** [feature name]
**Spec:** [specs/features/feature-slug.md](../specs/features/feature-slug.md)
**Plan variant:** Plan [A/B/C]

## Changes

- [ ] [Key change 1]
- [ ] [Key change 2]

## Spec Compliance Checklist

- [ ] All acceptance criteria have a corresponding test (AC-N comment in test file)
- [ ] speckit-checklist passed with zero failures
- [ ] No TODO/FIXME in changed files
- [ ] No hardcoded secrets
- [ ] Architecture rules verified (no layer boundary violations)
- [ ] `.NET`: `dotnet build` → zero warnings; all test suites pass
- [ ] `React`: `tsc --noEmit` → zero errors; `eslint` → zero errors; all tests pass

## Notes for Reviewers

[Anything the reviewer should pay special attention to. Complex logic, performance
trade-offs, known limitations, follow-up tasks deferred to tech debt.]

## Related Issues

Closes #[issue-number]
```

**Step 4 — Create `.gitconfig-project` (branch naming conventions).**

```ini
[branch]
  # Branch naming conventions enforced by speckit-git-feature:
  # Features:  feature/[kebab-slug]
  # Bug fixes: fix/[issue-id]-[slug]
  # Chores:    chore/[slug]
  # Releases:  release/[semver]
  # Hotfixes:  hotfix/[slug]
```

**Step 5 — Create `CONTRIBUTING.md` git workflow section** (or append if file exists).

Append under a `## Git Workflow` heading:
```markdown
## Git Workflow

### Branch Naming
| Type | Format | Example |
|------|--------|---------|
| Feature | `feature/[kebab-slug]` | `feature/broker-client-csv-export` |
| Bug fix | `fix/[issue-id]-[slug]` | `fix/47-export-missing-header` |
| Chore | `chore/[slug]` | `chore/upgrade-ef-core-9` |
| Release | `release/[semver]` | `release/1.4.0` |
| Hotfix | `hotfix/[slug]` | `hotfix/payment-null-ref` |

### Commit Message Format
Follows [Conventional Commits](https://www.conventionalcommits.org/).
Enforced by `.git/hooks/commit-msg`.

`type(scope): description`

**Types:** feat | fix | refactor | test | docs | chore | perf | ci | style | build

**Scopes (.NET):** domain | application | infrastructure | api | tests | migrations | ci | docker

**Scopes (React):** components | hooks | pages | api | store | styles | tests | config

**Scopes (Shared):** ci | docs | deps | security

### Speckit Pipeline
All features follow: analyze → clarify → constitution → plan → specify → implement → checklist → commit
See `.cursor/rules/01-specify-rules.mdc` for the full pipeline documentation.
```

---

## Example Invocation

**Scenario:** New project `orient-portal` has been cloned. Developer runs `/speckit-git-initialize`.

Agent creates:
- `.git/hooks/commit-msg` (executable)
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.gitconfig-project`
- Appends `## Git Workflow` section to `CONTRIBUTING.md`

Output:
```
✅ Git workflow initialized:
  .git/hooks/commit-msg — Conventional Commits validation (executable)
  .github/PULL_REQUEST_TEMPLATE.md — spec-linked PR template
  .gitconfig-project — branch naming reference
  CONTRIBUTING.md — ## Git Workflow section added

Test the hook: try committing with message "bad message" — it should be rejected.
```

---

## Output

- File: `.git/hooks/commit-msg` (executable)
- File: `.github/PULL_REQUEST_TEMPLATE.md`
- File: `.gitconfig-project`
- Edit: `CONTRIBUTING.md` (appended, never overwritten)
