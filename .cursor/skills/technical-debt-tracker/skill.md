# Skill: technical-debt-tracker

**Invocation:** `/technical-debt-tracker [scan|log|report]`

---

## Overview

**Memory references:** `memory-bank/techDebt.md, memory-bank/commonMistakes.md`

`technical-debt-tracker` keeps a living ledger of known shortcuts, deferred improvements,
and suppressed risks so they do not silently disappear after the feature that introduced
them ships. Debt that is tracked is debt that can be paid down deliberately. Debt that is
invisible compounds silently until a production incident forces an emergency fix. The skill
has three modes: `scan` discovers existing debt from the codebase, `log` adds a specific
entry, and `report` summarises open debt by risk level for sprint planning.

---

## Steps

### Mode: `scan`

**Step 1 — Grep for debt markers.**

```bash
# Source files
grep -rn "TODO\|FIXME\|HACK\|XXX\|WORKAROUND\|TEMP:" \
  src/ frontend/src/ \
  --include="*.cs" --include="*.ts" --include="*.tsx" \
  --exclude-dir="{bin,obj,node_modules,dist}"
```

**Step 2 — Grep for quality gate failures logged as known issues.**

Read `specs/audits/*.md` for any findings that were marked "deferred".
Read `speckit-checklist` session history (if stored) for any FAIL items that were
overridden.

**Step 3 — For each discovered item, assess risk.**

| Risk Level | Criteria |
|------------|---------|
| 🔴 High | Affects production correctness, security, or data integrity |
| 🟡 Medium | Affects performance, maintainability, or test coverage |
| 🟢 Low | Code style, missing docs, minor refactor opportunity |

**Step 4 — Append entries to `memory-bank/techDebt.md`.**

```markdown
## [Tech Debt ID: TD-NNN] — [Short Title]
**Risk:** 🔴 High / 🟡 Medium / 🟢 Low
**Introduced:** [YYYY-MM-DD] ([feature-slug] or "legacy")
**Location:** [file:line]
**Description:** [What the shortcut is — 2-3 sentences]
**Impact if left:** [What could go wrong]
**Suggested fix:** [How to address it]
**Estimated effort:** [S / M / L]
**Review date:** [date by which this should be re-evaluated]
**Status:** Open
```

---

### Mode: `log`

Direct entry for a specific item the developer wants to register:

```
/technical-debt-tracker log — "ExportHandler: streaming not implemented for > 10k rows; uses ToList() instead. Risk: memory spike on large exports. Fix: use IAsyncEnumerable. Effort: M. Review: next sprint."
```

Agent parses the free-text entry, structures it, assigns the next TD-NNN ID, and appends
to `memory-bank/techDebt.md`.

---

### Mode: `report`

Reads all entries in `memory-bank/techDebt.md` and produces a sprint-planning summary:

```markdown
## Tech Debt Report — [YYYY-MM-DD]

### 🔴 High Risk (must address)
| ID | Description | Location | Effort | Age |
|----|-------------|----------|--------|-----|
| TD-003 | Missing IDOR check in report handler | ReportHandler.cs:34 | S | 14 days |

### 🟡 Medium Risk (plan this sprint)
| ID | Description | Effort | Age |
|----|-------------|--------|-----|
| TD-007 | Export uses ToList() — memory risk at scale | M | 3 days |

### 🟢 Low Risk (backlog)
| ID | Description | Effort | Age |
|----|-------------|--------|-----|
| TD-001 | Missing XML docs on BrokerRepository | S | 30 days |

### Summary
Total open: [N] | High: [N] | Medium: [N] | Low: [N]
Oldest item: TD-001 ([N] days old)
Suggested for this sprint: TD-003 (High, S — quick win) + TD-007 (Medium, M)
```

---

## Example Invocation

**Command:** `/technical-debt-tracker scan`

Agent greps the codebase, finds 3 TODOs and 1 FIXME, reads 1 deferred item from
`specs/audits/dotnet-dependencies-2025-09-01.md`. Assigns IDs TD-001 through TD-005,
assesses risk (1 High, 2 Medium, 2 Low), appends all entries to `memory-bank/techDebt.md`.

**Command:** `/technical-debt-tracker report`

Reads 5 entries, generates sprint-planning table grouped by risk, suggests TD-003 (1h fix
for a High risk item) as a quick win for the current sprint.

---

## Output

- `scan`: updated `memory-bank/techDebt.md` (entries appended, not overwritten)
- `log`: single entry appended to `memory-bank/techDebt.md`
- `report`: terminal output of the risk-grouped summary table
