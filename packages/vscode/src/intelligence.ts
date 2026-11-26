/**
 * Pure editor intelligence over an analyzed document: completions, hover,
 * definition, references, rename, outline and color helpers.
 *
 * This module deliberately avoids the `vscode` import. The extension providers
 * are thin adapters over these functions, and `bun test` exercises the same
 * code paths with plain text and offsets.
 */

import type { GroupDefinition, GroupUseSite } from "../../compiler/src/index.js";
import type {
  AnalyzeResult,
  ClassOccurrence,
  ColorOccurrence,
  ImportedModule,
  Range,
  TokenReference,
  TokenSymbol,
} from "./analysis.js";
import {
  BOOLEAN_SETUP_KEYS,
  SETUP_KEYS,
  collectTokenReferences,
  declarationSegments,
  forEachDeclaration,
  positionAt,
  rangeAt,
} from "./analysis.js";
import type { GroupSymbol, GroupVisibility } from "./groups.js";
import { GROUP_KEYWORD } from "./groups.js";
import type { KeyframeSymbol } from "./keyframes.js";
import { KEYFRAMES_KEYWORD, KEYFRAMES_NAMESPACE, keyframeDefinitionAt } from "./keyframes.js";
import { dirnamePath, isAbsolutePath, normalizePath, relativeTo } from "./paths.js";
import { propertyDoc } from "./property-docs.js";

/** Completion item kinds understood by the adapter. */
export type SuggestionKind =
  | "property"
  | "value"
  | "alias"
  | "directive"
  | "token"
  | "runtime-token"
  | "member"
  | "group"
  | "setup-key"
  | "setup-value"
  | "import-path"
  | "selector"
  | "pseudo"
  | "color";

/** One completion suggestion. */
export interface CompletionSuggestion {
  readonly label: string;
  readonly kind: SuggestionKind;
  readonly detail?: string;
  readonly documentation?: string;
  readonly insertText: string;
  /**
   * Optional snippet insert form (VS Code snippet syntax, `$0` = final cursor).
   *
   * The editor adapter prefers this over `insertText` when it is set, so a
   * suggestion can place the cursor inside the inserted text (`color: $0;`)
   * without the pure layer knowing anything about the editor.
   */
  readonly snippet?: string;
  /**
   * Optional replacement start for this single item, overriding the result
   * range. Used when a shared range would delete authored text (typed digits in
   * front of a unit) while sibling items still need the full typed word.
   */
  readonly replaceStart?: number;
  /** Optional editor sort key; lower sorts first (Xessa directives before natives). */
  readonly sortText?: string;
  /**
   * Optional editor filter text, overriding the label.
   *
   * VS Code narrows the list against the text its replacement range covers, so
   * an item whose range starts before the typed word (`(cl`, `#e7`) must be
   * filtered by that wider text or the editor hides an item the pure layer
   * correctly offered.
   */
  readonly filterText?: string;
  /**
   * Reopen the suggest list after accepting this item.
   *
   * Accepting a property inserts `property: ` (or `property: ;` with the caret
   * before the semicolon), so the value position is ready for a second list.
   * The editor adapter maps this to the `editor.action.triggerSuggest` command,
   * which VS Code runs after the insert or snippet has been applied. Only the
   * property family sets it: a value, unit, function, colour, selector or setup
   * item must leave the list closed.
   */
  readonly retriggerSuggest?: boolean;
}

/** Completion outcome with the range the editor should replace. */
export interface CompletionResult {
  readonly items: readonly CompletionSuggestion[];
  readonly replaceStart: number;
  readonly replaceEnd: number;
}

/** One id selector authored in the current document. */
export interface IdOccurrence {
  readonly name: string;
  /** Range of the name text after `#` (the rename-addressable span). */
  readonly range: Range;
}

/** Hover text plus the range it applies to. */
export interface HoverContent {
  readonly range: Range;
  readonly markdown: string;
}

/** A jump target inside the current document or an imported module. */
export interface DefinitionTarget {
  readonly file: string;
  readonly name: string;
  readonly range: Range;
}

/** Rename plan; token edits are single-file, group edits carry their module. */
export type RenamePlan =
  | {
      readonly ok: true;
      readonly placeholder: string;
      readonly edits: readonly {
        readonly range: Range;
        readonly newText: string;
        /** Defining/referencing module for cross-module group renames. */
        readonly file?: string;
      }[];
    }
  | { readonly ok: false; readonly reason: string };

/** Outline node mirroring a `DocumentSymbol` tree. */
export interface OutlineNode {
  readonly name: string;
  readonly detail?: string;
  readonly kind:
    | "setup"
    | "use"
    | "variables"
    | "runtime"
    | "media-types"
    | "token"
    | "rule"
    | "declaration"
    | "alias"
    | "group"
    | "native";
  readonly range: Range;
  readonly children: readonly OutlineNode[];
}

/** Contexts that drive completion. */
export type CompletionContext =
  | { readonly kind: "none" }
  | { readonly kind: "directive"; readonly word: string; readonly inSelector: boolean }
  | { readonly kind: "token"; readonly word: string }
  | { readonly kind: "member"; readonly namespace: string; readonly word: string }
  | { readonly kind: "group-member"; readonly word: string }
  | { readonly kind: "import-path"; readonly typed: string }
  | { readonly kind: "setup-key"; readonly word: string }
  | { readonly kind: "setup-value"; readonly key: string; readonly word: string }
  | { readonly kind: "property"; readonly word: string }
  | { readonly kind: "value"; readonly property?: string; readonly word: string }
  | { readonly kind: "important"; readonly word: string; readonly start: number }
  | { readonly kind: "keyframe-selector"; readonly word: string }
  | { readonly kind: "selector"; readonly word: string }
  | { readonly kind: "pseudo"; readonly word: string };

/** Options shared by the intelligence functions. */
export interface IntelligenceOptions {
  readonly analysis: AnalyzeResult;
  /** Generated class map from a compile, preferred over the local prefix guess. */
  readonly classMap?: Readonly<Record<string, string>>;
  /** Directory lister for import-path completion (`@use "`). */
  readonly listDirectory?: (absoluteDirectory: string) => readonly string[];
  /**
   * Accepting a property completion inserts `property: ;` and parks the cursor
   * before the semicolon (mirrors `css.completion.completePropertyWithSemicolon`).
   * Absent means enabled, matching the `xessa.editor.completePropertyWithSemicolon`
   * setting default.
   */
  readonly completePropertyWithSemicolon?: boolean;
}

/** Common CSS properties offered inside rule bodies. */
const CSS_PROPERTIES: readonly string[] = Object.freeze([
  "accent-color",
  "align-content",
  "align-items",
  "align-self",
  "animation",
  "animation-delay",
  "animation-direction",
  "animation-duration",
  "animation-fill-mode",
  "animation-iteration-count",
  "animation-name",
  "animation-play-state",
  "animation-timing-function",
  "appearance",
  "aspect-ratio",
  "backdrop-filter",
  "backface-visibility",
  "background",
  "background-attachment",
  "background-blend-mode",
  "background-clip",
  "background-color",
  "background-image",
  "background-origin",
  "background-position",
  "background-repeat",
  "background-size",
  "border",
  "border-bottom",
  "border-bottom-color",
  "border-collapse",
  "border-color",
  "border-left",
  "border-left-color",
  "border-radius",
  "border-right",
  "border-right-color",
  "border-style",
  "border-top",
  "border-top-color",
  "border-width",
  "bottom",
  "box-shadow",
  "box-sizing",
  "break-after",
  "break-before",
  "break-inside",
  "caret-color",
  "clip-path",
  "color",
  "color-scheme",
  "column-count",
  "column-fill",
  "column-gap",
  "column-rule-color",
  "column-width",
  "columns",
  "contain",
  "container",
  "container-name",
  "container-type",
  "content",
  "content-visibility",
  "cursor",
  "direction",
  "display",
  "fill",
  "filter",
  "flex",
  "flex-basis",
  "flex-direction",
  "flex-flow",
  "flex-grow",
  "flex-shrink",
  "flex-wrap",
  "float",
  "font",
  "font-family",
  "font-size",
  "font-style",
  "font-variant-numeric",
  "font-weight",
  "gap",
  "grid",
  "grid-area",
  "grid-auto-columns",
  "grid-auto-flow",
  "grid-auto-rows",
  "grid-column",
  "grid-row",
  "grid-template-areas",
  "grid-template-columns",
  "grid-template-rows",
  "height",
  "hyphens",
  "image-rendering",
  "inset",
  "inset-block",
  "inset-inline",
  "isolation",
  "justify-content",
  "justify-items",
  "justify-self",
  "left",
  "letter-spacing",
  "line-clamp",
  "line-height",
  "list-style",
  "margin",
  "margin-block",
  "margin-bottom",
  "margin-inline",
  "margin-left",
  "margin-right",
  "margin-top",
  "mask-image",
  "max-height",
  "max-width",
  "min-height",
  "min-width",
  "mix-blend-mode",
  "object-fit",
  "object-position",
  "opacity",
  "order",
  "outline",
  "outline-color",
  "outline-offset",
  "outline-style",
  "outline-width",
  "overflow",
  "overflow-wrap",
  "overflow-x",
  "overflow-y",
  "overscroll-behavior",
  "padding",
  "padding-block",
  "padding-bottom",
  "padding-inline",
  "padding-left",
  "padding-right",
  "padding-top",
  "perspective",
  "place-content",
  "place-items",
  "place-self",
  "pointer-events",
  "position",
  "quotes",
  "resize",
  "right",
  "rotate",
  "row-gap",
  "scale",
  "scroll-behavior",
  "scroll-margin",
  "scroll-padding",
  "scroll-snap-align",
  "scroll-snap-type",
  "scrollbar-color",
  "scrollbar-gutter",
  "scrollbar-width",
  "stroke",
  "table-layout",
  "text-align",
  "text-decoration",
  "text-decoration-color",
  "text-decoration-line",
  "text-decoration-style",
  "text-decoration-thickness",
  "text-indent",
  "text-overflow",
  "text-shadow",
  "text-transform",
  "text-underline-offset",
  "text-wrap",
  "top",
  "touch-action",
  "transform",
  "transform-origin",
  "transition",
  "transition-delay",
  "transition-duration",
  "transition-property",
  "transition-timing-function",
  "translate",
  "user-select",
  "vertical-align",
  "visibility",
  "white-space",
  "width",
  "will-change",
  "word-break",
  "word-spacing",
  "writing-mode",
  "z-index",
  "zoom",
]);

/**
 * Curated WebKit/Moz vendor-prefixed property spellings offered beside the
 * standard property they fall back to.
 *
 * They are compatibility spellings for engines (or older engine versions) that
 * still need the prefix, so they stay optional and lower priority. `base` names
 * the standard property they mirror (or the unprefixed non-standard family they
 * belong to), which is what surfaces them when the author types that base name;
 * `appear` therefore lists `appearance` and then both `appearance` variants.
 * `detail` tells the vendor family apart in the popup and in the tests.
 */
const VENDOR_PROPERTIES: readonly {
  readonly property: string;
  readonly base: string;
  readonly detail: string;
}[] = Object.freeze([
  { property: "-moz-appearance", base: "appearance", detail: "vendor-prefixed property" },
  { property: "-moz-border-radius", base: "border-radius", detail: "vendor-prefixed property" },
  { property: "-moz-box-shadow", base: "box-shadow", detail: "vendor-prefixed property" },
  { property: "-moz-hyphens", base: "hyphens", detail: "vendor-prefixed property" },
  {
    property: "-moz-osx-font-smoothing",
    base: "font-smoothing",
    detail: "vendor-prefixed property",
  },
  { property: "-moz-tab-size", base: "tab-size", detail: "vendor-prefixed property" },
  { property: "-moz-transform", base: "transform", detail: "vendor-prefixed property" },
  {
    property: "-moz-transform-origin",
    base: "transform-origin",
    detail: "vendor-prefixed property",
  },
  { property: "-moz-transition", base: "transition", detail: "vendor-prefixed property" },
  { property: "-moz-user-select", base: "user-select", detail: "vendor-prefixed property" },
  { property: "-webkit-animation", base: "animation", detail: "vendor-prefixed property" },
  { property: "-webkit-appearance", base: "appearance", detail: "vendor-prefixed property" },
  {
    property: "-webkit-backdrop-filter",
    base: "backdrop-filter",
    detail: "vendor-prefixed property",
  },
  {
    property: "-webkit-background-clip",
    base: "background-clip",
    detail: "vendor-prefixed property",
  },
  {
    property: "-webkit-border-radius",
    base: "border-radius",
    detail: "vendor-prefixed property",
  },
  { property: "-webkit-box-align", base: "box-align", detail: "vendor-prefixed property" },
  { property: "-webkit-box-flex", base: "box-flex", detail: "vendor-prefixed property" },
  {
    property: "-webkit-box-ordinal-group",
    base: "box-ordinal-group",
    detail: "vendor-prefixed property",
  },
  { property: "-webkit-box-orient", base: "box-orient", detail: "vendor-prefixed property" },
  { property: "-webkit-box-pack", base: "box-pack", detail: "vendor-prefixed property" },
  { property: "-webkit-box-shadow", base: "box-shadow", detail: "vendor-prefixed property" },
  { property: "-webkit-clip-path", base: "clip-path", detail: "vendor-prefixed property" },
  { property: "-webkit-filter", base: "filter", detail: "vendor-prefixed property" },
  {
    property: "-webkit-font-smoothing",
    base: "font-smoothing",
    detail: "vendor-prefixed property",
  },
  { property: "-webkit-hyphens", base: "hyphens", detail: "vendor-prefixed property" },
  { property: "-webkit-line-clamp", base: "line-clamp", detail: "vendor-prefixed property" },
  { property: "-webkit-mask", base: "mask", detail: "vendor-prefixed property" },
  { property: "-webkit-mask-image", base: "mask-image", detail: "vendor-prefixed property" },
  {
    property: "-webkit-mask-position",
    base: "mask-position",
    detail: "vendor-prefixed property",
  },
  { property: "-webkit-mask-repeat", base: "mask-repeat", detail: "vendor-prefixed property" },
  { property: "-webkit-mask-size", base: "mask-size", detail: "vendor-prefixed property" },
  {
    property: "-webkit-overflow-scrolling",
    base: "overflow-scrolling",
    detail: "vendor-prefixed property",
  },
  {
    property: "-webkit-tap-highlight-color",
    base: "tap-highlight-color",
    detail: "vendor-prefixed property",
  },
  {
    property: "-webkit-text-fill-color",
    base: "text-fill-color",
    detail: "vendor-prefixed property",
  },
  {
    property: "-webkit-text-size-adjust",
    base: "text-size-adjust",
    detail: "vendor-prefixed property",
  },
  { property: "-webkit-text-stroke", base: "text-stroke", detail: "vendor-prefixed property" },
  {
    property: "-webkit-text-stroke-color",
    base: "text-stroke-color",
    detail: "vendor-prefixed property",
  },
  {
    property: "-webkit-text-stroke-width",
    base: "text-stroke-width",
    detail: "vendor-prefixed property",
  },
  { property: "-webkit-touch-callout", base: "touch-callout", detail: "vendor-prefixed property" },
  { property: "-webkit-transform", base: "transform", detail: "vendor-prefixed property" },
  {
    property: "-webkit-transform-origin",
    base: "transform-origin",
    detail: "vendor-prefixed property",
  },
  { property: "-webkit-transition", base: "transition", detail: "vendor-prefixed property" },
  { property: "-webkit-user-select", base: "user-select", detail: "vendor-prefixed property" },
]);

/**
 * Whether a vendor property belongs in a property completion for `word`.
 *
 * A typed engine prefix (`web`, `-web`, `webkit`, `-webkit`, `moz`, `-moz`)
 * selects the whole vendor family, compared with the leading `-` optional on
 * both sides. Otherwise a vendor entry joins the list when its standard `base`
 * starts with the typed word, so `appear` surfaces the `appearance` variants
 * beside `appearance` itself. The empty word lists standard properties only.
 */
function vendorPropertyMatches(
  entry: { readonly property: string; readonly base: string },
  word: string,
): boolean {
  if (word === "") return false;
  const typed = word.startsWith("-") ? word.slice(1) : word;
  if (typed.startsWith("web") || typed.startsWith("moz")) {
    const name = entry.property.startsWith("-") ? entry.property.slice(1) : entry.property;
    return name.startsWith(typed);
  }
  return entry.base.startsWith(word);
}

/** General value keywords offered after a property colon. */
const CSS_VALUES: readonly string[] = Object.freeze([
  "absolute",
  "auto",
  "block",
  "border-box",
  "center",
  "contents",
  "currentColor",
  "flex",
  "flex-end",
  "flex-start",
  "grid",
  "hidden",
  "inherit",
  "initial",
  "inline",
  "inline-block",
  "inline-flex",
  "none",
  "normal",
  "pointer",
  "relative",
  "revert",
  "solid",
  "space-between",
  "stretch",
  "transparent",
  "unset",
  "visible",
]);

/** Property-specific value hints. */
const PROPERTY_VALUES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  display: ["block", "flex", "grid", "inline", "inline-block", "inline-flex", "none"],
  position: ["static", "relative", "absolute", "fixed", "sticky"],
  "text-align": ["left", "center", "right", "justify"],
  cursor: ["pointer", "default", "not-allowed", "text", "grab"],
  "font-weight": ["400", "500", "600", "700"],
  overflow: ["visible", "hidden", "auto", "scroll"],
  "flex-direction": ["row", "column", "row-reverse", "column-reverse"],
  "align-items": ["flex-start", "center", "flex-end", "stretch", "baseline"],
  "justify-content": ["flex-start", "center", "flex-end", "space-between", "space-around"],
});

/**
 * The standard CSS named colors (CSS Color 4), alphabetically ordered.
 *
 * `transparent` and `currentColor` are CSS-wide value keywords, not named
 * colors, so they stay in `CSS_VALUES` and are not repeated here.
 */
const CSS_NAMED_COLORS: readonly string[] = Object.freeze([
  "aliceblue",
  "antiquewhite",
  "aqua",
  "aquamarine",
  "azure",
  "beige",
  "bisque",
  "black",
  "blanchedalmond",
  "blue",
  "blueviolet",
  "brown",
  "burlywood",
  "cadetblue",
  "chartreuse",
  "chocolate",
  "coral",
  "cornflowerblue",
  "cornsilk",
  "crimson",
  "cyan",
  "darkblue",
  "darkcyan",
  "darkgoldenrod",
  "darkgray",
  "darkgreen",
  "darkgrey",
  "darkkhaki",
  "darkmagenta",
  "darkolivegreen",
  "darkorange",
  "darkorchid",
  "darkred",
  "darksalmon",
  "darkseagreen",
  "darkslateblue",
  "darkslategray",
  "darkslategrey",
  "darkturquoise",
  "darkviolet",
  "deeppink",
  "deepskyblue",
  "dimgray",
  "dimgrey",
  "dodgerblue",
  "firebrick",
  "floralwhite",
  "forestgreen",
  "fuchsia",
  "gainsboro",
  "ghostwhite",
  "gold",
  "goldenrod",
  "gray",
  "green",
  "greenyellow",
  "grey",
  "honeydew",
  "hotpink",
  "indianred",
  "indigo",
  "ivory",
  "khaki",
  "lavender",
  "lavenderblush",
  "lawngreen",
  "lemonchiffon",
  "lightblue",
  "lightcoral",
  "lightcyan",
  "lightgoldenrodyellow",
  "lightgray",
  "lightgreen",
  "lightgrey",
  "lightpink",
  "lightsalmon",
  "lightseagreen",
  "lightskyblue",
  "lightslategray",
  "lightslategrey",
  "lightsteelblue",
  "lightyellow",
  "lime",
  "limegreen",
  "linen",
  "magenta",
  "maroon",
  "mediumaquamarine",
  "mediumblue",
  "mediumorchid",
  "mediumpurple",
  "mediumseagreen",
  "mediumslateblue",
  "mediumspringgreen",
  "mediumturquoise",
  "mediumvioletred",
  "midnightblue",
  "mintcream",
  "mistyrose",
  "moccasin",
  "navajowhite",
  "navy",
  "oldlace",
  "olive",
  "olivedrab",
  "orange",
  "orangered",
  "orchid",
  "palegoldenrod",
  "palegreen",
  "paleturquoise",
  "palevioletred",
  "papayawhip",
  "peachpuff",
  "peru",
  "pink",
  "plum",
  "powderblue",
  "purple",
  "rebeccapurple",
  "red",
  "rosybrown",
  "royalblue",
  "saddlebrown",
  "salmon",
  "sandybrown",
  "seagreen",
  "seashell",
  "sienna",
  "silver",
  "skyblue",
  "slateblue",
  "slategray",
  "slategrey",
  "snow",
  "springgreen",
  "steelblue",
  "tan",
  "teal",
  "thistle",
  "tomato",
  "turquoise",
  "violet",
  "wheat",
  "white",
  "whitesmoke",
  "yellow",
  "yellowgreen",
]);

/**
 * The hex equivalent of every {@link CSS_NAMED_COLORS} entry, alphabetically
 * ordered and frozen.
 *
 * One constant carries the name→hex knowledge for both editor features that
 * need colour channels: the `#` completion state narrows named colours by the
 * digits the author typed (`#ff` → `red`), and `colorsAt` needs real channels to
 * hand VS Code a swatch. Values are the CSS Color 4 definitions as published in
 * the `vscode-css-languageservice` colour table.
 */
const CSS_NAMED_COLOR_HEX: Readonly<Record<string, string>> = Object.freeze({
  aliceblue: "#f0f8ff",
  antiquewhite: "#faebd7",
  aqua: "#00ffff",
  aquamarine: "#7fffd4",
  azure: "#f0ffff",
  beige: "#f5f5dc",
  bisque: "#ffe4c4",
  black: "#000000",
  blanchedalmond: "#ffebcd",
  blue: "#0000ff",
  blueviolet: "#8a2be2",
  brown: "#a52a2a",
  burlywood: "#deb887",
  cadetblue: "#5f9ea0",
  chartreuse: "#7fff00",
  chocolate: "#d2691e",
  coral: "#ff7f50",
  cornflowerblue: "#6495ed",
  cornsilk: "#fff8dc",
  crimson: "#dc143c",
  cyan: "#00ffff",
  darkblue: "#00008b",
  darkcyan: "#008b8b",
  darkgoldenrod: "#b8860b",
  darkgray: "#a9a9a9",
  darkgreen: "#006400",
  darkgrey: "#a9a9a9",
  darkkhaki: "#bdb76b",
  darkmagenta: "#8b008b",
  darkolivegreen: "#556b2f",
  darkorange: "#ff8c00",
  darkorchid: "#9932cc",
  darkred: "#8b0000",
  darksalmon: "#e9967a",
  darkseagreen: "#8fbc8f",
  darkslateblue: "#483d8b",
  darkslategray: "#2f4f4f",
  darkslategrey: "#2f4f4f",
  darkturquoise: "#00ced1",
  darkviolet: "#9400d3",
  deeppink: "#ff1493",
  deepskyblue: "#00bfff",
  dimgray: "#696969",
  dimgrey: "#696969",
  dodgerblue: "#1e90ff",
  firebrick: "#b22222",
  floralwhite: "#fffaf0",
  forestgreen: "#228b22",
  fuchsia: "#ff00ff",
  gainsboro: "#dcdcdc",
  ghostwhite: "#f8f8ff",
  gold: "#ffd700",
  goldenrod: "#daa520",
  gray: "#808080",
  green: "#008000",
  greenyellow: "#adff2f",
  grey: "#808080",
  honeydew: "#f0fff0",
  hotpink: "#ff69b4",
  indianred: "#cd5c5c",
  indigo: "#4b0082",
  ivory: "#fffff0",
  khaki: "#f0e68c",
  lavender: "#e6e6fa",
  lavenderblush: "#fff0f5",
  lawngreen: "#7cfc00",
  lemonchiffon: "#fffacd",
  lightblue: "#add8e6",
  lightcoral: "#f08080",
  lightcyan: "#e0ffff",
  lightgoldenrodyellow: "#fafad2",
  lightgray: "#d3d3d3",
  lightgreen: "#90ee90",
  lightgrey: "#d3d3d3",
  lightpink: "#ffb6c1",
  lightsalmon: "#ffa07a",
  lightseagreen: "#20b2aa",
  lightskyblue: "#87cefa",
  lightslategray: "#778899",
  lightslategrey: "#778899",
  lightsteelblue: "#b0c4de",
  lightyellow: "#ffffe0",
  lime: "#00ff00",
  limegreen: "#32cd32",
  linen: "#faf0e6",
  magenta: "#ff00ff",
  maroon: "#800000",
  mediumaquamarine: "#66cdaa",
  mediumblue: "#0000cd",
  mediumorchid: "#ba55d3",
  mediumpurple: "#9370d8",
  mediumseagreen: "#3cb371",
  mediumslateblue: "#7b68ee",
  mediumspringgreen: "#00fa9a",
  mediumturquoise: "#48d1cc",
  mediumvioletred: "#c71585",
  midnightblue: "#191970",
  mintcream: "#f5fffa",
  mistyrose: "#ffe4e1",
  moccasin: "#ffe4b5",
  navajowhite: "#ffdead",
  navy: "#000080",
  oldlace: "#fdf5e6",
  olive: "#808000",
  olivedrab: "#6b8e23",
  orange: "#ffa500",
  orangered: "#ff4500",
  orchid: "#da70d6",
  palegoldenrod: "#eee8aa",
  palegreen: "#98fb98",
  paleturquoise: "#afeeee",
  palevioletred: "#d87093",
  papayawhip: "#ffefd5",
  peachpuff: "#ffdab9",
  peru: "#cd853f",
  pink: "#ffc0cb",
  plum: "#dda0dd",
  powderblue: "#b0e0e6",
  purple: "#800080",
  rebeccapurple: "#663399",
  red: "#ff0000",
  rosybrown: "#bc8f8f",
  royalblue: "#4169e1",
  saddlebrown: "#8b4513",
  salmon: "#fa8072",
  sandybrown: "#f4a460",
  seagreen: "#2e8b57",
  seashell: "#fff5ee",
  sienna: "#a0522d",
  silver: "#c0c0c0",
  skyblue: "#87ceeb",
  slateblue: "#6a5acd",
  slategray: "#708090",
  slategrey: "#708090",
  snow: "#fffafa",
  springgreen: "#00ff7f",
  steelblue: "#4682b4",
  tan: "#d2b48c",
  teal: "#008080",
  thistle: "#d8bfd8",
  tomato: "#ff6347",
  turquoise: "#40e0d0",
  violet: "#ee82ee",
  wheat: "#f5deb3",
  white: "#ffffff",
  whitesmoke: "#f5f5f5",
  yellow: "#ffff00",
  yellowgreen: "#9acd32",
});

/**
 * Properties whose value grammar accepts a `<color>`, derived from the offered
 * property lists: the `color` property itself, every `*-color` longhand (vendor
 * spellings included) and the SVG paint properties `fill`/`stroke`.
 *
 * Shorthands that merely contain a color (`border`, `background`, `outline`)
 * stay out, so their keyword and function lists are unchanged; `width:` never
 * lists a color.
 */
const COLOR_PROPERTIES: ReadonlySet<string> = new Set([
  ...CSS_PROPERTIES.filter(
    (property) =>
      property === "color" ||
      property === "fill" ||
      property === "stroke" ||
      property.endsWith("-color"),
  ),
  ...VENDOR_PROPERTIES.map((entry) => entry.property).filter((property) =>
    property.endsWith("-color"),
  ),
]);

/**
 * Curated hex palette: neutrals, the primary/secondary hues and common brand
 * tones, grouped neutrals-first so a value list opens on the greys.
 *
 * A curated set (not all 16.7 million values) keeps the popup small while the
 * named colours of A49 stay available beside it; `#` narrows both families.
 */
const CSS_HEX_COLORS: readonly string[] = Object.freeze([
  // Neutrals.
  "#000000",
  "#111827",
  "#374151",
  "#6b7280",
  "#9ca3af",
  "#d1d5db",
  "#e5e7eb",
  "#ffffff",
  // Reds.
  "#7f1d1d",
  "#b91c1c",
  "#dc2626",
  "#e74c3c",
  "#ef4444",
  // Oranges and ambers.
  "#ea580c",
  "#f97316",
  "#f59e0b",
  "#fbbf24",
  // Greens.
  "#15803d",
  "#16a34a",
  "#22c55e",
  "#10b981",
  // Cyans and blues.
  "#0891b2",
  "#0ea5e9",
  "#2563eb",
  "#1d4ed8",
  "#1e40af",
  "#1e3a8a",
  // Purples and violets.
  "#6d28d9",
  "#7c3aed",
  "#8b5cf6",
  "#a855f7",
  "#663399",
  // Pinks and roses.
  "#db2777",
  "#ec4899",
  "#f43f5e",
]);

/**
 * Named-color items for a value word typed after a color-accepting property.
 *
 * The names join the keyword values' `0-` sort family, so the editor orders
 * them alphabetically beside `auto`, `inherit`, … and ahead of the `0~` units
 * and `1-` functions. `detail: "CSS color"` keeps them distinguishable from a
 * generic keyword value in the popup and in tests; `kind: "color"` is what makes
 * VS Code paint the swatch in the suggest widget (the adapter maps it to
 * `CompletionItemKind.Color`).
 */
function namedColorItems(word: string): readonly CompletionSuggestion[] {
  return CSS_NAMED_COLORS.filter(
    (color) => word === "" || color.startsWith(word),
  ).map<CompletionSuggestion>(namedColorItem);
}

/** One named colour, shared by the value state and the `#` state. */
function namedColorItem(color: string): CompletionSuggestion {
  return {
    label: color,
    kind: "color",
    detail: "CSS color",
    insertText: color,
    sortText: `0-${color}`,
  };
}

/**
 * Hex items for the curated palette.
 *
 * `detail` repeats the hex so the item is self-describing in a popup that may
 * render it as a swatch without a visible label, and it stays distinct from the
 * named colours' `detail` for tests and for the editor.
 */
function hexColorItems(word: string, replaceStart?: number): readonly CompletionSuggestion[] {
  const digits = word.toLowerCase();
  return CSS_HEX_COLORS.filter((hex) => hex.slice(1).startsWith(digits)).map<CompletionSuggestion>(
    (hex) => ({
      label: hex,
      kind: "color",
      detail: `CSS color ${hex}`,
      insertText: hex,
      sortText: `0-${hex}`,
      ...(replaceStart === undefined ? {} : { replaceStart }),
    }),
  );
}

/**
 * Offset of the `#` the author typed directly in front of a completion word.
 *
 * `#` is not a word character, so the scan stops at it: `color: #` has an empty
 * word and `color: #f7` only `f7`; a selector `#` behaves the same (`#` and
 * `#pan`). The offset is the replacement start for the colour and id items, so
 * accepting one swaps the typed `#…` prefix instead of appending to it
 * (`color: #` + `red` → `color: red`; selector `#pan` + `#panel` → `#panel`).
 */
function hashPrefixStart(text: string, offset: number, word: string): number | undefined {
  const hash = offset - word.length - 1;
  return hash >= 0 && text[hash] === "#" ? hash : undefined;
}

/**
 * Colour items for a `#`-prefixed value word.
 *
 * Filtering rule (stated once, used by the tests): the typed digits are
 * compared against the hex body of every candidate without its `#`, so `#f0`
 * narrows to the palette entries that start with `f0`; a named colour also
 * matches when its own name starts with the typed text (`#re` → `red`,
 * `rebeccapurple`). Each item carries the filter text of the criterion that
 * matched it, because VS Code narrows against the text its range covers
 * (`#re`) and would otherwise hide a hex-matched name (`#ff` → `red`).
 */
function hashColorItems(word: string, replaceStart: number): readonly CompletionSuggestion[] {
  const items: CompletionSuggestion[] = [...hexColorItems(word, replaceStart)];
  const digits = word.toLowerCase();
  for (const color of CSS_NAMED_COLORS) {
    const byName = word === "" || color.startsWith(word);
    const hex = CSS_NAMED_COLOR_HEX[color] ?? "";
    const byHex = digits === "" || hex.slice(1).startsWith(digits);
    if (!byName && !byHex) continue;
    items.push({
      ...namedColorItem(color),
      replaceStart,
      filterText: `#${byName ? color : hex.slice(1)}`,
    });
  }
  return items;
}

/**
 * Every colour authored in a declaration value, for the editor's inline
 * swatches. Hex values are property-agnostic; a named colour only counts as a
 * whole word inside a colour-accepting declaration (see `namedColorRuns`).
 */
function namedColorRuns(
  text: string,
): readonly { readonly start: number; readonly end: number; readonly name: string }[] {
  const runs: { start: number; end: number; name: string }[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '"' || char === "'") {
      index = skipString(text, index);
      continue;
    }
    if (char !== undefined && /[A-Za-z_]/.test(char)) {
      let end = index + 1;
      while (end < text.length && /[A-Za-z0-9_-]/.test(text[end] ?? "")) end += 1;
      // A run only counts as a colour when the whole run is a name: the `$` of a
      // token, the `#` of a hex value, the `-` of `--brand` or `red-500` and the
      // `.` of `url(red.png)` all make it something else.
      const before = text[index - 1];
      const after = text[end];
      const wholeWord =
        (before === undefined || !/[A-Za-z0-9_$#@.-]/.test(before)) &&
        (after === undefined || after !== ".");
      const name = text.slice(index, end).toLowerCase();
      if (wholeWord && Object.hasOwn(CSS_NAMED_COLOR_HEX, name)) {
        runs.push({ start: index, end, name });
      }
      index = end;
      continue;
    }
    index += 1;
  }
  return runs;
}

/** One CSS unit offered after a number in a declaration value. */
interface CssUnit {
  readonly unit: string;
  readonly description: string;
}

/**
 * CSS units suggested once a declaration value starts with a number.
 *
 * Values stay raw CSS (SPECIFICATION.md §3.3), so the list is property-agnostic:
 * `margin: 1` and `rotate: 1` offer the same units. Length, percentage, angle,
 * time, frequency and resolution units cover every unit-bearing value the
 * curated properties accept.
 */
const CSS_UNITS: readonly CssUnit[] = Object.freeze([
  { unit: "px", description: "CSS pixel: the reference device-independent length." },
  { unit: "rem", description: "Root em: relative to the root element's font size." },
  { unit: "em", description: "Em: relative to the element's own font size." },
  { unit: "%", description: "Percentage: relative to the property's own reference value." },
  { unit: "vh", description: "Viewport height: 1% of the viewport height." },
  { unit: "vw", description: "Viewport width: 1% of the viewport width." },
  { unit: "vmin", description: "1% of the smaller of viewport width and height." },
  { unit: "vmax", description: "1% of the larger of viewport width and height." },
  { unit: "ch", description: "Advance width of the `0` glyph in the current font." },
  { unit: "ex", description: "x-height of the current font." },
  { unit: "cm", description: "Centimeter: an absolute metric length." },
  { unit: "mm", description: "Millimeter: an absolute metric length." },
  { unit: "in", description: "Inch: an absolute length equal to 96px." },
  { unit: "pt", description: "Point: 1/72 of an inch." },
  { unit: "pc", description: "Pica: 12 points, or 1/6 of an inch." },
  { unit: "q", description: "Quarter-millimeter: an absolute metric length." },
  { unit: "fr", description: "Fraction: a share of the free space in a grid track." },
  { unit: "deg", description: "Degree: 1/360 of a full turn." },
  { unit: "grad", description: "Gradian: 1/400 of a full turn." },
  { unit: "rad", description: "Radian: 2π radians make a full turn." },
  { unit: "turn", description: "Turn: one full rotation, equal to 360deg." },
  { unit: "s", description: "Second: an absolute time." },
  { unit: "ms", description: "Millisecond: 1/1000 of a second." },
  { unit: "hz", description: "Hertz: cycles per second." },
  { unit: "khz", description: "Kilohertz: 1000 cycles per second." },
  { unit: "dpi", description: "Dots per inch: a resolution." },
  { unit: "dppx", description: "Dots per CSS pixel: 1dppx equals 96dpi." },
]);

/**
 * Unit items for a value word that starts with a number.
 *
 * The typed number stays in place: the item replaces only the units suffix the
 * author already typed (`1r` → `rem`), so accepting a unit can never delete
 * digits. `replaceStart` therefore sits after the number prefix instead of at
 * the start of the word (A46's typed-dot precedent), which keeps digit-leading
 * keyword values such as `font-weight: 4` → `400` on their own range.
 */
function unitItems(
  word: string,
  numberPrefix: string,
  offset: number,
): readonly CompletionSuggestion[] {
  const suffix = word.slice(numberPrefix.length).toLowerCase();
  const replaceStart = offset - suffix.length;
  return CSS_UNITS.filter(
    (unit) => suffix === "" || unit.unit.startsWith(suffix),
  ).map<CompletionSuggestion>((unit) => ({
    label: unit.unit,
    kind: "value",
    detail: "CSS unit",
    documentation: unit.description,
    insertText: unit.unit,
    // `0~` sorts after every keyword value (`0-…`) and before the functions
    // (`1-…`), so units sit between the two existing families.
    sortText: `0~${unit.unit}`,
    replaceStart,
  }));
}

/** Common pseudo-classes and pseudo-elements. */
const PSEUDOS: readonly string[] = Object.freeze([
  ":active",
  ":checked",
  ":disabled",
  ":enabled",
  ":first-child",
  ":focus",
  ":focus-visible",
  ":focus-within",
  ":hover",
  ":is(",
  ":last-child",
  ":not(",
  ":nth-child(",
  ":placeholder-shown",
  ":where(",
  "::after",
  "::before",
  "::placeholder",
  "::selection",
]);

/**
 * Engine-prefixed pseudo-classes and pseudo-elements offered after every
 * standard pseudo.
 *
 * They are compatibility fallbacks for engines that still need the prefix, so
 * they stay optional and sort last (`z-…` after the colon-prefixed labels).
 * `detail` tells the two families apart in the popup and in the tests.
 */
const VENDOR_PSEUDOS: readonly { readonly pseudo: string; readonly detail: string }[] =
  Object.freeze([
    { pseudo: ":-moz-any(", detail: "vendor-prefixed pseudo-class" },
    { pseudo: ":-moz-full-screen", detail: "vendor-prefixed pseudo-class" },
    { pseudo: ":-webkit-any(", detail: "vendor-prefixed pseudo-class" },
    { pseudo: ":-webkit-autofill", detail: "vendor-prefixed pseudo-class" },
    { pseudo: ":-webkit-full-screen", detail: "vendor-prefixed pseudo-class" },
    { pseudo: "::-moz-focus-inner", detail: "vendor-prefixed pseudo-element" },
    { pseudo: "::-moz-placeholder", detail: "vendor-prefixed pseudo-element" },
    { pseudo: "::-moz-selection", detail: "vendor-prefixed pseudo-element" },
    {
      pseudo: "::-webkit-calendar-picker-indicator",
      detail: "vendor-prefixed pseudo-element",
    },
    { pseudo: "::-webkit-file-upload-button", detail: "vendor-prefixed pseudo-element" },
    { pseudo: "::-webkit-input-placeholder", detail: "vendor-prefixed pseudo-element" },
    { pseudo: "::-webkit-scrollbar", detail: "vendor-prefixed pseudo-element" },
    { pseudo: "::-webkit-scrollbar-thumb", detail: "vendor-prefixed pseudo-element" },
    { pseudo: "::-webkit-scrollbar-track", detail: "vendor-prefixed pseudo-element" },
  ]);

/**
 * Whether a vendor pseudo matches the word typed after the colons.
 *
 * The leading `-` of the engine prefix is optional in the typed word, so `web`
 * and `-web` both find `::-webkit-scrollbar`; `moz` finds `::-moz-selection`.
 */
function vendorPseudoMatches(pseudo: string, word: string): boolean {
  if (word === "") return true;
  const name = pseudo.slice(pseudo.startsWith("::") ? 2 : 1);
  return name.startsWith(word) || name.slice(1).startsWith(word);
}

/** Nested-selector starters. */
const SELECTOR_STARTERS: readonly string[] = Object.freeze([
  "&",
  "&:focus-visible",
  "&:hover",
  "&:disabled",
  "& > ",
  "& + ",
]);

/**
 * Frame selectors offered at a statement position inside an `@keyframes`
 * block (SPECIFICATION.md §3.5/§6.4). Percentage selectors insert their `%`.
 */
const KEYFRAME_FRAME_SELECTORS: readonly {
  readonly label: string;
  readonly documentation: string;
}[] = Object.freeze([
  { label: "from", documentation: "Start frame; equivalent to `0%`." },
  { label: "to", documentation: "End frame; equivalent to `100%`." },
  { label: "0%", documentation: "Frame at the start of the animation timeline." },
  { label: "25%", documentation: "Frame one quarter into the animation timeline." },
  { label: "50%", documentation: "Frame halfway through the animation timeline." },
  { label: "75%", documentation: "Frame three quarters into the animation timeline." },
  { label: "100%", documentation: "Frame at the end of the animation timeline." },
]);

/**
 * One CSS function offered in a declaration value. Values stay raw CSS, so any
 * function is legal after the colon of any property (SPECIFICATION.md §3.3).
 */
interface CssFunction {
  /** Function name without the opening parenthesis. */
  readonly name: string;
  /**
   * What the function does and the shape of its arguments (one or two
   * sentences). Shared verbatim by completion documentation and hover.
   */
  readonly usage: string;
  /** Short call example rendered after the usage as the sample call. */
  readonly example: string;
  /** Inserted text when it differs from `name(` (`var(` inserts `var(--`). */
  readonly insertText?: string;
}

/**
 * Documentation body shared by completion and hover: the usage sentence, a
 * blank line, then the sample call. One format for every curated function.
 */
function cssFunctionDocumentation(fn: CssFunction): string {
  return `${fn.usage}\n\nExample: \`${fn.example}\``;
}

/**
 * Curated CSS functions suggested in the `value` context. The list is a hint,
 * not a constraint: authored values are raw CSS slices the compiler never
 * rewrites, so anything an engine accepts still compiles.
 */
const CSS_FUNCTIONS: readonly CssFunction[] = Object.freeze([
  {
    name: "calc",
    usage: "Math expression mixing units, e.g. percentages and pixels.",
    example: "calc(100% - 20px)",
  },
  {
    name: "min",
    usage:
      "Smallest of its arguments. Takes two or more comma-separated lengths, percentages or numbers; mixed units are allowed.",
    example: "min(50%, 40rem)",
  },
  {
    name: "max",
    usage:
      "Largest of its arguments. Takes two or more comma-separated lengths, percentages or numbers; mixed units are allowed.",
    example: "max(50%, 40rem)",
  },
  {
    name: "clamp",
    usage:
      "Clamps a preferred value between a minimum and a maximum. Takes three comma-separated arguments: minimum, preferred, maximum.",
    example: "clamp(0.5rem, 1rem + 2vw, 2rem)",
  },
  {
    name: "var",
    usage:
      "Reads a custom property at computed-value time. Takes the property name (it must start with `--`), then an optional fallback after a comma.",
    example: "var(--ui-color)",
    insertText: "var(--",
  },
  {
    name: "env",
    usage:
      "Reads a user-agent environment variable such as a device safe-area inset. Takes the variable name, then an optional fallback after a comma.",
    example: "env(safe-area-inset-top)",
  },
  {
    name: "attr",
    usage:
      "Reads an attribute value from the element. Takes the attribute name, then an optional type or unit.",
    example: "attr(data-label)",
  },
  {
    name: "url",
    usage:
      "References an external resource. Takes a quoted string or an unquoted URL between the parentheses.",
    example: 'url("./icon.svg")',
  },
  {
    name: "rgb",
    usage:
      "RGB color. Takes three red, green and blue channels (0–255 integers or percentages), then an optional alpha after a slash.",
    example: "rgb(37 99 235)",
  },
  {
    name: "rgba",
    usage:
      "RGB color with alpha. Takes three channels and then the alpha as a fourth comma-separated argument.",
    example: "rgba(37, 99, 235, 0.5)",
  },
  {
    name: "hsl",
    usage:
      "Hue/saturation/lightness color. Takes an angle and two percentages, then an optional alpha after a slash.",
    example: "hsl(220 80% 55%)",
  },
  {
    name: "hsla",
    usage:
      "Hue/saturation/lightness color with alpha. Takes an angle, two percentages and the alpha as a fourth comma-separated argument.",
    example: "hsla(220, 80%, 55%, 0.5)",
  },
  {
    name: "color-mix",
    usage:
      "Mixes two colors in a color space. Takes `in <space>` first, then two colors separated by a comma, each with an optional percentage.",
    example: "color-mix(in oklab, red, blue)",
  },
  {
    name: "linear-gradient",
    usage:
      "Gradient along a straight line. Takes an optional angle or `to <side>`, then two or more comma-separated color stops.",
    example: "linear-gradient(to right, red, blue)",
  },
  {
    name: "radial-gradient",
    usage:
      "Gradient radiating from a center. Takes an optional shape, size and position, then two or more comma-separated color stops.",
    example: "radial-gradient(circle, red, blue)",
  },
  {
    name: "conic-gradient",
    usage:
      "Gradient swept around a center. Takes an optional `from <angle>` and `at <position>`, then two or more comma-separated color stops.",
    example: "conic-gradient(from 45deg, red, blue)",
  },
  {
    name: "repeating-linear-gradient",
    usage:
      "Gradient that repeats along a straight line. Takes an optional angle or `to <side>`, then color stops with explicit lengths so the band repeats.",
    example: "repeating-linear-gradient(45deg, red 0 10px, blue 10px 20px)",
  },
  {
    name: "cubic-bezier",
    usage:
      "Custom easing curve. Takes four numbers `x1, y1, x2, y2` defining two control points; the x values must stay between 0 and 1.",
    example: "cubic-bezier(0.4, 0, 0.2, 1)",
  },
  {
    name: "steps",
    usage:
      "Stepped easing curve. Takes a step count, then an optional position keyword (`end`, `start`, `jump-none`, `jump-both`).",
    example: "steps(4, end)",
  },
  {
    name: "translate",
    usage:
      "Moves the element. Takes one or two lengths or percentages: the x offset, then an optional y offset.",
    example: "translate(10px, 20px)",
  },
  {
    name: "rotate",
    usage: "Rotates the element. Takes a single angle.",
    example: "rotate(45deg)",
  },
  {
    name: "scale",
    usage:
      "Scales the element. Takes a unitless factor, or two factors for separate x and y scaling.",
    example: "scale(1.05)",
  },
  {
    name: "blur",
    usage:
      "Gaussian blur filter. Takes the standard deviation as a length; `0` leaves the element sharp.",
    example: "blur(4px)",
  },
  {
    name: "brightness",
    usage:
      "Brightness filter. Takes a unitless factor or a percentage, where `1` and `100%` leave the element unchanged.",
    example: "brightness(1.2)",
  },
  {
    name: "counter",
    usage:
      "Generates a counter value in generated content. Takes the counter name, then an optional list style.",
    example: "counter(item)",
  },
]);

/**
 * Function items for a value word.
 *
 * `replaceStart` moves the item's replacement range in front of the shared
 * value range; the call-opener state uses it to cover the typed `(`, so
 * accepting `clamp(` swaps the opener instead of duplicating it.
 */
function functionItems(word: string, replaceStart?: number): readonly CompletionSuggestion[] {
  return CSS_FUNCTIONS.filter(
    (fn) => word === "" || fn.name.startsWith(word),
  ).map<CompletionSuggestion>((fn) => ({
    label: `${fn.name}(`,
    kind: "value",
    detail: "CSS function",
    documentation: cssFunctionDocumentation(fn),
    insertText: fn.insertText ?? `${fn.name}(`,
    sortText: `1-${fn.name}`,
    // The paren state replaces the typed `(`, so VS Code narrows against `(cl`
    // while the label stays `clamp(`; the filter text carries the paren so the
    // editor's own narrowing cannot hide an offered function.
    ...(replaceStart === undefined ? {} : { replaceStart, filterText: `(${fn.name}` }),
  }));
}

/** Directives offered after `@` at a statement start. */
const DIRECTIVES: readonly { readonly name: string; readonly documentation: string }[] =
  Object.freeze([
    { name: "setup", documentation: "File-level output, prefix and emission settings." },
    { name: "use", documentation: 'Import a token-only module: `@use "./theme.cssx" as theme;`.' },
    { name: "variables", documentation: "Compile-time tokens substituted into declarations." },
    { name: "runtime", documentation: "Tokens emitted as native CSS custom properties." },
    { name: "media-types", documentation: "File-local media alias definitions." },
  ]);

/**
 * The `@group` directive, offered at the top level (definition) and inside a
 * rule body (use site). ADR-0017: a definition is inert and the same syntax
 * inside a rule applies a group's defaults plus per-use-site overrides.
 */
const GROUP_DIRECTIVE = Object.freeze({
  name: "group",
  documentation:
    "Reusable declaration group (ADR-0017): `@group.card { … }` defines defaults at the top level; the same syntax inside a rule body applies them with optional overrides.",
});

/**
 * Native CSS at-rules Xessa passes through unchanged (SPECIFICATION.md §3.4,
 * §3.5). The compiler matches this list in `parser/rule.ts` `NATIVE_AT_RULES`,
 * which the public barrel does not export, so the editor mirrors it here.
 *
 * `nested` marks the conditional group rules CSS Nesting accepts inside a
 * style rule; every other native at-rule is offered at top level only.
 */
interface NativeAtRule {
  readonly name: string;
  readonly nested: boolean;
  readonly documentation: string;
}

const NATIVE_AT_RULES: readonly NativeAtRule[] = Object.freeze([
  {
    name: "keyframes",
    nested: false,
    documentation:
      "Defines animation keyframes (`@keyframes spin { from { … } to { … } }`); used by `animation-name`.",
  },
  {
    name: "media",
    nested: true,
    documentation:
      "Conditional group rule matching a native media query (`@media (min-width: 768px) { … }`).",
  },
  {
    name: "font-face",
    nested: false,
    documentation: "Declares a downloadable font face (`@font-face { font-family: …; src: … }`).",
  },
  {
    name: "import",
    nested: false,
    documentation:
      "Native CSS `@import`; Xessa `@use` is the token/module import and emits no `@import`.",
  },
  {
    name: "property",
    nested: false,
    documentation:
      'Registers a typed custom property (`@property --brand { syntax: "<color>"; … }`).',
  },
  {
    name: "supports",
    nested: true,
    documentation:
      "Conditional group rule matching a feature query (`@supports (display: grid) { … }`).",
  },
  {
    name: "layer",
    nested: true,
    documentation: "Declares a cascade layer or layer block (`@layer base { … }`).",
  },
  {
    name: "container",
    nested: true,
    documentation:
      "Conditional group rule matching a container query (`@container (min-width: 30rem) { … }`).",
  },
  {
    name: "page",
    nested: false,
    documentation: "Styles paged-media output (`@page :first { … }`).",
  },
  {
    name: "charset",
    nested: false,
    documentation: "Declares the stylesheet encoding; must be the very first statement.",
  },
  {
    name: "counter-style",
    nested: false,
    documentation: "Defines a custom counter style (`@counter-style thumbs { … }`).",
  },
  {
    name: "document",
    nested: false,
    documentation: "Legacy engine-specific document wrapper; passed through unchanged.",
  },
  {
    name: "font-feature-values",
    nested: false,
    documentation: "Defines `font-variant-alternates` keywords for a font family.",
  },
  {
    name: "font-palette-values",
    nested: false,
    documentation: "Defines a custom color palette for a color font.",
  },
  {
    name: "namespace",
    nested: false,
    documentation: "Declares an XML namespace prefix; must precede style rules.",
  },
  {
    name: "nest",
    nested: true,
    documentation: "Legacy explicit nesting at-rule; plain Xessa nesting needs no `@nest`.",
  },
  {
    name: "position-try",
    nested: false,
    documentation: "Defines a position-try fallback set for anchored positioning.",
  },
  {
    name: "scope",
    nested: true,
    documentation: "Scopes a group of rules to a selector subtree (`@scope (.card) { … }`).",
  },
  {
    name: "starting-style",
    nested: true,
    documentation: "Supplies starting styles for entry transitions (`@starting-style { … }`).",
  },
  {
    name: "view-transition",
    nested: false,
    documentation: "Defines view-transition pseudo-element styles (`@view-transition { … }`).",
  },
]);

/** Setup key documentation shown as completion documentation. */
const SETUP_DOCS: Readonly<Record<string, string>> = Object.freeze({
  prefix: "Class name prefix (e.g. `ui` produces `ui-button`).",
  "css-dir": "CSS output directory, resolved relative to the source file.",
  "css-name": "Optional CSS basename (must end with `.css`).",
  "map-dir": "JS class map output directory, relative to the source file.",
  "map-name": "Optional JS map basename (must end in `.js`).",
  "emit-css": "Write the stylesheet (default true).",
  "emit-map": "Write the JS class map (default true).",
  "map-types": "Write `.d.ts` beside the JS map (default false; opt-in).",
  "emit-types": "Deprecated alias for `map-types` (default false).",
  "source-map": "Write a CSS source map (default false).",
  minify: "Compact generated CSS whitespace (default true; set false for readable output).",
  module:
    "Rule-bearing module: imported for its rules only, so the file plans no artifacts of its own (ADR-0014).",
  "map-inherit":
    "Keep a style-merged module's class bindings out of the importer's map and `.d.ts` (default true; ADR-0020).",
  "import-css":
    "Prepend a CSS side-effect import to the generated class map for bundlers (default false; ADR-0021).",
  "media-grouping":
    "Grouping of emitted conditional runs (default `safe`; `merge` is the opt-in disjoint-family optimizer; ADR-0024).",
});

/**
 * Exact Markdown for the `media-grouping` hover card (owner request, ADR-0024).
 * Kept as one frozen string so the intelligence test can pin it verbatim.
 */
const MEDIA_GROUPING_HOVER = [
  "**`media-grouping`** — Xessa `@setup` key",
  "",
  "Controls how emitted CSS groups conditional declaration runs.",
  "",
  "- `none` — no grouping; every run is emitted where it was authored.",
  "- `safe` — default; merges only adjacent runs with the same selector, condition and native at-rule context.",
  "- `merge` — additionally merges same-selector/same-condition media runs across declarations whose property families are provably disjoint. It never merges across a shared property family, `all`, a `var()` value, or a different selector or condition.",
  "",
  "Default: `safe`, unless the project config or this file overrides it. See ADR-0024.",
].join("\n");

/** Value completions for `@setup` keys that accept a small fixed set. */
const SETUP_VALUE_COMPLETIONS: Readonly<Record<string, readonly CompletionSuggestion[]>> =
  Object.freeze({
    "media-grouping": Object.freeze<CompletionSuggestion[]>([
      {
        label: "merge",
        kind: "setup-value",
        detail: "Merge disjoint-family conditional runs (ADR-0024)",
        insertText: "merge",
      },
      {
        label: "safe",
        kind: "setup-value",
        detail: "Merge adjacent compatible runs (default)",
        insertText: "safe",
      },
      {
        label: "none",
        kind: "setup-value",
        detail: "No grouping; emit runs in place",
        insertText: "none",
      },
    ]),
  });

/**
 * `@setup` keys offered by completion: the analysis table plus ADR-0020's
 * module-side `map-inherit` switch and ADR-0021's `import-css` opt-in.
 */
const SETUP_COMPLETION_KEYS: readonly string[] = Object.freeze([
  ...SETUP_KEYS,
  "map-inherit",
  "import-css",
]);

/** Boolean `@setup` keys offered by completion (analysis table plus the opt-ins). */
const SETUP_BOOLEAN_COMPLETION_KEYS: readonly string[] = Object.freeze([
  ...BOOLEAN_SETUP_KEYS,
  "map-inherit",
  "import-css",
]);

function skipString(text: string, start: number): number {
  const quote = text[start];
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === "\\") {
      index += 2;
      continue;
    }
    if (text[index] === quote) return index + 1;
    index += 1;
  }
  return text.length;
}

/** Offset of the string or comment containing `offset`, if any. */
function enclosingString(text: string, offset: number): number | undefined {
  let index = 0;
  while (index < offset && index < text.length) {
    const char = text[index];
    if (char === '"' || char === "'") {
      const end = skipString(text, index);
      if (offset <= end) return index;
      index = end;
      continue;
    }
    if (char === "/" && text[index + 1] === "*") {
      const close = text.indexOf("*/", index + 2);
      const end = close < 0 ? text.length : close + 2;
      if (offset <= end) return index;
      index = end;
      continue;
    }
    if (char === "/" && text[index + 1] === "/") {
      const close = text.indexOf("\n", index + 2);
      const end = close < 0 ? text.length : close + 1;
      if (offset <= end) return index;
      index = end;
      continue;
    }
    index += 1;
  }
  return undefined;
}

function scanBackWord(text: string, offset: number): { start: number; word: string } {
  let start = offset;
  while (start > 0) {
    const char = text[start - 1];
    if (char !== undefined && /[A-Za-z0-9_@$.-]/.test(char)) start -= 1;
    else break;
  }
  return { start, word: text.slice(start, offset) };
}

/**
 * Offset of the `(` the author just typed in front of a value word.
 *
 * `scanBackWord` stops at `(`, so the word behind a typed paren is only what
 * the author typed since (`width: (cl` → `cl`). A paren belongs to a named call
 * when a name character sits directly in front of it (`calc(`); its opener is
 * not text the author can replace, so it is not this state.
 */
function callOpenerStart(text: string, offset: number, word: string): number | undefined {
  const paren = offset - word.length - 1;
  if (paren < 0 || text[paren] !== "(") return undefined;
  const before = text[paren - 1];
  return before !== undefined && /[A-Za-z0-9_-]/.test(before) ? undefined : paren;
}

/**
 * Offset of a lone `&` the author typed with no selector text behind it.
 *
 * `&` is not a word character, so the word after it is empty and the item range
 * would collapse to the caret. The nested-selector starters are self-contained
 * (`&:hover` already begins with `&`), so they must replace the authored
 * ampersand instead of appending to it (`&` + `&:hover` → `&&:hover`). Only the
 * starter items take this start; the class items keep the caret range (A46).
 */
function authoredAmpersandStart(text: string, offset: number, word: string): number | undefined {
  return word === "" && text[offset - 1] === "&" ? offset - 1 : undefined;
}

/**
 * Start of a `!` run typed directly before the completion word (CSSX-U07).
 *
 * `!` is not a word character, so `color: red!` scans an empty word and
 * `color: red!im` only `im`. The returned offset is the replacement start for
 * the `!important` item: accepting it swaps the typed run instead of appending,
 * so the authored text never becomes `!!important`.
 */
function importantBangStart(text: string, offset: number, word: string): number | undefined {
  let bang = offset - word.length - 1;
  if (bang < 0 || text[bang] !== "!") return undefined;
  while (bang > 0 && text[bang - 1] === "!") bang -= 1;
  return bang;
}

/**
 * Colon run typed directly before the completion word at `offset`.
 *
 * The word scan stops at `:`, so the typed pseudo colons sit in front of it
 * (`&:` + `hov`). `start` is the replacement start for a pseudo suggestion and
 * covers the colons (plus any spaces between them and the word), so accepting
 * `:hover` after `&:` yields `&:hover` instead of `&::hover`.
 */
function typedColons(text: string, offset: number, word: string): { count: number; start: number } {
  let start = offset - word.length;
  while (start > 0 && (text[start - 1] === " " || text[start - 1] === "\t")) start -= 1;
  const afterColons = start;
  while (start > 0 && text[start - 1] === ":") start -= 1;
  const count = afterColons - start;
  return { count, start: count === 0 ? offset - word.length : start };
}

/**
 * Selector or pseudo-selector position at `offset`.
 *
 * A colon run directly before the typed word makes it a pseudo position; the
 * suggestion list then filters on the text after the colons (`hov` → `:hover`)
 * while the replacement range covers the typed colons.
 */
function selectorOrPseudo(text: string, offset: number, word: string): CompletionContext {
  return typedColons(text, offset, word).count > 0
    ? { kind: "pseudo", word }
    : { kind: "selector", word };
}

function statementStart(text: string, offset: number): number {
  for (let index = offset - 1; index >= 0; index -= 1) {
    const char = text[index];
    if (char === ";" || char === "{" || char === "}") return index;
  }
  return -1;
}

/**
 * Statement text between the last boundary and the last line break before
 * `offset`.
 *
 * Value completion after a property colon only needs the current line: a
 * multi-line statement (`color: red` followed by a new declaration line) must
 * not read back as a single declaration (ADR-0011 recovery).
 */
function currentLineStatement(text: string, offset: number): string {
  const lineStart = text.lastIndexOf("\n", offset - 1);
  return text.slice(Math.max(statementStart(text, offset) + 1, lineStart + 1), offset);
}

/**
 * Frame-selector word at `offset` inside an `@keyframes` block. The ordinary
 * word scan stops at `%`, so percentage selectors need their own scan to keep
 * the replacement range over the whole `50%`.
 */
function frameSelectorWord(text: string, offset: number): string {
  let start = offset;
  while (start > 0) {
    const char = text[start - 1];
    if (char !== undefined && /[0-9A-Za-z%]/.test(char)) start -= 1;
    else break;
  }
  return text.slice(start, offset);
}

/**
 * Whether `at` begins a statement: only whitespace separates it from the
 * previous `;`, `{` or `}` boundary. Inside a rule body this tells a real
 * at-rule statement apart from a modifier alias in a declaration value.
 */
function atStatementStart(text: string, at: number): boolean {
  return text.slice(statementStart(text, at) + 1, at).trim() === "";
}

/**
 * Brace nesting depth at `offset`, ignoring braces inside strings and comments.
 *
 * Directive completion classifies top level from the authored text instead of
 * parser spans, so recovery-pending statements (an omitted semicolon, an
 * unclosed construct) cannot suppress the top-level directive list.
 */
function braceDepthAt(text: string, offset: number): number {
  let depth = 0;
  let index = 0;
  while (index < offset) {
    const char = text[index];
    if (char === '"' || char === "'") {
      index = skipString(text, index);
      continue;
    }
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "/" && text[index + 1] === "*") {
      const close = text.indexOf("*/", index + 2);
      index = close < 0 ? text.length : close + 2;
      continue;
    }
    if (char === "/" && text[index + 1] === "/") {
      const close = text.indexOf("\n", index + 2);
      index = close < 0 ? text.length : close + 1;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") depth = Math.max(0, depth - 1);
    index += 1;
  }
  return depth;
}

interface SpanLike {
  readonly start: number;
  readonly end: number;
}

interface RuleLike {
  readonly selector: string;
  readonly selectorSpan: SpanLike;
  readonly span: SpanLike;
  readonly body: readonly unknown[];
}

interface NativeAtRuleLike {
  readonly name: string;
  readonly prelude: string;
  readonly span: SpanLike;
  readonly block: readonly unknown[];
}

/** Block members of any AST node: rule/conditional `body` and at-rule `block`. */
function blockMembers(node: {
  readonly body?: readonly unknown[];
  readonly block?: readonly unknown[];
}): readonly unknown[] {
  return [...(node.body ?? []), ...(node.block ?? [])];
}

/**
 * Innermost style rule containing `offset` and whether another rule encloses it.
 */
interface EnclosingRule {
  readonly rule: RuleLike;
  /** True when the rule itself sits inside another rule's body. */
  readonly nestedInRule: boolean;
}

/**
 * Innermost style rule containing `offset`.
 *
 * Native at-rule blocks are traversed too: `@keyframes spin { from { … } }`
 * parses each frame block as an ordinary `rule` nested in the at-rule's
 * `block` member (SPECIFICATION.md §3.5), so frame bodies behave exactly like
 * rule bodies.
 */
function findEnclosingRule(analysis: AnalyzeResult, offset: number): EnclosingRule | undefined {
  let found: EnclosingRule | undefined;
  const visit = (node: unknown, insideRule: boolean): void => {
    const candidate = node as Partial<RuleLike> & { kind?: string; block?: readonly unknown[] };
    if (
      candidate.span !== undefined &&
      (offset < candidate.span.start || offset > candidate.span.end)
    ) {
      return;
    }
    const isRule = candidate.kind === "rule" && candidate.span !== undefined;
    if (isRule) found = { rule: candidate as RuleLike, nestedInRule: insideRule };
    for (const child of blockMembers(candidate)) visit(child, insideRule || isRule);
  };
  for (const item of analysis.ast.items) visit(item, false);
  return found;
}

/**
 * Innermost native CSS at-rule block containing `offset` (SPECIFICATION.md
 * §3.5). Statement at-rules such as `@import` carry no `block` and are never
 * reported as an enclosing construct.
 */
function findEnclosingNativeAtRule(
  analysis: AnalyzeResult,
  offset: number,
): NativeAtRuleLike | undefined {
  let found: NativeAtRuleLike | undefined;
  const visit = (node: unknown): void => {
    const candidate = node as Partial<NativeAtRuleLike> & {
      kind?: string;
      body?: readonly unknown[];
    };
    if (
      candidate.span !== undefined &&
      (offset < candidate.span.start || offset > candidate.span.end)
    ) {
      return;
    }
    if (
      candidate.kind === "native-at-rule" &&
      candidate.span !== undefined &&
      candidate.block !== undefined
    ) {
      found = candidate as NativeAtRuleLike;
    }
    for (const child of blockMembers(candidate)) visit(child);
  };
  for (const item of analysis.ast.items) visit(item);
  return found;
}

/**
 * Innermost `@group.<name>` definition or use-site block containing `offset`.
 *
 * A group body holds declarations only (ADR-0017), so the interior is a
 * declaration context even though a definition is not a style rule; the
 * authored brace depth separates the block interior from its closing brace.
 */
function findEnclosingGroupBody(analysis: AnalyzeResult, offset: number): SpanLike | undefined {
  let found: SpanLike | undefined;
  const visit = (node: unknown): void => {
    const candidate = node as {
      kind?: string;
      span?: SpanLike;
      body?: readonly unknown[];
      block?: readonly unknown[];
    };
    if (
      candidate.span !== undefined &&
      (offset < candidate.span.start || offset > candidate.span.end)
    ) {
      return;
    }
    if (
      (candidate.kind === "group-definition" || candidate.kind === "group-use-site") &&
      candidate.span !== undefined
    ) {
      found = candidate.span;
    }
    for (const child of candidate.body ?? []) visit(child);
    for (const child of candidate.block ?? []) visit(child);
  };
  for (const item of analysis.ast.items) visit(item);
  return found;
}

function findEnclosingSetup(analysis: AnalyzeResult, offset: number): SpanLike | undefined {
  for (const item of analysis.ast.items) {
    if (item.kind === "setup" && offset >= item.span.start && offset <= item.span.end)
      return item.span;
  }
  return undefined;
}

function findEnclosingDeclaration(
  analysis: AnalyzeResult,
  offset: number,
): { readonly span: SpanLike; readonly property: string } | undefined {
  let found: { span: SpanLike; property: string } | undefined;
  const visit = (node: unknown): void => {
    const candidate = node as {
      kind?: string;
      span?: SpanLike;
      property?: string;
      body?: readonly unknown[];
      block?: readonly unknown[];
      declarations?: readonly unknown[];
    };
    if (
      candidate.kind === "declaration" &&
      candidate.property !== undefined &&
      candidate.span !== undefined
    ) {
      if (offset >= candidate.span.start && offset <= candidate.span.end) {
        found = { span: candidate.span, property: candidate.property };
      }
      return;
    }
    for (const child of candidate.body ?? []) visit(child);
    for (const child of candidate.block ?? []) visit(child);
    for (const child of candidate.declarations ?? []) visit(child);
  };
  for (const item of analysis.ast.items) visit(item);
  return found;
}

function importByAlias(analysis: AnalyzeResult, alias: string): ImportedModule | undefined {
  return analysis.imports.find((entry) => entry.alias === alias);
}

/** Editor-readable label of a defining module (`this file`, `@use` specifier, path). */
function groupModuleLabel(analysis: AnalyzeResult, file: string): string {
  if (normalizePath(file) === normalizePath(analysis.path)) return "this file";
  const direct = analysis.imports.find(
    (entry) => normalizePath(entry.path) === normalizePath(file),
  );
  if (direct !== undefined) return `\`${direct.specifier}\``;
  const relative = relativeTo(dirnamePath(analysis.path), file);
  return isAbsolutePath(relative) ? `\`${relative}\`` : `\`./${relative}\``;
}

/** Default-declaration markdown lines shared by completion and hover. */
function groupDefaultLines(symbol: GroupSymbol): string[] {
  if (symbol.defaults.length === 0) return ["_No default declarations._"];
  return symbol.defaults.map((entry) => `\`${entry.property}: ${entry.value}\``);
}

/**
 * Hover section for default declarations.
 *
 * One bullet per declaration keeps every property on its own rendered line
 * (consecutive inline-code paragraphs otherwise soft-collapse into one).
 * An empty definition keeps the existing single italic line instead of an
 * empty heading.
 */
function groupDefaultSection(
  defaults: readonly { readonly property: string; readonly value: string }[],
): string[] {
  if (defaults.length === 0) return ["_No default declarations._"];
  return ["**Defaults**", ...defaults.map((entry) => `- \`${entry.property}: ${entry.value}\``)];
}

/** Completion item for one visible group name, local first and ambiguity marked. */
function groupItem(
  analysis: AnalyzeResult,
  entry: GroupVisibility,
  typed: string,
): CompletionSuggestion | undefined {
  if (!entry.name.startsWith(typed)) return undefined;
  const skeleton = `${entry.name} {\n  \n}`;
  if (entry.kind === "ambiguous") {
    const modules = entry.candidates.map((candidate) => groupModuleLabel(analysis, candidate.file));
    return {
      label: entry.name,
      kind: "group",
      detail: `ambiguous group — ${modules.join(" and ")}`,
      documentation: `Multiple visible definitions of \`@group.${entry.name}\`. The compiler reports XESSA2001 at a use site until one import is removed or a local definition is added.`,
      insertText: skeleton,
      sortText: `2-${entry.name}`,
    };
  }
  const local = normalizePath(entry.symbol.file) === normalizePath(analysis.path);
  return {
    label: entry.name,
    kind: "group",
    detail: local
      ? "group — defined in this file"
      : `group — defined in ${groupModuleLabel(analysis, entry.symbol.file)}`,
    documentation: `**@group.${entry.name}** — ${local ? "defined in this file" : `defined in ${groupModuleLabel(analysis, entry.symbol.file)}`}\n\nDefaults:\n${groupDefaultLines(entry.symbol).join("\n")}`,
    insertText: skeleton,
    sortText: `${local ? "0" : "1"}-${entry.name}`,
  };
}

/** Compact frames summary shared by keyframe completion and hover. */
function keyframeFramesLine(frames: readonly string[]): string {
  if (frames.length === 0) return "_No frame blocks; the definition is empty._";
  return `Frames: ${frames.map((frame) => `\`${frame}\``).join(", ")}`;
}

/** Completion item for one visible keyframe definition, duplicates included. */
function keyframeCompletion(
  analysis: AnalyzeResult,
  symbol: KeyframeSymbol,
  typed: string,
  variant: "local" | "imported" | "duplicate" | "ambiguous",
): CompletionSuggestion | undefined {
  if (!symbol.name.startsWith(typed)) return undefined;
  const local = variant === "local";
  const module = local ? "this file" : groupModuleLabel(analysis, symbol.file);
  const suffix =
    variant === "duplicate" ? " (duplicate name)" : variant === "ambiguous" ? " (ambiguous)" : "";
  const lines = [
    `**$keyframes.${symbol.name}** — ${local ? "defined in this file" : `defined in ${module}`}`,
    "",
    keyframeFramesLine(symbol.frames),
  ];
  if (variant === "ambiguous") {
    lines.push(
      "",
      "Duplicate keyframe names are valid CSS (ADR-0015); rename needs one unambiguous definition.",
    );
  }
  return {
    label: symbol.name,
    kind: "member",
    detail: `keyframe — defined in ${module}${suffix}`,
    documentation: lines.join("\n"),
    insertText: symbol.name,
    sortText: `${local ? "0" : variant === "imported" ? "1" : "2"}-${symbol.name}`,
  };
}

/** Cursor result for a `@group.<name>` definition or use site. */
export interface GroupCursor {
  readonly site: "definition" | "use-site";
  readonly name: string;
  readonly nameRange: Range;
  /** Whole `@group.<name>` keyword, the hover range. */
  readonly keywordRange: Range;
  /** Authored definition node when the cursor is on a definition name. */
  readonly definition?: GroupDefinition;
  /** Authored use-site node when the cursor is on a use-site member. */
  readonly useSite?: GroupUseSite;
}

/**
 * `@group.<name>` construct under the cursor, from AST spans only.
 *
 * Rename and prepare-rename address only the name text. Hover passes
 * `includeKeyword` so the whole `@group.<name>` span (the `@group` word and the
 * dot included) resolves to the construct instead of falling through to the
 * media-alias scanner.
 */
export function groupAt(
  analysis: AnalyzeResult,
  offset: number,
  options: { readonly includeKeyword?: boolean } = {},
): GroupCursor | undefined {
  const inName = (span: SpanLike, name: string): boolean => {
    const start = span.start + GROUP_KEYWORD.length;
    const from = options.includeKeyword === true ? span.start : start;
    return offset >= from && offset <= start + name.length;
  };
  const cursorOf = (
    span: SpanLike,
    name: string,
    site: "definition" | "use-site",
    node: GroupDefinition | GroupUseSite,
  ): GroupCursor => {
    const start = span.start + GROUP_KEYWORD.length;
    return {
      site,
      name,
      nameRange: rangeAt(analysis.lineStarts, start, start + name.length),
      keywordRange: rangeAt(analysis.lineStarts, span.start, start + name.length),
      ...(site === "definition"
        ? { definition: node as GroupDefinition }
        : { useSite: node as GroupUseSite }),
    };
  };

  for (const item of analysis.ast.items) {
    if (item.kind === "group-definition" && inName(item.span, item.name)) {
      return cursorOf(item.span, item.name, "definition", item);
    }
  }

  let found: GroupCursor | undefined;
  const visit = (node: unknown): void => {
    if (found !== undefined) return;
    const candidate = node as {
      kind?: string;
      name?: string;
      span?: SpanLike;
      body?: readonly unknown[];
      block?: readonly unknown[];
    };
    if (
      candidate.kind === "group-use-site" &&
      candidate.name !== undefined &&
      candidate.span !== undefined
    ) {
      if (inName(candidate.span, candidate.name)) {
        found = cursorOf(candidate.span, candidate.name, "use-site", node as GroupUseSite);
      }
      return;
    }
    for (const child of candidate.body ?? []) visit(child);
    for (const child of candidate.block ?? []) visit(child);
  };
  for (const item of analysis.ast.items) visit(item);
  return found;
}

/** Base property names the use-site block repeats from the definition. */
function groupOverrides(useSite: GroupUseSite, symbol: GroupSymbol): readonly string[] {
  const defaults = new Set(symbol.defaults.map((entry) => entry.property));
  const overrides: string[] = [];
  for (const declaration of useSite.declarations) {
    if (!defaults.has(declaration.property)) continue;
    if (overrides.includes(declaration.property)) continue;
    overrides.push(declaration.property);
  }
  return overrides;
}

/** Hover markdown for a group definition or use site (analysis, never compilation). */
function groupHover(analysis: AnalyzeResult, cursor: GroupCursor): HoverContent {
  const range = cursor.keywordRange;
  const title = `@group.${cursor.name}`;
  if (cursor.site === "definition") {
    const declarations = cursor.definition?.declarations ?? [];
    const lines = [`**${title}** — group definition`, ""];
    if (declarations.length === 0) {
      lines.push("_No default declarations; the group is inert._");
    } else {
      lines.push(...groupDefaultSection(declarations));
    }
    return { markdown: lines.join("\n"), range };
  }

  const entry = analysis.groups.find((candidate) => candidate.name === cursor.name);
  if (entry === undefined) {
    return {
      markdown: [
        `**Unknown group \`${title}\`**`,
        "",
        "No visible definition in this module. Groups are visible from this file and its `styles` imports; the compiler reports XESSA2001 and omits the block.",
      ].join("\n"),
      range,
    };
  }
  if (entry.kind === "ambiguous") {
    const modules = entry.candidates.map((candidate) => groupModuleLabel(analysis, candidate.file));
    return {
      markdown: [
        `**Ambiguous group \`${title}\`**`,
        "",
        `Two visible definitions: ${modules.slice(0, 2).join(" and ")}. The compiler reports XESSA2001 at this use site and expands no declarations; add a local definition or remove one \`styles\` import.`,
      ].join("\n"),
      range,
    };
  }

  const overrides =
    cursor.useSite === undefined ? [] : groupOverrides(cursor.useSite, entry.symbol);
  const lines = [
    `**${title}** — group use site`,
    "",
    `Defined in ${groupModuleLabel(analysis, entry.symbol.file)}.`,
    "",
    ...groupDefaultSection(entry.symbol.defaults),
  ];
  if (overrides.length > 0) {
    lines.push("", "**Overrides at this use site**", ...overrides.map((name) => `- \`${name}\``));
  }
  return { markdown: lines.join("\n"), range };
}

function sameRange(left: Range, right: Range): boolean {
  return (
    left.start.line === right.start.line &&
    left.start.character === right.start.character &&
    left.end.line === right.end.line &&
    left.end.character === right.end.character
  );
}

/** Group rename plan across the visible module set (ADR-0017 item 5). */
function renameGroup(cursor: GroupCursor, newName: string, analysis: AnalyzeResult): RenamePlan {
  if (!TOKEN_NAME_PATTERN.test(newName)) {
    return {
      ok: false,
      reason:
        "Group names must start with a letter or underscore and contain letters, digits, `_` or `-`.",
    };
  }
  const entry = analysis.groups.find((candidate) => candidate.name === cursor.name);
  if (entry === undefined) {
    return {
      ok: false,
      reason: `Unknown group "@group.${cursor.name}" is not visible in this module.`,
    };
  }
  if (entry.kind === "ambiguous") {
    const modules = entry.candidates.map((candidate) => groupModuleLabel(analysis, candidate.file));
    return {
      ok: false,
      reason: `Ambiguous group "@group.${cursor.name}": it is defined in ${modules.join(" and ")}. Add a local definition or rename one definition first.`,
    };
  }
  if (cursor.site === "definition" && !sameRange(cursor.nameRange, entry.symbol.declaration)) {
    return {
      ok: false,
      reason: `Duplicate group definition "@group.${cursor.name}"; only the first definition is addressable.`,
    };
  }
  return {
    ok: true,
    placeholder: entry.symbol.name,
    edits: [
      { file: entry.symbol.file, range: entry.symbol.declaration, newText: newName },
      ...entry.symbol.references.map((reference) => ({
        file: reference.file,
        range: reference.name,
        newText: newName,
      })),
    ],
  };
}

/** Cursor result for a `@keyframes <name>` definition or `$keyframes.<name>` reference. */
export interface KeyframeCursor {
  readonly site: "definition" | "reference";
  readonly name: string;
  readonly nameRange: Range;
  /** Whole `$keyframes.<name>` range for a reference; the name range for a definition. */
  readonly keywordRange: Range;
  /** Frame selectors discovered on a definition cursor. */
  readonly frames?: readonly string[];
}

/**
 * `@keyframes <name>` definition or `$keyframes.<name>` reference under the cursor.
 *
 * Definitions come from top-level native at-rule spans; references come from the
 * same `$` scanner the token intelligence uses, filtered to the built-in
 * `keyframes` namespace. Only the current document is scanned here; rename also
 * edits references attributed in other visible modules.
 */
export function keyframeAt(
  text: string,
  offset: number,
  analysis: AnalyzeResult,
): KeyframeCursor | undefined {
  const contains = (range: Range): boolean =>
    offsetAt(analysis.lineStarts, range.start) <= offset &&
    offset <= offsetAt(analysis.lineStarts, range.end);

  for (const item of analysis.ast.items) {
    if (item.kind !== "native-at-rule") continue;
    const definition = keyframeDefinitionAt(item, text, analysis.lineStarts);
    if (definition === undefined || !contains(definition.range)) continue;
    return {
      site: "definition",
      name: definition.name,
      nameRange: definition.range,
      keywordRange: definition.range,
      frames: definition.frames,
    };
  }

  const reference = collectTokenReferences(text, analysis.ast).find(
    (candidate) =>
      candidate.namespace === KEYFRAMES_NAMESPACE &&
      offset >= candidate.start &&
      offset <= candidate.end,
  );
  if (reference !== undefined) {
    return {
      site: "reference",
      name: reference.name,
      nameRange: rangeAt(
        analysis.lineStarts,
        reference.start + KEYFRAMES_KEYWORD.length,
        reference.end,
      ),
      keywordRange: rangeAt(analysis.lineStarts, reference.start, reference.end),
    };
  }

  // Tolerant-parse fallback: the declaration holding the reference may have been
  // dropped (recovery) or may live where the declaration walker does not reach.
  // Match the whole authored construct from raw text so the `keyframes`
  // namespace word itself resolves exactly like the `$` and name parts.
  const textual = keyframeReferenceFromText(text, offset);
  if (textual === undefined) return undefined;
  return {
    site: "reference",
    name: textual.name,
    nameRange: rangeAt(analysis.lineStarts, textual.nameStart, textual.end),
    keywordRange: rangeAt(analysis.lineStarts, textual.start, textual.end),
  };
}

/** Plain-identifier keyframe names, matching the compiler's registration rule. */
const KEYFRAME_TEXT_NAME = /^[A-Za-z_-][A-Za-z0-9_-]*$/;

/**
 * Textual `$keyframes.<name>` construct containing `offset`.
 *
 * This is the fallback for references that tolerant parsing did not keep in the
 * AST. It deliberately ignores strings, comments and `url(...)` contents and
 * only accepts the built-in `keyframes` namespace, so plain `$tokens`,
 * `$theme.member` and `@keyframes` header hovers are untouched.
 */
function keyframeReferenceFromText(
  text: string,
  offset: number,
):
  | {
      readonly start: number;
      readonly end: number;
      readonly nameStart: number;
      readonly name: string;
    }
  | undefined {
  const start = text.lastIndexOf(KEYFRAMES_KEYWORD, offset);
  if (start < 0) return undefined;
  if (start > 0 && /[A-Za-z0-9_$-]/.test(text[start - 1] ?? "")) return undefined;
  const nameStart = start + KEYFRAMES_KEYWORD.length;
  let end = nameStart;
  while (end < text.length && /[A-Za-z0-9_-]/.test(text[end] ?? "")) end += 1;
  if (end === nameStart || offset > end) return undefined;
  const name = text.slice(nameStart, end);
  if (!KEYFRAME_TEXT_NAME.test(name)) return undefined;
  if (enclosingString(text, start) !== undefined) return undefined;
  if (insideUrl(text, start)) return undefined;
  return { start, end, nameStart, name };
}

/** Whether `offset` falls inside the parentheses of an authored `url(...)`. */
function insideUrl(text: string, offset: number): boolean {
  const open = text.toLowerCase().lastIndexOf("url(", offset);
  if (open < 0) return false;
  let depth = 0;
  let index = open;
  while (index < offset) {
    const char = text[index];
    if (char === '"' || char === "'") {
      index = skipString(text, index);
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    index += 1;
  }
  return depth > 0;
}

/** Hover markdown for a keyframe definition or `$keyframes.<name>` reference. */
function keyframeHover(analysis: AnalyzeResult, cursor: KeyframeCursor): HoverContent {
  const range = cursor.keywordRange;
  if (cursor.site === "definition") {
    return {
      markdown: [
        `**@keyframes ${cursor.name}** — keyframe definition`,
        "",
        keyframeFramesLine(cursor.frames ?? []),
      ].join("\n"),
      range,
    };
  }

  const title = `$keyframes.${cursor.name}`;
  const entry = analysis.keyframes.find((candidate) => candidate.name === cursor.name);
  if (entry === undefined) {
    return {
      markdown: [
        `**Unknown keyframe \`${title}\`**`,
        "",
        "No visible `@keyframes` definition in this module. Keyframe names are visible from this file and its `styles` imports; a token-only import exposes none. The compiler reports XESSA2001 at this reference.",
      ].join("\n"),
      range,
    };
  }
  if (entry.kind === "ambiguous") {
    const modules = entry.candidates.map((candidate) => groupModuleLabel(analysis, candidate.file));
    return {
      markdown: [
        `**Ambiguous keyframe \`${title}\`**`,
        "",
        `Defined in ${modules.join(" and ")}. Duplicate keyframe names are valid CSS and the compiler reports no conflict; add a local \`@keyframes\` block or remove one \`styles\` import to make rename unambiguous.`,
      ].join("\n"),
      range,
    };
  }

  const local = normalizePath(entry.symbol.file) === normalizePath(analysis.path);
  const lines = [
    `**${title}** — keyframe`,
    "",
    local
      ? "Defined in this file."
      : `Defined in ${groupModuleLabel(analysis, entry.symbol.file)}.`,
    "",
    keyframeFramesLine(entry.symbol.frames),
  ];
  if (entry.duplicates.length > 0) {
    const modules = entry.duplicates.map((duplicate) => groupModuleLabel(analysis, duplicate.file));
    lines.push(
      "",
      `Also declared in ${modules.join(" and ")} (duplicate names are valid CSS; the local definition is the rename target).`,
    );
  }
  return { markdown: lines.join("\n"), range };
}

/** Valid CSS identifier used for keyframe names (plain identifier, optional leading hyphen). */
const KEYFRAME_NAME_PATTERN = /^-?[A-Za-z_][A-Za-z0-9_-]*$/;

/** Keyframe rename plan across the visible module set (ADR-0015). */
function renameKeyframe(
  cursor: KeyframeCursor,
  newName: string,
  analysis: AnalyzeResult,
): RenamePlan {
  if (!KEYFRAME_NAME_PATTERN.test(newName)) {
    return {
      ok: false,
      reason:
        "Keyframe names must be a valid CSS identifier: start with a letter or underscore (optionally one leading hyphen) and contain only letters, digits, `_` or `-`.",
    };
  }
  const entry = analysis.keyframes.find((candidate) => candidate.name === cursor.name);
  if (entry === undefined) {
    return {
      ok: false,
      reason: `Unknown keyframe "$keyframes.${cursor.name}" is not visible in this module.`,
    };
  }
  if (entry.kind === "ambiguous") {
    const modules = entry.candidates.map((candidate) => groupModuleLabel(analysis, candidate.file));
    return {
      ok: false,
      reason: `Ambiguous keyframe "$keyframes.${cursor.name}": it is defined in ${modules.join(" and ")}. Add a local \`@keyframes\` block or rename one definition first.`,
    };
  }
  if (cursor.site === "definition" && !sameRange(cursor.nameRange, entry.symbol.declaration)) {
    return {
      ok: false,
      reason: `Duplicate keyframe definition "@keyframes ${cursor.name}"; only the first definition is addressable.`,
    };
  }
  if (newName !== entry.symbol.name && analysis.keyframes.some((entry) => entry.name === newName)) {
    return {
      ok: false,
      reason: `A keyframe named "${newName}" already exists in scope.`,
    };
  }
  return {
    ok: true,
    placeholder: entry.symbol.name,
    edits: [
      { file: entry.symbol.file, range: entry.symbol.declaration, newText: newName },
      ...entry.symbol.references.map((reference) => ({
        file: reference.file,
        range: reference.name,
        newText: newName,
      })),
      ...entry.symbol.animationNames.map((declaration) => ({
        file: declaration.file,
        range: declaration.value,
        newText: newName,
      })),
    ],
  };
}

/**
 * Property names a tolerant declaration may carry (`width`, `-webkit-x`,
 * `--brand`). `&:` and similar selector fragments are parsed as declarations by
 * the recovery grammar and must not be treated as declarations here.
 */
const DECLARATION_PROPERTY_PATTERN = /^(--[A-Za-z0-9_-]+|-?[A-Za-z][A-Za-z0-9-]*)$/;

/** Detect the completion context at `offset`. */
export function contextAt(
  text: string,
  offset: number,
  analysis: AnalyzeResult,
): CompletionContext {
  const stringStart = enclosingString(text, offset);
  if (stringStart !== undefined) {
    const head = text.slice(Math.max(0, stringStart - 64), stringStart);
    if (/@use\s*$/.test(head)) {
      return { kind: "import-path", typed: text.slice(stringStart + 1, offset) };
    }
    return { kind: "none" };
  }

  const { word } = scanBackWord(text, offset);

  if (word.startsWith(GROUP_KEYWORD)) {
    return { kind: "group-member", word: word.slice(GROUP_KEYWORD.length) };
  }
  if (word.startsWith("@")) {
    return { kind: "directive", word: word.slice(1), inSelector: braceDepthAt(text, offset) > 0 };
  }
  if (word.startsWith("$")) {
    const inner = word.slice(1);
    const dot = inner.indexOf(".");
    if (dot >= 0) {
      return { kind: "member", namespace: inner.slice(0, dot), word: inner.slice(dot + 1) };
    }
    return { kind: "token", word: inner };
  }
  const wordDot = word.indexOf(".");
  if (wordDot > 0) {
    const namespace = word.slice(0, wordDot);
    if (importByAlias(analysis, namespace) !== undefined) {
      return { kind: "member", namespace, word: word.slice(wordDot + 1) };
    }
  }

  const setup = findEnclosingSetup(analysis, offset);
  if (setup !== undefined) {
    const head = text.slice(setup.start, offset);
    // Only a colon inside the current setting makes a value context: `;` ends a
    // setting and `{` opens the block, so a completed line such as
    // `prefix: "ui";` must not hijack the next line's key completion.
    const boundary = Math.max(head.lastIndexOf(";"), head.lastIndexOf("{"));
    const colon = head.lastIndexOf(":");
    if (colon > boundary) {
      const key = head
        .slice(boundary + 1, colon)
        .trim()
        .split(/\s+/)
        .pop();
      return { kind: "setup-value", key: key ?? "", word };
    }
    return { kind: "setup-key", word };
  }

  const declaration = findEnclosingDeclaration(analysis, offset);
  // The tolerant parser also echoes non-declaration statements such as `&:` as
  // declarations; only a plausible property name keeps the declaration path, so
  // nested-selector starters still reach the rule-body classification below.
  if (declaration !== undefined && DECLARATION_PROPERTY_PATTERN.test(declaration.property)) {
    const colon = text.indexOf(":", declaration.span.start);
    if (colon >= 0 && offset > colon) {
      // A `!` typed after the value is the `!important` state (CSSX-U07). It
      // needs a value word in front of it, so a property-name position, an
      // empty value and selector/`@` contexts never reach it.
      const bang = importantBangStart(text, offset, word);
      if (bang !== undefined && text.slice(colon + 1, bang).trim() !== "") {
        return { kind: "important", word, start: bang };
      }
      // ADR-0011 recovery keeps an unterminated declaration whose span swallows
      // the following statement lines. A line break with value content behind it
      // and a bare-word current line is a new declaration line inside the rule
      // body, not a value continuation (S6/S7 keep punctuation or no value).
      const lineBreak = text.lastIndexOf("\n", offset - 1);
      if (
        lineBreak > colon &&
        text.slice(colon + 1, lineBreak).trim() !== "" &&
        /^[\t ]*[A-Za-z-]*[\t ]*$/.test(text.slice(lineBreak + 1, offset))
      ) {
        return { kind: "property", word };
      }
      return { kind: "value", property: declaration.property, word };
    }
    return { kind: "property", word };
  }

  // ADR-0017: a group definition (top level) and a use site (inside a rule)
  // accept declarations only. Their interiors are therefore declaration
  // contexts exactly like a rule body, but never a selector context. Without
  // this branch a top-level definition body fell through to `none`, so the
  // suggest list dropped every CSS property (board bug 25).
  const groupBody = findEnclosingGroupBody(analysis, offset);
  if (groupBody !== undefined && braceDepthAt(text, offset) > braceDepthAt(text, groupBody.start)) {
    const statement = currentLineStatement(text, offset);
    const declarationStatement = /^\s*([A-Za-z-]+)\s*:(\s.*)?$/.exec(statement);
    if (declarationStatement !== null) {
      const property = declarationStatement[1];
      const valueWord = declarationStatement[2] === undefined ? "" : word;
      return { kind: "value", property, word: valueWord };
    }
    return { kind: "property", word };
  }

  const enclosing = findEnclosingRule(analysis, offset);
  if (enclosing !== undefined) {
    const { rule, nestedInRule } = enclosing;
    const inSelector = offset >= rule.selectorSpan.start && offset <= rule.selectorSpan.end;
    // The tolerant parser glues a statement line and a following `&` selector
    // line into one selector (`co\n  &:hover`), so the cursor sat inside a
    // selector span and lost the property list. Inside a rule body only a
    // selector that ends on the cursor's own line is selector text; a selector
    // spanning several lines there is a recovery artefact and the authored
    // current line decides (bare word/empty → property). A selector outside any
    // rule body cannot be a declaration line, so it keeps the selector path.
    const selectorSpansLines = /[\r\n]/.test(
      text.slice(rule.selectorSpan.start, rule.selectorSpan.end),
    );
    if (inSelector && (!selectorSpansLines || !nestedInRule)) {
      return selectorOrPseudo(text, offset, word);
    }
    // The tolerant AST under-spans a declaration whose value is still empty
    // (`width:` ends at the colon), so the cursor can sit outside the
    // declaration. A `property:` statement with only whitespace or a value
    // behind the colon is therefore a value context even when the AST dropped
    // it. Requiring whitespace after the colon keeps nested selectors such as
    // `a:hover` out of this branch.
    const statement = currentLineStatement(text, offset);
    const declarationStatement = /^\s*([A-Za-z-]+)\s*:(\s.*)?$/.exec(statement);
    if (declarationStatement !== null) {
      const property = declarationStatement[1];
      const valueWord = declarationStatement[2] === undefined ? "" : word;
      return { kind: "value", property, word: valueWord };
    }
    const lineContext = selectorOrPseudo(text, offset, word);
    if (lineContext.kind === "pseudo") return lineContext;
    const trimmed = statement.trimStart();
    if (trimmed === "") return { kind: "property", word };
    if (/^[&.#[:*>]/.test(trimmed)) return { kind: "selector", word };
    return { kind: "property", word };
  }

  // Native at-rule blocks (`@keyframes`) never match as a rule, so statement
  // positions inside them are classified from the authored text. Frame blocks
  // themselves parse as ordinary rules and keep the rule-body behaviour above.
  const nativeAtRule = findEnclosingNativeAtRule(analysis, offset);
  if (
    nativeAtRule !== undefined &&
    nativeAtRule.name.toLowerCase() === "keyframes" &&
    // `span.end` also covers the closing `}`; only positions inside the block
    // braces belong to the keyframes body.
    braceDepthAt(text, offset) > braceDepthAt(text, nativeAtRule.span.start)
  ) {
    const statement = text.slice(statementStart(text, offset) + 1, offset).trimStart();
    if (/^[\s0-9A-Za-z%]*$/.test(statement)) {
      return { kind: "keyframe-selector", word: frameSelectorWord(text, offset) };
    }
  }

  if (word.startsWith("@")) return { kind: "directive", word: word.slice(1), inSelector: false };
  return { kind: "none" };
}

function aliasItem(alias: {
  name: string;
  condition: string;
  layer: string;
}): CompletionSuggestion {
  return {
    label: `@${alias.name}`,
    kind: "alias",
    detail: `${alias.condition} — ${alias.layer}`,
    insertText: `@${alias.name}`,
  };
}

function tokenItem(token: TokenSymbol): CompletionSuggestion {
  return {
    label: `$${token.name}`,
    kind: token.kind === "runtime" ? "runtime-token" : "token",
    detail: token.kind === "runtime" ? "runtime token (custom property)" : "compile-time token",
    documentation:
      token.kind === "runtime"
        ? `Custom property reference — authored value \`${token.value}\`.`
        : `Authored value: \`${token.value}\`.`,
    insertText: `$${token.name}`,
  };
}

function setupKeyItem(key: string): CompletionSuggestion {
  return {
    label: key,
    kind: "setup-key",
    detail: "Xessa @setup key",
    documentation: SETUP_DOCS[key] ?? "",
    insertText: `${key}: `,
  };
}

/**
 * Native at-rule suggestions for the typed prefix.
 *
 * `topLevel` keeps every pass-through at-rule; inside a rule body only the
 * conditional group rules CSS Nesting accepts are offered (SPECIFICATION.md
 * §3.4/§3.5), so `@charset`, `@import`, `@keyframes` and friends never suggest
 * an invalid nested position.
 */
function nativeAtRuleItems(word: string, topLevel: boolean): readonly CompletionSuggestion[] {
  const typed = word.toLowerCase();
  return NATIVE_AT_RULES.filter(
    (rule) => (topLevel || rule.nested) && (typed === "" || rule.name.startsWith(typed)),
  ).map<CompletionSuggestion>((rule) => ({
    label: `@${rule.name}`,
    kind: "directive",
    detail: "native at-rule",
    documentation: rule.documentation,
    insertText: `@${rule.name} `,
    sortText: `1-${rule.name}`,
  }));
}

function importPathItems(
  analysis: AnalyzeResult,
  typed: string,
  listDirectory: ((directory: string) => readonly string[]) | undefined,
): readonly CompletionSuggestion[] {
  if (typed.startsWith("../")) return [];
  const base = dirnamePath(analysis.file);
  const slash = typed.lastIndexOf("/");
  const directoryPart = slash < 0 ? "" : typed.slice(0, slash + 1);
  const partial = slash < 0 ? typed : typed.slice(slash + 1);
  const target = directoryPart === "" ? base : `${base}/${directoryPart}`;
  const relativeTyped = typed.startsWith("./") || typed.startsWith("../");
  const prefix = typed === "" || !relativeTyped ? `./${directoryPart}` : directoryPart;
  const items: CompletionSuggestion[] = [];
  if (listDirectory === undefined) {
    items.push({ label: "./", kind: "import-path", insertText: "./" });
    return items;
  }
  let entries: readonly string[] = [];
  try {
    entries = listDirectory(target);
  } catch {
    entries = [];
  }
  for (const entry of [...entries].sort()) {
    if (entry.startsWith(".")) continue;
    if (partial !== "" && !entry.toLowerCase().startsWith(partial.toLowerCase())) continue;
    const isModule = entry.endsWith(".cssx");
    const suffix = isModule ? "" : "/";
    items.push({
      label: `${prefix}${entry}${suffix}`,
      kind: "import-path",
      detail: isModule ? "Xessa module" : "Directory",
      insertText: `${prefix}${entry}${suffix}`,
    });
  }
  return items;
}

/**
 * Id tokens inside one authored selector.
 *
 * Mirrors `scanSelector`'s selector-only contract: quoted text, escapes,
 * selector comments and attribute contents are inert, while every selector
 * position counts — base selectors, comma lists, `&` nesting and functional
 * pseudo arguments (`:is(#a)`, `:not(#b)`, `:has(> #c)`). `:global(#x)` is
 * deliberately included: a global id is authored CSS and is never renamed or
 * mapped, but it is still an addressable id in this document.
 */
function scanSelectorIds(
  selector: string,
): readonly { readonly name: string; readonly start: number; readonly end: number }[] {
  const ids: { name: string; start: number; end: number }[] = [];
  let index = 0;
  let bracketDepth = 0;
  while (index < selector.length) {
    const char = selector[index] ?? "";
    if (char === '"' || char === "'") {
      index = skipString(selector, index);
      continue;
    }
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "/" && selector[index + 1] === "*") {
      const close = selector.indexOf("*/", index + 2);
      index = close < 0 ? selector.length : close + 2;
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      index += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      index += 1;
      continue;
    }
    if (char === "#" && bracketDepth === 0 && /[A-Za-z_]/.test(selector[index + 1] ?? "")) {
      let end = index + 2;
      while (end < selector.length && /[A-Za-z0-9_-]/.test(selector[end] ?? "")) end += 1;
      ids.push({ name: selector.slice(index + 1, end), start: index + 1, end });
      index = end;
      continue;
    }
    index += 1;
  }
  return ids;
}

/**
 * Every id token in the current document, one entry per authored occurrence,
 * in document order.
 *
 * Ids are document-global: rename and completion only ever reach names authored
 * in this file, never ids from imports (those keep their authored selectors and
 * are not renamed). Only rule selectors are scanned, so declaration values such
 * as `content: "#x"` or a `#fff` colour stay out by construction; nested rules,
 * conditional blocks and native at-rule blocks are traversed like the class
 * collector. A repeated name keeps one entry per occurrence for rename;
 * {@link collectIdSelectors} dedupes it for completion.
 */
export function collectIdOccurrences(analysis: AnalyzeResult): readonly IdOccurrence[] {
  const occurrences: IdOccurrence[] = [];
  const visit = (node: unknown): void => {
    const candidate = node as {
      kind?: string;
      selector?: string;
      selectorSpan?: SpanLike;
      body?: readonly unknown[];
      block?: readonly unknown[];
    };
    if (
      candidate.kind === "rule" &&
      typeof candidate.selector === "string" &&
      candidate.selectorSpan !== undefined
    ) {
      for (const token of scanSelectorIds(candidate.selector)) {
        occurrences.push({
          name: token.name,
          range: rangeAt(
            analysis.lineStarts,
            candidate.selectorSpan.start + token.start,
            candidate.selectorSpan.start + token.end,
          ),
        });
      }
    }
    for (const child of blockMembers(candidate)) visit(child);
  };
  for (const item of analysis.ast.items) visit(item);
  return occurrences;
}

/**
 * Every distinct id selector in the current document, in first-appearance
 * order.
 *
 * Completion offers one item per name, so this dedupes the full occurrence
 * list. Rename uses {@link collectIdOccurrences} directly.
 */
export function collectIdSelectors(analysis: AnalyzeResult): readonly IdOccurrence[] {
  const occurrences = new Map<string, IdOccurrence>();
  for (const occurrence of collectIdOccurrences(analysis)) {
    if (!occurrences.has(occurrence.name)) occurrences.set(occurrence.name, occurrence);
  }
  return [...occurrences.values()];
}

/**
 * Popup detail for one class occurrence: a prefixed (generated) class explains
 * the mapping, a class whose generated name equals its authored name has none.
 */
function classDetail(occurrence: ClassOccurrence): string | undefined {
  return occurrence.generated === occurrence.name
    ? undefined
    : `generated class .${occurrence.generated}`;
}

/**
 * Context-aware completion at one document offset.
 *
 * The registered trigger characters are `@`, `$`, `.`, `:`, `/`, `&`, `(`,
 * `#`, `!` and the digits `0`–`9`; property, value and selector contexts also
 * complete without a trigger. A digit is a trigger because the unit list only
 * exists once a number is typed (`margin: 1` → `1rem`): no other trigger fires
 * at that position and the editor does not reopen the list on its own.
 *
 * Two value states replace text in front of the typed word and say so per item
 * (`replaceStart`): the call opener `(` (A50) and the colour literal `#` (A51).
 * Both also carry a `filterText`, because the editor narrows the list against
 * the text its replacement range covers rather than the typed word alone.
 *
 * The selector starters follow the same pattern for a lone `&`: their item
 * range covers the authored ampersand, while a `&.` class context offers the
 * classes only.
 */
export function completionsAt(
  text: string,
  offset: number,
  options: IntelligenceOptions,
): CompletionResult {
  const { analysis } = options;
  const context = contextAt(text, offset, analysis);
  const result = (
    items: readonly CompletionSuggestion[],
    replaceStart: number,
  ): CompletionResult => ({ items, replaceStart, replaceEnd: offset });

  switch (context.kind) {
    case "directive": {
      const replaceStart = offset - context.word.length - 1;
      const aliases = analysis.mediaAliases
        .filter((alias) => context.word === "" || alias.name.startsWith(context.word))
        .map(aliasItem);
      const topLevel = !context.inSelector;
      const directives = topLevel
        ? DIRECTIVES.filter(
            (directive) => context.word === "" || directive.name.startsWith(context.word),
          ).map<CompletionSuggestion>((directive) => ({
            label: `@${directive.name}`,
            kind: "directive",
            detail: "Xessa directive",
            documentation: directive.documentation,
            insertText: `@${directive.name} `,
            sortText: `0-${directive.name}`,
          }))
        : [];
      // A group statement is legal at the top level (definition) and inside a
      // rule body (use site), so it is offered in both directive lists.
      const groupDirective =
        context.word === "" || GROUP_DIRECTIVE.name.startsWith(context.word)
          ? [
              {
                label: `@${GROUP_DIRECTIVE.name}`,
                kind: "directive" as const,
                detail: "Xessa directive",
                documentation: GROUP_DIRECTIVE.documentation,
                insertText: `${GROUP_KEYWORD}`,
                sortText: `0-${GROUP_DIRECTIVE.name}`,
              },
            ]
          : [];
      const natives =
        topLevel || atStatementStart(text, replaceStart)
          ? nativeAtRuleItems(context.word, topLevel)
          : [];
      return result(
        topLevel
          ? [...directives, ...groupDirective, ...natives, ...aliases]
          : [...groupDirective, ...aliases, ...natives],
        replaceStart,
      );
    }
    case "group-member": {
      const replaceStart = offset - context.word.length;
      const items: CompletionSuggestion[] = [];
      for (const entry of analysis.groups) {
        const item = groupItem(analysis, entry, context.word);
        if (item !== undefined) items.push(item);
      }
      return result(items, replaceStart);
    }
    case "token": {
      const replaceStart = offset - context.word.length - 1;
      const items: CompletionSuggestion[] = [];
      for (const token of analysis.tokens) {
        if (token.namespace !== undefined) continue;
        if (context.word !== "" && !token.name.startsWith(context.word)) continue;
        items.push(tokenItem(token));
      }
      // The built-in `keyframes` namespace (SPECIFICATION.md §6.4) completes
      // beside the imported aliases so every namespace is reachable from `$`.
      if (KEYFRAMES_NAMESPACE.startsWith(context.word)) {
        items.push({
          label: `$${KEYFRAMES_NAMESPACE}.`,
          kind: "token",
          detail: "built-in keyframe namespace",
          documentation:
            "A top-level `@keyframes <name>` block registers `<name>` here; reference it as `$keyframes.<name>` in a declaration value (SPECIFICATION.md §6.4).",
          insertText: `$${KEYFRAMES_NAMESPACE}.`,
        });
      }
      for (const imported of analysis.imports) {
        if (imported.alias === undefined) continue;
        // The label carries the sigil like the `$keyframes.` item beside it:
        // the shared range covers the typed `$`, so an item inserted without it
        // wrote `theme.` (an invalid reference) and deleted the author's `$`.
        items.push({
          label: `$${imported.alias}.`,
          kind: "token",
          detail: `namespace for ${imported.specifier}`,
          insertText: `$${imported.alias}.`,
        });
      }
      return result(items, replaceStart);
    }
    case "member": {
      const replaceStart = offset - context.word.length;
      if (context.namespace === KEYFRAMES_NAMESPACE) {
        const items: CompletionSuggestion[] = [];
        for (const entry of analysis.keyframes) {
          if (entry.kind === "ambiguous") {
            for (const candidate of entry.candidates) {
              const item = keyframeCompletion(analysis, candidate, context.word, "ambiguous");
              if (item !== undefined) items.push(item);
            }
            continue;
          }
          const local = normalizePath(entry.symbol.file) === normalizePath(analysis.path);
          const primary = keyframeCompletion(
            analysis,
            entry.symbol,
            context.word,
            local ? "local" : "imported",
          );
          if (primary !== undefined) items.push(primary);
          for (const duplicate of entry.duplicates) {
            const item = keyframeCompletion(analysis, duplicate, context.word, "duplicate");
            if (item !== undefined) items.push(item);
          }
        }
        return result(items, replaceStart);
      }
      const imported = importByAlias(analysis, context.namespace);
      if (imported === undefined) return result([], replaceStart);
      const items = imported.tokens
        .filter((token) => context.word === "" || token.name.startsWith(context.word))
        .map<CompletionSuggestion>((token) => ({
          label: token.name,
          kind: "member",
          detail:
            token.kind === "runtime"
              ? `runtime member of ${imported.specifier}`
              : `compile-time member of ${imported.specifier}`,
          documentation: `Authored value: \`${token.value}\`.`,
          insertText: token.name,
        }));
      return result(items, replaceStart);
    }
    case "import-path":
      return result(
        importPathItems(analysis, context.typed, options.listDirectory),
        offset - context.typed.length,
      );
    case "setup-key": {
      const replaceStart = offset - context.word.length;
      return result(
        SETUP_COMPLETION_KEYS.filter(
          (key) => context.word === "" || key.startsWith(context.word),
        ).map(setupKeyItem),
        replaceStart,
      );
    }
    case "setup-value": {
      const replaceStart = offset - context.word.length;
      const fixed = SETUP_VALUE_COMPLETIONS[context.key];
      if (fixed !== undefined) {
        return result(
          fixed.filter((item) => context.word === "" || item.label.startsWith(context.word)),
          replaceStart,
        );
      }
      if (!SETUP_BOOLEAN_COMPLETION_KEYS.includes(context.key)) return result([], replaceStart);
      return result(
        [
          { label: "true", kind: "setup-value", insertText: "true" },
          { label: "false", kind: "setup-value", insertText: "false" },
        ],
        replaceStart,
      );
    }
    case "property": {
      const replaceStart = offset - context.word.length;
      // Accepting a property inserts `property: ;` and parks the cursor before
      // the semicolon, like the built-in CSS support. The replacement range
      // covers the typed prefix (`col`), so the snippet replaces it whole and
      // never appends to it. Absent option means enabled (setting default on).
      const withSemicolon = options.completePropertyWithSemicolon ?? true;
      const standard: CompletionSuggestion[] = CSS_PROPERTIES.filter(
        (property) => context.word === "" || property.startsWith(context.word),
      ).map<CompletionSuggestion>((property) => ({
        label: property,
        kind: "property",
        detail: "CSS property",
        documentation: propertyDoc(property),
        insertText: `${property}: `,
        ...(withSemicolon ? { snippet: `${property}: $0;` } : {}),
        // The cursor lands in the value position either way, so the value
        // list reopens without the author retyping the colon (board bug 29).
        retriggerSuggest: true,
      }));
      // Curated vendor spellings follow the standard matches. Their
      // `${base}~${name}` sort key places a variant directly after its base
      // property in the editor (`appearance` < `appearance~-moz-appearance`),
      // because `-` sorts before `~` and a plain label sorts before the same
      // label with a suffix. They are offered only here, never in an empty
      // property position or in a value/selector/pseudo context.
      const vendor: CompletionSuggestion[] = VENDOR_PROPERTIES.filter((entry) =>
        vendorPropertyMatches(entry, context.word),
      ).map<CompletionSuggestion>((entry) => ({
        label: entry.property,
        kind: "property",
        detail: entry.detail,
        documentation: propertyDoc(entry.property),
        insertText: `${entry.property}: `,
        ...(withSemicolon ? { snippet: `${entry.property}: $0;` } : {}),
        sortText: `${entry.base}~${entry.property}`,
        retriggerSuggest: true,
      }));
      return result([...standard, ...vendor], replaceStart);
    }
    case "value": {
      const replaceStart = offset - context.word.length;
      // A `(` the author just typed in front of the word is a call opener
      // (`width: (`, `width: (cl`). Keyword values, named colors and units make
      // no sense directly behind a bare paren, so that state lists only the
      // curated functions and every item's range starts at the paren: accepting
      // `clamp(` replaces the typed `(` instead of duplicating it. A paren that
      // belongs to a named call (`calc(`, `width: calc((`) keeps the ordinary
      // value list, so editing inside a call never loses typed content.
      const opener = callOpenerStart(text, offset, context.word);
      if (opener !== undefined) {
        return result(functionItems(context.word, opener), replaceStart);
      }
      // A `#` the author just typed is a colour literal prefix (`color: #`,
      // `color: #f7`). The typed `#…` is not a value word, so that state lists
      // the curated hex palette and the named colours only, every item
      // replacing the typed prefix. Outside a colour-accepting property a `#`
      // is no value at all (`width: #`, `url(#frag)` handles its own text), so
      // the list stays empty instead of offering unrelated generic values.
      const hash = hashPrefixStart(text, offset, context.word);
      if (hash !== undefined) {
        if (!COLOR_PROPERTIES.has(context.property ?? "")) return result([], replaceStart);
        return result(hashColorItems(context.word, hash), replaceStart);
      }
      const values = new Set<string>(CSS_VALUES);
      for (const value of PROPERTY_VALUES[context.property ?? ""] ?? []) values.add(value);
      const items: CompletionSuggestion[] = [...values]
        .filter((value) => context.word === "" || value.startsWith(context.word))
        .sort()
        .map<CompletionSuggestion>((value) => ({
          label: value,
          kind: "value",
          detail: "CSS value",
          insertText: value,
          sortText: `0-${value}`,
        }));
      // A color-accepting property also offers the CSS named colors; the same
      // word filters them and `0-` keeps them beside the keyword values. The
      // curated hex palette joins only for an empty word: a typed prefix
      // (`color: re`) is name text, and `#` has its own state above.
      if (COLOR_PROPERTIES.has(context.property ?? "")) {
        items.push(...namedColorItems(context.word));
        if (context.word === "") items.push(...hexColorItems(""));
      }
      // A typed number suggests the units that can follow it (`margin: 1` →
      // `1rem`). `%` is not a word character, so an authored `%` leaves an
      // empty word: no prefix, no units, and the authored `%` is kept as is.
      const numberPrefix = /^\d*\.?\d+/.exec(context.word)?.[0] ?? "";
      if (numberPrefix !== "") items.push(...unitItems(context.word, numberPrefix, offset));
      // Values are raw CSS (SPECIFICATION.md §3.3), so the same CSS functions
      // apply to every property, including behind a variant modifier segment.
      items.push(...functionItems(context.word));
      return result(items, replaceStart);
    }
    case "important": {
      // The range covers the typed `!` run and any word behind it, so accepting
      // `!important` replaces `red!`/`red!im` instead of stacking a second bang.
      // The filter text is the full word VS Code sees over that range.
      const items: CompletionSuggestion[] = "important".startsWith(context.word)
        ? [
            {
              label: "!important",
              kind: "value",
              detail: "CSS declaration modifier",
              documentation: "Marks the declaration as important, overriding normal cascade order.",
              insertText: "!important",
              filterText: "!important",
              sortText: "0-important",
            },
          ]
        : [];
      return result(items, context.start);
    }
    case "keyframe-selector": {
      const replaceStart = offset - context.word.length;
      return result(
        KEYFRAME_FRAME_SELECTORS.filter(
          (frame) => context.word === "" || frame.label.startsWith(context.word),
        ).map<CompletionSuggestion>((frame) => ({
          label: frame.label,
          kind: "selector",
          detail: "keyframe frame selector",
          documentation: frame.documentation,
          insertText: frame.label,
        })),
        replaceStart,
      );
    }
    case "selector": {
      // A `#` typed in selector position is the id state: every id authored in
      // this document, one item per distinct name and in first-appearance
      // order. The item's range starts on the typed `#`, so accepting `#panel`
      // after `#pan` replaces the whole `#…` word and leaves exactly one `#`.
      // Ids are document-global, so no imported or cross-file names join.
      const hash = hashPrefixStart(text, offset, context.word);
      if (hash !== undefined) {
        const items = collectIdSelectors(analysis)
          .filter((occurrence) => context.word === "" || occurrence.name.startsWith(context.word))
          .map<CompletionSuggestion>((occurrence) => ({
            label: `#${occurrence.name}`,
            kind: "selector",
            detail: "id selector",
            insertText: `#${occurrence.name}`,
            replaceStart: hash,
          }));
        // No colour/hex values, class items, starters or directives: a selector
        // `#` is an id state only, just as a value `#` is a colour state only.
        return result(items, offset - context.word.length);
      }
      // `.` is a word character, so a typed dot is part of `context.word`
      // (`.te` after `&.`). Class items insert the bare name, so the range must
      // start after the last dot — otherwise accepting `.test` dropped the typed
      // dot and `&.test > a` became `&test > a`.
      const dot = context.word.lastIndexOf(".");
      const replaceStart =
        dot < 0 ? offset - context.word.length : offset - (context.word.length - dot - 1);
      // A `&.` context means "this selector plus a class", so the `&` starters
      // are not candidates there: they already begin with `&`, and appending one
      // after the typed dot wrote `&.&:hover`. The empty and lone-`&` states keep
      // the starters; a class context lists the classes only (CSSX-U03).
      const starterStart = authoredAmpersandStart(text, offset, context.word);
      const items: CompletionSuggestion[] = context.word.startsWith(".")
        ? []
        : SELECTOR_STARTERS.map((starter) => ({
            label: starter.trim(),
            kind: "selector",
            insertText: starter,
            // A lone `&` stays the author's punctuation: the starter replaces
            // it, so accepting `&:hover` yields `&:hover`, never `&&:hover`.
            ...(starterStart === undefined ? {} : { replaceStart: starterStart }),
          }));
      // One item per distinct class name: the authored selectors can mention
      // the same class more than once (`.class {}` plus `&.class`), and the
      // analysis records one occurrence per class token. The occurrence that
      // carries the generated-name detail wins, so a prefixed class still
      // explains its mapping whichever occurrence came first.
      const classesByName = new Map<string, ClassOccurrence>();
      for (const occurrence of analysis.classes) {
        const existing = classesByName.get(occurrence.name);
        if (
          existing === undefined ||
          (classDetail(existing) === undefined && classDetail(occurrence) !== undefined)
        ) {
          classesByName.set(occurrence.name, occurrence);
        }
      }
      for (const occurrence of classesByName.values()) {
        items.push({
          label: `.${occurrence.name}`,
          kind: "selector",
          detail: classDetail(occurrence),
          insertText: occurrence.name,
        });
      }
      return result(items, replaceStart);
    }
    case "pseudo": {
      // PSEUDOS carry their own leading colons and the range covers the typed
      // ones, so `&:` + `:hover` is `&:hover` and never `&::hover`. The filter
      // word is the text after the colons (`hov` → `:hover`).
      const replaceStart = typedColons(text, offset, context.word).start;
      const standard = PSEUDOS.filter(
        (pseudo) =>
          context.word === "" ||
          pseudo.slice(pseudo.startsWith("::") ? 2 : 1).startsWith(context.word),
      ).map<CompletionSuggestion>((pseudo) => ({
        label: pseudo,
        kind: "pseudo",
        insertText: pseudo,
      }));
      // Vendor fallbacks follow the standard set: the `z-` sort key sorts after
      // the colon-prefixed labels, and matching also ignores the typed `-`.
      const vendor = VENDOR_PSEUDOS.filter((entry) =>
        vendorPseudoMatches(entry.pseudo, context.word),
      ).map<CompletionSuggestion>((entry) => ({
        label: entry.pseudo,
        kind: "pseudo",
        detail: entry.detail,
        insertText: entry.pseudo,
        sortText: `z-${entry.pseudo}`,
      }));
      return result([...standard, ...vendor], replaceStart);
    }
    default:
      return result([], offset);
  }
}

function offsetAt(
  lineStarts: readonly number[],
  position: { readonly line: number; readonly character: number },
): number {
  return (lineStarts[Math.min(position.line, lineStarts.length - 1)] ?? 0) + position.character;
}

function rangeContains(analysis: AnalyzeResult, range: Range, offset: number): boolean {
  return (
    offsetAt(analysis.lineStarts, range.start) <= offset &&
    offset <= offsetAt(analysis.lineStarts, range.end)
  );
}

/** Token symbol under the cursor, including its reference range when present. */
export function tokenAt(
  text: string,
  offset: number,
  analysis: AnalyzeResult,
):
  | { readonly symbol: TokenSymbol; readonly namespace?: ImportedModule; readonly range?: Range }
  | undefined {
  const reference = collectTokenReferences(text, analysis.ast).find(
    (candidate) => offset >= candidate.start && offset <= candidate.end,
  );
  if (reference !== undefined) {
    const range = rangeAt(analysis.lineStarts, reference.start, reference.end);
    if (reference.namespace !== undefined) {
      const imported = importByAlias(analysis, reference.namespace);
      const symbol = imported?.tokens.find((token) => token.name === reference.name);
      return symbol === undefined ? undefined : { symbol, namespace: imported, range };
    }
    const local = analysis.tokens.find(
      (token) => token.namespace === undefined && token.name === reference.name,
    );
    return local === undefined ? undefined : { symbol: local, range };
  }
  for (const token of analysis.tokens) {
    if (token.namespace !== undefined) continue;
    if (rangeContains(analysis, token.declaration, offset)) return { symbol: token };
  }
  return undefined;
}

function aliasTokenAt(
  text: string,
  offset: number,
): { readonly text: string; readonly start: number; readonly end: number } | undefined {
  let start = offset;
  while (start > 0) {
    const char = text[start - 1];
    if (char !== undefined && /[A-Za-z0-9_+-]/.test(char)) start -= 1;
    else break;
  }
  if (text[start - 1] !== "@") return undefined;
  let end = offset;
  while (end < text.length) {
    const char = text[end];
    if (char !== undefined && /[A-Za-z0-9_+-]/.test(char)) end += 1;
    else break;
  }
  const name = text.slice(start, end);
  // `@group` is the Xessa group directive (ADR-0017), never a media alias.
  // Group hover owns the whole `@group.<name>` span; other aliases are unchanged.
  if (name === "group" || name.startsWith("group+")) return undefined;
  return { text: name, start: start - 1, end };
}

/** Range of a bare `@group` directive word under the cursor, if any. */
function groupDirectiveAt(
  text: string,
  offset: number,
): { readonly start: number; readonly end: number } | undefined {
  let start = offset;
  while (start > 0) {
    const char = text[start - 1];
    if (char !== undefined && /[A-Za-z0-9_+-]/.test(char)) start -= 1;
    else break;
  }
  if (text[start - 1] !== "@") return undefined;
  let end = offset;
  while (end < text.length) {
    const char = text[end];
    if (char !== undefined && /[A-Za-z0-9_+-]/.test(char)) end += 1;
    else break;
  }
  if (text.slice(start, end) !== "group") return undefined;
  return { start: start - 1, end };
}

export function classAt(analysis: AnalyzeResult, offset: number): ClassOccurrence | undefined {
  return analysis.classes.find((occurrence) => rangeContains(analysis, occurrence.range, offset));
}

/** Id token under the cursor, using the rename-addressable name range. */
export function idAt(analysis: AnalyzeResult, offset: number): IdOccurrence | undefined {
  return collectIdOccurrences(analysis).find((occurrence) =>
    rangeContains(analysis, occurrence.range, offset),
  );
}

/**
 * Curated CSS function whose name word contains `offset`.
 *
 * Lexical on purpose: the authored call shape is the evidence, so the name word
 * must be immediately followed by `(`. Only the name word matches — the range
 * and the check never cover the arguments, so hovering `100%` inside
 * `calc(100% - 20px)` keeps whatever hover that value has. Strings and comments
 * never match, and text inside `url(...)` arguments never matches (only the
 * `url` name itself, whose own `(` opens the call). A bare keyword that shares a
 * name with a function (`steps` as a timing keyword, `min` in `min-width`) fails
 * the `(` test.
 */
function cssFunctionAt(
  text: string,
  offset: number,
): { readonly fn: CssFunction; readonly start: number; readonly end: number } | undefined {
  let start = offset;
  while (start > 0 && /[A-Za-z-]/.test(text[start - 1] ?? "")) start -= 1;
  let end = offset;
  while (end < text.length && /[A-Za-z-]/.test(text[end] ?? "")) end += 1;
  if (text[end] !== "(") return undefined;
  const name = text.slice(start, end);
  const fn = CSS_FUNCTIONS.find((entry) => entry.name === name);
  if (fn === undefined) return undefined;
  if (enclosingString(text, start) !== undefined) return undefined;
  if (insideUrl(text, start)) return undefined;
  return { fn, start, end };
}

/**
 * The `@setup` key under `offset`, when the caret is on the key rather than its
 * value or inside a quoted string.
 *
 * `@setup` shares the declaration-ish scanner with ordinary values, so the
 * colon check matters: `media-grouping: merge` hovering `merge` must not look
 * like a key hover even if a value happened to spell a key name.
 */
function setupKeyAt(
  text: string,
  offset: number,
  analysis: AnalyzeResult,
): { readonly key: string; readonly start: number; readonly end: number } | undefined {
  const setup = findEnclosingSetup(analysis, offset);
  if (setup === undefined) return undefined;
  if (enclosingString(text, offset) !== undefined) return undefined;
  let start = offset;
  while (start > 0 && /[A-Za-z-]/.test(text[start - 1] ?? "")) start -= 1;
  let end = offset;
  while (end < text.length && /[A-Za-z-]/.test(text[end] ?? "")) end += 1;
  const key = text.slice(start, end);
  if (!SETUP_COMPLETION_KEYS.includes(key)) return undefined;
  const head = text.slice(setup.start, start);
  const boundary = Math.max(head.lastIndexOf(";"), head.lastIndexOf("{"));
  return head.lastIndexOf(":") > boundary ? undefined : { key, start, end };
}

/**
 * Hover content for `$tokens`, media aliases, CSS declaration properties,
 * curated CSS functions and selector classes.
 *
 * Property hover shows a built-in one-sentence description from
 * `property-docs.ts`; the full css-languageservice projection is still not
 * embedded (A13 report). Function hover shows the usage sentence and the
 * sample call from `CSS_FUNCTIONS`.
 */
export function hoverAt(
  text: string,
  offset: number,
  options: IntelligenceOptions,
): HoverContent | undefined {
  const { analysis, classMap } = options;
  const group = groupAt(analysis, offset, { includeKeyword: true });
  if (group !== undefined) return groupHover(analysis, group);
  const directive = groupDirectiveAt(text, offset);
  if (directive !== undefined) {
    return {
      markdown: [
        "**@group** — Xessa directive",
        "",
        "`@group.<name> { … }` defines a reusable declaration group at the top level and applies one with overrides inside a rule body (ADR-0017). A group name is required after the dot.",
      ].join("\n"),
      range: rangeAt(analysis.lineStarts, directive.start, directive.end),
    };
  }
  const setupKey = setupKeyAt(text, offset, analysis);
  if (setupKey !== undefined) {
    return {
      markdown:
        setupKey.key === "media-grouping"
          ? MEDIA_GROUPING_HOVER
          : `**\`${setupKey.key}\`** — Xessa \`@setup\` key\n\n${SETUP_DOCS[setupKey.key] ?? ""}`,
      range: rangeAt(analysis.lineStarts, setupKey.start, setupKey.end),
    };
  }
  const keyframe = keyframeAt(text, offset, analysis);
  if (keyframe !== undefined) return keyframeHover(analysis, keyframe);
  const token = tokenAt(text, offset, analysis);
  if (token !== undefined) {
    const { symbol, namespace } = token;
    const qualified =
      namespace === undefined ? `$${symbol.name}` : `$${namespace.alias}.${symbol.name}`;
    const lines: string[] = [];
    if (symbol.kind === "compile") {
      lines.push(`**${qualified}** — compile-time token`, "", `Value: \`${symbol.value}\``);
    } else {
      const customProperty = `--${analysis.prefix === "" ? symbol.name : `${analysis.prefix}-${symbol.name}`}`;
      lines.push(
        `**${qualified}** — runtime token`,
        "",
        `Custom property: \`${customProperty}\``,
        `Base value: \`${symbol.value}\``,
      );
      for (const variant of symbol.variants) {
        lines.push(`\`@${variant.aliases.join("+")}\`: \`${variant.value}\``);
      }
    }
    if (namespace !== undefined) lines.push("", `Module: \`${namespace.specifier}\``);
    return {
      markdown: lines.join("\n"),
      range: token.range ?? symbol.declaration,
    };
  }

  const alias = aliasTokenAt(text, offset);
  if (alias !== undefined) {
    const names = alias.text
      .replace(/^@/, "")
      .split("+")
      .filter((name) => name !== "");
    const parts: string[] = [];
    const conditions: string[] = [];
    let known = true;
    for (const name of names) {
      const resolved = analysis.mediaAliases.find((entry) => entry.name === name);
      if (resolved === undefined) {
        known = false;
        parts.push(`\`@${name}\` is not defined.`);
      } else {
        conditions.push(resolved.condition);
        parts.push(`\`@${name}\` → \`${resolved.condition}\` (${resolved.layer})`);
      }
    }
    const lines: string[] = [];
    if (!known) lines.push("**Unknown media alias**", "");
    if (known && names.length > 1) {
      lines.push(
        `**${alias.text}** — combined media condition`,
        "",
        `\`${conditions.join(" and ")}\``,
      );
    } else {
      lines.push(...parts);
    }
    return {
      markdown: lines.join("\n"),
      range: rangeAt(analysis.lineStarts, alias.start, alias.end),
    };
  }

  // Curated CSS functions, matched on the authored call shape. Ordered with the
  // word-level hovers (after tokens and media aliases, next to declarations) so
  // it can never shadow them: the enclosing declaration's property is always
  // followed by `:`, never `(`, so this branch only fires on call words. A
  // property that shares a function name (`translate`, `rotate`, `scale` are
  // individual transform properties) keeps its own hover on the property word.
  const cssFunction = cssFunctionAt(text, offset);
  if (cssFunction !== undefined) {
    return {
      markdown: [
        `**${cssFunction.fn.name}()** — CSS function`,
        "",
        cssFunctionDocumentation(cssFunction.fn),
      ].join("\n"),
      range: rangeAt(analysis.lineStarts, cssFunction.start, cssFunction.end),
    };
  }

  // Declaration property names only: the enclosing declaration's property must
  // equal the word, so values (`flex`), pseudo names and `@media` prelude
  // features (`min-width`) never pick up property docs.
  const declaration = findEnclosingDeclaration(analysis, offset);
  if (declaration !== undefined) {
    let wordStart = offset;
    while (wordStart > 0 && /[A-Za-z-]/.test(text[wordStart - 1] ?? "")) wordStart -= 1;
    let wordEnd = offset;
    while (wordEnd < text.length && /[A-Za-z-]/.test(text[wordEnd] ?? "")) wordEnd += 1;
    const word = text.slice(wordStart, wordEnd);
    const doc = propertyDoc(word);
    if (doc !== undefined && declaration.property === word) {
      const lines = [`**${word}** — CSS property`, "", doc];
      const values = PROPERTY_VALUES[word];
      if (values !== undefined) {
        lines.push(`Common values: ${values.map((value) => `\`${value}\``).join(", ")}`);
      }
      return {
        markdown: lines.join("\n"),
        range: rangeAt(analysis.lineStarts, wordStart, wordEnd),
      };
    }
  }

  const occurrence = classAt(analysis, offset);
  if (occurrence !== undefined) {
    const generated = classMap?.[occurrence.name] ?? occurrence.generated;
    const markdown = occurrence.global
      ? `**\`.${occurrence.name}\`** — global class, not renamed.`
      : `**\`.${occurrence.name}\`** — generated class: \`${generated}\``;
    return { markdown, range: occurrence.range };
  }

  return undefined;
}

/** Canonical identity of one `$token` definition, independent of the cursor file. */
export interface TokenDefinition {
  /** Absolute normalized module path of the defining file. */
  readonly file: string;
  /** Token name without the `$` sigil. */
  readonly name: string;
  readonly kind: "compile" | "runtime";
}

/** One resolved declaration or reference occurrence in a module. */
export interface TokenOccurrence {
  /** Absolute normalized module path. */
  readonly file: string;
  readonly name: string;
  readonly range: Range;
}

/**
 * `@use` bindings in authored order, paired with the raw alias clause.
 *
 * `analysis.imports` always carries the computed default alias, so only the
 * parsed `@use` item distinguishes a namespaced import (`as t`) from an
 * unqualified/style import (no `as`).
 */
function importBindings(
  analysis: AnalyzeResult,
): readonly { readonly module: ImportedModule; readonly alias: string | undefined }[] {
  const aliases = analysis.ast.items
    .filter((item) => item.kind === "use")
    .map((item) => item.alias);
  return analysis.imports.map((module, index) => ({ module, alias: aliases[index] }));
}

/**
 * Definition a `$name` / `$ns.member` reference resolves to, mirroring the
 * compiler's scope rules.
 *
 * A local token shadows every unqualified import of the same name; a namespaced
 * reference resolves only through an explicit `@use … as <alias>`; two distinct
 * unqualified providers make the name ambiguous (XESSA2001) and therefore
 * unresolved. Only direct `@use` imports are considered: Xessa has no implicit
 * re-export, so a module's tokens are visible solely to its direct importers.
 */
export function resolveTokenReference(
  reference: TokenReference,
  analysis: AnalyzeResult,
): TokenDefinition | undefined {
  const bindings = importBindings(analysis);
  if (reference.namespace !== undefined) {
    const binding = bindings.find(
      (entry) =>
        entry.alias !== undefined && entry.alias !== "" && entry.alias === reference.namespace,
    );
    if (binding === undefined) return undefined;
    const symbol = binding.module.tokens.find((token) => token.name === reference.name);
    return symbol === undefined
      ? undefined
      : { file: normalizePath(binding.module.path), name: symbol.name, kind: symbol.kind };
  }

  const local = analysis.tokens.find(
    (token) => token.namespace === undefined && token.name === reference.name,
  );
  if (local !== undefined) {
    return { file: normalizePath(analysis.path), name: local.name, kind: local.kind };
  }

  const providers = new Map<string, TokenDefinition>();
  for (const entry of bindings) {
    if (entry.alias !== undefined) continue;
    const symbol = entry.module.tokens.find((token) => token.name === reference.name);
    if (symbol === undefined) continue;
    const definition: TokenDefinition = {
      file: normalizePath(entry.module.path),
      name: symbol.name,
      kind: symbol.kind,
    };
    providers.set(`${definition.file}\u0000${definition.kind}`, definition);
  }
  if (providers.size !== 1) return undefined;
  return [...providers.values()][0];
}

/** The definition selected by the cursor, including unqualified imported names. */
export function tokenDefinitionAt(
  text: string,
  offset: number,
  analysis: AnalyzeResult,
): TokenDefinition | undefined {
  const token = tokenAt(text, offset, analysis);
  if (token !== undefined) {
    return token.symbol.namespace === undefined
      ? {
          file: normalizePath(analysis.path),
          name: token.symbol.name,
          kind: token.symbol.kind,
        }
      : {
          file: normalizePath(token.symbol.file),
          name: token.symbol.name,
          kind: token.symbol.kind,
        };
  }
  // `tokenAt` resolves locals and namespaced members; an unqualified imported
  // name has no local symbol, so the reference resolver supplies the target.
  const reference = collectTokenReferences(text, analysis.ast).find(
    (candidate) => offset >= candidate.start && offset <= candidate.end,
  );
  return reference === undefined ? undefined : resolveTokenReference(reference, analysis);
}

/**
 * Declaration (when requested and defined here) plus every reference in this
 * file that resolves to `target`.
 *
 * Resolution, not text matching, decides inclusion: aliases, unqualified
 * imports and style imports count; a local shadow or an ambiguous unqualified
 * import does not. Ranges come from this file's own analysis.
 */
export function referencesToToken(
  text: string,
  analysis: AnalyzeResult,
  target: TokenDefinition,
  options: { readonly includeDeclaration?: boolean } = {},
): readonly TokenOccurrence[] {
  const includeDeclaration = options.includeDeclaration !== false;
  const file = normalizePath(analysis.path);
  const targetFile = normalizePath(target.file);
  const occurrences: TokenOccurrence[] = [];
  if (includeDeclaration && file === targetFile) {
    const declaration = analysis.tokens.find(
      (token) =>
        token.namespace === undefined && token.name === target.name && token.kind === target.kind,
    );
    if (declaration !== undefined) {
      occurrences.push({ file, name: target.name, range: declaration.declaration });
    }
  }
  for (const reference of collectTokenReferences(text, analysis.ast)) {
    if (reference.name !== target.name) continue;
    const resolved = resolveTokenReference(reference, analysis);
    if (resolved === undefined) continue;
    if (normalizePath(resolved.file) !== targetFile || resolved.kind !== target.kind) continue;
    occurrences.push({
      file,
      name: target.name,
      range: rangeAt(analysis.lineStarts, reference.start, reference.end),
    });
  }
  return occurrences;
}

/** Definition targets for the token under the cursor. */
export function definitionsAt(
  text: string,
  offset: number,
  options: IntelligenceOptions,
): readonly DefinitionTarget[] {
  const token = tokenAt(text, offset, options.analysis);
  if (token === undefined) return [];
  return [{ file: token.symbol.file, name: token.symbol.name, range: token.symbol.declaration }];
}

/** References (declaration plus usages) for a token; module members stay read-only. */
export function referencesAt(
  text: string,
  offset: number,
  options: IntelligenceOptions,
): readonly DefinitionTarget[] {
  const { analysis } = options;
  const token = tokenAt(text, offset, analysis);
  if (token === undefined) return [];
  const { symbol } = token;
  const targets: DefinitionTarget[] = [
    { file: symbol.file, name: symbol.name, range: symbol.declaration },
  ];
  for (const reference of collectTokenReferences(text, analysis.ast)) {
    if (reference.name !== symbol.name) continue;
    if ((reference.namespace ?? undefined) !== symbol.namespace) continue;
    targets.push({
      file: analysis.file,
      name: symbol.name,
      range: rangeAt(analysis.lineStarts, reference.start, reference.end),
    });
  }
  return targets;
}

const TOKEN_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * Class name accepted by a single-file rename.
 *
 * A subset of the strict CSS identifier: the name must start with a letter or
 * underscore, because the editor's selector scanner only recognises that start
 * after the dot. Renaming to anything the scanner cannot read back would leave
 * hover, completion and the next occurrence out of sync.
 */
const CLASS_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * Single-file class rename: every non-global occurrence of the same class name
 * in the current document, name bytes only (the leading dot stays).
 *
 * `:global(...)` classes are authored CSS that is never prefixed or mapped, so
 * they are excluded from a normal rename and refused when selected. A name that
 * already exists anywhere in this file is refused before any edit (CSSX-U04
 * precedent): applying it would silently merge two authored classes. The
 * generated class and map alias change on the next build, and literal
 * `className="…"` strings are outside the document's analysis.
 */
function renameClass(
  occurrence: ClassOccurrence,
  newName: string,
  analysis: AnalyzeResult,
): RenamePlan {
  if (occurrence.global) {
    return {
      ok: false,
      reason: "Global classes inside `:global(...)` are not renamed.",
    };
  }
  if (!CLASS_NAME_PATTERN.test(newName)) {
    return {
      ok: false,
      reason:
        "Class names must start with a letter or underscore and contain only letters, digits, `_` or `-`.",
    };
  }
  if (newName !== occurrence.name && analysis.classes.some((entry) => entry.name === newName)) {
    return {
      ok: false,
      reason: `A class named ".${newName}" already exists in this document.`,
    };
  }
  const edits = analysis.classes
    .filter((entry) => entry.name === occurrence.name && !entry.global)
    .map((entry) => ({ range: entry.range, newText: newName }));
  return { ok: true, placeholder: occurrence.name, edits };
}

/**
 * Id name accepted by a single-file rename.
 *
 * Same shape as {@link CLASS_NAME_PATTERN}: the editor's selector scanner only
 * recognises a letter or underscore after `#`, so a name it cannot read back
 * would desynchronise hover, completion and the next occurrence.
 */
const ID_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * Single-file id rename: every occurrence of the same id name in the current
 * document, name bytes only (the leading `#` stays).
 *
 * Ids have no local/global split, so `:global(#x)` occurrences are included:
 * they are authored CSS and are never prefixed, mapped or emitted under another
 * name. A name that already exists anywhere in this file is refused before any
 * edit (CSSX-U04 precedent), and the map, `.d.ts`, JSX `id="…"` anchors and
 * inbound links are outside the document's analysis.
 */
function renameId(occurrence: IdOccurrence, newName: string, analysis: AnalyzeResult): RenamePlan {
  if (!ID_NAME_PATTERN.test(newName)) {
    return {
      ok: false,
      reason:
        "Id names must start with a letter or underscore and contain only letters, digits, `_` or `-`.",
    };
  }
  const occurrences = collectIdOccurrences(analysis);
  if (newName !== occurrence.name && occurrences.some((entry) => entry.name === newName)) {
    return {
      ok: false,
      reason: `An id named "#${newName}" already exists in this document.`,
    };
  }
  const edits = occurrences
    .filter((entry) => entry.name === occurrence.name)
    .map((entry) => ({ range: entry.range, newText: newName }));
  return { ok: true, placeholder: occurrence.name, edits };
}

/**
 * Rename dispatch for the symbol under the cursor.
 *
 * Groups, keyframes and selector classes apply their own scope rules (group and
 * keyframe edits span the visible module set; class edits every non-global
 * occurrence in the current document). For `$tokens`, only references collected
 * from declaration value segments are edited, so strings, comments, selectors
 * and import paths are never rewritten; namespace members are refused with
 * guidance.
 */
export function renameAt(
  text: string,
  offset: number,
  newName: string,
  options: IntelligenceOptions,
): RenamePlan {
  const { analysis } = options;
  const group = groupAt(analysis, offset);
  if (group !== undefined) return renameGroup(group, newName, analysis);
  const keyframe = keyframeAt(text, offset, analysis);
  if (keyframe !== undefined) return renameKeyframe(keyframe, newName, analysis);
  const occurrence = classAt(analysis, offset);
  if (occurrence !== undefined) return renameClass(occurrence, newName, analysis);
  const id = idAt(analysis, offset);
  if (id !== undefined) return renameId(id, newName, analysis);
  const token = tokenAt(text, offset, analysis);
  if (token === undefined) {
    return { ok: false, reason: "Place the cursor on a Xessa token to rename it." };
  }
  if (token.symbol.namespace !== undefined) {
    return {
      ok: false,
      reason: "Cross-module rename is not supported yet; rename the token in its defining module.",
    };
  }
  if (!TOKEN_NAME_PATTERN.test(newName)) {
    return {
      ok: false,
      reason:
        "Token names must start with a letter or underscore and contain letters, digits, `_` or `-`.",
    };
  }
  const edits: { range: Range; newText: string }[] = [
    { range: token.symbol.declaration, newText: newName },
  ];
  for (const reference of collectTokenReferences(text, analysis.ast)) {
    if (reference.namespace !== undefined) continue;
    if (reference.name !== token.symbol.name) continue;
    edits.push({
      range: rangeAt(analysis.lineStarts, reference.start, reference.end),
      newText: `$${newName}`,
    });
  }
  return { ok: true, placeholder: token.symbol.name, edits };
}

/** Parse a CSS hex color into 0–1 RGBA channels. */
export function hexColorToRgba(hex: string):
  | {
      readonly red: number;
      readonly green: number;
      readonly blue: number;
      readonly alpha: number;
    }
  | undefined {
  const body = hex.replace(/^#/, "");
  if (!/^[0-9A-Fa-f]+$/.test(body)) return undefined;
  const expand = (value: string): string =>
    value
      .split("")
      .map((char) => `${char}${char}`)
      .join("");
  const normalized = body.length === 3 || body.length === 4 ? expand(body) : body;
  if (normalized.length !== 6 && normalized.length !== 8) return undefined;
  const channel = (start: number): number =>
    Number.parseInt(normalized.slice(start, start + 2), 16) / 255;
  return {
    red: channel(0),
    green: channel(2),
    blue: channel(4),
    alpha: normalized.length === 8 ? channel(6) : 1,
  };
}

/** Format RGBA channels as authored hex (`#rrggbb` or `#rrggbbaa`). */
export function rgbaToHex(red: number, green: number, blue: number, alpha: number): string {
  const channel = (value: number): string =>
    Math.round(Math.max(0, Math.min(1, value)) * 255)
      .toString(16)
      .padStart(2, "0");
  const base = `#${channel(red)}${channel(green)}${channel(blue)}`;
  return alpha >= 1 ? base : `${base}${channel(alpha)}`;
}

/** Colors authored in the analyzed declaration values. */
export function colorsOf(analysis: AnalyzeResult): readonly ColorOccurrence[] {
  return analysis.colors;
}

/** One colour swatch with the editor-agnostic range it covers. */
export interface DocumentColor {
  readonly color: {
    readonly red: number;
    readonly green: number;
    readonly blue: number;
    readonly alpha: number;
  };
  readonly range: Range;
}

/**
 * Whether a declaration's value can hold a named colour.
 *
 * The colour-accepting longhands are derived in `COLOR_PROPERTIES`; every
 * custom property (`--brand`) is a `<color>`-bearing context too, because its
 * value type is whatever the author uses it for.
 */
function acceptsNamedColor(property: string): boolean {
  return COLOR_PROPERTIES.has(property) || property.startsWith("--");
}

/**
 * Every colour authored in a declaration value, as swatch + range pairs.
 *
 * The pure half of the editor's colour decorations (`DocumentColorProvider`):
 * hex values reuse the analysis occurrences, so `#rgb`/`#rgba`/`#rrggbb`/
 * `#rrggbbaa` count in any declaration value whatever the property
 * (`box-shadow: 0 0 4px #000`), while a named colour counts only as a whole word
 * inside a colour-accepting declaration (`color: red`, `--brand: teal`) and is
 * resolved through `CSS_NAMED_COLOR_HEX`.
 */
export function colorsAt(text: string, analysis: AnalyzeResult): readonly DocumentColor[] {
  const found: DocumentColor[] = [];
  for (const occurrence of analysis.colors) {
    const color = hexColorToRgba(occurrence.value);
    if (color !== undefined) found.push({ color, range: occurrence.range });
  }
  forEachDeclaration(analysis.ast, (declaration) => {
    if (!acceptsNamedColor(declaration.property)) return;
    for (const segment of declarationSegments(text, declaration)) {
      for (const run of namedColorRuns(segment.text)) {
        const color = hexColorToRgba(CSS_NAMED_COLOR_HEX[run.name] ?? "");
        if (color === undefined) continue;
        found.push({
          color,
          range: rangeAt(analysis.lineStarts, segment.start + run.start, segment.start + run.end),
        });
      }
    }
  });
  return found;
}

function spanRange(analysis: AnalyzeResult, span: SpanLike): Range {
  return rangeAt(analysis.lineStarts, span.start, span.end);
}

/** Outline tree: directives, tokens, groups and nested rules. */
export function documentSymbols(analysis: AnalyzeResult): readonly OutlineNode[] {
  const { ast } = analysis;
  const nodes: OutlineNode[] = [];

  const declarationNode = (declaration: {
    property?: string;
    value?: string;
    span?: SpanLike;
  }): OutlineNode | undefined => {
    if (declaration.property === undefined || declaration.span === undefined) return undefined;
    return {
      name: declaration.property,
      ...(declaration.value === undefined ? {} : { detail: declaration.value.trim() }),
      kind: "declaration",
      range: spanRange(analysis, declaration.span),
      children: [],
    };
  };

  const declarationChildren = (
    declarations: readonly { property?: string; value?: string; span?: SpanLike }[],
  ): OutlineNode[] => {
    const children: OutlineNode[] = [];
    for (const declaration of declarations) {
      const node = declarationNode(declaration);
      if (node !== undefined) children.push(node);
    }
    return children;
  };

  const ruleNode = (rule: RuleLike): OutlineNode => {
    const children: OutlineNode[] = [];
    for (const item of rule.body) {
      const child = item as {
        kind?: string;
        name?: string;
        span?: SpanLike;
        selector?: string;
        selectorSpan?: SpanLike;
        body?: readonly unknown[];
        declarations?: readonly { property?: string; value?: string; span?: SpanLike }[];
        property?: string;
        value?: string;
        variant?: { aliases: readonly string[] };
      };
      if (child.kind === "rule" && child.selector !== undefined && child.span !== undefined) {
        children.push(
          ruleNode({
            selector: child.selector,
            selectorSpan: child.selectorSpan ?? child.span,
            span: child.span,
            body: child.body ?? [],
          }),
        );
      } else if (child.kind === "conditional-block" && child.span !== undefined) {
        const aliases = child.variant?.aliases ?? [];
        children.push({
          name: `@${aliases.join("+")}`,
          detail: "conditional block",
          kind: "rule",
          range: spanRange(analysis, child.span),
          children: (child.body ?? [])
            .filter((nested) => (nested as { kind?: string }).kind === "rule")
            .map((nested) => {
              const nestedRule = nested as {
                selector: string;
                selectorSpan?: SpanLike;
                span: SpanLike;
                body?: readonly unknown[];
              };
              return ruleNode({
                selector: nestedRule.selector,
                selectorSpan: nestedRule.selectorSpan ?? nestedRule.span,
                span: nestedRule.span,
                body: nestedRule.body ?? [],
              });
            }),
        });
      } else if (
        child.kind === "group-use-site" &&
        child.name !== undefined &&
        child.span !== undefined
      ) {
        children.push({
          name: `@group.${child.name}`,
          detail: "group use",
          kind: "group",
          range: spanRange(analysis, child.span),
          children: declarationChildren(child.declarations ?? []),
        });
      } else if (child.kind === "declaration") {
        const node = declarationNode(child);
        if (node !== undefined) children.push(node);
      }
    }
    return {
      name: rule.selector,
      kind: "rule",
      range: spanRange(analysis, rule.span),
      children,
    };
  };

  for (const item of ast.items) {
    switch (item.kind) {
      case "setup":
        nodes.push({
          name: "@setup",
          kind: "setup",
          range: spanRange(analysis, item.span),
          children: item.settings.map((setting) => ({
            name: setting.key,
            detail: setting.value,
            kind: "declaration" as const,
            range: spanRange(analysis, setting.span),
            children: [],
          })),
        });
        break;
      case "use":
        nodes.push({
          name: `@use ${item.path}`,
          ...(item.alias === undefined ? {} : { detail: `as ${item.alias}` }),
          kind: "use",
          range: spanRange(analysis, item.span),
          children: [],
        });
        break;
      case "variables":
        nodes.push({
          name: "@variables",
          kind: "variables",
          range: spanRange(analysis, item.span),
          children: item.tokens.map((token) => ({
            name: `$${token.name}`,
            detail: token.value,
            kind: "token" as const,
            range: spanRange(analysis, token.span),
            children: [],
          })),
        });
        break;
      case "runtime":
        nodes.push({
          name: "@runtime",
          kind: "runtime",
          range: spanRange(analysis, item.span),
          children: item.declarations.map((declaration) => ({
            name: declaration.property,
            detail: declaration.value,
            kind: "token" as const,
            range: spanRange(analysis, declaration.span),
            children: [],
          })),
        });
        break;
      case "media-types":
        nodes.push({
          name: "@media-types",
          kind: "media-types",
          range: spanRange(analysis, item.span),
          children: item.aliases.map((alias) => ({
            name: alias.name,
            detail: alias.media,
            kind: "alias" as const,
            range: spanRange(analysis, alias.span),
            children: [],
          })),
        });
        break;
      case "group-definition":
        nodes.push({
          name: `@group.${item.name}`,
          detail: "group definition",
          kind: "group",
          range: spanRange(analysis, item.span),
          children: declarationChildren(item.declarations),
        });
        break;
      case "rule":
        nodes.push(
          ruleNode({
            selector: item.selector,
            selectorSpan: item.selectorSpan,
            span: item.span,
            body: item.body,
          }),
        );
        break;
      case "native-at-rule":
        nodes.push({
          name: `@${item.name}`,
          ...(item.prelude === "" ? {} : { detail: item.prelude }),
          kind: "native",
          range: spanRange(analysis, item.span),
          children: [],
        });
        break;
      default:
        break;
    }
  }
  return nodes;
}

/** Position of an absolute offset (test helper). */
export function positionFor(
  analysis: AnalyzeResult,
  offset: number,
): { line: number; character: number } {
  return positionAt(analysis.lineStarts, offset);
}

/** Token reference type re-export for provider adapters. */
export type { TokenReference };
