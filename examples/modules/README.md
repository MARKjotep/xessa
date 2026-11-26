# Modules example

Four `.cssx` files, no `xessa.config.json`, no `exclude` list, and one final stylesheet. Three files
declare `@setup { module: true; }`; only `src/main.cssx` emits CSS and a class map.

```text
modules/
  package.json               workspace boundary; no config at all
  src/tokens.cssx            @variables only; module: true
  src/components/card.cssx   .card and .card-icon; module: true
  src/components/ribbon.cssx .ribbon; module: true + map-inherit: false
  src/main.cssx              entry: imports the three modules and owns .page
  client/index.html          hand-written page linking app.css
  client/app.css             first css-dir destination (committed CLI output)
  generated/styles/app.css   second css-dir destination (identical bytes)
  generated/maps/app.map.js  page/card/cardIcon only
```

## Build

From this directory with an installed `xessa` CLI:

```sh
cd examples/modules && xessa build
```

From the repository root:

```sh
(cd examples/modules && node ../../packages/cli/dist/index.js build)
```

The build reports four entries and writes three files. `generated/` and `client/app.css` are
committed CLI output, not hand-written CSS. Rebuilding rewrites identical bytes.

## 1. No config, no exclude list

The default `**/*.cssx` include glob discovers all four files as entries. Each module declares
`@setup { module: true; }`, which suppresses that file's own stylesheet, class map, declarations
and CSS import unless it explicitly restores one of those keys ([ADR-0014](../../docs/decisions/ADR-0014-rule-merge-imports.md)).
Nothing is added to configuration when a component is added: the file marks itself. The minimal
`package.json` keeps the workspace root at the example directory instead of an enclosing repository.

## 2. One stylesheet from three modules

The entry imports the token module token-only and the two component modules with `styles`:

```xessa
@use "./tokens.cssx";
@use "./components/card.cssx" styles;
@use "./components/ribbon.cssx" styles;
```

Imported rules come first, depth-first in authored `@use` order, then the entry's own rules
(ADR-0014). In `app.css` that is:

1. `tokens.cssx` — values only, no rules;
2. `card.cssx` — `.card`, `.card:hover`, `.card-icon`;
3. `ribbon.cssx` — `.ribbon`;
4. `main.cssx` — `.page`.

The entry's `.page` rules stay last, so a local rule wins an equal-specificity tie with an imported
one.

## 3. Map inheritance

`generated/maps/app.map.js` contains:

```js
export const card = "card";
export const cardIcon = "card-icon";
export const page = "page";
```

`.ribbon` is in the CSS but has no binding. `ribbon.cssx` sets `map-inherit: false`, so its rules
still merge in cascade order while the importer's map, `.d.ts` and `classes` omit its classes
([ADR-0020](../../docs/decisions/ADR-0020-map-inheritance-opt-out.md)). Combining it with
`module: true` is the escape hatch for a rule-only module: the class exists in the emitted CSS and
nowhere in a generated map by default. `card.cssx` keeps the default (`true`), so `.card` and
`.card-icon` inherit as `card` and `cardIcon`.

## 4. A `css-dir` list

The entry names two destinations:

```xessa
@setup {
  css-dir: "../client", "../generated/styles";
  css-name: "app.css";
  map-dir: "../generated/maps";
  map-name: "app.map.js";
}
```

Both items resolve relative to `src/main.cssx`; the same stylesheet is written to `client/app.css`
and `generated/styles/app.css` with identical bytes. Each destination is a separate manifest
record, so `xessa clean` removes both copies. `client/index.html` is hand-written and is not in the
manifest: `clean` leaves it alone.

## 5. Minified by default

Compact CSS is the default ([ADR-0022](../../docs/decisions/ADR-0022-minified-output-default.md)); the
committed `app.css` is one line. To read the same output expanded, rebuild with
`xessa build --no-minify` or add `@setup { minify: false; }`. The class map and manifest are
unchanged either way.

## 6. Bundler note

The map does not import its stylesheet by default: `import-css` is `false`, and this page loads
`client/app.css` with a `<link>`. Bundlers that carry CSS through JavaScript imports can opt in
with `@setup { import-css: true; }` ([ADR-0021](../../docs/decisions/ADR-0021-opt-in-css-import.md));
the map then starts with a relative side-effect import of the first `css-dir` destination, while
both CSS copies are still written.
