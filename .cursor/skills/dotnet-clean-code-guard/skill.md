# Skill: dotnet-clean-code-guard

**Invocation:** `/dotnet-clean-code-guard [path]`
Default path: entire `src/` folder if none specified.

---

## Overview

**Memory references:** `memory-bank/codingStandards.md`

`dotnet-clean-code-guard` performs a comprehensive static review of a .NET
C# codebase against Clean Architecture rules, async best practices, naming
conventions, and design quality standards. It produces a structured findings
report with severity levels, file locations, problem descriptions, and
one-sentence fixes — never vague "this could be improved" feedback. Every
finding references either a specific rule from `02-dotnet-architecture-guard.mdc`
or a well-known .NET best practice, so the developer understands the "why" not
just the "what". Findings are separated into three tiers: MUST FIX (blocks
progress), SHOULD FIX (flagged for current sprint), and INFO (tracked in tech debt).

---

## Steps

**Step 1 — Determine scope.**

If a path argument is given, scan that path. Otherwise scan all `*.cs` files
under `src/`. Skip `bin/`, `obj/`, and `*.g.cs` (generated files).

**Step 2 — Load context.**

Read `memory-bank/systemPatterns.md` to understand the project's established
naming conventions, which may differ from defaults.

**Step 3 — Scan for findings using the checklist below.**

**Step 4 — Output findings in structured format.**

```
[SEVERITY] src/Path/To/File.cs:LINE
Category: [Architecture | Async | Naming | Design | Performance | Security]
Issue: [description of the specific problem found]
Fix:   [one-sentence correction]
```

Followed by a summary table:
```
════════════════════════════════
MUST FIX:   [N] findings
SHOULD FIX: [N] findings
INFO:       [N] findings
════════════════════════════════
```

---

## Findings Checklist

### MUST FIX

| Pattern | Detection method |
|---------|-----------------|
| Layer boundary violations | `using [ProjectName].[WrongLayer]` in wrong project |
| `.Result` / `.Wait()` on async code | Regex: `\.Result\b`, `\.Wait()` outside test files |
| Business logic in controllers | Controller method > 10 lines after the MediatR send call |
| Swallowed exceptions `catch (Exception) {}` | Empty catch body or catch with only a comment |
| `DbContext` directly in Application handlers | Constructor injection of any EF DbContext type |
| Public setters on Domain entities | `{ get; set; }` in Domain project classes |
| `IQueryable<T>` returned from repository interface | Return type `IQueryable` in `IRepository` definitions |

### SHOULD FIX

| Pattern | Detection method |
|---------|-----------------|
| Method > 20 lines | Line count per method |
| Constructor > 3 parameters (not a record/DTO) | Parameter count in constructor |
| Nesting depth > 3 | Indentation analysis |
| Missing `CancellationToken` on async I/O | `async Task` without `CancellationToken` parameter |
| Magic strings / magic numbers | Inline string literals > 10 chars or numeric literals > 3 digits in logic |
| Missing XML doc on public types | Public class/record/interface without `/// <summary>` |
| Non-async method names missing `Async` suffix | `Task<T>` return type without `Async` in method name |

### INFO

| Pattern | Detection method |
|---------|-----------------|
| Missing logging on important operations | Handler methods without `_logger` calls |
| Inconsistent naming vs systemPatterns.md | Names that diverge from established patterns |
| Test coverage gaps | Public methods in Application/Domain with no corresponding test file |

---

## Example Invocation

**Command:** `/dotnet-clean-code-guard src/OrientPortal.Application/`

**Sample output:**

```
[MUST FIX] src/OrientPortal.Application/Payments/ProcessPaymentHandler.cs:34
Category: Async
Issue: .Result used on async call: var result = _gateway.ChargeAsync(cmd).Result;
Fix:   Replace with: var result = await _gateway.ChargeAsync(cmd, cancellationToken);

[MUST FIX] src/OrientPortal.Application/Reports/ReportHandler.cs:12
Category: Architecture
Issue: Constructor injects AppDbContext directly — Application layer must not depend on EF Core.
Fix:   Extract an IReportRepository interface and inject that instead; move DbContext to Infrastructure.

[SHOULD FIX] src/OrientPortal.Application/Brokers/GetBrokerQuery.cs:1
Category: Naming
Issue: Class 'GetBrokerQueryHandler' has no corresponding test in *.UnitTests.
Fix:   Create tests/OrientPortal.UnitTests/Application/Brokers/GetBrokerQueryHandlerTests.cs

════════════════════════════════
MUST FIX:   2 findings
SHOULD FIX: 1 finding
INFO:       0 findings
════════════════════════════════
```

---

## Output

- Terminal: structured findings list with severity, location, and fix instructions
- Terminal: summary table (MUST FIX / SHOULD FIX / INFO counts)
- Optional: SHOULD FIX and INFO items can be logged via `/technical-debt-tracker log`
