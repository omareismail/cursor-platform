# lifecycle/

Product lifecycle state for **this** repository.

`cursor-platform` is the platform, not an application, so it carries no
`state.json` of its own — this directory ships the contract, and the file is
created in each target application repo by:

```bash
node .cursor/tools/lifecycle.mjs init --name "<product>"             # greenfield
node .cursor/tools/lifecycle.mjs init --name "<product>" --existing --by "<claimant>" [--review-by "<second person>"]  # brownfield
```

## What lives here

| Path | Owner | Committed |
|---|---|---|
| `state.json` | `.cursor/tools/lifecycle.mjs` — machine-owned | **Yes.** The team shares one answer to "which phase are we in". |
| `integrity.json` | `.cursor/tools/self-audit.mjs integrity --write` — a human's attestation over the enforcement surface | **Yes.** CI compares the hooks, wiring, policies, gates and `lifecycle.mjs` against it. |
| `index.jsonl` | every tool that writes a record here, through `.cursor/tools/_evidence.mjs` — append-only, machine-owned | **Yes.** The hash chain over everything else in this directory; `lifecycle.mjs evidence` walks it. |
| `index.<stamp>.jsonl` | `lifecycle.mjs evidence reseal` — an archived chain, never edited | Yes |
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
node .cursor/tools/release-evidence.mjs cut --version v1.2.0 [--accept-check <tool.mjs>]
node .cursor/tools/release-evidence.mjs sign v1.2.0 --by "<name>"
node .cursor/tools/release-evidence.mjs verify
```

`cut` runs the checkers and refuses when one FAILS. Proceeding anyway is a
decision, so it is made by name — `--accept-check flag-debt.mjs` — and the record
carries `acceptedChecks` plus `accepted: true` on that check, which `sign` reads
back to the signer. A checker with nothing to check (exit 2) is `skipped`.

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
  "schemaVersion": 3,
  "revision": 14,
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
        },
        "types": { "docs/product/prd.md": "document", "docs/product/nfr.md": "document" },
        "traceability": { "ids": 41, "dangling": 0, "unlinked": 0 },
        "checks": []
      },
      "judgement": { "verdict": "GO", "by": "business-analyst", "at": "...",
                     "gateVersion": "a41c9e02b7d6f358", "criteria": "7/7",
                     "recordedBy": { "os": "sara", "git": "Sara Al-Amri", "email": "...", "ci": null, "host": "..." } },
      "human": { "status": "APPROVED", "by": "Ezzdeen", "at": "...", "note": "",
                 "recordedBy": { "os": "ezzdeen", "git": "Ezzdeen", "email": "...", "ci": null, "host": "..." } }
    },
    "ANALYSIS": {
      "inherited": { "basis": "brownfield", "by": "Ezzdeen", "reviewBy": "Sara Al-Amri",
                     "evidence": { "commits": 1240, "head": "…", "sourceRoots": ["src"], "sourceFiles": 312 } }
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
| `INHERITED` | brownfield; done informally before adoption — `inherited.by` claimed it, `inherited.reviewBy` (a different person) checked the claim |
| `INHERITED_UNVERIFIED` | an inheritance with no `reviewBy`, or a pre-v3 bare `inherited: true`. Clears the gate; `release-evidence.mjs sign` refuses until the signer names it with `--accept-inherited PHASE` |
| `STALE` | **was** approved; an artifact hash, the gate version, or an override expiry moved |
| `BLOCKED` | an earlier phase is not cleared |

`artifacts` holds a content hash per required artifact, taken at approval. A
file hashes as `file:`; a directory hashes as `dir2:` — every file under it, by
content, recursively, skipping build output, dot-files and anything git ignores.
Edit one and the phase is `STALE` on the next command. A `dir:` hash written by
schema v2 (entry names only) is compared with the v2 algorithm until the phase
is re-approved, so upgrading flips nothing by itself. `gateVersion` is the hash
of the gate definition itself, so tightening a criterion invalidates approvals
granted under the looser one.

`types` records what each artifact was validated *as* (`document`, `adr-set`,
`spec-set`, `source-tree`, `test-suite`, `task-board`, `pipeline`);
`traceability` is the id-chain check `approve` ran; `checks` are the phase's
computed checks (`ac-trace.mjs check` for TESTING) with their exit and whether
the signer accepted a failure by name (`--accept-check`).

`revision` is a counter every write compares against before it writes. Two
sessions that read the same state and both try to write are told, and the second
write is refused with both revisions named — nothing is overwritten silently.
Every write goes to a temp file and is renamed over the target, so a crash
mid-write cannot leave `state.json` empty.

`recordedBy` beside every `by` is who the OS, git and CI say typed the command.
It is recorded, never trusted: `--by` carries the responsibility; `recordedBy`
is the context it was given in, and the tools print a warning when the two
disagree.

`INHERITED` clears the gate — including the design gate — because blocking all
work on a live system would be absurd. It is not the same as `APPROVED`, and the
status shows the difference. `init --existing` requires `--by`, refuses an
empty repository (no commits and no source is nothing to inherit), and records
what it saw under `inherited.evidence`.

A v1 state file (with `status` and `approved`) is migrated on read. Those
approvals carry no judgement record, so they derive to `STALE` — the honest
answer to "was this reviewed?" is that nobody knows. A v2 file's
`inherited: true` derives to `INHERITED_UNVERIFIED` for the same reason.

## Other directories

| Path | Written by | Holds |
|---|---|---|
| `evidence/` | `record-gate` | one JSON per gate verdict: criteria, gate version, mechanical result |
| `overrides/` | `override` | one JSON per bypass: id, owner, risk, what it bypassed, expiry |
| `changes/` | `change-request` | one JSON per change request: reason, requester, risk, computed impact, phases needing re-approval |
| `history/` | — | append-only notes kept by hand |

## The one gate with a hook behind it

While the DESIGN phase derives to anything other than `APPROVED`, `INHERITED` or
`INHERITED_UNVERIFIED` (`STALE` included),
`.claude/hooks/guard-phase.mjs` returns exit code 2 on every write under `src/`,
`backend/` and `frontend/`. Tests, specs, docs and `memory-bank/` are never
blocked.

Escape hatch, for a deliberate spike: `LIFECYCLE_OVERRIDE=1`. Same pattern as
`CLAUDE_ALLOW_TIER2_EDIT` in `guard-write.mjs` — a human sets it on purpose.

A `state.json` that exists but cannot be parsed closes the gate rather than
opening it, and `lifecycle.mjs` says so instead of suggesting `init`. Every
record in this directory — `state.json`, `integrity.json`, `evidence/`,
`releases/`, `overrides/`, `incidents/`, `changes/`, `fitness-baseline.json` —
is on the protected-path list in `.cursor/lifecycle/write-policy.json`: the
tools write them, agents do not, by any editor tool or shell command.

## `integrity.json`

The enforcement surface is a set of files, and a file can change. This is a
human's signature over that set — sha256 of every hook, `.claude/settings.json`,
`.cursor/hooks.json`, both policy files, every gate definition, `lifecycle.mjs`
and `_state.mjs`:

```bash
node .cursor/tools/self-audit.mjs integrity                        # CI: CHANGED / MISSING / UNATTESTED, exit 1
node .cursor/tools/self-audit.mjs integrity --write --by "<name>"  # a human, after reviewing the change
```

`--write` is a human-only command; `guard-bash.mjs` refuses it from the agent's
shell, because an agent that can edit a hook and re-attest it has no hook.

## `index.jsonl`

`integrity.json` attests to the tools. This attests to what the tools wrote.
Every record in this directory — a `state.json` revision, a verdict, an override,
a release cut or signature, an incident, a change request — is appended here as
one line when it is written:

```json
{"seq":7,"at":"…","kind":"gate-verdict","ref":"lifecycle/evidence/design-….json","hash":"<sha256 of the file>","meta":{"phase":"DESIGN","verdict":"GO","by":"security-auditor"},"prev":"<entry of line 6>","entry":"<sha256 of this line without entry>"}
```

`kind` is one of `state`, `gate-verdict`, `override`, `release-cut`,
`release-signed`, `incident`, `change-request`, `change-request-closed`,
`adopted` (a record that existed before the chain started, indexed on the first
append) and `reseal` (the first line of a chain a human started over).

```bash
node .cursor/tools/lifecycle.mjs evidence [--json]     # CI, approve and sign all run this
node .cursor/tools/lifecycle.mjs evidence reseal --by "<name>" --reason "..."
```

| Finding | Means |
|---|---|
| `LINK_BROKEN` | a line's `prev` is not the previous line's `entry` — a line was removed, inserted or reordered |
| `ENTRY_ALTERED` | a line's `entry` no longer matches its own content |
| `SEQ_GAP` | sequence numbers skip or repeat |
| `UNPARSEABLE` | a line is not JSON |
| `CHANGED` | the record on disk is not the content its latest entry hashed |
| `MISSING` | a record the chain names is gone |
| `UNINDEXED` | a record is on disk that the chain never saw |

`approve` and `release-evidence.mjs sign` refuse on any finding, and no override
reaches it. Repair is `reseal`: the current index is renamed to
`index.<stamp>.jsonl` and kept, and a new one starts with a line naming who
accepted the break, why, which findings, and the archive's last hash. Human-only;
`guard-bash.mjs` refuses it from the agent's shell.

This is tamper-**evident**, not tamper-proof. Whoever can edit a record can
append a matching line — but has to, deliberately, and git carries both files.
The chain's job is to make a rewrite something that must be done on purpose,
rather than something one tool disagreeing with another can do by accident.

See `.cursor/docs/LIFECYCLE.md` for the phases and
`.cursor/lifecycle/gates/` for what each gate requires.
