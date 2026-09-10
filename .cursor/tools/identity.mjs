#!/usr/bin/env node
/**
 * identity.mjs — local identity-to-role adapter for approvals.
 *
 * Idea 11 first useful: a testable mapping. Local `--by` remains the default
 * when no mapping file exists. Changing artifact bytes invalidates a bound
 * approval. Org SSO is out of scope until an adopter names the integration.
 *
 * Usage:
 *   node .cursor/tools/identity.mjs verify --by "<name>" --digest <sha256> [--expect <sha256>] [--role <role>] [--mapping <file>] [--json]
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { report, emit, block, warn, info } from "./_findings.mjs";

const ROOT = process.env.CLAUDE_PROJECT_DIR || repoRoot() || process.cwd();

function repoRoot() {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

function valueOf(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

export function loadMapping(root, mappingPath) {
  const p = mappingPath || join(root, ".cursor", "identity.json");
  if (!existsSync(p)) return { mode: "local", identities: {}, path: null };
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    return { mode: "mapped", identities: raw.identities || {}, path: p };
  } catch {
    return { mode: "invalid", identities: {}, path: p };
  }
}

/**
 * Bind an approval to (by, digest). Unauthorized identity or a digest that
 * no longer matches the expected artifact hash is a refusal.
 */
export function verifyApproval({ by, digest, expect, role, mapping, author }) {
  const findings = [];
  if (!by) findings.push(block("missing-identity", "--by is required"));
  if (!digest) findings.push(block("missing-digest", "--digest is required"));
  if (author && by && String(author).trim().toLowerCase() === String(by).trim().toLowerCase()) {
    findings.push(block("author-reviewer-same", "the reviewer cannot be the author of the artifacts", { ref: by }));
  }
  if (mapping?.mode === "invalid") findings.push(block("mapping-invalid", "identity mapping is not JSON", { file: mapping.path }));
  if (mapping?.mode === "mapped" && by) {
    const rec = mapping.identities[by];
    if (!rec) findings.push(block("unauthorized-identity", `'${by}' is not in the identity mapping`, { ref: by }));
    else if (role && !(rec.roles || []).includes(role)) {
      findings.push(block("unauthorized-role", `'${by}' is not mapped to role ${role}`, { ref: role }));
    } else {
      findings.push(info("identity", `'${by}' mapped`, { ref: (rec.roles || []).join(",") }));
    }
  } else if (mapping?.mode === "local") {
    findings.push(info("local-by", "no identity mapping; local --by is accepted", { ref: by || "" }));
  }
  if (expect && digest && expect.toLowerCase() !== digest.toLowerCase()) {
    findings.push(block("digest-mismatch", "artifact digest no longer matches the bound approval", { ref: digest }));
  } else if (digest && expect) {
    findings.push(info("digest-ok", "digest matches the bound approval"));
  }
  const blocks = findings.filter((f) => f.severity === "block").length;
  return report({
    tool: "identity.mjs",
    command: "verify",
    findings,
    data: { by, digest, expect, role, author: author || null, mode: mapping?.mode || "local" },
    summary: blocks ? `${blocks} blocking identity finding(s)` : `identity ok (${mapping?.mode || "local"})`,
  });
}

const invoked = (() => {
  try { return fileURLToPath(import.meta.url) === process.argv[1]; }
  catch { return false; }
})();
if (invoked) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (cmd !== "verify") {
    process.stderr.write("Usage: node .cursor/tools/identity.mjs verify --by <name> --digest <sha> [--expect <sha>] [--role <role>] [--author <name>] [--mapping <file>] [--json]\n");
    process.exit(2);
  }
  const mapping = loadMapping(ROOT, valueOf(args, "--mapping"));
  const r = verifyApproval({
    by: valueOf(args, "--by"),
    digest: valueOf(args, "--digest"),
    expect: valueOf(args, "--expect"),
    role: valueOf(args, "--role"),
    author: valueOf(args, "--author"),
    mapping,
  });
  if (args.includes("--json")) process.exit(emit(r));
  process.stdout.write(`${r.summary}\n`);
  for (const f of r.findings) process.stdout.write(`  ${f.severity} ${f.code} ${f.message}\n`);
  process.exit(r.exit);
}
