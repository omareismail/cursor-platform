#!/usr/bin/env node
/**
 * ac-trace.test.mjs — AC identifiers, skipped suites, and "alone" assertions.
 *
 * Criteria keyed globally by AC-N collapsed two features into one; a
 * describe.skip around a claiming test was invisible; toBeDefined next to a
 * real assertion was treated as weak. Each case is the reproduction from the
 * 2026-09-09 review.
 */

import { fixture, runTool, put, gitInit, DOC, check, report, section } from "../_harness.mjs";

section("ac-trace — AC-N is scoped to its feature");
{
  const root = fixture("ac-scope");
  put(root, "specs/features/login.md", DOC("Login") + "\n- **AC-1** Given valid credentials, when submitted, then a session exists.\n");
  put(root, "specs/features/refund.md", DOC("Refund") + "\n- **AC-1** Given a settled payment, when refunded, then the money is returned.\n");
  put(root, "tests/login.test.mjs", `it("logs in", () => {\n  // AC-1: session\n  expect(login()).toBe("ok");\n});\n`);
  gitInit(root);
  let r = runTool("ac-trace.mjs", ["check", "--json"], root);
  const all = JSON.parse(r.out);
  check("two specs with AC-1 are two criteria, not one", all.data.acs === 2, JSON.stringify({ acs: all.data.acs, findings: all.findings }));
  check("login AC-1 is covered by tests/login.test.mjs", all.data.covered >= 1 && !all.findings.some((f) => f.code === "uncovered" && f.file === "specs/features/login.md"), JSON.stringify(all.findings));
  check("refund AC-1 is uncovered (the login test does not cover it)", all.findings.some((f) => f.code === "uncovered" && f.file === "specs/features/refund.md"), JSON.stringify(all.findings));
  r = runTool("ac-trace.mjs", ["check", "specs/features/refund.md", "--json"], root);
  const scoped = JSON.parse(r.out);
  check("checking refund alone does not borrow the login test", scoped.findings.some((f) => f.code === "uncovered") && scoped.ok === false, JSON.stringify(scoped.findings));
}

section("ac-trace — a skipped suite skips the tests inside it");
{
  const root = fixture("ac-skip");
  put(root, "specs/features/pay.md", DOC("Pay") + "\n- **AC-1** Given a quote, when paid, then a receipt exists.\n");
  put(root, "tests/pay.test.mjs", `describe.skip("offline", () => {\n  it("pays", () => {\n    // AC-1: receipt\n    expect(pay()).toBe(20);\n  });\n});\n`);
  gitInit(root);
  const r = runTool("ac-trace.mjs", ["check", "--json"], root);
  const rep = JSON.parse(r.out);
  check("the only claim inside describe.skip is skipped-only, not covered", rep.findings.some((f) => f.code === "skipped-only" && f.ref === "AC-1"), JSON.stringify(rep.findings));
}

section("ac-trace — a brace inside a string does not end a skipped suite");
{
  const root = fixture("ac-skip-brace");
  put(root, "specs/features/pay.md", DOC("Pay") + "\n- **AC-1** Given a quote, when paid, then a receipt exists.\n");
  put(root, "tests/pay.test.mjs", `describe.skip("offline", () => {\n  const closing = "}";\n  it("pays", () => {\n    // AC-1: receipt\n    expect(pay()).toBe(20);\n  });\n});\n`);
  gitInit(root);
  const r = runTool("ac-trace.mjs", ["check", "--json"], root);
  const rep = JSON.parse(r.out);
  check("const closing = \"}\" does not make the inner test look live", r.exit === 1 && rep.findings.some((f) => f.code === "skipped-only" && f.ref === "AC-1"), JSON.stringify(rep.findings));
}

section("ac-trace — PayTests.cs covers pay.md in scoped and global checks");
{
  const root = fixture("ac-csharp");
  put(root, "specs/features/pay.md", DOC("Pay") + "\n- **AC-1** Given a quote, when paid, then a receipt exists.\n");
  put(root, "tests/PayTests.cs", `[Fact]\npublic void Pays() {\n  // AC-1: receipt\n  Assert.Equal(20, Pay());\n}\n`);
  gitInit(root);
  let r = runTool("ac-trace.mjs", ["check", "--json"], root);
  const all = JSON.parse(r.out);
  check("global check covers PayTests.cs against pay.md", r.exit === 0 && all.data.covered === 1 && !all.findings.some((f) => f.code === "uncovered"), JSON.stringify(all.findings));
  r = runTool("ac-trace.mjs", ["check", "specs/features/pay.md", "--json"], root);
  const scoped = JSON.parse(r.out);
  check("scoped check agrees — it does not leave AC-1 uncovered", r.exit === 0 && scoped.data.covered === 1 && !scoped.findings.some((f) => f.code === "uncovered"), JSON.stringify(scoped.findings));
}

section("ac-trace — toBeDefined plus a real assertion is not weak");
{
  const root = fixture("ac-strong");
  put(root, "specs/features/pay.md", DOC("Pay") + "\n- **AC-1** Given a quote, when paid, then the amount is 20.\n");
  put(root, "tests/pay.test.mjs", `it("pays", () => {\n  // AC-1: amount\n  const result = pay();\n  expect(result).toBeDefined();\n  expect(result.amount).toBe(20);\n});\n`);
  gitInit(root);
  const r = runTool("ac-trace.mjs", ["check", "--json"], root);
  const rep = JSON.parse(r.out);
  check("toBeDefined then toBe(20) is covered, not weak", r.exit === 0 && !rep.findings.some((f) => f.code === "weak-assertion" || f.code === "vacuous-only"), JSON.stringify(rep.findings));
}

report("AC claims are bound to a feature, skipped suites skip even when a string contains a brace, and a guard assertion next to a real one is not weak.");
