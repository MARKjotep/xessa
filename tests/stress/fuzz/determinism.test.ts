/**
 * TT1 determinism stress — weakness row #6b of `tests/stress/README.md`.
 *
 * Two builds of the same input must be byte-identical, and nothing may depend on
 * the order in which module files are read. `naming.test.ts:194` and
 * `mapgen.test.ts:211` already assert run-to-run identity for the naming pass;
 * this file asserts it for the whole public pipeline, and adds the shuffled
 * `readFile` settlement order and entry order that nothing covered before.
 */

import { describe, expect, test } from "bun:test";
import { compile, compileProject } from "../../../packages/compiler/src/index.ts";
import { REPO_ROOT, loadCorpus, mutantCorpus } from "../corpus.ts";
import {
  createLabelledRng,
  createRng,
  hashString,
  readStressBudget,
  readStressSeed,
} from "../prng.ts";
import {
  artifactSnapshot,
  createOrderedHost,
  createShuffledHost,
  determinismProject,
  projectSnapshot,
  runDeterminismArea,
} from "./areas.ts";

const ROOT = "/workspace";

describe("TT1 determinism: seeded area", () => {
  test("repeated runs, shuffled reads and generator replay are identical", async () => {
    const seed = readStressSeed();
    const budget = readStressBudget();
    const run = await runDeterminismArea({ seed, budget });
    expect(run.cases).toBeGreaterThanOrEqual(budget);
    expect(
      run.violations.map(
        (violation) => `${violation.caseLabel}: ${violation.message} [${violation.inputHash}]`,
      ),
    ).toEqual([]);
  }, 60_000);
});

describe("TT1 determinism: repeated compile", () => {
  test("every fixture compiles to identical bytes on three runs", async () => {
    for (const fixture of loadCorpus().fixtures) {
      const snapshots = [];
      for (let run = 0; run < 3; run += 1) {
        snapshots.push(
          artifactSnapshot(
            await compile(fixture.source, { file: fixture.file, workspaceRoot: REPO_ROOT }),
          ),
        );
      }
      expect({ fixture: fixture.id, runs: new Set(snapshots).size }).toEqual({
        fixture: fixture.id,
        runs: 1,
      });
    }
  }, 60_000);
});

describe("TT1 determinism: shuffled module-read order", () => {
  test("PRNG-ordered readFile settlement yields the same artifacts", async () => {
    const { files, entry } = determinismProject();
    const ordered = projectSnapshot(
      await compileProject([entry], createOrderedHost(files, ROOT), { projectRoot: ROOT }),
    );
    const seed = readStressSeed();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const shuffled = projectSnapshot(
        await compileProject([entry], createShuffledHost(files, createRng(seed + attempt), ROOT), {
          projectRoot: ROOT,
        }),
      );
      expect({ attempt, identical: shuffled === ordered }).toEqual({ attempt, identical: true });
    }
  }, 60_000);

  test("entry order does not change any entry's artifacts", async () => {
    const { files, entry } = determinismProject();
    const second = `${ROOT}/tests/fixtures/canonical/second.cssx`;
    const projectFiles = new Map(files);
    projectFiles.set(second, ".second { color: red; }\n");
    const forward = projectSnapshot(
      await compileProject([entry, second], createOrderedHost(projectFiles, ROOT), {
        projectRoot: ROOT,
      }),
    );
    const backward = projectSnapshot(
      await compileProject([second, entry], createOrderedHost(projectFiles, ROOT), {
        projectRoot: ROOT,
      }),
    );
    expect(backward).toBe(forward);
  }, 60_000);
});

describe("TT1 determinism: generator", () => {
  test("the same seed replays the same mutants", () => {
    const seed = readStressSeed();
    const budget = Math.min(readStressBudget(), 50);
    const first = mutantCorpus(createLabelledRng(seed, "determinism-replay"), budget);
    const second = mutantCorpus(createLabelledRng(seed, "determinism-replay"), budget);
    expect(second.map((mutant) => mutant.inputHash)).toEqual(
      first.map((mutant) => mutant.inputHash),
    );
    expect(new Set(first.map((mutant) => mutant.inputHash)).size).toBeGreaterThan(1);
  });

  test("a different seed produces a different case list", () => {
    const first = mutantCorpus(createLabelledRng(1, "determinism-replay"), 20);
    const second = mutantCorpus(createLabelledRng(2, "determinism-replay"), 20);
    expect(second.map((mutant) => mutant.inputHash)).not.toEqual(
      first.map((mutant) => mutant.inputHash),
    );
  });

  test("the PRNG and hash are stable and integer-only", () => {
    const rng = createRng(7);
    const words = Array.from({ length: 64 }, () => rng.nextUint32());
    const replay = createRng(7);
    expect(Array.from({ length: 64 }, () => replay.nextUint32())).toEqual(words);
    for (const word of words)
      expect(Number.isInteger(word) && word >= 0 && word <= 0xffff_ffff).toBe(true);
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).toMatch(/^[0-9a-f]{16}$/u);
    expect(hashString("abc")).not.toBe(hashString("abd"));
  });

  test("seed and budget come only from the environment, with defaults", () => {
    expect(readStressSeed({})).toBe(1);
    expect(readStressBudget({})).toBe(200);
    expect(readStressSeed({ XESSA_STRESS_SEED: "42" })).toBe(42);
    expect(readStressBudget({ XESSA_STRESS_BUDGET: "5000" })).toBe(5_000);
    expect(() => readStressSeed({ XESSA_STRESS_SEED: "-1" })).toThrow();
    expect(() => readStressBudget({ XESSA_STRESS_BUDGET: "1e3" })).toThrow();
  });
});
