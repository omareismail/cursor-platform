# Skill: docs-guard

**Invocation:** `/docs-guard [docs-file-or-folder]`
Default: entire `docs/` folder

---

## Overview

**Memory references:** `memory-bank/glossary.md`

`docs-guard` verifies that every claim in a documentation file matches the actual
codebase — that referenced symbols exist at the stated locations, that described
behaviours match the implementation, and that code samples compile. Documentation
that has drifted from the code is worse than no documentation, because it actively
misleads developers and produces hard-to-diagnose bugs. This skill is distinct from
code-review-assistant (which reviews diffs) and onboarding-doc-gen (which generates
docs): its sole purpose is verification. It does not rewrite documentation or fix
code; it produces a findings report with specific file:line references.

---

## Steps

**Step 1 — Determine scope.**

If a file is given, scan that file. Otherwise scan all Markdown files under `docs/`,
`README.md`, and `CONTRIBUTING.md`.

**Step 1b — Load `repo-map.json` for structural claims.**

Confirm `repo-discovery` freshness, then use `repo-map.json` to verify any
documentation claim about project structure, providers in use, or service
topology (e.g. a README claiming "uses PostgreSQL" when `repo-map.json` shows
the project actually runs against Oracle) — this catches a class of doc rot
that pure prose-vs-prose comparison against memory-bank can't, since
memory-bank itself could be stale.

**Step 2 — For each claim in every documentation file, verify it.**

**Symbol existence claims:**
- "The `IOrderRepository` interface is in `src/Application/Interfaces/`"
  → Check: does the file exist? Does it define that interface?
- "The `useOrderHistory` hook returns `{ data, isLoading, error }`"
  → Check: does the hook exist? Does it return those named properties?

**Behaviour claims:**
- "The endpoint returns `201 Created` with the order ID on success"
  → Check: does the endpoint file have a `201` response configured?
- "Validation rejects orders with more than 50 lines"
  → Check: is there a `MaximumElements(50)` or equivalent in the validator?

**Code sample validity:**
- TypeScript samples: check that all imported symbols exist in the stated paths
- C# samples: check that all types, methods, and namespaces exist in the codebase
- Shell commands: check that referenced scripts/tools are present in the repo

**Step 3 — Output findings.**

```
[SEVERITY] docs/path/file.md:LINE
Claim:   [what the documentation states]
Reality: [what the code actually has — with file:line reference]
Fix:     [one-sentence correction]
```

**Severity levels:**

| Severity | Condition |
|----------|-----------|
| Must fix | Symbol doesn't exist, wrong HTTP method/path, wrong return type, broken code sample |
| Should fix | Outdated description, missing error case, stale code sample (compiles but is no longer idiomatic) |
| Info | Missing doc for a public API, no example for complex config, missing version annotation |

**Step 4 — Output summary.**

```
════════════════════════════════════
docs-guard summary
Scanned: [N] files | [N] claims verified
════════════════════════════════════
Must fix:   [N]
Should fix: [N]
Info:       [N]
════════════════════════════════════
```

**Does NOT:**
- Rewrite documentation
- Review code quality (use dotnet-clean-code-guard or react-clean-code-guard)
- Enforce prose style or grammar
- Generate documentation from scratch (use onboarding-doc-gen)

---

## Example Invocation

**Command:** `/docs-guard docs/api-reference.md`

**Sample findings:**

```
[Must fix] docs/api-reference.md:34
Claim:   The POST /api/v1/orders endpoint accepts a BrokerId field in the request body.
Reality: src/OrientPortal.API/Endpoints/Orders/CreateOrderEndpoint.cs:12 — the field
         is named BrokerIdentifier in the current DTO record, not BrokerId.
Fix:     Update the docs to use BrokerIdentifier, or rename the DTO field if BrokerId
         was the intended name.

[Should fix] docs/api-reference.md:78
Claim:   Use IOrderRepository.GetAllAsync() to fetch all orders.
Reality: src/OrientPortal.Application/Interfaces/IOrderRepository.cs:8 — the method
         signature is GetAllAsync(Guid brokerId, CancellationToken ct) — requires
         brokerId parameter, not parameterless.
Fix:     Update the docs to show the correct method signature.

[Info] docs/api-reference.md — no documentation found for the GET /api/v1/brokers/{id}/clients/export endpoint added in v1.4.
Fix:   Add a section for the export endpoint.
```

---

## Output

- Terminal: findings list with Claim / Reality / Fix per item
- Terminal: summary table
