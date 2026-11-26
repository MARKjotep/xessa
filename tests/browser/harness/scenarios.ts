/**
 * Browser-test scenario data.
 *
 * These are deliberately small Xessa sources compiled at browser-test setup
 * time through the public `compile` API. They are browser test data, not new
 * golden fixture directories. HTML fragments use `{{name}}` placeholders that
 * the build step replaces with the compiler's emitted class names.
 */

/** The exact viewport widths required by SPECIFICATION.md §4.1. */
export const VIEWPORTS = [320, 767, 768, 1279, 1280] as const;

export type ViewportWidth = (typeof VIEWPORTS)[number];

/** Media emulation values used by the specs. */
export const COLOR_SCHEMES = ["light", "dark"] as const;

export type ColorScheme = (typeof COLOR_SCHEMES)[number];

/** Browser page variant produced by the harness. */
export type PageVariant = "pretty" | "minified" | "nogroup" | "merge";

/**
 * Computed properties compared between the pretty and minified pages.
 *
 * The list is deliberately broad enough to catch accidental declaration-order,
 * specificity, at-rule or token changes, while excluding time-dependent
 * animated properties (`opacity` is only compared for the static `states`
 * scenario). `getPropertyValue` takes kebab-case names.
 */
export const BASE_COMPARE_PROPERTIES = [
  "display",
  "position",
  "box-sizing",
  "color",
  "background-color",
  "font-size",
  "font-family",
  "font-weight",
  "line-height",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "width",
  "height",
  "gap",
  "cursor",
  "transition-duration",
  "transition-property",
  "animation-name",
  "animation-duration",
] as const;

export interface BrowserScenario {
  /** Stable scenario id; also the generated file stem. */
  readonly name: string;
  /** One-line description used by reports. */
  readonly description: string;
  /** Inline Xessa source compiled through the public compiler API. */
  readonly source: string;
  /** HTML body fragment with `{{class-name}}` placeholders. */
  readonly html: string;
  /** Stable test ids read by the specs and the parity check. */
  readonly testIds: readonly string[];
  /** Computed properties compared across pretty/minified pages. */
  readonly compareProperties: readonly string[];
  /** Custom property names compared across pretty/minified pages. */
  readonly compareCustomProperties?: readonly string[];
}

/** Every browser scenario, in deterministic report order. */
export const SCENARIOS: readonly BrowserScenario[] = [
  {
    name: "inline-variants",
    description: "Inline responsive variants for padding and font-size.",
    source: `.card {
  padding: 12px @md 20px @xl 32px;
  font-size: 14px @md 16px;
}
`,
    html: `<div class="{{card}}" data-testid="card">inline variants</div>`,
    testIds: ["card"],
    compareProperties: BASE_COMPARE_PROPERTIES,
  },
  {
    name: "combined",
    description: "Combined @xl+dark is logical AND, not OR.",
    source: `.card {
  background: white @dark #181818 @xl+dark #101010;
}
`,
    html: `<div class="{{card}}" data-testid="card">combined conditions</div>`,
    testIds: ["card"],
    compareProperties: BASE_COMPARE_PROPERTIES,
  },
  {
    name: "block-conditions",
    description:
      "Rule-scoped @md block plus a file-level compact alias, with an opt-in merge opportunity.",
    source: `@media-types { compact: (max-width: 500px); }
.card {
  display: block;
  padding: 8px;
  @md {
    display: grid;
    gap: 24px;
  }
  @compact {
    display: flex;
    padding: 4px;
  }
  margin-top: 2px;
  @md {
    color: rgb(10, 20, 30);
  }
  border-left: 1px solid rgb(0, 0, 0);
  @md {
    border-radius: 4px;
  }
}
`,
    html: `<div class="{{card}}" data-testid="card">block conditions</div>`,
    testIds: ["card"],
    compareProperties: [...BASE_COMPARE_PROPERTIES, "border-radius"],
  },
  {
    name: "specificity",
    description: "Overlapping selectors and duplicate declarations.",
    source: `.card {
  padding: 10px;
  color: rgb(1, 2, 3);
  margin-top: 5px;
  margin-top: 7px;
}
.card.card {
  padding: 20px;
}
.card {
  color: rgb(4, 5, 6);
  padding: 30px;
}
`,
    html: `<div class="{{card}}" data-testid="card">specificity</div>`,
    testIds: ["card"],
    compareProperties: BASE_COMPARE_PROPERTIES,
  },
  {
    name: "runtime",
    description: "Runtime custom property flips under dark mode.",
    source: `@setup { prefix: "ui"; }
@runtime {
  primary: #2563eb @dark #60a5fa;
}
.card {
  color: $primary;
  background-color: white;
}
`,
    html: `<div class="{{card}}" data-testid="card">runtime</div>`,
    testIds: ["card"],
    compareProperties: BASE_COMPARE_PROPERTIES,
    compareCustomProperties: ["--ui-primary"],
  },
  {
    name: "states",
    description: "Hover, focus, disabled and attribute-driven state rules.",
    source: `.card {
  opacity: 1;
  cursor: pointer;
  &:hover {
    opacity: 0.85;
  }
  &:focus {
    opacity: 0.7;
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  &[data-state="open"] {
    background-color: rgb(10, 20, 30);
  }
}
`,
    html: `<button class="{{card}}" data-testid="state-base" data-state="open" type="button">base</button>
<button class="{{card}}" data-testid="state-hover" type="button">hover</button>
<button class="{{card}}" data-testid="state-focus" type="button">focus</button>
<button class="{{card}}" data-testid="state-disabled" type="button">disabled</button>`,
    testIds: ["state-base", "state-hover", "state-focus", "state-disabled"],
    compareProperties: [...BASE_COMPARE_PROPERTIES, "opacity"],
  },
  {
    name: "reduced",
    description: "Transition and animation gated behind @reduced.",
    source: `.card {
  transition: opacity 120ms linear;
  animation: pulse 2s infinite;
  @reduced {
    transition: none;
    animation: none;
  }
}
@keyframes pulse {
  from { opacity: 0.8; }
  to { opacity: 1; }
}
`,
    html: `<div class="{{card}}" data-testid="card">reduced motion</div>`,
    testIds: ["card"],
    // `opacity` is animated, so it is intentionally not compared across pages.
    compareProperties: BASE_COMPARE_PROPERTIES,
  },
  {
    name: "nesting",
    description: "Nested child selector with an @lg width variant.",
    source: `.card {
  display: flex;
  & > .icon {
    width: 16px @lg 20px;
  }
}
`,
    html: `<div class="{{card}}" data-testid="card"><span class="{{icon}}" data-testid="icon">icon</span></div>`,
    testIds: ["card", "icon"],
    compareProperties: BASE_COMPARE_PROPERTIES,
  },
  {
    name: "groups",
    description:
      "Reusable @group defaults with inline @md/@dark/@reduced variants and use-site overrides.",
    // ADR-0017 item 3: expansion is a splice, so overrides win by source
    // order, an @md default loses to a later base declaration at every width,
    // and a group `!important` default is not beaten by a plain override.
    source: `@group.chrome {
  padding: 12px @md 24px;
  border-radius: 8px;
  color: black;
  background: white @dark #181818;
  display: flex !important;
  transition-duration: 120ms @reduced 0s;
}

@group.chip {
  padding: 6px;
  border-radius: 4px;
  color: black;
}

.panel {
  @group.chrome {
    padding: 20px;
    border-radius: 0;
    color: navy;
    display: block;
  }
}

.tile {
  @group.chrome {
    color: rgb(1, 2, 3);
  }
}

.badge {
  @group.chip {
    margin-top: 2px;
  }
}

.badge {
  @group.chip {
    border-radius: 0;
  }
}
`,
    html: `<div class="{{panel}}" data-testid="panel">group panel</div>
<div class="{{tile}}" data-testid="tile">group tile</div>
<div class="{{badge}}" data-testid="badge">group badge</div>`,
    testIds: ["panel", "tile", "badge"],
    compareProperties: [...BASE_COMPARE_PROPERTIES, "border-radius"],
  },
];

/** Look up a scenario by name; throws for typos rather than silently skipping. */
export function scenario(name: string): BrowserScenario {
  const found = SCENARIOS.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`Unknown browser scenario: ${name}`);
  return found;
}

/** Selector for a stable test id. */
export function testIdSelector(testId: string): string {
  return `[data-testid="${testId}"]`;
}
