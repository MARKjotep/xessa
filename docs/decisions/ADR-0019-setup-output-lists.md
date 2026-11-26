# ADR-0019: `css-dir` value lists

## Status

Accepted (2026-11-26) — owner-requested feature, normative for v0.1 as a scoped exception to the
single-scalar `@setup` rule. Task CSSX-F18.

Related: SPECIFICATION.md §3.2, §9; ADR-0014 (rejected-alternatives note); ADR-0010 (strict
resolution); `.ai/reports/CSSX-F18.md`

## Context

During development the same generated `.css` is sometimes needed in two in-workspace directories —
for example `./client` and `./src` — so a second app can consume it without rebuilding. The owner
asked for a `css-dir` value list:

```xessa
@setup {
  css-dir: "../client", "../src";
}
```

Declarations already terminate in `;`, so a comma-separated value parses unambiguously inside
`@setup`. SPECIFICATION.md §3.2 and ADR-0014 state that `@setup` values are single scalars; this ADR
carves a narrow exception for `css-dir` only. The alternative of repeating the key is unavailable:
duplicate setting keys are already `XESSA1001` errors.

## Decision

1. **One key, one list.** `css-dir` accepts either a scalar path (existing behaviour, byte-identical)
   or a comma-separated list. Commas inside quoted strings stay literal and do not split.
2. **Exact per-item resolution.** Every item resolves exactly like today's single `css-dir`: relative
   to the source file, with no project-level source mirroring. Project configuration
   (`output.cssDir`) and CLI `cssDir` overrides stay single-valued; a file list replaces the project
   value for that file, and a CLI override replaces the file list.
3. **One stylesheet, one basename.** The same `css-name` is written to every destination. When
   `source-map: true`, a source map is written beside each destination. `map-dir`/`map-name` are not
   extended.
4. **Strict errors.** Empty items (leading, trailing or doubled commas) and repeated paths are
   `XESSA2001` with a span inside the authored value. Each destination is still validated against
   workspace containment and symlink escapes independently; one unsafe item fails the whole entry's
   plan.
5. **Every destination is owned.** The planner emits one artifact per destination, the manifest
   records each, `clean` deletes each unmodified copy, the interrupted-write `.cssx-tmp` sweep covers
   each output directory, and watch rebuilds and JSON/NDJSON reports list every written path.

Config-level arrays (`"output": { "cssDir": ["a", "b"] }`), `map-dir` lists and editor UI changes
beyond the compiler diagnostics are explicitly out of scope for v0.1.

## Rejected alternatives

- **Repeated `css-dir` keys.** Rejected: duplicate setting keys are already errors (SPECIFICATION.md
  §3.2, §9.2); relaxing that rule would make every setup key order-sensitive and silently
  last-wins.
- **A project-level `output.cssDir` array.** Deferred: project directories mirror the source path
  and participate in cross-entry collision planning, so an array there needs its own design (merge or
  replace, per-item mirroring) rather than inheriting the file-level exactness rule.
- **Extending `map-dir` at the same time.** Rejected for this task: the owner scoped the request to
  `css-dir`; map symmetry is a separate design question.
- **Silently deduplicating equivalent destinations.** Rejected by ADR-0010's strict policy: a
  repeated path is a setup mistake, not something the compiler should guess about.

## Consequences

- One source build can feed two in-workspace consumers without a copy step or a second build.
- Single-value `css-dir` inputs are unchanged: no new diagnostics, no new artifacts, and existing
  golden fixtures stay byte-identical.
- The output plan and manifest grow by one artifact per extra destination; `clean` and watch already
  operate on planned/recorded paths, so ownership stays per-file atomic.
- The grammar exception is deliberately narrow; other `@setup` values remain single scalars and the
  duplicate-key rule is untouched.
