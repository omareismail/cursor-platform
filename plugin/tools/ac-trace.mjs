#!/usr/bin/env node
/**
 * ac-trace.mjs — closes the loop between acceptance criteria and tests.
 *
 * WHY THIS EXISTS
 *
 * `dotnet-test-gen` and `react-test-gen` already emit `// AC-N:` traceability
 * comments, and specs already number their acceptance criteria. Nothing has ever
 * read them back. So nothing catches an AC with no test, a test claiming an AC
 * the spec no longer has, or an AC whose only test is skipped.
 *
 * The 2026 QA literature puts the failure mode plainly: "coverage without
 * traceability means running lots of tests without proving the right things;
 * traceability without execution means the matrix looks complete but nobody can
 * tell what actually ran." And separately: "tests that run a function but never
 * check its output contribute to coverage while verifying nothing."
 *
 * That second one matters more than usual here, because when the same process
 * writes the code and the tests, a passing test proves the two agree — not that
 * either is right. This tool refuses to count a test that cannot fail.
 *
 * WHAT IT CHECKS
 *
 *   uncovered      an AC in the spec that no test claims                 FAIL
 *   orphan         a test claiming an AC the spec does not define        FAIL
 *   skipped-only   the only test for an AC is skipped/ignored            FAIL
 *   vacuous        a claiming test with no assertion at all              FAIL
 *   weak           an assertion that cannot fail                         FAIL
 *   unclaimed      a test with no AC comment                             info
 *
 * Usage:
 *   node .cursor/tools/ac-trace.mjs check [spec.md] [--json] [--tests <glob-dir>]
 *   node .cursor/tools/ac-trace.mjs matrix [spec.md]        # the RTM, readable
 *   node .cursor/tools/ac-trace.mjs lint   [--tests <dir>]  # test quality only
 *
 * Exit codes:  0 = clean   1 = gaps found   2 = usage / nothing to check
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, extname, relative } from "node:path";

const ROOT = process.env.CLAUDE_PROJECT_DIR || repoRoot() || process.cwd();

const TEST_EXT = new Set([".cs", ".ts", ".tsx", ".js", ".jsx"]);
const TEST_PATH = /(^|\/)(tests?|__tests__|spec)(\/|$)|\.(test|spec)\.[jt]sx?$|Tests?\.cs$/i;
const SKIP_DIR = /(^|\/)(bin|obj|node_modules|dist|\.next|coverage|TestResults|\.git)(\/|$)/;

/** AC-1 / AC-01 / **AC-3** / `AC-12` — in a spec, anywhere on the line. */
const AC_IN_SPEC = /\bAC-(\d{1,3})\b/g;
/** // AC-3: description   (also # and * for block comments) */
const AC_IN_TEST = /(?:\/\/|#|\*)\s*AC-(\d{1,3})\s*[:.\-]?\s*(.*)$/gm;

/** Test declarations, so a claim can be attributed to the enclosing test. */
const TEST_DECL = [
  /\[(Fact|Theory)(\s*\([^)]*\))?\]/g,                       // xUnit
  /\b(?:it|test)\s*(?:\.\w+)?\s*\(\s*["'`]/g,                // vitest / jest
];
const SKIP_MARK = /\[(Fact|Theory)\s*\([^)]*\bSkip\s*=/i     // xUnit Skip="..."
  , SKIP_JS   = /\b(?:it|test|describe)\.(skip|todo)\s*\(|^\s*x(?:it|test|describe)\s*\(/m
  , IGNORE_CS = /\[Ignore(\s*\(|\])/i;

/**
 * Assertion shapes we accept as real. Deliberately generous — the goal is to
 * catch tests with NO assertion, not to police assertion style.
 */
const ASSERTION = /\b(Should\s*\(\s*\)|Assert\s*\.|expect\s*\(|\.toBe|\.toEqual|\.toHaveBeenCalled|\.toMatch|\.toThrow|Verify\s*\(|Received\s*\(|await\s+Assert)/;

/**
 * Assertions that cannot fail. Each of these passes regardless of whether the
 * code under test is correct, which makes them worse than no test: they turn
 * the coverage number and the traceability matrix green while proving nothing.
 */
const WEAK_ASSERTION = [
  [/\bexpect\s*\(\s*(true|1)\s*\)\s*\.\s*toBe\s*\(\s*(true|1)\s*\)/, "expect(true).toBe(true) — always passes"],
  [/\bAssert\s*\.\s*True\s*\(\s*true\s*\)/, "Assert.True(true) — always passes"],
  [/\bexpect\s*\(\s*[\w.]+\s*\)\s*\.\s*toBeDefined\s*\(\s*\)\s*;?\s*$/m, "toBeDefined() alone — passes for any non-undefined value"],
  [/\bShould\s*\(\s*\)\s*\.\s*NotBeNull\s*\(\s*\)\s*;\s*$/m, "NotBeNull() alone — passes for anything constructed"],
  [/\.\s*Should\s*\(\s*\)\s*\.\s*BeOfType\s*<[^>]+>\s*\(\s*\)\s*;\s*$/m, "BeOfType alone — asserts the type you just constructed"],
  [/\bexpect\s*\(\s*(?:mock|stub|spy)\w*\s*\)\s*\.\s*toBeDefined/i, "asserts the mock exists, not the behaviour"],
  [/\bAssert\s*\.\s*NotNull\s*\(\s*(?:mock|sub|substitute)\w*/i, "asserts the substitute exists, not the behaviour"],
  [/\.\s*Received\s*\(\s*\)\s*\.\s*\w+\s*\([^)]*\)\s*;\s*$(?![\s\S]{0,200}?(Should|Assert))/m, "only verifies a mock interaction — no assertion on the result"],
];

// ------------------------------------------------------------------ utils --
function repoRoot() {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { stdio: "pipe" }).toString().trim(); }
  catch { return null; }
}
function tracked() {
  try {
    return execFileSync("git", ["ls-files"], { cwd: ROOT, stdio: "pipe", maxBuffer: 64 * 1024 * 1024 })
      .toString().split("\n").filter(Boolean);
  } catch { return []; }
}
function walk(dir, acc = []) {
  let names; try { names = readdirSync(dir); } catch { return acc; }
  for (const n of names) {
    const full = join(dir, n);
    const rel = relative(ROOT, full).split("\\").join("/");
    if (SKIP_DIR.test("/" + rel)) continue;
    let st; try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, acc);
    else acc.push(rel);
  }
  return acc;
}
const allFiles = () => { const t = tracked(); return t.length ? t : walk(ROOT); };
const out = (s = "") => process.stdout.write(s + "\n");
const pad = (s, n) => String(s).slice(0, n - 1).padEnd(n);
function fail(msg, code = 2) { process.stderr.write(msg + "\n"); process.exit(code); }

// ---------------------------------------------------------------- parsing --

/** Acceptance criteria declared in a spec, with the line they appear on. */
function specACs(files, explicit = false) {
  const acs = new Map();   // "AC-3" -> {id, num, spec, line, text}
  for (const rel of files) {
    if (!rel.endsWith(".md")) continue;
    // Only real specs. Matching any path containing "spec" pulls in
    // documentation that merely mentions AC-1 as an example and invents
    // acceptance criteria nobody wrote.
    if (!explicit && !/^specs?\//.test(rel)) continue;
    let text; try { text = readFileSync(join(ROOT, rel), "utf8"); } catch { continue; }
    if (!/\bAC-\d/.test(text)) continue;
    text.split("\n").forEach((line, i) => {
      AC_IN_SPEC.lastIndex = 0;
      for (const m of line.matchAll(AC_IN_SPEC)) {
        const num = Number(m[1]);
        const id = `AC-${num}`;
        // The first mention with descriptive text wins; a bare cross-reference
        // later in the doc should not overwrite the definition.
        const desc = line.replace(/^[\s|*\-#>]*/, "").replace(/\bAC-\d{1,3}\b\s*[:.\-]?\s*/, "").trim();
        if (!acs.has(id) || (!acs.get(id).text && desc)) {
          acs.set(id, { id, num, spec: rel, line: i + 1, text: desc.slice(0, 120) });
        }
      }
    });
  }
  return acs;
}

/**
 * Slice a test file into individual tests.
 *
 * A "test" runs from its declaration to the next declaration. Claims are bound
 * separately (see bindClaim) because the two generators place the `// AC-N:`
 * comment on opposite sides of the declaration: C# emits
 *
 *     [Fact]
 *     // AC-1: ...
 *     public void Foo()
 *
 * while the React generator emits the comment above `it(`. Attributing a claim
 * to whichever slice it happens to fall in loses the first one in every file and
 * misfiles any that sit in the gap between two tests.
 */
function splitTests(text) {
  const marks = [];
  for (const re of TEST_DECL) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) marks.push(m.index);
  }
  marks.sort((a, b) => a - b);
  if (!marks.length) return { parts: [], marks: [] };
  const parts = marks.map((start, i) => ({
    start,
    end: i + 1 < marks.length ? marks[i + 1] : text.length,
    body: text.slice(start, i + 1 < marks.length ? marks[i + 1] : text.length),
  }));
  return { parts, marks };
}

/** Index of the test declaration a claim at `ci` belongs to — nearest wins. */
function bindClaim(ci, marks) {
  if (!marks.length) return -1;
  let next = marks.findIndex(m => m >= ci);
  if (next === -1) return marks.length - 1;          // after the last declaration
  const prev = next - 1;
  if (prev < 0) return next;                          // before the first one
  return (ci - marks[prev]) <= (marks[next] - ci) ? prev : next;
}

const lineOf = (text, idx) => text.slice(0, idx).split("\n").length;

/** AC claims found in test files, each attributed to the test it describes. */
function testClaims(files) {
  const claims = [];
  const unclaimed = [];
  const fileStats = [];

  for (const rel of files) {
    if (!TEST_EXT.has(extname(rel)) || !TEST_PATH.test(rel) || SKIP_DIR.test("/" + rel)) continue;
    let text; try { text = readFileSync(join(ROOT, rel), "utf8"); } catch { continue; }
    const { parts, marks } = splitTests(text);
    if (!parts.length) continue;

    // Bind every claim in the file to a test index first.
    const claimsByTest = new Map();
    AC_IN_TEST.lastIndex = 0;
    for (const m of text.matchAll(AC_IN_TEST)) {
      const idx = bindClaim(m.index, marks);
      if (idx < 0) continue;
      if (!claimsByTest.has(idx)) claimsByTest.set(idx, []);
      claimsByTest.get(idx).push({ num: Number(m[1]), note: (m[2] || "").trim().slice(0, 80), at: m.index });
    }

    let claimedHere = 0;
    parts.forEach((p, i) => {
      const skipped = SKIP_MARK.test(p.body) || SKIP_JS.test(p.body) || IGNORE_CS.test(p.body);
      const hasAssertion = ASSERTION.test(p.body);
      const weak = WEAK_ASSERTION.filter(([re]) => re.test(p.body)).map(([, why]) => why);
      const mine = claimsByTest.get(i) || [];

      if (!mine.length) {
        unclaimed.push({ file: rel, line: lineOf(text, p.start), skipped, vacuous: !hasAssertion });
        return;
      }
      claimedHere += mine.length;
      for (const c of mine) {
        claims.push({
          ac: `AC-${c.num}`, file: rel, line: lineOf(text, c.at),
          note: c.note, skipped, vacuous: !hasAssertion, weak,
        });
      }
    });
    fileStats.push({ file: rel, tests: parts.length, claims: claimedHere });
  }
  return { claims, unclaimed, fileStats };
}

// ---------------------------------------------------------------- analysis --
function analyse(acs, claims) {
  const byAc = new Map();
  for (const c of claims) {
    if (!byAc.has(c.ac)) byAc.set(c.ac, []);
    byAc.get(c.ac).push(c);
  }

  const uncovered = [], skippedOnly = [], vacuousOnly = [], covered = [];
  for (const [id, ac] of acs) {
    const cs = byAc.get(id) || [];
    if (!cs.length) { uncovered.push(ac); continue; }
    const live = cs.filter(c => !c.skipped);
    if (!live.length) { skippedOnly.push({ ...ac, claims: cs }); continue; }
    const real = live.filter(c => !c.vacuous && !c.weak.length);
    if (!real.length) { vacuousOnly.push({ ...ac, claims: live }); continue; }
    covered.push({ ...ac, claims: real, total: cs.length });
  }

  const orphans = [...byAc.entries()]
    .filter(([id]) => !acs.has(id))
    .map(([id, cs]) => ({ ac: id, claims: cs }));

  const vacuous = claims.filter(c => c.vacuous);
  const weak = claims.filter(c => c.weak.length);

  return { uncovered, skippedOnly, vacuousOnly, covered, orphans, vacuous, weak, byAc };
}

// ---------------------------------------------------------------- commands --
function load(args) {
  const specArg = args.find(a => !a.startsWith("--") && a.endsWith(".md"));
  let files = allFiles();
  const ti = args.indexOf("--tests");
  if (ti >= 0) {
    const dir = args[ti + 1].replace(/^\.\//, "");
    files = files.filter(f => f.startsWith(dir) || f.endsWith(".md"));
  }
  let acs;
  if (specArg) {
    if (!existsSync(join(ROOT, specArg)) && !existsSync(specArg)) fail(`Not found: ${specArg}`, 2);
    acs = specACs([specArg.replace(ROOT + "/", "")], true);
    if (!acs.size) fail(`No acceptance criteria found in ${specArg}.\n` +
      `Expected numbered criteria written as AC-1, AC-2, ... anywhere in the document.`, 2);
  } else {
    acs = specACs(files);
  }
  const { claims, unclaimed, fileStats } = testClaims(files);
  return { acs, claims, unclaimed, fileStats, specArg, files };
}

const CMDS = {
  check(args) {
    const { acs, claims, unclaimed, fileStats, specArg } = load(args);
    const a = analyse(acs, claims);
    const json = args.includes("--json");

    if (json) {
      out(JSON.stringify({
        scope: specArg || "all specs", acs: acs.size, claims: claims.length,
        uncovered: a.uncovered, orphans: a.orphans, skippedOnly: a.skippedOnly,
        vacuousOnly: a.vacuousOnly, vacuous: a.vacuous, weak: a.weak,
        covered: a.covered.length, unclaimedTests: unclaimed.length,
      }, null, 2));
      return failures(a) ? 1 : 0;
    }

    out(`# AC traceability — ${specArg || "all specs"}\n`);
    if (!acs.size) {
      out(`  No acceptance criteria found. Nothing to trace.`);
      out(`  Number your criteria AC-1, AC-2, ... in the spec, and have tests carry`);
      out(`  a matching \`// AC-N:\` comment (both test generators already emit these).`);
      return 0;
    }
    const pctCovered = ((a.covered.length / acs.size) * 100).toFixed(0);
    out(`  ${acs.size} acceptance criteria | ${claims.length} claims across ${fileStats.length} test files`);
    out(`  ${a.covered.length} genuinely covered (${pctCovered}%)\n`);

    if (a.uncovered.length) {
      out(`## UNCOVERED (${a.uncovered.length}) — in the spec, no test claims them`);
      for (const ac of a.uncovered) out(`  ${pad(ac.id, 8)} ${pad(ac.spec + ":" + ac.line, 44)} ${ac.text}`);
      out("");
    }
    if (a.orphans.length) {
      out(`## ORPHAN CLAIMS (${a.orphans.length}) — a test claims an AC the spec does not define`);
      out(`   Either the spec changed and the test was not updated, or the test is`);
      out(`   claiming coverage it does not have. Both are worth knowing.`);
      for (const o of a.orphans) for (const c of o.claims) out(`  ${pad(o.ac, 8)} ${c.file}:${c.line}`);
      out("");
    }
    if (a.skippedOnly.length) {
      out(`## SKIPPED-ONLY (${a.skippedOnly.length}) — the only test for this AC is skipped`);
      out(`   Worse than no test: the matrix looks green and nothing is verified.`);
      for (const s of a.skippedOnly) out(`  ${pad(s.id, 8)} ${s.claims.map(c => c.file + ":" + c.line).join(", ")}`);
      out("");
    }
    if (a.vacuousOnly.length) {
      out(`## COVERED BY NOTHING REAL (${a.vacuousOnly.length}) — every claiming test is vacuous or weak`);
      for (const v of a.vacuousOnly) {
        out(`  ${pad(v.id, 8)} ${v.text}`);
        for (const c of v.claims) out(`           ${c.file}:${c.line}  ${c.vacuous ? "no assertion" : c.weak[0]}`);
      }
      out("");
    }
    if (a.vacuous.length) {
      out(`## VACUOUS TESTS (${a.vacuous.length}) — claim an AC, assert nothing`);
      for (const c of a.vacuous.slice(0, 15)) out(`  ${pad(c.ac, 8)} ${c.file}:${c.line}`);
      if (a.vacuous.length > 15) out(`  ... and ${a.vacuous.length - 15} more`);
      out("");
    }
    if (a.weak.length) {
      out(`## ASSERTIONS THAT CANNOT FAIL (${a.weak.length})`);
      for (const c of a.weak.slice(0, 15)) out(`  ${pad(c.ac, 8)} ${pad(c.file + ":" + c.line, 44)} ${c.weak[0]}`);
      if (a.weak.length > 15) out(`  ... and ${a.weak.length - 15} more`);
      out("");
    }
    if (unclaimed.length) {
      out(`## Tests with no AC comment (${unclaimed.length}) — informational`);
      out(`   Not a failure: unit tests for internal helpers legitimately map to no`);
      out(`   acceptance criterion. Worth a look if the count is high.\n`);
    }

    const n = failures(a);
    if (n) {
      out(`FAILED: ${n} gap(s).`);
      out(`An acceptance criterion with no test that can fail is not implemented —`);
      out(`it is untested code that happens to compile. Fix the tests, or remove the`);
      out(`criterion from the spec if it is genuinely no longer required.`);
      return 1;
    }
    out(`OK: every acceptance criterion is covered by at least one test that can fail.`);
    return 0;
  },

  matrix(args) {
    const { acs, claims, specArg } = load(args);
    const a = analyse(acs, claims);
    if (!acs.size) fail("No acceptance criteria found.", 2);

    out(`# Requirements traceability matrix — ${specArg || "all specs"}\n`);
    out(`  ${pad("AC", 8)}${pad("STATUS", 16)}${pad("TESTS", 7)}CRITERION / EVIDENCE`);
    out(`  ${"-".repeat(76)}`);
    for (const [id, ac] of [...acs].sort((x, y) => x[1].num - y[1].num)) {
      const cs = a.byAc.get(id) || [];
      const live = cs.filter(c => !c.skipped && !c.vacuous && !c.weak.length);
      const status = !cs.length ? "UNCOVERED"
                   : !cs.some(c => !c.skipped) ? "SKIPPED-ONLY"
                   : !live.length ? "NOT REAL"
                   : "covered";
      out(`  ${pad(id, 8)}${pad(status, 16)}${pad(String(cs.length), 7)}${ac.text}`);
      for (const c of cs) {
        const flag = c.skipped ? " [skipped]" : c.vacuous ? " [no assertion]" : c.weak.length ? ` [${c.weak[0]}]` : "";
        out(`  ${" ".repeat(31)}${c.file}:${c.line}${flag}`);
      }
    }
    out(`\n  covered = at least one claiming test that is neither skipped, vacuous, nor`);
    out(`  built on an assertion that cannot fail.`);
    return failures(a) ? 1 : 0;
  },

  lint(args) {
    const { claims, unclaimed, fileStats } = load(args);
    const vacuous = [...claims.filter(c => c.vacuous), ...unclaimed.filter(u => u.vacuous)];
    const weak = claims.filter(c => c.weak.length);
    const skipped = [...claims.filter(c => c.skipped), ...unclaimed.filter(u => u.skipped)];

    if (args.includes("--json")) {
      out(JSON.stringify({ files: fileStats.length, vacuous, weak, skipped }, null, 2));
      return vacuous.length + weak.length ? 1 : 0;
    }
    out(`# Test quality — ${fileStats.length} test files\n`);
    out(`  ${vacuous.length} with no assertion | ${weak.length} with an assertion that cannot fail | ${skipped.length} skipped\n`);
    for (const c of vacuous.slice(0, 25)) out(`  no assertion   ${c.file}:${c.line}`);
    for (const c of weak.slice(0, 25))    out(`  cannot fail    ${pad(c.file + ":" + c.line, 46)} ${c.weak[0]}`);
    for (const c of skipped.slice(0, 15)) out(`  skipped        ${c.file}:${c.line}`);
    out("");
    if (vacuous.length + weak.length) {
      out(`FAILED: ${vacuous.length + weak.length} test(s) cannot fail.`);
      out(`A test that cannot fail raises the coverage number and proves nothing. When`);
      out(`the same process wrote the code and the test, that is the whole risk.`);
      return 1;
    }
    out(`OK: every test asserts something that can fail.`);
    return 0;
  },
};

const failures = (a) =>
  a.uncovered.length + a.orphans.length + a.skippedOnly.length +
  a.vacuousOnly.length + a.vacuous.length + a.weak.length;

const [cmd, ...args] = process.argv.slice(2);
if (!cmd || !CMDS[cmd]) {
  out(readFileSync(new URL(import.meta.url)).toString()
    .split("\n").slice(2, 42).join("\n").replace(/^\s*\*\/?\s?/gm, "").trim());
  process.exit(cmd ? 2 : 0);
}
process.exit(CMDS[cmd](args) ?? 0);
