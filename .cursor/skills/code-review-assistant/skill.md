# Skill: code-review-assistant

**Invocation:** `/code-review-assistant [PR-number-or-diff]`

---

## Overview

**Memory references:** `memory-bank/codingStandards.md, memory-bank/commonMistakes.md`

`code-review-assistant` produces a structured review of a pull request or diff against
the active spec and the architecture/security rules. It is distinct from `speckit-checklist`
(which is a pre-commit self-gate by the author) — this skill is for reviewing someone else's
PR, or doing a second pass before requesting review on your own. Every finding references
`file:line`, uses a respectful and constructive tone, and separates Blocking issues from
Suggestions and Nits. The output is a draft review comment that can be directly posted via
`gh pr review`.

---

## Steps

**Step 1 — Get the diff.**

If `[PR-number]` is given:
```bash
gh pr diff [PR-number]
```

If a diff file or staged diff is given, read it directly.

**Step 2 — Find the spec this PR claims to implement.**

Look in commit messages for `Spec: specs/features/[feature-slug].md`.
If not found, look for the feature slug in the branch name.
If still not found, ask the user to specify.

**Step 3 — Check the diff against every acceptance criterion.**

For each AC in the spec, determine if the diff:
- ✅ Addresses it (corresponding code + test present)
- ⚠ Partially addresses it (code present but no test, or test present but no AC comment)
- ❌ Does not address it (no code change found)

Output a coverage table:

```
Acceptance Criteria Coverage:
  AC-1 ✅ Covered — ExportBrokerClientsHandler.cs + test AC-1 comment
  AC-2 ✅ Covered
  AC-3 ⚠ Partial — handler has ownership check but integration test for AC-3 not found
  AC-4 ❌ Not covered — empty-list export test missing
```

**Step 4 — Run architecture and security rules against changed files.**

Apply `02-dotnet-architecture-guard.mdc` (for `.cs` files) and
`03-react-architecture-guard.mdc` (for `.ts`/`.tsx` files) and
`04-security-guard.mdc` (for all files).

**Step 5 — Output the review.**

```markdown
## Code Review: [PR title]
**Spec:** specs/features/[feature-slug].md
**Reviewer:** speckit code-review-assistant

---

### ❌ Blocking Issues

**[1] src/Application/Export/ExportHandler.cs:45 — Missing ownership check**
The handler calls `_repo.GetClientsAsync(query.BrokerId)` without first verifying that
the authenticated user owns the requested brokerId. Per spec §Security: "The API must
verify broker ownership before returning data (IDOR mitigation)."
Suggested fix: Call `_authzService.VerifyBrokerOwnerAsync(query.BrokerId, userId, ct)`
before the repo call, and return `Result.Failure("Forbidden")` if it fails.

**[2] AC-4 not covered — empty-list export test missing**
Spec AC-4: "Given the client list is empty after filtering, the CSV contains only the
header row." No test method found for this case. Add it to ExportHandlerTests.cs.

---

### 💡 Suggestions

**src/Application/Export/ExportBrokerClientsHandler.cs:23**
`CancellationToken` parameter is declared but never passed to `_csvWriter.WriteAsync()`.
The writer would not respond to cancellation (e.g. on app shutdown or client disconnect).
Pass the token: `await _csvWriter.WriteAsync(stream, clients, cancellationToken)`.

---

### 🔧 Nits

**ExportBrokerClientsResponse.cs:8**
XML doc comment says "Returns the exported file" — consider "Returns the exported CSV as
a binary stream" for clarity.
```

**Step 6 — Generate `gh pr review` command.**

```bash
gh pr review [PR-number] \
  --request-changes \
  --body "$(cat /tmp/review-[PR-number].md)"
```

---

## Example Invocation

**Command:** `/code-review-assistant 47`

Agent fetches PR #47 diff, identifies the spec from commit body, checks 7 ACs (5 covered,
1 partial, 1 missing), runs architecture rules (finds 1 missing ownership check), runs
security rules (passes), generates review with 2 blocking + 1 suggestion + 1 nit.

---

**MCP tools:** if the `git` MCP server is connected, use it to check blame/history on flagged lines (e.g. "was this security check ever enabled") instead of asking the developer to look it up.

## Output

- Terminal: AC coverage table + structured review (Blocking / Suggestions / Nits)
- Terminal: `gh pr review` command for posting the review
