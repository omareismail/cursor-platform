# Skill: dotnet-observability-gen

**Invocation:** `/dotnet-observability-gen [scope]`
Scope: a handler name, endpoint name, or "project" to wire the whole API.

---

## Overview

**Memory references:** `memory-bank/deploymentNotes.md`

`dotnet-observability-gen` wires structured logging, distributed tracing, and
metrics into a .NET handler, endpoint, or whole API project. It matches whatever
observability stack is already declared in `memory-bank/techContext.md` (Serilog,
OpenTelemetry, Application Insights) rather than introducing a new one. If no
observability stack is established, it invokes `/speckit-options` to choose one
before generating anything. It enforces the security rule that PII and payment
data are never logged at INFO level, and ensures correlation IDs propagate through
every log scope.

---

## Steps

**Step 1 — Detect existing observability stack.**

Read `memory-bank/techContext.md` and scan `*.csproj` for packages:
- `Serilog.*` → use Serilog structured logging
- `OpenTelemetry.*` → use OTEL Activity API for tracing
- `Microsoft.ApplicationInsights.*` → use App Insights TelemetryClient
- None found → run `/speckit-options` to choose before continuing

**Step 2 — Determine scope.**

- **Handler scope:** add `ILogger<THandler>`, structured log scopes, and
  an `Activity` span for cross-service calls within the handler
- **Endpoint scope:** add correlation ID to every log scope at the endpoint level
- **Project scope:** wire DI registration, enrichers, and `/health` endpoint

**Step 3 — Generate observability code.**

**Structured logging in a handler:**
```csharp
public class ExportBrokerClientsHandler(
    IBrokerClientRepository repo,
    ICsvExportWriter csvWriter,
    ILogger<ExportBrokerClientsHandler> logger) : IRequestHandler<...>
{
    public async Task<Result<Stream>> Handle(ExportBrokerClientsQuery query, CancellationToken ct)
    {
        using var activity = Telemetry.ActivitySource.StartActivity("ExportBrokerClients");
        activity?.SetTag("broker.id", query.BrokerId); // non-PII tag

        using var logScope = logger.BeginScope(new Dictionary<string, object>
        {
            ["BrokerId"] = query.BrokerId,
            ["CorrelationId"] = Activity.Current?.TraceId.ToString() ?? Guid.NewGuid().ToString()
            // NEVER log: email, name, phone, payment details at INFO
        });

        logger.LogInformation("Starting broker client export for {BrokerId}", query.BrokerId);

        try
        {
            var clients = await repo.GetFilteredAsync(query.BrokerId, query.Filters, ct);
            logger.LogInformation("Exporting {ClientCount} clients", clients.Count);
            // ...
            logger.LogInformation("Export complete. Rows: {RowCount}", rowCount);
            return Result.Success(stream);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Export failed for broker {BrokerId}", query.BrokerId);
            activity?.SetStatus(ActivityStatusCode.Error, ex.Message);
            throw;
        }
    }
}
```

**Health endpoint** (if not present):
```csharp
app.MapHealthChecks("/health", new HealthCheckOptions
{
    ResponseWriter = UIResponseWriter.WriteHealthCheckUIResponse
}).AllowAnonymous(); // Public — no sensitive data exposed
```

**Serilog project-level setup:**
```csharp
builder.Host.UseSerilog((ctx, lc) => lc
    .ReadFrom.Configuration(ctx.Configuration)
    .Enrich.FromLogContext()
    .Enrich.WithCorrelationId()
    .Enrich.WithProperty("ServiceName", "OrientPortal.API")
    .WriteTo.Console(new RenderedCompactJsonFormatter())
    .WriteTo.ApplicationInsights(ctx.Configuration["ApplicationInsights:InstrumentationKey"],
        TelemetryConverter.Traces));
```

**Step 4 — Security check.**

Before finalising, scan the generated code for any log call that includes:
- Email addresses, phone numbers, full names
- Any field named `Password`, `Token`, `CardNumber`, `Cvv`

If found: replace with masked versions or remove.

---

## Example Invocation

**Command:** `/dotnet-observability-gen ExportBrokerClientsHandler`

Agent detects Serilog + OpenTelemetry in `techContext.md`, adds `ILogger<>` and
`ActivitySource` span to the handler, adds structured log scope with BrokerId and
CorrelationId, verifies no PII is logged at INFO. Outputs the updated handler file.

---

## Output

- Updated source file(s) with logging + tracing added
- Terminal: summary of what was added (log lines, Activity spans, health endpoint)
