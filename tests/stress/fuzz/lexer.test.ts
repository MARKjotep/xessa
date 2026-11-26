/**
 * TT1 lexer stress — weakness row #8 of `tests/stress/README.md`.
 *
 * The existing lexer suites already fuzz an exhaustive hostile alphabet and 1 500
 * seeded sources, and pin the NUL diagnostic (TT0 report: refuted gaps). What
 * they do **not** cover, and this file adds: BOM `U+FEFF` at offset 0, lone and
 * unpaired surrogates, a CRLF/LF/CR mixed document, a 1 MB single token and a
 * 100 000-line file. Everything else here is the seeded mutation corpus replayed
 * through the same invariants (losslessness, single `eof`, forward progress,
 * in-bounds diagnostics) so byte-level corruption cannot silently drop input.
 */

import { describe, expect, test } from "bun:test";
import { tokenize } from "../../../packages/compiler/src/index.ts";
import {
  UNICODE_INJECTIONS,
  loadCorpus,
  mutantCorpus,
  syntheticTemplates,
  unicodeMutants,
} from "../corpus.ts";
import { createLabelledRng, readStressBudget, readStressSeed } from "../prng.ts";
import { describeInput, runLexerArea, tokenStreamViolations } from "./areas.ts";

const FILE = "stress/lexer.cssx";

/** Assert every lexical stream invariant for one source, naming the input on failure. */
function expectStreamOk(source: string, file = FILE): void {
  const input = describeInput(source);
  expect({ input, problems: tokenStreamViolations(source, file) }).toEqual({ input, problems: [] });
}

describe("TT1 lexer: seeded mutation corpus", () => {
  test("every mutated byte and token stream keeps the lexical invariants", () => {
    const seed = readStressSeed();
    const budget = readStressBudget();
    const run = runLexerArea({ seed, budget });
    expect(run.cases).toBeGreaterThanOrEqual(budget);
    expect(
      run.violations.map(
        (violation) => `${violation.caseLabel}: ${violation.message} [${violation.inputHash}]`,
      ),
    ).toEqual([]);
  }, 60_000);
});

describe("TT1 lexer: unicode and encoding cases (row #8)", () => {
  test("BOM U+FEFF at offset 0 is consumed losslessly", () => {
    const fixture = loadCorpus().fixtures[0];
    const prefix = fixture === undefined ? ".a { color: red; }" : fixture.source;
    for (const source of [
      "\uFEFF",
      `\uFEFF${prefix}`,
      "\uFEFF.a { color: red; }",
      "\uFEFF\r\n.a { color: red; }",
      "\uFEFF\uFEFF.a { color: red; }",
    ]) {
      expectStreamOk(source);
      // Losslessness is the invariant that matters: the BOM is authored input, so
      // the token stream must still cover every code unit.
      const stream = tokenize(source, FILE);
      expect(stream.tokens.map((token) => token.value).join("")).toHaveLength(source.length);
    }
  });

  test("lone and reversed surrogates never throw and never drop input", () => {
    const sources = [
      "\uD800",
      "\uDC00",
      "a\uD800b",
      "a\uDC00b",
      "\uDC00\uD800",
      ".a { color: re\uD800d; }",
      ".a\uDC00 { color: red; }",
      `@setup { prefix: "\uD800"; }`,
      "\uD800".repeat(64),
    ];
    for (const source of sources) expectStreamOk(source);
  });

  test("a CRLF/LF/CR mixed document keeps every authored line ending", () => {
    const sources = [
      ".a {\r\n  color: red;\r  color: blue;\n  color: green;\r\n}",
      ".a {\r  color: red;\r}",
      ".a {}\n\r\n\r",
      "\r\n\r\n\r\n",
      "\r",
      "\n",
    ];
    for (const source of sources) {
      expectStreamOk(source);
      const stream = tokenize(source, FILE);
      // Losslessness is what preserves mixed endings: the concatenated values must
      // reproduce the authored text byte for byte, and a CR/LF mix is valid
      // whitespace, so it must not diagnose.
      const replayed = stream.tokens.map((token) => token.value).join("");
      expect({ source: describeInput(source), replayed }).toEqual({
        source: describeInput(source),
        replayed: source,
      });
      expect({ source: describeInput(source), diagnostics: stream.diagnostics }).toEqual({
        source: describeInput(source),
        diagnostics: [],
      });
    }
  });

  test("NUL at every offset of a fixture-sized source stays lossless and in bounds", () => {
    const suffix = "@media-types { compact: (max-width: 500px); }\n.a { color: red; }\n";
    for (let offset = 0; offset <= suffix.length; offset += 1) {
      expectStreamOk(`${suffix.slice(0, offset)}\u0000${suffix.slice(offset)}`);
    }
  });

  test("every unicode injection over every fixture keeps the invariants", () => {
    const fixtures = loadCorpus().fixtures;
    expect(fixtures).toHaveLength(67);
    for (const fixture of fixtures) {
      for (const mutant of unicodeMutants(fixture)) {
        const input = `${mutant.fixtureId} ${mutant.description}`;
        expect({ input, problems: tokenStreamViolations(mutant.source, mutant.file) }).toEqual({
          input,
          problems: [],
        });
      }
    }
  });

  test("UNICODE_INJECTIONS covers BOM, lone surrogates, NUL and line endings", () => {
    const names = UNICODE_INJECTIONS.map((injection) => injection.name);
    for (const required of [
      "bom-at-zero",
      "lone-high-surrogate",
      "lone-low-surrogate",
      "nul-at-zero",
      "crlf-mix",
      "cr-only",
      "lf-only",
    ]) {
      expect(names).toContain(required);
    }
  });
});

describe("TT1 lexer: size floors (row #8)", () => {
  test("a 1 MB single token tokenizes losslessly", () => {
    const sources = ["a".repeat(1024 * 1024), "@".repeat(1024 * 1024), " ".repeat(1024 * 1024)];
    for (const source of sources) {
      expectStreamOk(source);
      const stream = tokenize(source, FILE);
      expect(stream.tokens.length).toBeLessThanOrEqual(source.length + 1);
    }
  }, 60_000);

  test("a 100 000-line file tokenizes losslessly", () => {
    const lines = Array.from({ length: 100_000 }, (_, index) => `.c${index} { color: red; }`);
    const source = lines.join("\n");
    expectStreamOk(source);
    const stream = tokenize(source, FILE);
    expect(stream.tokens.filter((token) => token.kind === "eof")).toHaveLength(1);
    expect(stream.tokens.length).toBeLessThanOrEqual(source.length + 1);
  }, 60_000);
});

describe("TT1 lexer: synthetic grammar templates", () => {
  test("templates keep the lexical invariants", () => {
    for (const template of syntheticTemplates()) {
      expectStreamOk(template.source, `stress/${template.id}.cssx`);
    }
  });
});

describe("TT1 lexer: seeded generator", () => {
  test("mutantCorpus is reproducible from the seed alone", () => {
    const seed = readStressSeed();
    const budget = Math.min(readStressBudget(), 20);
    const first = mutantCorpus(createLabelledRng(seed, "lexer"), budget);
    const second = mutantCorpus(createLabelledRng(seed, "lexer"), budget);
    expect(second.map((mutant) => mutant.inputHash)).toEqual(
      first.map((mutant) => mutant.inputHash),
    );
    // Every case must yield a stable hash and a source that lexes.
    for (const mutant of first) expect(mutant.inputHash).toMatch(/^[0-9a-f]{16}$/u);
  });

  test("the default budget stays inside `bun run verify`", () => {
    expect(readStressBudget({})).toBe(200);
    expect(readStressSeed({})).toBe(1);
  });
});
