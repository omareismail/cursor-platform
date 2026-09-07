# Skill: deployment-pipeline-gen

**Invocation:** `/deployment-pipeline-gen [ci | cd | both]`

---

## Overview

`deployment-pipeline-gen` generates the CI/CD workflows that make the platform's
guard rules hold outside the editor — build, test, security scan, the lifecycle
gate check, container build, and a staged deploy. It is the counterpart to
`/devops-audit`, which reviews pipelines that already exist. The reason it
belongs in the lifecycle at all is that every rule enforced only at generation
time is enforced only for code an agent generated: a human commit, or an agent
running with an override, bypasses the lot. A pipeline check applies to all of
them.

---

## Steps

**Step 1 — Read what already exists.**

`.github/workflows/`, `azure-pipelines.yml`, `templates/ci/`, and
`memory-bank/deploymentNotes.md`. Extend what is there rather than replacing it —
`09-minimal-changes` applies to pipelines too, and a replaced workflow loses
whatever undocumented reason someone had for a step.

**Step 2 — Read the design.**

`docs/design/architecture.md` (runtime target, scaling), `database-design.md`
(migration strategy), `docs/product/nfr.md` (availability, residency),
`docs/testing/strategy.md` (which suites run pre-merge vs nightly).

**Step 3 — Generate the CI workflow.**

Stages, in this order, failing fast:

| Stage | Does |
|---|---|
| Restore and build | Warnings as errors where the analyzers in `templates/` are installed |
| Unit and integration | With coverage; enforce the strategy's floor |
| Architecture tests | The convention tests from `templates/` — layer boundaries as a failing build |
| Lint and format | `dotnet format --verify-no-changes`, ESLint with the boundary rules |
| Dependency scan | Vulnerable and deprecated packages |
| Secret scan | On the diff and on history |
| Docs and platform | `node .cursor/tools/docs-lint.mjs check`, `node .cursor/tools/flag-debt.mjs scan` |
| Lifecycle gate | `node .cursor/tools/lifecycle.mjs check` for the current phase |

**Step 4 — Generate the CD workflow, staged.**

Build once, promote the same artifact. Never rebuild per environment — a rebuild
is a different artifact however identical the inputs claim to be.

Migrations run as their own step with its own approval, never as application
startup. Include the rollback path from `/release-safety`, and gate production
on a manual approval with named approvers.

**Step 5 — Handle secrets correctly.**

Reference them; never emit one. `guard-write.mjs` blocks a hardcoded credential
in generated content and it is right to. Where a secret is needed, name the
variable and tell the user to add it — do not invent a placeholder that looks
real enough to commit.

**Step 6 — Wire the E2E and load suites.**

E2E against a deployed environment, after deploy, before promotion. Load on a
schedule with the thresholds from `nfr.md` — a load test that runs on every PR
gets disabled within a month.

**Step 7 — Report what the pipeline does not cover.**

Every check that still exists only as a rule or a hook. That list is the honest
answer to "is this enforced", and it belongs in the Gate 6 evidence.

---

## Output

- `.github/workflows/*.yml` (or the platform's equivalent)
- Terminal: the stage list, secrets the user must add, and the uncovered checks
