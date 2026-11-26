/**
 * TT3 · Watch churn (§TT3 "Watch").
 *
 * Cases: rapid-fire edits (≥20 inside one debounce tick), rename in place,
 * directory create/remove during watch, and a touched file inside `exclude`.
 *
 * The watcher emits one NDJSON object per line and a readiness handshake after
 * the initial build and watcher attachment (`watch.ts:236-251`), so no case
 * sleeps blindly: settles are asserted by polling the artifact tree with a
 * bounded timeout, and "must not rebuild" is asserted with a bounded negative
 * probe. Build *counts* are only ever asserted as bounds, because an event that
 * arrives mid-build legitimately costs an extra cycle (the in-flight generation
 * is discarded as stale).
 *
 * Directory creation during a watch triggers a full rediscovery so a brand-new
 * nested source tree becomes visible without a restart (`fs.watch` reports the
 * new *directory* name to the parent's callback). Directory removal still
 * prunes the owned artifacts below it.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  cleanupProjects,
  createProject,
  listFiles,
  projectConfig,
  projectPathExists,
  readProjectFile,
  simpleSource,
  startWatch,
  waitFor,
  writeProjectFile,
  writeProjectJson,
} from "./helpers.ts";

afterEach(async () => {
  await cleanupProjects();
});

/** Build a two-entry project with a watcher-friendly layout. */
async function watchProject(): Promise<string> {
  const root = await createProject({
    "xessa.config.json": "",
    "src/one.cssx": simpleSource("one"),
    "src/two.cssx": simpleSource("two", "blue"),
  });
  await writeProjectJson(
    root,
    "xessa.config.json",
    projectConfig({ cssDir: "out", exclude: ["src/skip"] }),
  );
  return root;
}

describe("watch churn", () => {
  test("coalesces 20 rapid edits instead of rebuilding per event", async () => {
    const root = await watchProject();
    const watch = startWatch(root);
    let exitCode = -1;
    try {
      await watch.awaitReady("rapid fire ready");
      expect(watch.builds()).toHaveLength(1);

      // Twenty sequential edits land inside a few debounce windows (40 ms): the
      // watcher must fold them into a bounded number of builds, not twenty.
      for (let index = 0; index < 20; index += 1) {
        await writeProjectFile(root, "src/one.cssx", simpleSource("one", `rgb(${index}, 0, 0)`));
      }

      await waitFor(
        async () =>
          (await readProjectFile(root, "out/src/one.css"))?.includes("rgb(19, 0, 0)") === true,
        "last rapid edit landed",
        15_000,
        20,
      );
      // Drain any in-flight cycle (disk state leads the event stream by design),
      // then assert the bound: 20 edits collapse into at most two builds.
      const tail = await watch.quietNextBuild("rapid fire tail", 300);
      const builds = watch.builds();
      expect(builds.length).toBeGreaterThanOrEqual(2);
      expect(builds.length).toBeLessThanOrEqual(3);
      expect(builds.every((build) => build.success)).toBe(true);
      expect(tail === null || tail.success).toBe(true);
      // Only the edited entry is ever rebuilt, and the other artifact is stable.
      expect(builds.slice(1).every((build) => build.entries.length <= 1)).toBe(true);
      expect(await readProjectFile(root, "out/src/two.css")).toContain("blue");
      expect(listFiles(`${root}/out`)).toEqual(["src/one.css", "src/two.css"]);
    } finally {
      exitCode = await watch.stop();
    }
    expect(exitCode).toBe(0);
  }, 60_000);

  test("handles a rename in place by rediscovering and pruning the old artifact", async () => {
    const root = await watchProject();
    const watch = startWatch(root);
    let exitCode = -1;
    try {
      await watch.awaitReady("rename ready");
      expect(listFiles(`${root}/out`)).toEqual(["src/one.css", "src/two.css"]);

      await rename(join(root, "src/two.cssx"), join(root, "src/renamed.cssx"));
      await waitFor(
        () => projectPathExists(root, "out/src/renamed.css"),
        "renamed artifact written",
      );

      // The old name no longer exists, so the watcher falls back to a full
      // rediscovery: the new artifact appears and the pruned one is removed.
      expect(await projectPathExists(root, "out/src/two.css")).toBe(false);
      expect(listFiles(`${root}/out`)).toEqual(["src/one.css", "src/renamed.css"]);
      const build = await watch.nextBuildMatching("rename rebuild", (candidate) =>
        candidate.entries.some((entry) => entry.file === "src/renamed.cssx"),
      );
      expect(build.success).toBe(true);
    } finally {
      exitCode = await watch.stop();
    }
    expect(exitCode).toBe(0);
  }, 60_000);

  test("picks up a file created in a watched directory and removes it on directory delete", async () => {
    const root = await watchProject();
    await mkdir(join(root, "src/parts"), { recursive: true });
    await writeProjectFile(root, "src/parts/three.cssx", simpleSource("three", "green"));
    const watch = startWatch(root);
    let exitCode = -1;
    try {
      await watch.awaitReady("dir churn ready");
      expect(await projectPathExists(root, "out/src/parts/three.css")).toBe(true);

      // A file inside an already-watched directory is an ordinary event, so it
      // must rebuild and produce its artifact.
      await writeProjectFile(root, "src/parts/four.cssx", simpleSource("four", "gray"));
      await waitFor(
        () => projectPathExists(root, "out/src/parts/four.css"),
        "file added in watched dir",
      );

      // Deleting the directory removes every owned artifact below it.
      await rm(join(root, "src/parts"), { recursive: true, force: true });
      await waitFor(
        async () =>
          !(await projectPathExists(root, "out/src/parts/three.css")) &&
          !(await projectPathExists(root, "out/src/parts/four.css")),
        "directory removal pruned",
      );
      expect(listFiles(`${root}/out`)).toEqual(["src/one.css", "src/two.css"]);
    } finally {
      exitCode = await watch.stop();
    }
    expect(exitCode).toBe(0);
  }, 60_000);

  test("discovers a brand-new nested directory without a restart (CSSX-T08)", async () => {
    const root = await watchProject();
    const watch = startWatch(root);
    let exitCode = -1;
    try {
      await watch.awaitReady("new nested dir ready");
      const buildsAfterReady = watch.builds().length;

      await mkdir(join(root, "src/fresh"), { recursive: true });
      await writeProjectFile(root, "src/fresh/five.cssx", simpleSource("five", "black"));

      // The parent directory's event names `fresh`; the watcher now treats a
      // non-artifact, non-`.cssx` entry as a directory event and rediscovers the
      // include globs, so the new tree is watched and its source is built.
      await waitFor(
        () => projectPathExists(root, "out/src/fresh/five.css"),
        "new nested directory discovered",
      );
      const build = await watch.nextBuildMatching("new nested dir rebuild", (candidate) =>
        candidate.entries.some((entry) => entry.file === "src/fresh/five.cssx"),
      );
      expect(build.success).toBe(true);
      expect(watch.builds().length).toBeGreaterThanOrEqual(buildsAfterReady + 1);
      expect(await readProjectFile(root, "out/src/fresh/five.css")).toContain("black");
      // The existing artifacts are untouched by the rediscovery.
      expect(await projectPathExists(root, "out/src/one.css")).toBe(true);
      expect(await projectPathExists(root, "out/src/two.css")).toBe(true);
    } finally {
      exitCode = await watch.stop();
    }
    expect(exitCode).toBe(0);
  }, 60_000);

  test("ignores edits to a file inside an excluded directory", async () => {
    const root = await watchProject();
    await writeProjectFile(root, "src/skip/noise.cssx", simpleSource("noise", "pink"));
    const watch = startWatch(root);
    let exitCode = -1;
    try {
      await watch.awaitReady("exclude ready");
      // The excluded file is not a source, and its directory is not watched.
      expect(
        watch
          .builds()[0]
          ?.entries.map((entry) => entry.file)
          .sort(),
      ).toEqual(["src/one.cssx", "src/two.cssx"]);

      await writeProjectFile(root, "src/skip/noise.cssx", simpleSource("noise", "orange"));
      const triggered = await watch.quietNextBuild("excluded touch", 400);
      expect(triggered).toBeNull();
      expect(watch.builds()).toHaveLength(1);
      expect(await projectPathExists(root, "out/src/skip/noise.css")).toBe(false);
    } finally {
      exitCode = await watch.stop();
    }
    expect(exitCode).toBe(0);
  }, 60_000);
});
