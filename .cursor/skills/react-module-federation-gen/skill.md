# Skill: react-module-federation-gen

**Invocation:** `/react-module-federation-gen [remote-or-host] [name]`
First arg: `remote` (exposes modules) or `host` (consumes remotes)

---

## Overview

**Memory references:** `memory-bank/architecture.md`

`react-module-federation-gen` scaffolds Module Federation configuration for a
micro-frontend remote or host. It is only invoked after the project has explicitly
opted into a micro-frontend architecture — this decision must be confirmed via
`/speckit-options` if it is not already recorded in `memory-bank/systemPatterns.md`,
because the operational complexity of MFE is significant and must be a deliberate
choice. This skill generates the Vite plugin config (or webpack config), a shared-
dependency version-alignment check, and a fallback/error boundary for remote-load failure.

---

## Steps

**Step 0 — Call `pattern-finder` for the nearest existing remote/host, if MFE
is already adopted.**

If `repo-map.json` shows existing Module Federation remotes/hosts, run
`/pattern-finder new MFE remote for [name]` and imitate the matched
module's shared-dependency configuration and exposed-module naming before
Step 1's elicitation. If this is the first MFE module in the repo, skip to
Step 1 — there's nothing to imitate yet.

**Step 1 — Confirm MFE architecture is opted in.**

Read `memory-bank/systemPatterns.md` for a `## Micro-Frontend Architecture` section.
If not found, run `/speckit-options` with:

```
Q: Should this project use Module Federation for micro-frontend decomposition?

Option A — Single SPA (current / default):
  One React app, one deployment. Simplest operational model.
  Trade-off: Fast development | All teams share one release train

Option B — Module Federation (runtime integration):
  Teams deploy independently; host app loads remotes at runtime.
  Trade-off: Team autonomy | Significant operational complexity; shared dependency versioning

Option C — Build-time composition (npm packages):
  Shared components published as versioned npm packages.
  Trade-off: Clean contracts | Requires coordinated package releases

Recommended: Option A unless the team has > 4 squads working independently
on this frontend.
```

If user chooses Option B, record in `systemPatterns.md` before proceeding.

**Step 2 — Generate the Vite config (remote).**

```typescript
// vite.config.ts — REMOTE APP
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from '@originjs/vite-plugin-federation';

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: '[remote-name]',
      filename: 'remoteEntry.js',
      exposes: {
        './[ComponentName]': './src/features/[feature]/components/[ComponentName]',
        './[HookName]': './src/features/[feature]/hooks/[HookName]',
      },
      shared: {
        react: { singleton: true, requiredVersion: '^18.0.0' },
        'react-dom': { singleton: true, requiredVersion: '^18.0.0' },
        '@tanstack/react-query': { singleton: true, requiredVersion: '^5.0.0' },
      },
    }),
  ],
  build: {
    modulePreload: false,
    target: 'esnext',
    minify: false,
    cssCodeSplit: false,
  },
});
```

**Step 3 — Generate the Vite config (host).**

```typescript
// vite.config.ts — HOST APP
federation({
  name: 'host',
  remotes: {
    '[remote-name]': '[remote-url]/assets/remoteEntry.js',
    // Use environment variables in production:
    // '[remote-name]': process.env.VITE_[REMOTE]_URL + '/assets/remoteEntry.js',
  },
  shared: {
    react: { singleton: true },
    'react-dom': { singleton: true },
    '@tanstack/react-query': { singleton: true },
  },
}),
```

**Step 4 — Generate shared-dependency version check script.**

```typescript
// scripts/check-federation-deps.ts
// Run in CI to catch version mismatches between host and remotes
const REQUIRED_SHARED_VERSIONS = {
  react: '18.x',
  'react-dom': '18.x',
  '@tanstack/react-query': '5.x',
};
// [reads each remote's package.json from build artifacts and asserts versions match]
```

**Step 5 — Generate fallback error boundary for remote failures.**

```tsx
// src/components/RemoteFallback/RemoteFallback.tsx
import { Component, type ReactNode, type ErrorInfo } from 'react';

interface RemoteFallbackProps {
  remoteName: string;
  children: ReactNode;
  fallback?: ReactNode;
}

export class RemoteFallback extends Component<RemoteFallbackProps, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() { return { hasError: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[RemoteFallback] Failed to load remote "${this.props.remoteName}":`, error, info);
    // Report to observability (Serilog/AppInsights)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div role="alert" className="p-4 text-sm text-red-600 bg-red-50 rounded-md">
          This section is temporarily unavailable. Please refresh the page.
        </div>
      );
    }
    return this.props.children;
  }
}

// Usage:
// <RemoteFallback remoteName="[remote-name]">
//   <React.Suspense fallback={<Skeleton />}>
//     <LazyRemoteComponent />
//   </React.Suspense>
// </RemoteFallback>
```

---

## Example Invocation

**Command:** `/react-module-federation-gen remote broker-portal`

Agent checks systemPatterns.md → finds MFE architecture confirmed → generates
remote Vite config exposing `BrokerDashboard` and `useBrokerData`, shared deps
singleton config, version check script, and `RemoteFallback` error boundary.

---

## Output

- Updated: `vite.config.ts` (remote or host federation block added)
- New: `scripts/check-federation-deps.ts`
- New: `src/components/RemoteFallback/RemoteFallback.tsx`
- Updated: `memory-bank/systemPatterns.md` (MFE architecture section, if new decision)
