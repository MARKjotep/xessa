# ADR-0023: Zero-config defaults

## Status

Accepted (2026-11-26) — project owner decision, normative for v0.1. Makes
`xessa.config.json` optional for project runs, turns strict configuration validation on by default
and states the media-grouping default explicitly.

Related: SPECIFICATION.md §9, §10; ADR-0007, ADR-0014; CSSX-DEFAULTS; `.ai/reports/CSSX-DEFAULTS.md`

## Context

A project previously had to carry a `xessa.config.json` with an `include` glob list before
`xessa build` would run at all, and the documented examples restated every default:

```json
{
  "include": ["src/**/*.cssx"],
  "exclude": ["src/theme.cssx"],
  "compiler": { "strict": true, "mediaGrouping": "safe" }
}
```

Two things changed the cost/benefit of that shape:

- `@setup { module: true; }` ([ADR-0014](ADR-0014-rule-merge-imports.md)) lets an imported module
  declare itself, so the main reason to maintain a project-wide `exclude` list is gone. A file that
  is imported as a module does not need to be named in configuration.
- The defaults are good for the common project: discovery should start at every `.cssx` file under
  the workspace root, media grouping should stay safe, and unknown configuration keys are almost
  always typos. Requiring boilerplate to express those defaults makes the examples restate the
  contract instead of demonstrating it.

Strict validation existed but was opt-in (`compiler.strict: true`), so the permissive path was the
one users got without asking.

## Decision

1. **Configuration is optional for project runs.** When no `xessa.config.json` is found, the
   workspace root is the nearest ancestor containing `package.json` (else the starting directory,
   [ADR-0007](ADR-0007-workspace-root-and-containment.md)), and discovery uses the default include
   globs. An explicitly configured empty `include` list stays an invocation error, and an empty
   discovery result stays a configuration error (exit 2), so a moved or typo'd source tree cannot
   pass CI silently.
2. **Default `include` is `["**/*.cssx"]`.** `exclude` stays `[]`; imported modules self-declare with
   `@setup { module: true; }` instead of being listed.
3. **Strict configuration validation is the default.** `compiler.strict` defaults to `true` in the
   CLI/compiler defaults, so unknown keys exit 2. An explicit `"strict": false` keeps the previous
   warning path (`configWarnings` still reports ignored keys).
4. **Media grouping default is explicit.** `compiler.mediaGrouping` defaults to `"safe"`, matching the
   resolver's existing `input.options.mediaGrouping ?? "safe"` behaviour. Documentation and defaults
   now state it instead of leaving it implicit: safe adjacent grouping only, never reordering.
5. **Examples demonstrate defaults.** A `xessa.config.json` remains only where an example shows a
   non-default setting (the `classes.prefix` in `overrides` and `groups`); otherwise it is deleted.
   Config-less examples keep a minimal `package.json` so the ADR-0007 workspace boundary is the
   example directory, not the enclosing repository.

## Rationale

The module marker moved project knowledge into the file that owns it. With `module: true`, the
project-level list is no longer the source of truth for which files are entries, so the remaining
configuration usually only restates defaults. Zero-config builds make the first successful build a
single command, keep the examples honest, and match how TypeScript, Biome and similar tools behave:
strict by default, opt out deliberately.

## Rejected alternatives

- **Default `include` to `src/**/*.cssx`.** Rejected as too opinionated: projects legitimately keep
  `.cssx` beside components, in `app/`, or at the root. `**/*.cssx` is the least surprising scope,
  and a project that wants a narrower tree adds one `include`.
- **Require an explicit `include`.** Rejected by the owner: it is the boilerplate this decision
  removes. Empty discovery still fails loudly, so the typo-protection argument is covered without a
  mandatory file.
- **Keep strict opt-in.** Rejected: unknown keys are configuration mistakes, and warning-only
  validation hides them in CI logs. `"strict": false` preserves the lenient path for migrations.
- **Default `mediaGrouping` to `"none"`.** Rejected: `"safe"` already preserves declaration order,
  specificity, layers and scopes and only merges adjacent compatible runs; it is the documented
  default and changing it would be a behaviour change unrelated to zero-config.
- **Keep boilerplate configs in examples.** Rejected: examples should show the defaults users get,
  not a copy of the schema.

## Consequences

- `xessa build` works in a directory with `package.json` and `.cssx` sources, without configuration.
- Unknown configuration keys now fail by default; projects that intentionally carry extra keys must
  set `"compiler": { "strict": false }`.
- A config-less project scans from the nearest `package.json` boundary. A repository with several
  example projects should give each its own marker (the examples use a minimal `package.json`) or
  use `include` to scope discovery.
- `include` remains the way to narrow discovery; `exclude` remains available for generated or
  vendored trees, but is no longer the module mechanism.
- Committed example output does not change: files that were excluded before are now discovered but
  self-suppress their artifacts, so the same bytes are written. The release gate builds each example
  with `--config` only when a config exists and otherwise runs `xessa build` from the example
  directory.
