# Framework record triage (2026-11-27)

## Provenance

These six records are **external-consumer reports** from a Gridy application, not findings produced
inside this repository. Their cited reproduction suite, `tests/features/xessa-compiler.test.ts`, and
the app-contract suite do not exist here; file/line citations point at the app's installed
`node_modules/@xessa/compiler` 0.1.1. Paths and app names (Gridy, Domkit, iOS) were left as authored
apart from the ordered Xessa rebrand. No compiler behavior was changed during the rename.

## Decisions

| Record | Type | Verdict | Decision |
| --- | --- | --- | --- |
| `bugs/runtime-token-merge-order-first-wins.md` | Bug | Confirmed spec bug (unqualified `styles` imports) | Fix next; add a repo-local regression fixture first; no behavior change in this task |
| `features/cross-prefix-class-map-union.md` | Feature | Deliberate contract (ADR-0010/ADR-0014) | Reject for v0.1; revisit only with a new ADR |
| `features/namespaced-runtime-token-emission.md` | Feature | Capability gap, not a spec violation | Defer; add an explicit emit-all opt-in only with consumer demand |
| `features/portable-runtime-token-prefix.md` | Feature | Spec-mandated behavior (SPEC §6.2) | Won't fix; native `:root`/`@media` palettes remain the portable-token pattern |
| `features/reserved-class-binding-alias.md` | Feature | Low-impact ergonomics request | Defer; document `_switch` as the stable public binding |
| `features/style-import-merge-order.md` | Feature | Deliberate cascade contract (SPEC §6.3) | Won't fix; use local overrides after imports or raise specificity |

## Recommended order

Only the runtime-token merge-order bug is actionable. Before any compiler change, add a repo-local
regression fixture and test for two unqualified `styles` imports declaring the same runtime property
(expect later-in-merge-order wins, one `:root` declaration, no diagnostic), plus the entry-override
case. Then fix `resolveUnqualified`/runtime emission against that test. The five feature records are
closed as no-change; no compiler behavior changed during the rename.
