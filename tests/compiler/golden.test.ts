import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { emitCss } from "../../packages/compiler/src/emitter/index.ts";
import { compile, parse } from "../../packages/compiler/src/index.ts";
import { tokenize } from "../../packages/compiler/src/lexer/index.ts";
import { groupRuns, lower } from "../../packages/compiler/src/lowering/index.ts";
import { renameClasses } from "../../packages/compiler/src/naming/index.ts";
import { flattenIr } from "../../packages/compiler/src/selectors/index.ts";
import type { Stylesheet } from "../../packages/compiler/src/types/ast.ts";

/**
 * Golden CSS fixtures.
 *
 * Pipeline pinned here is the first full compile:
 * `parse` → `lower` → `renameClasses` → `groupRuns` → `flattenIr` → `emitCss`
 * (pretty). The class prefix is read from the fixture's `@setup` block, so
 * fixtures that set `prefix: "ui"` emit `.ui-*` selectors (canonical/button is
 * SPECIFICATION.md §2).
 *
 * Fixtures whose input carries a real `$` reference (`dollar-ref` token) are
 * deferred to the A08 golden suite; this suite does not assert their content.
 * `@group.<name>` fixtures (ADR-0017) are deferred to `groups.golden.test.ts`,
 * which runs the expansion pre-pass this chain does not have.
 *
 * Empty-output error fixtures use the documented sentinel comment line; every
 * other expected file is byte-identical to the emitted CSS.
 */

const fixturesRoot = join(import.meta.dir, "..", "fixtures");
const noCssSentinel = "/* no css: see expected/diagnostics.json */";

function collectFixtures(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(directory, entry.name);
    if (existsSync(join(path, "input.cssx"))) {
      found.push(path);
      continue;
    }
    found.push(...collectFixtures(path));
  }
  return found;
}

function fixtureId(directory: string): string {
  return relative(fixturesRoot, directory).split(sep).join("/");
}

/** Test-only `@setup { prefix: ... }` reader (setup resolution is P4/P5). */
function setupPrefix(ast: Stylesheet): string {
  let prefix = "";
  for (const item of ast.items) {
    if (item.kind !== "setup") continue;
    for (const setting of item.settings) {
      if (setting.key !== "prefix") continue;
      const raw = setting.value.trim();
      prefix = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
    }
  }
  return prefix;
}

const fixtureDirectories = collectFixtures(fixturesRoot).sort((left, right) => {
  const leftId = fixtureId(left);
  const rightId = fixtureId(right);
  if (leftId < rightId) return -1;
  if (leftId > rightId) return 1;
  return 0;
});

interface Fixture {
  readonly id: string;
  readonly directory: string;
  readonly source: string;
  readonly deferred: boolean;
}

const fixtures: readonly Fixture[] = fixtureDirectories.map((directory) => {
  const source = readFileSync(join(directory, "input.cssx"), "utf8");
  const id = fixtureId(directory);
  const deferred = tokenize(source, `${id}/input.cssx`).tokens.some(
    (token) => token.kind === "dollar-ref",
  );
  return { id, directory, source, deferred };
});

/**
 * `@group.<name>` fixtures are asserted by `groups.golden.test.ts`.
 *
 * That suite runs the expansion pre-pass and the resolver-aware
 * `compileProject` build, which this chain deliberately does not: it stops at
 * `lower`, where a use site is still an unexpanded AST node. Including group
 * fixtures here would assert the pre-expansion output instead of the shipped
 * behaviour, so the catalog splits them out (plan `.ai/plans/CSSX-PLAN-GROUPS.md`
 * §8/§9, G4a).
 */
const groupFixtures = fixtures.filter((fixture) => fixture.id.startsWith("groups/"));
const ungroupedFixtures = fixtures.filter((fixture) => !fixture.id.startsWith("groups/"));

/** Remove whitespace that only separates structural CSS tokens. */
function stripStructuralWhitespace(css: string): string {
  let output = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let depth = 0;
  let index = 0;

  while (index < css.length) {
    const character = css.charAt(index);
    if (quote !== null) {
      output += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      output += character;
      index += 1;
      continue;
    }
    if (character === "(") {
      depth += 1;
      output += character;
      index += 1;
      continue;
    }
    if (character === ")") {
      depth = Math.max(0, depth - 1);
      output += character;
      index += 1;
      continue;
    }
    if (depth > 0) {
      output += character;
      index += 1;
      continue;
    }
    if (/\s/.test(character)) {
      let next = index;
      while (next < css.length && /\s/.test(css.charAt(next))) next += 1;
      const previous = output.charAt(output.length - 1);
      const following = css.charAt(next);
      const structural =
        previous === "" ||
        following === "" ||
        "{};:,>+~".includes(previous) ||
        "{};:,>+~".includes(following);
      if (!structural) output += " ";
      index = next;
      continue;
    }
    output += character;
    index += 1;
  }
  return output;
}

interface CompileOutput {
  readonly pretty: string;
  readonly minified: string;
  readonly diagnostics: readonly string[];
}

function compileFixture(fixture: Fixture): CompileOutput {
  const file = `${fixture.id}/input.cssx`;
  const parsed = parse(fixture.source, { file });
  const lowered = lower(parsed.ast, { file });
  const renamed = renameClasses(lowered.ir, { prefix: setupPrefix(parsed.ast) });
  const grouped = groupRuns(renamed.ir, "safe");
  const flattened = flattenIr(grouped);
  const pretty = emitCss(flattened.ir, { minify: false });
  const minified = emitCss(flattened.ir, { minify: true });
  return {
    pretty: pretty.css,
    minified: minified.css,
    diagnostics: [
      ...renamed.diagnostics,
      ...flattened.diagnostics,
      ...pretty.diagnostics,
      ...minified.diagnostics,
    ].map((diagnostic) => diagnostic.code),
  };
}

describe("golden fixture catalog", () => {
  test("every fixture is classified as plain or deferred by its dollar-ref tokens", () => {
    const all = fixtures.map((fixture) => fixture.id);
    expect(all).toHaveLength(68);

    const plain = ungroupedFixtures
      .filter((fixture) => !fixture.deferred)
      .map((fixture) => fixture.id);
    expect(plain).toEqual([
      "config/project-json",
      "errors/duplicate-setting",
      "errors/malformed-value",
      "errors/missing-semicolon",
      "errors/semicolonless-before-nested-rule",
      "errors/semicolonless-modifier",
      "errors/top-level-conditional",
      "errors/unclosed-block",
      "errors/unknown-modifier",
      "errors/unknown-setup-key",
      "global/escape",
      "important/per-segment",
      "lexical/at-in-string",
      "lexical/at-mid-value",
      "lexical/calc",
      "lexical/comments-escapes",
      "lexical/final-no-semicolon",
      "lexical/no-whitespace-modifier",
      "lexical/url-at",
      "media/block-conditions",
      "media/combined-and",
      "media/custom-alias-override",
      "media/duplicate-aliases",
      "media/inline-variants",
      "naming/camel-collision",
      "naming/empty-prefix",
      "naming/prefix",
      "naming/reserved-js-identifier",
      "nesting/descendant-bare",
      "nesting/multiple-amp",
      "nesting/pseudo-combinators",
      "output/custom-import-css-false",
      "output/dirs-and-names",
      "output/disabled-emit",
      "output/nested-source",
      "output/no-setup",
      "output/only-css-dir",
      "output/only-map-dir",
      "output/only-names",
    ]);

    const deferred = ungroupedFixtures
      .filter((fixture) => fixture.deferred)
      .map((fixture) => fixture.id);
    expect(deferred).toEqual([
      "canonical/button",
      "keyframes/bare-namespace",
      "keyframes/same-file",
      "keyframes/unknown-member",
      "runtime/basic",
      "runtime/collision-with-compile-time",
      "runtime/with-variant",
      "variables/ambiguous-import",
      "variables/basic",
      "variables/cycle",
      "variables/duplicate-local",
      "variables/local-overrides-ambiguous-import",
      "variables/local-overrides-imported",
      "variables/namespaced-members",
      "variables/undefined-ref",
    ]);

    // Group fixtures are compiled with expansion by groups.golden.test.ts.
    expect(groupFixtures.map((fixture) => fixture.id)).toEqual([
      "groups/alias-group",
      "groups/composed",
      "groups/conditional-use-site",
      "groups/duplicate-definition",
      "groups/empty-group",
      "groups/group-named-keyframes",
      "groups/group-position",
      "groups/important-default",
      "groups/inline-variant-default",
      "groups/nested-rule-in-definition",
      "groups/no-override",
      "groups/same-file",
      "groups/two-use-sites",
      "groups/unknown-group",
    ]);
  });

  test("every plain fixture reproduces its expected/css byte-exact", () => {
    const plain = ungroupedFixtures.filter((fixture) => !fixture.deferred);
    expect(plain.length).toBe(39);

    for (const fixture of plain) {
      const expected = readFileSync(join(fixture.directory, "expected", "css"), "utf8");
      const actual = compileFixture(fixture);
      expect({ id: fixture.id, diagnostics: actual.diagnostics }).toEqual({
        id: fixture.id,
        diagnostics: [],
      });

      if (expected.startsWith(noCssSentinel)) {
        expect({ id: fixture.id, css: actual.pretty }).toEqual({ id: fixture.id, css: "" });
        continue;
      }

      expect({ id: fixture.id, css: actual.pretty }).toEqual({ id: fixture.id, css: expected });
    }
  });

  test("minify differs from pretty only in structural whitespace on the golden set", () => {
    for (const fixture of fixtures) {
      const actual = compileFixture(fixture);
      expect({ id: fixture.id, stripped: stripStructuralWhitespace(actual.pretty) }).toEqual({
        id: fixture.id,
        stripped: stripStructuralWhitespace(actual.minified),
      });
    }
  });
});

describe("XESSA1002 recovery through compile()", () => {
  test("a semicolonless declaration keeps its value and the nested rule", async () => {
    const id = "errors/semicolonless-before-nested-rule";
    const file = `${id}/input.cssx`;
    const source = readFileSync(join(fixturesRoot, id, "input.cssx"), "utf8");
    const result = await compile(source, { file, workspaceRoot: fixturesRoot });

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["XESSA1002"]);
    expect(result.css).toContain("color:red");
    expect(result.css).toContain(".ui-button:hover");
    expect(result.css).toBe(readFileSync(join(fixturesRoot, id, "expected", "minified"), "utf8"));
  });
});
