# Technology Stack (canonical reference)
**Last Updated:** [YYYY-MM-DD]
**Owner:** lead architect — this is the *decision*; `techContext.md` is the live
*snapshot* of what's actually installed. If they disagree, techContext.md reflects
reality and this file needs updating (or the drift needs fixing).

## Approved
| Layer | Choice | Notes |
|---|---|---|
| Backend runtime | .NET 9 (LTS path: .NET 8) | |
| API style | Minimal APIs | Controllers only for actions needing model binding attrs |
| ORM | EF Core | Dapper for read-heavy/reporting queries — see databaseConventions.md |
| CQRS | MediatR | |
| Validation | FluentValidation | |
| Resilience | Polly | Required around any external HTTP client (payment gateways, etc.) |
| Logging | Serilog → OpenTelemetry | Structured, never string-interpolated log messages |
| Frontend | React 19 + TypeScript (strict) + Vite | |
| Server state | TanStack Query | |
| Client state | Zustand | Redux Toolkit only if cross-feature state graph is genuinely complex |
| Forms | React Hook Form + Zod | |
| Databases | SQL Server / PostgreSQL / Oracle | per `databaseConventions.md` |

## Under evaluation (do not default-generate against these yet)
| Candidate | Why being considered | Decision owner |
|---|---|---|
| [e.g. Aspire for local orchestration] | [reason] | [name/date to revisit] |

## Explicitly rejected
| Option | Why rejected |
|---|---|
| [e.g. NEDA-style direct localStorage in artifacts] | Not durable, fails Cursor preview |
