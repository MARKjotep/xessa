/**
 * TT5 row 3 — type inference from the generated declarations.
 *
 * | Assertion | How |
 * |---|---|
 * | literal class-name exports infer | a consumer that imports the generated map declares `cardOne` as the `"ui-card-one"` literal and typechecks clean |
 * | a missing export still errors | `@ts-expect-error` on `import { cardThree }` produces tsc exit 0; the same file **without** the directive is a red run (the directive is genuinely consumed, not unused) |
 * | the value is a literal, not `string` | assigning `cardOne` to `"ui-card-two"` is an error, so a stray `@ts-expect-error` there is consumed |
 * | the mechanism cannot pass vacuously | a stray `@ts-expect-error` on a **correct** assignment leaves an unused directive (`TS2578`) and tsc fails |
 *
 * The declarations are opt-in (`map-types: true` in the generated project), so
 * this row also proves the CLI emits and type-checks them on request. `tsc` is
 * the repository's own TypeScript binary run as a subprocess under the newest
 * installed Node runtime (falling back to Bun when no Node is installed); the
 * consumer files are written into the generated project so the import path is
 * the real one a consumer writes: `./dist/maps/src/card.map.js` →
 * `card.map.d.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../corpus.ts";
import { cleanupTempProjects, createTempProject, writeProjectFiles } from "../scale/generate.ts";
import {
  type ProcessOutcome,
  TSC_ENTRY,
  ensureDistBuild,
  expectStatus,
  generatedProject,
  runProcess,
  runtimeMatrix,
} from "./helpers.ts";

/** Project root of the built consumer project. */
let root = "";
/** Binary that runs `tsc`. */
let tscBinary = "";
/** Human-readable runtime label for failure messages. */
let tscRuntime = "";
/** Path of the generated map module, relative to {@link root}. */
const MAP_MODULE = "./dist/maps/src/card.map.js";

/** Baseline: literal types from the named exports. */
const CONSUMER_CLEAN = `import { cardOne, cardTwo } from ${JSON.stringify(MAP_MODULE)};

// Named exports are literal types, not \`string\`.
const namedLiteral: "ui-card-one" = cardOne;
const secondLiteral: "ui-card-two" = cardTwo;
// A class name is assignable to the wide type as well.
const wide: string = cardOne;

export { namedLiteral, secondLiteral, wide };
`;

/** Missing export with the expectation that it errors (there is no default map). */
const CONSUMER_WRONG_EXPORT = `// @ts-expect-error - "cardThree" is not exported by this stylesheet
import { cardThree } from ${JSON.stringify(MAP_MODULE)};

void cardThree;
`;

/** Control: the same missing export without the directive must fail. */
const CONTROL_WRONG_EXPORT = `import { cardThree } from ${JSON.stringify(MAP_MODULE)};

void cardThree;
`;

/** Wrong literal with the expectation that it errors: proves the value type is literal. */
const CONSUMER_WRONG_LITERAL = `import { cardOne } from ${JSON.stringify(MAP_MODULE)};

// @ts-expect-error - the export value is the literal "ui-card-one", not an arbitrary string
const wrongLiteral: "ui-card-two" = cardOne;

export { wrongLiteral };
`;

/** Control: the same wrong literal without the directive must fail. */
const CONTROL_WRONG_LITERAL = `import { cardOne } from ${JSON.stringify(MAP_MODULE)};

const wrongLiteral: "ui-card-two" = cardOne;

export { wrongLiteral };
`;

/** Control: a stray directive on a correct assignment must fail with TS2578. */
const CONTROL_UNUSED_DIRECTIVE = `import { cardOne } from ${JSON.stringify(MAP_MODULE)};

// @ts-expect-error - nothing is wrong with this assignment
const fine: "ui-card-one" = cardOne;

export { fine };
`;

/** Run `tsc --noEmit` over the given consumer files. */
function typecheck(files: readonly string[]): ProcessOutcome {
  const args = [
    TSC_ENTRY,
    "--noEmit",
    "--strict",
    "--skipLibCheck",
    "--target",
    "ES2022",
    "--module",
    "ESNext",
    "--moduleResolution",
    "Bundler",
    ...files,
  ];
  return runProcess(tscBinary, args, { cwd: root, timeoutMs: 180_000 });
}

/** Label that names the exact consumer file and compiler when a case goes red. */
function label(file: string): string {
  return `${tscRuntime} tsc --noEmit ${file}`;
}

beforeAll(async () => {
  await ensureDistBuild();
  const matrix = runtimeMatrix();
  const node = matrix.rows.find(
    (row) => row.engine === "node" && row.status === "verified",
  )?.runtime;
  const bun = matrix.rows.find((row) => row.engine === "bun" && row.status === "verified")?.runtime;
  tscBinary = node?.binary ?? bun?.binary ?? "bun";
  tscRuntime = node === undefined ? `bun ${bun?.version ?? "?"}` : `node ${node.version}`;
  root = createTempProject(generatedProject({ sourceMap: false, mapTypes: true }).files);
  // The declarations under test are generated artifacts, so build with the built CLI first.
  const cliEntry = join(REPO_ROOT, "packages", "cli", "dist", "index.js");
  const buildOutcome = runProcess(tscBinary, [cliEntry, "build"], { cwd: root });
  expectStatus(`${tscRuntime} xessa build (${root})`, buildOutcome, 0);
  expect(existsSync(join(root, "dist", "maps", "src", "card.map.d.ts"))).toBe(true);
  writeProjectFiles(root, {
    "consumer.ts": CONSUMER_CLEAN,
    "wrong-export.ts": CONSUMER_WRONG_EXPORT,
    "control-wrong-export.ts": CONTROL_WRONG_EXPORT,
    "wrong-literal.ts": CONSUMER_WRONG_LITERAL,
    "control-wrong-literal.ts": CONTROL_WRONG_LITERAL,
    "control-unused-directive.ts": CONTROL_UNUSED_DIRECTIVE,
  });
});

afterAll(() => {
  cleanupTempProjects();
});

describe("type inference from the generated declarations", () => {
  test("the generated declarations pin the literal bindings", () => {
    const declarations = readFileSync(join(root, "dist", "maps", "src", "card.map.d.ts"), "utf8");
    expect(declarations).toContain('export declare const cardOne: "ui-card-one";');
    expect(declarations).toContain('export declare const cardTwo: "ui-card-two";');
    expect(declarations).not.toContain("export default");
    expect(declarations).not.toContain("readonly");
    expect(tscBinary.startsWith("/")).toBe(true);
  });

  test("literal exports infer in a plain consumer", () => {
    const outcome = typecheck(["consumer.ts"]);
    expectStatus(label("consumer.ts"), outcome, 0);
    expect(outcome.status).toBe(0);
  });

  test("a missing class export still errors under @ts-expect-error", () => {
    const expected = typecheck(["wrong-export.ts"]);
    const control = typecheck(["control-wrong-export.ts"]);
    // The directive is consumed: with it tsc is clean, without it tsc is red.
    expectStatus(label("wrong-export.ts"), expected, 0);
    expect(expected.status).toBe(0);
    expect(control.status).not.toBe(0);
    expect(control.stdout + control.stderr).toContain("cardThree");
    expect(control.stdout + control.stderr).toMatch(/TS2305|TS2724/u);
  });

  test("the export value is a literal, so a wrong literal is an error too", () => {
    const expected = typecheck(["wrong-literal.ts"]);
    const control = typecheck(["control-wrong-literal.ts"]);
    expectStatus(label("wrong-literal.ts"), expected, 0);
    expect(expected.status).toBe(0);
    expect(control.status).not.toBe(0);
    expect(control.stdout + control.stderr).toMatch(/TS2322|TS2741/u);
  });

  test("a stray @ts-expect-error on a correct assignment fails with TS2578", () => {
    const control = typecheck(["control-unused-directive.ts"]);
    expectStatus(label("control-unused-directive.ts"), control, 2);
    expect(control.stdout + control.stderr).toContain("TS2578");
  });
});
