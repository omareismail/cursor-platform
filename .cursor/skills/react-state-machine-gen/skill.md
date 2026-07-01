# Skill: react-state-machine-gen

**Invocation:** `/react-state-machine-gen [flow-name]`

---

## Overview

**Memory references:** `memory-bank/frontendConventions.md`

`react-state-machine-gen` models a multi-step or multi-status UI flow as an explicit
XState state machine instead of a tangle of boolean flags (`isLoading`, `isSubmitted`,
`isConfirmed`, `hasError`) that inevitably drift into impossible state combinations.
A state machine makes every valid state and transition explicit, makes invalid transitions
impossible by construction, and produces a testable, visual specification of the UI
behaviour. It reads the spec's User Flow section to enumerate states and transitions,
then generates the machine definition, the `useMachine` wrapper hook, transition tests,
and a plain-text state diagram for embedding in the spec.

---

## Steps

**Step 0 — Call `pattern-finder` for the nearest existing state machine.**

Run `/pattern-finder new state machine for [flow-name]`. Imitate the matched
machine's context-shape convention, how side effects are invoked (XState
`invoke` vs. effect outside the machine), and how it's wired to the
component tree — before enumerating this flow's own states in Step 1.

**Step 1 — Enumerate states and transitions.**

Read the spec's `## Frontend Specification → User Flow` section.
Extract:
- Every distinct named state the UI can be in
- Every event/action that triggers a transition
- Every guard condition on a transition
- Every side effect (API call, navigation) that happens on a transition

**Step 2 — Generate the XState machine definition.**

```typescript
// src/features/[feature]/machines/[flowName]Machine.ts
import { createMachine, assign } from 'xstate';

export interface [FlowName]Context {
  [orderId]: string | null;
  [errorMessage]: string | null;
  [formValues]: [FormType] | null;
}

export type [FlowName]Event =
  | { type: 'START' }
  | { type: 'SUBMIT'; values: [FormType] }
  | { type: 'CONFIRM' }
  | { type: 'RETRY' }
  | { type: 'CANCEL' }
  | { type: 'SUCCESS'; [orderId]: string }
  | { type: 'FAILURE'; message: string };

export const [flowName]Machine = createMachine<[FlowName]Context, [FlowName]Event>(
  {
    id: '[flowName]',
    initial: 'idle',
    context: {
      [orderId]: null,
      [errorMessage]: null,
      [formValues]: null,
    },
    states: {
      idle: {
        on: {
          START: 'form',
        },
      },
      form: {
        on: {
          SUBMIT: {
            target: 'submitting',
            actions: 'cacheFormValues',
          },
          CANCEL: 'idle',
        },
      },
      submitting: {
        invoke: {
          src: 'submitOrder',
          onDone: {
            target: 'confirmation',
            actions: assign({ [orderId]: (_, event) => event.data.[orderId] }),
          },
          onError: {
            target: 'error',
            actions: assign({ [errorMessage]: (_, event) => (event.data as Error).message }),
          },
        },
      },
      confirmation: {
        on: {
          CONFIRM: 'success',
        },
      },
      error: {
        on: {
          RETRY: 'form',
          CANCEL: 'idle',
        },
      },
      success: {
        type: 'final',
      },
    },
  },
  {
    actions: {
      cacheFormValues: assign({
        [formValues]: (_, event) => (event as Extract<[FlowName]Event, { type: 'SUBMIT' }>).values,
      }),
    },
  }
);
```

**Step 3 — Generate the `useMachine` wrapper hook.**

```typescript
// src/features/[feature]/hooks/use[FlowName]Machine.ts
import { useMachine } from '@xstate/react';
import { [flowName]Machine } from '../machines/[flowName]Machine';
import { use[Submit] } from './use[Submit]';

export function use[FlowName]Machine() {
  const submitMutation = use[Submit]();

  const [state, send] = useMachine([flowName]Machine, {
    services: {
      submitOrder: async (context) => {
        return submitMutation.mutateAsync(context.[formValues]!);
      },
    },
  });

  return {
    state: state.value,
    context: state.context,
    isIdle: state.matches('idle'),
    isForm: state.matches('form'),
    isSubmitting: state.matches('submitting'),
    isConfirmation: state.matches('confirmation'),
    isError: state.matches('error'),
    isSuccess: state.matches('success'),
    send,
  };
}
```

**Step 4 — Generate transition tests.**

```typescript
import { createActor } from 'xstate';
import { [flowName]Machine } from '../[flowName]Machine';

describe('[flowName]Machine', () => {
  it('starts in idle state', () => {
    const actor = createActor([flowName]Machine).start();
    expect(actor.getSnapshot().value).toBe('idle');
  });

  it('transitions idle → form on START', () => {
    const actor = createActor([flowName]Machine).start();
    actor.send({ type: 'START' });
    expect(actor.getSnapshot().value).toBe('form');
  });

  it('transitions form → submitting on SUBMIT', () => {
    const actor = createActor([flowName]Machine).start();
    actor.send({ type: 'START' });
    actor.send({ type: 'SUBMIT', values: { /* ... */ } });
    expect(actor.getSnapshot().value).toBe('submitting');
  });

  it('transitions error → form on RETRY (not idle)', () => {
    // Test invalid transition: error does NOT go to submitting on SUBMIT
    const actor = createActor([flowName]Machine).start();
    actor.send({ type: 'START' });
    actor.send({ type: 'SUBMIT', values: { /* ... */ } });
    actor.send({ type: 'FAILURE', message: 'API error' });
    expect(actor.getSnapshot().value).toBe('error');
    // SUBMIT from error state should be ignored
    actor.send({ type: 'SUBMIT', values: { /* ... */ } });
    expect(actor.getSnapshot().value).toBe('error'); // still error
  });
});
```

**Step 5 — Generate state diagram text for the spec.**

```
## State Machine: [FlowName]

idle ──START──→ form ──SUBMIT──→ submitting ──SUCCESS──→ confirmation ──CONFIRM──→ success (final)
                │                     │
                CANCEL                FAILURE
                │                     │
                ↓                     ↓
               idle                 error ──RETRY──→ form
                                      │
                                    CANCEL
                                      │
                                      ↓
                                     idle
```

---

## Example Invocation

**Command:** `/react-state-machine-gen checkout-flow`

Agent reads spec User Flow (5 steps: cart → address → payment → confirmation → success),
generates `checkoutFlowMachine.ts` with 6 states + 8 transitions, `useCheckoutFlowMachine`
hook, 12 transition tests (all valid paths + guard tests for invalid transitions).

---

## Output

- New: `src/features/[feature]/machines/[flowName]Machine.ts`
- New: `src/features/[feature]/hooks/use[FlowName]Machine.ts`
- New: `src/features/[feature]/machines/__tests__/[flowName]Machine.test.ts`
- Terminal: plain-text state diagram (copy to spec's Frontend Specification section)
