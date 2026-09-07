# Skill: dotnet-messaging-gen

**Invocation:** `/dotnet-messaging-gen [event-name]`

---

## Overview

**Memory references:** `memory-bank/backendConventions.md`

`dotnet-messaging-gen` scaffolds an integration event using the outbox pattern,
ensuring that a message publish failure can never desync from the database write
that triggered it. The outbox pattern is non-negotiable for integration events —
fire-and-forget publishes are not generated. The skill produces the event contract
in the `Contracts` layer (zero dependencies), the outbox table entry written in the
same transaction as the domain change, the background dispatcher that drains the
outbox, and a consumer stub interface for downstream services. If the message bus
choice (Azure Service Bus / MassTransit / raw outbox) is not established in
`memory-bank/techContext.md`, it runs `/speckit-options` first.

---

## Steps

**Step 0 — Call `pattern-finder` for the nearest existing event/consumer.**

Run `/pattern-finder new event contract for [event-name]` before detecting
infrastructure — if this bounded context already has MassTransit consumers,
imitate their outbox/retry/dead-letter configuration rather than
re-deriving it from defaults, even after Step 1 confirms which broker is in
use.

**Step 1 — Detect messaging infrastructure.**

Read `memory-bank/techContext.md` for:
- `MassTransit.*` → use MassTransit with outbox middleware
- `Azure.Messaging.ServiceBus` → use Azure Service Bus with custom outbox table
- None → run `/speckit-options` (MassTransit / Azure Service Bus / Minimal outbox table)

**Step 2 — Define event contract in Contracts layer.**

```csharp
// src/[Project].Contracts/Events/[EventName].cs
namespace [Project].Contracts.Events;

/// <summary>Published when [describe the domain event].</summary>
public sealed record [EventName](
    Guid EventId,
    Guid [AggregateId],
    string [RelevantData],
    DateTimeOffset OccurredAt
) : IIntegrationEvent
{
    public static [EventName] From([DomainEvent] domainEvent) => new(
        EventId: Guid.NewGuid(),
        [AggregateId]: domainEvent.[AggregateId],
        [RelevantData]: domainEvent.[RelevantData],
        OccurredAt: domainEvent.OccurredAt
    );
}
```

**Step 3 — Add outbox table entry in the same transaction.**

```csharp
// In the Application handler, after domain write:

// Map domain event → integration event
var integrationEvent = [EventName].From(domainEvent);

// Write to outbox in the same EF Core transaction
context.OutboxMessages.Add(new OutboxMessage
{
    Id = integrationEvent.EventId,
    Type = typeof([EventName]).AssemblyQualifiedName!,
    Payload = JsonSerializer.Serialize(integrationEvent),
    CreatedAt = DateTimeOffset.UtcNow,
    Status = OutboxMessageStatus.Pending
});

await context.SaveChangesAsync(ct); // outbox + domain change in one transaction
```

**Step 4 — Generate or reuse the outbox dispatcher.**

If no outbox dispatcher exists, scaffold one:

```csharp
// src/[Project].Infrastructure/Messaging/OutboxDispatcher.cs
public sealed class OutboxDispatcher(
    AppDbContext context,
    IMessageBus bus,
    ILogger<OutboxDispatcher> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            await ProcessPendingMessages(stoppingToken);
            await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
        }
    }

    private async Task ProcessPendingMessages(CancellationToken ct)
    {
        var pending = await context.OutboxMessages
            .Where(m => m.Status == OutboxMessageStatus.Pending)
            .OrderBy(m => m.CreatedAt)
            .Take(50)
            .ToListAsync(ct);

        foreach (var message in pending)
        {
            try
            {
                var type = Type.GetType(message.Type)!;
                var payload = JsonSerializer.Deserialize(message.Payload, type)!;
                await bus.PublishAsync(payload, ct);
                message.Status = OutboxMessageStatus.Sent;
                message.SentAt = DateTimeOffset.UtcNow;
                logger.LogInformation("Outbox message {Id} ({Type}) sent", message.Id, type.Name);
            }
            catch (Exception ex)
            {
                message.RetryCount++;
                message.Status = message.RetryCount >= 5
                    ? OutboxMessageStatus.DeadLetter : OutboxMessageStatus.Pending;
                logger.LogError(ex, "Failed to dispatch outbox message {Id}", message.Id);
            }
        }
        await context.SaveChangesAsync(ct);
    }
}
```

**Step 5 — Generate consumer stub.**

```csharp
// src/[Project].Contracts/Consumers/I[EventName]Consumer.cs
public interface I[EventName]Consumer
{
    Task ConsumeAsync([EventName] @event, CancellationToken ct);
}
```

**Step 5b — Inbox: the consumer half of the outbox.**

The outbox guarantees the message is **published at least once**. That is the
whole guarantee — and "at least once" means duplicates will arrive. Broker
redelivery after a consumer crash, a network timeout that was actually a success,
a partition rebalance: all produce a second delivery of a message already
processed.

Without a consumer-side dedupe, at-least-once delivery becomes at-least-once
*processing*. In a payments context that is a duplicate posting.

```csharp
// Dedupe on the message id, in the same transaction as the business effect.
// If the insert violates the unique constraint, this message has been handled.
public async Task Consume(ConsumeContext<PaymentSettledEvent> ctx)
{
    await using var tx = await _db.Database.BeginTransactionAsync(ctx.CancellationToken);

    _db.InboxMessages.Add(new InboxMessage(ctx.MessageId!.Value, nameof(PaymentSettledEvent), _clock.UtcNow));
    try { await _db.SaveChangesAsync(ctx.CancellationToken); }
    catch (DbUpdateException e) when (e.IsUniqueViolation())
    {
        _logger.LogInformation("Duplicate {MessageId} ignored", ctx.MessageId);
        return;                       // already processed - not an error
    }

    await _handler.HandleAsync(ctx.Message, ctx.CancellationToken);
    await _db.SaveChangesAsync(ctx.CancellationToken);
    await tx.CommitAsync(ctx.CancellationToken);
}
```

Two properties that make this work, and fail quietly if you drop either:

1. **The dedupe row and the business effect share one transaction.** Insert the
   inbox row in its own transaction and you can record "handled" for work that
   then rolls back — the message is now permanently lost.
2. **The inbox table needs a retention job.** It grows forever otherwise. Keep
   entries longer than the broker's maximum redelivery window, then prune.

Skip the inbox only when the handler is genuinely idempotent by natural key —
and when you skip it, write down why, next to the handler.

**Step 5c — Dead letter queues: where messages go to be noticed.**

A message that fails every retry must go somewhere a human will look. The two
common outcomes are both bad: it is dropped, or it is retried forever and blocks
the partition behind it.

| Setting | Guidance |
|---|---|
| Max delivery attempts | 3–5 with exponential backoff **and jitter**. Without jitter, every consumer retries in lockstep and you rebuild the spike that caused the failure. |
| Retryable vs not | Retry timeouts, 5xx, deadlocks. **Do not retry** validation failures, 4xx, or deserialization errors — they will fail identically every time. Send those straight to the DLQ. |
| Poison-message guard | A message that fails deserialization must never re-enter the main queue. It cannot succeed and it will block everything behind it. |
| DLQ depth | **Alert on it.** A DLQ nobody monitors is a silent data-loss queue with extra steps. Wire it in `/operability-gen`. |
| Replay | Provide a documented, idempotent replay path. Replay without an inbox re-processes everything — which is why 5b comes first. |

State the ordering consequence explicitly: with a DLQ, message N+1 is processed
while N sits dead-lettered. **If the events are order-dependent, that is silent
corruption.** Either the handler tolerates out-of-order delivery, or the stream
must halt on failure — and halting is a deliberate availability trade, not a
default.

**Step 5d — Saga, when one transaction is not possible.**

An outbox makes *one* service's write and publish atomic. It does nothing for a
business operation spanning several services — book, charge, issue — where there
is no shared transaction.

Offer both shapes with the trade-off, per rule 05:

| | Orchestration | Choreography |
|---|---|---|
| **Shape** | One coordinator calls each step | Each service reacts to the previous event |
| **Flow is** | Explicit and in one file | Emergent — you reconstruct it from traces |
| **Failure handling** | Centralised, testable | Distributed across services |
| **Coupling** | Coordinator knows every step | Services know only their own events |
| **Prefer when** | The flow is long, has compensations, or must be auditable — **most fintech flows** | Two or three steps, genuinely independent services |

For anything touching money, recommend **orchestration**. When a regulator asks
why a payment ended in this state, "read the coordinator" is an answer;
"reconstruct it from six services' event logs" is not.

**Every step needs a compensating action, and compensation is not rollback.**
You cannot un-charge a card; you issue a refund. That refund is a new, visible,
auditable business event with its own failure modes — including failing itself.

```
Reserve inventory   → compensate: release reservation
Charge payment      → compensate: issue refund        (new event, can fail)
Issue policy        → compensate: cancel policy       (may need regulatory notice)
```

Persist saga state — a saga that lives in memory does not survive the restart it
exists to handle. Give every saga a **timeout** and a terminal state: a saga
stuck at step 2 forever is worse than one that failed, because nothing alerts on
it. And record the eventual-consistency window in the spec, because the UI has
to show the user something truthful while the saga is in flight.

**Step 6 — Generate integration test.**

```csharp
[Fact]
public async Task Handle_DomainChange_PublishesEventViaOutbox()
{
    // Uses TestContainers or in-memory bus
    await context.SaveChangesAsync();
    var outboxEntry = await context.OutboxMessages.FirstOrDefaultAsync(m => m.Type.Contains("[EventName]"));
    outboxEntry.Should().NotBeNull();
    outboxEntry!.Status.Should().Be(OutboxMessageStatus.Pending);
}
```

---

## Example Invocation

**Command:** `/dotnet-messaging-gen BrokerClientExported`

Agent generates `BrokerClientExported` contract, adds outbox write to the export
handler, wires the MassTransit outbox (detected in techContext.md), generates the
consumer stub, and adds an integration test verifying the outbox entry is written
when the handler runs.

---

## Output

- New: `src/[Project].Contracts/Events/[EventName].cs`
- Updated: Application handler (outbox write added)
- New (if not exists): `src/[Project].Infrastructure/Messaging/OutboxDispatcher.cs`
- New: `src/[Project].Contracts/Consumers/I[EventName]Consumer.cs`
- New: integration test verifying outbox entry creation
