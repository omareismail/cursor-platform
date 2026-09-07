---
name: ux-design-bridge
description: "ux-design-bridge is the contract between the design tool and the codebase: a screen inventory where every screen names the endpoints it calls, the states it must render, and its RTL and bilingual treatment, plus the design tokens phase 4 generates components from. It does not design anything — Figma does that, and this platform should never try to replace it. Invoked as /ux-design-bridge."
---

<!-- GENERATED from the cursor-platform source skill "ux-design-bridge".
     Do not edit here - edit the source and re-run the plugin build. -->

# Skill: ux-design-bridge

**Invocation:** `/ux-design-bridge`

---

## Overview

`ux-design-bridge` is the contract between the design tool and the codebase: a
screen inventory where every screen names the endpoints it calls, the states it
must render, and its RTL and bilingual treatment, plus the design tokens phase 4
generates components from. It does not design anything — Figma does that, and
this platform should never try to replace it. What it does is refuse to let a
design cross into implementation as a picture. A Figma link with no contract
leaves phase 4 inventing loading states, error copy and empty states one
component at a time, which is where inconsistent UIs come from.

---

## Steps

**Step 1 — Read the inputs.**

`docs/product/story-map.md` (journeys and personas), `docs/analysis/use-cases.md`,
`docs/design/api-design.md`, `docs/product/personas.md` (device, language,
frequency — these decide the interaction model).

**Step 2 — Derive the screen list from the journeys, not from the Figma file.**

Each journey step needs at least one screen. A screen in Figma with no journey
step is either an unrecorded requirement or scope creep — flag it either way.

**Step 3 — Pull structured design context where the Figma MCP server is available.**

If the Figma MCP server is connected, read variables, components and layout
through it rather than describing screenshots. It returns structure — token
names, component names, spacing values — which is what phase 4 can actually
generate from. Check `.mcp.json` for the server; if it is absent, say so and
continue from the design file's exported tokens instead of guessing.

**Step 4 — Specify every state. All of them.**

For each screen: loading, empty, partial, error, unauthorised, and success. The
error state names the API errors from `api-design.md` that produce it and the
message the user sees, in both languages where the product is bilingual.

This is the section that saves the most phase 4 time, and the one most often
skipped.

**Step 5 — Make RTL a requirement, not a note.**

Per screen: which elements mirror, which do not (numbers, phone numbers, code,
logos), how dates and currency are formatted per locale, and where text expansion
between EN and AR will break the layout. `08-rtl-i18n-guard` enforces logical CSS
properties in phase 4; this decides what they should express.

**Step 6 — Record the tokens.**

Colour, type scale, spacing, radius, elevation, breakpoints — as names and
values, in the shape phase 4's `/react-component-gen` can consume. Name them
semantically (`surface-raised`, not `grey-200`); a token named after its value
cannot be re-themed.

**Step 7 — Write the files.**

`docs/design/ux/screen-inventory.md`:

```markdown
### SC-04 — Issue policy
**Journey step:** Underwrite   **Use cases:** UC-04   **Persona:** Underwriter
**Endpoints:** EP-07 (POST /api/v1/policies), EP-03 (GET /api/v1/applications/{id})
**Figma:** <node link>

| State | Trigger | Renders |
|---|---|---|
| Loading | Initial fetch | Skeleton, action disabled |
| Error 409 | Payment pending | Inline banner citing BR-11, retry disabled |

**RTL:** Table columns mirror; PolicyNumber stays LTR; amounts right-aligned
in both directions.
**Accessibility:** Keyboard-only path required (persona works at speed).
```

`docs/design/ux/design-tokens.md` — the token tables from Step 6.

**Step 8 — Check coverage both ways.**

Every journey step has a screen; every screen names at least one endpoint that
exists in `api-design.md`. Report both — Gate 3 criterion 7.

---

## Front-matter — required on every document this skill writes

Open each file with this block. It is the machine-readable half of a
human-written document: the prose stays prose, and `artifact-schema.mjs` reads
this to know what the document is and where it sits in the chain.

```yaml
---
type: screen-inventory
phase: DESIGN
defines: [SC]
traces: [<repo-relative paths of the documents this was derived from>]
owner: ux-bridge
---
```

`defines` names the ID prefixes this document **owns**. It is what stops the
first cell of a traceability table being mistaken for a second definition — a
citation of `S-1` in a use-case table is a reference, not a redeclaration.

Validate before reporting done:

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/artifact-schema.mjs validate
node ${CLAUDE_PLUGIN_ROOT}/tools/artifact-schema.mjs check
```

`check` fails on an ID cited but never defined, and on a chain that stops — a
requirement no story implements, a story no use case covers, a use case no
endpoint serves. Those are gate criteria, computed rather than judged, and
`lifecycle.mjs check` now fails on them too.

---

## Output

- `docs/design/ux/screen-inventory.md`, `docs/design/ux/design-tokens.md`
- Terminal: journey steps with no screen, screens with no endpoint, screens
  missing a required state, RTL decisions still open

