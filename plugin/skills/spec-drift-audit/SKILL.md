---
name: spec-drift-audit
description: "Runs the spec-drift-audit workflow. Invoked as /spec-drift-audit."
---

<!-- GENERATED from the cursor-platform source skill "spec-drift-audit".
     Do not edit here - edit the source and re-run the plugin build. -->

# Skill: spec-drift-audit

**Invocation:** `/spec-drift-audit [spec-file|feature-id|scope]`
Example: `/spec-drift-audit specs/features/refund-processing.md` · `/spec-drift-audit premium-calculation` · `/spec-drift-audit businessRules`

---

## Overview

**Memory references:** `memory-bank/businessRules.md`, `memory-bank/apiConventions.md`,
`memory-bank/architecture.md`, `memory-bank/glossary.md`,
`memory-bank/decisionLog.md`, `.cursor/cache/feature-map.json`,
`specs/**` (specs produced by the speckit pipeline)

`spec-drift-audit` answers **"does the code still do what we said it does?"** It
takes a written source of intent — a speckit spec, a `businessRules.md` section,
an ADR from `decisionLog.md`, or a cached `feature-trace` — and checks each
individual claim against the implementation, classifying every mismatch by which
side is wrong.

That classification is the point. A mismatch is not automatically a bug:

| Verdict | Meaning | Action |
|---|---|---|
| **Implemented** | Code matches the claim | none |
| **Code drift** | Code changed, doc did not — code is right | update the doc |
| **Doc drift** | Doc changed or was aspirational — doc is right | fix the code |
| **Both wrong** | Neither matches the actual business rule | escalate to a human |
| **Unverifiable** | Claim is not checkable from source | flag; needs a human or a test |
| **Undocumented** | Rule in code that no doc mentions | document it |

Most drift tools report a diff and leave the reader to decide. Deciding is the
hard part, and a tool that dodges it just moves the work. This skill takes a
position on each item and shows the evidence for it.

**How it differs from the neighbouring skills:**

- **`docs-guard`** — checks that documentation's *references* resolve: does this
  symbol exist, is this path right. Mechanical, syntactic.
- **`code-review-assistant`** — checks a *diff* against the spec, at PR time.
- **`compliance-audit`** — checks against an *external* framework (SAMA, ZATCA).
- **`spec-drift-audit`** — checks *semantic* claims about behaviour against the
  implementation, on code already merged. "The spec says refunds over 10,000 SAR
  need dual approval — do they?"

Read-only. Writes nothing, including the cache.

---

## Steps

**Step 0 — Resolve the source of intent, and get a trace.**

| Argument | Source of claims |
|---|---|
| Path to `specs/**.md` | That spec's Acceptance Criteria, API contract, business rules |
| A feature id | `businessRules[]` from `feature-map.json` + any spec naming it |
| `businessRules` | Every rule in `memory-bank/businessRules.md` |
| `decisionLog` | Every ADR in `memory-bank/decisionLog.md` still marked Accepted |
| A module/scope | All specs and rules attributable to it |

Then get the implementation side:

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/feature-map.mjs list
node ${CLAUDE_PLUGIN_ROOT}/tools/feature-map.mjs show <feature-id>
```

If the feature is traced and **fresh**, use the trace — it already located the
business rules with `file:line`. If it is **stale or absent**, run
`/feature-trace` first. Auditing drift against a stale trace produces confident
nonsense: you will report drift that was fixed last week.

**Step 1 — Decompose intent into individually checkable claims.**

Prose does not audit. Split each document into atomic, falsifiable statements,
and give each an id so findings can be cited:

> **C-1** Refunds above 10,000 SAR require approval from a second user
> **C-2** Refund requests expire after 30 days
> **C-3** `POST /api/v1/refunds` returns 409 when the payment is already refunded
> **C-4** Refund amounts are stored to 2 decimal places
> **C-5** Every refund writes an audit record with the approver's user id

Claims that cannot be made falsifiable — "the system should be performant", "the
UX should be intuitive" — go straight to **Unverifiable**. Do not quietly drop
them; a spec full of unfalsifiable claims is itself a finding worth reporting to
whoever writes the specs.

**Step 2 — Verify each claim against the code.**

For each claim, find the implementing code and read it. Record `file:line` for
the evidence, whether it confirms or contradicts.

Practical checks by claim type:

| Claim type | How to verify |
|---|---|
| Threshold / limit | Find the constant or config key. Confirm the comparison operator — `>` vs `>=` at a boundary is the single most common real drift. |
| Required approval / workflow | The state machine or status transitions. Is the gate enforceable, or only in the UI? |
| Status code / error contract | The endpoint's return paths and typed results |
| Expiry / retention | The job or query implementing it, and its actual schedule |
| Precision / rounding | The column type, the C# type, **and** the rounding mode — `MidpointRounding` default differs from most written specs |
| Audit / logging | The write path — does the audit record capture every field claimed? |
| Permission / role | The policy definition, not just the attribute name |
| Uniqueness / invariant | The DB constraint, not only the C# validation. Application-only enforcement fails under concurrency. |

**Two rules that keep this honest:**

1. **Verify server-side.** A rule enforced only in React is not enforced. If the
   claim is satisfied only by client validation, that is **doc drift** with a
   security flavour, not "implemented".
2. **Check every implementation.** If `feature-map` recorded divergences (the
   same capability computed in an endpoint, a job and a report), verify the claim
   against *all* of them. "Implemented in the endpoint, absent from the nightly
   job" is exactly the finding that matters, and averaging it to "implemented"
   destroys the audit.

**Step 3 — Classify, with the burden of proof stated.**

Assign one verdict per claim using the table in the Overview. For **Code drift**
vs **Doc drift** the deciding question is *which one reflects current business
intent* — and you usually cannot know that from source alone. Use these signals,
and say which you used:

- `git log` on the implementing file: a deliberate recent commit with a clear
  message that changed the behaviour suggests the **code** is the newer intent
- `decisionLog.md`: an ADR postdating the spec suggests the **doc** is stale
- The spec's own status (Draft vs Accepted vs Superseded)
- Whether tests assert the documented behaviour — a test asserting the old rule
  that still passes means the code never changed and the doc is aspirational

Where the signals conflict, classify as **Both wrong / needs a human** rather
than guessing. Guessing here writes the wrong thing into `businessRules.md`,
which then becomes the source everyone trusts.

**Step 4 — Find rules in code that no document mentions.**

Walk the implementation for conditionals, thresholds, special cases and magic
numbers that no claim covers — legacy carve-outs, per-tenant exceptions,
grandfathered rates. These are the rules that bite during a rewrite because
nobody knew they existed. Report each with `file:line` and a plain-language
statement of what it does.

**Step 5 — Report. Do not fix.**

This skill is read-only by design: silently "fixing" drift means either editing
code to match a possibly-stale doc, or editing a Tier 2 memory-bank file that is
human-authored (and which the `PreToolUse` write guard blocks anyway).

Hand off explicitly:

- code is wrong → `/refactor-apply`, or `/speckit-specify` if the rule needs
  re-deciding first
- doc is wrong → propose the exact edit in chat and let the user apply it
- both wrong → `/speckit-clarify` to re-decide with options and tradeoffs
- the spec is systematically unfalsifiable → `/prompt-quality-audit`

---

## Example Invocation

**Command:** `/spec-drift-audit specs/features/refund-processing.md`

Agent decomposes the spec into 14 claims, uses the cached `refund-processing`
trace, and finds: C-1's dual-approval threshold is `>` 10,000 in code but the
spec says "10,000 and above" (boundary drift — a 10,000 SAR refund needs no
second approver); C-2's 30-day expiry job was disabled in a 2024 commit and never
re-enabled; C-5's audit record omits the approver id the spec requires. It also
finds an undocumented carve-off exempting three legacy broker ids from approval
entirely. Three verdicts are **code drift**, one is **doc drift**, one needs a
human.

---

## Output

```
## Spec drift audit: <source>

**Claims checked:** <n>   **Implementation source:** trace (fresh|stale) | direct read
**Implemented:** <n>  **Code drift:** <n>  **Doc drift:** <n>  **Both wrong:** <n>  **Unverifiable:** <n>

### Verdict summary
<2-3 sentences: is this document still trustworthy as a source of truth?>

### CRITICAL - documented control not enforced
| Claim | Says | Code does | Evidence (file:line) | Verdict |

### Drift
| Claim | Says | Code does | Evidence | Verdict | Which is right, and why |

### Undocumented rules found in code
| Rule (plain language) | Evidence | Should this be in businessRules.md? |

### Unverifiable claims
| Claim | Why it cannot be checked from source | Who can answer |

### Divergent implementations
<claim satisfied in one code path but not another - endpoint vs job vs report>

### Recommended actions
| # | Action | Owner | Skill to run |
```

