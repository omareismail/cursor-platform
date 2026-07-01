# Skill: react-component-gen

**Invocation:** `/react-component-gen [ComponentName] [type]`
Types: `ui` (pure/stateless) | `feature` (with data) | `page` (route-level) | `form`

---

## Overview

**Memory references:** `memory-bank/frontendConventions.md`

`react-component-gen` generates a complete, production-ready React component file
for the specified type, including the TypeScript props interface, Tailwind CSS classes,
accessibility attributes, a corresponding test stub, and a Storybook stories stub
(when Storybook is detected in `package.json`). Every generated component follows the
architecture rules in `03-react-architecture-guard.mdc`: no API calls in UI components,
all loading/error/empty states handled in feature components, and no inline styles.
The component is immediately runnable — no placeholders left to fill.

---

## Steps

**Step 0 — Call `pattern-finder` for the nearest existing component.**

Run `/pattern-finder new [type] component named [ComponentName]`. Imitate
the matched component's prop-typing style, Tailwind/shadcn composition
pattern, and where it draws the line between presentational logic and a
paired hook — Step 1's memory-bank read gives the rule, this gives the
concrete shape.

**Step 1 — Read context.**

**Step 2 — Generate by type.**

---

**Type: `ui` (pure, stateless, reusable)**

Output location: `src/components/[ComponentName]/[ComponentName].tsx`

```tsx
import type { ReactNode } from 'react';

export interface [ComponentName]Props {
  /** [describe prop] */
  label: string;
  /** [describe prop] */
  variant?: 'primary' | 'secondary' | 'danger';
  /** [describe prop] */
  disabled?: boolean;
  /** [describe prop] */
  onClick?: () => void;
  children?: ReactNode;
}

export function [ComponentName]({
  label,
  variant = 'primary',
  disabled = false,
  onClick,
  children,
}: [ComponentName]Props) {
  const variantClasses: Record<NonNullable<[ComponentName]Props['variant']>, string> = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700',
    secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      className={`
        inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium
        transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
        disabled:pointer-events-none disabled:opacity-50
        ${variantClasses[variant]}
      `}
    >
      {children ?? label}
    </button>
  );
}

[ComponentName].displayName = '[ComponentName]';
```

---

**Type: `feature` (with data, React Query integration)**

Output location: `src/features/[feature-name]/components/[ComponentName].tsx`

```tsx
import { use[Resource] } from '../hooks/use[Resource]';
import { [ComponentName]Skeleton } from './[ComponentName]Skeleton';
import { EmptyState } from '@/components/EmptyState';
import { ErrorMessage } from '@/components/ErrorMessage';

export interface [ComponentName]Props {
  [resourceId]: string;
  className?: string;
}

export function [ComponentName]({ [resourceId], className }: [ComponentName]Props) {
  const { data, isLoading, isError, error } = use[Resource]({ [resourceId] });

  if (isLoading) return <[ComponentName]Skeleton />;

  if (isError) {
    return <ErrorMessage message={error?.message ?? 'Failed to load [resource].'} />;
  }

  if (!data) {
    return <EmptyState message="No [resource] found." />;
  }

  return (
    <div className={`[base-classes] ${className ?? ''}`}>
      {/* [Component content using data] */}
    </div>
  );
}

[ComponentName].displayName = '[ComponentName]';
```

---

**Type: `page` (route-level)**

Output location: `src/pages/[PageName]/[PageName].tsx`

```tsx
import { useParams } from 'react-router-dom'; // or Next.js useRouter
import { [FeatureComponent] } from '@/features/[feature]/components/[FeatureComponent]';

export function [PageName]Page() {
  const { [paramName] } = useParams<{ [paramName]: string }>();

  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold text-gray-900">[Page Title]</h1>
      <[FeatureComponent] [paramProp]={[paramName]!} className="mt-6" />
    </main>
  );
}
```

---

**Type: `form`**

Output location: `src/features/[feature]/components/[FormName].tsx`

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { use[Create/Update]Mutation } from '../hooks/use[Resource]';

const [FormName]Schema = z.object({
  name: z.string().min(1, 'Name is required').max(200, 'Name must be under 200 characters'),
  // [other fields from spec]
});

type [FormName]Values = z.infer<typeof [FormName]Schema>;

export interface [FormName]Props {
  onSuccess?: (id: string) => void;
  onCancel?: () => void;
}

export function [FormName]({ onSuccess, onCancel }: [FormName]Props) {
  const mutation = use[Create]Mutation();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<[FormName]Values>({ resolver: zodResolver([FormName]Schema) });

  const onSubmit = async (values: [FormName]Values) => {
    const result = await mutation.mutateAsync(values);
    onSuccess?.(result.id);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700">
          Name
        </label>
        <input
          id="name"
          type="text"
          {...register('name')}
          aria-describedby={errors.name ? 'name-error' : undefined}
          aria-invalid={!!errors.name}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
        />
        {errors.name && (
          <p id="name-error" role="alert" className="mt-1 text-sm text-red-600">
            {errors.name.message}
          </p>
        )}
      </div>

      <div className="flex justify-end gap-3">
        {onCancel && (
          <button type="button" onClick={onCancel} className="[secondary-classes]">
            Cancel
          </button>
        )}
        <button type="submit" disabled={isSubmitting} className="[primary-classes]">
          {isSubmitting ? 'Saving...' : 'Save'}
        </button>
      </div>

      {mutation.isError && (
        <p role="alert" className="text-sm text-red-600">
          {mutation.error?.message ?? 'An error occurred. Please try again.'}
        </p>
      )}
    </form>
  );
}
```

**Step 3 — Generate test stub.**

Output: `src/[path]/__tests__/[ComponentName].test.tsx`

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { [ComponentName] } from '../[ComponentName]';

describe('[ComponentName]', () => {
  it('renders without crashing', () => {
    render(<[ComponentName] [requiredProps] />);
    expect(screen.getByRole('...')).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<[ComponentName] [requiredProps] />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  // [Add test per variant/interaction based on component type]
});
```

**Step 4 — Generate Storybook stub (if Storybook detected).**

Output: `src/[path]/[ComponentName].stories.tsx`

---

## Output

- New: component file at the correct location for its type
- New: `__tests__/[ComponentName].test.tsx` stub
- New: `[ComponentName].stories.tsx` stub (if Storybook detected in package.json)
