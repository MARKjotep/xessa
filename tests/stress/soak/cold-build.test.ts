/**
 * TT7 · Cold-build byte identity (`.ai/plans/CSSX-PLAN-TESTING.md` §TT7 row 2).
 *
 * | Case | Assertion |
 * |---|---|
 * | Cold-build identity | 20 consecutive cold builds of the same 1000-file project: byte-identical CSS, source map, `.d.ts` and manifest each run (hash compare) |
 *
 * Gated by `XESSA_SOAK=1`: twenty builds of 1000 files take a couple of minutes,
 * so the case stays out of the default `bun run verify` gate. Each build starts
 * from a brand-new temp project holding the same generated sources (no manifest,
 * no warm cache), and every artifact — `dist/**` plus `.cssx-manifest.json` — is
 * hashed so a single byte of drift anywhere fails the case.
 *
 * Knobs (all optional): `XESSA_SOAK_COLD_BUILDS`, `XESSA_SOAK_COLD_FILES`,
 * `XESSA_SOAK_SEED`.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  SOAK_DEFAULTS,
  SOAK_ENABLED,
  SOAK_SKIP_LABEL,
  cleanupSoakProjects,
  projectFiles,
  readSoakInteger,
  runColdBuilds,
} from "./helpers.ts";

afterEach(() => {
  cleanupSoakProjects();
});

describe.skipIf(!SOAK_ENABLED)(`TT7 cold-build identity${SOAK_SKIP_LABEL}`, () => {
  test("20 consecutive cold builds of the 1000-file project are byte-identical", () => {
    const builds = readSoakInteger("XESSA_SOAK_COLD_BUILDS", SOAK_DEFAULTS.coldBuilds);
    const files = readSoakInteger("XESSA_SOAK_COLD_FILES", SOAK_DEFAULTS.coldFiles);
    const seed = readSoakInteger("XESSA_SOAK_SEED", SOAK_DEFAULTS.seed);

    // The project is generated once and written into a fresh temp dir per run,
    // so build N cannot inherit anything from build N-1.
    expect(Object.keys(projectFiles(files, seed)).length).toBeGreaterThan(files);

    const result = runColdBuilds({ builds, files, seed });

    const elapsed = result.runs.map((run) => run.elapsedMs);
    const total = elapsed.reduce((sum, value) => sum + value, 0);
    console.log(
      `[TT7 cold-build] builds=${result.runs.length} files=${files} ` +
        `artifacts=${result.runs[0]?.artifactCount ?? 0} ` +
        `bytes=${result.runs[0]?.artifactBytes ?? 0} ` +
        `build min/median/max=${Math.min(...elapsed)}/${elapsed[Math.floor(elapsed.length / 2)]}/${Math.max(...elapsed)}ms ` +
        `total=${total}ms`,
    );
    console.log(
      `[TT7 cold-build] identical=${result.identical} mismatches=${result.mismatches.length} ` +
        `missing=${result.missing.length} fingerprint=${result.runs[0]?.fingerprint ?? "n/a"}`,
    );

    expect(result.runs).toHaveLength(builds);
    for (const run of result.runs) {
      expect(run.status).toBe(0);
      expect(run.errors).toEqual([]);
    }
    expect(result.identical).toBe(true);
    expect(result.mismatches).toEqual([]);
    expect(result.missing).toEqual([]);
    // One fingerprint for the whole set: identical hashes, identical layout.
    expect(new Set(result.runs.map((run) => run.fingerprint)).size).toBe(1);
    // css + map + js + d.ts per file, plus the manifest.
    expect(result.runs[0]?.artifactCount).toBe(4 * files + 1);
  }, 1_800_000);
});
