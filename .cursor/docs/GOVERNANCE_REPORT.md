# Governance Report — Phase 7: Enterprise Governance Layer
**Date:** 2026-06-30

---

## How the 24 proposed rules map to existing and new coverage

The Phase 7 prompt proposes 24 governance rules. This report documents
exactly which already existed, which were genuinely new, and what was done
with each — because a governance layer that duplicates existing enforcement
is maintenance overhead, not governance.

| Proposed rule | Status | Coverage |
|---|---|---|
| Rule 1 — Repository First | Already exists | `00-memory-think`, `repo-discovery`, `shared-execution-pipeline.md` Step 1 |
| Rule 2 — Complete Context | Already exists | `context-builder` skill, `shared-execution-pipeline.md` Step 3 |
| Rule 3 — Existing Pattern Reuse | Already exists | `pattern-finder` (wired into 12 generators as Step 0) |
| Rule 4 — Convention Enforcement | Already exists | `repo-discovery` conventions fingerprint → `repo-map.json`; `pattern-finder` imitation |
| Rule 5 — Minimal Changes | **New → `09-minimal-changes.mdc`** | Not covered anywhere previously |
| Rule 6 — Architecture Preservation | Already exists | `02-dotnet-architecture-guard`, `03-react-architecture-guard` (both `alwaysApply`) |
| Rule 7 — Evidence-Based Development | **New → `10-evidence-and-dependency-guard.mdc`** | Described in skill files; not an always-on rule |
| Rule 8 — Think Before Implementing | Already exists | `05-planning-rigor.mdc` + `shared-execution-pipeline.md` |
| Rule 9 — Root Cause Analysis | Already exists | `05-planning-rigor.mdc` (options-with-tradeoffs forces this) |
| Rule 10 — Multi-Phase Execution | Already exists | `shared-execution-pipeline.md` (the canonical sequence) |
| Rule 11 — Security First | Already exists | `04-security-guard.mdc` (`alwaysApply`) |
| Rule 12 — Performance First | Correctly a skill, not a rule | `dotnet-perf-profile`, `react-perf-audit`; `shared-execution-pipeline.md` explains why this is right |
| Rule 13 — Database Safety | Already exists | `06-database-provider-guard.mdc` + `database-audit` Step 5b |
| Rule 14 — API Consistency | Correctly a skill, not a rule | `api-consistency-audit`; see below |
| Rule 15 — Testing Required | Correctly a skill, not a rule | `dotnet-test-gen`, `react-test-gen` |
| Rule 16 — Documentation Required | Correctly a skill, not a rule | `docs-guard`, `architecture-map-gen` |
| Rule 17 — Self Review | Already exists | `05-planning-rigor.mdc` (final validation step in every speckit flow) |
| Rule 18 — Hallucination Prevention | **New → `10-evidence-and-dependency-guard.mdc`** | Merged with Rule 7 and 19 (same root cause) |
| Rule 19 — Dependency Safety | **New → `10-evidence-and-dependency-guard.mdc`** | Merged with Rules 7 and 18 |
| Rule 20 — Large Repo Optimization | Already exists | `repo-discovery` freshness-check/caching model; `shared-execution-pipeline.md` |
| Rule 21 — Token Efficiency | Already exists | `repo-discovery` cache reuse; convention profile in `repo-map.json` |
| Rule 22 — Production Readiness | Correctly a skill, not a rule | `enterprise-report-gen production-readiness` |
| Rule 23 — Business Domain Safety | **Extended `07-audit-trail-guard.mdc`** | Partial existing coverage (audit trails); extended with financial precision, transactional consistency, downstream tracing |
| Rule 24 — Final Validation | Already exists | `05-planning-rigor.mdc` final review step; `enterprise-report-gen` |

**Why Rules 12, 14, 15, 16, 22 are correctly skills, not always-on rules:**
An `alwaysApply: true` rule fires on every matching file in every session.
Performance profiling, API surface auditing, test generation, documentation
updates, and production readiness checks are not cheap static analysis — they
involve runtime profiling, full endpoint enumeration, coverage measurement,
or multi-source aggregation. Making them always-on rules would fire on every
`.cs` file save and produce noise that gets ignored, which is worse than not
having the check at all. The correct governance model: always-on rules are
*fast static discipline*; skill-based audits are *deep analysis* invoked
when the situation warrants. `shared-execution-pipeline.md` documents where
each belongs in the execution sequence.

---

## New rules added

### `09-minimal-changes.mdc`
**Governs:** Every file type (global scope, no glob restriction)
**Enforces:** Only change what the task requires. Refuses unrelated
reformatting, opportunistic renames, implicit scope creep, and
`using`/`import` reordering. Flags adjacent issues rather than silently
bundling fixes into unrelated PRs.
**Why new:** This was a real behavioral gap — AI-generated changes
routinely touch more than they should, making PRs harder to review and
git blame harder to read. No existing rule covered it.

### `10-evidence-and-dependency-guard.mdc`
**Governs:** Every file type (global scope, no glob restriction)
**Enforces:** Three merged disciplines with the same root cause:
(1) Every assertion about the repo must trace to a verifiable source;
(2) Every class/interface/method/table/column/config key referenced in
generated code must be confirmed to exist before being used;
(3) No new NuGet/npm package, infrastructure service, or framework unless
already present or explicitly requested.
**Why merged:** Rules 7, 18, and 19 share the same failure mode — confident
generation against a repository that doesn't match assumptions. One rule
covering all three is easier to reason about than three rules with overlapping
concerns.

---

## Existing rules enhanced

### `07-audit-trail-guard.mdc` — Business Domain Invariant Protection added
Extended with a "Business Domain Invariant Protection" section covering:
- Downstream effect tracing before modifying financial calculations
- `decimal` precision enforcement (refusal to introduce `double`/`float` in
  financial math paths)
- Transactional consistency (refusal to remove `BeginTransactionAsync` scope
  from multi-entity financial mutations without documented justification)
- Assumption documentation when `businessRules.md` doesn't cover a specific case

Not made a separate rule because it governs the same `.cs` glob and the same
class of entities as the existing audit-trail rule — two rules over the same
scope for the same domain would be harder to maintain than one extended rule.

---

## Rules merged

None. All pre-existing rules have distinct, non-overlapping scopes. No
merges were needed.

---

## Rules deprecated

None. All 9 pre-existing rules remain valid and active.

---

## Governance architecture

```
ALWAYS-ON LAYER (11 rules, fire automatically)
├── Global scope (no glob):
│   ├── 00-memory-think         — context before action
│   ├── 05-planning-rigor       — deliberation before plans
│   ├── 09-minimal-changes      — scope discipline [NEW]
│   └── 10-evidence-and-dep     — evidence + hallucination + dep safety [NEW]
├── .NET scope (*.cs, *.csproj, *.sql):
│   ├── 02-dotnet-arch-guard    — Clean Architecture enforcement
│   ├── 06-database-provider    — SQL dialect correctness
│   └── 07-audit-trail          — audit trails + domain invariants [EXTENDED]
├── React scope (*.tsx, *.ts, *.css):
│   ├── 03-react-arch-guard     — component architecture
│   └── 08-rtl-i18n-guard       — RTL/bilingual layout
├── Security scope (cs/tsx/ts/json/yml):
│   └── 04-security-guard       — OWASP, secrets, injection
└── Spec scope (specs/src/frontend):
    └── 01-specify-rules        — spec-first development

ON-DEMAND SKILL LAYER (66 skills, invoked deliberately)
├── Foundational: repo-discovery, pattern-finder, context-builder
├── Generators: 12 *-gen skills (each calls pattern-finder as Step 0)
├── Auditors: database-audit, devops-audit, api-consistency-audit,
│             security-perf-report, compliance-audit, refactor-assistant
├── Reporters: enterprise-report-gen, skill-maturity-audit,
│             platform-health-validator
└── Speckit: speckit-* family (12 skills)
```

---

## Rule dependency graph

```
10-evidence-and-dep ─────────► pattern-finder (skill)
     (rule enforces what         (skill implements)
      pattern-finder prevents)

09-minimal-changes ──────────► (no skill dependency — behavioral discipline)

07-audit-trail ──────────────► businessRules.md (Tier 2)
     (extended)                 repo-map.json (via repo-discovery)
                                compliance-audit (cross-reference SAMA retention)

06-database-provider ────────► repo-map.json (databaseProviders field)
                                database-audit (deeper consistency check)

02-dotnet-arch-guard ────────► repo-map.json (dependencyGraph.cycles)
                                architecture-map-gen (diagram rendering)

00-memory-think ─────────────► repo-map.json (freshness gate)
                                memory-bank/* (Tier 1 + Tier 2)
```

---

## Enforcement strategy

**Rules 09 and 10 are global-scope** (`alwaysApply: true`, no `globs`
restriction) because the behaviors they govern — changing too much, and
referencing things that don't exist — appear equally in `.cs`, `.tsx`,
`.sql`, `.yml`, and `.md` files. Scoping them to specific file types would
create false exceptions.

**Rule 07's extension** stays on `*.cs` only because financial domain
invariants (decimal precision, transaction scope) are enforcement concerns
at the C# layer, not at the SQL or frontend layer. The downstream-effect
tracing it requires will naturally pull in any dependent file types as
context, but the guard itself fires on the C# source of truth.

---

## Expected impact on skill quality

- **09-minimal-changes:** Eliminates the most common source of "why did
  this PR touch 40 files when only 3 needed changing" — generates cleaner,
  more reviewable diffs, lower regression surface per change.
- **10-evidence-and-dependency-guard:** Eliminates the "compiles in the
  abstract but references a class that doesn't exist in this repo" class of
  generation failure. Combined with `pattern-finder`'s concrete-example
  matching, this makes the workspace substantially more reliable on first
  use against an unfamiliar bounded context.
- **07 extension:** Makes financial-domain modifications safer by requiring
  downstream tracing and precision discipline that previously depended on
  individual developer knowledge of the domain.

---

## Remaining governance gaps

- **No CI-side mirror of always-on rules.** A developer editing code
  outside Cursor entirely bypasses the 11 rules. This is a structural
  limitation of a Cursor workspace, not something fixable within `.cursor/`.
- **`10-evidence-and-dependency-guard` cannot technically verify existence**
  — it declares the behavioral requirement, but actual existence checking
  is implemented by `repo-discovery`/`context-builder`/`pattern-finder`
  skills, which the rule's enforcement depends on being used upstream.
  The rule is a declared contract; `skill-maturity-audit` verifies the
  skills actually call those upstream checks.
- **Rule 23's "downstream effect tracing"** is a declared discipline, not
  an automated graph traversal — the agent must reason about dependencies,
  not run a static call-graph analysis tool. Full automation of this would
  require a call-graph MCP tool not currently in the workspace.
