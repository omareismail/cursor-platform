# Shared Execution Pipeline

This formalizes the canonical phase order for development skills (skills
that generate, modify, or review code) — a single declared sequence instead
of each skill inventing its own ordering. Read alongside
`.cursor/docs/skill-graph.md`, which tracks *which* skills call *which*
shared infrastructure; this doc defines *what order* those calls should
happen in when more than one applies to a given task.

## The canonical sequence

```
1. Repository Discovery     (repo-discovery — freshness-checked, cached)
2. Pattern Detection        (pattern-finder — nearest concrete example)
3. Context Building         (context-builder — task-scoped relevant-file set;
                              multi-file/cross-cutting tasks only, see below)
4. Convention Application   (relevant Tier 2 memory-bank file(s))
5. Architecture Validation  (02-dotnet-architecture-guard.mdc /
                              03-react-architecture-guard.mdc — alwaysApply,
                              fires automatically on matching files)
6. Primary Skill Execution  (the actual generation/modification)
   ↳ 09-minimal-changes.mdc fires here — only change what the task requires
   ↳ 10-evidence-and-dependency-guard.mdc fires here — verify before
       referencing, no unrequested packages
7. Security Validation      (04-security-guard.mdc — alwaysApply)
8. Database Validation      (06-database-provider-guard.mdc — alwaysApply
                              on .cs/.sql; for deep consistency checks, use
                              database-audit separately)
9. Domain/Audit Validation  (07-audit-trail-guard.mdc — alwaysApply on .cs;
                              now also covers business domain invariants:
                              financial precision, transactional consistency,
                              downstream effect tracing)
10. RTL Validation          (08-rtl-i18n-guard.mdc — alwaysApply on .tsx/.css)
11. Test Generation         (dotnet-test-gen / react-test-gen, for new code)
12. Documentation Update    (docs-guard / architecture-map-gen regeneration,
                              only if the change is structurally significant
                              enough to affect a diagram or doc claim)
```

## What's already true vs. what this formalizes

Steps 1, 5, 7, 8, 9, 10 are already automatic before this doc existed —
they're `alwaysApply` rules, not skill-invoked steps, so they fire
regardless of whether a skill's own step list mentions them. Steps 6's
09 and 10 guard rules were added in Phase 7 and are similarly automatic.
This doc doesn't change their behavior; it documents that they sit in the
sequence even though no skill file explicitly "calls" them.

Step 2 is genuinely wired as an explicit Step 0 in the 12 generator skills
that needed it (per `skill-graph.md`).

Step 3 is **not** wired into every skill — `context-builder` is invoked
manually for multi-file/cross-cutting tasks, not automatically by every
single-artifact `*-gen` skill.

Steps 11 and 12 are already present in relevant individual skills' step
lists; this doc confirms their position in the overall sequence.

## What deliberately stays as skills, not always-on rules

Performance profiling (`dotnet-perf-profile`/`react-perf-audit`), API
consistency checking (`api-consistency-audit`), production readiness
(`enterprise-report-gen production-readiness`), and comprehensive test
coverage validation (`dotnet-test-gen`) are on-demand audit skills, not
`alwaysApply` rules. Making them always-on gates would fire on every file
save and make the workspace unusable. The correct mental model: always-on
rules are *cheap static checks* (layer boundaries, security anti-patterns,
SQL dialect); skill-based audits are *deeper analysis* invoked deliberately
when the situation calls for them.

## The full rule inventory (11 rules as of Phase 7)

| Rule | Scope | Governs |
|---|---|---|
| `00-memory-think` | global | Read memory-bank + check repo-map freshness first |
| `01-specify-rules` | specs/src | No implementation without spec |
| `02-dotnet-architecture-guard` | `*.cs`, `*.csproj` | Clean Architecture layer boundaries |
| `03-react-architecture-guard` | `*.tsx`, `*.ts` | Component architecture |
| `04-security-guard` | cs/tsx/ts/json/yml | OWASP, secrets, injection |
| `05-planning-rigor` | global | Options-with-tradeoffs before plans |
| `06-database-provider-guard` | `*.cs`, `*.sql` | Multi-provider SQL discipline |
| `07-audit-trail-guard` | `*.cs` | Audit trails + domain invariants |
| `08-rtl-i18n-guard` | `*.tsx`, `*.css` | RTL/bilingual layout |
| `09-minimal-changes` | global | Only change what's required |
| `10-evidence-and-dependency-guard` | global | Evidence-based, no hallucination, no new packages |
