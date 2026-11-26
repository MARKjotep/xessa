/**
 * Deterministic document generation for the editor stress harness (TT6).
 *
 * Everything here is a pure function of a caller-supplied seed: the same seed
 * produces byte-identical text on any machine, so a failing latency or storm
 * case is replayable from the seed alone. No wall-clock, PID or
 * `Math.random()` input is used, matching `tests/stress/README.md`.
 *
 * The generator deliberately avoids `tests/stress/prng.ts`: that module is
 * owned by the TT1 fuzz phase, and TT6 must not depend on a sibling's write
 * set. The PRNG below is a local xorshift32 with the same determinism contract.
 */

/** Seed used when a case does not pass one (`XESSA_STRESS_SEED` stays TT1-owned). */
export const DEFAULT_SEED = 1;

/** Small deterministic PRNG: xorshift32 over a 32-bit state. */
export class SeededRandom {
  private state: number;

  constructor(seed: number = DEFAULT_SEED) {
    // `>>> 0` keeps the state unsigned; zero is remapped because xorshift32
    // has a fixed point there.
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  /** Next 32-bit unsigned value. */
  next(): number {
    let x = this.state;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.state = x;
    return x;
  }

  /** Integer in `[0, bound)`. */
  int(bound: number): number {
    return bound <= 0 ? 0 : this.next() % bound;
  }

  /** One element of a non-empty list. */
  pick<T>(items: readonly T[]): T {
    const value = items[this.int(items.length)];
    if (value === undefined) throw new Error("pick() on an empty list");
    return value;
  }
}

/** Options for {@link generateLargeDocument}. */
export interface LargeDocumentOptions {
  /** Approximate line count of the result (rounded up to the block grid). */
  readonly lines?: number;
  readonly seed?: number;
}

const MEDIA_ALIASES = ["md", "lg", "xl", "dark", "compact", "portrait"] as const;
const INLINE_VARIANTS = ["@md", "@xl+dark", "@dark", "@print"] as const;

/** Token names used by the generated document, declared once in `@variables`. */
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
] as const;

const RUNTIME_TOKENS = ["page", "panel", "highlight", "muted"] as const;

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
] as const;

/**
 * Deterministic large document: many rules, token references, inline media
 * variants, `@` alias blocks, `&` nesting, group definitions/use sites,
 * `@keyframes` and hex colours.
 *
 * The shape mirrors a real stylesheet closely enough that completion, hover,
 * rename and definition all have real work to do: tokens resolve, classes are
 * prefixed, aliases merge and colours are collected.
 */
export function generateLargeDocument(options: LargeDocumentOptions = {}): string {
  const targetLines = options.lines ?? 10_000;
  const random = new SeededRandom(options.seed ?? DEFAULT_SEED);
  const lines: string[] = [];

  lines.push('@setup { prefix: "stress"; }');
  lines.push("@media-types {");
  lines.push("  compact: (max-width: 600px);");
  lines.push("  wide: (min-width: 1440px);");
  lines.push("}");
  lines.push("@variables {");
  for (const [index, token] of TOKENS.entries()) {
    lines.push(`  ${token}: ${index + 1}px;`);
  }
  lines.push("}");
  lines.push("@runtime {");
  for (const token of RUNTIME_TOKENS) {
    lines.push(`  ${token}: #ffffff;`);
    lines.push(`  ${token} @dark: #111827;`);
  }
  lines.push("}");
  lines.push("@keyframes spin-stress {");
  lines.push("  from { opacity: 0; }");
  lines.push("  to { opacity: 1; }");
  lines.push("}");
  lines.push("@group.stress-card {");
  lines.push("  padding: $gap;");
  lines.push("  border-radius: $radius;");
  lines.push("}");
  lines.push("");

  let rule = 0;
  while (lines.length < targetLines) {
    const name = `rule-${rule}`;
    lines.push(`.${name} {`);
    lines.push(`  ${random.pick(PROPERTIES)}: $${random.pick([...TOKENS])};`);
    lines.push(
      `  padding: 4px ${random.pick([...INLINE_VARIANTS])} 8px ${random.pick([...INLINE_VARIANTS])} 12px;`,
    );
    lines.push(`  color: ${random.pick(["#2563eb", "#e74c3c", "#111827", "#f59e0b"])};`);
    lines.push(`  @${random.pick([...MEDIA_ALIASES])} {`);
    lines.push(`    ${random.pick(PROPERTIES)}: $${random.pick([...TOKENS])};`);
    lines.push("    @dark { background: $page; }");
    lines.push("  }");
    lines.push("  &:hover { opacity: 0.85; }");
    lines.push("  &:focus-visible { outline-color: $brand; }");
    lines.push(`  & > .${name}-icon { width: 16px; }`);
    lines.push("  @group.stress-card {");
    lines.push("    border-radius: $radius-lg;");
    lines.push("  }");
    lines.push("  animation-name: $keyframes.spin-stress;");
    lines.push("  animation-duration: $duration;");
    lines.push("}");
    lines.push("");
    rule += 1;
  }

  return lines.join("\n");
}

/** One representative document per A45–A51 editor surface. */
export interface MidEditDocument {
  /** Stable case name used in failure messages. */
  readonly name: string;
  /** The complete (well-formed enough) document the author was typing. */
  readonly text: string;
}

/**
 * The A45–A51 generation documents: the five shapes whose mid-edit prefixes the
 * providers must survive. Each is short (well under 400 characters) so the full
 * truncation corpus stays cheap.
 */
export const MID_EDIT_DOCUMENTS: readonly MidEditDocument[] = Object.freeze([
  {
    // A45/A49: a hex colour line inside a colour-accepting declaration.
    name: "color-line",
    text: ".card {\n  color: #e74c3c;\n  background: white @dark #111827;\n}\n",
  },
  {
    // A50: the paren trigger, a nested call and a unit after a number.
    name: "paren-trigger",
    text: ".box {\n  width: (calc(100% - 20px));\n  padding: 12px;\n  margin: (clamp(1rem, 2vw, 3rem));\n}\n",
  },
  {
    // A46: `&:` and `&.` repair ranges plus a real class to complete.
    name: "nested-ampersand",
    text: ".test { color: blue; }\n.a {\n  &:hov\n  &.te\n  & > .test { color: red; }\n}\n",
  },
  {
    // A45: a multi-line `@setup` block with keys, quotes and booleans.
    name: "setup-block",
    text: '@setup {\n  prefix: "ui";\n  css-dir: "../generated/styles";\n  minify: true;\n}\n.a { display: flex; }\n',
  },
  {
    // A51-era imports: a `@use` line whose specifier is being typed.
    name: "use-line",
    text: '@use "./theme.cssx" styles;\n@use "./tokens.cssx" as theme;\n.a { color: $theme.primary; }\n',
  },
]);

/** Every non-empty truncated prefix of `text`, shortest first. */
export function truncatedPrefixes(text: string): string[] {
  const prefixes: string[] = [];
  for (let end = 1; end <= text.length; end += 1) prefixes.push(text.slice(0, end));
  return prefixes;
}

/** Keystroke storm corpus: one document typed one character at a time. */
export interface StormDocument {
  readonly name: string;
  readonly text: string;
}

/**
 * The storm corpus: a superset of {@link MID_EDIT_DOCUMENTS} plus a document
 * that exercises every trigger character the extension registers
 * (`@`, `$`, `.`, `:`, `/`, `&`, `(`, `#`).
 */
export const STORM_DOCUMENTS: readonly StormDocument[] = Object.freeze([
  ...MID_EDIT_DOCUMENTS,
  {
    name: "all-triggers",
    text: [
      '@setup { prefix: "storm"; minify: false; }',
      "@media-types { compact: (max-width: 600px); }",
      "@variables { gap: 8px; brand: #2563eb; }",
      "@runtime { page: #ffffff; page @dark: #0f172a; }",
      '@use "./theme.cssx" as theme;',
      "@keyframes fade { from { opacity: 0; } to { opacity: 1; } }",
      ".card {",
      "  padding: $gap @md 12px;",
      "  color: #e74c3c;",
      "  width: (calc(100% - 2px));",
      "  animation-name: $keyframes.fade;",
      "  &:hover { color: $brand; }",
      "  &.active { color: $theme.primary; }",
      "  @group.card { padding: 4px; }",
      "  @compact { display: none; }",
      "}",
      "",
    ].join("\n"),
  },
]);

/** Total storm corpus size in authored characters (recorded in the report). */
export function stormCorpusSize(documents: readonly StormDocument[] = STORM_DOCUMENTS): number {
  return documents.reduce((total, document) => total + document.text.length, 0);
}

/** One generated module project for the differential group/keyframe case. */
export interface GeneratedModuleProject {
  /** Module path → authored text (all paths absolute POSIX, under `/virtual`). */
  readonly files: ReadonlyMap<string, string>;
  /** Every module path, entry first. */
  readonly modules: readonly string[];
  /** The module the editor and the compiler both analyse from. */
  readonly entry: string;
}

const MODULE_NAMES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const VIRTUAL_ROOT = "/virtual";

/**
 * Deterministic module graph for the editor↔compiler differential test.
 *
 * Each module may import earlier modules (acyclic, the legal resolved shape) or
 * any module (`cyclic`, an already-diagnosed XESSA2001 error shape), declare
 * `@group.card`/`@group.panel` definitions (sometimes duplicated inside one
 * module) and `@keyframes spin`/`@keyframes fade` blocks. Styles edges use
 * `styles`, token-only edges do not, so the visibility closure is exercised in
 * both directions.
 */
export function generateModuleProject(
  seed: number,
  options: { readonly cyclic?: boolean } = {},
): GeneratedModuleProject {
  const random = new SeededRandom(seed);
  const cyclic = options.cyclic ?? false;
  const count = 3 + random.int(6);
  const modules = MODULE_NAMES.slice(0, count).map((name) => `${VIRTUAL_ROOT}/${name}.cssx`);
  const files = new Map<string, string>();

  for (const [index, file] of modules.entries()) {
    const lines: string[] = [];
    const seen = new Set<string>();
    const edges = random.int(3);
    for (let edge = 0; edge < edges; edge += 1) {
      const bound = cyclic ? modules.length : index;
      if (bound === 0) break;
      const target = modules[random.int(bound)];
      if (target === undefined || target === file || seen.has(target)) continue;
      seen.add(target);
      const styles = random.int(2) === 0;
      lines.push(`@use "./${posixBasename(target)}"${styles ? " styles" : ""};`);
    }
    const groupCount = random.int(3);
    for (let group = 0; group < groupCount; group += 1) {
      lines.push(`@group.${random.pick(["card", "panel"])} {`);
      lines.push(`  padding: ${index + 1}px;`);
      lines.push("}");
    }
    const keyframeCount = random.int(3);
    for (let keyframe = 0; keyframe < keyframeCount; keyframe += 1) {
      lines.push(`@keyframes ${random.pick(["spin", "fade"])} {`);
      lines.push("  from { opacity: 0; }");
      lines.push("  to { opacity: 1; }");
      lines.push("}");
    }
    lines.push(`.rule-${index} { color: #123456; }`);
    files.set(file, `${lines.join("\n")}\n`);
  }

  const entry = modules[0];
  if (entry === undefined) throw new Error("generateModuleProject produced no modules");
  return { files, modules, entry };
}

/** POSIX basename without importing `node:path` into the generator. */
function posixBasename(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? path : path.slice(index + 1);
}

/** Root every generated module lives under (the compiler host workspace). */
export const GENERATED_WORKSPACE = VIRTUAL_ROOT;
