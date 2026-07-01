# Skill: speckit-constitution

**Invocation:** `/speckit-constitution`

---

## Overview

**Memory references:** `memory-bank/architecture.md, memory-bank/technologyStack.md`

`speckit-constitution` converts the confirmed clarification record into the
non-negotiable technical contract for the feature. It defines every domain
entity, every API endpoint, every database change, and every frontend type
before a single line of implementation is written. Any technical decision not
settled during clarification is resolved here via `/speckit-options` (or the
same inline options format), never silently. Deviations from patterns
established in `memory-bank/systemPatterns.md` are flagged immediately and
require written justification. The constitution is the authoritative reference
that `speckit-specify`, `speckit-implement`, and `speckit-checklist` all
validate against.

---

## Steps

**Step 1 — Load context.**

Read in order:
1. `specs/clarifications/[feature-slug].md` — all confirmed decisions
2. `memory-bank/systemPatterns.md` — established patterns to follow
3. `memory-bank/techContext.md` — framework versions, package constraints
4. Existing domain models in `src/Domain/` (if .NET)
5. Existing type files in `src/types/` (if React)

**Step 2 — Flag any unresolved decision.**

If any technical decision required for the constitution has no answer in the
clarification record and no precedent in `systemPatterns.md`, run
`/speckit-options` (or produce the inline options block per rule 05) for that
decision before continuing. Never pick silently.

**Step 3 — Flag any deviation from systemPatterns.md.**

If the constitution requires a pattern that contradicts `systemPatterns.md`,
output:
> ⚠ Deviation from systemPatterns.md: [what the pattern says] vs [what this
> feature requires]. Justification required before proceeding:

Wait for written justification before continuing.

**Step 4 — Write the constitution document.**

**For .NET features:**

```markdown
## Domain Model
### New Entities
[Entity name, properties with types, invariants as bullet points]

### New Value Objects
[Name, backing type, validation rules]

### Domain Events
[EventName(property: Type, property: Type) — raised when: ...]

## Commands & Queries
### Commands
[CommandName]
  Request:  CommandNameCommand { Property: Type; ... }
  Response: CommandNameResponse { Property: Type; ... }
  Handler:  Application/[Feature]/CommandNameHandler.cs
  Validator: Application/[Feature]/CommandNameValidator.cs

### Queries
[QueryName]
  Request:  QueryNameQuery { Property: Type; ... }
  Response: QueryNameResponse { Property: Type; ... }

## API Endpoints
| Method | Path | Auth Policy | Request Body | Response | Error Codes |
|--------|------|-------------|--------------|----------|-------------|
| POST | /api/v1/[resource] | [Policy] | CommandNameCommand | 201 CommandNameResponse | 400, 409 |

## Validation Rules
[Per command: field → rule (e.g. Email must be a valid RFC 5322 address)]

## Database Changes
- Migration name: Add[EntityName]Table
- New tables: [table name, columns with types, indexes, FKs]
- Modified tables: [table name, change description]
- Rollback: [Down() migration description]

## New NuGet Dependencies
[Package name | version | justification]

## Integration Events (if applicable)
[EventName published on: [topic/exchange] | payload: { ... } | consuming services: [...]]
```

**For React features:**

```markdown
## New Routes / Pages
[Route path | Page component | Auth required]

## New Feature Modules
[features/[name]/ — purpose and responsibility]

## New Shared Components
[ComponentName — props interface, responsibilities]

## API Hooks (React Query)
[useHookName — queryKey: [...], queryFn: ..., staleTime: ...]

## New Zustand / Redux Slices
[SliceName — state shape: { ... }, actions: [...]]

## Form Schemas (Zod)
[FormName — fields with validation rules]

## New Environment Variables
[VITE_VARIABLE_NAME — purpose, required in: dev/staging/prod]

## New npm Dependencies
[Package | version | justification]
```

**For full-stack features:** include both sections above, plus:

```markdown
## API Contract Alignment
[For each endpoint: .NET response DTO vs React TypeScript interface — confirm they match field-for-field]
```

---

## Example Invocation

**Context:** Clarification record confirmed for `broker-client-csv-export`.

```markdown
## API Endpoints
| Method | Path | Auth Policy | Request | Response | Errors |
|--------|------|-------------|---------|----------|--------|
| GET | /api/v1/brokers/{brokerId}/clients/export | BrokerOwner | Query params: filters | 200 CSV stream (Content-Type: text/csv) | 400, 403, 404 |

## API Contract Alignment
**Server (C#):** No DTO — streams CsvWriter output directly via FileStreamResult
**Client (TS):** `async function exportBrokerClients(brokerId: string, filters: ClientFilters): Promise<Blob>`
Returns a Blob, triggered as anchor download in the browser.
```

---

## Output

- File: `specs/constitutions/[feature-slug]-constitution.md`
- Any `/speckit-options` outputs are appended inline
- Any deviation justifications are recorded in the constitution file
