/**
 * Formatter round-trip coverage for the currently shipped grammar.
 *
 * The extension formats through the compiler's public `format()`, so these
 * tests pin the grammar features the editor ships format-on-save for:
 * `$keyframes.<name>` value references (ADR-0015), rule-merge imports
 * (`@use "…" as x styles;`, ADR-0014) and `@group.<name>` definitions/use sites
 * (ADR-0017, plan G5). Compiler-owned formatter code and its shared tests are
 * out of this task's scope.
 */

import { describe, expect, test } from "bun:test";
import { format } from "../../packages/compiler/src/index.ts";

const FILE = "src/motion.cssx";

function canonical(source: string): string {
  const result = format(source, FILE);
  expect(result.diagnostics).toEqual([]);
  return result.formatted;
}

describe("formatter round trip: current grammar", () => {
  test("$keyframes.<name> value references survive formatting unchanged", () => {
    const source = [
      "@keyframes spin { from { rotate: 0deg; } to { rotate: 360deg; } }",
      ".spinner { animation-name: $keyframes.spin; animation: $keyframes.spin 1s linear; }",
      "",
    ].join("\n");

    const formatted = canonical(source);
    expect(formatted).toBe(
      [
        "@keyframes spin {",
        "  from {",
        "    rotate: 0deg;",
        "  }",
        "",
        "  to {",
        "    rotate: 360deg;",
        "  }",
        "}",
        "",
        ".spinner {",
        "  animation-name: $keyframes.spin;",
        "  animation: $keyframes.spin 1s linear;",
        "}",
        "",
      ].join("\n"),
    );
    // Formatting is idempotent and never rewrites the reference text.
    expect(format(formatted, FILE).formatted).toBe(formatted);
    expect(formatted.match(/\$keyframes\.spin/g)).toHaveLength(2);
  });

  // Regression for the CSSX-A22 "styles blocker": the compiler formatter's
  // `printUse` used to omit `UseImport.styles`, rewriting `@use "…" styles;`
  // as a token-only import and silently changing compilation semantics.
  // Fixed in packages/compiler/src/formatter (CSSX-A24).
  test("@use … as x styles keeps the rule-merge flag", () => {
    const source =
      '@use "./motion.cssx" as m styles;\n.spinner { animation-name: $keyframes.spin; }\n';
    const formatted = canonical(source);
    expect(formatted).toBe(
      [
        '@use "./motion.cssx" as m styles;',
        "",
        ".spinner {",
        "  animation-name: $keyframes.spin;",
        "}",
        "",
      ].join("\n"),
    );
    expect(format(formatted, FILE).formatted).toBe(formatted);
  });

  test("alias-less @use … styles and a literal `styles` alias both round-trip", () => {
    const source = [
      '@use "./base.cssx" styles;',
      '@use "./tokens.cssx" as styles;',
      '@use "./plain.cssx";',
      ".spinner { color: red; }",
      "",
    ].join("\n");

    const formatted = canonical(source);
    expect(formatted).toBe(
      [
        '@use "./base.cssx" styles;',
        '@use "./tokens.cssx" as styles;',
        '@use "./plain.cssx";',
        "",
        ".spinner {",
        "  color: red;",
        "}",
        "",
      ].join("\n"),
    );
    expect(format(formatted, FILE).formatted).toBe(formatted);
  });

  // Regression for the G5 release blocker (ADR-0017 item 8): format-on-save is
  // enabled via `xessa.editor.formatOnSave`, and a parse→print formatter that
  // cannot print `@group` silently deletes authored groups on save.
  test("@group definitions and use sites survive a format-on-save round trip", () => {
    const source = [
      "@group.card {",
      "padding: 12px;",
      "border-radius: 8px;",
      "}",
      ".panel {",
      "@group.card {",
      "padding: 20px;",
      "}",
      "}",
      "",
    ].join("\n");

    const formatted = canonical(source);
    expect(formatted).toBe(
      [
        "@group.card {",
        "  padding: 12px;",
        "  border-radius: 8px;",
        "}",
        "",
        ".panel {",
        "  @group.card {",
        "    padding: 20px;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    expect(format(formatted, FILE).formatted).toBe(formatted);
    // One definition plus one use site, never fewer.
    expect(formatted.match(/@group\.card/g)).toHaveLength(2);
  });
});
