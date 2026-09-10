# Contributing

Supported runtime: **Node.js 22+** (CI uses 22; syntax also checks 24).
Git and a POSIX or PowerShell shell.

```
node tests/run.mjs
node .cursor/tools/self-audit.mjs run
node .cursor/tools/self-audit.mjs integrity
```

Do not run `integrity --write` from an agent. A human attests after reviewing
enforcement-surface changes.

Installation modes: checkout copy (`.cursor/tools` present) or plugin install
(hooks and tools as siblings). See `.cursor/docs/NEW-PROJECT.md` and
`.cursor/docs/APPLY-TO-PROJECT.md`. English and Arabic handbooks must stay
aligned: `HANDBOOK.md` / `HANDBOOK.ar.md`.
