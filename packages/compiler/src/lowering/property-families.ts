/**
 * Property-family classification for cascade-safe media-run merging (ADR-0024).
 *
 * The merge optimizer may move a conditional declaration run past intervening
 * declarations only when no crossed declaration can compete for the same
 * computed property. CSS cascade competition is per property: a winner for
 * `color` never changes the winner for `padding`. A conservative *family*
 * therefore groups every property that can write the same underlying value:
 *
 * - strip one vendor prefix (`-webkit-`, `-moz-`, `-ms-`, `-o-`);
 * - take the segment before the first `-` (`background-color` → `background`,
 *   `border-left-color` → `border`, `grid-template-columns` → `grid`,
 *   `margin-block` → `margin`);
 * - keep a custom property's full name (`--brand` is its own family and is
 *   case-sensitive).
 *
 * Standard shorthands share their longhands' first segment (`background`,
 * `border`, `font`, `grid`, `margin`, `mask`, `outline`, `transition`, …), so
 * the prefix rule already blocks shorthand/longhand competition. The frozen
 * {@link SHORTHAND_FAMILIES} table covers the standard properties whose
 * longhands do **not** share that segment (`inset` vs `top`, `place-*` vs
 * `align-*`/`justify-*`, `columns` vs `column-count`, `gap` vs `row-gap`,
 * `white-space` vs `text-wrap`, `font` vs `line-height`, logical `inline-size`
 * vs `width`, and the legacy aliases) plus the legacy vendor spellings of the
 * same values. Collapsing those groups is deliberately conservative: `width`
 * and `height` never compete, but both use the synthetic `size` family.
 *
 * Two declaration classes are **wildcards** and are never mergeable and never
 * crossed:
 *
 * - the `all` property, which resets every property; and
 * - any declaration whose value contains `var(`, because a custom property set
 *   by a crossed declaration could change the substituted value.
 *
 * Unknown *cross-prefix* shorthands are the documented limit of this
 * approximation (ADR-0024): a missed merge is acceptable, a wrong cascade is
 * not. Extend the frozen table when a new such property enters the language;
 * do not add speculative heuristics here.
 */

/** Vendor prefixes the family rule strips, in the ADR-0024 order. */
const VENDOR_PREFIX = /^-(?:webkit|moz|ms|o)-/;

/** A `var()` substitution makes a declaration depend on crossed declarations. */
const VAR_REFERENCE = /var\s*\(/i;

/**
 * Frozen equivalence families for shorthands, logical properties and legacy
 * aliases whose members do not share the first textual segment.
 *
 * Values are the family names `propertyFamily` compares. A key is the
 * unprefixed, lowercased property name. Entries intentionally over-block
 * (for example `width`/`height` share `size`); they never under-block a known
 * shorthand relationship.
 */
const SHORTHAND_FAMILIES: Readonly<Record<string, string>> = Object.freeze({
  // `inset` and the physical offsets it expands to.
  top: "inset",
  right: "inset",
  bottom: "inset",
  left: "inset",

  // Logical sizing competes with physical `width`/`height`; over-block both.
  width: "size",
  height: "size",
  "inline-size": "size",
  "block-size": "size",
  "logical-width": "size",
  "logical-height": "size",
  "min-logical-width": "min",
  "max-logical-width": "max",
  "min-logical-height": "min",
  "max-logical-height": "max",

  // `place-*` shorthands expand into the `align-*` and `justify-*` longhands.
  "align-content": "align",
  "align-items": "align",
  "align-self": "align",
  "justify-content": "align",
  "justify-items": "align",
  "justify-self": "align",
  "place-content": "align",
  "place-items": "align",
  "place-self": "align",
  "flex-align": "align",
  "flex-item-align": "align",
  "flex-line-pack": "align",
  "flex-pack": "align",
  "box-align": "align",
  "box-pack": "align",

  // `gap` expands into row/column gaps; legacy grid-gap spellings follow.
  gap: "gap",
  "row-gap": "gap",
  "column-gap": "gap",
  "grid-gap": "gap",
  "grid-row-gap": "gap",
  "grid-column-gap": "gap",

  // `columns` expands into `column-width` and `column-count`.
  columns: "columns",
  "column-width": "columns",
  "column-count": "columns",

  // `line-clamp` expands into these properties.
  "line-clamp": "line",
  "max-lines": "line",
  "block-ellipsis": "line",
  continue: "line",

  // `white-space` also expands into the `text-wrap-*` longhands.
  "white-space": "white",
  "white-space-collapse": "white",
  "white-space-trim": "white",
  "text-wrap": "white",
  "text-wrap-mode": "white",
  "text-wrap-style": "white",

  // The `font` shorthand resets `line-height`.
  "line-height": "font",
  "line-height-step": "font",

  // Page-break aliases and the fragmentation properties they set.
  "break-before": "break",
  "break-after": "break",
  "break-inside": "break",
  "page-break-before": "break",
  "page-break-after": "break",
  "page-break-inside": "break",
  "column-break-before": "break",
  "column-break-after": "break",
  "column-break-inside": "break",

  // `word-wrap` is the legacy name of `overflow-wrap`.
  "word-wrap": "overflow-wrap",
  "overflow-wrap": "overflow-wrap",

  // `color-adjust` is the legacy name of `print-color-adjust`.
  "color-adjust": "print-color-adjust",
  "print-color-adjust": "print-color-adjust",

  // The legacy `inset-area` name aliases `position-area`.
  "inset-area": "position",

  // The legacy `motion` family aliases the `offset` properties.
  motion: "offset",
  "motion-path": "offset",
  "motion-offset": "offset",
  "motion-rotation": "offset",

  // Legacy `order` and flexbox aliases.
  "flex-order": "order",
  "box-ordinal-group": "order",
  "box-direction": "flex",
  "box-flex": "flex",
  "box-lines": "flex",
  "box-orient": "flex",
});

/**
 * Family of one declaration, or `null` when the declaration is a wildcard.
 *
 * @param property Authored property name, custom properties included.
 * @param value Authored value slice; `!important` does not affect the result.
 * @returns The conservative family key, or `null` for `all`/`var()` barriers.
 */
export function propertyFamily(property: string, value: string): string | null {
  if (VAR_REFERENCE.test(value)) return null;

  if (property.startsWith("--")) {
    // Custom property names are case-sensitive and never share a family.
    return property;
  }

  const lower = property.trim().toLowerCase();
  if (lower === "" || lower === "all") return null;

  const unprefixed = lower.replace(VENDOR_PREFIX, "");
  if (unprefixed.startsWith("-")) {
    // Unknown vendor or malformed property: be safe and treat it as a barrier.
    return null;
  }

  const override = SHORTHAND_FAMILIES[unprefixed];
  if (override !== undefined) return override;

  const dash = unprefixed.indexOf("-");
  return dash < 0 ? unprefixed : unprefixed.slice(0, dash);
}

/** Whether one declaration is a wildcard barrier (`all` or a `var()` value). */
export function isWildcardDeclaration(property: string, value: string): boolean {
  return propertyFamily(property, value) === null;
}
