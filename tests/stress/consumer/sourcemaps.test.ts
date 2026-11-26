/**
 * TT5 row 6 — source-map position spot-check at three scales.
 *
 * | Assertion | How |
 * |---|---|
 * | `source-map: true` writes a v3 map with declaration-level mappings | the 1000-file scale corpus is compiled with `sourceMap: true` at 1, 100 and 1000 entries; each inspected map is decoded by the hand-rolled VLQ decoder in `decode.ts` (no compiler encoder involved) |
 * | generated → original positions are right | hand-picked emitted declarations (`display`, base `padding`, the `@md` variant `padding`, `color`, `opacity`, `width`) are located in the emitted CSS and must map to the authored property positions, and the top-level selector must map to the run's first declaration span |
 * | the map is self-contained | `sources` is the workspace-relative authored path, `sourcesContent` equals the authored source byte for byte, and the trailing `sourceMappingURL` comment names the written map |
 * | the mappings stay inside their artifacts | every decoded segment points at a real generated line/column and a valid source index, checked for all 1000 entries at the largest scale |
 *
 * Pinned behavior (matches `tests/compiler/sourcemap.test.ts` at unit scale): a rule
 * selector maps to its declaration run's origin rather than to the selector text, and an
 * inline variant maps to its modifier (`@md`) origin. Both are asserted here at scale.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { compileProject } from "../../../packages/compiler/dist/index.js";
import { createLabelledRng, readStressSeed } from "../prng.ts";
import {
  type ScaleProject,
  cleanupTempProjects,
  createMemoryHost,
  projectOutputOptions,
  thousandFileProject,
} from "../scale/generate.ts";
import {
  type DecodedSegment,
  type DecodedSourceMap,
  generatedLineLength,
  parseSourceMap,
  segmentAt,
  zeroBasedPosition,
} from "./decode.ts";
import { ensureDistBuild } from "./helpers.ts";

/** Scales named by the plan: one file, one hundred files, the full thousand. */
const SCALES: readonly number[] = Object.freeze([1, 100, 1000]);

/** One compiled entry as this suite reads it. */
interface CompiledEntry {
  readonly css?: string;
  readonly sourceMap?: string;
  readonly diagnostics: readonly { readonly severity: string }[];
}

let project: ScaleProject;
/** Compiled results per scale, keyed by entry path. */
const compilations = new Map<number, Record<string, CompiledEntry>>();

/** Compile exactly the first `count` entries of the generated project. */
async function compileScale(count: number): Promise<Record<string, CompiledEntry>> {
  return compileProject(project.entries.slice(0, count), createMemoryHost(project.files), {
    projectRoot: "/workspace",
    output: { ...projectOutputOptions(), sourceMap: true },
    mediaGrouping: "safe",
  });
}

/** One expectation about a decoded position, resolved against the emitted CSS. */
interface PositionCheck {
  /** How the case is labelled in a failure. */
  readonly label: string;
  /** Needle in the emitted CSS whose start position must carry a mapping. */
  readonly generated: { readonly needle: string; readonly from?: number };
  /** Needle in the authored source the mapping must point at. */
  readonly authored: { readonly needle: string; readonly from?: number };
}

/** The hand-picked declarations every inspected file must map correctly. */
function positionChecks(index: number, css: string): PositionCheck[] {
  const name = String(index).padStart(4, "0");
  const mediaIndex = css.indexOf("@media");
  const firstPadding = css.indexOf("padding:");
  return [
    { label: "display", generated: { needle: "display:" }, authored: { needle: "display:" } },
    { label: "padding", generated: { needle: "padding:" }, authored: { needle: "padding:" } },
    {
      label: "media selector",
      generated: { needle: `.card-${name}`, from: mediaIndex },
      authored: { needle: "@md" },
    },
    {
      label: "media padding",
      generated: { needle: "padding:", from: firstPadding + 1 },
      authored: { needle: "@md" },
    },
    { label: "color", generated: { needle: "color:" }, authored: { needle: "color:" } },
    { label: "opacity", generated: { needle: "opacity:" }, authored: { needle: "opacity:" } },
    // `width: 16px` rather than `width:`: the latter would match the `@media (min-width: …)` prelude.
    { label: "width", generated: { needle: "width: 16px" }, authored: { needle: "width: 16px" } },
  ];
}

/** Compare one mapping against one authored position, returning a failure text if any. */
function checkPosition(
  entry: string,
  css: string,
  map: DecodedSourceMap,
  segments: readonly DecodedSegment[],
  check: PositionCheck,
): string[] {
  const generated = zeroBasedPosition(css, check.generated.needle, check.generated.from ?? 0);
  const authored = zeroBasedPosition(
    referenceSource(entry),
    check.authored.needle,
    check.authored.from ?? 0,
  );
  const segment = segmentAt(segments, generated);
  if (segment === undefined) {
    return [
      `${entry} ${check.label}: no mapping at generated ${generated.line}:${generated.column}`,
    ];
  }
  const failures: string[] = [];
  if (map.sources[segment.sourceIndex] !== entry) {
    failures.push(
      `${entry} ${check.label}: source index ${segment.sourceIndex} is ${String(
        map.sources[segment.sourceIndex],
      )}, expected ${entry}`,
    );
  }
  if (segment.sourceLine !== authored.line || segment.sourceColumn !== authored.column) {
    failures.push(
      `${entry} ${check.label}: maps to ${segment.sourceLine}:${segment.sourceColumn}, ` +
        `expected ${authored.line}:${authored.column} (authored "${check.authored.needle}")`,
    );
  }
  return failures;
}

/** Authored source text of one entry. */
function referenceSource(entry: string): string {
  return project.files[entry] ?? "";
}

beforeAll(async () => {
  await ensureDistBuild();
  const rng = createLabelledRng(readStressSeed(), "consumer/sourcemaps");
  project = thousandFileProject(rng);
  for (const scale of SCALES) compilations.set(scale, await compileScale(scale));
});

afterAll(() => {
  cleanupTempProjects();
});

describe("source-map positions at 1, 100 and 1000 files", () => {
  for (const scale of SCALES) {
    test(`scale ${scale}: hand-picked declarations map to authored positions`, () => {
      const results = compilations.get(scale) ?? {};
      expect(Object.keys(results).length).toBe(scale);
      const failures: string[] = [];

      // Inspect the first and last entry of every scale so the boundary files count.
      for (const index of new Set([0, scale - 1])) {
        const entry = project.entries[index] ?? "";
        const result = results[entry];
        if (result === undefined) {
          failures.push(`${entry}: missing from the compilation`);
          continue;
        }
        const css = result.css ?? "";
        const mapText = result.sourceMap ?? "";
        if (mapText.length === 0) {
          failures.push(`${entry}: no source map emitted`);
          continue;
        }
        const map = parseSourceMap(mapText);
        const expectedMapName = `${entry.replace(/^src\//u, "").replace(/\.cssx$/u, "")}.css.map`;
        if (!css.endsWith(`/*# sourceMappingURL=${expectedMapName} */\n`)) {
          failures.push(`${entry}: sourceMappingURL comment does not name ${expectedMapName}`);
        }
        if (map.version !== 3) failures.push(`${entry}: map version ${map.version}`);
        if (map.sources.length !== 1 || map.sources[0] !== entry) {
          failures.push(`${entry}: sources ${JSON.stringify(map.sources)}`);
        }
        if ((map.sourcesContent ?? [])[0] !== referenceSource(entry)) {
          failures.push(`${entry}: sourcesContent does not equal the authored source`);
        }
        if (map.segments.length === 0) failures.push(`${entry}: empty mappings`);
        // The top-level selector maps to the run's first declaration span.
        const selectorSegment = segmentAt(map.segments, { line: 0, column: 0 });
        const display = zeroBasedPosition(referenceSource(entry), "display:");
        if (selectorSegment === undefined) {
          failures.push(`${entry}: no mapping at the first selector`);
        } else if (
          selectorSegment.sourceLine !== display.line ||
          selectorSegment.sourceColumn !== display.column
        ) {
          failures.push(
            `${entry}: selector maps to ${selectorSegment.sourceLine}:${selectorSegment.sourceColumn}, ` +
              `expected the first declaration span ${display.line}:${display.column}`,
          );
        }
        for (const check of positionChecks(index, css)) {
          failures.push(...checkPosition(entry, css, map, map.segments, check));
        }
      }

      expect(failures).toEqual([]);
    });
  }

  test("scale 1000: every emitted declaration maps inside its own artifacts", () => {
    const results = compilations.get(1000) ?? {};
    const failures: string[] = [];
    let segments = 0;
    let entries = 0;

    for (const entry of project.entries) {
      const result = results[entry];
      if (result === undefined) {
        failures.push(`${entry}: missing from the compilation`);
        continue;
      }
      const css = result.css ?? "";
      const map = parseSourceMap(result.sourceMap ?? "{}");
      const lineCount = css.split("\n").length;
      segments += map.segments.length;
      entries += 1;
      for (const segment of map.segments) {
        if (segment.sourceIndex < 0 || segment.sourceIndex >= map.sources.length) {
          failures.push(`${entry}: segment source index ${segment.sourceIndex} out of range`);
          break;
        }
        if (segment.sourceLine < 0 || segment.sourceColumn < 0) {
          failures.push(
            `${entry}: negative source position ${segment.sourceLine}:${segment.sourceColumn}`,
          );
          break;
        }
        if (segment.generatedLine < 0 || segment.generatedLine >= lineCount) {
          failures.push(`${entry}: generated line ${segment.generatedLine} beyond ${lineCount}`);
          break;
        }
        if (segment.generatedColumn > generatedLineLength(css, segment.generatedLine)) {
          failures.push(
            `${entry}: generated column ${segment.generatedColumn} beyond line ` +
              `${segment.generatedLine} (${generatedLineLength(css, segment.generatedLine)} chars)`,
          );
          break;
        }
      }
      // Spot-check the two declarations every generated file carries.
      const authoredDisplay = zeroBasedPosition(referenceSource(entry), "display:");
      const displaySegment = segmentAt(map.segments, zeroBasedPosition(css, "display:"));
      if (
        displaySegment === undefined ||
        displaySegment.sourceLine !== authoredDisplay.line ||
        displaySegment.sourceColumn !== authoredDisplay.column
      ) {
        failures.push(`${entry}: display mapping is not at the authored property`);
      }
    }

    expect(failures).toEqual([]);
    expect(entries).toBe(project.entries.length);
    // One mapping for the rule selector and one per declaration, per emitted rule.
    expect(segments).toBeGreaterThan(project.entries.length * 5);
  });
});
