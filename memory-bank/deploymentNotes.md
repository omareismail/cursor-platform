# Deployment Notes
**Last Updated:** [YYYY-MM-DD]

## Environments
| Env | Database(s) | Notes |
|---|---|---|
| Local | Docker Compose (matching prod provider) | [details] |
| Test/Staging | [provider, connection notes] | [e.g. Oracle TEST schema, refreshed weekly] |
| Production | [provider] | [e.g. SAMA-regulated, change window restrictions] |

## Release process
[Branching → PR → CI gates → deploy trigger — keep this accurate, `release-notes-gen`
and `dotnet-iac-gen` read it]

## Rollback
[How a bad deploy is rolled back — migration-down strategy if EF Core migrations are
involved, since not all migrations are safely reversible]

## Known environment-specific gotchas
> EXAMPLE: "Oracle TEST schema's `MOTOR_MODEL` table has a different unique
> constraint than LIVE — see decisionLog.md ADR-005 for the reconciliation plan."
