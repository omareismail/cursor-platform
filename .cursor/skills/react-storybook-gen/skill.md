# Skill: react-storybook-gen

**Invocation:** `/react-storybook-gen [ComponentName]`

---

## Overview

**Memory references:** `memory-bank/frontendConventions.md`

`react-storybook-gen` generates Storybook stories covering every meaningful prop
and state combination for a component, so visual review is possible without running
the full application. It reads the component's TypeScript props interface to enumerate
variants, and generates one story per significant combination: default, loading, error,
empty, disabled, and RTL where applicable. Required providers (React Query client, theme,
router) are wired in `decorators` automatically. If Chromatic or Loki visual-regression
tooling is detected in `package.json`, stories are tagged for snapshotting.

---

## Steps

**Step 0 — Call `pattern-finder` for the nearest existing story file.**

Run `/pattern-finder new Storybook story for [ComponentName]`. Imitate the
matched story's args/controls setup and which providers it wraps the
component in (Step 2 below) — newer stories in this repo may use a
different Storybook addon convention than older ones.

**Step 1 — Read the component's props interface.**

Locate the `Props` interface in the component file. Enumerate:
- All optional boolean props (each warrants a story variant: `isDisabled`, `isLoading`, etc.)
- All string union props (each value may warrant a story: `variant: 'primary' | 'secondary' | 'danger'`)
- The data shape required for the default/loaded story

**Step 2 — Detect required providers.**

Scan the component's imports for:
- `useQuery` / `useMutation` → add `QueryClientProvider` decorator
- `useTranslation` → add `I18nextProvider` decorator
- `useNavigate` / `Link` → add `MemoryRouter` decorator
- Theme context → add `ThemeProvider` decorator

**Step 3 — Generate stories.**

```tsx
// src/[path]/[ComponentName].stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { [ComponentName] } from './[ComponentName]';
import type { [ComponentName]Props } from './[ComponentName]';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const meta = {
  title: '[Folder]/[ComponentName]',
  component: [ComponentName],
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <div className="p-6 bg-white min-h-screen">
            <Story />
          </div>
        </MemoryRouter>
      </QueryClientProvider>
    ),
  ],
  parameters: {
    layout: 'padded',
    // Chromatic: register for visual regression (remove if not using Chromatic)
    chromatic: { disableSnapshot: false },
  },
  args: {
    // Default args shared across all stories
    [requiredProp]: '[default value]',
  },
} satisfies Meta<typeof [ComponentName]>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Default ──────────────────────────────────────────────────
export const Default: Story = {
  args: {
    // All required props with realistic values
  },
};

// ── Loading ──────────────────────────────────────────────────
export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/[resource]*', async () => {
          await new Promise(() => {}); // Never resolves — keeps component in loading state
        }),
      ],
    },
  },
};

// ── Error ────────────────────────────────────────────────────
export const Error: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/[resource]*', () => HttpResponse.error()),
      ],
    },
  },
};

// ── Empty ────────────────────────────────────────────────────
export const Empty: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/[resource]*', () => HttpResponse.json([])),
      ],
    },
  },
};

// ── Disabled ─────────────────────────────────────────────────
export const Disabled: Story = {
  args: {
    disabled: true,
  },
};

// ── Variant: Secondary ────────────────────────────────────────
export const Secondary: Story = {
  args: {
    variant: 'secondary',
  },
};

// ── RTL (Arabic) ─────────────────────────────────────────────
export const RTL: Story = {
  decorators: [
    (Story) => (
      <div dir="rtl" lang="ar">
        <Story />
      </div>
    ),
  ],
  parameters: {
    chromatic: { viewports: [375, 1280] }, // Test both mobile and desktop in RTL
  },
};
```

**Step 4 — Add `storybook-addon-a11y` configuration (if installed).**

```tsx
parameters: {
  a11y: {
    config: {
      rules: [{ id: 'color-contrast', enabled: true }],
    },
  },
},
```

---

## Example Invocation

**Command:** `/react-storybook-gen BrokerExportButton`

Agent reads `BrokerExportButtonProps` — finds `disabled`, `isExporting`, and no
data state variants. Generates 5 stories: Default, Exporting (loading spinner),
Disabled, Error (mutation failed), RTL. Wires `QueryClientProvider` decorator
(detects `useBrokerExport` in the component). Tags for Chromatic (detected in devDependencies).

---

## Output

- New: `src/[path]/[ComponentName].stories.tsx`
