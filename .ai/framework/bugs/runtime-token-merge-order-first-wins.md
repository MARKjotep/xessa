# Xessa runtime-token merge order: the first merged module wins and duplicate properties raise XESSA2001

**Summary:** `SPECIFICATION.md` §6.2 and §6.3 require duplicate runtime custom-property names across a merged build to resolve **later in merge order** (entry last) and to produce **no conflict diagnostic**. 0.1.1 instead emits the **first** style-imported module's value and reports `XESSA2001` "Ambiguous unqualified import" at the second `@use` even when no `$name` reference exists. A theme composed from two token modules therefore keeps the wrong value and fails the build on a construct the spec declares legal.

**Framework:** xessa

**Severity:** Medium — a merged theme silently uses the first module's value, and a spec-legal duplicate property is a compile error. Works around with one token owner or an entry-level override.

**Affected API:** Runtime-token merge. `node_modules/@xessa/compiler/dist/resolver/scopes.js:84-126` keeps only the first unqualified provider and reports ambiguity; `node_modules/@xessa/compiler/dist/variables/runtime.js:48-64` assigns merge ranks but `runtime.js:103-108` never sees the second provider because `runtime.js:111-113` seeds emission from the entry scope only.

**Framework version:** 0.1.1 — verified 2026-11-27 from installed `node_modules/@xessa/compiler/package.json` (`"version": "0.1.1"`) and the resolved lockfile `bun.lock` (`"@xessa/compiler": ["@xessa/compiler@0.1.1", …]`).

## Reproduction

`tests/features/xessa-compiler.test.ts` → **"two style-imported modules with one runtime property keep the first value and report ambiguity"**:

```xessa
// src/one.cssx
@runtime { x: red; }

// src/two.cssx
@runtime { x: green; }

// src/entry.cssx
@use "./one.cssx" styles;
@use "./two.cssx" styles;
.card { color: red; }
```

## Expected

Per `SPECIFICATION.md` §6.2 (Merge-order override, lines 489-507) and §6.3 (lines 541-546):

- the later definition in merge order wins — `:root{--x:green;}` for two style modules in authored order;
- one resolved `--x` declaration is emitted;
- no conflict diagnostic for the duplicate property;
- unqualified `$x` ambiguity remains a separate symbol-resolution concern only when `$x` is actually referenced.

## Actual

- CSS: `:root{--x:red;}.card{color:red;}` — the **first** module's value is emitted.
- Diagnostics: one `XESSA2001/error` at the second `@use` ("Ambiguous unqualified import … \"$x\" is exported by \"src/one.cssx\" (runtime), \"src/two.cssx\" (runtime)"), with no `$x` reference in the entry.
- Reversing the imports reverses the winner (`red` ↔ `green`), confirming first-provider-wins rather than merge-order-wins.
- An entry-level `@runtime { x: blue; }` does override a single imported module and produces no diagnostic; that narrower case passes in **"the entry's runtime definition overrides an imported property without a diagnostic"**.

## Evidence

- `node_modules/@xessa/compiler/dist/resolver/scopes.js:84-126`: `resolveUnqualified` stores the first provider, then pushes the conflicting provider and reports `XESSA2001`; the winning table keeps only `first.definition`.
- `node_modules/@xessa/compiler/dist/variables/runtime.js:111-113`: all-declaration emission starts from `entry.runtimeScope.tokens.values()`, i.e. only the retained first provider; `runtime.js:115-136` adds reference-driven tokens only.
- `node_modules/@xessa/compiler/dist/variables/runtime.js:103-108`: the `rank > existing.rank` later-wins branch is reachable for the entry but never for a discarded second provider.
- Test evidence: `tests/features/xessa-compiler.test.ts` — the repro (first-wins + `XESSA2001`) and the entry-override case (blue, no diagnostic).
- Framework version and pinning as above; no Xessa packages or upstream sources were modified.

## Workaround

Keep one module as the owner of each runtime property and have other modules reference it, or override the value in the entry's own `@runtime` block (entry rank wins and emits no diagnostic). For shared portable palettes the app uses native `:root`/dark `@media` tokens, which are not subject to this resolution path (`portable-runtime-token-prefix.md`, `namespaced-runtime-token-emission.md`). Avoid declaring the same property in two `styles` modules until upstream fixes merge order.

## Status

**Open upstream** (bug). Not blocking the committed app: its portable palettes are native tokens and no entry declares one runtime property through two style modules. Related feature records: `portable-runtime-token-prefix.md`, `namespaced-runtime-token-emission.md`, `style-import-merge-order.md`. Suite: `tests/features/xessa-compiler.test.ts`; inventory: `tests/TESTING-INVENTORY.md` §3.

## Triage decision (2026-11-27)

**Confirmed spec bug (unqualified `styles` imports).** `SPECIFICATION.md` §6.2/§6.3 and ADR-0016 require later-in-merge-order wins with no conflict diagnostic. Current `resolveUnqualified` reports XESSA2001 for any duplicate unqualified provider and keeps the first; existing repo tests cover namespaced imports only. Add a repo-local regression fixture first, then fix. Not a rename blocker. **Decision: fix next; do not change behavior in this task.**
