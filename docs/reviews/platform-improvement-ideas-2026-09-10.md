# Platform improvement ideas — 2026-09-10

These proposals build on the platform at commit `290791f`: its existing lifecycle, dashboard, validators,
feature map, hooks, and generated plugin. They are a product backlog, not completed features or an
approved implementation plan. Address the current verification findings before expanding the enforcement surface.

## Recommended priorities

Start with a realistic evaluation suite, a shared policy/metadata model, and a guided installation check.
Those three improvements increase confidence in nearly every other feature. Then add richer impact intelligence
and carefully bounded automation.

Effort is relative: S = a focused extension; M = several connected components; L = a substantial new capability.
These are initial sizing judgments, not delivery estimates.

| Priority | Idea | Benefit | Effort |
|---|---|---|---|
| 1 | Real-project evaluation suite | Demonstrate that workflows work in realistic installations and catch regressions before users do | M |
| 2 | Shared policy and capability model | Keep guards, status screens, skill routing, and CI consistent | L |
| 3 | Project doctor and guided adoption | Make installation, upgrades, and troubleshooting predictable | M |
| 4 | Unified project knowledge graph | Connect requirements, code, database objects, tests, owners, and releases | L |
| 5 | Evidence-aware impact explorer | Show exactly what a change affects and how certain the platform is | M after 4 |
| 6 | Policy simulation and replay | Let teams test a policy change safely before enabling it | M after 2 |
| 7 | Safe repair workflow | Turn validated findings into small, reviewable fixes with regression evidence | L |
| 8 | Change-driven verification | Run the most relevant checks quickly and explain the selection | M after 4 |
| 9 | Current status derived from evidence | Eliminate conflicting Done, verified, attested, and committed claims | M |
| 10 | Transactional plugin upgrades | Make updates recoverable and preserve local customization | M |
| 11 | Identity-bound team approvals | Strengthen accountability for teams sharing lifecycle decisions | L |
| 12 | Private, searchable decision memory | Retrieve the right project decisions with source and freshness information | L |
| 13 | Optional stack profiles | Adapt rules and installation defaults to an adopter's actual stack | M after 2–3 |
| 14 | Portable verification bundles | Make review evidence easy to share and independently validate | M after 9 |

## 1. Real-project evaluation suite

**Extend:** the adversarial tests and adoption fixtures.

Create small representative repositories: a .NET API, a React application, a `packages/` monorepo,
a database-heavy brownfield project, and a plugin-only installation. Exercise complete workflows:
install, discover, trace, change, verify, package, and upgrade.

Run the suite on supported Windows/Linux and Node combinations. Include known-bad cases and valid cases
so improvements reduce missed hazards without making harmless work unusable.

**First useful release:** reproduce every current review finding in a fixture and run a plugin-only smoke test.

**Success measure:** all supported environments produce the expected verdicts; failures identify the scenario,
input, expected result, and actual result. Track false refusals as well as missed refusals.

## 2. Shared policy and capability model

**Extend:** write policy, source-root definitions, skill index, and hook classification.

Give each operation explicit capabilities: read files, write reports, update caches, change application source,
execute verification, access a database, or record an approval. Represent phase requirements and exemptions
in the same model. Separate platform policy from adopter overrides, with an explanation of which rule wins.

Generate guard configuration, status diagnostics, routing guidance, and CI checks from that model.
Use shell-specific parsing adapters at the boundary; PowerShell and Bash must retain their own syntax semantics.

**First useful release:** one shared source-root/policy evaluator, plus a skill capability declaration that resolves
the current ambiguity around “read-only” skills that write artifacts.

**Success measure:** every policy fixture has the same expected outcome in the hook, CLI, dashboard, and CI adapter.

## 3. Project doctor and guided adoption

**Extend:** self-audit and the existing new-project/adoption instructions.

Offer one entry point that detects the installation mode, Node availability, hook wiring, policy conflicts,
stale generated files, unsupported source layouts, and missing project context. Present a short explanation
and a proposed repair for each issue.

An installation preview should show exactly which files would be created or changed, preserve local standards,
and let the user select the applicable stack/profile before applying changes.

**First useful release:** a read-only diagnosis and installation preview that works for copied and plugin installs.

**Success measure:** a clean fixture installs without manual path edits; an existing customized fixture retains
its local rules and receives a precise conflict report.

## 4. Unified project knowledge graph

**Extend:** feature-map, acceptance-criteria tracing, artifact identifiers, and release evidence.

Create stable identities for features, requirements, endpoints, code symbols, jobs, tables, procedures, tests,
owners, and releases. Normalize equivalent references once. Database objects need data-source identity as well
as schema/name so two databases cannot silently share an identifier.

Each connection should retain its source file or catalog snapshot, collection time, confidence, and freshness.
Support incremental updates, deletion detection, and atomic concurrent writes.

**First useful release:** normalize feature-to-procedure edges in both directions and expose their evidence.

**Success measure:** forward and reverse queries return consistent connections; changed or deleted evidence
invalidates the relevant facts; ambiguous identifiers require explicit resolution.

## 5. Evidence-aware impact explorer

**Extend:** the dashboard and existing impact-analysis/lineage commands.

Show a navigable map from a proposed change to affected features, database objects, tests, and release controls.
Let users filter by severity, ownership, and confidence. Every highlighted connection should open its evidence.

Show incomplete coverage explicitly. An empty result can mean either no known impact or insufficient tracing;
the interface should make that distinction visible.

**First useful release:** a graph/table view for a selected file or database object, with affected tests and sources.

**Success measure:** a reviewer can follow every reported impact to evidence and see what the analysis could not inspect.

## 6. Policy simulation and replay

**Extend:** guard explanations and the dashboard's existing preflight behavior.

Allow users to submit sample operations and compare outcomes under the current and proposed policies.
Replay a curated library of safe and hazardous cases without executing the commands.

Display changed outcomes and the rules responsible. Keep any retained command samples redacted and opt-in.

**First useful release:** a CLI comparison report for policy files and the existing adversarial corpus.

**Success measure:** a policy author can identify every newly allowed or newly refused scenario before activation.

## 7. Safe repair workflow

**Extend:** structured findings and the existing refactor-apply workflow.

Attach a versioned repair recipe, preconditions, expected file scope, and verification requirements to selected
finding types. Produce a patch in an isolated workspace, run the relevant checks, and present the result for review.

Preserve human-only approvals and attestations. Refuse an automatic repair when evidence is stale or the recipe
cannot establish that its preconditions hold.

**First useful release:** a small set of deterministic documentation/configuration repairs with preview and rollback.

**Success measure:** each repair has a reproducible before/after fixture and can be reverted without losing user changes.

## 8. Change-driven verification

**Extend:** impact analysis, task verification, and acceptance-criteria tracing.

Use changed files and graph dependencies to suggest the relevant tests and validators. Show why each check was
selected and when coverage is too uncertain to narrow the test run.

Keep a broader release check until selection accuracy is demonstrated against full-suite results.

**First useful release:** recommendations only, with a comparison between selected-test and full-suite outcomes.

**Success measure:** measure runtime saved and defects missed; expand automatic selection only after evidence supports it.

## 9. Current status derived from evidence

**Extend:** lifecycle evidence, self-audit, integrity, and the dashboard.

Create a status snapshot bound to a commit and working-tree digest. Distinguish implemented, tested, reviewed,
attested, committed, and deployed. Record which checks were skipped, which environment ran them, and why.

Generate the factual portions of hardening/progress summaries from this snapshot. Keep human commentary separate
so a subsequent machine refresh does not overwrite decisions or rationale.

**First useful release:** a status command that identifies contradictory documentation and produces a proposed update.

**Success measure:** a new commit or changed protected file invalidates the relevant prior status automatically.

## 10. Transactional plugin upgrades

**Extend:** plugin build, digest verification, and adoption tooling.

Build in a newly created, verified temporary directory; validate content and references; then replace the installed
version safely. Track ownership with a manifest and keep a recoverable previous version.

Compare adopter customization against the prior shipped defaults so upgrades can preserve local changes or report
conflicts. Do not infer ownership solely from a directory name or a single marker filename.

**First useful release:** safe build staging and an upgrade preview with added, removed, changed, and conflicting files.

**Success measure:** an interrupted update leaves either the previous valid installation or the complete new one.

## 11. Identity-bound team approvals

**Extend:** named reviewers, recorded actors, evidence chains, and optional signed-commit checks.

For teams that need it, bind an approval to an authenticated identity, role, exact artifact digest, and timestamp.
Define reviewer/author separation and delegated approval rules explicitly.

Choose the identity integration with the adopting organization before implementation. Preserve a documented local
workflow for installations that do not use a shared service.

**First useful release:** an approval-verification adapter and a testable identity-to-role mapping.

**Success measure:** changing artifact bytes or using an unauthorized identity invalidates the approval.

## 12. Private, searchable decision memory

**Extend:** memory-bank, decision logs, and project discovery.

Index project decisions and conventions with links to their originals, owners, dates, and superseding decisions.
Retrieve only the relevant context for a task, and explain why it was selected.

Keep project data local by default. Any external indexing should be explicitly configured with clear data scope,
redaction, retention, and deletion controls. Retrieval must treat repository content as data, not higher-priority instructions.

**First useful release:** local structured search over decisions and conventions with stale/conflicting entries flagged.

**Success measure:** a task retrieves the current decision and identifies the earlier decision it replaced.

## 13. Optional stack profiles

**Extend:** .NET/React templates, database conventions, and policy configuration.

Offer profiles for the stacks the platform already targets, such as .NET API, React frontend, and multi-database
brownfield systems. Profiles select relevant rules, source layouts, checks, and documentation defaults.

Keep the core independent of a specific framework. Add other stacks only when representative fixtures and an owner
exist to maintain them.

**First useful release:** detect the current stack and preview a suitable profile without installing dependencies.

**Success measure:** a frontend-only project receives no unexplained backend requirements, and mixed projects retain both.

## 14. Portable verification bundles

**Extend:** release evidence and structured finding reports.

Export a self-contained bundle containing the reviewed commit/digest, findings, test summaries, policy version,
attestation references, and unresolved limitations. Include a verification command that checks bundle integrity.

Let teams redact logs and exclude source code or secrets. Clearly distinguish integrity of the bundle from trust
in the person or system that produced it.

**First useful release:** a local export that another reviewer can validate without the author's ignored cache files.

**Success measure:** another checkout can detect altered evidence and reproduce the stated validation steps.

## Suggested sequence

1. Close current verification findings and add their regression cases.
2. Deliver ideas 1–3: evaluation, shared policy metadata, and adoption diagnostics.
3. Deliver ideas 4–6 and 9: connected evidence, impact exploration, simulation, and truthful status.
4. Add automation and team features from ideas 7–8 and 10–14 according to actual adopter demand.

The first milestone should demonstrate safer behavior, fewer contradictory instructions, and easier adoption.
Those results provide a stronger basis for later automation.
