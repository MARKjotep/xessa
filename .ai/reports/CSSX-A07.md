# CSSX-A07 — Module graph resolver (P3)

## Summary

- Implement the module graph resolver in `packages/compiler/src/resolver/`: `@use` loading through the injected `ModuleHost`, canonical-path caching, cycle detection, workspace containment, topological order.
- Build per-module token scopes (compile-time from `@variables`, runtime from `@runtime`) with namespace rules, and the scope-level errors: duplicate local definitions, ambiguous unqualified imports, compile-time/runtime name collisions (XESSA2001).
- All filesystem access through `ModuleHost`; tests use an in-memory host. Variable substitution itself is A08.

**Status:** implemented and verified; `bun run verify` exit 0 (230 tests / 10 files, resolver file 29
tests / 182 assertions). Awaiting lead verification. No `.ai/PROGRESS.md` row touched; frozen types,
lexer, parser, lowering, the barrel, fixtures and configs are unchanged.

## Created files

| File | Contents |
|---|---|
| `packages/compiler/src/resolver/types.ts` | Exported graph/scope shapes: `ModuleGraph`, `ModuleRecord`, `TokenScope`, `ScopedToken`, `ScopedNamespace`, `SymbolOrigin`, `ScopedTokenType`; internal `ResolvedImport`. |
| `packages/compiler/src/resolver/paths.ts` | Lexical POSIX normalization, workspace containment, CSS string-escape decoding (no `node:path`). |
| `packages/compiler/src/resolver/scopes.ts` | Local symbol collection, duplicate/collision diagnostics, unqualified-import merging/ambiguity, namespace member construction. |
| `packages/compiler/src/resolver/graph.ts` | Breadth-first canonical-path loading, `@use` resolution, cycle detection, Kahn topological order, diagnostic sorting. |
| `packages/compiler/src/resolver/index.ts` | Facade: `buildModuleGraph` plus public type re-exports. |
| `tests/compiler/resolver.test.ts` | 29 tests with an in-memory recording `ModuleHost`, fixture-driven and inline graphs. |
| `.ai/tasks/CSSX-A07.md`, `.ai/reports/CSSX-A07.md`, `.ai/reports/logs/CSSX-A07.log` | Task, report, worker log. |

No framework bug/feature records were needed: this is application work against the frozen internal
contracts, not a defect in an external framework.

## Public API

```ts
export async function buildModuleGraph(
  entries: readonly string[],
  host: ModuleHost,
  options: CompileOptions,
): Promise<ModuleGraph>;
```

```ts
interface ModuleGraph {
  readonly modules: ReadonlyMap<string, ModuleRecord>; // canonical path -> record
  readonly order: readonly string[];                   // dependencies first, ties by path
  readonly diagnostics: readonly Diagnostic[];         // parse + resolver, stably sorted
}

interface ModuleRecord {
  readonly file: string;                 // canonical path
  readonly ast: Stylesheet;
  readonly dependencies: readonly string[]; // canonical, deduped, authored order
  readonly importedBy: readonly string[];   // canonical, sorted
  readonly compileScope: TokenScope;
  readonly runtimeScope: TokenScope;
  readonly hasRules: boolean;            // false for token-only modules (P4/P5 skip artifacts)
}
```

**Async deviation:** the task sketch wrote a synchronous return, but the frozen `ModuleHost` contract
makes `readFile`/`fileExists` async (`Promise`), so the only honest implementation returns a
`Promise<ModuleGraph>`. No other signature or field differs from the requirement; `hasRules` is the
expressly allowed "or equivalent" for token-only detection.

## Scope shape (A08 handoff)

```ts
type ScopedTokenType = "compile" | "runtime";

interface ScopedToken {
  name: string;                 // without `$`
  tokenType: ScopedTokenType;
  module: string;               // canonical path of the *declaring* module
  span: Span;                   // declaring TokenDeclaration/Declaration span
  declaration: TokenDeclaration | Declaration; // raw value, tokens?, variants?
  origin:
    | { kind: "local" }
    | { kind: "import"; module: string; specifier: string; span: Span; namespace?: string };
  unqualified: boolean;         // true for locals and unqualified imports; false for members
}

interface ScopedNamespace {
  namespace: string;            // alias without `$`
  module: string;               // canonical target
  span: Span;                   // @use statement in the importing file
  specifier: string;            // decoded specifier
  members: ReadonlyMap<string, ScopedToken>; // target's own locals only
}

interface TokenScope {
  kind: ScopedTokenType;
  module: string;               // file that owns this scope
  tokens: ReadonlyMap<string, ScopedToken>;     // bare `$name`
  namespaces: ReadonlyMap<string, ScopedNamespace>; // `$ns.member`
}
```

How A08 should consume it:

1. `$name`: look in `module.compileScope.tokens` first, then `module.runtimeScope.tokens` (they never
   contain the same unqualified name, because cross-space *imported* collisions are XESSA2001 too).
2. `$ns.member`: look in `compileScope.namespaces.get(ns)?.members` for a compile-time value and
   `runtimeScope.namespaces.get(ns)?.members` for a runtime value. Namespace maps exist in both scopes
   with the same keys; each `members` map is filtered to its own symbol space.
3. Resolve the definition's value in `token.module`, using that module's scopes. `span`/`declaration`
   point at the declaring node, so local overrides never mutate the defining module.
4. Bare `$ns` deliberately does not resolve: it is absent from `tokens`; `namespaces.has(ns)` lets A08
   report a namespace-specific error instead of a generic undefined token.
5. Undefined references are not scanned here. The resolver never walks rule/declaration values, so
   `variables/undefined-ref` yields zero diagnostics by design.

## Decision record

| Decision | Rationale / citation |
|---|---|
| Load entries breadth-first, cache parsed modules by `host.canonicalize(path)`, parse each file once. | SPECIFICATION.md §6.1 ("Modules are cached by canonical path"); masterplan §3.4. Verified by `readFile` counts. |
| Parse with the canonical path as `Span.file`. | Gives every scope/diagnostic one stable module identity shared with `ModuleRecord.file`. |
| Pipeline `host.readFile → tokenize → parseTokens`, importing `src/lexer/index.ts` and `src/parser/index.ts` directly. | Task requirement; avoids a future barrel cycle. No lowering import. |
| Resolve `@use` by: decode CSS string → `resolvePath` → lexical containment → `canonicalize` → canonical containment → `fileExists`. | Imports are source-relative and workspace-restricted (SPECIFICATION.md §6.1; ADR-0007). Containment precedes existence so an outside path never triggers a read/existence probe; escape messages normalize to `/`. |
| Decode CSS string escapes in specifiers (hex, escaped newline, escaped character). | AST `UseImport.path` JSDoc: "the resolver decodes them". Covered by a `\74 heme.xessa` test. |
| Deduplicate repeated imports of one canonical target into one dependency edge and one `importedBy` entry; keep every `@use` for scope/namespace handling. | SPECIFICATION.md §6.1 reverse-dependency tracking; deterministic graph. Duplicate-import test asserts one read and one edge. |
| Detect cycles (incl. self) by DFS; one XESSA2001 per distinct cycle, span at the `@use` closing it, rotation-stabilized path in the message. | Task requirement; §12 XESSA2001 family. Cycle members stay in `modules` for recovery. |
| Exclude only cycle members from `order`; importers of a cycle are still ordered by their remaining edges. | Task requirement ("cycle members are excluded from `order`"); lets P4/P5 still process unaffected entries. |
| Kahn topological sort with a sorted ready set: dependencies first, ties by canonical path. | Task requirement; masterplan §6 deterministic output. Diamond test pins `d b c a`. |
| Local definitions shadow unqualified imports; one local name (of either symbol space) shadows imports of that name. | SPECIFICATION.md §6.1 "Local definitions override unqualified imported definitions"; keeps the single `$name` syntax unambiguous. |
| Duplicate local definitions are errors at the later declaration; the first definition remains in the scope. | SPECIFICATION.md §6.1; deterministic recovery after an error. |
| Unqualified imports from two distinct providers are ambiguous (same or different symbol space), unless a local definition shadows the name; span at the second conflicting `@use`; first provider kept. | SPECIFICATION.md §6.1/§6.2 ("ambiguous imports are errors"; local/compile/runtime names are one namespace). Cross-kind imports were treated as one `$name` namespace, documented here as the interpretation. |
| Namespaced imports never merge into `tokens`; members come only from the target's own locals. | SPECIFICATION.md §6.1 namespace independence and "no implicit transitive re-export". |
| Duplicate namespace alias for different targets → XESSA2001 at the later `@use`; same target is harmless. | Extra scope error beyond the bullet list: two targets under one alias make `$alias.member` ambiguous. Same-target repetition is a no-op. |
| Compile-time/runtime local collision → XESSA2001 at the later declaration. | SPECIFICATION.md §6.2 "Compile-time and runtime symbols cannot share a local name". |
| `hasRules` = any top-level `Rule` or `NativeAtRule`. | Token-only modules do not emit artifacts (SPECIFICATION.md §6.1); §6.2 runtime-only modules emit through consumers. |
| Include lexer/parser diagnostics in the returned array, then stable-sort by file/offset/code/message. | The resolver is the pipeline's module loader; callers would otherwise need to re-parse. Determinism requirement. |
| `options` is accepted but unused; containment always comes from `host.workspaceRoot()`. | ADR-0007 says the host owns the workspace root; documented on `resolveModuleGraph`. |

## Diagnostics produced (all XESSA2001, severity `error`)

| Situation | Span |
|---|---|
| Import missing after canonicalization | the `@use` statement |
| Lexical or canonical workspace escape | the `@use` statement |
| Empty `@use` specifier | the `@use` statement |
| Import cycle (incl. self) | the `@use` that closes the cycle |
| Duplicate local definition (same or across blocks) | the later `TokenDeclaration`/`Declaration` |
| Ambiguous unqualified import | the second conflicting `@use` |
| Duplicate namespace for different targets | the later `@use` |
| Compile-time/runtime local collision | the later of the two declarations |
| Entry unreadable/not found (defensive) | zero-width span at the canonical entry |

## Test evidence

```text
bun test tests/compiler/resolver.test.ts
  29 pass / 0 fail, 182 expect() calls

bun run verify
  typecheck: exit 0
  biome check .: 207 files, no fixes
  bun test: 230 pass / 0 fail, 10 files
  VERIFY_EXIT=0
```

Coverage highlights:

- **Fixtures:** `basic` (local tokens + values/spans), `cycle` (message path, exact `[0,17]` span on
  `b.xessa`, modules retained, members absent from `order`), `namespaced-members` (members only via
  namespace, bare name absent, token-only `hasRules === false`), `local-overrides-imported` (24px
  local wins, imported module still 8px), `ambiguous-import` (exact second-`@use` span),
  `undefined-ref` (A08 boundary: no diagnostic).
- **Scopes:** namespace independence (two aliases, and unqualified + namespaced), repeated alias
  conflict vs same-target no-op, duplicate local in one block and across blocks (exact spans),
  shadowed ambiguity, cross-kind imported ambiguity, compile/runtime collision in both authored
  orders (span compared to the AST node), non-transitive re-export, token-only modules.
- **Graph:** self-cycle, diamond order/ties, importedBy sorting, sibling `./theme.xessa` from `src/`,
  lexical containment before existence, symlink/canonical escape, missing import with no edge,
  repeated-import dedupe with a single `readFile`, empty entries.
- **Purity/determinism:** two runs on the ambiguous fixture produce identical `order`, module keys and
  diagnostics; the recording host is exercised for every operation; a source scan of
  `src/resolver/*.ts` rejects any `import`/`require` of `node:` modules.

## Blockers

None.

## Contract concerns for lead review

1. **Async facade:** `buildModuleGraph` returns `Promise<ModuleGraph>` because the frozen `ModuleHost`
   is async. If a sync API is required, the host contract would have to change (out of scope).
2. **Cross-space unqualified imports:** two unqualified imports exporting the same name from different
   symbol spaces are reported as ambiguous. The spec makes local cross-space collisions errors and
   makes unqualified names a single `$name` syntax; this is the strict reading. Same-target duplicates
   are deduped and harmless.
3. **Duplicate namespace diagnostic:** not in the task's bullet list, but two different targets under
   one alias make `$alias.member` ambiguous; reported as XESSA2001 rather than silently picking one.
4. **Parse diagnostics are included** in `ModuleGraph.diagnostics` after resolver diagnostics are
   added and the whole list is stably sorted. If the lead wants resolver-only diagnostics, filter by
   `code === "XESSA2001"` at the call site; no type change is needed.

## Handoff

- A08 can consume `buildModuleGraph` from `packages/compiler/src/resolver/index.ts`; no barrel change
  was made (barrel ownership is the lead's).
- A08 responsibilities: undefined `$name`/`$name.member`, token-reference cycles, token substitution,
  runtime custom-property emission, and deciding whether a lookup should consult the compile or
  runtime scope. All provenance A08 needs is in `ScopedToken`/`ScopedNamespace`.
- P4/P5 can use `ModuleRecord.hasRules` to skip artifact emission for token-only modules and
  `order` for stable processing.
- Files touched are exactly the allowed scope; `.ai/PROGRESS.md`, frozen types, lexer, parser,
  lowering, fixtures, docs and configs were not modified.
