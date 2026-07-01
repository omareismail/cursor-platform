# Backend Conventions
**Last Updated:** [YYYY-MM-DD]

## CQRS handler shape
One handler per file, named `[Action][Entity]CommandHandler` /
`[Query][Entity]QueryHandler`. Validator colocated, named `[Same]Validator`.
Handlers depend on interfaces only — no direct `DbContext` injection into a handler
when a repository abstraction exists for that aggregate.

## Background work
Anything that shouldn't block the HTTP response (email, webhook retries, report
generation) goes through the background job mechanism (Hangfire/Quartz — see
`dotnet-background-job-gen`), not `Task.Run` fire-and-forget in a controller/endpoint.

## External integrations (payment gateways, third-party APIs)
Every external client wrapped in Polly (retry + circuit breaker), with timeouts
explicitly set (never relying on the default `HttpClient` timeout). Webhook receivers
verify signatures before touching the database — see `securityStandards.md`.

## Logging
Structured logging only (`logger.LogInformation("Policy {PolicyId} issued", id)`, never
string interpolation into the message template). No PII (national ID, full card
numbers, full phone numbers) in log messages at any level — mask or omit.

## Configuration
`IOptions<T>` pattern for all configuration sections, validated at startup
(`ValidateOnStart()`), not read ad-hoc via `IConfiguration["Key"]` scattered through
the codebase.
