# Security Standards

Human-authored. Read by `03-flutter-security-guard.mdc` and
`mobile-security-auditor`. Not auto-regenerated. Standard mobile app
security hygiene, not a compliance framework — if this project needs
SOC2/PCI/HIPAA-specific controls, record that here explicitly; nothing in
this platform assumes it by default. Replace the example below, then
delete the `> EXAMPLE —` block.

## Secrets and configuration

`[how build-time secrets are supplied — --dart-define-from-file, native
config files, etc. — and where they're git-ignored]`

## Local storage

`[what goes through flutter_secure_storage vs plain SharedPreferences, and
any app-specific PII handling rules]`

## Network

`[HTTP client setup, whether certificate pinning is in place, and where]`

## Data collection / store disclosures

`[what the app actually collects, for keeping the store data-safety label
honest — read by production-readiness-review]`

---

> EXAMPLE — what a filled-in version looks like:
>
> ## Secrets and configuration
> API base URL and analytics key supplied via
> `--dart-define-from-file=config/prod.json`, git-ignored. No secrets
> committed to `pubspec.yaml` or any `.dart` file.
>
> ## Local storage
> Auth access/refresh tokens: `flutter_secure_storage`. User's saved
> shipping addresses: local SQLite (not secrets, but PII — cleared on
> logout). Theme/locale preference: `SharedPreferences` (non-sensitive).
>
> ## Network
> Single `Dio` instance in `lib/core/network/api_client.dart` with a
> `CertificatePinningInterceptor` pinning the API's leaf certificate. All
> repositories use this instance — no second HTTP client anywhere in the app.
>
> ## Data collection / store disclosures
> Collects: email, name, shipping address, purchase history, device
> identifier for push notifications. Does not collect: precise location,
> contacts, browsing history outside the app. Cross-check against the
> Play Console data-safety form and App Store privacy nutrition label
> before each release.
