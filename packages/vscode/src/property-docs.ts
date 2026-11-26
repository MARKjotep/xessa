/**
 * One-sentence descriptions for the CSS properties Xessa offers inside rule
 * bodies. Pure data: the extension adapters and the intelligence layer use the
 * same strings for hover and completion documentation.
 */

/**
 * Built-in property documentation keyed by property name.
 *
 * Covers every offered property name, standard and vendor-prefixed; each value
 * is a single MDN-style sentence (sentence case, trailing period).
 */
export const CSS_PROPERTY_DOCS: Readonly<Record<string, string>> = Object.freeze({
  "-moz-appearance":
    "Legacy Mozilla spelling of `appearance` that only very old Firefox versions still need.",
  "-moz-border-radius":
    "Legacy Mozilla fallback for `border-radius`, needed only by very old Firefox versions.",
  "-moz-box-shadow":
    "Legacy Mozilla fallback for `box-shadow`, needed only by very old Firefox versions.",
  "-moz-hyphens": "Legacy Mozilla spelling of `hyphens` for older Firefox versions.",
  "-moz-osx-font-smoothing":
    "Non-standard Mozilla-only property that adjusts font smoothing on macOS.",
  "-moz-tab-size": "Legacy Mozilla spelling of `tab-size` for older Firefox versions.",
  "-moz-transform":
    "Legacy Mozilla fallback for `transform`, needed only by very old Firefox versions.",
  "-moz-transform-origin":
    "Legacy Mozilla fallback for `transform-origin`, needed only by very old Firefox versions.",
  "-moz-transition":
    "Legacy Mozilla fallback for `transition`, needed only by very old Firefox versions.",
  "-moz-user-select": "Legacy Mozilla spelling of `user-select` for older Firefox versions.",
  "-webkit-animation":
    "Legacy WebKit fallback for `animation`, needed only by very old WebKit engines.",
  "-webkit-appearance":
    "WebKit spelling of `appearance`, still required by some WebKit browsers to style form controls.",
  "-webkit-backdrop-filter":
    "WebKit spelling of `backdrop-filter`, still required by some WebKit browsers such as Safari.",
  "-webkit-background-clip":
    "WebKit spelling of `background-clip`, historically required for clipping a background to text.",
  "-webkit-border-radius":
    "Legacy WebKit fallback for `border-radius`, needed only by very old WebKit engines.",
  "-webkit-box-align":
    "Legacy WebKit flexbox property aligning child boxes along the old box model's axis.",
  "-webkit-box-flex":
    "Legacy WebKit flexbox property setting how a child box grows to fill free space.",
  "-webkit-box-ordinal-group":
    "Legacy WebKit flexbox property ordering child boxes by group number.",
  "-webkit-box-orient": "Legacy WebKit flexbox property setting the old box model's axis.",
  "-webkit-box-pack":
    "Legacy WebKit flexbox property packing child boxes along the old box model's axis.",
  "-webkit-box-shadow":
    "Legacy WebKit fallback for `box-shadow`, needed only by very old WebKit engines.",
  "-webkit-clip-path": "WebKit spelling of `clip-path` for engines that still require the prefix.",
  "-webkit-filter": "WebKit spelling of `filter` for engines that still require the prefix.",
  "-webkit-font-smoothing":
    "Non-standard WebKit-only property that adjusts font smoothing on macOS.",
  "-webkit-hyphens": "WebKit spelling of `hyphens` for engines that still require the prefix.",
  "-webkit-line-clamp":
    "WebKit spelling of `line-clamp`, usually combined with the legacy flexbox box model.",
  "-webkit-mask":
    "WebKit spelling of the `mask` shorthand for engines that still require the prefix.",
  "-webkit-mask-image":
    "WebKit spelling of `mask-image` for engines that still require the prefix.",
  "-webkit-mask-position":
    "WebKit spelling of `mask-position` for engines that still require the prefix.",
  "-webkit-mask-repeat":
    "WebKit spelling of `mask-repeat` for engines that still require the prefix.",
  "-webkit-mask-size": "WebKit spelling of `mask-size` for engines that still require the prefix.",
  "-webkit-overflow-scrolling":
    "Non-standard WebKit property opting an element into momentum scrolling on iOS.",
  "-webkit-tap-highlight-color":
    "Non-standard WebKit property setting the highlight color shown when a link is tapped on mobile.",
  "-webkit-text-fill-color":
    "WebKit property setting the fill color of text, often made transparent for gradient text.",
  "-webkit-text-size-adjust":
    "Non-standard WebKit property controlling automatic text inflation on mobile browsers.",
  "-webkit-text-stroke":
    "WebKit shorthand for the width and color of an outline drawn around text.",
  "-webkit-text-stroke-color":
    "WebKit property setting the color of the outline drawn by `-webkit-text-stroke`.",
  "-webkit-text-stroke-width":
    "WebKit property setting the thickness of the outline drawn by `-webkit-text-stroke`.",
  "-webkit-touch-callout":
    "Non-standard WebKit property controlling whether iOS shows the callout menu on a long press.",
  "-webkit-transform":
    "Legacy WebKit fallback for `transform`, needed only by very old WebKit engines.",
  "-webkit-transform-origin":
    "Legacy WebKit fallback for `transform-origin`, needed only by very old WebKit engines.",
  "-webkit-transition":
    "Legacy WebKit fallback for `transition`, needed only by very old WebKit engines.",
  "-webkit-user-select": "Legacy WebKit spelling of `user-select` for older WebKit engines.",
  "accent-color":
    "Sets the accent color used by native form controls such as checkboxes and radios.",
  "align-content":
    "Distributes space between and around content lines along the cross axis of a flex or grid container.",
  "align-items": "Sets the default alignment of flex or grid items along the cross axis.",
  "align-self": "Overrides a flex or grid item's cross-axis alignment set by `align-items`.",
  animation: "Shorthand for applying one or more keyframe animations to an element.",
  "animation-delay":
    "Sets how long an animation waits before it starts; negative values start partway through.",
  "animation-direction":
    "Chooses whether an animation runs forwards, backwards or alternates on each cycle.",
  "animation-duration": "Sets how long one animation cycle takes.",
  "animation-fill-mode": "Chooses which animation values apply before it starts and after it ends.",
  "animation-iteration-count":
    "Sets how many times an animation cycle repeats (`infinite` for endless).",
  "animation-name": "Names the `@keyframes` block an animation runs.",
  "animation-play-state": "Pauses or resumes a running animation (`paused`, `running`).",
  "animation-timing-function":
    "Sets the easing curve applied between an animation's frames (`ease`, `linear`, `steps(4)`).",
  appearance: "Requests native platform styling for a form control, or removes it with `none`.",
  "aspect-ratio": "Sets a preferred width-to-height ratio for a box (`16 / 9`).",
  "backdrop-filter": "Applies graphical filters such as blur to the area behind an element.",
  "backface-visibility":
    "Chooses whether the back face of a transformed element is visible when turned away from the viewer.",
  background:
    "Shorthand for the color, image, position, size and repetition of an element's background.",
  "background-attachment":
    "Chooses whether a background image scrolls with the element or stays fixed to the viewport.",
  "background-blend-mode":
    "Blends a background image with the element's background color or with other background images.",
  "background-clip":
    "Limits how far an element's background paints, for example to the content box or text.",
  "background-color": "Sets the solid color painted behind an element's content.",
  "background-image": "Sets one or more images or gradients drawn as an element's background.",
  "background-origin":
    "Sets the box (border, padding or content) that a background image's position is relative to.",
  "background-position":
    "Sets the starting position of a background image within its positioning area.",
  "background-repeat": "Chooses whether and how a background image tiles to fill its area.",
  "background-size":
    "Sets the rendered size of a background image (`cover`, `contain` or explicit lengths).",
  border: "Shorthand for the width, style and color of all four borders.",
  "border-bottom": "Shorthand for the width, style and color of the bottom border.",
  "border-bottom-color": "Sets the color of the bottom border.",
  "border-collapse":
    "Chooses whether table borders are collapsed into a single shared border or kept separate.",
  "border-color": "Sets the color of all four borders.",
  "border-left": "Shorthand for the width, style and color of the left border.",
  "border-left-color": "Sets the color of the left border.",
  "border-radius": "Rounds the corners of an element's border box.",
  "border-right": "Shorthand for the width, style and color of the right border.",
  "border-right-color": "Sets the color of the right border.",
  "border-style": "Sets the line style (`solid`, `dashed`, `dotted`, …) of all four borders.",
  "border-top": "Shorthand for the width, style and color of the top border.",
  "border-top-color": "Sets the color of the top border.",
  "border-width": "Sets the thickness of all four borders.",
  bottom: "Offsets a positioned element from the bottom edge of its containing block.",
  "box-shadow": "Draws one or more shadows behind an element's box.",
  "box-sizing":
    "Chooses whether width and height include padding and borders (`border-box`) or only content (`content-box`).",
  "break-after": "Requests a page, column or region break after a generated box.",
  "break-before": "Requests a page, column or region break before a generated box.",
  "break-inside": "Prevents or allows a page, column or region break inside a generated box.",
  "caret-color": "Sets the color of the text insertion caret.",
  "clip-path": "Clips an element to a shape such as a circle, polygon or inset rectangle.",
  color: "Sets the foreground text and caret color of an element.",
  "color-scheme":
    "Declares which color schemes an element can render, letting the browser style native controls accordingly.",
  "column-count": "Sets the number of columns multi-column content is divided into.",
  "column-fill": "Chooses whether multi-column content fills columns in order or balances them.",
  "column-gap": "Sets the gap between columns in flex, grid or multi-column layout.",
  "column-rule-color": "Sets the color of the rule drawn between columns of multi-column text.",
  "column-width": "Sets a preferred column width in multi-column layout.",
  columns: "Shorthand for the column width and column count of multi-column layout.",
  contain:
    "Restricts layout, paint and size calculations to an element's subtree to improve performance.",
  container: "Shorthand for `container-name` and `container-type`.",
  "container-name": "Names a containment context so `@container` queries can target it.",
  "container-type":
    "Declares the type of containment context an element establishes for container queries.",
  content: "Inserts generated content in `::before` and `::after` pseudo-elements.",
  "content-visibility":
    "Lets the browser skip rendering an element's contents until they are needed.",
  cursor: "Sets the mouse pointer shown over an element (`pointer`, `grab`, …).",
  direction: "Sets the base text direction of an element's content (`ltr` or `rtl`).",
  display:
    "Chooses the element's outer and inner display type (`block`, `flex`, `grid`, `none`, …).",
  fill: "Sets the color used to paint the inside of an SVG shape.",
  filter: "Applies graphical effects such as blur, brightness or drop shadow to an element.",
  flex: "Shorthand for growing, shrinking and setting the base size of a flex item.",
  "flex-basis": "Sets the initial main size of a flex item before free space is distributed.",
  "flex-direction": "Sets the main axis of a flex container (`row`, `column` and their reverses).",
  "flex-flow":
    "Shorthand for the direction and wrapping of a flex container (`flex-direction` and `flex-wrap`).",
  "flex-grow": "Sets how much a flex item grows to fill free space relative to its siblings.",
  "flex-shrink": "Sets how much a flex item shrinks when space is insufficient.",
  "flex-wrap": "Chooses whether flex items stay on one line or wrap onto several.",
  float: "Moves an element to the left or right so following content flows around it.",
  font: "Shorthand for the family, size, style, weight and line height of text.",
  "font-family": "Sets a prioritized list of typefaces for text.",
  "font-size": "Sets the size of text.",
  "font-style": "Chooses upright, italic or oblique text.",
  "font-variant-numeric":
    "Chooses alternate glyphs for numbers such as tabular or old-style figures.",
  "font-weight": "Sets the boldness of text (`400`, `700`, `bold`, …).",
  gap: "Shorthand for the row and column gaps in flex, grid or multi-column layout.",
  grid: "Shorthand for defining a grid container's rows, columns, areas and auto flow.",
  "grid-area": "Places a grid item into named or explicit rows, columns and areas.",
  "grid-auto-columns": "Sets the size of columns generated for implicitly placed grid items.",
  "grid-auto-flow": "Chooses how automatically placed grid items fill rows and columns.",
  "grid-auto-rows": "Sets the size of rows generated for implicitly placed grid items.",
  "grid-column": "Places a grid item across a span of columns or into one column.",
  "grid-row": "Places a grid item across a span of rows or into one row.",
  "grid-template-areas": "Defines named grid areas as a rectangular grid of names.",
  "grid-template-columns":
    "Defines a grid container's column tracks (`1fr 1fr`, `repeat(3, 1fr)`, …).",
  "grid-template-rows": "Defines a grid container's row tracks.",
  height: "Sets the height of an element's content box.",
  hyphens: "Chooses whether words may be hyphenated at line breaks.",
  "image-rendering": "Chooses the scaling algorithm the browser uses when resizing images.",
  inset: "Shorthand for the top, right, bottom and left offsets of a positioned element.",
  "inset-block": "Sets the block-axis start and end offsets of a positioned element.",
  "inset-inline": "Sets the inline-axis start and end offsets of a positioned element.",
  isolation:
    "Creates a new stacking context so an element's blending is isolated from its backdrop.",
  "justify-content":
    "Distributes free space between and around flex or grid items along the main or inline axis.",
  "justify-items": "Sets the default inline-axis alignment of grid items inside their cells.",
  "justify-self": "Overrides one grid item's inline-axis alignment inside its cell.",
  left: "Offsets a positioned element from the left edge of its containing block.",
  "letter-spacing": "Sets extra spacing between characters of text.",
  "line-clamp":
    "Limits a block to a number of lines and adds an ellipsis when content is truncated.",
  "line-height": "Sets the height of a line box relative to its text.",
  "list-style": "Shorthand for the marker type, position and image of list items.",
  margin: "Shorthand for the outer spacing on all four sides of an element.",
  "margin-block": "Sets the block-axis start and end margins of an element.",
  "margin-bottom": "Sets the outer spacing below an element.",
  "margin-inline": "Sets the inline-axis start and end margins of an element.",
  "margin-left": "Sets the outer spacing to the left of an element.",
  "margin-right": "Sets the outer spacing to the right of an element.",
  "margin-top": "Sets the outer spacing above an element.",
  "mask-image": "Sets an image or gradient used to mask the visible parts of an element.",
  "max-height": "Caps how tall an element may grow.",
  "max-width": "Caps how wide an element may grow.",
  "min-height": "Sets the smallest height an element may shrink to.",
  "min-width": "Sets the smallest width an element may shrink to.",
  "mix-blend-mode": "Blends an element with the content behind it using a blend mode.",
  "object-fit": "Chooses how a replaced element's content fits its box (`cover`, `contain`, …).",
  "object-position": "Sets the alignment of a replaced element's content inside its box.",
  opacity: "Sets how transparent an element and its contents are, from `0` to `1`.",
  order: "Reorders a flex or grid item relative to its siblings without changing the source.",
  outline: "Shorthand for a line drawn around an element without affecting layout.",
  "outline-color": "Sets the color of the outline drawn around an element.",
  "outline-offset": "Moves an outline outward from the element's border edge.",
  "outline-style": "Sets the line style of the outline drawn around an element.",
  "outline-width": "Sets the thickness of the outline drawn around an element.",
  overflow: "Chooses whether content that overflows a box is clipped or scrollable.",
  "overflow-wrap": "Chooses whether long words may break to prevent overflow.",
  "overflow-x": "Chooses whether horizontal overflow is clipped or scrollable.",
  "overflow-y": "Chooses whether vertical overflow is clipped or scrollable.",
  "overscroll-behavior":
    "Chooses whether scrolling past an element's edge chains to its scroll container.",
  padding: "Shorthand for the inner spacing on all four sides of an element.",
  "padding-block": "Sets the block-axis start and end padding of an element.",
  "padding-bottom": "Sets the inner spacing below an element's content.",
  "padding-inline": "Sets the inline-axis start and end padding of an element.",
  "padding-left": "Sets the inner spacing to the left of an element's content.",
  "padding-right": "Sets the inner spacing to the right of an element's content.",
  "padding-top": "Sets the inner spacing above an element's content.",
  perspective:
    "Sets the distance from the viewer to the z=0 plane for 3D transforms of child elements.",
  "place-content": "Shorthand for `align-content` and `justify-content`.",
  "place-items": "Shorthand for `align-items` and `justify-items` in a grid or flex container.",
  "place-self": "Shorthand for `align-self` and `justify-self`.",
  "pointer-events":
    "Chooses whether an element responds to pointer input, or lets events pass through (`none`).",
  position:
    "Chooses how an element is positioned (`static`, `relative`, `absolute`, `fixed`, `sticky`).",
  quotes:
    "Sets the quotation marks used by the `open-quote` and `close-quote` values of `content`.",
  resize: "Chooses whether a user may resize an element and along which axes.",
  right: "Offsets a positioned element from the right edge of its containing block.",
  rotate: "Rotates an element independently of the `transform` property.",
  "row-gap": "Sets the gap between rows in flex, grid or multi-column layout.",
  scale: "Scales an element independently of the `transform` property.",
  "scroll-behavior": "Chooses whether programmatic scrolling is smooth or instant.",
  "scroll-margin": "Sets the outset around a snap area used when scrolling an element into view.",
  "scroll-padding":
    "Sets the inset of a scroll container's optimal viewing region for scrolling into view.",
  "scroll-snap-align":
    "Chooses which part of a snap target aligns with the scroll container's snap position.",
  "scroll-snap-type": "Enables scroll snapping on a container and chooses its axis and strictness.",
  "scrollbar-color": "Sets the thumb and track colors of a scrollbar.",
  "scrollbar-gutter": "Reserves space for a scrollbar so content does not shift when it appears.",
  "scrollbar-width": "Sets the thickness of a scrollbar (`auto`, `thin` or `none`).",
  stroke: "Sets the color used to paint the outline of an SVG shape.",
  "table-layout":
    "Chooses whether table column widths are based on content or fixed by the first row.",
  "text-align":
    "Aligns inline content horizontally inside its line box (`left`, `center`, `right`, `justify`).",
  "text-decoration":
    "Shorthand for underlines, overlines, line-throughs and their color and style.",
  "text-decoration-color": "Sets the color of the lines drawn by `text-decoration`.",
  "text-decoration-line":
    "Chooses which lines (`underline`, `overline`, `line-through`) `text-decoration` draws.",
  "text-decoration-style":
    "Sets the line style (`solid`, `double`, `dotted`, …) of `text-decoration`.",
  "text-decoration-thickness": "Sets the thickness of the lines drawn by `text-decoration`.",
  "text-indent": "Indents the first line of a block of text.",
  "text-overflow":
    "Chooses how clipped overflowing single-line text is marked (`ellipsis`, `clip`).",
  "text-shadow": "Draws one or more shadows behind text.",
  "text-transform": "Changes the capitalization of text (`uppercase`, `lowercase`, `capitalize`).",
  "text-underline-offset": "Moves an underline away from the text baseline.",
  "text-wrap": "Chooses how text wraps within its container (`wrap`, `nowrap`, `balance`, …).",
  top: "Offsets a positioned element from the top edge of its containing block.",
  "touch-action": "Chooses which touch gestures the browser may handle for an element.",
  transform: "Applies translation, rotation, scaling or skewing to an element.",
  "transform-origin": "Sets the point around which an element's transforms are applied.",
  transition: "Shorthand for animating property changes over time with easing and delay.",
  "transition-delay": "Sets how long a transition waits before it starts.",
  "transition-duration": "Sets how long a transition takes to complete.",
  "transition-property": "Names the properties whose changes are animated by `transition`.",
  "transition-timing-function": "Sets the easing curve applied between transition keyframes.",
  translate: "Moves an element independently of the `transform` property.",
  "user-select": "Chooses whether text in an element can be selected by the user.",
  "vertical-align": "Sets the vertical alignment of inline, inline-block or table-cell boxes.",
  visibility: "Shows or hides an element while keeping its layout space (`hidden`).",
  "white-space":
    "Chooses how white space and line wrapping are handled (`nowrap`, `pre`, `pre-wrap`, …).",
  width: "Sets the width of an element's content box.",
  "will-change": "Hints which properties are likely to change so the browser can optimize ahead.",
  "word-break":
    "Chooses where to break words that would otherwise overflow (`break-all`, `keep-all`).",
  "word-spacing": "Sets extra spacing between words.",
  "writing-mode": "Sets whether lines are laid out horizontally or vertically and their direction.",
  "z-index": "Stacks a positioned element relative to its siblings along the z axis.",
  zoom: "Scales an element and its layout; unlike a transform it also affects surrounding layout.",
});

/**
 * Description for one CSS property name.
 *
 * Returns `undefined` for unknown names so callers can skip hover or leave
 * completion documentation empty.
 */
export function propertyDoc(name: string): string | undefined {
  return Object.hasOwn(CSS_PROPERTY_DOCS, name) ? CSS_PROPERTY_DOCS[name] : undefined;
}
