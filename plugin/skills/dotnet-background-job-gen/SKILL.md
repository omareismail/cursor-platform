---
name: dotnet-background-job-gen
description: "Runs the dotnet-background-job-gen workflow. Invoked as /dotnet-background-job-gen."
---

<!-- GENERATED from the cursor-platform source skill "dotnet-background-job-gen".
     Do not edit here - edit the source and re-run the plugin build. -->

# Skill: dotnet-background-job-gen

**Invocation:** `/dotnet-background-job-gen [job-name]`

---

## Overview

**Memory references:** `memory-bank/backendConventions.md`

`dotnet-background-job-gen` scaffolds a recurring or fire-and-forget background job
with idempotency guards, retry/backoff policy, observability, and unit tests already
wired in. The most common failure mode with background jobs is silent: the job runs,
fails, and nobody knows. This skill prevents that by ensuring every job has structured
logging, a dead-letter/failure path, and observable retry behaviour. If no job framework
is established in `memory-bank/techContext.md`, it runs `/speckit-options` to choose
one before generating anything.

---

## Steps

**Step 0 — Call `pattern-finder` for the nearest existing job.**

Run `/pattern-finder new background job for [job-purpose]`. Imitate the
matched job's error-handling/retry policy, logging, and how it reports
completion (metrics, health check, or both) — these vary more by team
convention than by framework choice, so Step 1's framework detection alone
won't capture them.

**Step 1 — Detect job framework.**

Read `memory-bank/techContext.md`:
- `Hangfire.*` → use Hangfire
- `Quartz.*` → use Quartz.NET
- Neither → use `IHostedService` with `PeriodicTimer`
- If unclear → run `/speckit-options` (Hangfire / Quartz / IHostedService)

**Step 2 — Generate the job class.**

Core requirements for every generated job:
- **Idempotency guard:** job must be safely re-runnable. Log a warning if the
  same work is already in progress; exit without error.
- **Structured logging:** log start, completion, and any error with job name +
  correlation ID
- **CancellationToken:** every async method accepts and honours `CancellationToken`

**IHostedService example (simple scheduled job):**
```csharp
public sealed class [JobName]Job(
    I[Dependency] dependency,
    ILogger<[JobName]Job> logger) : BackgroundService
{
    private static readonly TimeSpan Period = TimeSpan.FromMinutes(15);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Period);
        while (!stoppingToken.IsCancellationRequested && await timer.WaitForNextTickAsync(stoppingToken))
        {
            await RunJobSafelyAsync(stoppingToken);
        }
    }

    private async Task RunJobSafelyAsync(CancellationToken ct)
    {
        logger.LogInformation("[{JobName}] Starting run at {Time}", nameof([JobName]Job), DateTimeOffset.UtcNow);
        try
        {
            // Idempotency: check if a run is already in progress
            if (await dependency.IsRunInProgressAsync(ct))
            {
                logger.LogWarning("[{JobName}] Previous run still in progress — skipping", nameof([JobName]Job));
                return;
            }

            await dependency.ExecuteAsync(ct);
            logger.LogInformation("[{JobName}] Run completed successfully", nameof([JobName]Job));
        }
        catch (OperationCanceledException)
        {
            logger.LogWarning("[{JobName}] Run cancelled (app shutdown)", nameof([JobName]Job));
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "[{JobName}] Run failed", nameof([JobName]Job));
            // Do NOT rethrow — a crash in ExecuteAsync kills the background service permanently
        }
    }
}
```

**Hangfire example:**
```csharp
[AutomaticRetry(Attempts = 3, DelaysInSeconds = new[] { 60, 300, 900 })]
public sealed class [JobName]Job(I[Dependency] dependency, ILogger<[JobName]Job> logger)
{
    [JobDisplayName("[JobName]: {0}")]
    public async Task ExecuteAsync(string correlationId, CancellationToken ct = default)
    {
        using var logScope = logger.BeginScope(new { CorrelationId = correlationId });
        logger.LogInformation("[{JobName}] Starting", nameof([JobName]Job));
        await dependency.ExecuteAsync(ct);
        logger.LogInformation("[{JobName}] Completed", nameof([JobName]Job));
    }
}
```

**Step 3 — Register the job.**

```csharp
// In Program.cs / DI registration
builder.Services.AddHostedService<[JobName]Job>();

// Hangfire:
RecurringJob.AddOrUpdate<[JobName]Job>(
    "[job-name]",
    job => job.ExecuteAsync(Guid.NewGuid().ToString(), CancellationToken.None),
    Cron.Every15Minutes());
```

**Step 3b — Single-instance execution across replicas (distributed lock).**

The failure this prevents is not theoretical and not rare: **the job runs on
every replica at the same time.** Scale a service to three pods and a nightly
reconciliation posts three times. Idempotency (Step 2) makes a *retry* safe; it
does not make *concurrent* execution safe, because two instances can both pass a
check-then-write before either writes.

Ask first whether you need the lock at all:

| Job shape | Needs a distributed lock? |
|---|---|
| Reads and writes a shared table | **Yes** |
| Pulls from a queue with competing consumers | No — the broker already distributes |
| Idempotent by natural key, and duplicates are harmless | No, but say why in a comment |
| Moves money, posts to a ledger, or calls a partner | **Yes**, and fail closed |

Generate the lock using whatever the stack already has — do not introduce a
dependency for it (rule 10). Resolve from `technologyStack.md`:

| Already present | Use |
|---|---|
| Hangfire | `[DisableConcurrentExecution(timeoutSeconds)]` — built in |
| Quartz | `[DisallowConcurrentExecution]` (per-scheduler) + a DB lock for cross-node |
| Redis | `SET key value NX PX <ttl>` with a unique token, released only if the token matches |
| SQL Server | `sp_getapplock` inside the job's transaction |
| PostgreSQL | `pg_try_advisory_lock(key)` — session-scoped, released on disconnect |
| EF Core only | A `JobLocks` table with a unique constraint on job name + a lease expiry |

```csharp
// PostgreSQL advisory lock: the lease dies with the connection, which is what
// you want when a pod is killed mid-run.
await using var conn = await _dataSource.OpenConnectionAsync(ct);
var acquired = await conn.ExecuteScalarAsync<bool>(
    "SELECT pg_try_advisory_lock(@key)", new { key = JobLockKeys.NightlyReconciliation });

if (!acquired)
{
    // Not an error. Another replica owns this run.
    _logger.LogInformation("Reconciliation skipped: lock held by another instance");
    return;
}
try { await RunAsync(ct); }
finally { await conn.ExecuteAsync("SELECT pg_advisory_unlock(@key)", new { key = JobLockKeys.NightlyReconciliation }); }
```

**Three things that make a distributed lock wrong more often than absent:**

1. **A lock with no expiry.** A pod killed while holding it blocks the job
   forever, and the outage is silent until someone notices yesterday's
   reconciliation never ran. Always lease with a TTL.
2. **A TTL shorter than the job.** The lease expires mid-run, a second instance
   acquires it, and you have the concurrency you were preventing — now with two
   instances that both believe they are alone. Set the TTL above the p99 runtime
   and renew it for long jobs.
3. **Releasing someone else's lock.** After a TTL expiry the lock may belong to
   another instance. Release only if the token you wrote is still the token
   stored — an unconditional `DEL` is a correctness bug.

**Failing to acquire is normal, not an error.** Log it at Information and return.
An `Error` here trains everyone to ignore the job's logs.

Emit a metric for lock contention. Rising contention means the job is running
longer than its interval, which is the early warning before overlap becomes
backlog.

**Step 4 — Generate unit test for job logic.**

Tests decouple the scheduler from the job logic by testing the core method directly:

```csharp
public class [JobName]JobTests
{
    private readonly Mock<I[Dependency]> _depMock = new();
    private readonly [JobName]Job _sut;

    [Fact]
    public async Task ExecuteAsync_WhenRunInProgress_SkipsExecution()
    {
        _depMock.Setup(d => d.IsRunInProgressAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);
        await _sut.RunJobSafelyAsync(CancellationToken.None); // call internal method via InternalsVisibleTo
        _depMock.Verify(d => d.ExecuteAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task ExecuteAsync_WhenDepFails_DoesNotThrow()
    {
        _depMock.Setup(d => d.ExecuteAsync(It.IsAny<CancellationToken>())).ThrowsAsync(new Exception("boom"));
        var act = async () => await _sut.RunJobSafelyAsync(CancellationToken.None);
        await act.Should().NotThrowAsync(); // job must absorb errors
    }
}
```

---

## Example Invocation

**Command:** `/dotnet-background-job-gen OutboxMessageDispatcher`

Agent detects no Hangfire/Quartz in techContext.md, generates `IHostedService`-based
dispatcher with 5-second `PeriodicTimer`, idempotency guard (checks for in-flight
dispatch), structured logging, and error absorption. Also generates unit tests for
idempotency and error-absorption behaviours.

---

## Output

- New: `src/[Project].Infrastructure/BackgroundJobs/[JobName]Job.cs`
- Updated: DI registration in infrastructure module
- New: `tests/[Project].UnitTests/Infrastructure/[JobName]JobTests.cs`

