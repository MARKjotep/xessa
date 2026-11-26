# ADR-0021: Opt-in CSS side-effect import in the generated class map (`import-css`)

## Status

Accepted (2026-11-26) — project owner decision, normative for v0.1. Restores a CSS side-effect
import in the generated class map **as an opt-in only**, after CSSX-A52 removed the unconditional
form. Does not amend ADR-0010's map format: named `export const` bindings, no default export, no
object literal.

Related: SPECIFICATION.md §8, §9; ADR-0010, ADR-0014, ADR-0019; CSSX-A52, CSSX-F21;
`.ai/reports/CSSX-F21.md`

## Context

CSSX-A52 changed the map to named const exports and asked whether the CSS side-effect import should
stay. The owner's follow-up removed it outright: the map became plain-Node importable, with no
loader needed, and no configuration flag existed. Loading the stylesheet became the page's or the
bundler entry's responsibility (`<link>` or an explicit `import "./x.css"`).

That default is right for a static page, a test or a Node script. It is inconvenient for the
opposite consumer: a bundler-driven application (Vite, Rspack, a Next-style compiler) that already
carries CSS through JavaScript imports. There, the natural expression is that importing the class
map also brings the component's styles along, so one import per component module is enough. Asking
every such consumer to repeat the stylesheet path by hand is error-prone, because the map's author
already knows the emitted CSS destination — including a `css-dir` list (ADR-0019), where only the
build knows which copies exist.

Constraints from the existing design:

- Default output must remain byte-identical: plain-Node consumers must keep their import-free map.
- A map must never contain a dangling import: a build that emits no stylesheet (`emit-css: false`,
  or `module: true` suppressing outputs) has nothing to import.
- The specifier must be deterministic and derived from the actual planned artifacts, not from
  authored settings that the output planner may resolve differently.
- `.d.ts` stays pure declarations; declarations have no side effects to import.
- Precedence must follow the existing chain: defaults < project config < file `@setup`.

## Decision

Add a boolean `@setup` key `import-css` (JSON: `output.importCss`), **default `false`**.

1. **Meaning.** With `@setup { import-css: true; }` and a stylesheet emitted, the generated
   `map.js` starts with exactly one side-effect import:

   ```js
   import "./button.css";
   export const button = "ui-button";
   ```

   The rest of the map is unchanged. With declarations enabled, the `.d.ts` still contains only
   `export declare const` lines.
2. **Specifier.** The import names the path from the **map file's directory** to the **emitted
   stylesheet**, POSIX separators, always `./`-prefixed when the stylesheet is in or below that
   directory (`./button.css`, `./generated/styles/app.css`) and left with authored `..` segments
   when it is above it (`../styles/button.css`). It is computed from the planned artifacts.
3. **`css-dir` lists.** When a file authors several CSS destinations (ADR-0019), the **first-listed
   destination is canonical** and is the one the import names. Every copy is still written; the map
   imports the first.
4. **Suppression.** If the build emits no stylesheet — `emit-css: false`, or `module: true` without a
   restored `emit-css` — the import is omitted entirely. A map is never generated with an import
   that points at an artifact the plan does not contain.
5. **Precedence.** Defaults < project configuration (`output.importCss`) < the file's own `@setup`
   value. Explicit API output fields passed to `compile()` are overrides and win there;
   `compileProject()`'s `options.output` is the project layer, so a file value wins over it.
6. **Editor.** `import-css` completes as a `@setup` key with `true`/`false` values (ADR-0021), like
   the other boolean keys.

## Rejected alternatives

- **Restore the unconditional import (pre-A52 behaviour).** Rejected: it makes every map depend on a
  CSS loader, breaks plain-Node imports and turns a static page's map into an accidental stylesheet
  loader. The owner explicitly moved away from it.
- **Importer-side guidance only (document `import "./x.css"` next to the map, no setting).**
  Rejected as the sole path: it works for one hand-written entry but cannot follow `css-dir` lists or
  project-level output directories without duplicating the build's destination logic by hand. The
  opt-in gives bundler consumers one import while leaving the default alone.
- **Import every `css-dir` list destination.** Rejected: importing the same stylesheet twice from
  different paths would duplicate rules in the bundle and make ordering depend on the list. One
  canonical destination (the first) keeps the emitted module deterministic.
- **A dangling import when CSS emission is disabled.** Rejected: the file would not exist; a build
  error or a silent broken import both violate the "never emit a dangling import" rule.

## Consequences

- Plain-Node and static-page consumers see no change: maps stay import-free by default, byte-for-byte.
- Bundler-driven consumers opt in once per project (`output.importCss: true`) or per file and get one
  import at the top of each map, pointing at the actual emitted stylesheet (first destination for a
  list).
- The map remains a single deterministic text artifact; the import is part of that text, so manifests,
  writers and watch rebuilds need no new artifact kind.
- Documents that disable CSS but still emit a map keep a clean, import-free map.
- The setting is a boolean with no grammar cost; `css-dir` list semantics stay owned by ADR-0019.
