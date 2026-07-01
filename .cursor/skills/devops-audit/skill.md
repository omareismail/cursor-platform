# Skill: devops-audit

**Invocation:** `/devops-audit [scope]`
Example: `/devops-audit full` · `/devops-audit Tamkeen.Payments` · `/devops-audit ci`

Scope can be `full`, a project/service name, or one of `docker` | `ci` | `iac` | `k8s`
to narrow to a single surface.

---

## Overview

**Memory references:** `memory-bank/deploymentNotes.md`,
`memory-bank/securityStandards.md` (for secrets-handling expectations),
`.cursor/cache/repo-map.json` (from `repo-discovery` — Step 0 freshness check
applies)

`devops-audit` is the missing counterpart to `dotnet-iac-gen`: that skill
*generates* new IaC, this skill *audits what's already there* — Dockerfiles,
docker-compose, GitHub Actions/Azure Pipelines workflows, Bicep/Terraform,
and K8s/Helm manifests, for drift, anti-patterns, and inconsistency across
services. It does not re-detect dependency vulnerabilities
(`dotnet-dependency-audit` and `dependency-upgrade-guard` own that) and it
does not generate new infrastructure (`dotnet-iac-gen` owns that) — this
skill's job is specifically: *is what's already deployed/configured correct
and consistent across the repo's services?*

**MCP tools:** Docker MCP Toolkit/Gateway if connected (see
`.cursor/docs/mcp-ecosystem.md`) for live container inspection rather than
static file reading alone; `github` MCP server for workflow run history when
auditing CI reliability, not just CI configuration.

---

## Steps

**Step 1 — Inventory the DevOps surface from `repo-map.json`.**

Pull the `iac` field plus a direct scan (if not already cached) of
`Dockerfile*`, `docker-compose*.yml`, `.github/workflows/*.yml` or Azure
Pipelines YAML, `*.bicep`/`*.tf`, and `helm/**`/`k8s/**` manifests across all
services in scope.

**Step 2 — Docker audit.**

For each `Dockerfile`:
- Multi-stage build in use? Flag single-stage builds shipping SDK/build
  tools into the runtime image (image bloat + larger attack surface).
- Base image pinned to a specific tag/digest, not `latest` — `latest` in a
  Dockerfile is a reproducibility and security-drift risk (silently
  different base image content over time).
- Non-root user configured for the runtime stage — flag any image still
  running as root with no documented justification.
- Secrets baked into image layers (build args or `COPY` of files containing
  credentials) — this is a hard-coded-secret finding, escalate to
  `04-security-guard.mdc` severity, not just a DevOps note.
- `.dockerignore` present and excludes `bin/`, `obj/`, `node_modules/`,
  `.git/` — missing this routinely produces bloated, slow image builds and
  occasionally leaks build artifacts containing local secrets.

**Step 3 — CI/CD pipeline audit.**

- Consistency across services — do all services run the same test/lint/build
  gate sequence, or has one service's pipeline drifted (missing a step
  others have, e.g. no SAST/dependency-scan stage)?
- Secrets handling — are secrets referenced via the platform's secret store
  (GitHub Secrets/Azure Key Vault) rather than committed or echoed into logs?
- Build reproducibility — pinned action versions (`actions/checkout@v4`, not
  `@main`) vs. floating references that can change pipeline behavior without
  a corresponding repo commit.
- Deployment gate — does production deployment require approval/manual gate,
  or can a merge to main auto-deploy with no human checkpoint? Flag the
  latter as a finding, not a failure — some teams intentionally want this,
  but it should be a documented decision (`decisionLog.md`), not an
  unexamined default.
- Test result visibility — are test failures actually blocking merge, or is
  the step present but `continue-on-error: true` (a common silent-drift
  pattern where a gate looks present but isn't enforced)?

**Step 4 — IaC audit.**

- Parameterization — flag any hardcoded subscription ID, resource name, or
  connection string in Bicep/Terraform (overlaps `dotnet-iac-gen`'s
  generation-time rule, checked here against what's actually committed).
- State management (Terraform) — remote state backend configured, not local
  state files committed to the repo.
- Drift between IaC-declared resources and what `deploymentNotes.md` records
  as actually deployed — if they disagree, IaC isn't a reliable source of
  truth, which is a higher-severity finding than any single resource issue.
- Environment parity — are TEST/LIVE IaC definitions structurally the same
  (same resource types, same module composition) with only parameter values
  differing, or have they diverged into separately-maintained templates that
  will eventually disagree silently?

**Step 5 — K8s/Helm audit (where applicable).**

- Resource requests/limits set on every container — flag containers with no
  limits (cluster-stability risk) and containers whose requests are
  implausibly low relative to what `dotnet-perf-profile` has measured for
  that service, if such data exists.
- Health/readiness probes configured and pointing at the actual health-check
  endpoint `dotnet-observability-gen` set up — flag probes that exist but
  point at a stale or removed endpoint.
- Secrets mounted via K8s Secrets/external-secrets operator, not baked into
  the image or ConfigMap in plaintext.

**Step 6 — Classify and report.**

- **Blocking** — secrets in image layers or plaintext ConfigMaps, CI gates
  present-but-disabled (`continue-on-error: true` on a required check),
  production auto-deploy with no approval gate and no documented decision
- **Risk** — unpinned base images/action versions, missing resource
  limits, IaC/deployed-state drift
- **Informational** — pipeline inconsistency between services with no
  immediate security/reliability impact (e.g. one service uses a slightly
  different but equally valid lint config)

---

## Example Invocation

**Command:** `/devops-audit Tamkeen.Payments`

**Context:** Pre-launch review before a new gateway integration goes live.

Agent inventories the Dockerfile, GitHub Actions workflow, and Bicep
templates for `Tamkeen.Payments`, finds the production deployment workflow
has no manual approval gate (auto-deploys on merge to `main`) with no
corresponding `decisionLog.md` entry, and finds the Dockerfile's base image
is pinned to `mcr.microsoft.com/dotnet/aspnet:8.0` (tag, not digest) —
classified Blocking and Risk respectively, with the recommendation to either
add the approval gate or record the decision to skip it.

---

## Output

- Findings table (surface, finding, severity, affected file)
- No auto-applied fixes — pipeline and infrastructure changes are exactly
  the kind of consequential change `05-planning-rigor.mdc` exists for;
  recommendations are presented, not applied
- Findings handed to `technical-debt-tracker` for anything not resolved
  immediately
