# Skill: speckit-analyze

**Invocation:** `/speckit-analyze`

---

## Overview

`speckit-analyze` is the mandatory first step of the speckit pipeline. It
converts a raw, often vaguely worded feature request into a structured
analysis document that surfaces hidden assumptions, identifies affected code
layers, and produces a numbered list of open questions that `speckit-clarify`
will turn into options-driven decisions. Running this skill before clarification
prevents the most common planning failure: starting to discuss details before
the problem statement is actually agreed upon. It auto-detects whether the
project is .NET-only, React-only, or full-stack by reading memory-bank or
inspecting the file system, and scopes the output accordingly.

---

## Steps

**Step 1 — Auto-detect project type.**

Read in order:
1. `memory-bank/techContext.md` → stack, framework versions, key packages
2. `memory-bank/systemPatterns.md` → established patterns to respect
3. `memory-bank/activeContext.md` → what is currently in flight
4. `memory-bank/progress.md` → completed and blocked tasks

If memory-bank does not exist, detect from the file system:
- `*.csproj` present → `MODE=dotnet`
- `package.json` with `"react"` → `MODE=react`
- Both → `MODE=fullstack`
- Output a warning if no memory-bank exists and suggest running `/context-sync`.

**Step 2 — Produce the analysis document.**

Output the following structured document to the terminal. Do not save it as a
file yet (that happens in `speckit-clarify` and `speckit-specify`).

```markdown
## Feature Analysis: [Feature Name]
**Date:** [YYYY-MM-DD]
**Project Type:** [.NET | React | Full-stack]
**Requested by:** [user name if known, otherwise "not specified"]
**Analysis by:** speckit-analyze

---

### Raw Request
[Verbatim copy of what the user said — never paraphrase here]

---

### Problem Statement
[What problem does this solve? Who experiences it? What happens without this
feature? 2-4 sentences. If this cannot be determined from the request alone,
flag it as the first open question.]

---

### Affected Layers
**Backend (.NET):**
- Domain: [entities, value objects, domain events affected — or N/A]
- Application: [commands, queries, validators — or N/A]
- Infrastructure: [repositories, EF Core, external services — or N/A]
- API: [endpoints, request/response DTOs — or N/A]

**Frontend (React):**
- Pages: [route-level components — or N/A]
- Features: [feature modules — or N/A]
- Shared components: [reusable UI — or N/A]
- API layer: [React Query hooks, fetchers — or N/A]
- Store: [Zustand/Redux state changes — or N/A]

---

### Assumptions Made
1. [Assumption — tag as HIGH/MEDIUM/LOW risk if wrong]
2. [...]
(List every assumption. Wrong assumptions discovered in review are expensive.)

---

### Related Existing Code
[List files/modules likely affected, inferred from codebase scan or memory-bank.
Format: `path/to/File.cs — reason it is affected`]

---

### Conflicts and Overlaps With In-Progress Work
[Scan memory-bank/progress.md. List any task currently In Progress that this
feature would touch or conflict with. If none: "None detected."]

---

### Open Questions (for speckit-clarify)
[Numbered list — minimum 5, scaled by complexity per rule 05-planning-rigor.mdc.
These will be turned into labeled options in speckit-clarify — keep them as
neutral decision-framing questions here, not yes/no questions.]

1. [Question]
2. [Question]
...

---

### Risk Assessment
**Level:** Low | Medium | High
**Reasoning:** [1-2 sentences tying the risk level to specific concerns:
data migration risk, breaking API contract, touching auth/payments, etc.]

---

### Suggested Next Step
Run `/speckit-clarify` with the open questions above.
```

**Step 3 — Conflict check.**

Read `memory-bank/progress.md`. If any In Progress task touches the same
files or domain as this feature, output a warning:
> ⚠ Potential conflict: TASK-0XX ([task name]) is currently In Progress and
> modifies [file/module]. Coordinate with the team before starting this feature
> to avoid a merge conflict or double-implementation.

---

## Example Invocation

**User says:** *"We need to let insurance brokers export their client list as a CSV file."*

**Agent runs `/speckit-analyze` and outputs:**

```markdown
## Feature Analysis: Broker Client List CSV Export
**Date:** 2025-09-15
**Project Type:** Full-stack
**Requested by:** not specified

### Raw Request
"We need to let insurance brokers export their client list as a CSV file."

### Problem Statement
Insurance brokers currently have no way to bulk-export their client data for
use in external reporting tools (Excel, Power BI). Without this feature, brokers
manually copy rows from the UI, which is error-prone and time-consuming. The
feature is needed for compliance reporting where auditors require client data in
a structured format.

### Affected Layers
**Backend (.NET):**
- Application: new ExportBrokerClientsQuery + handler
- Infrastructure: streaming CSV writer or library (e.g. CsvHelper)
- API: new GET /brokers/{id}/clients/export endpoint

**Frontend (React):**
- Feature: features/broker/components — add Export button
- API layer: new useBrokerClientExport mutation or download hook

### Assumptions Made
1. (HIGH) "Client list" means all clients — it is unknown if pagination/filtering should apply to the export.
2. (MEDIUM) Export is synchronous (download-on-click) — large datasets may require async/background generation.
3. (LOW) CSV is the only format required — XLSX was not mentioned.

### Open Questions (for speckit-clarify)
1. Should the export include all clients or only those matching the current filter state?
2. Should generation be synchronous (immediate download) or asynchronous (email link)?
3. Which fields should appear in the CSV, and in what order?
4. Should the export be scoped to the authenticated broker's own clients only?
5. Is there a maximum row count after which export is rejected or throttled?
6. What authentication/authorization policy governs the export endpoint?
7. Is any PII masking required in the exported file?

### Risk Assessment
**Level:** Medium
**Reasoning:** PII data is involved; incorrect authorization scoping could expose
one broker's clients to another. Export format/field decisions need product sign-off.
```

---

## Output

- Analysis document printed to the terminal (not saved to disk)
- Conflict warning printed if `memory-bank/progress.md` shows overlapping In Progress work
- Implicit output: the Open Questions list that feeds directly into `/speckit-clarify`
