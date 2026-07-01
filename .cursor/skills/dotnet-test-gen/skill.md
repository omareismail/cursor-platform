# Skill: dotnet-test-gen

**Invocation:** `/dotnet-test-gen [source-file-path]`

---

## Overview

**Memory references:** `memory-bank/testingStandards.md`

`dotnet-test-gen` generates a complete, runnable test file for a given .NET source
file. It analyses the source to determine whether it is a domain entity, a MediatR
handler/query, or a repository, and generates the appropriate test pattern for each:
pure xUnit for domain logic, xUnit with Moq/NSubstitute for handlers, and xUnit with
TestContainers for repository integration tests. Every test method is named to clearly
describe the scenario being tested (Given_When_Then or MethodName_Condition_ExpectedResult),
and each test that validates an acceptance criterion includes the `// AC-N:` comment for
spec traceability.

---

## Steps

**Step 1 — Identify the source file type.**

Read the source file and classify as:
- **Domain entity/aggregate** → unit test with no mocks
- **MediatR command handler** → unit test with mocked dependencies
- **MediatR query handler** → unit test with mocked repository
- **FluentValidation validator** → unit test with `TestValidate()`
- **Repository (Infrastructure)** → integration test with TestContainers
- **API controller/endpoint** → integration test with `WebApplicationFactory`

**Step 2 — Read the spec for acceptance criteria.**

Find `specs/features/[feature-slug].md` from `memory-bank/WORKING_ON.md`.
Map acceptance criteria to test method names. Add `// AC-N:` comment to each
corresponding test.

**Step 3 — Generate the test file.**

**For MediatR Handlers:**
```csharp
public class [HandlerName]Tests
{
    private readonly Mock<I[Repository]> _repoMock = new();
    private readonly Mock<ILogger<[HandlerName]>> _loggerMock = new();
    private readonly [HandlerName] _sut;

    public [HandlerName]Tests()
    {
        _sut = new [HandlerName](_repoMock.Object, _loggerMock.Object);
    }

    [Fact]
    // AC-1: [criterion text]
    public async Task Handle_ValidCommand_Returns[ExpectedResult]()
    {
        // Arrange
        var command = new [CommandName]([validArgs]);
        _repoMock.Setup(r => r.[Method](It.IsAny<...>(), It.IsAny<CancellationToken>()))
                 .ReturnsAsync([expectedResult]);

        // Act
        var result = await _sut.Handle(command, CancellationToken.None);

        // Assert
        result.IsSuccess.Should().BeTrue();
        result.Value.Should().NotBeNull();
        _repoMock.Verify(r => r.[SaveMethod](It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Handle_[NegativeCondition]_Returns[ExpectedError]()
    {
        // Arrange
        // ...

        // Act
        var result = await _sut.Handle(command, CancellationToken.None);

        // Assert
        result.IsFailure.Should().BeTrue();
        result.Error.Should().Contain("[expected error message fragment]");
    }
}
```

**For Domain Entities:**
```csharp
public class [EntityName]Tests
{
    [Fact]
    public void Create_ValidArgs_ReturnsSuccessResult()
    {
        // Arrange
        // Act
        var result = [EntityName].Create([validArgs]);

        // Assert
        result.IsSuccess.Should().BeTrue();
        result.Value.SomeProp.Should().Be([expectedValue]);
    }

    [Fact]
    public void Create_[InvalidCondition]_ReturnsFailure()
    {
        // Arrange / Act
        var result = [EntityName].Create([invalidArgs]);

        // Assert
        result.IsFailure.Should().BeTrue();
    }

    [Theory]
    [InlineData([invalidCase1])]
    [InlineData([invalidCase2])]
    public void [Method]_InvalidInput_ThrowsDomainExceptionOrReturnsFailure(...)
    {
        // ...
    }
}
```

**For Repository Integration Tests:**
```csharp
public class [RepositoryName]Tests : IClassFixture<DatabaseFixture>
{
    private readonly DatabaseFixture _fixture;

    public [RepositoryName]Tests(DatabaseFixture fixture)
    {
        _fixture = fixture;
    }

    [Fact]
    public async Task [Method]_ExistingEntity_ReturnsEntity()
    {
        // Arrange
        await using var context = _fixture.CreateContext();
        var repo = new [RepositoryName](context);
        var entity = [EntityName].Create([args]).Value;
        context.[DbSet].Add(entity);
        await context.SaveChangesAsync();

        // Act
        var result = await repo.GetByIdAsync(entity.Id);

        // Assert
        result.Should().NotBeNull();
        result!.Id.Should().Be(entity.Id);
    }
}
```

**Step 4 — Output the test file to the correct test project.**

| Source location | Test output location | Test type |
|----------------|---------------------|-----------|
| `src/[P].Domain/` | `tests/[P].UnitTests/Domain/` | Unit |
| `src/[P].Application/` | `tests/[P].UnitTests/Application/` | Unit |
| `src/[P].Infrastructure/` | `tests/[P].IntegrationTests/Infrastructure/` | Integration |
| `src/[P].API/` | `tests/[P].IntegrationTests/Api/` | Integration |

---

## Example Invocation

**Command:** `/dotnet-test-gen src/OrientPortal.Application/BrokerClients/Export/ExportBrokerClientsHandler.cs`

Agent detects a MediatR handler, reads spec for ACs (7 criteria), generates a
test class with 7 test methods: happy path (AC-1), empty filter result (AC-4),
IDOR ownership check (AC-3), validator rejection (AC-2), streaming failure (AC-5),
audit log written (AC-6), and PII masking (AC-7).

---

## Output

- File: `tests/[Project].UnitTests/[Layer]/[ClassName]Tests.cs`
  (or IntegrationTests for Infrastructure/API)
- All test methods have Arrange/Act/Assert structure with AC-N comments
- Uses FluentAssertions (`Should().BeTrue()` etc.) by default
