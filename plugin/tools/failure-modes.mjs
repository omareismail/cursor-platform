#!/usr/bin/env node
/**
 * failure-modes.mjs — everything this system depends on and does not control,
 * and what happens when each one fails.
 *
 * WHY THIS EXISTS
 *
 * `risk-profile.mjs` made the tests deeper where being wrong is expensive, but
 * every one of those tests is about THIS system's behaviour on bad input. Nothing
 * anywhere in this platform asks the other question: what happens when the mada
 * gateway stops answering, the ZATCA endpoint returns 503 for four hours, the
 * database fails over mid-transaction, or the queue redelivers a message that
 * already moved money.
 *
 * Those are the failures that actually take fintech systems down. They are
 * designed for in phase 3 or not at all, they are almost never tested, and they
 * are discovered at three in the morning by whoever is on call.
 *
 * THE ONE THAT KILLS SERVICES: A MISSING TIMEOUT
 *
 * A dependency that FAILS is survivable — the call returns, the error is handled.
 * A dependency that goes SLOW is what takes the service with it: requests pile up
 * on a thread pool that never drains. `new HttpClient()` defaults to a hundred
 * seconds, which under any real load is indistinguishable from an outage of your
 * own making. That default is the single most common cause of the incident, and
 * it is mechanically detectable, so it is reported as blocking.
 *
 * THE HONEST LIMIT OF "CHAOS"
 *
 * There is a ladder, and only part of it belongs in a repository:
 *
 *   1  designed   every dependency has a decided failure behaviour     gate 3
 *   2  built      timeout, retry, circuit breaker, idempotency         this tool
 *   3  tested     a test that simulates the dependency failing         this tool
 *   4  rehearsed  somebody broke it in staging and watched             gate 6
 *   5  production chaos experiments against live traffic
 *
 * Levels 1-4 are real, cheap and safe. Level 5 is NOT proposed here and this tool
 * will not generate it: running fault injection against a live SAMA-regulated
 * payment system is a formal change with a named owner and a regulator-facing
 * record, and no tool in a repository has the standing to authorise one. A skill
 * that emitted a production chaos script would be generating something nobody is
 * allowed to run — a form, not a control.
 *
 * WHAT IT READS, AND HOW PRECISELY
 *
 * The unit of analysis is the REGISTRATION SITE, not the file: `AddHttpClient`,
 * `AddDbContext`, `AddMassTransit`, `axios.create` — because that is where
 * resilience is configured in both stacks. Grepping a whole file for the word
 * "Timeout" finds one belonging to something else and reports a protection that
 * is not there, which is the dangerous direction to be wrong in.
 *
 * `AddStandardResilienceHandler` is recognised explicitly: it configures timeout,
 * retry AND circuit breaker in one call, and a tool that reported "no timeout"
 * for a correctly built .NET 8 client would be ignored within a week, correctly.
 *
 * Usage:
 *   node .cursor/tools/failure-modes.mjs scan [--json]
 *   node .cursor/tools/failure-modes.mjs check [--json]     # gates 3 and 6
 *   node .cursor/tools/failure-modes.mjs explain <name>
 *
 * Exit codes:  0 = no blocking or high finding   1 = findings   2 = usage
 */

import { readFileSync, statSync, readdirSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.env.CLAUDE_PROJECT_DIR || repoRoot() || process.cwd();
function repoRoot() {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

const out = (s = "") => process.stdout.write(s + "\n");
const pad = (s, n) => String(s).slice(0, n - 1).padEnd(n);
const die = (m, c = 2) => { process.stderr.write(m + "\n"); process.exit(c); };

const SKIP = /(^|\/)(bin|obj|node_modules|dist|\.next|coverage|TestResults|\.git|plugin|templates)(\/|$)/;
const CODE_EXT = new Set([".cs", ".ts", ".tsx", ".js", ".jsx"]);
const TEST_PATH = /(^|\/)(tests?|__tests__|spec)(\/|$)|\.(test|spec)\.[jt]sx?$|Tests?\.cs$/i;

function tracked() {
  try {
    return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split("\n").filter(Boolean);
  } catch { return walk(ROOT); }
}
function walk(dir, acc = []) {
  let names; try { names = readdirSync(dir); } catch { return acc; }
  for (const n of names) {
    const full = join(dir, n), r = relative(ROOT, full).split("\\").join("/");
    if (SKIP.test("/" + r)) continue;
    let st; try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, acc); else acc.push(r);
  }
  return acc;
}

/* ------------------------------------------------------- registration sites */

/**
 * A registration and everything chained onto it, up to the statement's end.
 * Balanced-paren scan rather than a regex, because these chains routinely span
 * ten lines and a line-based match would read half a policy.
 */
function statementAt(text, start) {
  let depth = 0, i = start;
  for (; i < text.length && i < start + 4000; i++) {
    const c = text[i];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    else if (c === ";" && depth <= 0) break;
  }
  return text.slice(start, Math.min(i + 1, text.length));
}

const lineOf = (text, i) => text.slice(0, i).split("\n").length;

/**
 * What counts as a dependency this system does not control. `db` is listed but
 * held to a lighter standard: nobody unit-tests a failover, and demanding it
 * would be the requirement that gets the whole check switched off.
 */
const REGISTRATIONS = [
  { kind: "http", re: /\bAddHttpClient\s*[<(]/g, ext: [".cs"] },
  // `[({]` because `new HttpClient { Timeout = ... }` is as common as the
  // parenthesised form, and a dependency this tool does not match does not
  // appear as "unprotected" — it disappears, which is worse.
  { kind: "http", re: /\bnew\s+HttpClient\s*[({]/g, ext: [".cs"], raw: true },
  { kind: "http", re: /\baxios\s*\.\s*create\s*\(/g, ext: [".ts", ".tsx", ".js", ".jsx"] },
  { kind: "db", re: /\bAdd(?:DbContext|DbContextPool)\s*[<(]/g, ext: [".cs"] },
  { kind: "db", re: /\bUse(?:SqlServer|Npgsql|Oracle|MySql|Sqlite)\s*\(/g, ext: [".cs"] },
  { kind: "queue", re: /\bAdd(?:MassTransit|ServiceBus|RabbitMq|Kafka)\w*\s*[<(]/g, ext: [".cs"] },
  { kind: "cache", re: /\bAdd(?:StackExchangeRedisCache|DistributedRedisCache)\s*\(|\bConnectionMultiplexer\s*\.\s*Connect\s*\(/g, ext: [".cs"] },
];

/**
 * Comments are stripped before any protection is looked for. The fixture that
 * built this tool contained the line `// a payment client with retries and no
 * idempotency key` — and the repo-wide idempotency search matched it, so a
 * comment stating the protection was ABSENT was read as evidence it was present.
 * That is the dangerous direction, and it is the shape of every text-search bug
 * worth having: the words that describe a gap look exactly like the words that
 * describe the fix.
 */
const stripComments = (t) => String(t).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

/** Protections, matched INSIDE the registration statement only. */
const STANDARD = /\bAdd(?:Standard)?ResilienceHandler\s*\(|\bAddResilienceHandler\s*\(/;
const MARKERS = {
  timeout: /\bTimeout\s*=|\bTimeoutAsync?\s*[<(]|AddPolicyHandler\s*\([^)]*Timeout|\btimeout\s*:\s*\d|AbortSignal\s*\.\s*timeout\s*\(|\bCommandTimeout\b|\bEnableRetryOnFailure\s*\([^)]*TimeSpan/,
  retry: /\bWaitAndRetry\w*\s*\(|\bRetryAsync?\s*\(|\bEnableRetryOnFailure\s*\(|\bretries?\s*:\s*\d|\bAddRetry\b/,
  breaker: /\bCircuitBreaker\w*\s*\(|\bAdvancedCircuitBreaker\w*\s*\(/,
  idempotency: /\bIdempoten\w*|["']Idempotency-Key["']|\bidempotencyKey\b/i,
  fallback: /\bFallbackAsync?\s*[<(]|\bAddFallback\b/,
};

/** A name worth reporting: the typed client, the named client, or the file. */
function nameOf(stmt, kind, file) {
  const generic = stmt.match(/AddHttpClient\s*<\s*([A-Za-z0-9_.]+)/);
  if (generic) return generic[1].replace(/^I(?=[A-Z])/, "");
  const named = stmt.match(/AddHttpClient\s*\(\s*["']([^"']+)["']/);
  if (named) return named[1];
  const ctx = stmt.match(/AddDbContext(?:Pool)?\s*<\s*([A-Za-z0-9_.]+)/);
  if (ctx) return ctx[1];
  const base = stmt.match(/BaseAddress\s*=[^;]*?["']([^"']*?)["']|baseURL\s*:\s*["']([^"']+)["']/);
  if (base) return (base[1] || base[2]).slice(0, 60);
  // The broker or provider is the searchable name when there is no typed client:
  // `queue:Startup.cs` matches nothing in a design document, so the tool reported
  // "not documented" and "no fault test" about a name it had invented itself.
  const tech = stmt.match(/\bUsing(RabbitMq|AzureServiceBus|ServiceBus|Kafka|AmazonSqs)\b/i)
            || stmt.match(/\bAdd(MassTransit|ServiceBus|RabbitMq|Kafka)\w*/i)
            || stmt.match(/\bUse(SqlServer|Npgsql|Oracle|MySql|Sqlite)\b/i)
            || stmt.match(/\b(StackExchangeRedisCache|ConnectionMultiplexer)\b/);
  if (tech) return tech[1].replace(/^Npgsql$/, "Postgres").replace(/^StackExchangeRedisCache$|^ConnectionMultiplexer$/, "Redis");
  return `${kind}:${file.split("/").pop()}`;
}

/* ---------------------------------------------------------------- discovery */

const MONEY = /\b(payment|pay|premium|invoice|refund|settle\w*|transfer|charge|debit|credit|commission|mada|SADAD|ZATCA)\b/i;

/**
 * `MadaPaymentClient` contains neither `\bmada\b` nor `\bpayment\b` — the word
 * boundaries fall inside the camel case. Which means the money detector missed
 * precisely the identifiers most likely to be about money, in a codebase whose
 * convention is PascalCase. Split the humps before matching.
 */
const unCamel = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
const isMoney = (...parts) => parts.some((p) => p && (MONEY.test(p) || MONEY.test(unCamel(p))));

/**
 * Idempotency for a broker is implemented in the consumers, never at the
 * registration. Asking the registration statement produces a finding that is
 * always true, and a check that always fires is a check people turn off. This
 * one question is answered across the source rather than at one site — stated
 * plainly, because it is a weaker kind of evidence than the rest of this file.
 */
function idempotencyAnywhere(files) {
  const re = /\bIdempoten\w*|\bInboxState\b|\bDeduplicat\w*|\bMessageId\b[^;\n]{0,60}\b(seen|exists|processed|duplicate)\b/i;
  for (const rel of files) {
    if (!CODE_EXT.has(extname(rel)) || TEST_PATH.test(rel) || SKIP.test("/" + rel)) continue;
    let t; try { t = readFileSync(join(ROOT, rel), "utf8"); } catch { continue; }
    if (re.test(stripComments(t))) return { found: true, where: rel };
  }
  return { found: false, where: null };
}

function findDependencies(files) {
  const deps = new Map();
  for (const rel of files) {
    const ext = extname(rel);
    if (!CODE_EXT.has(ext) || SKIP.test("/" + rel) || TEST_PATH.test(rel)) continue;
    let text; try { text = readFileSync(join(ROOT, rel), "utf8"); } catch { continue; }

    // A registration nested inside one already captured is the same dependency
    // seen twice: `AddDbContext<X>(o => o.UseSqlServer(...))` matches both
    // patterns and would otherwise be reported as two databases.
    const claimed = [];
    for (const reg of REGISTRATIONS) {
      if (!reg.ext.includes(ext)) continue;
      reg.re.lastIndex = 0;
      for (const m of text.matchAll(reg.re)) {
        if (claimed.some(([a, b]) => m.index > a && m.index < b)) continue;
        const stmtRaw = statementAt(text, m.index);
        claimed.push([m.index, m.index + stmtRaw.length]);
        const stmt = stripComments(stmtRaw);
        const name = nameOf(stmt, reg.kind, rel);
        const key = `${reg.kind}:${name}`;
        const std = STANDARD.test(stmt);
        const d = deps.get(key) || {
          name, kind: reg.kind, sites: [], raw: false,
          timeout: false, retry: false, breaker: false, idempotency: false, fallback: false,
          standardHandler: false, money: false,
        };
        d.sites.push(`${rel}:${lineOf(text, m.index)}`);
        d.raw = d.raw || !!reg.raw;
        d.standardHandler = d.standardHandler || std;
        // The standard handler configures timeout, retry and circuit breaker in
        // one call. Reporting "no timeout" for that would be plainly wrong.
        d.timeout = d.timeout || std || MARKERS.timeout.test(stmt);
        d.retry = d.retry || std || MARKERS.retry.test(stmt);
        d.breaker = d.breaker || std || MARKERS.breaker.test(stmt);
        d.idempotency = d.idempotency || MARKERS.idempotency.test(stmt);
        d.fallback = d.fallback || MARKERS.fallback.test(stmt);
        d.money = d.money || isMoney(stmt, name, rel);
        deps.set(key, d);
      }
    }
  }
  return [...deps.values()];
}

/* ------------------------------------------------- documentation and tests */

const FAILURE_WORDS = /\b(fail\w*|unavailable|outage|down|timeout|timed out|degrade\w*|fallback|circuit|retry|retries|5\d\d|unreachable|partial)\b/i;

/** Is the dependency's failure behaviour DECIDED anywhere in the design? */
function documented(dep, files) {
  const docs = files.filter((f) => /^docs\/(design|analysis)\//.test(f) && f.endsWith(".md"));
  const needle = dep.name.replace(/^.*[:.]/, "").toLowerCase();
  if (needle.length < 3) return { found: false, where: null, why: "name too generic to search for" };
  for (const rel of docs) {
    let lines; try { lines = readFileSync(join(ROOT, rel), "utf8").split("\n"); } catch { continue; }
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].toLowerCase().includes(needle)) continue;
      const window = lines.slice(Math.max(0, i - 6), i + 10).join(" ");
      if (FAILURE_WORDS.test(window)) return { found: true, where: `${rel}:${i + 1}`, why: null };
      return { found: false, where: `${rel}:${i + 1}`, why: "named in the design, but nothing says what happens when it fails" };
    }
  }
  return { found: false, where: null, why: "not named anywhere in docs/design or docs/analysis" };
}

/**
 * A test that makes the dependency fail. Not "a test that uses a mock" — a mock
 * returning success is the opposite of this. The shapes below are the ones that
 * actually simulate an outage.
 */
const FAULT_SHAPES = [
  /\bWireMock\b|\bMockHttpMessageHandler\b|\bmsw\b|\bsetupServer\s*\(/,
  /\.\s*Throws?(?:Async)?\s*<\s*(?:HttpRequestException|TimeoutException|TaskCanceledException|SocketException|BrokerUnreachableException)/,
  /\b(?:ServiceUnavailable|GatewayTimeout|RequestTimeout|TooManyRequests)\b|\b50[023]\b/,
  /\bSimulate(?:Failure|Outage|Timeout)\b|\bChaos\w*\b/i,
  /\bDelay\s*\(\s*TimeSpan\.From(?:Seconds|Minutes)|\bCancelAfter\s*\(/,
];
function faultTested(dep, files) {
  const needle = dep.name.replace(/^.*[:.]/, "").toLowerCase();
  for (const rel of files) {
    if (!TEST_PATH.test(rel) || !CODE_EXT.has(extname(rel))) continue;
    let text; try { text = readFileSync(join(ROOT, rel), "utf8"); } catch { continue; }
    const mentions = needle.length >= 3 && text.toLowerCase().includes(needle);
    if (!mentions) continue;
    const hit = FAULT_SHAPES.find((re) => re.test(text));
    if (hit) return { found: true, where: rel };
  }
  return { found: false, where: null };
}

/* ------------------------------------------------------------------ findings */

const SEV = { BLOCKING: 0, HIGH: 1, MED: 2 };

function assess(dep) {
  const f = [];
  if (dep.kind === "http") {
    if (!dep.timeout) f.push({ sev: "BLOCKING", what: "no timeout",
      why: dep.raw
        ? "a bare `new HttpClient()` uses the 100-second default. A dependency that goes SLOW is what takes a service down — requests pile up on a pool that never drains."
        : "nothing in this registration sets one, so the 100-second default applies. Slow is worse than down." });
    if (dep.retry && !dep.idempotency) {
      const src = dep.standardHandler
        ? "AddStandardResilienceHandler retries by default — that is not a mistake in the registration, it is the default nobody reads. "
        : "";
      f.push({ sev: dep.money ? "BLOCKING" : "HIGH", what: "retry without idempotency",
        why: src + (dep.money
          ? "This path handles money. A retried transfer that is not idempotent pays twice, and the second payment is invisible until reconciliation."
          : "A retried non-idempotent call repeats whatever the first attempt already did.") });
    }
    if (dep.retry && !dep.breaker)
      f.push({ sev: "HIGH", what: "retry without a circuit breaker",
        why: "retries against a struggling dependency multiply the load on it. That is how a slow provider becomes an outage for everyone using it." });
  }
  if (dep.kind === "queue" && !dep.idempotency)
    f.push({ sev: dep.money ? "BLOCKING" : "HIGH", what: "no idempotency anywhere in the consumers",
      why: "at-least-once delivery is the default in every broker here — the redelivery is not a fault, it is the contract. Nothing in the source mentions an idempotency key, an inbox, or a seen-message check." });
  if (dep.kind === "db" && !dep.timeout)
    f.push({ sev: "MED", what: "no command timeout",
      why: "a query with no timeout holds a connection until the pool is empty." });
  return f;
}

/* ---------------------------------------------------------------- commands */

function build() {
  const files = tracked().filter((f) => !SKIP.test("/" + f));
  const deps = findDependencies(files);
  const queueIdem = deps.some((d) => d.kind === "queue" && !d.idempotency) ? idempotencyAnywhere(files) : { found: false };
  for (const d of deps) {
    // Before assessing, not after: a queue whose consumers do handle redelivery
    // was otherwise reported as protected AND unprotected in the same block.
    if (d.kind === "queue" && !d.idempotency && queueIdem.found) { d.idempotency = true; d.idempotencyWhere = queueIdem.where; }
    d.findings = assess(d);
    d.doc = documented(d, files);
    // Failing over a database is not a unit test, and demanding one here is how
    // a check gets switched off. External calls and queues are a different case:
    // simulating a 503 costs one stub.
    d.needsFaultTest = d.kind === "http" || d.kind === "queue";
    d.fault = d.needsFaultTest ? faultTested(d, files) : { found: false, where: null };
    // A name this tool invented ("queue:Startup.cs") matches nothing in a design
    // document or a test file. Reporting HIGH for that is reporting a gap in the
    // tool as a gap in the system, which is how a checker loses its audience.
    d.unnamed = /^[a-z]+:/.test(d.name);
    if (d.needsFaultTest && !d.fault.found)
      d.findings.push(d.unnamed
        ? { sev: "MED", what: "cannot be checked for a fault test",
            why: "this registration has no typed client or named broker to search for, so the tool has no handle on it. Give it a typed client, or check by hand." }
        : { sev: "HIGH", what: "no test makes it fail",
            why: "every test of this dependency has it working. Nobody has seen what the system does when it does not." });
    if (!d.doc.found)
      d.findings.push({ sev: "MED", what: "failure behaviour is not decided in the design", why: d.doc.why });
    d.worst = d.findings.length ? d.findings.reduce((a, b) => (SEV[a.sev] <= SEV[b.sev] ? a : b)).sev : null;
  }
  deps.sort((a, b) => (SEV[a.worst] ?? 9) - (SEV[b.worst] ?? 9) || a.name.localeCompare(b.name));
  return { deps, files };
}

const shield = (d) => [d.timeout && "timeout", d.retry && "retry", d.breaker && "breaker",
                       d.idempotency && "idempotency", d.fallback && "fallback"].filter(Boolean).join(" + ") || "nothing";

const CMDS = {
  scan(args) {
    const { deps } = build();
    if (args.includes("--json")) { out(JSON.stringify(deps, null, 2)); return 0; }
    if (!deps.length) {
      out(`No external dependency registrations found.`);
      out(`Looked for AddHttpClient, new HttpClient, axios.create, AddDbContext,`);
      out(`AddMassTransit/ServiceBus/Kafka and the Redis registrations.`);
      out(`\nIf this system does call something it does not control, it does so somewhere`);
      out(`this tool cannot see — which is worth knowing on its own.`);
      return 0;
    }
    out(`# Failure modes — ${deps.length} dependenc${deps.length === 1 ? "y" : "ies"} this system does not control\n`);
    for (const d of deps) {
      out(`  ${pad(d.worst || "ok", 9)}${pad(d.kind, 7)}${d.name}${d.money ? "   [money]" : ""}`);
      out(`            ${d.sites.slice(0, 3).join("  ")}`);
      out(`            protected by: ${shield(d)}${d.standardHandler ? "   (AddStandardResilienceHandler)" : ""}`);
      if (d.doc.found) out(`            failure decided in ${d.doc.where}`);
      if (d.fault.found) out(`            fault test: ${d.fault.where}`);
      for (const f of d.findings) out(`            ${f.sev}: ${f.what}`);
      out("");
    }
    const blocking = deps.filter((d) => d.worst === "BLOCKING").length;
    out(blocking ? `${blocking} dependenc${blocking === 1 ? "y has" : "ies have"} a blocking finding. \`check\` explains each one.`
                 : `No blocking findings. \`check\` still reports the rest.`);
    return 0;
  },

  check(args) {
    const { deps } = build();
    const bad = deps.filter((d) => d.findings.some((f) => f.sev !== "MED"));
    if (args.includes("--json")) {
      out(JSON.stringify({ dependencies: deps.length, failing: bad.length, deps }, null, 2));
      return bad.length ? 1 : 0;
    }
    out(`# Failure modes — ${deps.length} dependenc${deps.length === 1 ? "y" : "ies"}\n`);
    if (!deps.length) { out(`Nothing found to check.`); return 0; }
    if (!bad.length) {
      out(`OK: every dependency has a timeout, and every external one has a test that`);
      out(`makes it fail.`);
      const med = deps.filter((d) => d.findings.length);
      if (med.length) out(`\n${med.length} with a non-blocking finding — see \`scan\`.`);
      return 0;
    }
    for (const d of bad) {
      out(`  ${d.name}  (${d.kind})${d.money ? "   [money]" : ""}`);
      out(`      ${d.sites[0]}`);
      out(`      protected by: ${shield(d)}`);
      for (const f of d.findings.filter((x) => x.sev !== "MED")) {
        out(`      ${f.sev}: ${f.what}`);
        out(`          ${f.why}`);
      }
      out("");
    }
    out(`FAILED: ${bad.length} of ${deps.length} dependencies.`);
    out(`Every one of these is a decision that was never made, not a bug. That is why`);
    out(`they surface at three in the morning rather than in review.`);
    return 1;
  },

  explain(args) {
    const q = args.find((a) => !a.startsWith("--"));
    if (!q) die(`explain needs a dependency name — see \`scan\`.`, 2);
    const { deps } = build();
    const d = deps.find((x) => x.name.toLowerCase().includes(q.toLowerCase()));
    if (!d) die(`No dependency matching "${q}".`, 1);
    out(`${d.name}  (${d.kind})${d.money ? "   [money path]" : ""}\n`);
    out(`  Registered at:`);
    for (const s of d.sites) out(`    ${s}`);
    out(`\n  Protected by: ${shield(d)}`);
    if (d.standardHandler) out(`    via AddStandardResilienceHandler — timeout, retry and circuit breaker together`);
    out(`\n  Failure behaviour in the design: ${d.doc.found ? d.doc.where : `NOT DECIDED — ${d.doc.why}`}`);
    if (d.needsFaultTest) out(`  A test that makes it fail: ${d.fault.found ? d.fault.where : "none"}`);
    if (!d.findings.length) { out(`\n  No findings.`); return 0; }
    out(`\n  Findings:`);
    for (const f of d.findings) { out(`    ${f.sev}: ${f.what}`); out(`        ${f.why}`); }
    out(`\n  What this tool cannot tell you: whether the behaviour it found is the RIGHT`);
    out(`  one. A three-second timeout on a batch settlement is as wrong as none at all.`);
    out(`  It reports presence at the registration site; the gate 3 reviewer decides`);
    out(`  whether the number makes sense.`);
    return d.findings.some((f) => f.sev !== "MED") ? 1 : 0;
  },
};

const [cmd, ...args] = process.argv.slice(2);
if (!cmd || !CMDS[cmd]) {
  out(`failure-modes.mjs — what happens when something you do not control fails

  scan [--json]        every dependency, what protects it, and what is missing
  check [--json]       gates 3 and 6: fails on a missing timeout, a retry with no
                       idempotency, or an external dependency nothing makes fail
  explain <name>       one dependency in full

The unit is the registration site — AddHttpClient, AddDbContext, AddMassTransit,
axios.create — not the file, so a Timeout belonging to something else is not
counted as protection. AddStandardResilienceHandler is understood.

Production chaos experiments are deliberately out of scope: against a regulated
payment system that is a formal change with a named owner, not something a
repository tool authorises.`);
  process.exit(cmd ? 2 : 0);
}
process.exit(CMDS[cmd](args) ?? 0);
