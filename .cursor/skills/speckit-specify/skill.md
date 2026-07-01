# Skill: speckit-specify

**Invocation:** `/speckit-specify`

---

## Overview

**Memory references:** `memory-bank/businessRules.md, memory-bank/glossary.md`

`speckit-specify` assembles the confirmed clarification record and constitution
into a single, self-contained spec file that becomes the authoritative contract
for implementation. It is the document that every subsequent skill — implement,
checklist, code-review-assistant — validates against. The spec is the source of
truth: if something is not in the spec, it is not in scope. The full-stack
template covers both the API contract and the UI behaviour in one document,
ensuring no impedance mismatch between backend and frontend. Once generated,
this file is append-only after implementation begins.

---

## Steps

**Step 1 — Load inputs.**

Read:
- `specs/clarifications/[feature-slug].md`
- `specs/constitutions/[feature-slug]-constitution.md`
- `memory-bank/techContext.md` for technology names and versions

**Step 2 — Assemble the spec using the full template.**

See template below. Fill every section — no placeholders, no "TBD" unless it
is a documented open item with an owner and deadline.

**Step 3 — Validate completeness before saving.**

- Every API endpoint in the constitution has a row in the spec's endpoint table
- Every domain event in the constitution has a corresponding acceptance criterion
- Every acceptance criterion is testable (has a subject, a condition, an outcome)
- In-scope and Out-of-scope sections are explicit and mutually exclusive
- No acceptance criterion is vague ("it should work" is not a criterion)

**Step 4 — Save the spec file.**

---

## Spec Template

```markdown
# [Feature Name]
**Status:** Draft
**Created:** [YYYY-MM-DD]
**Last Updated:** [YYYY-MM-DD]
**Spec file:** specs/features/[feature-slug].md
**Plan:** specs/plans/[feature-slug]-plan.md
**Constitution:** specs/constitutions/[feature-slug]-constitution.md

---

## Overview
[1-paragraph plain-English description of what this feature does and why it exists.
No technical jargon — a product manager should be able to read this.]

## Scope
**In scope:**
- [Explicit list of what IS covered by this spec]

**Out of scope:**
- [Explicit list of what is NOT covered — prevents scope creep in code review]

---

## Backend Specification

### Domain Model

**Entities / Aggregates**
```csharp
// [EntityName] — [one-line purpose]
// Invariants:
//   1. [invariant]
//   2. [invariant]
public class EntityName
{
    public Guid Id { get; private set; }
    // [full property list with private setters]
}
```

**Value Objects**
[Name, backing type, validation rules]

**Domain Events**
```csharp
public sealed record EntityNameCreated(Guid EntityId, string Name, DateTimeOffset OccurredAt);
// Raised when: [condition]
// Consumers: [list services or handlers]
```

### Commands & Queries

**Commands**
```csharp
public record CommandNameCommand(Type Prop1, Type Prop2) : IRequest<CommandNameResponse>;
public record CommandNameResponse(Guid Id);
// Validator rules:
//   Prop1: NotEmpty; MaxLength(200)
//   Prop2: GreaterThan(0)
```

**Queries**
```csharp
public record QueryNameQuery(Guid Id) : IRequest<QueryNameResponse?>;
public record QueryNameResponse(Guid Id, string Name, ...);
```

### API Endpoints

| Method | Path | Auth Policy | Request | Success | Errors |
|--------|------|-------------|---------|---------|--------|
| POST | /api/v1/[resource] | [Policy] | CommandNameCommand | 201 CommandNameResponse | 400 ValidationProblem, 409 Conflict |
| GET  | /api/v1/[resource]/{id} | [Policy] | — | 200 QueryNameResponse | 404 NotFound |

### Validation Rules

| Field | Rule |
|-------|------|
| Name | Required; MaxLength(200); No leading/trailing whitespace |
| Amount | GreaterThan(0); LessThanOrEqualTo(1_000_000) |

### Database Changes

**Migration:** `[YYYYMMDDHHMMSS]_Add[EntityName]Table`

| Table | Change | Columns |
|-------|--------|---------|
| [table_name] | Create | id UUID PK, name VARCHAR(200) NOT NULL, ... |

**Indexes:**
- `IX_[table]_[col]` on `[col]` (non-unique, for query performance)

**Migration Down:** Drops `[table_name]`.

### Integration Events (if applicable)

| Event | Topic | Payload | Consuming Services |
|-------|-------|---------|-------------------|
| [EventName] | [topic-name] | `{ id, name, occurredAt }` | [ServiceA, ServiceB] |

---

## Frontend Specification

### User Flow

1. User navigates to [route]
2. User sees [component] with [loading state]
3. User [action] → [result]
4. On success: [behaviour — toast, redirect, cache invalidation]
5. On error: [behaviour — inline error, toast, retry button]

### API Integration

| Hook | Query Key | Stale Time | Notes |
|------|-----------|------------|-------|
| `use[Resource]` | `['resource', id]` | 5 min | Refetch on window focus |
| `use[Create]` | mutation | — | Invalidates `['resource']` on success |

### Component Tree

```
[FeaturePage]
  └── [FeatureLayout]
        ├── [ListPanel]
        │     ├── [SearchBar]
        │     └── [ItemCard] (repeated)
        └── [DetailPanel]
              └── [ActionForm]
```

Props interfaces for each new component:
```typescript
interface ItemCardProps {
  item: ItemSummary;
  onSelect: (id: string) => void;
  isSelected?: boolean;
}
```

### State Management

[SliceName if new Zustand/Redux state is needed]
```typescript
interface [Feature]State {
  selectedId: string | null;
  filterParams: [FilterType];
}
```

### Form Validation (Zod)

```typescript
const [FormName]Schema = z.object({
  name: z.string().min(1).max(200),
  amount: z.number().positive().max(1_000_000),
});
type [FormName]Values = z.infer<typeof [FormName]Schema>;
```

### Loading / Empty / Error States

| State | Component | Behaviour |
|-------|-----------|-----------|
| Loading | `[Component]Skeleton` | Show skeleton for up to 3 seconds |
| Empty | `EmptyState` | "No [items] found." + CTA button |
| Error | `ErrorMessage` | Human-readable message + Retry button |

---

## Acceptance Criteria

Each criterion must be testable: Subject + Condition + Observable Outcome.

1. **Given** a broker is authenticated, **when** they click Export, **then**
   the browser downloads a `.csv` file named `clients-YYYY-MM-DD.csv`.

2. **Given** the broker applies a filter, **when** they export, **then** the CSV
   contains only the filtered rows, not the broker's full client list.

3. **Given** the export endpoint is called by a broker who does not own the
   specified brokerId, **then** the API returns `403 Forbidden`.

4. **Given** the client list is empty after filtering, **when** the broker
   exports, **then** the CSV contains only the header row and no data rows.

[Continue for every in-scope behaviour]

---

## Security Considerations

- Auth requirement: [policy name, roles, claims required]
- Data sensitivity: [PII fields, encryption at rest/transit]
- Known risks: [IDOR risk, rate limiting needed, etc.]
- Mitigations: [specific controls in place]
```

---

## Example Invocation

**Scenario:** `broker-client-csv-export` clarification + constitution confirmed.

Agent assembles the spec, validates that all 7 open questions have answers in
the clarification record, verifies the API endpoint table matches the
constitution, and saves `specs/features/broker-client-csv-export.md`.

Output:
> ✅ Spec written to `specs/features/broker-client-csv-export.md`
> 7 acceptance criteria defined.
> Security section includes IDOR mitigation (broker ownership check in handler).
> Next step: Run `/speckit-tasks` to sync the plan task board into progress.md,
> then `/speckit-git-feature broker-client-csv-export` to create the branch.

---

## Output

- File: `specs/features/[feature-slug].md` (the implementation contract)
- Terminal: validation summary (sections filled, criteria count, any gaps flagged)
