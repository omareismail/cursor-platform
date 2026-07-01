# Skill: speckit-implement

**Invocation:** `/speckit-implement [TASK-ID]`

---

## Overview

`speckit-implement` generates production-ready code for a single task from the
plan task board — one task at a time, never batching multiple tasks in one call.
Before generating any code it runs a mandatory pre-flight check: the spec must
exist, all dependency tasks must be Done, and the project type must be confirmed.
It enforces both the architecture rules (via `02-dotnet-architecture-guard.mdc`
and `03-react-architecture-guard.mdc`) and the security rules (via
`04-security-guard.mdc`) during generation, refusing to produce code that
violates them. Every generated source file gets a corresponding test file stub
so tests are never an afterthought.

---

## Steps

**Step 1 — Pre-flight check (mandatory, blocks generation if any fail).**

1. Confirm `specs/features/[feature-slug].md` exists — abort with instructions if not
2. Read `memory-bank/systemPatterns.md` — every generated pattern must match
3. Read `memory-bank/techContext.md` — confirm framework versions (use exact versions)
4. Read `memory-bank/progress.md` — confirm all tasks listed in "Depends On" for
   this TASK-ID are marked Done. If not: output the blocking task IDs and stop.
5. Detect project type (`MODE=dotnet` / `MODE=react` / `MODE=fullstack`)

Output pre-flight summary:
```
Pre-flight: ✅ Spec found | ✅ systemPatterns loaded | ✅ Dependencies satisfied
Task: TASK-XXX | Layer: [Layer] | Size: [S/M/L]
Generating...
```

**Step 2 — Generate code for the task's layer.**

**Domain layer tasks:**
- Pure C# — no external package imports except result types and primitive utilities
- Rich domain model: private setters, factory methods, invariant checks
- Domain events as sealed records with an `OccurredAt : DateTimeOffset` property
- Never throw raw exceptions for business failures — return `Result<T>` or raise domain events
- Example: `Order.Create(lines)` returns `Result<Order>` not `Order` directly

**Application layer tasks:**
- MediatR handler implementing `IRequestHandler<TRequest, TResponse>`
- Validator in the same folder as the handler (FluentValidation)
- Only interfaces — never concrete Infrastructure types
- `CancellationToken` on every async method signature
- Logging via `ILogger<THandler>` — structured, no PII at INFO level

**Infrastructure layer tasks:**
- EF Core repository implementing the Application interface
- `AsNoTracking()` on all read-only queries
- No business logic — pure data access
- Outbox pattern wired if the handler emits integration events

**API layer tasks:**
- Minimal or controller endpoint delegating immediately to `IMediator.Send()`
- `[Authorize(Policy = "...")]` or `[AllowAnonymous]` with comment
- `[ProducesResponseType]` for all documented status codes
- `Results<T, ...>` or `IActionResult` return type matching the spec

**React API-layer tasks:**
- TypeScript interface in `src/types/api.ts` matching the .NET DTO field-for-field
- Fetcher function in `src/api/[resource].ts` — no React imports, pure async function
- React Query hook: `useQuery` or `useMutation` with typed generics, `QUERY_KEYS` constants

**React UI component tasks:**
- Named function export, typed props interface above the component
- Loading / empty / error states handled inline (never assume data is always available)
- Tailwind CSS classes — no inline styles
- Accessibility: `aria-label` on icon buttons, `htmlFor`/`id` pairs on form fields
- No direct API calls — consume the React Query hook

**React hook tasks:**
- Single responsibility
- Return a named object (not an array): `return { data, isLoading, error, refetch }`
- All returned values explicitly typed

**Step 3 — Generate test file stubs.**

For every source file generated, produce a corresponding test file stub in the
correct test project:

| Source | Test location | Test type |
|--------|--------------|-----------|
| Domain entity | `*.UnitTests/Domain/` | xUnit Fact/Theory |
| Application handler | `*.UnitTests/Application/` | xUnit + Moq/NSubstitute |
| Infrastructure repo | `*.IntegrationTests/Infrastructure/` | xUnit + TestContainers |
| API endpoint | `*.IntegrationTests/Api/` | WebApplicationFactory |
| React component | `src/[feature]/components/__tests__/` | RTL + vitest |
| React hook | `src/[feature]/hooks/__tests__/` | renderHook + vitest |

Test stubs include: class/function name, test method names matching acceptance
criteria, comment `// AC-N: [criterion text]` for traceability, and all
`Arrange / Act / Assert` sections marked but empty.

**Step 4 — Post-generation update.**

- Update `memory-bank/progress.md`: move TASK-ID to 🔄 In Progress
- Output a summary:

```
✅ Generated:
  src/Domain/[Entity].cs
  src/Application/[Feature]/[Command]Command.cs
  src/Application/[Feature]/[Command]Handler.cs
  tests/UnitTests/Application/[Command]HandlerTests.cs (stub — implement tests)

Next task: TASK-XXX ([description])
Run: /speckit-implement TASK-XXX
```

---

## Example Invocation

**Command:** `/speckit-implement TASK-003`

**Context:** `TASK-003 | Application | CreateBrokerClientExportCommand + Handler | M | TASK-001`

Pre-flight confirms TASK-001 (Domain entity) is Done. Agent reads the spec's
Commands section, generates `CreateBrokerClientExportCommand.cs`,
`CreateBrokerClientExportHandler.cs`, and `CreateBrokerClientExportValidator.cs`
in `src/Application/BrokerClients/Export/`. Also generates
`CreateBrokerClientExportHandlerTests.cs` stub in `tests/UnitTests/`.

---

## Output

- Source files written to the correct project folder (inferred from layer + project structure)
- Test file stubs written to the correct test project
- `memory-bank/progress.md` updated: TASK-ID → 🔄 In Progress
- Terminal summary: files created, tests to implement, next task suggestion
