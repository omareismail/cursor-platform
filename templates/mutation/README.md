# Mutation testing

Coverage tells you a line ran. Mutation testing tells you whether anything would
have noticed if that line were wrong.

## Why this is here

Stryker deliberately breaks your code — flips `>=` to `>`, swaps `&&` for `||`,
replaces a return value with a default — and checks whether a test fails. A
mutation that survives is a change to your production code that **no test
noticed**, named precisely, with a file and line.

That is the only measurement that answers the question this platform has to
answer: when the same process wrote the implementation and the test, does the
test actually constrain the implementation, or does it just agree with it?

You can hold 100% line coverage with tests that can never fail. Mutation score
cannot be gamed that way.

## Install

**.NET**

```bash
dotnet tool install -g dotnet-stryker
dotnet stryker                                    # whole project — slow
dotnet stryker --mutate "src/Co.Domain/Pricing/**"   # scoped — do this
```

**TypeScript / React**

```bash
npm i -D @stryker-mutator/core @stryker-mutator/vitest-runner @stryker-mutator/typescript-checker
npx stryker run
npx stryker run --mutate "src/features/quotes/**/*.ts"
```

Copy `stryker-config.json` (.NET) and `stryker.conf.json` (TS) to the matching
project roots and adjust the paths.

## Scope it, or it will get disabled

A full-repo mutation run takes hours. A run scoped to the files one task touched
takes minutes. The second one gets used; the first one gets switched off after
the second time it blocks a release, and then you have nothing.

Practical policy:

| When | Scope |
|---|---|
| `/task-verify --mutate` on a task | The task's `Files` column only |
| PR touching money, auth, or pricing | The changed files |
| Weekly scheduled job | One critical module, rotating |
| Never | Everything, on every PR |

## Which modules are worth it

Mutation testing costs real time, so spend it where a silent wrong answer is
expensive:

- **Money**: pricing, premium, commission, settlement, rounding, tax
- **Auth**: policy evaluation, tenant isolation, permission checks
- **State machines**: refund, approval, policy lifecycle — where an ordering bug
  is invisible to a happy-path test
- **Anything `/threat-model` rated Critical**
- **Anything `/postmortem` traced an incident to**

Not worth it: DTOs, mappers, generated code, thin controllers, UI layout.

## Reading the result

**Read the survivors, not the score.** The score is a summary; the survivor list
is the actionable part — each entry is a specific change nobody would have
caught.

```
Survived: PremiumCalculator.cs:112   >= → >
```

That one line says the threshold boundary has no test. It is the exact class of
bug `/spec-drift-audit` finds in production specs, and it is worth more than the
percentage above it.

**Equivalent mutants** — changes that genuinely cannot alter behaviour — do
exist, and they are the standard objection to mutation testing. They are real but
rarer than people assume; check before dismissing a survivor as equivalent,
because "that one doesn't count" is also what you say about a real gap you do not
want to fix.

## Thresholds

Start by measuring, not gating. Run it on one critical module, look at the
survivors, fix the real gaps, and only then set `break` to whatever you actually
achieved minus a small margin. A threshold set aspirationally on day one just
fails the build until someone lowers it, which teaches everyone the gate is
decorative.

`high` / `low` are reporting colours. `break` is the one that fails CI.
