# Domain Rules

Human-authored. Read by every `flutter-*-gen` skill, `feature-trace`, and
`impact-analysis` for the business/product rules the app encodes — the
things a generic Flutter tutorial wouldn't know about this specific app.
Not auto-regenerated. Replace the example below, then delete the
`> EXAMPLE —` block.

## Domain glossary

`[key domain terms and what they mean in this app — a "draft" order vs a
"pending" order, what "eligible" means for a promo code, etc.]`

## Core business rules

`[the rules that live in a Notifier/use-case, not obvious from the UI alone]`

## Data ownership / source of truth

`[for each key entity, which repository owns writes, whether there's local
caching, and what "stale" means for it]`

---

> EXAMPLE — what a filled-in version looks like:
>
> ## Domain glossary
> - **Draft order**: created client-side, not yet submitted; lives only in
>   `CartNotifier` state until checkout.
> - **Pending order**: submitted to the backend, awaiting payment capture.
> - **Eligible for promo**: cart subtotal ≥ $20 AND no other promo already
>   applied — enforced in `PromoValidationNotifier`, not just server-side.
>
> ## Core business rules
> - A cart cannot mix items from two different warehouses in one order —
>   `CartNotifier.addItem` rejects the add and surfaces a specific error
>   rather than silently splitting into two orders.
> - Orders older than 30 minutes in "pending" status without payment
>   confirmation are shown with a "resume payment" action, not treated as
>   failed — the backend still owns cancellation timing.
>
> ## Data ownership / source of truth
> - `Order` — `OrderRepository` is the sole writer; the app never mutates
>   local order state without a round-trip confirmation from the backend.
> - `CartItem` — client-owned until checkout; no server sync of an
>   in-progress cart.
