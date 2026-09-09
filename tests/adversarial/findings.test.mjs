#!/usr/bin/env node
/**
 * findings.test.mjs — every checker speaks one shape.
 *
 * schemas/finding.schema.json is the contract; _findings.mjs validates it
 * without a dependency. Each tool is run for real, first against this
 * repository (whatever it currently says, the envelope must hold) and then
 * against a fixture built to make it fail, so the `block` findings are seen
 * carrying a file, a line and a stable code rather than only a sentence.
 */

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fixture, runTool, put, gitInit, DOC, check, report, section, REPO } from "../_harness.mjs";

const fm = await import(new URL(`file:///${join(REPO, ".cursor", "tools", "_findings.mjs").replace(/\\/g, "/")}`));
const dash = await import(new URL(`file:///${join(REPO, ".cursor", "tools", "dashboard.mjs").replace(/\\/g, "/")}`));

const parse = (r) => { try { return JSON.parse(r.out); } catch { return null; } };

section("the schema file and the validator agree on the basics");
{
  const schema = JSON.parse(readFileSync(join(REPO, "schemas", "finding.schema.json"), "utf8"));
  check("schema requires what the validator requires", JSON.stringify([...schema.required].sort()) === JSON.stringify(["at", "command", "exit", "findings", "ok", "schema", "summary", "tool"]), JSON.stringify(schema.required));
  check("severity enum matches", JSON.stringify(schema.$defs.finding.properties.severity.enum) === JSON.stringify(fm.SEVERITIES), "");
  check("schema constant matches", schema.properties.schema.const === fm.SCHEMA, schema.properties.schema.const);
  const good = fm.report({ tool: "x.mjs", command: "check", findings: [fm.block("a-b", "m", { file: "f.cs", line: 3 }), fm.warn("c", "m"), fm.info("d", "m", { ref: "AC-1" })] });
  check("a well-formed report validates", fm.validate(good).length === 0 && good.ok === false && good.exit === 1 && good.counts.block === 1, JSON.stringify(fm.validate(good)));
  check("ok:true with a block finding is caught", fm.validate({ ...good, ok: true }).some((e) => /ok is true/.test(e)), "");
  check("a bad severity is caught", fm.validate({ ...good, findings: [{ severity: "fatal", code: "x", message: "m" }], counts: { block: 0, warn: 0, info: 0 } }).some((e) => /severity/.test(e)), "");
  check("a non-kebab code is caught", fm.validate({ ...good, findings: [{ severity: "info", code: "Bad Code", message: "m" }], counts: { block: 0, warn: 0, info: 1 } }).some((e) => /kebab/.test(e)), "");
  check("counts that disagree with findings are caught", fm.validate({ ...good, counts: { block: 0, warn: 1, info: 1 } }).some((e) => /counts\.block/.test(e)), "");
  check("an unknown top-level key is caught", fm.validate({ ...good, extra: 1 }).some((e) => /unexpected top-level/.test(e)), "");
  check("skipped reports exit 2 by default and are ok", (() => { const s = fm.report({ tool: "x.mjs", command: "check", skipped: true, summary: "nothing" }); return s.skipped && s.ok && s.exit === 2 && fm.validate(s).length === 0; })(), "");
  check("undefined file/line/ref are omitted, not written as null", !("file" in fm.block("a", "m", { file: undefined, line: undefined })), "");
}

section("every finding tool, run against this repository, emits a valid envelope");
{
  for (const [tool, args] of dash.FINDING_TOOLS) {
    const r = spawnSync(process.execPath, [join(REPO, ".cursor", "tools", tool), ...args], { cwd: REPO, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: REPO }, timeout: 60_000 });
    const rep = parse({ out: r.stdout });
    const errs = rep ? fm.validate(rep) : [`no JSON: ${(r.stdout + r.stderr).slice(0, 200)}`];
    check(`${tool} ${args[0]}: valid finding report`, errs.length === 0, errs.join("; "));
    if (!rep) continue;
    check(`${tool}: tool and command are its own`, rep.tool === tool && rep.command === args[0], `${rep.tool} ${rep.command}`);
    check(`${tool}: exit in the envelope is the exit the process returned`, rep.exit === r.status, `${rep.exit} vs ${r.status}`);
    check(`${tool}: ok is false exactly when a finding blocks`, rep.ok === !rep.findings.some((f) => f.severity === "block"), "");
    check(`${tool}: a summary sentence`, typeof rep.summary === "string" && rep.summary.length > 3, rep.summary);
  }
}

section("flag-debt.mjs — an expired flag is a block finding with a file and a line");
{
  const root = fixture("f-flag");
  put(root, "src/Checkout.cs", "// FLAG: old_checkout owner=@omar expires=2020-01-01\npublic class Checkout { void X() { if (Flags.IsEnabled(\"old_checkout\")) {} if (Flags.IsEnabled(\"mystery\")) {} } }\n");
  gitInit(root);
  let r = runTool("flag-debt.mjs", ["scan", "--json"], root);
  let rep = parse(r);
  check("valid", rep && fm.validate(rep).length === 0, rep ? fm.validate(rep).join("; ") : r.out + r.err);
  const exp = rep.findings.find((f) => f.code === "expired-flag");
  check("expired-flag: block, ref, file:line", exp && exp.severity === "block" && exp.ref === "old_checkout" && exp.file === "src/Checkout.cs" && exp.line === 1, JSON.stringify(exp));
  const und = rep.findings.find((f) => f.code === "undeclared-flag");
  check("undeclared-flag is a warn without --strict", und && und.severity === "warn" && und.ref === "mystery" && und.file === "src/Checkout.cs" && und.line === 2, JSON.stringify(und));
  check("exit 1, ok false, counts add up", r.exit === 1 && rep.ok === false && rep.counts.block === 1 && rep.counts.warn === 1, JSON.stringify(rep.counts));
  check("the tool's own shape is intact under data", rep.data.expired.length === 1 && rep.data.undeclared.length === 1 && rep.data.scanned >= 1, JSON.stringify(Object.keys(rep.data)));
  r = runTool("flag-debt.mjs", ["scan", "--json", "--strict"], root);
  rep = parse(r);
  check("--strict promotes undeclared to block at the source", rep.findings.find((f) => f.code === "undeclared-flag").severity === "block" && rep.counts.block === 2, JSON.stringify(rep.counts));
}

section("ac-trace.mjs and risk-profile.mjs — an uncovered criterion");
{
  const root = fixture("f-ac");
  put(root, "specs/features/pay.md", DOC("Pay") + "\n- **AC-1** Given a quote, when paid, then a receipt exists.\n- **AC-2** Given a failed card, when paid, then the payment is refused and nothing is charged.\n");
  put(root, "tests/PayTests.cs", "public class PayTests {\n  // AC-1: receipt\n  [Fact] public void Receipt() { var r = Pay(); }\n}\n");
  gitInit(root);
  let r = runTool("ac-trace.mjs", ["check", "--json"], root);
  let rep = parse(r);
  check("ac-trace: valid", rep && fm.validate(rep).length === 0, rep ? fm.validate(rep).join("; ") : r.out + r.err);
  const unc = rep.findings.find((f) => f.code === "uncovered");
  check("uncovered: block, ref AC-2, spec file and line", unc && unc.severity === "block" && unc.ref === "AC-2" && unc.file === "specs/features/pay.md" && unc.line >= 1, JSON.stringify(unc));
  const vac = rep.findings.find((f) => f.code === "vacuous-test");
  check("the test with no assertion is a warn against the test file; AC-1 is vacuous-only (block)", vac && vac.file === "tests/PayTests.cs" && vac.severity === "warn" && rep.findings.some((f) => f.code === "vacuous-only" && f.ref === "AC-1"), JSON.stringify(rep.findings));
  check("exit 1 and data keeps the old fields", r.exit === 1 && rep.data.acs === 2 && Array.isArray(rep.data.uncovered), JSON.stringify(Object.keys(rep.data)));
  r = runTool("risk-profile.mjs", ["check", "--json"], root);
  rep = parse(r);
  check("risk-profile: valid", rep && fm.validate(rep).length === 0, rep ? fm.validate(rep).join("; ") : r.out + r.err);
  check("risk-profile: the money criterion is tiered and under-evidenced", rep.findings.some((f) => /^t[23]-under-evidenced$/.test(f.code) && f.ref === "AC-2" && f.severity === "block"), JSON.stringify(rep.findings));
}

section("incidents.mjs — a guard that is gone");
{
  const root = fixture("f-inc");
  put(root, "src/Guard.cs", "class Guard {}\n");
  let r = runTool("incidents.mjs", ["open", "--title", "double charge", "--detected", "reconciliation", "--guard", "src/Guard.cs#Guard", "--by", "omar"], root);
  check("fixture: incident opened", r.exit === 0, r.err);
  put(root, "src/Guard.cs", "class Other {}\n");
  r = runTool("incidents.mjs", ["check", "--json"], root);
  const rep = parse(r);
  check("valid", rep && fm.validate(rep).length === 0, rep ? fm.validate(rep).join("; ") : r.out + r.err);
  const g = rep.findings.find((f) => f.severity === "block");
  check("the missing guard is a block finding referencing the incident and the file", g && /^guard-/.test(g.code) && g.ref === "INC-0001" && g.file === "src/Guard.cs", JSON.stringify(rep.findings));
  check("exit 1; data is the rows the old --json returned", r.exit === 1 && Array.isArray(rep.data) && rep.data[0].id === "INC-0001", "");
}

section("incidents.mjs — a weak (rung-7) guard fails JSON the same way as text");
{
  const root = fixture("f-inc-weak");
  put(root, "memory-bank/commonMistakes.md", DOC("Do not swallow payment errors") + "\n");
  let r = runTool("incidents.mjs", ["open", "--title", "prose only", "--detected", "reconciliation", "--guard", "memory-bank/commonMistakes.md#swallow", "--by", "omar"], root);
  check("fixture: weak incident opened", r.exit === 0, r.err);
  const text = runTool("incidents.mjs", ["check"], root);
  check("text check FAILS on a rung-7 guard with no --unmechanisable", text.exit === 1 && /FAILED/.test(text.out), `${text.exit} ${text.out.slice(0, 400)}`);
  r = runTool("incidents.mjs", ["check", "--json"], root);
  const rep = parse(r);
  check("JSON also exits 1", r.exit === 1 && rep.ok === false, `${r.exit} ${JSON.stringify(rep && { ok: rep.ok, counts: rep.counts })}`);
  check("guard-weak is a block finding, not a warn", rep.findings.some((f) => f.code === "guard-weak" && f.severity === "block"), JSON.stringify(rep.findings));
}

section("artifact-schema.mjs — a dangling id");
{
  const root = fixture("f-ids", { gates: true });
  put(root, "docs/product/prd.md", DOC("PRD") + "\n### FR-1 — Issue a policy\n\nSee S-9.\n");
  const r = runTool("artifact-schema.mjs", ["check", "--json"], root);
  const rep = parse(r);
  check("valid", rep && fm.validate(rep).length === 0, rep ? fm.validate(rep).join("; ") : r.out + r.err);
  check("dangling-id S-9 is a block finding in the citing file", rep.findings.some((f) => f.code === "dangling-id" && f.ref === "S-9" && f.file === "docs/product/prd.md" && f.severity === "block"), JSON.stringify(rep.findings));
  check("check --json now exits 1 on findings (it used to exit 0 whatever it found)", r.exit === 1, String(r.exit));
  check("data keeps the four lists", ["dangling", "misplaced", "unlinked", "duplicate"].every((k) => Array.isArray(rep.data[k])), JSON.stringify(Object.keys(rep.data)));
}

section("fitness.mjs — an un-promoted architecture is skipped, not failed");
{
  const root = fixture("f-fit");
  put(root, "memory-bank/architecture.md", "# Architecture\n\n_[Describe the layering here]_\n");
  const r = runTool("fitness.mjs", ["check", "--json"], root);
  const rep = parse(r);
  check("valid, skipped, ok, exit 2", rep && fm.validate(rep).length === 0 && rep.skipped === true && rep.ok === true && r.exit === 2 && rep.data === null, rep ? JSON.stringify({ s: rep.skipped, ok: rep.ok, e: r.exit, v: fm.validate(rep) }) : r.out + r.err);
  const t = runTool("fitness.mjs", ["check"], root);
  check("text mode exits 2 too, and says why", t.exit === 2 && /No promoted architecture/.test(t.out), `${t.exit} ${t.out.slice(0, 200)}`);
}

section("dashboard — reads the envelope, keeps the old shape for its panels, aggregates the findings");
{
  const skipped = dash.parseToolOut(JSON.stringify(fm.report({ tool: "fitness.mjs", command: "check", skipped: true, summary: "no promoted architecture", data: null })), 2);
  check("a skipped report becomes the empty box, with the summary as its hint", skipped.ok === false && skipped.empty === true && /no promoted architecture/.test(skipped.hint) && skipped.report, JSON.stringify(skipped));
  const full = dash.parseToolOut(JSON.stringify(fm.report({ tool: "flag-debt.mjs", command: "scan", findings: [fm.block("expired-flag", "m")], data: { expired: [{ name: "x" }], declared: 1 } })), 1);
  check("a full report: data is the tool's old shape, report rides alongside", full.ok && full.data.expired.length === 1 && full.report.findings.length === 1, JSON.stringify(full));
  const legacy = dash.parseToolOut(JSON.stringify({ total: 3, new: [] }), 0);
  check("a tool that does not emit the envelope still parses as before", legacy.ok && legacy.data.total === 3 && !legacy.report, JSON.stringify(legacy));

  process.env.CLAUDE_PROJECT_DIR = REPO;
  const agg = dash.collectFindings();
  check("collectFindings ran every finding tool", agg.reports.length === dash.FINDING_TOOLS.length && agg.reports.every((r) => r.ran), JSON.stringify(agg.reports.map((r) => [r.tool, r.ran, r.hint])));
  check("...and produced one flat list, sorted block first, each finding naming its tool", Array.isArray(agg.findings) && agg.findings.every((f) => f.tool && f.severity) && agg.findings.every((f, i, a) => i === 0 || ["block", "warn", "info"].indexOf(a[i - 1].severity) <= ["block", "warn", "info"].indexOf(f.severity)), "");
  check("...with counts that add up", agg.counts.block + agg.counts.warn + agg.counts.info === agg.findings.length && agg.ok === (agg.counts.block === 0), JSON.stringify(agg.counts));
}

report("Nine tools, one shape - and a tenth joins by emitting it.");
