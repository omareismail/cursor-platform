---
name: persona-gen
description: "Runs the persona-gen workflow. Invoked as /persona-gen."
---

<!-- GENERATED from the cursor-platform source skill "persona-gen".
     Do not edit here - edit the source and re-run the plugin build. -->

# Skill: persona-gen

**Invocation:** `/persona-gen`

---

## Overview

**Memory references:** `memory-bank/productContext.md, memory-bank/glossary.md`

`persona-gen` converts the actor list in the product brief into working personas
— each with the job they are trying to get done, the context they work in, and
the thing that would make them abandon the product. It exists because "the user"
is not a design input: a broker entering fifty quotes an hour on a desktop and a
policyholder checking one policy on a phone in Arabic want opposite things, and
a design that averages them serves neither. Every persona here must be traceable
to an actor in `docs/product/brief.md`; inventing a new one is a scope change.

---

## Steps

**Step 1 — Read `docs/product/brief.md`.**

If it does not exist, stop and run `/product-brief` first.

**Step 2 — One persona per actor. No composites.**

A persona that merges two actors hides the conflict between them, which is
exactly the information phase 3 needs.

**Step 3 — Ground each persona in observable behaviour, not demography.**

Age and job title predict nothing. Frequency of use, device, environment,
tolerance for error, and what they do when the system is slow predict everything.

**Step 4 — Write `docs/product/personas.md`.**

```markdown
# Personas

## <Name> — <role in the domain>

**Job to be done:** <the outcome they want, stated without reference to software>

| | |
|---|---|
| Frequency | <many times a day / weekly / once a year> |
| Device and context | <desktop at a desk / phone in a car / shared terminal> |
| Language | <EN / AR / both — and which they prefer under pressure> |
| Expertise | <domain expert / occasional / first time> |
| Tolerance for error | <what a mistake costs them> |

**A good day:** <what happens when the product works>
**What makes them quit:** <the specific failure that loses them>
**What they will never do:** <read documentation, wait 30s, use a mouse...>

**Design consequences**
- <A concrete implication for phase 3. "Needs keyboard-only entry with no
  mouse round-trip" — not "values efficiency".>
```

**Step 5 — Extract the vocabulary.**

Collect the domain nouns each persona uses, EN and AR where the product is
bilingual. This feeds `memory-bank/glossary.md` at the Gate 2 promotion and
stops phase 4 from translating the same term three different ways.

**Step 6 — Flag the conflicts.**

End with a section naming every place two personas want incompatible things.
Do not resolve them — that is a phase 3 decision and it needs `/speckit-options`.
Naming them here is what stops phase 3 resolving them by accident.

---

## Front-matter — required on every document this skill writes

Open each file with this block. It is the machine-readable half of a
human-written document: the prose stays prose, and `artifact-schema.mjs` reads
this to know what the document is and where it sits in the chain.

```yaml
---
type: personas
phase: REQUIREMENTS
traces: [<repo-relative paths of the documents this was derived from>]
owner: product-manager
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

- `docs/product/personas.md`
- Terminal: the persona-conflict list, and the EN/AR terms collected

