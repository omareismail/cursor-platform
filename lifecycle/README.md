# lifecycle/

Product lifecycle state for **this** repository.

`cursor-platform` is the platform, not an application, so it carries no
`state.json` of its own — this directory ships the contract, and the file is
created in each target application repo by:

```bash
node .cursor/tools/lifecycle.mjs init --name "<product>"             # greenfield
node .cursor/tools/lifecycle.mjs init --name "<product>" --existing  # brownfield
```

## What lives here

| Path | Owner | Committed |
|---|---|---|
| `state.json` | `.cursor/tools/lifecycle.mjs` — machine-owned | **Yes.** The team shares one answer to "which phase are we in". |
| `history/` | append-only record of gate decisions | Yes |

`state.json` is deliberately **not** gitignored. It is authored state, not
derived state: `repo-map.json` and `feature-map.json` can be regenerated from
the code, but no tool can reconstruct who approved the design gate and when.

## `releases/`

One immutable JSON per release, cut by `.cursor/tools/release-evidence.mjs`:
what was in it (from git), which gates were standing (from `state.json`), what
was still owed (open change requests, active overrides), and who signed it.
Committed deliberately — the hash inside each record catches an accidental edit,
git history is what makes it evidence.

```bash
node .cursor/tools/release-evidence.mjs cut --version v1.2.0
node .cursor/tools/release-evidence.mjs sign v1.2.0 --by "<name>"
node .cursor/tools/release-evidence.mjs verify
```

## Do not hand-edit `state.json`

`guard-write.mjs` blocks it. Editing it by hand lets a phase be marked approved
without its artifacts existing, which is the exact failure the gates prevent.
Use the tool:

```bash
node .cursor/tools/lifecycle.mjs status
node .cursor/tools/lifecycle.mjs check <PHASE>
node .cursor/tools/lifecycle.mjs gate <PHASE>          # who may judge it, and why
node .cursor/tools/lifecycle.mjs record-gate <PHASE> --verdict GO --by "<the reviewer>"
node .cursor/tools/lifecycle.mjs approve <PHASE> --by "<a human, not the reviewer>"
node .cursor/tools/lifecycle.mjs advance
node .cursor/tools/lifecycle.mjs rollback <PHASE> --reason "..."
node .cursor/tools/lifecycle.mjs override <PHASE> --reason "..." --risk HIGH --by "<name>" --expires 7
```

## Shape

```json
{
  "schemaVersion": 2,
  "product": "motors-online",
  "mode": "greenfield",
  "phase": "DESIGN",
  "updated": "2026-09-06T10:00:00.000Z",
  "phases": {
    "REQUIREMENTS": {
      "mechanical": {
        "status": "PASS",
        "at": "...",
        "artifacts": {
          "docs/product/prd.md": "file:9f2c1a0b4e7d3c85",
          "docs/product/nfr.md": "file:2b71e40c9a6f5d13"
        }
      },
      "judgement": { "verdict": "GO", "by": "lifecycle-gate", "at": "...",
                     "gateVersion": "a41c9e02b7d6f358", "criteria": "7/7" },
      "human": { "status": "APPROVED", "by": "Ezzdeen", "at": "...", "note": "" }
    },
    "DESIGN": { "startedAt": "..." }
  },
  "history": [{ "at": "...", "event": "approve", "detail": "REQUIREMENTS by Ezzdeen" }]
}
```

**There is no `status` field.** The file records the three consents as evidence;
the status is derived from them on every read. Storing it would mean needing a
second flag to say whether the stored one was still true.

| Derived status | Means |
|---|---|
| `NOT_STARTED` / `IN_PROGRESS` | no approval yet |
| `APPROVED` | all three consents, all still valid |
| `INHERITED` | brownfield; done informally before the lifecycle was adopted |
| `STALE` | **was** approved; an artifact hash, the gate version, or an override expiry moved |
| `BLOCKED` | an earlier phase is not cleared |

`artifacts` holds a content hash per required file, taken at approval. Edit one
and the phase is `STALE` on the next command. `gateVersion` is the hash of the
gate definition itself, so tightening a criterion invalidates approvals granted
under the looser one.

`INHERITED` clears the gate — including the design gate — because blocking all
work on a live system would be absurd. It is not the same as `APPROVED`, and the
status shows the difference.

A v1 state file (with `status` and `approved`) is migrated on read. Those
approvals carry no judgement record, so they derive to `STALE` — the honest
answer to "was this reviewed?" is that nobody knows.

## Other directories

| Path | Written by | Holds |
|---|---|---|
| `evidence/` | `record-gate` | one JSON per gate verdict: criteria, gate version, mechanical result |
| `overrides/` | `override` | one JSON per bypass: id, owner, risk, what it bypassed, expiry |
| `changes/` | `change-request` | one JSON per change request: reason, requester, risk, computed impact, phases needing re-approval |
| `history/` | — | append-only notes kept by hand |

## The one gate with a hook behind it

While the DESIGN phase derives to anything other than `APPROVED` or `INHERITED`
(`STALE` included),
`.claude/hooks/guard-phase.mjs` returns exit code 2 on every write under `src/`,
`backend/` and `frontend/`. Tests, specs, docs and `memory-bank/` are never
blocked.

Escape hatch, for a deliberate spike: `LIFECYCLE_OVERRIDE=1`. Same pattern as
`CLAUDE_ALLOW_TIER2_EDIT` in `guard-write.mjs` — a human sets it on purpose.

A `state.json` that exists but cannot be parsed closes the gate rather than
opening it, and `lifecycle.mjs` says so instead of suggesting `init`. Every
record in this directory — `state.json`, `evidence/`, `releases/`, `overrides/`,
`incidents/`, `changes/`, `fitness-baseline.json` — is on the protected-path
list in `.cursor/lifecycle/write-policy.json`: the tools write them, agents do
not, by any editor tool or shell command.

See `.cursor/docs/LIFECYCLE.md` for the phases and
`.cursor/lifecycle/gates/` for what each gate requires.
