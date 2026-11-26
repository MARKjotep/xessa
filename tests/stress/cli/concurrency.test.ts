/**
 * TT4 · Two simultaneous `build` processes on one project.
 *
 * Documented behavior (`.ai/reports/CSSX-TT4.md`, weakest-10 row #2 for
 * `packages/cli/src/{manifest,writer}.ts`): there is no cross-process lock; each
 * artifact is written to a per-process temporary file and renamed, and the
 * manifest is rewritten atomically. With identical inputs both processes
 * produce identical bytes, so the expected final state is the same set of
 * artifacts plus a complete manifest — no torn file, no lost record, no leftover
 * temporary file.
 *
 * The case therefore asserts the *final state*, which is deterministic:
 * - both processes exit 0 and report success;
 * - every artifact is byte-identical to its committed expected fixture;
 * - the concurrent manifest is byte-identical to a single sequential build's;
 * - every recorded hash matches the artifact actually on disk;
 * - no `.cssx-tmp` staging file survives.
 *
 * All awaits are bounded ({@link CONCURRENCY_TIMEOUT_MS}); nothing polls.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  type CliResult,
  cleanupProjects,
  createProject,
  hashOfFile,
  listFiles,
  parseJson,
  readText,
  runCli,
  spawnCli,
} from "./helpers.ts";

afterEach(async () => {
  await cleanupProjects();
});

/** Bound for one concurrent round (a build takes a few hundred milliseconds). */
const CONCURRENCY_TIMEOUT_MS = 60_000;

interface Manifest {
  version: number;
  files: Array<{ kind: string; path: string; source: string; hash: string }>;
}

interface BuildJson {
  command: string;
  success: boolean;
  exitCode: number;
  errors: unknown[];
}

const EXPECTED_ARTIFACTS: readonly (readonly [string, string])[] = [
  ["generated/styles/button.css", "button.css"],
  ["generated/styles/card.css", "card.css"],
  ["generated/maps/button.map.js", "button.map.js"],
  ["generated/maps/button.map.d.ts", "button.map.d.ts"],
  ["generated/maps/card.map.js", "card.map.js"],
  ["generated/maps/card.map.d.ts", "card.map.d.ts"],
];

/** Reject if `promise` does not settle within `ms`. */
async function within<T>(promise: Promise<T>, label: string, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`[${label}] did not settle within ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Outcome of one concurrent round. */
interface ConcurrentRound {
  readonly results: readonly CliResult[];
  /** Whether both processes were observed alive at the same instant. */
  readonly overlapped: boolean;
}

/**
 * Start two `build --json` processes back-to-back and await both.
 *
 * Overlap is observed, not timed: immediately after the second spawn, the first
 * process must still be running. A pathologically loaded machine could let the
 * first build finish before the second spawns, so the round is retried a bounded
 * number of times; the workspace ends in the same state either way.
 */
async function concurrentBuilds(root: string): Promise<ConcurrentRound> {
  const maxAttempts = 3;
  let round: ConcurrentRound = { results: [], overlapped: false };
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const first = spawnCli(["build", "--json"], root);
    const second = spawnCli(["build", "--json"], root);
    const overlapped = first.child.exitCode === null && second.child.exitCode === null;
    const results = await within(
      Promise.all([first.result, second.result]),
      "concurrent build round",
      CONCURRENCY_TIMEOUT_MS,
    );
    round = { results, overlapped };
    if (overlapped) break;
  }
  return round;
}

describe("two simultaneous builds", () => {
  test("both succeed and leave a complete, untorn workspace", async () => {
    const root = await createProject("basic");
    const reference = await createProject("basic");
    // Sequential reference: the manifest a single build produces, byte for byte.
    expect(runCli(["build"], reference).status).toBe(0);
    const sequentialManifest = await readText(join(reference, ".cssx-manifest.json"));
    expect(sequentialManifest).not.toBeNull();

    const round = await concurrentBuilds(root);
    // Both processes must genuinely have overlapped for this to be the
    // concurrency case at all (observed, not timed; retried a bounded number
    // of times inside `concurrentBuilds`).
    expect(round.overlapped).toBe(true);
    for (const result of round.results) {
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const report = parseJson<BuildJson>(result.stdout, "concurrent build report");
      expect(report.command).toBe("build");
      expect(report.success).toBe(true);
      expect(report.exitCode).toBe(0);
      expect(report.errors).toEqual([]);
    }

    // No torn artifact: every file is the complete, expected byte sequence.
    for (const [artifact, golden] of EXPECTED_ARTIFACTS) {
      const written = await readText(join(root, artifact));
      const expected = await readText(join(root, "expected", golden));
      expect(expected).not.toBeNull();
      expect(written).toBe(expected);
    }

    // Manifest consistency: complete, correctly ordered and byte-identical to
    // the sequential build's manifest (which records the same inputs).
    const concurrentManifestText = await readText(join(root, ".cssx-manifest.json"));
    expect(concurrentManifestText).toBe(sequentialManifest);
    const manifest = parseJson<Manifest>(concurrentManifestText ?? "", "concurrent manifest");
    expect(manifest.version).toBe(1);
    expect(manifest.files).toHaveLength(EXPECTED_ARTIFACTS.length);
    expect(manifest.files.map((record) => record.path).sort()).toEqual(
      EXPECTED_ARTIFACTS.map(([artifact]) => artifact).sort(),
    );

    // Every recorded hash matches the file that is actually on disk: neither
    // writer recorded a state the other one invalidated.
    for (const record of manifest.files) {
      expect(await hashOfFile(join(root, record.path))).toBe(record.hash);
    }

    // No per-process staging file survived either race.
    const leftovers = (await listFiles(root)).filter((file) => file.includes(".cssx-tmp"));
    expect(leftovers).toEqual([]);
  }, 120_000);

  test("a second concurrent round reproduces the same final state", async () => {
    const root = await createProject("basic");

    const firstRound = await concurrentBuilds(root);
    for (const result of firstRound.results) expect(result.status).toBe(0);
    const manifestAfterFirst = await readText(join(root, ".cssx-manifest.json"));
    const cssAfterFirst = await readText(join(root, "generated/styles/button.css"));

    const secondRound = await concurrentBuilds(root);
    for (const result of secondRound.results) expect(result.status).toBe(0);

    expect(await readText(join(root, ".cssx-manifest.json"))).toBe(manifestAfterFirst);
    expect(await readText(join(root, "generated/styles/button.css"))).toBe(cssAfterFirst);
    for (const [artifact, golden] of EXPECTED_ARTIFACTS) {
      expect(await readText(join(root, artifact))).toBe(
        await readText(join(root, "expected", golden)),
      );
    }
  }, 120_000);
});
