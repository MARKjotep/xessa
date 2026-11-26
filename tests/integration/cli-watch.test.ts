/**
 * `xessa watch` integration (CSSX-A11, stabilized 2026-11-25).
 *
 * Each test writes its own project into a fresh `mkdtemp` directory (never the
 * shared fixtures), starts the compiled source CLI in that directory with
 * `--json`, and waits for the machine-readable event stream:
 *
 * - the `watch` ready event is emitted only after the initial build and watcher
 *   attachment, so there is no attachment race;
 * - each `build` event is emitted after artifacts and the manifest are written,
 *   so assertions run against settled files;
 * - every await is bounded (10 s) and names itself in the failure message.
 *
 * No fixed sleeps are used. Tests are skipped only when the environment cannot
 * deliver non-recursive filesystem events at all.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { watch } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  cleanup,
  cliEntry,
  createTempDirectory,
  exists,
  readText,
  writeText,
} from "./cli-helpers.ts";

const temporaryProjects: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryProjects.splice(0).map((directory) => cleanup(directory)));
});

const fsEventsSupported = await supportsFsEvents();

/** Bound for every event/file await, generous enough for loaded CI machines. */
const WAIT_TIMEOUT_MS = 10_000;

interface WatchLine {
  readonly type?: string;
  readonly [key: string]: unknown;
}

interface BuildLine extends WatchLine {
  readonly type: "build";
  readonly entries: ReadonlyArray<{
    readonly file: string;
    readonly outputs: ReadonlyArray<{ kind: string; path: string; written: boolean }>;
  }>;
  readonly success: boolean;
  readonly exitCode: number;
}

interface ReadyLine extends WatchLine {
  readonly type: "watch";
  readonly ready: boolean;
  readonly sources: number;
  readonly debounceMs: number;
}

interface WatchHarness {
  /** Every JSON event observed so far, in order. */
  readonly events: readonly WatchLine[];
  /** Await the readiness handshake (initial build finished, watchers attached). */
  awaitReady(label?: string): Promise<ReadyLine>;
  /** Await the next `build` event. */
  nextBuild(label: string): Promise<BuildLine>;
  /** Stop the child and return its exit code. */
  stop(): Promise<number>;
}

/**
 * Start `xessa watch --json` and expose the event stream with bounded awaits.
 *
 * The CLI writes one NDJSON object per line; diagnostic text (for example a
 * discarded stale generation) is skipped. Timeouts include the tail of stderr
 * and the event types seen so far so failures identify the await.
 */
function startWatch(root: string): WatchHarness {
  const child = Bun.spawn([process.execPath, cliEntry, "watch", "--json"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = child.stdout as ReadableStream<Uint8Array> | null;
  const stderr = child.stderr as ReadableStream<Uint8Array> | null;
  if (stdout === null || stderr === null) {
    throw new Error("watch process did not expose piped stdout/stderr");
  }

  const reader = stdout.getReader();
  const stderrReader = stderr.getReader();
  const decoder = new TextDecoder();
  const stderrDecoder = new TextDecoder();
  let buffer = "";
  let stderrText = "";
  let stopped = false;
  const events: WatchLine[] = [];

  // Drain stderr so a chatty process can never block on a full pipe.
  void (async () => {
    try {
      for (;;) {
        const chunk = await stderrReader.read();
        if (chunk.done) return;
        stderrText = `${stderrText}${stderrDecoder.decode(chunk.value, { stream: true })}`.slice(
          -8_000,
        );
      }
    } catch {
      // Stream closed with the process.
    }
  })();

  const diagnostics = (label: string): string =>
    `[${label}] event types seen: ${JSON.stringify(events.map((event) => event.type))}; ` +
    `stderr tail: ${stderrText.slice(-1_500) || "(empty)"}`;

  const readChunk = async (timeoutMs: number, label: string): Promise<Uint8Array> => {
    const readPromise = reader.read();
    // Guard the losing side of the timeout race against unhandled rejection.
    readPromise.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), Math.max(1, timeoutMs));
    });
    try {
      const result = await Promise.race([readPromise, timeout]);
      if (result === "timeout") {
        throw new Error(`[${label}] timed out after ${WAIT_TIMEOUT_MS}ms: ${diagnostics(label)}`);
      }
      if (result.done) {
        throw new Error(`[${label}] watch process ended before the event: ${diagnostics(label)}`);
      }
      return result.value;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  const nextLine = async (label: string, deadline: number): Promise<WatchLine> => {
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line === "") continue;
        try {
          const parsed = JSON.parse(line) as WatchLine;
          if (typeof parsed === "object" && parsed !== null) return parsed;
        } catch {
          // Non-JSON diagnostic line; keep looking.
        }
        continue;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`[${label}] timed out after ${WAIT_TIMEOUT_MS}ms: ${diagnostics(label)}`);
      }
      buffer = `${buffer}${decoder.decode(await readChunk(remaining, label), { stream: true })}`;
    }
  };

  const nextEvent = async (type: string, label: string): Promise<WatchLine> => {
    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    for (;;) {
      const event = await nextLine(label, deadline);
      events.push(event);
      if (event.type === type) return event;
    }
  };

  return {
    events,
    awaitReady: async (label = "initial ready") => {
      const event = await nextEvent("watch", label);
      if (event.ready !== true) {
        throw new Error(`[${label}] watch ready event is not ready: ${JSON.stringify(event)}`);
      }
      return event as ReadyLine;
    },
    nextBuild: async (label: string) => (await nextEvent("build", label)) as BuildLine,
    stop: async (): Promise<number> => {
      if (stopped) return child.exitCode ?? 0;
      stopped = true;
      child.kill("SIGINT");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), 5_000);
      });
      try {
        const result = await Promise.race([child.exited, timeout]);
        if (result === "timeout") {
          child.kill("SIGKILL");
          await child.exited;
        }
        return typeof result === "number" ? result : (child.exitCode ?? 0);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        await reader.cancel().catch(() => undefined);
        await stderrReader.cancel().catch(() => undefined);
      }
    },
  };
}

describe.skipIf(!fsEventsSupported)("xessa watch", () => {
  test("rebuilds only the affected entry and ignores generated-output writes", async () => {
    const root = await createWatchProject();
    temporaryProjects.push(root);
    const harness = startWatch(root);
    let exitCode = -1;

    try {
      const ready = await harness.awaitReady();
      expect(ready.ready).toBe(true);
      expect(ready.sources).toBe(3);
      expect(ready.debounceMs).toBeGreaterThan(0);

      const initial = harness.events.filter((event) => event.type === "build");
      expect(initial).toHaveLength(1);
      expect((initial[0] as BuildLine).entries).toHaveLength(2);

      const cardBefore = await readText(join(root, "generated/styles/card.css"));
      expect(cardBefore).not.toBeNull();

      // A write to a generated output must not schedule a build. It is issued
      // just before a real source edit so an ignored-output regression would
      // surface as an unexpected full rebuild ahead of the incremental one.
      await writeFile(join(root, "generated/styles/button.css"), "/* noise */\n", "utf8");
      const sourcePath = join(root, "src/button.cssx");
      const source = (await readText(sourcePath)) ?? "";
      await writeFile(sourcePath, `${source}\n.button { outline: 1px solid red; }\n`, "utf8");

      const rebuild = await harness.nextBuild("button rebuild");
      expect(rebuild.entries).toHaveLength(1);
      expect(rebuild.entries[0]?.file).toBe("src/button.cssx");
      expect(rebuild.success).toBe(true);
      expect(rebuild.entries[0]?.outputs.every((output) => output.written)).toBe(true);

      expect(await readText(join(root, "generated/styles/button.css"))).toContain(
        "outline:1px solid red",
      );
      expect(await readText(join(root, "generated/styles/card.css"))).toBe(cardBefore);
    } finally {
      exitCode = await harness.stop();
    }

    expect(exitCode).toBe(0);
  }, 30_000);

  test("reloads configuration changes with a full rebuild", async () => {
    const root = await createWatchProject();
    temporaryProjects.push(root);
    const harness = startWatch(root);
    let exitCode = -1;

    try {
      await harness.awaitReady("config-change ready");
      const initial = harness.events.filter((event) => event.type === "build");
      expect(initial).toHaveLength(1);
      expect(await readText(join(root, "generated/styles/button.css"))).toContain(
        "min-width: 768px",
      );

      const configPath = join(root, "xessa.config.json");
      const config = JSON.parse((await readText(configPath)) ?? "{}") as {
        media?: Record<string, string>;
      };
      config.media = { ...(config.media ?? {}), md: "(min-width: 900px)" };
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

      const rebuild = await harness.nextBuild("config rebuild");
      expect(rebuild.entries).toHaveLength(2);
      expect(rebuild.success).toBe(true);
      expect(await readText(join(root, "generated/styles/button.css"))).toContain(
        "min-width: 900px",
      );
    } finally {
      exitCode = await harness.stop();
    }

    expect(exitCode).toBe(0);
  }, 30_000);

  test("removes owned outputs after a watched source is deleted", async () => {
    const root = await createWatchProject();
    temporaryProjects.push(root);
    const harness = startWatch(root);
    let exitCode = -1;

    try {
      await harness.awaitReady("delete ready");
      expect(await exists(join(root, "generated/styles/card.css"))).toBe(true);

      await rm(join(root, "src/card.cssx"));
      const rebuild = await harness.nextBuild("deletion rebuild");
      expect(rebuild.entries).toHaveLength(1);
      expect(rebuild.entries[0]?.file).toBe("src/button.cssx");
      expect(rebuild.success).toBe(true);

      expect(await exists(join(root, "generated/styles/card.css"))).toBe(false);
      expect(await exists(join(root, "generated/maps/card.map.js"))).toBe(false);
      expect(await exists(join(root, "generated/styles/button.css"))).toBe(true);
    } finally {
      exitCode = await harness.stop();
    }

    expect(exitCode).toBe(0);
  }, 30_000);

  test("rebuilds and reports every css-dir list destination", async () => {
    const root = await createTempDirectory("xessa-watch-list-");
    temporaryProjects.push(root);
    await writeText(
      join(root, "xessa.config.json"),
      `${JSON.stringify({ include: ["src/*.cssx"] }, null, 2)}\n`,
    );
    const setup = [
      "@setup {",
      '  css-dir: "../client", "../src";',
      '  css-name: "app.css";',
      '  map-dir: "../maps";',
      '  map-name: "app.map.js";',
      "}",
    ].join("\n");
    const sourcePath = join(root, "src/app.cssx");
    await writeText(sourcePath, `${setup}\n.app { color: red; }\n`);

    const harness = startWatch(root);
    let exitCode = -1;

    try {
      await harness.awaitReady("list ready");
      const initial = harness.events.filter((event) => event.type === "build");
      expect(initial).toHaveLength(1);
      expect(
        (initial[0] as BuildLine).entries[0]?.outputs.map((output) => output.path).sort(),
      ).toEqual(["client/app.css", "maps/app.map.js", "src/app.css"]);

      const before = await readText(join(root, "client/app.css"));
      expect(before).toContain("color:red");

      await writeFile(sourcePath, `${setup}\n.app { color: blue; }\n`, "utf8");
      const rebuild = await harness.nextBuild("list rebuild");
      expect(rebuild.entries).toHaveLength(1);
      expect(rebuild.success).toBe(true);
      expect(rebuild.entries[0]?.outputs).toHaveLength(3);
      expect(rebuild.entries[0]?.outputs.every((output) => output.written)).toBe(true);

      expect(await readText(join(root, "client/app.css"))).toContain("color:blue");
      expect(await readText(join(root, "src/app.css"))).toContain("color:blue");
    } finally {
      exitCode = await harness.stop();
    }

    expect(exitCode).toBe(0);
  }, 30_000);
});

/** Write a self-contained project into a fresh temp directory. */
async function createWatchProject(): Promise<string> {
  const root = await createTempDirectory("xessa-watch-");
  const setup = (cssName: string, mapName: string): string =>
    [
      "@setup {",
      '  prefix: "ui";',
      '  css-dir: "../generated/styles";',
      `  css-name: "${cssName}";`,
      '  map-dir: "../generated/maps";',
      `  map-name: "${mapName}";`,
      "}",
    ].join("\n");

  await writeText(
    join(root, "xessa.config.json"),
    `${JSON.stringify(
      {
        include: ["src/*.cssx"],
        compiler: { strict: true, mediaGrouping: "safe" },
      },
      null,
      2,
    )}\n`,
  );
  await writeText(
    join(root, "src/tokens/theme.cssx"),
    "@variables {\n  spacing: 12px;\n  radius: 8px;\n}\n",
  );
  await writeText(
    join(root, "src/button.cssx"),
    `${setup("button.css", "button.map.js")}\n@use "./tokens/theme.cssx" as theme;\n.button {\n  display: flex;\n  padding: $theme.spacing @md 16px;\n}\n`,
  );
  await writeText(
    join(root, "src/card.cssx"),
    `${setup("card.css", "card.map.js")}\n@use "./tokens/theme.cssx" as theme;\n.card {\n  padding: $theme.spacing;\n}\n`,
  );
  return root;
}

/** Probe whether this environment delivers non-recursive filesystem events. */
async function supportsFsEvents(): Promise<boolean> {
  const directory = await createTempDirectory("xessa-fs-events-");
  try {
    let seen = false;
    const watcher = watch(directory, () => {
      seen = true;
    });
    try {
      const deadline = Date.now() + 5_000;
      // Re-write until an event arrives; the probe tolerates slow or delayed
      // delivery under load instead of silently skipping real coverage.
      while (!seen && Date.now() < deadline) {
        await writeFile(join(directory, "probe.txt"), `probe ${Date.now()}`);
        for (let wait = 0; wait < 8 && !seen; wait += 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
      return seen;
    } finally {
      watcher.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
