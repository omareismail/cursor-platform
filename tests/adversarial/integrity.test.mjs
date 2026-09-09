#!/usr/bin/env node
/**
 * integrity.test.mjs — is the enforcement surface what somebody attested to?
 *
 * Every guard here is a file, and a file can change. Until lifecycle/integrity.json
 * nothing recorded what the hooks, their wiring, the policies and the gate
 * definitions were supposed to hash to, so a hook edited to `ok()` on line one
 * passed every audit that only asked whether it was wired. The manifest is a
 * human's signature over that surface; `--check` is what CI compares against.
 *
 * Also here: feature-map.mjs `list` on a stale trace, which used to crash on a
 * field assess() never set - so the one command that reports staleness died
 * exactly when there was staleness to report.
 */

import { join } from "node:path";
import { readFileSync, writeFileSync, appendFileSync, unlinkSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fixture, runHook, runTool, bash, put, gitInit, check, denies, report, section, REPO } from "../_harness.mjs";

const integrity = (root, ...args) => runTool("self-audit.mjs", ["integrity", ...args], root);

section("self-audit.mjs integrity — no manifest is a finding, not a pass");
{
  const root = fixture("ig-none");
  put(root, ".cursor/hooks.json", JSON.stringify({ version: 1, hooks: {} }));
  put(root, ".claude/settings.json", JSON.stringify({ hooks: {} }));
  const r = integrity(root);
  check("--check with no manifest exits 1", r.exit === 1, `${r.exit} ${r.out.slice(0, 200)}`);
  check("...and says what to do, naming the human", /does not exist/.test(r.out) && /integrity --write --by/.test(r.out), r.out.slice(0, 400));
  const j = integrity(root, "--json");
  const jr = JSON.parse(j.out);
  check("--json says missing (finding-report envelope: one block finding, the old shape under data)", jr.schema === "finding-report/1" && jr.ok === false && jr.data.missing === true && jr.findings[0].code === "manifest-missing" && jr.findings[0].severity === "block", j.out);
  put(root, "lifecycle/integrity.json", "{ not a manifest");
  const c = integrity(root);
  check("an unreadable manifest is also a FAIL, differently worded", c.exit === 1 && /not a readable manifest/.test(c.out), c.out.slice(0, 300));
}

section("self-audit.mjs integrity --write — an attestation has a name");
{
  const root = fixture("ig-write");
  put(root, ".cursor/hooks.json", JSON.stringify({ version: 1, hooks: {} }));
  put(root, ".claude/settings.json", JSON.stringify({ hooks: {} }));
  put(root, ".cursor/lifecycle/gates/03-design.md", "# Gate 3\n\nreviewer: security-auditor\n");
  let r = integrity(root, "--write");
  check("--write without --by is refused (exit 2)", r.exit === 2 && /needs --by/.test(r.out), `${r.exit} ${r.out.slice(0, 200)}`);
  r = integrity(root, "--write", "--by", "sara");
  check("--write --by writes the manifest", r.exit === 0, r.out + r.err);
  const m = JSON.parse(readFileSync(join(root, "lifecycle", "integrity.json"), "utf8"));
  const covered = Object.keys(m.files);
  check("it names the signer and the environment", m.by === "sara" && m.recordedBy && "git" in m.recordedBy, JSON.stringify({ by: m.by, recordedBy: m.recordedBy }));
  check("it covers the hooks", covered.includes(".claude/hooks/guard-phase.mjs") && covered.includes(".claude/hooks/guard-write.mjs") && covered.includes(".claude/hooks/guard-bash.mjs") && covered.includes(".claude/hooks/guard-mcp.mjs") && covered.includes(".claude/hooks/_lib.mjs"), covered.join());
  check("...the wiring and the policies", covered.includes(".cursor/hooks.json") && covered.includes(".claude/settings.json") && covered.includes(".cursor/mcp-policy.json") && covered.includes(".cursor/lifecycle/write-policy.json"), covered.join());
  check("...the gate definitions and the state machine", covered.includes(".cursor/lifecycle/gates/03-design.md") && covered.includes(".cursor/tools/lifecycle.mjs") && covered.includes(".cursor/tools/_state.mjs"), covered.join());
  check("every entry is a sha256", covered.every((f) => /^[0-9a-f]{64}$/.test(m.files[f])), JSON.stringify(m.files).slice(0, 200));
  const c = integrity(root);
  check("--check right after --write passes", c.exit === 0 && /PASS|attested|match/i.test(c.out), `${c.exit} ${c.out.slice(0, 300)}`);
}

section("self-audit.mjs integrity — a changed guard is CHANGED, a new one UNATTESTED, a removed one MISSING");
{
  const root = fixture("ig-tamper");
  put(root, ".cursor/hooks.json", JSON.stringify({ version: 1, hooks: {} }));
  put(root, ".claude/settings.json", JSON.stringify({ hooks: {} }));
  check("fixture attested", integrity(root, "--write", "--by", "sara").exit === 0, "");

  // The attack this exists for: the guard still exists, is still wired, and allows everything.
  appendFileSync(join(root, ".claude", "hooks", "guard-phase.mjs"), "\n// ok();\n");
  let r = integrity(root);
  check("one appended comment line in a hook: FAIL, CHANGED, by name", r.exit === 1 && /CHANGED\s+\.claude\/hooks\/guard-phase\.mjs/.test(r.out), `${r.exit} ${r.out.slice(0, 400)}`);
  check("...and the fix is a human re-attesting, or a finding", /re-attests/.test(r.out) && /this is the finding/.test(r.out), r.out.slice(0, 500));
  const j = JSON.parse(integrity(root, "--json").out);
  check("--json carries the same verdict, as a finding and under data", j.ok === false && j.data.changed.includes(".claude/hooks/guard-phase.mjs") && j.findings.some((f) => f.code === "changed" && f.file === ".claude/hooks/guard-phase.mjs" && f.severity === "block"), JSON.stringify(j).slice(0, 300));

  // A policy edit is the same finding on a different file.
  const pol = join(root, ".cursor", "mcp-policy.json");
  writeFileSync(pol, readFileSync(pol, "utf8").replace(/\}\s*$/, " }\n"));
  r = integrity(root);
  check("a whitespace-only change to mcp-policy.json is still CHANGED (bytes, not meaning)", /CHANGED\s+\.cursor\/mcp-policy\.json/.test(r.out), r.out.slice(0, 400));

  // A hook that nobody signed for, sitting next to the signed ones.
  put(root, ".claude/hooks/helpful-extra.mjs", "process.exit(0);\n");
  r = integrity(root);
  check("a new file under a covered path is UNATTESTED", /UNATTESTED\s+\.claude\/hooks\/helpful-extra\.mjs/.test(r.out), r.out.slice(0, 500));

  // A guard that was deleted.
  unlinkSync(join(root, ".claude", "hooks", "guard-mcp.mjs"));
  r = integrity(root);
  check("a deleted guard is MISSING", /MISSING\s+\.claude\/hooks\/guard-mcp\.mjs/.test(r.out), r.out.slice(0, 500));

  // Re-attesting says what it is signing over.
  r = integrity(root, "--write", "--by", "omar");
  check("re-attesting reports what changed since the last signature", r.exit === 0 && /changed/i.test(r.out) && /guard-phase\.mjs/.test(r.out) && /helpful-extra\.mjs/.test(r.out) && /guard-mcp\.mjs/.test(r.out), r.out.slice(0, 600));
  check("...and the check is green again", integrity(root).exit === 0, "");
}

section("guard-bash.mjs — the agent cannot attest for the human");
{
  const root = fixture("ig-bash");
  const HUMAN = "is a human's command";
  denies("`self-audit.mjs integrity --write` from the agent shell is refused", runHook("guard-bash.mjs", bash('node .cursor/tools/self-audit.mjs integrity --write --by "sara"'), root), HUMAN);
  denies("...with the flags in another order too", runHook("guard-bash.mjs", bash('node .cursor/tools/self-audit.mjs integrity --by "sara" --write'), root), HUMAN);
  denies("...and through a shell prefix", runHook("guard-bash.mjs", bash('cd d:/x && node .cursor/tools/self-audit.mjs integrity --write --by sara'), root), HUMAN);
  denies("...even with CURSOR_PLATFORM_DEV set: this is not a dev escape", runHook("guard-bash.mjs", bash('node .cursor/tools/self-audit.mjs integrity --write --by "sara"'), root, { CURSOR_PLATFORM_DEV: "1" }), HUMAN);
  const ok = runHook("guard-bash.mjs", bash("node .cursor/tools/self-audit.mjs integrity"), root);
  check("`integrity` (check) is allowed - CI runs it, so may the agent", ok.exit === 0, `${ok.exit} ${ok.out} ${ok.err}`);
  const ok2 = runHook("guard-bash.mjs", bash("node .cursor/tools/self-audit.mjs integrity --check --json"), root);
  check("`integrity --check --json` is allowed", ok2.exit === 0, `${ok2.exit} ${ok2.err}`);
}

section("feature-map.mjs — a stale trace is reported, not a crash");
{
  const root = fixture("fm-stale");
  put(root, "src/Payments/Handler.cs", "public class Handler { }\n");
  put(root, "src/Payments/Repo.cs", "public class Repo { }\n");
  gitInit(root);
  let r = runTool("feature-map.mjs", ["init"], root);
  check("init", r.exit === 0, r.err + r.out);
  put(root, "trace.json", JSON.stringify({ id: "payments", name: "Payments", files: [{ path: "src/Payments/Handler.cs", role: "handler" }, { path: "src/Payments/Repo.cs", role: "repository" }] }));
  r = runTool("feature-map.mjs", ["upsert", "trace.json"], root);
  check("upsert a two-file trace", r.exit === 0, r.err + r.out);
  r = runTool("feature-map.mjs", ["list"], root);
  check("fresh: list exits 0", r.exit === 0 && /fresh/.test(r.out), `${r.exit} ${r.out}`);

  writeFileSync(join(root, "src", "Payments", "Handler.cs"), "public class Handler { int x; }\n");
  unlinkSync(join(root, "src", "Payments", "Repo.cs"));
  r = runTool("feature-map.mjs", ["list"], root);
  check("one file changed, one gone: list exits 1 and does not throw", r.exit === 1 && !/TypeError|Cannot read properties/.test(r.err), `${r.exit} ${r.err.slice(0, 300)}`);
  check("...and names both reasons", /STALE/.test(r.out) && /1 changed/.test(r.out) && /1 missing/.test(r.out), r.out);
  r = runTool("feature-map.mjs", ["verify"], root);
  check("verify agrees", r.exit === 1 && /Handler\.cs/.test(r.out) && /Repo\.cs/.test(r.out), `${r.exit} ${r.out.slice(0, 400)}`);
  r = runTool("feature-map.mjs", ["stale", "--json"], root);
  check("stale --json lists it", r.exit === 1 && JSON.parse(r.out).some((x) => x.id === "payments"), r.out.slice(0, 300));
}

section("self-audit.mjs integrity — empty coverage is a FAIL, not a pass");
{
  const root = fixture("ig-empty", { withTools: false, writePolicy: false, mcpPolicy: null });
  // fixture() always copies .claude/hooks; a plugin-only empty install has neither.
  rmSync(join(root, ".claude"), { recursive: true, force: true });
  rmSync(join(root, ".cursor"), { recursive: true, force: true });
  put(root, "lifecycle/integrity.json", JSON.stringify({ version: 1, writtenAt: "2026-01-01T00:00:00Z", by: "x", files: {} }));
  const plug = join(root, "plugin-install", "tools");
  mkdirSync(plug, { recursive: true });
  for (const t of ["self-audit.mjs", "_findings.mjs", "_state.mjs"]) {
    cpSync(join(REPO, ".cursor", "tools", t), join(plug, t));
  }
  const r = spawnSync(process.execPath, [join(plug, "self-audit.mjs"), "integrity"], {
    cwd: root, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: root }, timeout: 20_000,
  });
  check("0 enforcement files is FAIL, not OK: 0 file(s) match", r.status === 1 && /incomplete coverage/.test(r.stdout || ""), (r.stdout || "") + (r.stderr || "").slice(0, 400));
}

section("self-audit.mjs integrity — plugin install files are attested from the plugin directory");
{
  const root = fixture("ig-plugin", { withTools: false, writePolicy: false, mcpPolicy: null });
  const plug = join(root, "plugin-install");
  mkdirSync(join(plug, "hooks"), { recursive: true });
  mkdirSync(join(plug, "tools"), { recursive: true });
  for (const h of ["guard-write.mjs", "guard-phase.mjs", "guard-bash.mjs", "guard-mcp.mjs", "_lib.mjs", "_sql.mjs"]) {
    cpSync(join(REPO, ".claude", "hooks", h), join(plug, "hooks", h));
  }
  for (const t of ["self-audit.mjs", "_findings.mjs", "_state.mjs", "lifecycle.mjs", "_evidence.mjs"]) {
    cpSync(join(REPO, ".cursor", "tools", t), join(plug, "tools", t));
  }
  const r = spawnSync(process.execPath, [join(plug, "tools", "self-audit.mjs"), "integrity", "--write", "--by", "sara"], {
    cwd: root, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: root }, timeout: 20_000,
  });
  check("plugin --write attests hooks from the install directory", r.status === 0 && /Integrity manifest written/.test(r.stdout || ""), (r.stdout || "") + (r.stderr || ""));
  const m = JSON.parse(readFileSync(join(root, "lifecycle", "integrity.json"), "utf8"));
  check("manifest names plugin-relative hooks/, not an empty project", Object.keys(m.files).some((f) => f.startsWith("hooks/guard-write")), Object.keys(m.files).join());
  const c = spawnSync(process.execPath, [join(plug, "tools", "self-audit.mjs"), "integrity"], {
    cwd: root, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: root }, timeout: 20_000,
  });
  check("plugin --check passes against those hashes", c.status === 0, (c.stdout || "") + (c.stderr || ""));
}

report("The guards are a set of files a human signed for, and the one command that reports drift no longer dies on it.");
