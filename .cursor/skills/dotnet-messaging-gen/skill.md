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
