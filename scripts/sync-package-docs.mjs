#!/usr/bin/env node
/**
 * Copy the repository's language contract into the compiler package.
 *
 * npm and VS Code users cannot follow repository-relative links, so the
 * published `@xessa/compiler` tarball ships `SPECIFICATION.md` and `docs/`.
 * This script is invoked by the package's `prepack` lifecycle (and by
 * `bun run sync:docs`), so the copies never drift from the repository source.
 *
 * Paths resolve from this file, not the working directory. The generated
 * copies are gitignored and must not be committed.
 */

import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const sourceSpecification = join(repositoryRoot, "SPECIFICATION.md");
const sourceDocs = join(repositoryRoot, "docs");
const destinationRoot = join(repositoryRoot, "packages", "compiler");
const destinationSpecification = join(destinationRoot, "SPECIFICATION.md");
const destinationDocs = join(destinationRoot, "docs");

/** OS metadata files that must never be shipped. */
function isJunk(name) {
  return (
    name === ".DS_Store" || name === "Thumbs.db" || name === "desktop.ini" || name.startsWith("._")
  );
}

let copied = 0;

async function copyTree(source, destination) {
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (isJunk(entry.name)) continue;
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyTree(from, to);
      continue;
    }
    if (!entry.isFile()) continue;
    await copyFile(from, to);
    copied += 1;
  }
}

async function main() {
  const specification = await stat(sourceSpecification).catch(() => null);
  if (specification === null || !specification.isFile()) {
    throw new Error(`Missing ${relative(repositoryRoot, sourceSpecification)}.`);
  }
  const docs = await stat(sourceDocs).catch(() => null);
  if (docs === null || !docs.isDirectory()) {
    throw new Error(`Missing ${relative(repositoryRoot, sourceDocs)}/.`);
  }

  await rm(destinationSpecification, { force: true });
  await rm(destinationDocs, { recursive: true, force: true });

  await copyFile(sourceSpecification, destinationSpecification);
  copied += 1;
  await copyTree(sourceDocs, destinationDocs);

  const destinationLabel = `${relative(repositoryRoot, destinationRoot).split(sep).join("/")}/`;
  // Keep stdout clean: `npm pack --json` writes the manifest there.
  process.stderr.write(
    `synced ${copied} file${copied === 1 ? "" : "s"} from SPECIFICATION.md and docs/ to ${destinationLabel}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `sync-package-docs: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
