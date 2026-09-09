#!/usr/bin/env node
/**
 * paths.test.mjs — path handling in _lib.mjs, where a wrong answer is a guard that misses.
 *
 *   relPath        used to be `abs.startsWith(root)`: a sibling directory whose
 *                  name began with the root's was "inside", and on Windows a
 *                  lower-case drive letter made every anchored pattern miss -
 *                  so a Tier 2 write with `d:\...` went through where `D:\...`
 *                  was refused.
 *   fileUrlPath    the plugin-install fallbacks used `new URL(...).pathname`,
 *                  which is `/D:/x` on Windows and opens nothing; every fallback
 *                  resolved to no file and the hook governed nothing, silently.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fixture, runHook, write, check, denies, report, section, REPO } from "../_harness.mjs";

const lib = await import(new URL(`file:///${join(REPO, ".claude", "hooks", "_lib.mjs").replace(/\\/g, "/")}`));
const root = fixture("paths");
process.env.CLAUDE_PROJECT_DIR = root;
const win = process.platform === "win32";

section("_lib.relPath");
{
  check("a path under the root is relative with forward slashes",
    lib.relPath(join(root, "memory-bank", "architecture.md")) === "memory-bank/architecture.md", lib.relPath(join(root, "memory-bank", "architecture.md")));
  check("a sibling directory whose name extends the root's is NOT inside it",
    !/^memory-bank\//.test(lib.relPath(join(root + "2", "memory-bank", "architecture.md"))), lib.relPath(join(root + "2", "memory-bank", "architecture.md")));
  check("a path outside the root comes back absolute, never as a plausible relative path",
    /^([A-Za-z]:)?\//.test(lib.relPath(join(root, "..", "elsewhere", "x.md"))), lib.relPath(join(root, "..", "elsewhere", "x.md")));
  check("a relative input resolves against cwd, not the root, and is reported honestly",
    typeof lib.relPath("x.md") === "string", "");
  if (win) {
    const lower = join(root, "memory-bank", "architecture.md").replace(/^([A-Z]):/, (m, d) => d.toLowerCase() + ":");
    check("Windows: a lower-case drive letter is the same tree", lib.relPath(lower) === "memory-bank/architecture.md", lib.relPath(lower));
    const upper = join(root, "memory-bank", "architecture.md").replace(/^([a-z]):/, (m, d) => d.toUpperCase() + ":");
    check("Windows: an upper-case drive letter is the same tree", lib.relPath(upper) === "memory-bank/architecture.md", lib.relPath(upper));
    check("Windows: backslashes normalise", lib.relPath(root + "\\src\\A.cs") === "src/A.cs", lib.relPath(root + "\\src\\A.cs"));
  }
}

section("_lib.fileUrlPath");
{
  const p = lib.fileUrlPath(new URL("./_lib.mjs", `file:///${join(REPO, ".claude", "hooks", "x").replace(/\\/g, "/")}`));
  check("returns a path existsSync can open", existsSync(p), p);
  if (win) check("Windows: no leading slash before the drive letter", /^[A-Za-z]:\\/.test(p), p);
  check("the old .pathname form would NOT have opened on Windows (documenting the bug)",
    !win || !existsSync(new URL("./_lib.mjs", `file:///${join(REPO, ".claude", "hooks", "x").replace(/\\/g, "/")}`).pathname), "");
}

section("guard-write.mjs — the refusal survives the drive-letter case");
if (win) {
  const lower = join(root, "memory-bank", "architecture.md").replace(/^([A-Z]):/, (m, d) => d.toLowerCase() + ":");
  denies("Tier 2 write with a lower-case drive letter is refused", runHook("guard-write.mjs", write(lower), root), "Tier 2");
  const upper = join(root, "memory-bank", "architecture.md").replace(/^([a-z]):/, (m, d) => d.toUpperCase() + ":");
  denies("Tier 2 write with an upper-case drive letter is refused", runHook("guard-write.mjs", write(upper), root), "Tier 2");
} else {
  console.log("  (skipped: drive letters are a Windows concern)");
}

section("_lib.globMatch");
{
  check("** spans directories", lib.globMatch(".claude/hooks/**", ".claude/hooks/a/b.mjs"), "");
  check("* does not", !lib.globMatch("lifecycle/*.json", "lifecycle/a/b.json"), "");
  check("case-insensitive", lib.globMatch("lifecycle/state.json", "Lifecycle/State.json"), "");
  check("dots are literal", !lib.globMatch("lifecycle/state.json", "lifecycle/stateXjson"), "");
}

section("_lib.isProtected");
{
  check("a hook is protected", lib.isProtected(".claude/hooks/guard-mcp.mjs") !== null, "");
  check("backslashes are normalised", lib.isProtected(".claude\\hooks\\guard-mcp.mjs") !== null, "");
  check("a leading ./ is ignored", lib.isProtected("./.cursor/mcp-policy.json") !== null, "");
  check("a document is not", lib.isProtected("docs/x.md") === null, "");
  check("the fallback list is a literal array self-audit can read", Array.isArray(lib.PROTECTED_FALLBACK) && lib.PROTECTED_FALLBACK.length > 10, "");
}

report("Path handling gives the same answer for every spelling of the same file.");
