# Skill: react-api-layer-gen

**Invocation:** `/react-api-layer-gen [endpoint-spec]`

---

## Overview

**Memory references:** `memory-bank/apiConventions.md`

`react-api-layer-gen` generates the complete frontend API layer from a backend
endpoint definition in a single pass: TypeScript interfaces in `types/api.ts`,
the fetcher function in `api/`, the React Query hook in `features/[name]/hooks/`,
the MSW mock handler for tests, and the QUERY_KEYS constant entry. This eliminates
the manual work of wiring these four files together and ensures the TypeScript
interface matches the .NET DTO field-for-field, which is the most common source of
runtime type errors in full-stack projects.

---

## Steps

**Step 0 — Call `pattern-finder` for the nearest existing API client function.**

Run `/pattern-finder new API client function for [endpoint]`. Imitate the
matched function's error-normalization pattern (how a failed request becomes
a typed error the UI can branch on), and whether response parsing/validation
uses Zod at the boundary — both vary across older vs. newer parts of a
frontend codebase, so the most-recently-modified match should win unless it's
an outlier (see `pattern-finder` Step 2).

**Step 1 — Parse the endpoint definition.**

Input can be:
1. A spec table row: `POST /api/v1/brokers/{brokerId}/clients/export`
2. A pasted OpenAPI YAML/JSON block
3. A reference to a spec section: `specs/features/[feature-slug].md §API Endpoints row 2`

Extract: method, path, path params, query params, request body schema, response schema, auth.

**Step 2 — Generate TypeScript type definitions.**

Output: additions to `src/types/api.ts`

```typescript
// ── [Resource Name] ──────────────────────────────────────────
export interface [Request]Request {
  [brokerId]: string;
  filters?: [FilterParams];
}

export interface [Response]Response {
  [id]: string;
  [name]: string;
  [createdAt]: string; // ISO 8601 — convert to Date where needed
}

export interface [FilterParams] {
  status?: '[StatusEnum]';
  fromDate?: string;
  toDate?: string;
}
```

**Step 3 — Generate the fetcher function.**

Output: `src/api/[resource].ts` (create or append)

```typescript
import { apiClient } from './client';
import type { [Request]Request, [Response]Response } from '@/types/api';

/**
 * [One-line description of what this API call does]
 * @endpoint [METHOD] [path]
 * @auth [policy name]
 */
export async function [action][Resource](
  params: [Request]Request,
  options?: { signal?: AbortSignal }
): Promise<[Response]Response> {
  const { [brokerId], ...queryParams } = params;
  const { data } = await apiClient.get<[Response]Response>(
    `/v1/brokers/${[brokerId]}/clients/export`,
    { params: queryParams, signal: options?.signal }
  );
  return data;
}
```

**Step 4 — Generate the React Query hook.**

Output: `src/features/[feature]/hooks/use[Action][Resource].ts`

```typescript
import { useQuery } from '@tanstack/react-query'; // or useMutation for mutations
import { [action][Resource] } from '@/api/[resource]';
import { QUERY_KEYS } from '@/api/queryKeys';
import type { [Request]Request, [Response]Response } from '@/types/api';

export function use[Action][Resource](params: [Request]Request, enabled = true) {
  return useQuery<[Response]Response, Error>({
    queryKey: QUERY_KEYS.[resource].[action](params),
    queryFn: ({ signal }) => [action][Resource](params, { signal }),
    enabled,
    staleTime: 2 * 60 * 1000,
  });
}
```

For mutations:
```typescript
export function use[Action][Resource]() {
  const queryClient = useQueryClient();
  return useMutation<[Response]Response, Error, [Request]Request>({
    mutationFn: [action][Resource],
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.[resource].all });
    },
  });
}
```

**Step 5 — Generate the MSW mock handler.**

Output: addition to `src/mocks/handlers/[resource].ts`

```typescript
http.[method]('/api/v1/brokers/:brokerId/clients/export', ({ params, request }) => {
  const url = new URL(request.url);
  const filters = Object.fromEntries(url.searchParams);

  // Return mock data matching the TypeScript interface
  return HttpResponse.json<[Response]Response>({
    [id]: 'mock-[resource]-id',
    [name]: 'Mock [Resource]',
  });
}),
```

**Step 6 — Update QUERY_KEYS.**

Add new key strategy to `src/api/queryKeys.ts`:

```typescript
[resource]: {
  all: ['[resource]'] as const,
  [action]: (params: [Request]Request) =>
    [...QUERY_KEYS.[resource].all, '[action]', params] as const,
},
```

---

## Example Invocation

**Command:** `/react-api-layer-gen "GET /api/v1/brokers/{brokerId}/clients/export?status=&fromDate=&toDate="`

Agent generates:
1. `ExportBrokerClientsRequest` + `ExportBrokerClientsResponse` in `types/api.ts`
2. `exportBrokerClients()` fetcher in `src/api/brokers.ts`
3. `useExportBrokerClients()` hook in `src/features/brokers/hooks/`
4. MSW GET handler in `src/mocks/handlers/brokers.ts`
5. `QUERY_KEYS.brokers.export(params)` in `queryKeys.ts`

---

## Output

- Updated: `src/types/api.ts` (new interfaces appended)
- Updated (or created): `src/api/[resource].ts` (new fetcher function)
- New: `src/features/[feature]/hooks/use[Action][Resource].ts`
- Updated: `src/mocks/handlers/[resource].ts`
- Updated: `src/api/queryKeys.ts`
