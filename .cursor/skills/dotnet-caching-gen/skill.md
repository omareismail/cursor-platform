# Skill: dotnet-caching-gen

**Invocation:** `/dotnet-caching-gen [query-name]`

---

## Overview

**Memory references:** `memory-bank/performanceGuidelines.md`

`dotnet-caching-gen` adds a caching layer to a read-heavy query handler, including
an explicit cache invalidation strategy wired to the commands/events that mutate the
cached data. Caching without invalidation is a future bug disguised as a performance
improvement — this skill refuses to generate a cache-aside pattern without also
generating the corresponding invalidation hooks. It uses whatever cache tier is
established in `memory-bank/techContext.md`, or invokes `/speckit-options` to choose
one if the project has not yet committed to a caching strategy.

---

## Steps

**Step 0 — Call `pattern-finder` for the nearest existing cached query.**

Run `/pattern-finder new cache layer for [query-name]`. Imitate the matched
example's key-naming scheme, invalidation trigger pattern, and TTL
convention — cache key collisions between unrelated features are a common
source of subtle bugs when each generation invents its own naming scheme.

**Step 1 — Verify the target query is read-only.**

Read the handler file. If the handler has any write operations (`SaveChangesAsync`,
`Add`, `Remove`, event publishing), output:
```
❌ [QueryName] appears to have side effects. Caching a handler with side effects
   will cause those effects to be skipped on cache hits. Verify this is a
   read-only query before adding a cache layer.
```

**Step 2 — Choose the caching tier.**

Read `memory-bank/techContext.md` for caching packages:
- `FusionCache` + `StackExchange.Redis` → use `IFusionCache`
- `Microsoft.Extensions.Caching.Memory` only → use `IMemoryCache` (flag scale limitation)
- None → run `/speckit-options` (in-memory / distributed Redis / output caching)

**Step 3 — Generate cache-aside logic in the handler.**

```csharp
public class GetProductCatalogHandler(
    IProductRepository repo,
    IFusionCache cache,
    ILogger<GetProductCatalogHandler> logger) : IRequestHandler<GetProductCatalogQuery, ProductCatalogResponse>
{
    private static readonly string CacheKey = "catalog:products:all";
    private static readonly TimeSpan CacheDuration = TimeSpan.FromMinutes(5);

    public async Task<ProductCatalogResponse> Handle(GetProductCatalogQuery query, CancellationToken ct)
    {
        var result = await cache.GetOrSetAsync(
            CacheKey,
            async _ =>
            {
                logger.LogInformation("Cache miss — loading product catalog from database");
                return await repo.GetAllAsync(ct);
            },
            new FusionCacheEntryOptions { Duration = CacheDuration },
            ct);

        logger.LogDebug("Product catalog served from {Source}", result.Source);
        return new ProductCatalogResponse(result.Value);
    }
}
```

**Step 4 — Generate explicit invalidation in command handlers.**

For every command in the project that mutates the cached data (detected by looking
for writes to the same repository):

```csharp
// In CreateProductCommandHandler, UpdateProductCommandHandler, etc.
// Add after SaveChangesAsync:

await cache.RemoveAsync("catalog:products:all", token: ct);
logger.LogInformation("Cache invalidated: catalog:products:all (product data changed)");
```

**Step 5 — Add cache-hit/miss metric.**

```csharp
// Cache hit: result.Source == CacheSource.L1InMemory or L2Distributed
// Cache miss: result.Source == CacheSource.None (fetched from factory)
_meter.CacheHit(result.IsSuccess && result.Source != CacheSource.None);
```

**Step 6 — Generate a cache invalidation test.**

```csharp
[Fact]
public async Task CreateProduct_AfterCreation_CacheIsInvalidated()
{
    // Arrange: populate cache
    await cache.SetAsync(GetProductCatalogHandler.CacheKey, oldProducts, new FusionCacheEntryOptions());
    var command = new CreateProductCommand(/* ... */);

    // Act
    await handler.Handle(command, CancellationToken.None);

    // Assert: cache entry gone
    var cached = await cache.TryGetAsync<IReadOnlyList<Product>>(GetProductCatalogHandler.CacheKey);
    cached.HasValue.Should().BeFalse();
}
```

---

## Example Invocation

**Command:** `/dotnet-caching-gen GetBrokerCatalogQuery`

Agent detects FusionCache in techContext.md, adds cache-aside to the query handler
(5-minute TTL, key `"catalog:broker:{brokerId}"`), and adds `cache.RemoveAsync` calls
to `UpdateBrokerCatalogCommandHandler` and `DeleteCatalogItemCommandHandler`. Also
generates the invalidation test.

---

## Output

- Updated: `src/[Project].Application/[Feature]/Get[Name]Handler.cs` (cache-aside added)
- Updated: mutating handler files (invalidation calls added)
- New: `tests/[Project].UnitTests/Application/[Name]CacheInvalidationTests.cs`
- Terminal: summary of cache key strategy, TTL, and invalidation trigger list
