# Skill: speckit-git-feature

**Invocation:** `/speckit-git-feature [feature-slug]`

---

## Overview

`speckit-git-feature` creates the feature branch and registers the feature as
the current working context in `memory-bank/WORKING_ON.md`. It enforces two
pre-conditions before creating the branch: the spec must exist, and the working
tree must be clean. This prevents the common mistake of starting a feature branch
with uncommitted changes from a previous session on main, which leads to tangled
diffs and messy PRs. After creating the branch, all subsequent speckit skills
read `WORKING_ON.md` to know which feature, spec, and branch are active.

---

## Steps

**Step 1 — Validate spec exists.**

Check for `specs/features/[feature-slug].md`. If not found:
```
❌ Spec not found: specs/features/[feature-slug].md
Before creating a branch, the feature must be fully specified.
Run the pipeline first: /speckit-analyze → /speckit-clarify → /speckit-constitution
→ /speckit-plan → /speckit-specify
```
Abort.

**Step 2 — Validate working tree is clean.**

Run `git status --porcelain`. If any unstaged or staged changes exist:
```
❌ Working tree has uncommitted changes.
Commit or stash your changes before creating a feature branch.

Uncommitted files:
  [list of files from git status]

Options:
  git stash              — stash changes and restore them after branch creation
  git add . && git commit — commit the changes on current branch first
```
Abort.

**Step 3 — Pull latest from default branch.**

```bash
git checkout main    # or develop — detect from git config
git pull origin main
```

If pull fails (merge conflict, or no upstream): output the error and abort.

**Step 4 — Create and push the branch.**

```bash
git checkout -b feature/[feature-slug]
git push --set-upstream origin feature/[feature-slug]
```

**Step 5 — Write `memory-bank/WORKING_ON.md`.**

```markdown
# Currently Working On

**Feature:** [feature-slug]
**Display name:** [Feature display name from spec overview section]
**Spec:** specs/features/[feature-slug].md
**Plan:** specs/plans/[feature-slug]-plan.md
**Branch:** feature/[feature-slug]
**Started:** [YYYY-MM-DD]
**Estimated completion:** [date from plan estimate, if available]

## Active Task
None yet — run /speckit-implement TASK-001 to begin.

## Notes
[Any context worth carrying across sessions — blockers, decisions made today, etc.]
```

**Step 6 — Output next step.**

```
✅ Branch created: feature/[feature-slug]
   Tracking: origin/feature/[feature-slug]
   WORKING_ON.md updated.

Next step: /speckit-implement TASK-001
```

---

## Example Invocation

**Command:** `/speckit-git-feature broker-client-csv-export`

Agent checks spec exists (`specs/features/broker-client-csv-export.md` ✅),
checks working tree is clean (✅), pulls latest from main, creates
`feature/broker-client-csv-export`, pushes to origin, writes WORKING_ON.md.

---

## Output

- Git branch: `feature/[feature-slug]` created and pushed
- File: `memory-bank/WORKING_ON.md` (created or overwritten)
- Terminal: confirmation + next task suggestion
