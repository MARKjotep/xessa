# ADR-0006: Media aliases merge by key

## Status

Accepted (2026-11-25)

Related: SPECIFICATION.md §4, §10

## Context

Media aliases can be defined by built-in defaults, project configuration and file-level
`@media-types`. A deterministic precedence rule is required, and unknown aliases must not produce
invalid CSS.

## Decision

Merge alias definitions **by key** with the precedence:

1. built-in defaults;
2. project config `media`;
3. file-level `@media-types`.

For the same key, the later layer replaces the earlier definition; different keys accumulate.
Aliases are not merged textually. Unknown or rejected alias combinations (unsupported media types,
comma lists, incompatible combinations) produce XESSA3001-family diagnostics. Invalid CSS is never
emitted: the affected declaration or block is dropped from output after the diagnostic.

Native media lists pass through unchanged and are not alias-merged.

## Consequences

- File definitions win locally without mutating project or built-in defaults.
- Diagnostics and completions share the same merged table.
- A rejected alias cannot silently become a malformed media query.
- Media grouping tests in A05 and browser tests in A14 must cover all three layers.
