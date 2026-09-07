using System.Reflection;
using FluentAssertions;
using NetArchTest.Rules;
using Xunit;

namespace Company.ArchitectureTests;

/// <summary>
/// Executable form of <c>.cursor/rules/02-dotnet-architecture-guard.mdc</c>.
///
/// The rule file tells an agent what not to generate. These tests fail the build
/// when it happens anyway — from an agent, from a human, or from a merge. That
/// difference matters: a prose rule is a suggestion with good intentions; a red
/// test is a fact.
///
/// SETUP: replace the assembly references below with your real projects, then
/// add this project to the solution and wire it into CI (see templates/ci).
/// </summary>
public sealed class LayerBoundaryTests
{
    // ---- Point these at your actual assemblies -----------------------------
    private static readonly Assembly Domain = typeof(Company.Domain.IAssemblyMarker).Assembly;
    private static readonly Assembly Application = typeof(Company.Application.IAssemblyMarker).Assembly;
    private static readonly Assembly Infrastructure = typeof(Company.Infrastructure.IAssemblyMarker).Assembly;
    private static readonly Assembly Api = typeof(Company.API.IAssemblyMarker).Assembly;

    private const string DomainNs = "Company.Domain";
    private const string ApplicationNs = "Company.Application";
    private const string InfrastructureNs = "Company.Infrastructure";
    private const string ApiNs = "Company.API";

    // =======================================================================
    //  The dependency arrows from .cursor/rules/02
    // =======================================================================

    [Fact]
    public void Domain_Depends_On_Nothing()
    {
        var result = Types.InAssembly(Domain)
            .ShouldNot()
            .HaveDependencyOnAny(ApplicationNs, InfrastructureNs, ApiNs)
            .GetResult();

        result.IsSuccessful.Should().BeTrue(Because(result,
            "Domain sits at the centre of the dependency graph and depends on nothing"));
    }

    [Fact]
    public void Domain_Has_No_Infrastructure_Concerns()
    {
        var result = Types.InAssembly(Domain)
            .ShouldNot()
            .HaveDependencyOnAny(
                "Microsoft.EntityFrameworkCore",
                "Microsoft.AspNetCore",
                "Dapper",
                "Newtonsoft.Json",
                "System.Data.SqlClient",
                "Microsoft.Data.SqlClient")
            .GetResult();

        result.IsSuccessful.Should().BeTrue(Because(result,
            "persistence and transport are infrastructure concerns; Domain must not know they exist"));
    }

    [Fact]
    public void Application_Depends_On_Domain_Only()
    {
        var result = Types.InAssembly(Application)
            .ShouldNot()
            .HaveDependencyOnAny(InfrastructureNs, ApiNs)
            .GetResult();

        result.IsSuccessful.Should().BeTrue(Because(result,
            "Application defines abstractions; Infrastructure implements them. The arrow points inward"));
    }

    [Fact]
    public void Infrastructure_Does_Not_Depend_On_Api()
    {
        var result = Types.InAssembly(Infrastructure)
            .ShouldNot()
            .HaveDependencyOn(ApiNs)
            .GetResult();

        result.IsSuccessful.Should().BeTrue(Because(result, "the API is the outermost layer"));
    }

    [Fact]
    public void Api_Does_Not_Reference_Domain_Or_Infrastructure_Types()
    {
        // The API composition root may *register* Infrastructure in DI; it must
        // not use Infrastructure or Domain types in its own code. Exclude the
        // startup/DI files by namespace if your composition root lives inside the
        // API project.
        var result = Types.InAssembly(Api)
            .That().ResideInNamespaceStartingWith($"{ApiNs}.Controllers")
            .Or().ResideInNamespaceStartingWith($"{ApiNs}.Endpoints")
            .ShouldNot()
            .HaveDependencyOnAny(DomainNs, InfrastructureNs)
            .GetResult();

        result.IsSuccessful.Should().BeTrue(Because(result,
            "controllers and endpoints talk to Application only — no leaking entities into the wire format"));
    }

    // =======================================================================
    //  Handler discipline — the specific violation rule 02 calls out by name
    // =======================================================================

    [Fact]
    public void Handlers_Do_Not_Touch_DbContext()
    {
        var result = Types.InAssembly(Application)
            .That().HaveNameEndingWith("Handler")
            .ShouldNot()
            .HaveDependencyOnAny("Microsoft.EntityFrameworkCore", InfrastructureNs)
            .GetResult();

        result.IsSuccessful.Should().BeTrue(Because(result,
            "handlers go through a repository or an Application-defined abstraction, never DbContext directly"));
    }

    [Fact]
    public void Repository_Implementations_Live_In_Infrastructure()
    {
        var result = Types.InAssembly(Application)
            .That().HaveNameEndingWith("Repository")
            .And().AreClasses()
            .Should().BeAbstract()
            .GetResult();

        result.IsSuccessful.Should().BeTrue(Because(result,
            "Application owns the repository interface; Infrastructure owns the implementation"));
    }

    // =======================================================================
    //  Cross-module boundaries (multi-context / modular monolith)
    // =======================================================================

    [Fact]
    public void Modules_Do_Not_Reach_Into_Each_Others_Internals()
    {
        // Adapt to your bounded contexts. Modules communicate through Contracts
        // (integration events / shared DTOs), never by importing internals.
        string[] modules = ["Payments", "Policies", "Brokers", "Claims"];

        foreach (var module in modules)
        {
            var others = modules.Where(m => m != module)
                                .Select(m => $"{ApplicationNs}.{m}.Internal")
                                .ToArray();
            if (others.Length == 0) continue;

            var result = Types.InAssembly(Application)
                .That().ResideInNamespaceStartingWith($"{ApplicationNs}.{module}")
                .ShouldNot().HaveDependencyOnAny(others)
                .GetResult();

            result.IsSuccessful.Should().BeTrue(Because(result,
                $"module '{module}' must talk to other modules through Contracts, not their internals"));
        }
    }

    // =======================================================================

    private static string Because(TestResult result, string why)
    {
        var offenders = result.FailingTypeNames is null
            ? "(none reported)"
            : string.Join("\n  - ", result.FailingTypeNames);
        return $"{why}.\nOffending types:\n  - {offenders}\nSee .cursor/rules/02-dotnet-architecture-guard.mdc";
    }
}
