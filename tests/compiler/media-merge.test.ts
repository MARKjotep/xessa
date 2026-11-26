import { describe, expect, test } from "bun:test";
import { parse } from "../../packages/compiler/src/index.ts";
import {
  atRuleContextIr,
  declarationIr,
  mediaConditionIr,
  ruleIr,
  stylesheetIr,
} from "../../packages/compiler/src/ir/factories.ts";
import type { NativeBlockIr, RuleIr, StylesheetIr } from "../../packages/compiler/src/ir/types.ts";
import { groupRuns, lower } from "../../packages/compiler/src/lowering/index.ts";

/**
 * Opt-in `mediaGrouping: "merge"` (ADR-0024).
 *
 * The allowed cases are the union of the safe adjacent pass and cross-run
 * merges proved by disjoint property families. Every blocked case here pins a
 * boundary: same family, shorthand/longhand, different selector, condition or
 * native context, wildcards, native blocks and unconditional runs.
 */

function isRule(node: unknown): node is RuleIr {
  return typeof node === "object" && node !== null && "declarations" in node;
}

function lowerRuns(source: string): readonly RuleIr[] {
  const file = "src/merge.cssx";
  const parsed = parse(source, { file });
  expect(parsed.diagnostics).toEqual([]);
  const { ir, diagnostics } = lower(parsed.ast, { file });
  expect(diagnostics).toEqual([]);
  return ir.rules.filter(isRule);
}

function mergedRuns(source: string): readonly RuleIr[] {
  const file = "src/merge.cssx";
  const parsed = parse(source, { file });
  const { ir } = lower(parsed.ast, { file });
  return groupRuns(ir, "merge").rules.filter(isRule);
}

function values(run: RuleIr | undefined): readonly string[] {
  return run?.declarations.map((declaration) => declaration.value) ?? [];
}

describe("merge grouping · allowed", () => {
  test("merges a conditional run across a disjoint-family declaration run", () => {
    const runs = mergedRuns(
      ".a { @md { color: red; } }\n.b { padding: 1px; }\n.a { @md { color: blue; } }",
    );
    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.selector)).toEqual([".b", ".a"]);
    expect(runs[1]?.condition?.query).toBe("(min-width: 768px)");
    expect(values(runs[1])).toEqual(["red", "blue"]);
  });

  test("keeps the destination block position and source-first declaration order", () => {
    const runs = mergedRuns(
      ".a { @md { color: red; } }\n.b { padding: 1px; }\n.c { margin: 2px; }\n.a { @md { color: blue; } }",
    );
    expect(runs.map((run) => run.selector)).toEqual([".b", ".c", ".a"]);
  });

  test("iterates to a fixpoint across several disjoint barriers", () => {
    const runs = mergedRuns(
      [
        ".a { @md { color: red; } }",
        ".b { padding: 1px; }",
        ".a { @md { color: green; } }",
        ".c { margin: 2px; }",
        ".a { @md { color: blue; } }",
      ].join("\n"),
    );
    expect(runs).toHaveLength(3);
    expect(runs.map((run) => run.selector)).toEqual([".b", ".c", ".a"]);
    expect(values(runs[2])).toEqual(["red", "green", "blue"]);
  });

  test("still performs the safe adjacent merge", () => {
    const runs = mergedRuns(".a { @md { color: red; } @md { color: blue; } }");
    expect(runs).toHaveLength(1);
    expect(values(runs[0])).toEqual(["red", "blue"]);
  });

  test("merges children of one native block among themselves", () => {
    const file = "src/merge.cssx";
    const parsed = parse(
      "@media (min-width: 100px) { .a { @md { color: red; } } .b { padding: 1px; } .a { @md { color: blue; } } }",
      { file },
    );
    const { ir } = lower(parsed.ast, { file });
    const grouped = groupRuns(ir, "merge");
    const block = grouped.rules[0] as NativeBlockIr | undefined;
    if (block === undefined || !("children" in block)) throw new Error("expected a native block");
    const children = block.children.filter(isRule);
    expect(children.map((run) => run.selector)).toEqual([".b", ".a"]);
    expect(values(children[1])).toEqual(["red", "blue"]);
  });
});

describe("merge grouping · blocked", () => {
  test("same property family blocks the merge", () => {
    const runs = mergedRuns(
      ".a { @md { color: red; } }\n.b { color: green; }\n.a { @md { color: blue; } }",
    );
    expect(runs).toHaveLength(3);
  });

  test("shorthand and longhand in one family block the merge", () => {
    const runs = mergedRuns(
      ".a { @md { margin: 0; } }\n.b { margin-top: 4px; }\n.a { @md { margin-left: 2px; } }",
    );
    expect(runs).toHaveLength(3);
  });

  test("a different selector blocks the merge", () => {
    const runs = mergedRuns(
      ".a { @md { color: red; } }\n.b { padding: 1px; }\n.c { @md { color: blue; } }",
    );
    expect(runs).toHaveLength(3);
  });

  test("a different condition blocks the merge", () => {
    const runs = mergedRuns(
      ".a { @md { color: red; } }\n.b { padding: 1px; }\n.a { @lg { color: blue; } }",
    );
    expect(runs).toHaveLength(3);
  });

  test("a different native context blocks the merge", () => {
    const file = "src/merge.cssx";
    const md = mediaConditionIr("(min-width: 768px)", ["md"]);
    const span = { start: 0, end: 1, file };
    const ir: StylesheetIr = stylesheetIr([
      ruleIr({
        selector: ".a",
        ancestors: [],
        declarations: [declarationIr("color", "red", span)],
        condition: md,
        context: [atRuleContextIr("layer", "one", span)],
        span,
      }),
      ruleIr({
        selector: ".b",
        ancestors: [],
        declarations: [declarationIr("padding", "1px", span)],
        condition: null,
        context: [],
        span,
      }),
      ruleIr({
        selector: ".a",
        ancestors: [],
        declarations: [declarationIr("color", "blue", span)],
        condition: md,
        context: [atRuleContextIr("layer", "two", span)],
        span,
      }),
    ]);
    expect(groupRuns(ir, "merge").rules.filter(isRule)).toHaveLength(3);
  });

  test("an intervening `all` wildcard blocks the merge", () => {
    const runs = mergedRuns(
      ".a { @md { color: red; } }\n.b { all: unset; }\n.a { @md { color: blue; } }",
    );
    expect(runs).toHaveLength(3);
  });

  test("an intervening `var()` value blocks the merge", () => {
    const runs = mergedRuns(
      ".a { @md { color: red; } }\n.b { color: var(--brand); }\n.a { @md { color: blue; } }",
    );
    expect(runs).toHaveLength(3);
  });

  test("a source run containing a wildcard is not mergeable", () => {
    const runs = mergedRuns(
      ".a { @md { color: var(--brand); } }\n.b { padding: 1px; }\n.a { @md { color: blue; } }",
    );
    expect(runs).toHaveLength(3);
  });

  test("a destination run containing a wildcard is not mergeable", () => {
    const runs = mergedRuns(
      ".a { @md { color: red; } }\n.b { padding: 1px; }\n.a { @md { color: var(--brand); } }",
    );
    expect(runs).toHaveLength(3);
  });

  test("unconditional runs are never merged across a gap", () => {
    const runs = mergedRuns(".a { color: red; }\n.b { padding: 1px; }\n.a { color: blue; }");
    expect(runs).toHaveLength(3);
  });

  test("a native block between siblings blocks the cross-run merge", () => {
    const runs = mergedRuns(
      ".a { @md { color: red; } }\n@font-face { font-family: x; src: url(x.woff2); }\n.a { @md { color: blue; } }",
    );
    expect(runs).toHaveLength(2);
    expect(runs[0]?.condition?.query).toBe("(min-width: 768px)");
  });

  test("mode none and the default safe mode leave the authored runs untouched", () => {
    const file = "src/merge.cssx";
    const parsed = parse(
      ".a { @md { color: red; } }\n.b { padding: 1px; }\n.a { @md { color: blue; } }",
      { file },
    );
    const { ir } = lower(parsed.ast, { file });
    expect(groupRuns(ir, "none")).toBe(ir);
    expect(groupRuns(ir).rules.filter(isRule)).toHaveLength(3);
    expect(groupRuns(ir, "safe").rules.filter(isRule)).toHaveLength(3);
  });

  test("lowering itself never reorders declarations", () => {
    expect(lowerRuns(".a { @md { color: red; } }").map(values)).toEqual([["red"]]);
  });
});
