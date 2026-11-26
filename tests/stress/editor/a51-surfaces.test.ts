/**
 * TT6 · A51 (and A46/A50) completion surfaces held while typing.
 *
 * The A45–A51 fixes are asserted in `tests/extension/` per authored offset. This
 * file asserts the same three invariants **at every character position** of the
 * typing sequences that produced the bugs, which is where a regression actually
 * bites: a range that is only correct for the final word breaks on the
 * intermediate keystrokes.
 *
 * 1. `#` hex palette — every offer replaces the typed `#…` prefix
 *    (`replaceStart` is the `#`), the list narrows monotonically as digits are
 *    typed, and only colour items appear.
 * 2. `(` call opener — every offer replaces the typed `(` (so accepting
 *    `clamp(` never yields `((clamp(`), and the curated function list narrows.
 * 3. `&:` / `&.` repairs — the replacement range covers the typed colons (so
 *    `&:` + `:hover` is `&:hover`) and stops after the typed dot (so `&.` +
 *    `.test` keeps the dot).
 *
 * Pure layer only: no `vscode` import, no host.
 */

import { describe, expect, test } from "bun:test";
import { analyzeText } from "../../../packages/vscode/src/analysis.ts";
import type {
  CompletionResult,
  CompletionSuggestion,
} from "../../../packages/vscode/src/intelligence.ts";
import { completionsAt, contextAt } from "../../../packages/vscode/src/intelligence.ts";
import { generateLargeDocument } from "./documents.ts";

/** One keystroke of a typing script: the document and the cursor offset. */
interface Step {
  /** The character just typed. */
  readonly typed: string;
  readonly text: string;
  readonly offset: number;
}

/**
 * Replay `typed` one character at a time after `base`, closing the document with
 * `closer`, and return one step per keystroke.
 */
function typeScript(base: string, typed: string, closer = "\n}"): Step[] {
  const steps: Step[] = [];
  for (let end = 1; end <= typed.length; end += 1) {
    const cursor = typed.slice(0, end);
    steps.push({
      typed: typed[end - 1] ?? "",
      text: `${base}${cursor}${closer}`,
      offset: base.length + cursor.length,
    });
  }
  return steps;
}

/** Analyse one step and run completion at the cursor. */
function complete(step: Step): {
  analysis: ReturnType<typeof analyzeText>;
  result: CompletionResult;
} {
  const analysis = analyzeText(
    { text: step.text, path: "/virtual/typing.cssx", version: 1 },
    {
      workspaceRoot: "/virtual",
    },
  );
  return { analysis, result: completionsAt(step.text, step.offset, { analysis }) };
}

/** Document text after accepting one item over its own replacement range. */
function accept(step: Step, result: CompletionResult, item: CompletionSuggestion): string {
  const start = item.replaceStart ?? result.replaceStart;
  return step.text.slice(0, start) + item.insertText + step.text.slice(result.replaceEnd);
}

/** The item with `label`, failing with the offered labels. */
function pick(result: CompletionResult, label: string): CompletionSuggestion {
  const found = result.items.find((item) => item.label === label);
  if (found === undefined) {
    throw new Error(`missing "${label}" in [${result.items.map((item) => item.label).join(", ")}]`);
  }
  return found;
}

describe("A51 · `#` hex palette narrows under typing", () => {
  const base = ".a {\n  color: ";
  const steps = typeScript(base, "#f0e7");

  test("every keystroke replaces the typed `#…` and offers colours only", () => {
    const sizes: number[] = [];
    for (const step of steps) {
      const { result } = complete(step);
      const hash = step.text.lastIndexOf("#", step.offset - 1);
      expect(hash).toBe(base.length);
      expect(result.replaceEnd).toBe(step.offset);
      sizes.push(result.items.length);
      // Colour items only — keyword values, units and functions never join a `#`.
      expect(result.items.every((item) => item.kind === "color")).toBe(true);
      // The per-item range is the repair range: it covers the typed `#…`, so
      // accepting a swatch swaps the literal instead of appending to it. The
      // result-level range stays the plain word range (the editor narrows
      // against it), which is why the two differ by exactly the `#`.
      for (const item of result.items) expect(item.replaceStart).toBe(hash);
      // The result range is the plain word range: it starts right after the `#`.
      expect(result.replaceStart).toBe(hash + 1);
    }
    // `#` offers the whole palette plus the named colours; `#f0` already has no
    // hex match, and `#f0e7` matches nothing at all (an empty, valid result).
    expect(sizes[0] ?? 0).toBeGreaterThan(100);
    expect(sizes[sizes.length - 1]).toBe(0);
  });

  test("the hex list narrows monotonically as digits are typed", () => {
    let previous: string[] | undefined;
    for (const step of steps) {
      const { result } = complete(step);
      const hash = step.text.lastIndexOf("#", step.offset - 1);
      const word = step.text.slice(hash + 1, step.offset).toLowerCase();
      const hex = result.items
        .filter((item) => item.label.startsWith("#"))
        .map((item) => item.label);
      if (previous !== undefined) {
        // Each keystroke can only remove palette entries, never add them.
        const narrowed = previous.filter((label) => label.slice(1).startsWith(word));
        expect(hex).toEqual(narrowed);
      }
      previous = hex;
    }
    expect(previous?.length ?? 0).toBeLessThanOrEqual(35);
  });

  test("a fully typed prefix still replaces the whole literal", () => {
    const text = ".a {\n  color: #e7\n}";
    const offset = text.indexOf("#e7") + "#e7".length;
    const analysis = analyzeText(
      { text, path: "/virtual/hash.cssx", version: 1 },
      {
        workspaceRoot: "/virtual",
      },
    );
    const result = completionsAt(text, offset, { analysis });
    const hex = result.items.filter((item) => item.label.startsWith("#")).map((item) => item.label);
    expect(hex).toEqual(["#e74c3c"]);
    expect(pick(result, "#e74c3c").replaceStart).toBe(text.indexOf("#"));
    const accepted = accept({ typed: "7", text, offset }, result, pick(result, "#e74c3c"));
    expect(accepted).toBe(".a {\n  color: #e74c3c\n}");
    // A typed non-hex prefix degrades to an empty list, not a broken one.
    const emptyText = ".a {\n  color: #f0e7\n}";
    const emptyOffset = emptyText.indexOf("#f0e7") + "#f0e7".length;
    const empty = completionsAt(emptyText, emptyOffset, {
      analysis: analyzeText(
        { text: emptyText, path: "/virtual/hash.cssx", version: 1 },
        {
          workspaceRoot: "/virtual",
        },
      ),
    });
    expect(empty.items).toEqual([]);
    // No match degrades to an empty list over the typed word range.
    expect(empty.replaceStart).toBe(emptyText.indexOf("#") + 1);
  });
});

describe("A50 · `(` call opener keeps a single paren while typing", () => {
  const base = ".box {\n  width: ";
  const steps = typeScript(base, "(clamp");

  test("every keystroke replaces the typed paren and offers functions only", () => {
    for (const step of steps) {
      const { result } = complete(step);
      const paren = step.text.lastIndexOf("(", step.offset - 1);
      expect(paren).toBe(base.length);
      expect(result.replaceEnd).toBe(step.offset);
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.every((item) => item.detail === "CSS function")).toBe(true);
      expect(result.items.every((item) => item.label.endsWith("("))).toBe(true);
      // The per-item range is the paren: accepting `clamp(` swaps the typed
      // opener instead of duplicating it (the result range is the word range).
      for (const item of result.items) expect(item.replaceStart).toBe(paren);
    }
  });

  test("the function list narrows and accepting `clamp(` never duplicates the paren", () => {
    const labels: string[][] = [];
    for (const step of steps) {
      const { result } = complete(step);
      labels.push(result.items.map((item) => item.label));
      if (step.typed === "l") {
        const accepted = accept(step, result, pick(result, "clamp("));
        expect(accepted).toBe(".box {\n  width: clamp(\n}");
        expect(accepted.includes("((")).toBe(false);
      }
    }
    // `(` lists the whole curated set, `(c` a strict subset, `(cl` exactly one.
    expect(labels[0]?.length).toBeGreaterThan(20);
    expect(labels[1]?.length).toBeLessThan(labels[0]?.length ?? 0);
    expect(labels[labels.length - 1]).toEqual(["clamp("]);
  });
});

describe("A46 · `&:` and `&.` repair ranges hold while typing", () => {
  test("`&:` covers the typed colon so `:hover` never doubles it", () => {
    const base = ".a {\n  &";
    const steps = typeScript(base, ":hov");
    for (const step of steps) {
      const { analysis, result } = complete(step);
      expect(contextAt(step.text, step.offset, analysis).kind).toBe("pseudo");
      const colon = step.text.indexOf(":", base.length);
      expect(colon).toBe(base.length);
      expect(result.replaceStart).toBe(colon);
      expect(result.replaceEnd).toBe(step.offset);
      expect(result.items.every((item) => item.kind === "pseudo")).toBe(true);
      for (const item of result.items) expect(item.insertText.startsWith(":")).toBe(true);
    }
    const finish = steps[steps.length - 1];
    if (finish === undefined) throw new Error("empty typing script");
    const { result } = complete(finish);
    expect(accept(finish, result, pick(result, ":hover"))).toBe(".a {\n  &:hover\n}");
  });

  test("`&::` covers both typed colons", () => {
    const base = ".a {\n  &";
    const steps = typeScript(base, "::a");
    for (const step of steps) {
      const { result } = complete(step);
      expect(result.replaceStart).toBe(base.length);
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.every((item) => item.insertText.startsWith(":"))).toBe(true);
    }
    const finish = steps[steps.length - 1];
    if (finish === undefined) throw new Error("empty typing script");
    const { result } = complete(finish);
    expect(accept(finish, result, pick(result, "::after"))).toBe(".a {\n  &::after\n}");
  });

  test("`&.` keeps the typed dot so the class lands after it", () => {
    const base = ".test { color: blue; }\n.a {\n  &";
    const steps = typeScript(base, ".te");
    for (const step of steps) {
      const { result } = complete(step);
      // The range starts *after* the dot: class items insert the bare name.
      expect(result.replaceStart).toBe(base.length + 1);
      expect(result.replaceEnd).toBe(step.offset);
      // Class items insert the bare name; the range starts after the dot.
      expect(result.items.some((item) => item.label === ".test")).toBe(true);
    }
    const finish = steps[steps.length - 1];
    if (finish === undefined) throw new Error("empty typing script");
    const { result } = complete(finish);
    expect(accept(finish, result, pick(result, ".test"))).toBe(
      ".test { color: blue; }\n.a {\n  &.test\n}",
    );
  });
});

describe("A51 surfaces · absolute offsets in a long document", () => {
  // The same four surfaces appended to a large generated stylesheet: the ranges
  // are absolute document offsets, so they must still be exact far from offset 0.
  const prefix = generateLargeDocument({ lines: 200, seed: 7 });

  test("hex, paren, colon and dot ranges stay exact at a deep offset", () => {
    const base = `${prefix}\n.final {\n  color: `;
    const hexSteps = typeScript(base, "#e7");
    for (const step of hexSteps) {
      const { result } = complete(step);
      const hash = step.text.lastIndexOf("#", step.offset - 1);
      expect(hash).toBeGreaterThan(prefix.length);
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.every((item) => item.kind === "color")).toBe(true);
      for (const item of result.items) expect(item.replaceStart).toBe(hash);
    }

    const parenBase = `${prefix}\n.final {\n  width: `;
    const parenSteps = typeScript(parenBase, "(cl");
    for (const step of parenSteps) {
      const { result } = complete(step);
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.every((item) => item.detail === "CSS function")).toBe(true);
      for (const item of result.items) expect(item.replaceStart).toBe(parenBase.length);
    }

    const colonBase = `${prefix}\n.final {\n  &`;
    const colonSteps = typeScript(colonBase, ":ho");
    for (const step of colonSteps) {
      const { result } = complete(step);
      expect(result.replaceStart).toBe(colonBase.length);
    }

    const dotBase = `${prefix}\n.final {\n  &`;
    const dotSteps = typeScript(dotBase, ".te");
    for (const step of dotSteps) {
      const { result } = complete(step);
      expect(result.replaceStart).toBe(dotBase.length + 1);
    }
  });
});
