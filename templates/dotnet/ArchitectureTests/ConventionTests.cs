using System.Reflection;
using FluentAssertions;
using NetArchTest.Rules;
using Xunit;

namespace Company.ArchitectureTests;

/// <summary>
/// Executable form of the conventions in
/// <c>.cursor/rules/07-audit-trail-guard.mdc</c>,
/// <c>.cursor/rules/04-security-guard.mdc</c>, and
/// <c>memory-bank/backendConventions.md</c> — the ones that are true statements
/// about types and therefore checkable by reflection.
///
/// These catch the mistakes that survive a formatter and an analyzer: money as
/// double, entities returned from endpoints, handlers missing CancellationToken.
/// </summary>
public sealed class ConventionTests
{
    private static readonly Assembly Domain = typeof(Company.Domain.IAssemblyMarker).Assembly;
    private static readonly Assembly Application = typeof(Company.Application.IAssemblyMarker).Assembly;
    private static readonly Assembly Api = typeof(Company.API.IAssemblyMarker).Assembly;

    // =======================================================================
    //  Money — decimal, never floating point
    // =======================================================================

    [Fact]
    public void Money_Properties_Use_Decimal()
    {
        string[] moneyWords =
            ["Amount", "Price", "Total", "Balance", "Fee", "Cost", "Salary",
             "Premium", "Payment", "Value", "Rate", "Commission", "Discount"];

        var offenders =
            (from type in Domain.GetTypes().Concat(Application.GetTypes())
             where !type.IsCompilerGenerated()
             from prop in type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
             where moneyWords.Any(w => prop.Name.Contains(w, StringComparison.OrdinalIgnoreCase))
             let t = Nullable.GetUnderlyingType(prop.PropertyType) ?? prop.PropertyType
             where t == typeof(double) || t == typeof(float)
             select $"{type.FullName}.{prop.Name} : {t.Name}")
            .ToList();

        offenders.Should().BeEmpty(
            "monetary values must be decimal — binary floating point cannot represent 0.1 exactly and " +
            "silently loses fractions across arithmetic. See .cursor/rules/07-audit-trail-guard.mdc.\n" +
            string.Join("\n  - ", offenders));
    }

    [Fact]
    public void Timestamps_Use_DateTimeOffset()
    {
        var offenders =
            (from type in Domain.GetTypes()
             where !type.IsCompilerGenerated()
             from prop in type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
             let t = Nullable.GetUnderlyingType(prop.PropertyType) ?? prop.PropertyType
             where t == typeof(DateTime)
             select $"{type.FullName}.{prop.Name}")
            .ToList();

        offenders.Should().BeEmpty(
            "DateTime discards the offset. In a multi-timezone deployment that turns into an off-by-hours " +
            "audit trail. Use DateTimeOffset.\n" + string.Join("\n  - ", offenders));
    }

    // =======================================================================
    //  Audit trail — mutable financial/policy entities carry provenance
    // =======================================================================

    [Fact]
    public void Auditable_Entities_Capture_Who_And_When()
    {
        // Adapt the marker to your codebase: an IAuditable interface, an
        // AuditableEntity base class, or a namespace convention.
        var auditable = Domain.GetTypes()
            .Where(t => t.IsClass && !t.IsAbstract && !t.IsCompilerGenerated())
            .Where(t => t.GetInterfaces().Any(i => i.Name is "IAuditable" or "IAuditableEntity"))
            .ToList();

        if (auditable.Count == 0)
            return; // no marker interface yet — see .cursor/rules/07 for adoption steps

        string[] required = ["CreatedAt", "CreatedBy", "ModifiedAt", "ModifiedBy"];

        var offenders = auditable
            .Select(t => new
            {
                Type = t.FullName,
                Missing = required.Where(r =>
                    t.GetProperty(r, BindingFlags.Public | BindingFlags.Instance) is null).ToArray()
            })
            .Where(x => x.Missing.Length > 0)
            .Select(x => $"{x.Type} missing: {string.Join(", ", x.Missing)}")
            .ToList();

        offenders.Should().BeEmpty(
            "auditable entities must record who changed what and when. See .cursor/rules/07-audit-trail-guard.mdc.\n" +
            string.Join("\n  - ", offenders));
    }

    // =======================================================================
    //  API surface — DTOs on the wire, never entities
    // =======================================================================

    [Fact]
    public void Endpoints_Do_Not_Return_Domain_Entities()
    {
        var domainTypes = Domain.GetTypes().Where(t => t.IsPublic).ToHashSet();

        var offenders =
            (from type in Api.GetTypes()
             where type.Name.EndsWith("Controller", StringComparison.Ordinal)
                || type.Name.EndsWith("Endpoint", StringComparison.Ordinal)
             from method in type.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
             let returned = Unwrap(method.ReturnType)
             where domainTypes.Contains(returned)
             select $"{type.Name}.{method.Name} returns {returned.Name}")
            .ToList();

        offenders.Should().BeEmpty(
            "returning entities leaks internal shape, over-posts, and couples the wire format to the schema. " +
            "Return a DTO/record from Contracts.\n" + string.Join("\n  - ", offenders));
    }

    [Fact]
    public void Request_And_Response_Dtos_Are_Sealed_Records()
    {
        var result = Types.InAssembly(Api)
            .That().HaveNameEndingWith("Request").Or().HaveNameEndingWith("Response")
            .And().AreClasses()
            .Should().BeSealed()
            .GetResult();

        result.IsSuccessful.Should().BeTrue(
            "DTOs are value shapes — sealed records give correct equality and prevent accidental inheritance. " +
            $"Offenders: {string.Join(", ", result.FailingTypeNames ?? [])}");
    }

    // =======================================================================
    //  Handler discipline
    // =======================================================================

    [Fact]
    public void Handlers_Are_Sealed()
    {
        var result = Types.InAssembly(Application)
            .That().HaveNameEndingWith("Handler").And().AreClasses().And().AreNotAbstract()
            .Should().BeSealed()
            .GetResult();

        result.IsSuccessful.Should().BeTrue(
            $"handlers are leaf types. Offenders: {string.Join(", ", result.FailingTypeNames ?? [])}");
    }

    [Fact]
    public void Async_Handler_Methods_Accept_CancellationToken()
    {
        var offenders =
            (from type in Application.GetTypes()
             where type.Name.EndsWith("Handler", StringComparison.Ordinal) && !type.IsCompilerGenerated()
             from method in type.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
             where typeof(Task).IsAssignableFrom(method.ReturnType)
             where method.GetParameters().All(p => p.ParameterType != typeof(CancellationToken))
             select $"{type.Name}.{method.Name}")
            .ToList();

        offenders.Should().BeEmpty(
            "an async handler with no CancellationToken cannot be cancelled when the client disconnects — " +
            "under load that is wasted work you keep paying for.\n" + string.Join("\n  - ", offenders));
    }

    // =======================================================================

    private static Type Unwrap(Type t)
    {
        while (t.IsGenericType &&
               (t.GetGenericTypeDefinition() == typeof(Task<>) ||
                t.GetGenericTypeDefinition() == typeof(ValueTask<>) ||
                t.GetGenericTypeDefinition() == typeof(ActionResult<>) ||
                t.GetGenericTypeDefinition() == typeof(IEnumerable<>) ||
                t.GetGenericTypeDefinition() == typeof(IReadOnlyList<>) ||
                t.GetGenericTypeDefinition() == typeof(List<>)))
        {
            t = t.GetGenericArguments()[0];
        }
        return t;
    }
}

internal static class TypeExtensions
{
    public static bool IsCompilerGenerated(this Type t) =>
        t.GetCustomAttributes(typeof(System.Runtime.CompilerServices.CompilerGeneratedAttribute), false).Length > 0
        || t.Name.Contains('<', StringComparison.Ordinal);
}
