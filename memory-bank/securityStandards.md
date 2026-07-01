# Security Standards
**Last Updated:** [YYYY-MM-DD]
**Compliance context:** [SAMA CSF / PCI DSS / ZATCA — note which apply to this project]

## Non-negotiable (block generation, not just warn)
- Webhook signature verification (HMAC or provider-equivalent) on every inbound
  webhook, before any database write. Never shippable as "TODO: enable in prod".
- No secrets in source — connection strings, API keys, signing secrets all come from
  `IConfiguration` backed by user-secrets (dev) / Key Vault or equivalent (prod).
- All SQL parameterized — see `databaseConventions.md`.
- JWT validation checks issuer, audience, and expiry; `[Authorize]` policies are
  explicit (no bare `[Authorize]` with no policy on financially sensitive endpoints).
- Card/payment data never logged, never stored beyond what the payment processor
  requires (PCI DSS scope minimization — if in doubt, don't persist it, re-fetch from
  the processor by reference).

## Warn-level (flagged, human decides)
- CORS policies wider than the specific known frontend origin(s).
- Missing rate limiting on auth/payment endpoints.
- Dependency with a known CVE at or above Medium severity (`dependency-upgrade-guard`).

## React-side
- No `dangerouslySetInnerHTML` without explicit sanitization (DOMPurify or equivalent)
  — flagged as critical by `04-security-guard.mdc` regardless of source trust claims.
- Auth tokens in memory/httpOnly cookies, never `localStorage` (XSS exfiltration risk).

## Audit trail
Any mutation of financial/policy data records who/when/what-changed — not optional,
not "add later for compliance." See `businessRules.md` for which entities require it.
