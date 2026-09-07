---
name: load-test-gen
description: "Generates a runnable load test for a real user journey with thresholds taken from the SLOs already committed to. k6 or NBomber, profiles for smoke, load, stress, soak and spike. Covers the gap between dotnet-perf-profile (micro-benchmarks, in-process) and production-readiness-review (which blocks on a missing load test). Use when asked about load testing, stress testing, soak testing, throughput under concurrency, capacity, or how many users the system holds. Invoked as /load-test-gen."
---

<!-- GENERATED from the cursor-platform source skill "load-test-gen".
     Do not edit here - edit the source and re-run the plugin build. -->

# Skill: load-test-gen

**Invocation:** `/load-test-gen [feature-id|endpoint] [--tool k6|nbomber] [--profile smoke|load|stress|soak|spike]`
Example: `/load-test-gen premium-calculation` · `/load-test-gen "POST /api/v1/refunds" --profile stress` · `/load-test-gen Tamkeen.Payments --tool nbomber`

---

## Overview

**Memory references:** `.cursor/cache/feature-map.json` (from `feature-trace`),
`memory-bank/performanceGuidelines.md`, `memory-bank/deploymentNotes.md`,
`memory-bank/technologyStack.md`, `memory-bank/apiConventions.md`,
`docs/operability/*-slo.md` (from `operability-gen`)

`load-test-gen` generates a runnable load test for a real user journey, with
thresholds taken from the SLOs you already committed to.

It exists because the platform created a blocker for itself and left no way
through it:

- `production-readiness-review` treats a missing load test as a **blocker** for
  anything on a critical path
- `dotnet-perf-profile` explicitly draws the line — micro-benchmarks for
  allocations and in-process logic, "load test" for throughput under concurrency
  — and then stops at the line
- Nothing in the platform crossed it

So a readiness review could block a release on evidence no skill could produce.
That is an incoherence, not a preference.

**The distinction that decides which skill you want:**

| Question | Skill |
|---|---|
| Is this method allocating too much? Is this serialization slow? | `/dotnet-perf-profile` — BenchmarkDotNet, in-process, nanoseconds |
| Does the system hold up at 200 concurrent users? Does the connection pool exhaust? | **`/load-test-gen`** — real HTTP, real database, real contention |

A micro-benchmark cannot find connection-pool exhaustion, lock convoys, GC
pressure under sustained load, or a dependency that degrades at p99. Those are
the failures that take a system down, and they only appear under concurrency.

---

## Steps

**Step 0 — Get the journey and the thresholds.**

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/feature-map.mjs show <feature-id>
```

From the trace: the **entry points**, the **auth** each requires, the tables each
touches, and any external dependency. Load-test the *journey* a user actually
performs, not one endpoint in isolation — a login that is fast alone can be the
bottleneck when 200 people do it at once.

Then read the SLOs from `docs/operability/<slug>-slo.md`. **Thresholds come from
the SLO, not from a round number.** If the SLO says p95 < 400 ms at 99%, the test
asserts exactly that. A load test with invented thresholds tells you nothing you
can act on — it either always passes or always fails, and either way nobody
believes it.

If there are no SLOs, stop and run `/operability-gen` first. "Fast enough" is not
a threshold.

**Step 1 — Safety. Read this before generating anything.**

A load test is a deliberate denial-of-service attack you are performing on
yourself. Generate the test **and** the guardrails:

- **Never target production** unless someone senior has said so in writing and
  the blast radius is understood. Put the target URL in an environment variable
  with **no default**, so running it with no configuration fails rather than
  hitting whatever was last configured.
- **Never point at a shared environment** without telling the people who share
  it. A load test is indistinguishable from an incident to everyone else on that
  environment.
- **Third-party calls must be stubbed or explicitly budgeted.** Load-testing your
  code by hammering a partner's sandbox is how integrations get suspended — and
  in a payments context, how a partner relationship gets damaged.
- **Data isolation.** The test will create rows. Say where they go, how they are
  identified (a tenant, a prefix, a flag), and how they are cleaned up.
- **Money paths need a dry-run mode.** A load test that issues 10,000 real
  refunds against a sandbox that settles is not a test.

State these in the generated file's header, not only in the report. The header is
what the next person reads.

**Step 2 — Choose the profile deliberately.**

| Profile | Shape | Answers |
|---|---|---|
| **smoke** | 1–5 VUs, 1 min | Does the script work at all? Run this first, always. |
| **load** | Ramp to expected peak, hold 10–15 min | Do we meet the SLO at the traffic we actually get? |
| **stress** | Ramp past peak until something breaks | Where is the ceiling, and what breaks first? |
| **soak** | Moderate load, 2–8 hours | Do we leak? Connections, memory, handles, disk. |
| **spike** | Instant jump to 10x, drop, repeat | Does autoscaling cope, and does recovery work? |

Default to **load**. Recommend **stress** before any launch where the peak is
unknown, and **soak** for anything with a background job or a connection pool —
leaks are invisible in a 15-minute run and obvious in a 4-hour one.

**Two rules for the ramp:**

1. **Ramp, do not step.** A wall of virtual users at t=0 measures your cold-start
   path, not your steady state, and produces a red graph that means nothing.
2. **Include think time.** Real users pause between actions. A test without think
   time generates a request pattern no human produces and exhausts the connection
   pool at a concurrency your users will never reach.

**Step 3 — Generate the test.**

Detect the tool from `technologyStack.md` and `deploymentNotes.md`. Default to
**k6** for HTTP APIs (portable, CI-friendly, thresholds are first-class) and
**NBomber** when the team wants the test in C# alongside the solution.

**k6 shape:**

```javascript
import http from "k6/http";
import { check, sleep, group } from "k6";
import { Trend, Rate } from "k6/metrics";

// SAFETY: no default. Running this unconfigured fails instead of hitting
// whatever was last used. Never point BASE_URL at production.
const BASE = __ENV.BASE_URL;
if (!BASE) throw new Error("BASE_URL is required. Refusing to guess a target.");

const quoteLatency = new Trend("quote_latency", true);
const businessErrors = new Rate("business_errors");

export const options = {
  scenarios: {
    load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m",  target: 50 },   // ramp - never step
        { duration: "10m", target: 50 },   // hold: this window is the measurement
        { duration: "2m",  target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
  // Thresholds come from docs/operability/premium-calculation-slo.md.
  // Abort early: a run that has already breached the SLO has told you what it
  // is going to tell you, and finishing it just costs an hour.
  thresholds: {
    "http_req_failed":   [{ threshold: "rate<0.001", abortOnFail: true, delayAbortEval: "1m" }],
    "quote_latency":     ["p(95)<400", "p(99)<1000"],
    "business_errors":   ["rate<0.01"],
  },
  // Load generators are not the system under test - fail loudly if they saturate.
  noConnectionReuse: false,
  discardResponseBodies: false,
};

export function setup() {
  const res = http.post(`${BASE}/api/v1/auth/token`, JSON.stringify({
    clientId: __ENV.TEST_CLIENT_ID, clientSecret: __ENV.TEST_CLIENT_SECRET,
  }), { headers: { "Content-Type": "application/json" } });
  check(res, { "auth succeeded": r => r.status === 200 });
  return { token: res.json("access_token") };
}

export default function (data) {
  const auth = { headers: { Authorization: `Bearer ${data.token}`, "Content-Type": "application/json" } };

  group("quote journey", () => {
    const quote = http.post(`${BASE}/api/v1/policies/quote`,
      JSON.stringify({ productId: "MOTOR-STD", sumInsured: 50000 }), auth);

    quoteLatency.add(quote.timings.duration);

    // A 200 with a wrong body is a failure the status code will not show you.
    const ok = check(quote, {
      "status 200":          r => r.status === 200,
      "premium is positive": r => r.json("premium") > 0,
      "premium is 2dp":      r => Number.isInteger(Math.round(r.json("premium") * 100)),
    });
    businessErrors.add(!ok);

    sleep(Math.random() * 3 + 2);   // think time: real users pause
  });
}
```

**NBomber shape** (when the team wants it in the solution):

```csharp
var scenario = Scenario.Create("quote_journey", async ctx =>
    {
        var response = await httpClient.PostAsJsonAsync("/api/v1/policies/quote",
            new QuoteRequest("MOTOR-STD", 50_000m), ctx.ScenarioCancellationToken);

        if (!response.IsSuccessStatusCode) return Response.Fail(statusCode: response.StatusCode.ToString());

        var body = await response.Content.ReadFromJsonAsync<QuoteResponse>();
        // Same point as above: a 200 with a wrong number is still a failure.
        return body?.Premium > 0 ? Response.Ok() : Response.Fail(message: "non-positive premium");
    })
    .WithWarmUpDuration(TimeSpan.FromSeconds(30))
    .WithLoadSimulations(
        Simulation.RampingInject(rate: 50, interval: TimeSpan.FromSeconds(1), during: TimeSpan.FromMinutes(2)),
        Simulation.Inject(rate: 50, interval: TimeSpan.FromSeconds(1), during: TimeSpan.FromMinutes(10)));
```

**Always assert on the response body, not only the status code.** Under load, a
service that starts returning 200 with a default or stale value looks perfectly
healthy on every latency and error chart. That is the failure mode a load test is
uniquely positioned to catch, and asserting only `status === 200` throws it away.

**Step 4 — Say what to watch on the other side.**

The load generator's numbers are half the picture and the less interesting half.
The report must name what to watch on the system under test during the run:

- connection pool usage and wait time (the most common real ceiling in .NET)
- GC pause frequency and gen-2 collections
- thread-pool starvation — the signature of the sync-over-async that
  `post-edit-verify` tripwires on
- database: active connections, lock waits, slowest query under load (`db-auditor`)
- dependency latency: does the partner API degrade before you do?
- error-budget burn against the SLO (`operability-gen`)

**A load test that only reports the client-side numbers tells you *that* it broke,
never *why*.** Half the value is in the correlation.

**Step 5 — CI, honestly.**

Run **smoke on every PR** — it is fast, and it catches the script rotting when
the endpoint changes, which is how load tests silently stop testing anything.

Run **load nightly or pre-release**, never on every PR. A 15-minute job on every
PR gets disabled within a month, and then you have neither the signal nor the
habit.

**Never gate a PR on a full stress run.** Gate on smoke; report on load.

**Step 6 — Hand off.**

- No SLOs to threshold against → `/operability-gen` first
- The run found a slow query → `/dotnet-query-optimizer`, `db-auditor`
- The run found allocation pressure → `/dotnet-perf-profile`
- The result is a readiness blocker → `/production-readiness-review`
- Fixes to schedule → `/work-breakdown`

---

## Example Invocation

**Command:** `/load-test-gen premium-calculation --profile soak`

Agent reads the trace, finds the quote journey spans auth → quote → save, and
that the nightly reconciliation job shares `PolicyDbContext`. It pulls p95 < 400 ms
at 99% from the SLO doc and generates a 4-hour k6 soak at 40 VUs with think time,
asserting on `premium > 0` and 2-decimal precision rather than just a 200. The
header refuses to run without `BASE_URL` and states that the reconciliation job
must be disabled or accounted for, because it will contend for the same pool.
The report names connection-pool wait time as the metric most likely to move
first, and recommends smoke-on-PR with the soak scheduled weekly.

---

## Output

- File: `tests/load/<slug>.k6.js` — or `tests/Load/<Slug>LoadTests.cs` for NBomber
- File: `tests/load/README.md` — how to run it, and the safety rules, if absent
- Console:

```
## Load test: <feature / journey>

**Profile:** smoke | load | stress | soak | spike
**Tool:** k6 | NBomber
**Thresholds from:** docs/operability/<slug>-slo.md | NONE - run /operability-gen first

### Journey
| Step | Endpoint | Auth | Think time |

### Thresholds asserted
| Metric | Threshold | Source SLO |

### Safety
| Concern | How this test handles it |
(target env, third-party calls, data created and cleaned, money-path dry-run)

### Watch on the system under test
| Signal | Why it matters here | Where to see it |

### Run it
```bash
BASE_URL=https://staging.example.com k6 run tests/load/<slug>.k6.js
```

### CI recommendation
<smoke on PR; load nightly / pre-release; never gate a PR on a stress run>

### What this test cannot tell you
<cold start, cache-warm behaviour, real user distribution, geographic latency,
anything the stubs replaced>
```

