# Skill: dotnet-endpoint-gen

**Invocation:** `/dotnet-endpoint-gen [spec-section]`

---

## Overview

**Memory references:** `memory-bank/apiConventions.md, memory-bank/backendConventions.md, memory-bank/businessRules.md`

`dotnet-endpoint-gen` generates a complete, production-ready API endpoint from the
spec's API Endpoints table — either as a minimal API endpoint group or a controller
action, based on the project's established pattern in `memory-bank/systemPatterns.md`.
It generates the endpoint, all request/response DTO records, OpenAPI annotations, and
the corresponding integration test in a single pass so the API surface is immediately
testable. Every endpoint gets the correct `[Authorize]` or `[AllowAnonymous]` attribute
(with a comment justifying the latter), and all documented error codes are represented
as typed `Results<T, ...>` return types.

---

## Steps

**Step 0 — Call `pattern-finder` for the nearest existing endpoint.**

Run `/pattern-finder new endpoint for [resource/action]` before reading the
spec. Imitate the returned example's controller-vs-minimal-API style, auth
attribute placement, validation approach, and error-response shape — the spec
defines *what* the endpoint does, the matched pattern defines *how this repo
writes endpoints*. If no close match exists (genuinely new resource type),
proceed to Step 1 using `apiConventions.md` alone and note this is a
first-of-its-kind endpoint so future `pattern-finder` calls can match it.

**Step 1 — Read the spec's API Endpoints section.**

If `[spec-section]` is a table row (e.g. `POST /api/v1/brokers/{id}/clients/export`),
extract: Method, Path, Auth Policy, Request Body, Success Response, Error Codes.

**Step 2 — Detect endpoint style (minimal API vs controller).**

Check `memory-bank/systemPatterns.md` for the project's API style. Default: minimal API
if not specified.

**Step 3 — Generate DTO records.**

```csharp
// Request DTO (if the endpoint accepts a request body)
public sealed record CreateOrderRequest(
    [Required] Guid BrokerId,
    [Required][MinLength(1)] IReadOnlyList<OrderLineDto> Lines
);

// Response DTO
public sealed record CreateOrderResponse(
    Guid OrderId,
    DateTimeOffset CreatedAt,
    decimal Total
);

// Error extension (if custom error responses are needed)
```

**Step 4 — Generate the endpoint.**

**Minimal API style:**
```csharp
app.MapPost("/api/v1/orders", async (
    [FromBody] CreateOrderRequest request,
    IMediator mediator,
    CancellationToken ct) =>
{
    var result = await mediator.Send(new CreateOrderCommand(request.BrokerId, request.Lines), ct);

    return result.IsSuccess
        ? Results.Created($"/api/v1/orders/{result.Value.OrderId}", result.Value)
        : result.ToProblemDetails();
})
.WithName("CreateOrder")
.WithSummary("Create a new order for a broker")
.WithTags("Orders")
.Produces<CreateOrderResponse>(StatusCodes.Status201Created)
.ProducesValidationProblem()
.Produces(StatusCodes.Status409Conflict)
.RequireAuthorization("BrokerPolicy");
```

**Controller style:**
```csharp
[ApiController]
[Route("api/v1/[controller]")]
[Authorize(Policy = "BrokerPolicy")]
public sealed class OrdersController(IMediator mediator) : ControllerBase
{
    [HttpPost]
    [ProducesResponseType<CreateOrderResponse>(StatusCodes.Status201Created)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    [SwaggerOperation(Summary = "Create a new order for a broker")]
    public async Task<IActionResult> CreateOrder(
        [FromBody] CreateOrderRequest request,
        CancellationToken ct)
    {
        var result = await mediator.Send(new CreateOrderCommand(request.BrokerId, request.Lines), ct);
        return result.IsSuccess
            ? CreatedAtAction(nameof(GetOrder), new { id = result.Value.OrderId }, result.Value)
            : result.ToProblemDetails();
    }
}
```

**Step 5 — Generate the integration test.**

```csharp
public class CreateOrderEndpointTests(WebAppFactory factory) : IClassFixture<WebAppFactory>
{
    [Fact]
    // AC-1: Authenticated broker with valid lines receives 201
    public async Task Post_ValidRequest_Returns201WithOrderId()
    {
        // Arrange
        var client = factory.CreateAuthenticatedClient("broker-policy");
        var request = new CreateOrderRequest(BrokerId: Guid.NewGuid(), Lines: [/* ... */]);

        // Act
        var response = await client.PostAsJsonAsync("/api/v1/orders", request);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var body = await response.Content.ReadFromJsonAsync<CreateOrderResponse>();
        body!.OrderId.Should().NotBeEmpty();
    }

    [Fact]
    // AC-3: Unauthenticated request receives 401
    public async Task Post_Unauthenticated_Returns401()
    {
        // ...
    }
}
```

---

## Example Invocation

**Command:** `/dotnet-endpoint-gen "GET /api/v1/brokers/{brokerId}/clients/export"`

Agent reads spec, generates streaming `FileStreamResult` endpoint with BrokerOwner
authorization policy, `ExportBrokerClientsRequest` query params DTO, and integration
test covering AC-1 (authenticated, filtered), AC-3 (IDOR attempt → 403), AC-4 (empty export).

---

## Output

- File: `src/[Project].API/Endpoints/[Resource]/[Name]Endpoint.cs` (or Controllers/)
- File: `src/[Project].API/Contracts/[Name]Request.cs` + `[Name]Response.cs`
- File: `tests/[Project].IntegrationTests/Api/[Name]EndpointTests.cs`
