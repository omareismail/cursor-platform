#!/usr/bin/env node
/**
 * _policy.mjs — one source-root / write-policy evaluator.
 *
 * WHY THIS EXISTS
 *
 * Three lists used to name the same thing and could drift: SOURCE_ROOTS in
 * lifecycle.mjs, the built-in `application-source.match` in guard-phase.mjs,
 * and the hardcoded `find src backend frontend …` in adopter CI. Status
 * layout, the design-gate hook, and CI then disagreed about whether
 * `packages/` was application source.
 *
 * This module is that list, plus the glob and the built-in fallback.
 * lifecycle.mjs and guard-phase.mjs import it. Do not import lifecycle.mjs
 * from here (the hook already imports lifecycle).
 *
 * Do not import lifecycle.mjs from here (the hook already imports lifecycle).
 *
 * Usage:
 *   node .cursor/tools/_policy.mjs roots
 *   node .cursor/tools/_policy.mjs layout [--json]
 *   node .cursor/tools/_policy.mjs builtin --json
 *   node .cursor/tools/_policy.mjs simulate --proposed <file> [--current <file>] [--json]
 *   node .cursor/tools/_policy.mjs explain <path> [--json]
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

/** Conventional application-source roots. A monorepo with only `packages/` is still application source. */
export const SOURCE_ROOTS = ["src", "backend", "frontend", "client", "server", "app", "apps", "api", "web", "lib", "packages", "services"];

export const SOURCE_EXTENSIONS = [".cs", ".csproj", ".sln", ".fs", ".vb", ".ts", ".tsx", ".js", ".jsx", ".vue", ".svelte", ".razor", ".cshtml", ".sql"];

/**
 * Same built-in fallback as `.claude/hooks/guard-phase.mjs`. A missing local
 * policy is not "nothing is gated". `.github/**` is in this fallback (the
 * project's write-policy.json may omit it — the file still wins when present).
 */
export const BUILTIN_WRITE_POLICY = {
  version: 0,
  alwaysAllow: ["docs/**", "specs/**", "memory-bank/**", "lifecycle/**", "templates/**",
                "scripts/**", "tests/**", "test/**", "e2e/**", ".cursor/**", ".claude/**", ".github/**", "*.md"],
  rules: [{
    id: "application-source",
    match: SOURCE_ROOTS.map((d) => `${d}/**`),
    extensions: SOURCE_EXTENSIONS,
    earliest: "DEVELOPMENT",
    why: "Code written before the design gate implements a design nobody approved.",
  }],
};

/** Minimal glob — MUST stay aligned with `.claude/hooks/guard-phase.mjs`. */
export function policyGlob(pattern, s) {
  const rx = pattern
    .split(/(\*\*\/|\*\*|\*|\?)/)
    .map((part) => {
      if (part === "**/") return "(?:.*/)?";
      if (part === "**") return ".*";
      if (part === "*") return "[^/]*";
      if (part === "?") return "[^/]";
      return part.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return new RegExp(`^${rx}$`, "i").test(s);
}

export function loadWritePolicy(root, { importMetaUrl } = {}) {
  const candidates = [
    join(root, ".cursor", "lifecycle", "write-policy.json"),
  ];
  if (importMetaUrl) {
    try { candidates.push(fileURLToPath(new URL("../lifecycle/write-policy.json", importMetaUrl))); } catch { /* not a file URL */ }
  }
  for (const c of candidates) {
    try {
      if (!existsSync(c)) continue;
      return JSON.parse(readFileSync(c, "utf8"));
    } catch { /* malformed: keep looking, then fall back */ }
  }
  return BUILTIN_WRITE_POLICY;
}

export function classifyPath(policy, sample) {
  const always = policy.alwaysAllow || [];
  if (always.some((g) => policyGlob(g, sample))) return { verdict: "exempt", rule: null, earliest: null };
  const rule = (policy.rules || []).find((r) =>
    (r.match || []).some((g) => policyGlob(g, sample)) &&
    (!r.extensions?.length || r.extensions.some((e) => sample.toLowerCase().endsWith(e.toLowerCase()))));
  if (rule) return { verdict: "gated", rule: rule.id || null, earliest: rule.earliest || null };
  return { verdict: "ungoverned", rule: null, earliest: null };
}

export function classifySourceSample(policy, sample) {
  const v = classifyPath(policy, sample).verdict;
  return v === "ungoverned" ? "unrecognized" : v;
}

/** Curated paths for current-vs-proposed comparison. Harmless work must stay allowed. */
export const POLICY_CORPUS = [
  { id: "cs-src", path: "src/Pay/Handler.cs", kind: "source" },
  { id: "cs-packages", path: "packages/Lib/A.cs", kind: "source" },
  { id: "tsx-frontend", path: "frontend/App.tsx", kind: "source" },
  { id: "md-docs", path: "docs/README.md", kind: "docs" },
  { id: "test", path: "tests/foo.test.mjs", kind: "test" },
  { id: "tf", path: "infra/main.tf", kind: "iac" },
  { id: "k8s", path: "k8s/deploy.yaml", kind: "deploy" },
  { id: "gha", path: ".github/workflows/ci.yml", kind: "ci" },
];

export function comparePolicies(current, proposed, samples = POLICY_CORPUS) {
  const rows = [];
  for (const s of samples) {
    const a = classifyPath(current, s.path);
    const b = classifyPath(proposed, s.path);
    let change = "unchanged";
    if (a.verdict !== b.verdict) {
      if (b.verdict === "gated" && a.verdict !== "gated") change = "newly-refused";
      else if (a.verdict === "gated" && b.verdict !== "gated") change = "newly-allowed";
      else change = "changed";
    }
    rows.push({ id: s.id, path: s.path, kind: s.kind, current: a, proposed: b, change });
  }
  return {
    newlyAllowed: rows.filter((r) => r.change === "newly-allowed"),
    newlyRefused: rows.filter((r) => r.change === "newly-refused"),
    changed: rows.filter((r) => r.change !== "unchanged"),
    rows,
  };
}

/**
 * Which detected source roots would a `.cs` file under them actually match in
 * the effective write-policy (local file, else the same built-in the hook
 * uses)? `alwaysAllow` is an intentional exemption, not "covered".
 */
export function sourceLayout(root, opts = {}) {
  const detected = SOURCE_ROOTS.filter((d) => {
    try { return statSync(join(root, d)).isDirectory(); } catch { return false; }
  });
  const policy = opts.policy || loadWritePolicy(root, opts);
  const covered = [];
  const uncovered = [];
  const exempt = [];
  for (const dir of detected) {
    const kind = classifySourceSample(policy, `${dir}/x.cs`);
    if (kind === "gated") covered.push(dir);
    else if (kind === "exempt") exempt.push(dir);
    else uncovered.push(dir);
  }
  return { detected, covered, uncovered, exempt };
}

function repoRoot() {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return process.cwd(); }
}

const invoked = (() => {
  try { return fileURLToPath(import.meta.url) === process.argv[1]; }
  catch { return false; }
})();
if (invoked) {
  const root = process.env.CLAUDE_PROJECT_DIR || repoRoot();
  const cmd = process.argv[2] || "roots";
  const json = process.argv.includes("--json");
  if (cmd === "roots") {
    process.stdout.write(SOURCE_ROOTS.join("\n") + "\n");
  } else if (cmd === "layout") {
    const layout = sourceLayout(root, { importMetaUrl: import.meta.url });
    process.stdout.write(json ? JSON.stringify(layout) + "\n" : `${layout.detected.join(" ") || "(none)"}\n`);
  } else if (cmd === "builtin") {
    process.stdout.write(JSON.stringify(BUILTIN_WRITE_POLICY, null, 2) + "\n");
  } else if (cmd === "simulate") {
    const idxP = process.argv.indexOf("--proposed");
    const idxC = process.argv.indexOf("--current");
    const proposedPath = idxP >= 0 ? process.argv[idxP + 1] : null;
    if (!proposedPath) {
      process.stderr.write("Usage: node .cursor/tools/_policy.mjs simulate --proposed <file> [--current <file>] [--json]\n");
      process.exit(2);
    }
    let proposed, current;
    try { proposed = JSON.parse(readFileSync(proposedPath, "utf8")); }
    catch (e) { process.stderr.write(`cannot read --proposed: ${e.message}\n`); process.exit(2); }
    if (idxC >= 0) {
      try { current = JSON.parse(readFileSync(process.argv[idxC + 1], "utf8")); }
      catch (e) { process.stderr.write(`cannot read --current: ${e.message}\n`); process.exit(2); }
    } else {
      current = loadWritePolicy(root, { importMetaUrl: import.meta.url });
    }
    const cmp = comparePolicies(current, proposed);
    if (json) process.stdout.write(JSON.stringify(cmp, null, 2) + "\n");
    else {
      process.stdout.write(`newly-allowed ${cmp.newlyAllowed.length}  newly-refused ${cmp.newlyRefused.length}\n`);
      for (const r of cmp.changed) process.stdout.write(`  ${r.change.padEnd(16)} ${r.path}  ${r.current.verdict} -> ${r.proposed.verdict}\n`);
    }
  } else if (cmd === "explain") {
    const sample = process.argv[3];
    if (!sample) {
      process.stderr.write("Usage: node .cursor/tools/_policy.mjs explain <path> [--json]\n");
      process.exit(2);
    }
    const policy = loadWritePolicy(root, { importMetaUrl: import.meta.url });
    const row = classifyPath(policy, sample.replace(/\\/g, "/"));
    const body = { path: sample.replace(/\\/g, "/"), ...row, exemptions: policy.alwaysAllow || [] };
    process.stdout.write(json ? JSON.stringify(body, null, 2) + "\n" : `${body.verdict}${body.rule ? ` rule=${body.rule}` : ""}${body.earliest ? ` earliest=${body.earliest}` : ""}\n`);
  } else {
    process.stderr.write("Usage: node .cursor/tools/_policy.mjs [roots|layout|builtin|simulate|explain] [--json]\n");
    process.exit(2);
  }
}
