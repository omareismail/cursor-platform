# Skill: speckit-git-remote

**Invocation:** `/speckit-git-remote`

---

## Overview

`speckit-git-remote` pushes the feature branch and generates a complete `gh pr create`
command with a PR body auto-generated from the feature spec. The PR body includes
the feature overview, the acceptance criteria checklist, a link to the spec file,
and the spec compliance checklist from the PR template — so reviewers have full
context without having to hunt for the spec. It also prompts the developer to update
`memory-bank/progress.md` and clean up `WORKING_ON.md` after the PR is merged.

---

## Steps

**Step 1 — Pre-condition check.**

Verify `speckit-git-validate` has passed in this session. If not:
```
❌ Run /speckit-git-validate first. All steps must pass before pushing.
```
Abort.

**Step 2 — Push the branch.**

```bash
git push origin feature/[feature-slug] --set-upstream
```

**Step 3 — Read the spec.**

Read `specs/features/[feature-slug].md` to extract:
- Overview paragraph
- Acceptance criteria list
- Security considerations

**Step 4 — Generate the `gh pr create` command.**

```bash
gh pr create \
  --title "feat([scope]): [Feature display name from spec]" \
  --body "## Summary

[Overview paragraph from spec]

## Spec Reference

- **Feature:** [Feature Name]
- **Spec:** [specs/features/[feature-slug].md](specs/features/[feature-slug].md)
- **Plan variant:** Plan [X]
- **Clarifications:** [specs/clarifications/[feature-slug].md](specs/clarifications/[feature-slug].md)

## Acceptance Criteria

- [ ] AC-1: [criterion text]
- [ ] AC-2: [criterion text]
- [ ] AC-3: [criterion text]
[... all criteria from spec]

## Security Considerations

[Security section from spec]

## Checklist

- [ ] speckit-checklist passed with zero failures
- [ ] All AC have a corresponding test (// AC-N comment)
- [ ] No TODO/FIXME in changed files
- [ ] No hardcoded secrets
- [ ] .NET: dotnet build → 0 warnings; all test suites pass
- [ ] React: tsc --noEmit → 0 errors; eslint → 0 errors; all tests pass" \
  --base main \
  --draft
```

**Step 5 — Post-merge reminders.**

Output the following reminders (not automated — developer takes these actions after merge):

```
After your PR is merged:

1. Update memory-bank/progress.md:
   Mark all feature tasks ✅ Done
   Set feature status to: ✅ Shipped

2. Delete WORKING_ON.md:
   rm memory-bank/WORKING_ON.md

3. Run /speckit-retro [feature-slug] to capture lessons learned.

4. Delete the feature branch (if not auto-deleted by GitHub):
   git branch -d feature/[feature-slug]
   git push origin --delete feature/[feature-slug]
```

---

## Example Invocation

**Scenario:** `broker-client-csv-export` validated. Developer runs `/speckit-git-remote`.

Agent pushes the branch, reads the spec (7 ACs), generates the `gh pr create`
command with the full spec-sourced PR body. Reminds developer to request reviewers.

---

## Output

- Git: branch pushed (or updated if already pushed)
- Terminal: complete `gh pr create` command (copy-paste ready)
- Terminal: post-merge cleanup reminders
