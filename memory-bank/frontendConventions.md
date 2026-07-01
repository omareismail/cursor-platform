# Frontend Conventions
**Last Updated:** [YYYY-MM-DD]

## Component structure
One component per file. Order within file: types/interfaces → component → (no
default export unless it's a route-level page component).

## Data fetching
All server data goes through TanStack Query via a feature-owned `api/` fetcher — no
`fetch()`/`axios` calls inside components or even inside hooks directly; the fetcher
is the single seam that `react-api-layer-gen` regenerates when the backend contract
changes.

## State decision tree
1. Does another component need it? No → `useState` locally.
2. Is it server data? → TanStack Query, not client state at all.
3. Is it shared client-only state (UI mode, selected filters across routes)? → Zustand
   slice in `src/store/`.
4. Is it form state? → React Hook Form, not Zustand/useState.

## i18n / RTL
Every user-facing string goes through the i18n layer — no hardcoded strings in JSX,
including inside `aria-label`/`title`/`placeholder`. Layout uses logical CSS
properties (`margin-inline-start`, not `margin-left`) so RTL (Arabic) works without a
parallel stylesheet — enforced by `react-i18n-rtl-gen` and `react-clean-code-guard`.

## Accessibility baseline
Every interactive element is keyboard-reachable and has an accessible name. Color is
never the only signal (status badges pair color with text/icon).

## Performance defaults
- Route-level code splitting via `React.lazy` for every top-level route.
- Lists over ~100 rows: virtualize (`@tanstack/react-virtual`) rather than paginate
  client-side rendering, even if the API itself paginates.
