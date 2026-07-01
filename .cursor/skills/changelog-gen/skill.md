# Skill: changelog-gen

**Invocation:** `/changelog-gen [version]`

---

## Overview

`changelog-gen` generates a user-facing changelog entry in Keep a Changelog format
from merged feature specs and Conventional Commit history since the last tagged release.
It is deliberately separate from internal commit messages (which are implementation-focused
jargon for developers) and from `release-notes-gen` (which produces customer-facing release
notes for product/marketing). The changelog audience is technical users and developers who
want to know what changed between versions.

---

## Steps

**Step 1 — Determine the range.**

```bash
git log [last-tag]..HEAD --oneline --no-merges
```

If no `[version]` argument is given, determine the next version from the commit history:
- Any `feat:` commit since the last tag → bump minor version
- Any `BREAKING CHANGE:` commit → bump major version
- Only `fix:`, `perf:`, `docs:` commits → bump patch version

**Step 2 — Group commits by Conventional Commit type.**

```
feat     → Added section
fix      → Fixed section
perf     → Changed section (performance improvements)
refactor → (internal, skip — not user-facing)
test     → (internal, skip)
chore    → (internal, skip)
docs     → Changed section (if user-facing docs)
security → Security section (always include)
BREAKING CHANGE → top of entry, before all sections
```

**Step 3 — Cross-reference with spec files.**

For each `feat:` and `fix:` commit, find the referenced spec file (in the commit body).
Pull the feature's Overview paragraph for user-facing framing rather than using the
technical commit message wording.

**Step 4 — Write the changelog entry.**

Prepend to `CHANGELOG.md`:

```markdown
## [version] — YYYY-MM-DD

### ⚠ Breaking Changes
- [BREAKING] [Description of breaking change and migration steps]

### Added
- **[Feature display name]:** [1-2 sentence plain-English description from spec overview]
- **[Feature display name]:** [description]

### Changed
- [Description of changed behaviour]
- [Performance improvement]

### Fixed
- [Bug fix description — focus on what the user experienced, not the implementation]

### Security
- [Security fix — describe the risk that was addressed without enabling exploit reproduction]

### Deprecated
- [What is deprecated and what to use instead]
```

**Step 5 — Flag items needing product/legal review.**

```
⚠ The following items may need product/legal review before publishing:
  - "Added: Export client data to CSV" — involves PII data handling change (data team review)
  - "Changed: Payment processing now uses retry logic" — compliance team may need to review
```

---

## Example Invocation

**Command:** `/changelog-gen 1.4.0`

Agent reads commits since `v1.3.2` tag: 3 feat commits (broker export, payment retry,
notification preferences), 2 fix commits (currency display, date formatting). Cross-
references `specs/features/broker-client-csv-export.md` for the export feature description.
Generates the v1.4.0 entry and prepends to `CHANGELOG.md`. Flags the export feature for
data team review.

---

## Output

- Updated: `CHANGELOG.md` (new version entry prepended)
- Terminal: any items flagged for product/legal review
