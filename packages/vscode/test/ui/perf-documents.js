/**
 * Deterministic documents for the U5 host-latency scenario.
 *
 * `tests/stress/editor/documents.ts` (TT6) is the corpus of record for the pure
 * layer, but it is TypeScript and this suite runs as plain CommonJS inside the
 * extension host, which cannot load `.ts`. The generator below is therefore a
 * **local reimplementation of the same document shape**, not an import:
 * `@setup`, `@media-types`, `@variables`, `@runtime`, `@keyframes`, a
 * `@group.<name>` definition, and a block grid of rules that reference tokens,
 * use inline media variants, nest `@alias` blocks, `&:hover`, `& > .child`,
 * group use sites and `$keyframes.` lookups.
 *
 * Consequences, recorded in `.ai/reports/CSSX-U5.md`:
 * - the shape is the same, the bytes are not, so absolute numbers differ a
 *   little from TT6's; provider deltas (host vs pure) are the comparable part.
 * - the PRNG is a local xorshift32 with the same determinism contract as TT6's
 *   (`tests/stress/editor/documents.ts` also keeps a local PRNG so a phase never
 *   depends on a sibling's write set).
 *
 * Every function here is a pure function of the seed: the same seed produces a
 * byte-identical document in any host.
 */

/** Seed used when a caller does not pass one. */
const DEFAULT_SEED = 1;

/** xorshift32 with the same contract as TT6's `SeededRandom`. */
function createRandom(seed) {
  let state = seed >>> 0 || 0x9e3779b9;
  const next = () => {
    let x = state;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    state = x;
    return x;
  };
  return {
    next,
    int(bound) {
      return bound <= 0 ? 0 : next() % bound;
    },
    pick(items) {
      return items[this.int(items.length)];
    },
  };
}

const MEDIA_ALIASES = ["md", "lg", "xl", "dark", "compact", "portrait"];
const INLINE_VARIANTS = ["@md", "@xl+dark", "@dark", "@print"];
const TOKENS = [
  "gap",
  "gap-lg",
  "radius",
  "radius-lg",
  "brand",
  "brand-soft",
  "ink",
  "surface",
  "border",
  "duration",
];
const RUNTIME_TOKENS = ["page", "panel", "highlight", "muted"];
const PROPERTIES = [
  "padding",
  "margin",
  "color",
  "background",
  "border-radius",
  "display",
  "gap",
  "font-size",
  "line-height",
  "opacity",
];
const COLOURS = ["#2563eb", "#e74c3c", "#111827", "#f59e0b"];

/**
 * A clean, large Xessa stylesheet (zero diagnostics by construction).
 *
 * `lines` is approximate: the block grid emits 15 lines per rule, so the result
 * overshoots the target by less than one block.
 */
function generateLargeDocument(options = {}) {
  const targetLines = options.lines ?? 10000;
  const random = createRandom(options.seed ?? DEFAULT_SEED);
  const lines = [
    '@setup { prefix: "stress"; }',
    "@media-types {",
    "  compact: (max-width: 600px);",
    "  wide: (min-width: 1440px);",
    "}",
    "@variables {",
  ];
  for (const [index, token] of TOKENS.entries()) lines.push(`  ${token}: ${index + 1}px;`);
  lines.push("}", "@runtime {");
  for (const token of RUNTIME_TOKENS) {
    lines.push(`  ${token}: #ffffff;`);
    lines.push(`  ${token} @dark: #111827;`);
  }
  lines.push(
    "}",
    "@keyframes spin-stress {",
    "  from { opacity: 0; }",
    "  to { opacity: 1; }",
    "}",
    "@group.stress-card {",
    "  padding: $gap;",
    "  border-radius: $radius;",
    "}",
    "",
  );

  let rule = 0;
  while (lines.length < targetLines) {
    const name = `rule-${rule}`;
    lines.push(
      `.${name} {`,
      `  ${random.pick(PROPERTIES)}: $${random.pick(TOKENS)};`,
      `  padding: 4px ${random.pick(INLINE_VARIANTS)} 8px ${random.pick(INLINE_VARIANTS)} 12px;`,
      `  color: ${random.pick(COLOURS)};`,
      `  @${random.pick(MEDIA_ALIASES)} {`,
      `    ${random.pick(PROPERTIES)}: $${random.pick(TOKENS)};`,
      "    @dark { background: $page; }",
      "  }",
      "  &:hover { opacity: 0.85; }",
      "  &:focus-visible { outline-color: $brand; }",
      `  & > .${name}-icon { width: 16px; }`,
      "  @group.stress-card {",
      "    border-radius: $radius-lg;",
      "  }",
      "  animation-name: $keyframes.spin-stress;",
      "  animation-duration: $duration;",
      "}",
      "",
    );
    rule += 1;
  }
  return lines.join("\n");
}

/**
 * The keystroke corpus: a short, valid document whose characters cover every
 * trigger the extension registers (`@ $ . : / & ( #`), used by the typing-pipeline
 * case. Kept short so a 200-keystroke storm stays inside the suite budget.
 */
const STORM_TEXT = [
  '@setup { prefix: "storm"; minify: false; }',
  "@variables { gap: 8px; brand: #2563eb; }",
  ".card {",
  "  padding: $gap @md 12px;",
  "  color: #e74c3c;",
  "  width: (calc(100% - 2px));",
  "  &:hover { color: $brand; }",
  "}",
  "",
].join("\n");

/** A small document that is fine to edit 200 times (one rule, two declarations). */
const EDITABLE_TEXT = ".card {\n  color: red;\n  padding: 4px;\n}\n";

module.exports = {
  DEFAULT_SEED,
  EDITABLE_TEXT,
  STORM_TEXT,
  generateLargeDocument,
};
