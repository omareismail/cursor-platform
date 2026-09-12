# project/

Canonical **authored** state for the Project Command Center. The dashboard
never writes here. `project.mjs` is the writer.

| File | Owns | Derived from elsewhere |
|---|---|---|
| `project.json` | Identity, current delivery pointers, recommendation dispositions | Stack/languages may be *detected* by `scan` until confirmed |
| `delivery.json` | Delivery phases, checkpoints, overlay feature bindings, history | Lifecycle phase is `lifecycle/state.json`. Releases are `lifecycle/releases/` |
| `ideas.json` | Ideas and their status transitions | Features they became live in `.cursor/cache/feature-map.json` |

Do not store a second copy of a traced feature, a gate approval, or an ADR.
Link by id.

Detected vs confirmed: identity fields carry `{ value, confidence }` where
confidence is `detected`, `confirmed`, or `unknown`. Discovery is not
the same as a human saying the stack is X.

Init does not mark delivery phases COMPLETE. On `--existing` they start as
`NEEDS_REVIEW`.

Multi-file writes use `project/.txn.json` as a write-ahead journal. That file
is ephemeral and gitignored: a crash after it is fsynced completes on the
next command.
