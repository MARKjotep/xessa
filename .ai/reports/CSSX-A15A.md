# CSSX-A15A — Phase 7: CSS source maps + canonical formatter

## Summary

- Implement CSS source maps (standard v3, in-house VLQ encoder, declaration-level origin mappings) in
  the emitter behind `source-map: true`, with the `/*# sourceMappingURL=… */` comment pointing at the
  actual output basename.
- Implement the canonical xessa formatter in `packages/compiler/src/formatter/` (parse → print,
  idempotent, property-centric, values untouched) and wire `xessa format [file]` with `--check` mode
  (replacing the P7 stub).
- Golden + round-trip tests for both; source-map mappings decoded and asserted.

**Status:** implemented and verified. `bun run verify` exits 0 (569 pass). Pending lead verification of
the `compile()`/barrel wiring handoff below.

## Outcome

- `packages/compiler/src/sourcemaps/` is a zero-dependency standard v3 source-map generator: base64
  VLQ encoding, sorted segment emission with correct per-line generated-column resets and
  document-wide source deltas, deterministic JSON serialization, offset→line/column location and the
  `sourceMappingURL` comment helper.
- `emitCss` accepts an opt-in `sourceMap` option, appends
  `/*# sourceMappingURL=<css basename>.map */`, and returns `map` as v3 JSON text. With `sourceMap`
  unset no marker is inserted, so all 48 existing golden CSS expectations are byte-identical.
- `packages/compiler/src/formatter/` implements pure `format(source, file)`: tokenize + parse, then a
  canonical printer. Any parse error returns the original source untouched plus the diagnostics.
- `xessa format [file]` resolves entries exactly like `xessa check`, writes in place atomically by
  default, supports `--check` (writes nothing, exit 1 when files would change) and keeps exit codes
  0/1/2. The old P7 stub and `FORMAT_UNAVAILABLE_MESSAGE` are gone.

## Created / changed files

Created (compiler):

- `packages/compiler/src/sourcemaps/vlq.ts` — base64 VLQ encoder.
- `packages/compiler/src/sourcemaps/mappings.ts` — `SourceMapping`, `SourceMapV3`,
  `encodeMappings`, `generateSourceMap`, `serializeSourceMap`, `offsetToLineColumn`,
  `sourceMapUrlFor`, `sourceMapComment`.
- `packages/compiler/src/sourcemaps/index.ts` — barrel.
- `packages/compiler/src/formatter/index.ts` — `FormatResult`, `format`, canonical printer and
  comment attachment.

Created (CLI):

- `packages/cli/src/formatter.ts` — formatter module boundary with the same `dist` → `src` fallback
  strategy as `compiler.ts`; the frozen public barrel does not export `format` yet, so this keeps
  the CLI working until the lead's barrel wiring lands.

Created (tests):

- `tests/compiler/sourcemap.test.ts` — independent in-test VLQ decoder; selector/declaration origin
  assertions in pretty and minified modes; URL comment naming; opt-in `sourcesContent`; missing
  source text skipped; maps-off golden stability for all 48 expected CSS files (38 plain asserted
  byte-exact, 10 `$`-ref fixtures deferred as in the golden runner) and the "maps append only the
  comment" invariant for every fixture in both modes.
- `tests/compiler/formatter.test.ts` — idempotence over all 48 fixture inputs; parse-error fallback;
  final newline; directive/conditional/nested/variant/`!important` layout; comment preservation and
  no duplication; compilation invariance for six representative fixtures.
- `tests/integration/format-cli.test.ts` — `--check` exit 1 + no writes, `--check` rejected for
  other commands, JSON report, in-place formatting, idempotent rerun, build-output invariance,
  parse-error no-rewrite exit 1, missing-file exit 2.

Changed:

- `packages/compiler/src/emitter/index.ts` — opt-in source-map generation (marker-based position
  tracking), `EmitSourceMapOptions`, `EmitResult.map`; maps-off renderer bytes unchanged.
- `packages/cli/src/commands/format.ts` — full implementation replacing the P7 stub.
- `packages/cli/src/args.ts` — `--check` flag (format-only, exit 2 otherwise), usage text, exit-code
  wording.
- `packages/cli/src/index.ts` — `runFormat(invocation, cwd)`, exports for the format command and
  formatter boundary; removed the P7 message export.
- `tests/integration/cli-config.test.ts` — **deviation:** the obsolete "format reports P7 and exits 2"
  assertion was replaced with the `format --check` contract; without this, `verify` could not pass.
  The file was not in the exclusive list, but its assertion directly contradicted this task.

## Source-map emitter option and mapping granularity

```ts
interface EmitSourceMapOptions {
  file: string;                                  // planned CSS basename, e.g. "button.css"
  sourceText: (file: string) => string | undefined; // authored text for a span's file
  sourcePath?: (file: string) => string;         // span path → map `sources` entry
  sourceRoot?: string;
  includeSourcesContent?: boolean;               // default false
}

emitCss(ir, { minify, sourceMap }): {
  css: string;
  map?: string;      // serialized v3 JSON with trailing newline
  diagnostics: readonly Diagnostic[];
}
```

- Granularity is declaration-level: one mapping at each emitted rule selector and one at each emitted
  declaration property (descriptor declarations inside `@font-face`/`@property`/`@page` included).
  Values are not token-mapped, so `names` is never emitted.
- Selector mapping origin is the rule's `RuleIr.span` start. The frozen IR has no separate selector
  span; lowering sets `RuleIr.span` to the run's first declaration segment. Declarations map to their
  segment span start (the variant's `@modifier` for inline variants).
- Implementation: when maps are on, the emitter injects zero-width NUL-delimited markers before
  selectors/properties. Markers contain no newline, so indentation and minification behave exactly as
  before; a final scan removes them, computes real generated line/column and resolves authored
  line/column from `sourceText` span offsets. This is why minified positions stay correct.
- The comment and map `file` use the caller-supplied CSS basename, so `theme.css` becomes
  `/*# sourceMappingURL=theme.css.map */` (SPECIFICATION.md §9.1/§6).
- `sourcePath` exists because pipeline IR spans carry canonical absolute paths; the lead's wiring
  should pass a workspace-relative POSIX projection so `sources` satisfies §6.

## Formatter decisions

- Pure `tokenize` + `parseTokens` (no compiler barrel import), so the formatter cannot create an
  import cycle with `src/index.ts`.
- Canonical layout: two-space indent, one declaration per line with `;`, one blank line between
  top-level constructs, and a blank line inside a block whenever either neighbouring statement is a
  nested rule/conditional block. Directive blocks keep one entry per line.
- Values, selectors, alias names and `!important` come from AST raw slices; the printer only inserts
  structural whitespace. Inline variants stay on the declaration line.
- Comments are attached in source order to the next statement that follows them, printed on their own
  line at that statement's indent. Comments inside declaration values/selectors/native preludes are
  already part of the printed raw slice and are excluded from the attachment pass, so they are never
  duplicated. A multi-line comment is re-indented deterministically (idempotent).
- `@use` specifiers are re-emitted with double quotes: the AST stores the decoded path, not the
  author's quote character. All other raw slices are preserved.
- Any error diagnostic returns the input byte-identically with the diagnostics; warnings still
  format.

## Lead follow-up: `compile()` wiring (completed)

The original handoff below was implemented in the lead-directed follow-up; see
[API wiring](#api-wiring-lead-directed) for the final design.

1. In `compileEntry`, when `input.setup.emitCss && input.setup.sourceMap`, call
   `emitCss(flattened.ir, { minify, sourceMap: { file: input.setup.cssName, sourceText, sourcePath, includeSourcesContent: true } })`
   and place `emitted.map` into `CompileResult.sourceMap`.
   `file` must be the resolved CSS basename (`setup.cssName`; the planner already computes the same
   `cssName + ".map"` artifact via `sourceMapNameFor`).
2. `sourceText(file)` must return authored text keyed by absolute span paths. `compile()` has the
   entry `source`; `compileProject()` currently does not retain module source in `ModuleRecord` —
   either read it through the injected `ModuleHost` while compiling (async) or add source text to the
   graph record. `sourcePath` should project absolute paths to workspace-relative POSIX (for example
   with `relativePath(workspaceRoot, file)` from `output/paths.ts`).
3. The CLI build already consumes `result.sourceMap` as the `cssSourceMap` artifact
   (`artifactContent` in `commands/build.ts`), so no CLI build change is needed once step 1 lands.
   Until then, a project with `source-map: true` plans the map artifact but the compiler returns no
   map text.
4. Optional barrel export of the formatter (`export { format } from "./formatter/index.js"`) would
   let `packages/cli/src/formatter.ts` load it through `loadCompiler()` like the rest of the API; the
   direct module loader is a deliberate interim bridge.

## API wiring (lead-directed)

Follow-up integration after the initial handoff:

- `compileEntry` now plans outputs **before** emission, finds the planned `css` artifact and passes
  its basename (`basenamePath(workspacePath)`) as `sourceMap.file`, so the `sourceMappingURL` comment
  and v3 `file` field always match the planner. It calls
  `emitCss(..., { sourceMap: { file, sourceText, sourcePath, includeSourcesContent: true } })` when
  `setup.emitCss && setup.sourceMap` and the CSS artifact exists, then returns `sourceMap` as the
  serialized map string. Maps stay absent otherwise.
- Source retention: `createRecordingHost` wraps the host used by `buildModuleGraph` in both
  `compile()` and `compileProject()`, recording every authored module read keyed by normalized path
  (exactly the path used in IR spans). No frozen or resolver type changed. `sourcesContent` carries
  the authored text; `sources` is projected to workspace-relative POSIX by `mapSourcePath`, which
  also tries the host-canonicalized root so macOS `/var` ↔ `/private/var` symlink roots still
  produce relative sources.
- `format` and `FormatResult` are exported from the compiler barrel
  (`packages/compiler/src/index.ts`). The CLI formatter loader now obtains `format` through the
  shared `loadCompiler()` boundary and only falls back to the compiler source module under Bun when
  a stale checked-out `dist` predates the export.
- Tests added in `tests/compiler/compile.test.ts`: inline `source-map: true` compile with an
  independent in-test VLQ decoder asserting the `.ui-button` rule origin (line/column, source index,
  `file: button.css`, `sources: ["src/button.xessa"]`, `sourcesContent`), the trailing
  `/*# sourceMappingURL=button.css.map */` comment, maps-off default unchanged, a barrel `format`
  smoke, and `compileProject` retaining authored source with workspace-relative sources.
- Evidence: `bun run verify` **exit 0** (573 pass / 0 fail, 35 files); `node-smoke` 4 pass, building
  both packages with `tsc`; the built CLI was run under plain Node for `format --check`.

## Validation evidence

- `bunx tsc -p packages/compiler/tsconfig.json --noEmit` — pass.
- `bun run typecheck` (compiler, CLI, language-service, vscode) — pass.
- `bun test tests/compiler/sourcemap.test.ts tests/compiler/formatter.test.ts
  tests/integration/format-cli.test.ts` — 22 tests, 0 fail.
- `bun test` (whole repository) — 569 pass, 0 fail, 35 files (baseline before this task: 547 pass).
- `bun test tests/integration/node-smoke.test.ts` — 4 pass (builds both packages with `tsc` and runs
  the built CLI under plain Node); the built CLI was also run manually for `format --check`.
- `bun run verify` — **exit 0** (typecheck + lint + 569 tests).
- `bunx biome check` on every file this task touched — clean.

Note: while this task was in progress, `bun run lint` briefly failed on
`examples/jsx/src/Button.tsx` and `scripts/benchmark.ts` (owned by the concurrent A15B
docs/examples/release worker). Those were not modified here; A15B normalized them and the final
`verify` run above is green.

## Blockers / external issues

None. The only remaining work is the lead-owned `compile()`/barrel wiring described above.
