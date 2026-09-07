# cursor-platform — installed plugin

**Generated.** Built from the platform repo by `.cursor/tools/build-plugin.mjs`.
Do not edit anything here; edit the source and rebuild.

Installs in **both** hosts from one tree - the layout below is what each expects
by default, so only the manifests differ:

| | Manifest | Hooks | MCP |
|---|---|---|---|
| Claude Code | `.claude-plugin/plugin.json` | `hooks/hooks.json` | `.mcp.json` |
| Cursor | `.cursor-plugin/plugin.json` | `hooks/cursor-hooks.json` | `mcp.json` |

It is a Cursor Plugin, not an Agent Plugin: an Agent Plugin carries only skills
and MCP servers, so the rules, agents and hooks would not travel.

> Known limitation: prose inside skills and rules refers to CLAUDE_PLUGIN_ROOT,
> which Cursor does not define. Rules and skills are auto-applied there from the
> manifest, so this affects only the tool command lines a skill may print.

## What this plugin ships

| | Count |
|---|---|
| Skills | 97 |
| Rules | 12 |
| Subagents | 14 |
| Hooks | 7 + wiring |
| Validators | 12 |
| Reference docs | 7 |

## What it deliberately does NOT ship

**`memory-bank/`.** That is your project's own truth — architecture, coding
standards, business rules, glossary. Shipping a generic copy would be worse than
shipping nothing, because every generator reads it and would then imitate
somebody else's conventions.

Create it in your repo from the platform's template and fill in Tier 2 before
generating anything. An hour there is the difference between code that matches
your codebase and code that merely compiles.

**`CLAUDE.md`.** Your repo's entry point, which imports your `AGENTS.md`.

**`templates/`.** The build gates are installed into your solution one at a
time, deliberately — see the platform repo's `templates/README.md`.

## After installing

```
/repo-discovery full
/context-sync
```
