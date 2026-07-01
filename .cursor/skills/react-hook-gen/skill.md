# Skill: react-hook-gen

**Invocation:** `/react-hook-gen [hookName] [type]`
Types: `query` | `mutation` | `form` | `local`

---

## Overview

**Memory references:** `memory-bank/frontendConventions.md`

`react-hook-gen` generates a complete, typed custom React hook with a corresponding
test stub. Every hook returns a named object (never an array), uses `QUERY_KEYS`
constants (never inline string arrays), and has all return values explicitly typed.
Mutation hooks include optimistic update scaffolding and cache invalidation by default.
Form hooks wrap React Hook Form with a Zod resolver. Local hooks extract complex
`useState`/`useReducer` logic from components into a testable, single-responsibility
unit.

---

## Steps

**Step 0 — Call `pattern-finder` for the nearest existing hook.**

Run `/pattern-finder new [type] hook named [hookName]`. Imitate the matched
hook's TanStack Query key structure, error/loading state shape, and whether
mutations optimistically update the cache — these are conventions Step 1's
`queryKeys.ts` read alone won't reveal.

**Step 1 — Read context.**

**Step 2 — Generate by type.**

---

**Type: `query`**

```tsx
// src/features/[feature]/hooks/use[ResourceName].ts
import { useQuery } from '@tanstack/react-query';
import { get[ResourceName] } from '@/api/[resource]';
import { QUERY_KEYS } from '@/api/queryKeys';
import type { [ResourceName], [ParamsType] } from '@/types/api';

export interface Use[ResourceName]Options {
  params: [ParamsType];
  enabled?: boolean;
}

export interface Use[ResourceName]Result {
  data: [ResourceName] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

export function use[ResourceName]({ params, enabled = true }: Use[ResourceName]Options): Use[ResourceName]Result {
  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: QUERY_KEYS.[resource].detail(params.[id]),
    queryFn: ({ signal }) => get[ResourceName](params, { signal }),
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000,   // 10 minutes
  });

  return { data, isLoading, isFetching, isError, error: error as Error | null, refetch };
}
```

---

**Type: `mutation`**

```tsx
// src/features/[feature]/hooks/use[Create/Update/Delete][Resource].ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { [create/update/delete][Resource] } from '@/api/[resource]';
import { QUERY_KEYS } from '@/api/queryKeys';
import type { [Request]Request, [Response]Response } from '@/types/api';

export interface Use[Action][Resource]Result {
  mutate: (data: [Request]Request) => void;
  mutateAsync: (data: [Request]Request) => Promise<[Response]Response>;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  isSuccess: boolean;
}

export function use[Action][Resource](): Use[Action][Resource]Result {
  const queryClient = useQueryClient();

  const { mutate, mutateAsync, isPending, isError, error, isSuccess } = useMutation<
    [Response]Response,
    Error,
    [Request]Request
  >({
    mutationFn: [action][Resource],

    // Optimistic update (remove if not needed)
    onMutate: async (newData) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.[resource].all });
      const previous = queryClient.getQueryData(QUERY_KEYS.[resource].all);
      queryClient.setQueryData(QUERY_KEYS.[resource].all, (old: [ResourceName][] | undefined) => [
        ...(old ?? []),
        { ...newData, id: 'optimistic-' + Date.now() },
      ]);
      return { previous };
    },

    onError: (_err, _newData, context) => {
      // Roll back optimistic update on error
      if (context?.previous) {
        queryClient.setQueryData(QUERY_KEYS.[resource].all, context.previous);
      }
    },

    onSuccess: () => {
      // Invalidate and refetch after confirmed success
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.[resource].all });
    },
  });

  return { mutate, mutateAsync, isPending, isError, error: error as Error | null, isSuccess };
}
```

---

**Type: `form`**

```tsx
export function use[FormName]Form(initialValues?: Partial<[FormName]Values>) {
  const form = useForm<[FormName]Values>({
    resolver: zodResolver([FormName]Schema),
    defaultValues: initialValues ?? { /* defaults */ },
    mode: 'onBlur',
  });

  const mutation = use[Create][Resource]();

  const onSubmit = form.handleSubmit(async (values) => {
    await mutation.mutateAsync(values);
  });

  return {
    form,
    onSubmit,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    submitError: mutation.error,
  };
}
```

---

**Type: `local`**

```tsx
export interface [Feature]State {
  selectedId: string | null;
  isExpanded: boolean;
  searchQuery: string;
}

type [Feature]Action =
  | { type: 'SELECT'; id: string }
  | { type: 'DESELECT' }
  | { type: 'TOGGLE_EXPAND' }
  | { type: 'SEARCH'; query: string };

function [feature]Reducer(state: [Feature]State, action: [Feature]Action): [Feature]State {
  switch (action.type) {
    case 'SELECT': return { ...state, selectedId: action.id };
    case 'DESELECT': return { ...state, selectedId: null };
    case 'TOGGLE_EXPAND': return { ...state, isExpanded: !state.isExpanded };
    case 'SEARCH': return { ...state, searchQuery: action.query };
  }
}

export function use[Feature]() {
  const [state, dispatch] = useReducer([feature]Reducer, {
    selectedId: null, isExpanded: false, searchQuery: '',
  });

  const select = useCallback((id: string) => dispatch({ type: 'SELECT', id }), []);
  const deselect = useCallback(() => dispatch({ type: 'DESELECT' }), []);
  const toggleExpand = useCallback(() => dispatch({ type: 'TOGGLE_EXPAND' }), []);
  const setSearch = useCallback((query: string) => dispatch({ type: 'SEARCH', query }), []);

  return { ...state, select, deselect, toggleExpand, setSearch };
}
```

**Step 3 — Update `src/api/queryKeys.ts`.**

Add the new resource key pattern if not already present:

```typescript
export const QUERY_KEYS = {
  // ... existing keys ...
  [resource]: {
    all: ['[resource]'] as const,
    lists: () => [...QUERY_KEYS.[resource].all, 'list'] as const,
    list: (filters: unknown) => [...QUERY_KEYS.[resource].lists(), { filters }] as const,
    details: () => [...QUERY_KEYS.[resource].all, 'detail'] as const,
    detail: (id: string) => [...QUERY_KEYS.[resource].details(), id] as const,
  },
};
```

**Step 4 — Generate test stub.**

Output: `src/features/[feature]/hooks/__tests__/[hookName].test.ts`

```tsx
import { renderHook, waitFor } from '@testing-library/react';
import { createWrapper } from '@/test-utils/queryWrapper';
import { server } from '@/mocks/server';
import { http, HttpResponse } from 'msw';
import { [hookName] } from '../[hookName]';

describe('[hookName]', () => {
  it('returns data on success', async () => {
    const { result } = renderHook(() => [hookName]({ params: { id: 'test-id' } }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBeDefined();
    expect(result.current.isError).toBe(false);
  });

  it('returns error on API failure', async () => {
    server.use(http.get('/api/v1/[resource]/*', () => HttpResponse.error()));

    const { result } = renderHook(() => [hookName]({ params: { id: 'bad-id' } }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

---

## Output

- New: hook file at the correct `hooks/` location
- Updated: `src/api/queryKeys.ts` (new QUERY_KEYS entry added)
- New: `hooks/__tests__/[hookName].test.ts` stub with MSW setup
