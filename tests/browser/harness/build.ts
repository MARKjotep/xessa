/**
 * Compile browser-test scenarios into real CSS and generated HTML pages.
 *
 * Import path: the compiler is imported through its public barrel source file
 * `packages/compiler/src/index.ts` (the `@xessa/compiler` package `exports`
 * field points at the unbuilt `dist/index.js`, and this repository does not
 * build `dist/` before browser tests). Only the public `compile` entry point is
 * used; the harness never hand-writes CSS.
 *
 * Outputs (all removed and regenerated per run, deterministic):
 *
 *   tests/browser/dist/css/<scenario>.css             pretty, safe grouping
 *   tests/browser/dist/css/<scenario>.min.css         minified, safe grouping
 *   tests/browser/dist/css/<scenario>.nogroup.css     pretty, mediaGrouping: "none"
 *   tests/browser/dist/css/<scenario>.merge.css       pretty, mediaGrouping: "merge"
 *   tests/browser/dist/pages/<scenario>.html          page linking the pretty CSS
 *   tests/browser/dist/pages/<scenario>.min.html      page linking the minified CSS
 *   tests/browser/dist/pages/<scenario>.nogroup.html  page linking the ungrouped CSS
 *   tests/browser/dist/pages/<scenario>.merge.html    page linking the merged CSS
 *   tests/browser/dist/manifest.json                  scenario/artifact manifest
 *
 * The build fails on any compiler diagnostic or empty artifact. It never
 * pretends a scenario compiled.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "../../../packages/compiler/src/index.ts";
import type { CompileResult } from "../../../packages/compiler/src/index.ts";
import { type BrowserScenario, type PageVariant, SCENARIOS } from "./scenarios.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const browserRoot = join(repoRoot, "tests", "browser");
const distRoot = join(browserRoot, "dist");
const cssRoot = join(distRoot, "css");
const pagesRoot = join(distRoot, "pages");

interface ArtifactRecord {
  readonly file: string;
  readonly bytes: number;
}

interface ScenarioManifest {
  readonly name: string;
  readonly description: string;
  readonly sourceFile: string;
  readonly css: Record<PageVariant, ArtifactRecord>;
  readonly pages: Record<PageVariant, ArtifactRecord>;
  readonly classes: Record<string, string>;
}

interface BuildManifest {
  readonly compiler: {
    readonly package: string;
    readonly entry: string;
    readonly importPath: string;
  };
  readonly scenarios: readonly ScenarioManifest[];
}

function fail(message: string): never {
  throw new Error(message);
}

function assertResult(
  scenario: BrowserScenario,
  variant: PageVariant,
  result: CompileResult,
): string {
  if (result.diagnostics.length > 0) {
    fail(
      `Scenario "${scenario.name}" (${variant}) produced diagnostics:\n${JSON.stringify(
        result.diagnostics,
        null,
        2,
      )}`,
    );
  }
  if (result.css === undefined || result.css.trim().length === 0) {
    fail(`Scenario "${scenario.name}" (${variant}) produced no CSS.`);
  }
  return result.css;
}

function renderBody(scenario: BrowserScenario, classes: Record<string, string>): string {
  return scenario.html.replace(/\{\{([A-Za-z0-9_-]+)\}\}/g, (_match, key: string) => {
    const emitted = classes[key];
    if (emitted === undefined) {
      fail(
        `Scenario "${scenario.name}" template references class "${key}", but the compiler emitted only ${JSON.stringify(
          classes,
        )}.`,
      );
    }
    return emitted;
  });
}

function renderPage(
  scenario: BrowserScenario,
  variant: PageVariant,
  cssFile: string,
  classes: Record<string, string>,
): string {
  const body = renderBody(scenario, classes);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Xessa browser test: ${scenario.name} (${variant})</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="../css/${cssFile}">
</head>
<body data-scenario="${scenario.name}" data-variant="${variant}">
${body}
</body>
</html>
`;
}

function writeArtifact(path: string, content: string): ArtifactRecord {
  writeFileSync(path, content, "utf8");
  return {
    file: relative(repoRoot, path).split("\\").join("/"),
    bytes: Buffer.byteLength(content),
  };
}

async function build(): Promise<void> {
  rmSync(distRoot, { recursive: true, force: true });
  mkdirSync(cssRoot, { recursive: true });
  mkdirSync(pagesRoot, { recursive: true });

  const records: ScenarioManifest[] = [];

  for (const scenario of SCENARIOS) {
    const sourceFile = `tests/browser/scenarios/${scenario.name}.cssx`;
    const pretty = await compile(scenario.source, {
      file: sourceFile,
      workspaceRoot: repoRoot,
    });
    const minified = await compile(scenario.source, {
      file: sourceFile,
      workspaceRoot: repoRoot,
      minify: true,
    });
    const nogroup = await compile(scenario.source, {
      file: sourceFile,
      workspaceRoot: repoRoot,
      mediaGrouping: "none",
    });
    const merge = await compile(scenario.source, {
      file: sourceFile,
      workspaceRoot: repoRoot,
      mediaGrouping: "merge",
    });

    const prettyCss = assertResult(scenario, "pretty", pretty);
    const minifiedCss = assertResult(scenario, "minified", minified);
    const nogroupCss = assertResult(scenario, "nogroup", nogroup);
    const mergeCss = assertResult(scenario, "merge", merge);
    const classes: Record<string, string> = { ...pretty.classes };

    for (const [variant, result] of [
      ["minified", minified],
      ["nogroup", nogroup],
      ["merge", merge],
    ] as const) {
      const variantClasses: Record<string, string> = { ...result.classes };
      if (JSON.stringify(classes) !== JSON.stringify(variantClasses)) {
        fail(
          `Scenario "${scenario.name}" class map changed under ${variant}: ${JSON.stringify(
            classes,
          )} vs ${JSON.stringify(variantClasses)}.`,
        );
      }
    }

    const cssRecords = {
      pretty: writeArtifact(join(cssRoot, `${scenario.name}.css`), prettyCss),
      minified: writeArtifact(join(cssRoot, `${scenario.name}.min.css`), minifiedCss),
      nogroup: writeArtifact(join(cssRoot, `${scenario.name}.nogroup.css`), nogroupCss),
      merge: writeArtifact(join(cssRoot, `${scenario.name}.merge.css`), mergeCss),
    } satisfies Record<PageVariant, ArtifactRecord>;

    const pageRecords = {
      pretty: writeArtifact(
        join(pagesRoot, `${scenario.name}.html`),
        renderPage(scenario, "pretty", `${scenario.name}.css`, classes),
      ),
      minified: writeArtifact(
        join(pagesRoot, `${scenario.name}.min.html`),
        renderPage(scenario, "minified", `${scenario.name}.min.css`, classes),
      ),
      nogroup: writeArtifact(
        join(pagesRoot, `${scenario.name}.nogroup.html`),
        renderPage(scenario, "nogroup", `${scenario.name}.nogroup.css`, classes),
      ),
      merge: writeArtifact(
        join(pagesRoot, `${scenario.name}.merge.html`),
        renderPage(scenario, "merge", `${scenario.name}.merge.css`, classes),
      ),
    } satisfies Record<PageVariant, ArtifactRecord>;

    records.push({
      name: scenario.name,
      description: scenario.description,
      sourceFile,
      css: cssRecords,
      pages: pageRecords,
      classes,
    });

    console.log(
      `[browser-harness] ${scenario.name}: ${cssRecords.pretty.bytes}B pretty, ${cssRecords.minified.bytes}B minified, ${cssRecords.nogroup.bytes}B ungrouped, ${cssRecords.merge.bytes}B merged`,
    );
  }

  const manifest: BuildManifest = {
    compiler: {
      package: "@xessa/compiler",
      entry: "packages/compiler/src/index.ts",
      importPath: "../../../packages/compiler/src/index.ts",
    },
    scenarios: records,
  };
  writeFileSync(join(distRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(
    `[browser-harness] compiled ${records.length} scenarios (${records.length * 4} CSS files, ${records.length * 4} pages) into ${relative(repoRoot, distRoot)}`,
  );
}

await build();
