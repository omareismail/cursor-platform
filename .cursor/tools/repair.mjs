#!/usr/bin/env node
/**
 * repair.mjs — versioned docs/config recipes with preview, isolated apply, rollback.
 *
 * Idea 7 first useful: deterministic documentation/configuration repairs only.
 * Human-only approvals stay refused. Never writes integrity or lifecycle records.
 *
 * Usage:
 *   node .cursor/tools/repair.mjs list [--json]
 *   node .cursor/tools/repair.mjs preview <recipe-id> [--json]
 *   node .cursor/tools/repair.mjs apply <recipe-id> --out <isolated-dir>
 *   node .cursor/tools/repair.mjs rollback --out <isolated-dir>
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { write as writeIndex } from "./_skills-index.mjs";
import { BUILTIN_WRITE_POLICY } from "./_policy.mjs";

const ROOT = process.env.CLAUDE_PROJECT_DIR || repoRoot() || process.cwd();
const BACKUP = ".repair-backup";

function repoRoot() {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

export const RECIPES = {
  "skills-index-stale": {
    version: 1,
    files: [".cursor/skills.index.json"],
    preconditions: "`.cursor/skills/` exists",
    verify: "node .cursor/tools/docs-lint.mjs check",
    why: "Regenerate the generated skill index from folders + catalog.",
  },
  "write-policy-missing": {
    version: 1,
    files: [".cursor/lifecycle/write-policy.json"],
    preconditions: "destination is an isolated --out tree, not the live enforcement copy unless previewed",
    verify: "node .cursor/tools/_policy.mjs layout --json",
    why: "Materialise the built-in write policy as a local file.",
  },
};

function die(msg, code = 2) { process.stderr.write(msg + "\n"); process.exit(code); }

function previewRecipe(id, root = ROOT) {
  const rec = RECIPES[id];
  if (!rec) return { ok: false, error: `unknown recipe ${id}` };
  const missing = rec.files.filter((f) => !existsSync(join(root, f)));
  return { ok: true, recipe: id, version: rec.version, files: rec.files, missing, wouldWrite: rec.files, verify: rec.verify, why: rec.why };
}

function applyRecipe(id, outDir, root = ROOT) {
  const rec = RECIPES[id];
  if (!rec) return { ok: false, error: `unknown recipe ${id}` };
  if (!outDir) return { ok: false, error: "--out is required; apply is isolated" };
  const dest = resolve(outDir);
  if (dest === resolve(root)) return { ok: false, error: "refusing to apply in the live repo root; pass an isolated --out" };
  mkdirSync(dest, { recursive: true });
  const bak = join(dest, BACKUP);
  mkdirSync(bak, { recursive: true });
  const written = [];
  if (id === "skills-index-stale") {
    const fromSkills = join(root, ".cursor", "skills");
    if (!existsSync(fromSkills)) return { ok: false, error: "no .cursor/skills in source" };
    mkdirSync(join(dest, ".cursor"), { recursive: true });
    cpSync(fromSkills, join(dest, ".cursor", "skills"), { recursive: true });
    const catalog = join(root, ".cursor", "docs", "skill-catalog.md");
    if (existsSync(catalog)) {
      mkdirSync(join(dest, ".cursor", "docs"), { recursive: true });
      cpSync(catalog, join(dest, ".cursor", "docs", "skill-catalog.md"));
    }
    const idxPath = join(dest, ".cursor", "skills.index.json");
    if (existsSync(idxPath)) {
      mkdirSync(dirname(join(bak, ".cursor", "skills.index.json")), { recursive: true });
      cpSync(idxPath, join(bak, ".cursor", "skills.index.json"));
    }
    writeIndex(dest);
    written.push(".cursor/skills.index.json");
  }
  if (id === "write-policy-missing") {
    const rel = ".cursor/lifecycle/write-policy.json";
    const abs = join(dest, rel);
    mkdirSync(dirname(abs), { recursive: true });
    if (existsSync(abs)) {
      mkdirSync(dirname(join(bak, rel)), { recursive: true });
      cpSync(abs, join(bak, rel));
    }
    writeFileSync(abs, JSON.stringify(BUILTIN_WRITE_POLICY, null, 2) + "\n");
    written.push(rel);
  }
  writeFileSync(join(dest, ".repair-last.json"), JSON.stringify({ recipe: id, written, at: new Date().toISOString() }, null, 2));
  return { ok: true, recipe: id, out: dest, written, rollback: `node .cursor/tools/repair.mjs rollback --out ${dest}` };
}

function rollback(outDir) {
  if (!outDir) return { ok: false, error: "--out is required" };
  const dest = resolve(outDir);
  const bak = join(dest, BACKUP);
  const lastPath = join(dest, ".repair-last.json");
  if (!existsSync(lastPath)) return { ok: false, error: "no .repair-last.json" };
  const last = JSON.parse(readFileSync(lastPath, "utf8"));
  for (const rel of last.written || []) {
    const backup = join(bak, rel);
    const abs = join(dest, rel);
    if (existsSync(backup)) cpSync(backup, abs);
    else if (existsSync(abs)) rmSync(abs);
  }
  return { ok: true, restored: last.written || [] };
}

const invoked = (() => {
  try { return fileURLToPath(import.meta.url) === process.argv[1]; }
  catch { return false; }
})();
if (invoked) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const json = args.includes("--json");
  const outIdx = args.indexOf("--out");
  const outDir = outIdx >= 0 ? args[outIdx + 1] : null;
  const id = args.find((a, i) => i > 0 && !a.startsWith("--") && a !== outDir);
  const print = (obj, code = obj.ok === false ? 1 : 0) => {
    if (json) process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
    else process.stdout.write((obj.error || JSON.stringify(obj, null, 2)) + "\n");
    process.exit(code);
  };
  if (cmd === "list") {
    print({ ok: true, recipes: RECIPES }, 0);
  } else if (cmd === "preview") {
    if (!id) die("Usage: repair.mjs preview <recipe-id>");
    const p = previewRecipe(id, ROOT);
    print(p, p.ok ? 0 : 1);
  } else if (cmd === "apply") {
    if (!id) die("Usage: repair.mjs apply <recipe-id> --out <dir>");
    const r = applyRecipe(id, outDir, ROOT);
    print(r, r.ok ? 0 : 1);
  } else if (cmd === "rollback") {
    const r = rollback(outDir);
    print(r, r.ok ? 0 : 1);
  } else {
    die("Usage: node .cursor/tools/repair.mjs list|preview|apply|rollback [--out <dir>] [--json]");
  }
}
