# Skill: react-test-gen

**Invocation:** `/react-test-gen [source-file-path]`

---

## Overview

**Memory references:** `memory-bank/testingStandards.md`

`react-test-gen` generates a complete test file for a React component or hook by
analysing the source file's props, state transitions, and API calls. For components,
it generates RTL tests covering all prop variants, user interactions, loading/error/empty
states, and an axe accessibility check. For hooks, it generates `renderHook` tests with
MSW handlers for every API call detected. For pages, it generates tests with router and
auth wrappers. Every test that validates an acceptance criterion includes the `// AC-N:`
traceability comment. MSW handlers are auto-generated for any API endpoints the source
file calls.

---

## Steps

**Step 1 — Detect source file type.**

- Contains `useQuery` or `useMutation` imports → hook test
- Is in `pages/` → page test (with router wrapper)
- Contains `useForm` → form test
- Otherwise → component test

**Step 2 — Read spec for acceptance criteria.**

Find `specs/features/[feature-slug].md` from `WORKING_ON.md`. Map ACs to test names.

**Step 3 — Generate test file.**

**For components:**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import { server } from '@/mocks/server';
import { http, HttpResponse } from 'msw';
import { createWrapper } from '@/test-utils/queryWrapper';
import { [ComponentName] } from '../[ComponentName]';

expect.extend(toHaveNoViolations);

const defaultProps = {
  // [all required props with sensible test values]
};

describe('[ComponentName]', () => {
  it('renders without crashing', () => {
    render(<[ComponentName] {...defaultProps} />, { wrapper: createWrapper() });
    expect(screen.getByRole('[role]', { name: '[label]' })).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<[ComponentName] {...defaultProps} />, { wrapper: createWrapper() });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('shows skeleton while loading', async () => {
    // Delay MSW response to catch loading state
    server.use(http.get('/api/v1/[resource]', async () => {
      await new Promise(r => setTimeout(r, 100));
      return HttpResponse.json({ /* data */ });
    }));

    render(<[ComponentName] {...defaultProps} />, { wrapper: createWrapper() });
    expect(screen.getByTestId('[component-name]-skeleton')).toBeInTheDocument();
  });

  it('shows error state on API failure', async () => {
    server.use(http.get('/api/v1/[resource]', () => HttpResponse.error()));
    render(<[ComponentName] {...defaultProps} />, { wrapper: createWrapper() });
    await screen.findByText(/failed to load/i);
  });

  it('shows empty state when no data returned', async () => {
    server.use(http.get('/api/v1/[resource]', () => HttpResponse.json([])));
    render(<[ComponentName] {...defaultProps} />, { wrapper: createWrapper() });
    await screen.findByText(/no .* found/i);
  });

  // [AC-N: criterion text]
  it('[user-interaction test]', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<[ComponentName] {...defaultProps} onAction={onAction} />, { wrapper: createWrapper() });
    await user.click(screen.getByRole('button', { name: '[button label]' }));
    expect(onAction).toHaveBeenCalledWith('[expectedArg]');
  });
});
```

**For form components:**

```tsx
it('submits form with valid values', async () => {
  const user = userEvent.setup();
  const onSuccess = vi.fn();
  render(<[FormName] onSuccess={onSuccess} />, { wrapper: createWrapper() });

  await user.type(screen.getByLabelText(/name/i), 'Test Name');
  await user.click(screen.getByRole('button', { name: /save/i }));

  await waitFor(() => expect(onSuccess).toHaveBeenCalled());
});

it('shows validation errors for empty required fields', async () => {
  const user = userEvent.setup();
  render(<[FormName] />, { wrapper: createWrapper() });

  await user.click(screen.getByRole('button', { name: /save/i }));

  expect(screen.getByRole('alert')).toHaveTextContent(/name is required/i);
});
```

**For hooks:**

```tsx
import { renderHook, waitFor, act } from '@testing-library/react';
import { createWrapper } from '@/test-utils/queryWrapper';
import { server } from '@/mocks/server';
import { http, HttpResponse } from 'msw';

describe('use[HookName]', () => {
  it('returns data on successful fetch', async () => {
    const { result } = renderHook(() => use[HookName]({ id: 'test-123' }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toMatchObject({ id: 'test-123' });
  });

  it('mutation invalidates cache on success', async () => {
    const { result } = renderHook(() => use[Create][Resource](), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ name: 'New Item' });
    });

    expect(result.current.isSuccess).toBe(true);
    // [verify cache invalidation via query client spy]
  });
});
```

**Step 4 — Generate / update MSW handlers.**

For every API endpoint detected in the source file, add a handler to
`src/mocks/handlers/[resource].ts`:

```tsx
// src/mocks/handlers/[resource].ts
import { http, HttpResponse } from 'msw';
import type { [ResourceType] } from '@/types/api';

export const [resource]Handlers = [
  http.get('/api/v1/[resource]', () => {
    return HttpResponse.json<[ResourceType][]>([
      { id: 'mock-1', name: 'Mock [Resource] 1' },
    ]);
  }),

  http.post('/api/v1/[resource]', async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json<[ResourceType]>({ id: 'new-mock-id', ...body as object }, { status: 201 });
  }),
];
```

---

## Example Invocation

**Command:** `/react-test-gen src/features/brokers/components/BrokerExportButton.tsx`

Agent detects a feature component using `useBrokerExport` mutation. Generates tests:
renders, a11y, loading state (mutation pending), success state (download triggered),
error state (mutation error displayed). Adds MSW handler for `GET /api/v1/brokers/:id/clients/export`.

---

**MCP tools:** if the `playwright` MCP server is connected, the Playwright E2E generation step can drive a real browser to verify selectors and flow resolve before finalizing the test file, rather than generating blind.

## Output

- New: `src/[path]/__tests__/[ComponentName].test.tsx` (or `.test.ts` for hooks)
- Updated: `src/mocks/handlers/[resource].ts` (new handlers added)
- Updated: `src/mocks/handlers/index.ts` (new handler array imported and spread)
