# Skill: dotnet-perf-profile

**Invocation:** `/dotnet-perf-profile [handler-or-endpoint]`

---

## Overview

**Memory references:** `memory-bank/performanceGuidelines.md`

`dotnet-perf-profile` performs a static review of a handler or endpoint for common
.NET performance pitfalls, and generates a BenchmarkDotNet scaffold for the hot path.
It explicitly distinguishes between what belongs in a micro-benchmark (allocations,
serialization cost, in-process logic) and what needs a load test (throughput under
concurrency, database behaviour under parallel load). Recommending a micro-benchmark
for something that needs a load test is a common mistake this skill avoids. Every
finding comes with a before/after code snippet, not just a description.

---

## Steps

**Step 1 — Static analysis for common pitfalls.**

Scan the target file for:

| Pitfall | Detection | Severity |
|---------|-----------|----------|
| N+1 EF Core queries | Loop containing `await db.X.FindAsync()` or query inside `.Select()` | MUST FIX |
| Missing `AsNoTracking()` on read-only queries | `.ToListAsync()` without `.AsNoTracking()` | SHOULD FIX |
| Sync-over-async (`.Result` / `.Wait()`) | Already caught by clean-code-guard | MUST FIX |
| Unnecessary `ToList()` before LINQ | `.ToList().Where(...)` instead of `.Where().ToList()` | SHOULD FIX |
| Excessive allocation: `new List<T>()` in hot path | Collection instantiation inside per-request code | INFO |
| String concatenation in loop | `string += value` in a loop | SHOULD FIX (use StringBuilder) |
| Boxing: value type in `object` parameter | `Dictionary<string, object>` with value types | INFO |
| Large object graph tracked by EF | `.Include()` chains > 3 levels | SHOULD FIX |
| Missing `ConfigureAwait(false)` in library code | Not needed in ASP.NET Core, INFO only | INFO |

**Step 2 — Generate BenchmarkDotNet scaffold.**

```csharp
// benchmarks/[Project].Benchmarks/[HandlerName]Benchmark.cs
[MemoryDiagnoser]
[SimpleJob(RuntimeMoniker.Net80)]
public class [HandlerName]Benchmark
{
    private [HandlerName] _handler = null!;
    private [CommandName] _command = null!;

    [GlobalSetup]
    public void Setup()
    {
        // Setup in-memory dependencies
        var repoMock = new Mock<I[Repository]>();
        repoMock.Setup(r => r.GetAsync(It.IsAny<CancellationToken>()))
                .ReturnsAsync([/* test data */]);
        _handler = new [HandlerName](repoMock.Object);
        _command = new [CommandName]([/* typical args */]);
    }

    [Benchmark(Baseline = true)]
    public async Task<[ResponseType]> Current_Implementation()
    {
        return await _handler.Handle(_command, CancellationToken.None);
    }

    // Add [Benchmark] for each proposed optimisation to compare
}
```

**Step 3 — Flag load-test vs. benchmark candidates.**

If the handler's hot path primarily involves:
- Database queries under concurrent load → **load test, not benchmark**
- External HTTP calls → **load test, not benchmark**
- Pure in-memory computation, serialisation, or LINQ → **benchmark is appropriate**

Output:
```
⚠ This handler's bottleneck is likely EF Core query performance under concurrent load,
not in-process logic. A micro-benchmark won't capture the real bottleneck.
Recommendation: Use k6 or JMeter for a load test against a real database.
BenchmarkDotNet scaffold is still provided for the in-process serialisation cost.
```

---

## Example Invocation

**Command:** `/dotnet-perf-profile GetBrokerClientsQueryHandler`

**Findings:**
```
[MUST FIX] src/.../GetBrokerClientsQueryHandler.cs:28
Category: Performance
Issue: N+1 query — foreach loop calls repo.GetPolicyCountAsync(clientId) per client.
  Before: foreach (var client in clients) { client.PolicyCount = await repo.GetPolicyCountAsync(client.Id); }
  After:  var policyMap = await repo.GetPolicyCountsByBrokerAsync(brokerId, ct);
          foreach (var client in clients) { client.PolicyCount = policyMap.GetValueOrDefault(client.Id); }

[SHOULD FIX] src/.../GetBrokerClientsQueryHandler.cs:18
Category: Performance
Issue: Missing AsNoTracking() on read-only list query.
  Before: return await context.Clients.Where(...).ToListAsync();
  After:  return await context.Clients.AsNoTracking().Where(...).ToListAsync();
```

Also generates `benchmarks/OrientPortal.Benchmarks/GetBrokerClientsHandlerBenchmark.cs`
and flags that the real bottleneck is DB throughput under concurrent requests (load test
recommendation, not micro-benchmark).

---

## Output

- Terminal: findings list (same severity format as dotnet-clean-code-guard)
- New: `benchmarks/[Project].Benchmarks/[Name]Benchmark.cs`
- Terminal: load-test vs. micro-benchmark guidance for the specific target
