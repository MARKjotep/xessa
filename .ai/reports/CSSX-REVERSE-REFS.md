# CSSX-REVERSE-REFS — report

**Status:** PASS (2026-11-26) · **Board:** bug 27 · **Scope:** editor references only

## Summary

- Find All References is bidirectional for `$token`/`@runtime` tokens. From a definition in the
  exporting module it returns the definition plus every resolving use in direct importers; from a
  use site it returns the same set. The owner-reported asymmetry is gone.
- Inclusion is resolution-based, reusing each file's analysis. Namespaced aliases
  (`@use … as t` → `$t.name`), unqualified imports (`$name`) and style imports count. A local token
  that shadows an imported name and an unqualified name exported by two modules (`XESSA2001`) are
  excluded. There is no transitive re-export reach.
- Locations are deduped by URI + range and sorted by URI then start position. `includeDeclaration`
  is honoured in both directions.
- Rename is untouched and remains single-file.

## Resolution and scan strategy

`resolveTokenReference(reference, analysis)` mirrors the compiler's scope rules:

1. Namespaced reference: only an explicit `@use … as <alias>` binding is considered; the first such
   binding is the namespace, and the member must exist in that module.
2. Unqualified reference: a local `$name` of either symbol space wins (shadowing); otherwise every
   direct import without an `as` clause contributes a provider, and exactly one distinct
   `(module, kind)` provider resolves. Zero or two-plus providers resolve to nothing.

`tokenDefinitionAt()` reuses `tokenAt` for locals and namespaced members and falls back to the
resolver for unqualified imported names. `referencesToToken()` walks the file's
`collectTokenReferences` once, keeps only references that resolve to the target and adds the local
declaration when this file is the target module.

Provider scan (`providers/navigation.ts`):

- `vscode.workspace.findFiles` per workspace folder with `**/*.cssx` and exclude
  `**/{node_modules,dist,generated}/**`.
- The target module is always admitted first (it may sit outside a workspace folder).
- A document outside every workspace folder also scans its own directory non-recursively
  (`*.cssx`); this is what lets the host suite's temp workspace work without adding a folder.
- **Bound:** 200 candidate modules per request, target included. The open document is skipped
  (already analyzed) and analyzed files scan only when their text contains the target name (a safe
  prefilter: any resolving occurrence contains the name).
- Open documents win over disk text and contribute their live version; no watchers, no caching
  beyond the existing `AnalysisService`, cancellation checked before each analysis.
- The current document uses its in-memory analysis; scanned files use `service.analyzeNow` with the
  controller's project options and module reader.

No provider-side edits and no invented declarations: every range comes from the file's own
analysis.

## Repro evidence

Host workspace (`packages/vscode/test/ui/navigation.js`, temp `xessa-ui-navigation-*`):

- `reverse-tokens.cssx`: `brand` compile-time and `surface` runtime.
- `reverse-alias.cssx`: `@use "./reverse-tokens.cssx" as t;` with `$t.brand`, `$t.surface`.
- `reverse-plain.cssx`: `@use "./reverse-tokens.cssx";` with `$brand`, `$surface`.
- `reverse-shadow.cssx`: unqualified import plus local `@variables { brand: … }` (must not resolve
  to the imported module).
- `reverse-other.cssx` + `reverse-ambiguous.cssx`: two unqualified providers for `brand`, so the use
  is `XESSA2001` and unresolved.

`brand` from the definition (exact URI/range asserted):

| File | Line | Start–End |
|---|---|---|
| reverse-tokens.cssx | 1 | 2–7 (declaration) |
| reverse-alias.cssx | 2 | 9–17 (`$t.brand`) |
| reverse-plain.cssx | 2 | 9–15 (`$brand`) |

The alias importer and the unqualified importer return the identical three-location set. The shadow
and ambiguous files contribute nothing. `surface` from its runtime definition returns the
declaration (line 4, 2–9) plus `$t.surface` (alias line 3, 14–24) and `$surface` (plain line 3,
14–22).

Unit evidence (`tests/extension/provider.navigation.test.ts`, 3 tests):

- Definition direction returns exactly the declaration + alias + unqualified occurrences, with
  offsets pinned per file; shadow and ambiguous files absent.
- Importer direction: namespaced and unqualified references resolve to the same definition; the
  shadowing file resolves to its own local; the ambiguous use resolves to `undefined`; the runtime
  token resolves through both importers and yields 3 occurrences.
- `includeDeclaration: false` leaves exactly the two references and drops the declaration only.

## Gates

Sequential on the final tree:

| Gate | Exit | Elapsed | Key output |
|---|---|---|---|
| `bun run verify` | 0 | 76.2 s | 1351 pass / 2 skip / 0 fail (1353 tests, 99 files); host 15 scenarios / 928 assertions (`navigation=42`, was 37); typecheck + Biome (459 files) green |
| `bun run release:check` | 0 | 173.9 s | verify + browser green; browser 96/96; tarballs compiler 323 / CLI 89; nine examples; VSIX 18 files / 140.6 KB |
| `bun run lint` | 0 | 0.24 s | Biome 459 files, no fixes |

Host navigation scenario: ~700 ms, 42 assertions. Performance scenario `references` p95 28–33 ms on the
10 000-line document (unchanged path: local references never scan).

Gate note: an intermediate full-suite rerun hit the pre-existing `tests/stress/fs/watch.test.ts`
rename-prune race (the test checks the old artifact before the rediscovery cycle prunes it). It
passes standalone and on the final full run; this change does not touch the watcher, CLI or that
test.

## Records

- `.ai/todo.md` bug 27 → 🟢 with the owner quote (2026-11-26).
- `.ai/plans/CSSX-PLAN-PRODUCTION.md` row `REFS · reverse references` → 🟢 with the actuals above.
- `docs/usage.md` §5.2, `docs/known-limitations.md` §5 rename-scope row, `CHANGELOG.md` `[0.1.0]`
  editor bullet, `.ai/tasks/CSSX-REVERSE-REFS.md`.

## Handoff

The reverse-edge machinery is in place for a future multi-file rename: resolution gives a canonical
`(module path, name, kind)` identity, and `referencesToToken` already yields every resolving
occurrence per file. A rename provider can reuse the candidate scan and turn occurrences into a
`WorkspaceEdit`, while keeping the existing conflict/refusal rules. What remains for v0.2 is
deciding rename conflict policy across files and applying edits atomically; references themselves
are complete.
