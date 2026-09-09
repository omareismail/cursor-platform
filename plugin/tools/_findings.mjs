/**
 * _findings.mjs - one shape for every checker's --json.
 *
 * The schema is schemas/finding.schema.json; this is the writer and the
 * validator for it, with no dependency, because a checker that needs a package
 * installed before it can say "clean" is a checker that is sometimes not run.
 *
 *   report({ tool, command, ok, exit, summary, findings, data, skipped })
 *   finding(severity, code, message, { file, line, ref, detail })
 *   emit(report)           print the JSON, return the exit code
 *   validate(obj)          [] when it conforms; one string per violation otherwise
 *
 * Severity is decided by the TOOL, not inferred here: `block` is whatever made
 * the command exit 1, `warn` is reported-and-not-failing, `info` is context. A
 * tool run with --strict promotes its warns to blocks at the source, so a reader
 * never has to know which flags were passed to interpret the list.
 */

export const SCHEMA = "finding-report/1";
export const SEVERITIES = ["block", "warn", "info"];

export function finding(severity, code, message, extra = {}) {
  const f = { severity, code, message };
  if (extra.file != null) f.file = String(extra.file).split("\\").join("/");
  if (Number.isInteger(extra.line) && extra.line >= 1) f.line = extra.line;
  if (extra.ref != null) f.ref = String(extra.ref);
  if (extra.detail !== undefined) f.detail = extra.detail;
  return f;
}

/** Shorthands. */
export const block = (code, message, extra) => finding("block", code, message, extra);
export const warn = (code, message, extra) => finding("warn", code, message, extra);
export const info = (code, message, extra) => finding("info", code, message, extra);

export function report({ tool, command, findings = [], data = null, summary, ok, exit, skipped = false }) {
  const counts = { block: 0, warn: 0, info: 0 };
  for (const f of findings) if (f && counts[f.severity] !== undefined) counts[f.severity]++;
  const passed = ok !== undefined ? !!ok : counts.block === 0;
  const code = exit !== undefined ? exit : skipped ? 2 : passed ? 0 : 1;
  const r = {
    schema: SCHEMA, tool, command, at: new Date().toISOString(),
    ok: passed, exit: code, summary: String(summary || (skipped ? "nothing to check" : passed ? "clean" : `${counts.block} blocking finding(s)`)).slice(0, 300),
    counts, findings, data,
  };
  if (skipped) r.skipped = true;
  return r;
}

/** Print a report the way every tool prints JSON, and hand back its exit code. */
export function emit(r, write = (s) => process.stdout.write(s + "\n")) {
  write(JSON.stringify(r, null, 2));
  return r.exit;
}

/** Is `obj` a finding report? Cheap test for readers that accept both shapes. */
export const isReport = (obj) => !!obj && typeof obj === "object" && obj.schema === SCHEMA && Array.isArray(obj.findings);

/**
 * Structural validation mirroring schemas/finding.schema.json. Kept by hand and
 * kept small; the test suite runs every tool through it so the two cannot drift
 * without a red build.
 */
export function validate(obj) {
  const errs = [];
  const E = (m) => errs.push(m);
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return ["report is not an object"];
  const TOP = ["schema", "tool", "command", "at", "ok", "skipped", "exit", "summary", "counts", "findings", "data"];
  for (const k of Object.keys(obj)) if (!TOP.includes(k)) E(`unexpected top-level key "${k}"`);
  for (const k of ["schema", "tool", "command", "at", "ok", "exit", "summary", "findings"]) if (!(k in obj)) E(`missing "${k}"`);
  if (obj.schema !== SCHEMA) E(`schema must be "${SCHEMA}"`);
  if (typeof obj.tool !== "string" || !/^[a-z0-9-]+\.mjs$/.test(obj.tool)) E(`tool must look like name.mjs`);
  if (typeof obj.command !== "string" || !obj.command) E(`command must be a non-empty string`);
  if (typeof obj.at !== "string" || Number.isNaN(Date.parse(obj.at))) E(`at must be an ISO date-time`);
  if (typeof obj.ok !== "boolean") E(`ok must be boolean`);
  if ("skipped" in obj && typeof obj.skipped !== "boolean") E(`skipped must be boolean`);
  if (!Number.isInteger(obj.exit) || obj.exit < 0 || obj.exit > 2) E(`exit must be 0, 1 or 2`);
  if (typeof obj.summary !== "string") E(`summary must be a string`);
  if (!Array.isArray(obj.findings)) E(`findings must be an array`);
  else {
    obj.findings.forEach((f, i) => {
      if (!f || typeof f !== "object") { E(`findings[${i}] is not an object`); return; }
      for (const k of Object.keys(f)) if (!["severity", "code", "message", "file", "line", "ref", "detail"].includes(k)) E(`findings[${i}] has unexpected key "${k}"`);
      if (!SEVERITIES.includes(f.severity)) E(`findings[${i}].severity must be block|warn|info`);
      if (typeof f.code !== "string" || !/^[a-z][a-z0-9-]*$/.test(f.code)) E(`findings[${i}].code must be kebab-case`);
      if (typeof f.message !== "string" || !f.message) E(`findings[${i}].message must be a non-empty string`);
      if ("file" in f && typeof f.file !== "string") E(`findings[${i}].file must be a string`);
      if ("line" in f && (!Number.isInteger(f.line) || f.line < 1)) E(`findings[${i}].line must be a positive integer`);
      if ("ref" in f && typeof f.ref !== "string") E(`findings[${i}].ref must be a string`);
    });
    if (obj.ok === true && obj.findings.some((f) => f && f.severity === "block")) E(`ok is true but a finding is "block"`);
  }
  if ("counts" in obj) {
    const c = obj.counts;
    if (!c || typeof c !== "object") E(`counts must be an object`);
    else {
      for (const k of Object.keys(c)) if (!SEVERITIES.includes(k)) E(`counts has unexpected key "${k}"`);
      for (const k of SEVERITIES) if (!Number.isInteger(c[k]) || c[k] < 0) E(`counts.${k} must be a non-negative integer`);
      if (Array.isArray(obj.findings)) for (const k of SEVERITIES) {
        const n = obj.findings.filter((f) => f && f.severity === k).length;
        if (Number.isInteger(c[k]) && c[k] !== n) E(`counts.${k} is ${c[k]} but ${n} finding(s) carry it`);
      }
    }
  }
  return errs;
}
