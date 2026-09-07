# Progress

**Last Updated:** _not yet synced — run `/context-sync`_

Tracks what's Done, In Progress, and Blocked, per feature. `/context-sync`
proposes updates from git state; `00-memory-think.mdc` keeps it current
during a session. Never let an automated sync silently downgrade something
a human marked Done — flag the conflict instead.

## Not Started

- _(populate via `/context-sync` or by hand)_

## In Progress

- _(none yet)_

## Done

- _(none yet)_

## Blocked

- _(none yet)_

> EXAMPLE — what a filled-in board looks like:
>
> ## In Progress
> - **checkout** — cart screen done, shipping screen done, payment screen
>   not started (branch: `feature/checkout`)
>
> ## Done
> - **auth** — login, signup, forgot-password screens; token refresh via
>   `flutter_secure_storage`
>
> ## Blocked
> - **push-notifications** — waiting on backend team to expose the device
>   token registration endpoint
