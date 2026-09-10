#!/usr/bin/env node
/**
 * stack-profile.mjs — detect the adopter stack and preview a profile.
 *
 * First useful release of idea 13: detect and preview, never install
 * dependencies or rewrite rules.
 *
 * Usage:
 *   node .cursor/tools/stack-profile.mjs detect [--json]
 *   node .cursor/tools/stack-profile.mjs preview [--json]
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.CLAUDE_PROJECT_DIR || repoRoot() || process.cwd();

function repoRoot() {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

function hasExt(dir, ext, depth = 0) {
  if (depth > 3 || !existsSync(dir)) return false;
  let names;
  try { names = readdirSync(dir); } catch { return false; }
  for (const n of names) {
    if (n.startsWith(".") || n === "node_modules" || n === "bin" || n === "obj") continue;
    const p = join(dir, n);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isFile() && n.toLowerCase().endsWith(ext)) return true;
    if (st.isDirectory() && hasExt(p, ext, depth + 1)) return true;
  }
  return false;
}

export function detect(root = ROOT) {
  const csproj = hasExt(root, ".csproj") || existsSync(join(root, "src")) && hasExt(join(root, "src"), ".cs");
  let react = false;
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    react = !!(pkg.dependencies?.react || pkg.devDependencies?.react);
  } catch { /* no package.json */ }
  if (!react && (existsSync(join(root, "frontend")) || existsSync(join(root, "web")))) {
    react = hasExt(join(root, "frontend"), ".tsx") || hasExt(join(root, "web"), ".tsx");
  }
  const monorepo = existsSync(join(root, "packages"));
  let id = "unknown";
  if (csproj && react) id = "fullstack";
  else if (csproj) id = "dotnet-api";
  else if (react) id = "react-frontend";
  else if (monorepo) id = "packages-monorepo";
  return { id, dotnet: csproj, react, monorepo, root };
}

const PROFILES = {
  "dotnet-api": {
    rules: ["02-dotnet-architecture-guard", "06-database-provider-guard", "07-audit-trail-guard"],
    sourceRoots: ["src", "backend", "api"],
    skip: ["08-rtl-i18n-guard as a required frontend gate"],
  },
  "react-frontend": {
    rules: ["03-react-architecture-guard", "08-rtl-i18n-guard"],
    sourceRoots: ["frontend", "web", "app", "client"],
    skip: ["unexplained .NET backend requirements"],
  },
  fullstack: {
    rules: ["02-dotnet-architecture-guard", "03-react-architecture-guard", "08-rtl-i18n-guard"],
    sourceRoots: ["src", "backend", "frontend", "client"],
    skip: [],
  },
  "packages-monorepo": {
    rules: ["02-dotnet-architecture-guard", "03-react-architecture-guard"],
    sourceRoots: ["packages", "src"],
    skip: [],
  },
  unknown: {
    rules: [],
    sourceRoots: [],
    skip: ["do not invent a stack"],
  },
};

export function preview(root = ROOT) {
  const d = detect(root);
  const profile = PROFILES[d.id] || PROFILES.unknown;
  return { ...d, profile, installed: false };
}

const invoked = (() => {
  try { return fileURLToPath(import.meta.url) === process.argv[1]; }
  catch { return false; }
})();
if (invoked) {
  const cmd = process.argv[2] || "detect";
  const json = process.argv.includes("--json");
  const body = cmd === "preview" ? preview(ROOT) : detect(ROOT);
  if (cmd !== "detect" && cmd !== "preview") {
    process.stderr.write("Usage: node .cursor/tools/stack-profile.mjs detect|preview [--json]\n");
    process.exit(2);
  }
  process.stdout.write(json ? JSON.stringify(body, null, 2) + "\n" : `${body.id}\n`);
}
