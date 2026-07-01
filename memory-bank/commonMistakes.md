# Common Mistakes
**Last Updated:** [YYYY-MM-DD]
**Owner:** `code-review-assistant` appends here when it catches the same class of
mistake more than once; `00-memory-think.mdc` checks this file so the agent doesn't
regenerate the same bug.

Format: what went wrong, why it's tempting to do, what to do instead.

---
### CM-001 — Disabling HMAC verification "temporarily" during webhook debugging
**Tempting because:** the easiest way to test a webhook locally without a valid
signature is to comment out the check.
**Instead:** use a local signing key matching the provider's test mode, or a feature
flag scoped to `Development` environment only — never a commented-out check that can
ship.

### CM-002 — `async void` event handlers swallowing exceptions
**Tempting because:** it compiles, and the method "just works" in the happy path.
**Instead:** `async Task` everywhere except true UI event handlers; unhandled
exceptions in `async void` crash the process or silently vanish depending on context.

### CM-003 — Reusing one `DbContext`/connection across an Oracle read and a SQL
Server write in what looks like "one transaction"
**Tempting because:** it reads like a single atomic operation in the code.
**Instead:** there is no real distributed transaction here — use the outbox pattern
or accept eventual consistency explicitly, and say so in a code comment.
