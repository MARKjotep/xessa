# The Xessa cascade contract (v0.1)

Xessa does **not** invent a new cascade. It expands your declarations into ordinary CSS in the order
you wrote them, and the browser's normal cascade decides the winner. This page restates
[SPECIFICATION.md](../SPECIFICATION.md) §5 with worked examples, states what the compiler promises,
and points at the browser evidence.

## 1. Source-preserving mode

For each rule, declarations are expanded in **authored order**:

1. the base declaration first;
2. then each inline variant, in the order the variants were written;
3. conditional blocks are emitted where they appear;
4. nested rules are lowered and emitted where they appear.

A `@group.<name>` use site is expanded in place within that order: its defaults in definition order,
then its own declarations in authored order (§2).

Consecutive expanded declarations with the same selector and at-rule context form one contiguous
run. Runs are flushed when a nested rule or a conditional declaration interrupts them. The output
preserves authored declaration order — including duplicate fallbacks, shorthand/longhand pairs and
`!important` flags.

### Worked example — base then variants

```xessa
.button {
  padding: 12px @md 20px @xl 32px;
  border-radius: 8px;
  background: white @dark #181818;
}
```

```css
.ui-button {
  padding: 12px;
}

@media (min-width: 768px) {
  .ui-button {
    padding: 20px;
  }
}

@media (min-width: 1280px) {
  .ui-button {
    padding: 32px;
  }
}

.ui-button {
  border-radius: 8px;
  background: white;
}

@media (prefers-color-scheme: dark) {
  .ui-button {
    background: #181818;
  }
}
```

The base value is always present and comes first. `border-radius` and the base `background` were
adjacent in the same context, so safe grouping put them in one rule; the `@dark` background is a
separate run. At 768–1279px the browser applies `padding: 20px`; at ≥1280px, `padding: 32px`.

## 2. Precedence

Later declarations keep their normal CSS precedence. This applies to shorthand/longhand
interactions, duplicate fallbacks, specificity and `!important`. Within one inline declaration the
last matching variant wins subject to that same cascade.

### Worked example — a later base overrides an earlier conditional

```xessa
.card {
  color: red @md green;
  color: blue;
}
```

```css
.ui-card {
  color: red;
}

@media (min-width: 768px) {
  .ui-card {
    color: green;
  }
}

.ui-card {
  color: blue;
}
```

At every width the final matching declaration is `color: blue`, because it comes **last** in the
stylesheet. The `@md green` declaration is earlier at the same specificity, so it loses. This is
valid authored CSS; the compiler documents it rather than "fixing" it. If the intent was
"green from 768px up, blue below", write the base first and the variant last:

```xessa
.card {
  color: blue @md green;
}
```

Authors **SHOULD** order mobile-first ascending aliases (`sm`, `md`, `lg`, `xl`, `2xl`) and place
combined conditions last. The compiler MAY warn about suspicious order, but it **MUST NOT** silently
reorder declarations.

### Worked example — group defaults and use-site overrides

A `@group.<name>` use site expands at the authored position into the group's defaults in definition
order, then the use-site block's declarations in authored order
([ADR-0017](decisions/ADR-0017-reusable-declaration-groups.md)):

```xessa
@group.card {
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #ddd;
  color: black;
}

.panel {
  @group.card {
    padding: 20px;
    color: navy;
  }
}

.tile {
  @group.card {
    border-radius: 0;
  }
}
```

```css
.ui-panel {
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #ddd;
  color: black;
  padding: 20px;
  color: navy;
}

.ui-tile {
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #ddd;
  color: black;
  border-radius: 0;
}
```

Every default is still emitted — `padding: 12px` and the group's `border-radius: 8px` included —
then the use-site lines follow. The override wins only because the use-site declaration comes
**later at equal specificity**, exactly the "later base declaration wins" rule above; the compiler
never filters, reorders, deduplicates or rewrites the group's lines. `.panel` keeps `border` and the
group's radius, `.tile` keeps everything except the radius.

Two consequences are pinned by ADR-0017 and its tests, and are by design rather than bugs:

- **A use-site base declaration beats an earlier group default at every width**, including when the
  default was authored as an inline variant. Given `@group.heading { color: black @md navy; }` and a
  use-site `color: red`, the output is `color: black`, then
  `@media (min-width: 768px) { … color: navy }`, then a later `color: red`. Red wins at 320px
  and at 1280px alike, because the base declaration is last in source order — write the
  declaration you want last instead of expecting the compiler to repair it.
- **A group default authored `!important` is not beaten by a plain override.** `!important` binds
  per value segment ([ADR-0003](decisions/ADR-0003-important-per-segment.md)), so a definition's
  `padding: 10px !important` outranks a plain `padding: 20px` at the use site. Write `!important`
  in the override to compete.

### Runtime custom properties merge in emission order

`@runtime` tokens compile to `:root` custom properties, and a build can see the same property name
from its entry and from modules it imports. Xessa resolves that in **merge order** instead of
rejecting it ([ADR-0016](decisions/ADR-0016-runtime-token-override.md)): style-imported modules first
in depth-first `@use` order, then other reachable token modules, and the entry last. One `:root`
declaration is emitted with the winning value, and conditional variants follow the same order per
query group.

```xessa
/* theme.cssx, imported with @use "./theme.cssx" styles; */
@runtime { primary: #111111; }

/* entry.cssx */
@runtime { primary: #2563eb; }
```

```css
:root {
  --ui-primary: #2563eb;
}
```

The entry wins because it is last in merge order — the same rule a browser applies to a later
`:root` declaration. Two imported modules resolve the same way: the later one wins. This is
deliberate, not a missing conflict check; use a namespace or a local definition when you mean to
choose a compile-time `$name` instead.

### Worked example — `!important` per segment

`!important` belongs to the value segment it terminates (D2,
[ADR-0003](decisions/ADR-0003-important-per-segment.md)):

```xessa
.button {
  padding: 10px !important @md 20px;
}
```

```css
.ui-button {
  padding: 10px !important;
}

@media (min-width: 768px) {
  .ui-button {
    padding: 20px;
  }
}
```

The flag is not copied to the `md` segment. To make both important, write `!important` in both
segments.

## 3. Safe grouping

Safe grouping **merges only adjacent compatible rules and media contexts** without changing
declaration order, selector specificity, `@layer` or scope. It never moves a declaration across a
nested rule, a conditional block or a different at-rule context.

```xessa
.card { color: red; }
.card { margin: 0; color: blue; }
@media print { .card { color: black; } }
.card { padding: 1px; }
```

With the default `mediaGrouping: "safe"`:

```css
.ui-card {
  color: red;
  margin: 0;
  color: blue;
}

@media print {
  .ui-card {
    color: black;
  }
}

.ui-card {
  padding: 1px;
}
```

With `"none"` the first two rules stay separate:

```css
.ui-card {
  color: red;
}

.ui-card {
  margin: 0;
  color: blue;
}
/* … */
```

The computed styles are identical in both modes; only the emitted text differs. Grouping never
crosses the intervening `@media print` rule.

### Opt-in merge grouping

`mediaGrouping: "merge"` (or `@setup { media-grouping: merge; }`) is disabled by default. It keeps
the safe adjacent pass and adds one cross-run rule ([ADR-0024](decisions/ADR-0024-media-merge-grouping.md)):

```xessa
.card { @md { color: red; } }
.card { margin: 0; }
.card { @md { color: blue; } }
```

`safe` emits two separate `@md` blocks around the `margin` rule. `merge` moves the first run into
the second because the only crossed declaration (`margin`) is a disjoint property family; the
color declarations keep their relative order:

```css
.ui-card {
  margin: 0;
}

@media (min-width: 768px) {
  .ui-card {
    color: red;
    color: blue;
  }
}
```

The proof is per-property: a cascade winner for `color` is never affected by a crossed `margin`
declaration, and moving the run *before* the destination preserves source order, specificity,
conditions and `@layer` order. `all` and any value containing `var(` are wildcards; a run containing
one never merges, and nothing crosses one. The family approximation is conservative (`font-size`
and `font-family` share `font`), so a missed merge is possible; a changed cascade is not.

### What is *not* done

- **No reordering promises.** The compiler never promises that a different declaration order would
  compute differently, and never moves declarations to make a variant win.
- **No global grouping at the bottom.** Moving all rules for one selector into a single block at the
  end of the file is not generally safe (it can beat or lose to other rules and layers), so it is
  not offered.
- **No "ordered media" mode in v0.1.** A future opt-in ordered-media mode may define a different
  cascade contract; it must never be described as semantics-preserving.
- **No cascade repair.** If an earlier conditional is overridden by a later base, that is the
  authored result. Move the declaration yourself.
- **No specificity rewriting.** Flattened selectors keep native nesting specificity; mixed-specificity
  parent lists use `:is(...)` rather than naïve expansion.

## 4. Nested rules and flush boundaries

Nested rules are emitted at their authored position and flush the current run:

```xessa
.card {
  border: 1px solid;
  &:hover { opacity: 0.8; }
  background: white;
}
```

```css
.ui-card {
  border: 1px solid;
}

.ui-card:hover {
  opacity: 0.8;
}

.ui-card {
  background: white;
}
```

`border` and `background` share a selector and context, but they are not adjacent — the nested rule
sits between them — so they are not merged. This is exactly what keeps declaration order intact.

## 5. Browser evidence

The contract is verified in real engines, not just in golden strings:

```sh
bun run test:browser          # Playwright: Chromium (required), Firefox and WebKit when installed
bunx playwright test --project=chromium
```

Specs live in [`tests/browser/specs/`](../tests/browser/specs/):

| Spec | What it proves |
|---|---|
| `cascade.pw.ts` | Exact computed values at 320 / 767 / 768 / 1279 / 1280px boundaries. |
| `themes.pw.ts` | Light/dark, combined `@xl+dark`, runtime custom properties. |
| `interactions.pw.ts` | Reduced motion, hover, focus and disabled states. |
| `specificity.pw.ts` | `.card.card` beats `.card`; later duplicate declarations win. |
| `parity.pw.ts` | Pretty vs minified output produce identical computed styles. |
| `grouping.pw.ts` | `safe`, `none` and opt-in `merge` produce identical computed styles (ADR-0024). |

The harness compiles every scenario through the public `compile()` API and serves generated CSS to
the browser; no stylesheet is hand-written. Current recorded result (CSSX-BROWSER-01): **96 passed**
— 32 tests on each of Chromium, Firefox and WebKit, with no console errors, page errors, failed
requests or HTTP ≥ 400 responses. See [`tests/browser/README.md`](../tests/browser/README.md) for
engine setup and harness details.

## See also

- [grammar.md](grammar.md) — the syntax that produces these declarations.
- [configuration.md](configuration.md) — `mediaGrouping` and output settings.
- [compatibility.md](compatibility.md) — supported constructs and known gaps.
