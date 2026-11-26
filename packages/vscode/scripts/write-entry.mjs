/**
 * Writes the extension-host entry shim.
 *
 * `bun build` bundles `src/extension.ts` (and the compiler sources it imports
 * from the public barrel) into the single CommonJS file `dist/extension.js`,
 * with `vscode` kept external. VS Code is pointed at `out/extension.js`
 * (manifest `main`), which re-exports that bundle. `dist/` is used for the
 * bundle because the repository-root Biome configuration (owned outside this
 * package) ignores `dist` but not `out`, and `bun run verify` must stay
 * repeatable. A15/packaging may replace this shim with a directly bundled
 * entry.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
mkdirSync(join(root, "out"), { recursive: true });
writeFileSync(
  join(root, "out", "extension.js"),
  'module.exports = require("../dist/extension.js");\n',
  "utf8",
);
