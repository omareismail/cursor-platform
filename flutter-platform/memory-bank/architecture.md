# Architecture

Human-authored. Read by `01-flutter-architecture-guard.mdc`, every
`flutter-*-gen` skill, and `pattern-scout`. Not auto-regenerated — a team
decision, not an observation. Replace the example below with your project's
actual answers, then delete the `> EXAMPLE —` block.

## Layout convention

`[feature-first | layered (presentation/domain/data)]`

## Folder structure

```
[paste or describe the actual lib/ tree shape here]
```

## Provider placement

`[where feature-local providers live vs genuinely shared/app-level providers]`

## State-management style

`[codegen (@riverpod / riverpod_generator) vs manually-declared providers —
and why, if there's a reason worth recording]`

## Routing convention

`[go_router file location, shell route usage, guard/redirect pattern for auth]`

---

> EXAMPLE — what a filled-in version looks like:
>
> ## Layout convention
> Feature-first. Each feature under `lib/features/<name>/` has its own
> `presentation/`, `application/`, `domain/`, `data/` subfolders. Shared
> widgets/providers live in `lib/shared/`.
>
> ## Folder structure
> ```
> lib/
>   app.dart                 # MaterialApp.router, theme
>   router/app_router.dart   # single GoRouter instance
>   features/
>     auth/  cart/  checkout/  orders/  profile/
>   shared/
>     widgets/  providers/  theme/
> ```
>
> ## Provider placement
> A provider used by one feature lives in that feature's `application/`
> folder. `authStateProvider` and `themeModeProvider` are the only two
> providers in `lib/shared/providers/` — genuinely cross-feature.
>
> ## State-management style
> `riverpod_generator` / `@riverpod` codegen everywhere. No manually-declared
> `NotifierProvider` in new code as of the migration completed 2025-11.
>
> ## Routing convention
> Single `GoRouter` in `lib/router/app_router.dart`. Authenticated screens
> nest under a `StatefulShellRoute` for the bottom-nav. Auth guard is a
> top-level `redirect` checking `authStateProvider`.
