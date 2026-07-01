# Skill: skill-maturity-audit

**Invocation:** `/skill-maturity-audit [skill-name|all]`
Example: `/skill-maturity-audit all` · `/skill-maturity-audit dotnet-migration`

---

## Overview

**Memory references:** `.cursor/docs/skill-graph.md` (the declared
dependency contract this audit checks skills against), every
`.cursor/skills/*/skill.md` file in scope.

This is a meta-skill — it audits the workspace's own skill files, not a
target repository's source code. As the workspace has grown to 59+ skills
across multiple passes, the foundational contract (call `repo-discovery` for
freshness, call `pattern-finder` before generating, defer to
`context-builder` for multi-file tasks) has been wired into some skills
explicitly and left undocumented in others — `skill-graph.md` already tracks
which skills are and aren't wired in, but nothing previously *verified* that
tracking against the actual file contents. This skill closes that loop: it
checks what `skill-graph.md` claims against what the skill files actually do.

---

## Steps

**Step 1 — For each skill in scope, read its `skill.md` and check for:**

- Does it declare `repo-map.json`/`repo-discovery` as a memory reference, if
  its function plausibly needs repo structure awareness? (Generators and
  auditors plausibly do; pure git/release-process skills like
  `speckit-git-commit` plausibly don't — judge by function, not a blanket
  rule.)
- If it's a `*-gen` skill producing source code, does it have an explicit
  `pattern-finder` call as an early step?
- Does it cite which Tier 2 memory-bank file(s) it reads, or does it operate
  with no stated convention source at all (a real finding — a generator with
  no stated convention source is a generator that's likely to drift from
  this repo's actual style)?
- Does its Output section distinguish what's auto-applied vs. what's
  presented for review? (Skills touching consequential changes — schema,
  infra, auth — should never claim to auto-apply without review; flag any
  that do as a process risk, not just a documentation gap.)
- Does it hand off unresolved findings to `technical-debt-tracker` where
  relevant, or does it risk findings disappearing after the session ends?

**Step 2 — Cross-check against `skill-graph.md`'s claims.**

`skill-graph.md` states, for example, that 12 generator skills call
`pattern-finder`. Verify this is actually true in each of those 12 files,
not just true in the graph's own bookkeeping — a doc and the files it
describes can drift apart over time exactly like code and documentation can
elsewhere in this workspace.

**Step 3 — Score each skill against the maturity checklist.**

```
| Check | Weight |
|---|---|
| States its memory/convention sources | required |
| Calls repo-discovery/pattern-finder/context-builder where applicable | required if applicable |
| Distinguishes auto-applied vs. review-required output | required |
| Hands off unresolved findings to technical-debt-tracker | recommended |
| Has a concrete example invocation | recommended |
```

A skill meeting all required checks (and applicable recommended ones) is
**Mature**. Missing a required check is **Needs Work**. No memory/convention
source stated at all, for a skill that generates or modifies code, is
**Critical Gap** — this is the skill-level equivalent of the
hallucination-risk check `prompt-quality-audit` runs on prompts.

**Step 4 — Report by tier, not as one flat list of 59 entries.**

Group Critical Gap first (these are the ones most likely to produce code
that doesn't match repository reality), then Needs Work, then a one-line
confirmation count for Mature skills — don't spend report space re-praising
skills that are already fine.

**Step 5 — Do not auto-fix skill files.**

Findings here are exactly the kind of change to the workspace's own
infrastructure that should go through the same review the rest of this
workspace's enhancement passes have — present findings, let the developer
(or a follow-up pass, explicitly requested) make the edit.

---

## Example Invocation

**Command:** `/skill-maturity-audit all`

**Context:** Periodic workspace health check.

Agent reads all 59 skill files, confirms the 12 `pattern-finder`-wired
generators match `skill-graph.md`'s claim, finds `dotnet-migration` states
no memory-bank reference at all despite generating schema-changing code
(Critical Gap), and finds `release-notes-gen` has no example invocation
section (minor, Needs Work) — reports both, with the Critical Gap surfaced
first and recommended specifically because schema-changing code with no
stated convention source is the highest-risk category this check exists to
catch.

---

## Output

- Tiered report: Critical Gap / Needs Work / Mature (count only)
- For each non-Mature finding: which required/recommended check failed and
  a specific, file-referenced suggestion for closing it
- Any drift found between `skill-graph.md`'s claims and actual skill file
  content, flagged for that doc to be corrected
