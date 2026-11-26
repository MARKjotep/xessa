# ADR-0010: Class naming and export policy for the MVP

## Status

Accepted (2026-11-25). **Amended by CSSX-A52 (2026-11-26):** the default object was removed and
identifier collisions are now resolved with deterministic `_`/`_N` suffixes instead of failing the
build; declarations are opt-in. See SPECIFICATION.md §8 for the current contract.

Related: SPECIFICATION.md §7, §8

## Context

Naming strategies and JavaScript export rules affect every generated class map and TypeScript
declaration. Earlier design notes list options without fixing MVP collision behavior.

## Decision

- **MVP naming strategies:** `none` and `prefix`. Prefixing uses the file-level `prefix` setup key
  (`ui` → `ui-card`); an empty prefix leaves names unchanged.
- **Collision policy is strict:** `foo-bar` and `fooBar` both mapping to the alias `fooBar` is an
  error, reported as XESSA4001. The compiler does not silently omit or merge either export.
- **Type declarations** are suppressed automatically, with a documented warning, when map emission
  is disabled (`emit-map: false` / `emitMap: false`) and types were not explicitly disabled.
- **Named exports** use camelCase aliases when unambiguous. Reserved or invalid identifiers remain
  available through quoted original keys in the default map, with the named export omitted and a
  warning. `__proto__` is handled with computed keys or a null-prototype map.
- Global classes (including `:global(...)`) are not exported; intentional shared global classes are
  allowed.

## Consequences

- Deterministic, collision-free maps; any ambiguity fails the build instead of producing a partial
  API.
- TypeScript declarations always match the emitted JS map, or are absent with a warning.
- Hash and file-scoped naming remain deferred until after v0.1.
