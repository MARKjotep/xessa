/**
 * Fixture text shared by the workspace-state probes.
 *
 * Deliberately `vscode`-free: the probe driver (Bun, outside the host) uses it
 * to build the temporary workspace trees, and the in-host suites use the same
 * strings to assert against. Keeping one copy means a probe cannot pass against
 * a tree it did not launch.
 *
 * No `.cssx` fixture is committed for these cases: the trees are created under
 * `mkdtemp` and removed in the driver's `finally` (the plan's temp-workspace
 * rule), and their generated artifacts must never land in the repository.
 */

/** Restricted-Mode workspace: three Xessa documents, no config, no project. */
const RESTRICTED_FILES = Object.freeze({
  "entry.cssx": '@setup { prefix: "restricted"; }\n.button { color: red; }\n',
  "second.cssx": '@setup { prefix: "restricted"; }\n.card { padding: 4px; }\n',
  "broken.cssx": '@setup { prefix: "restricted"; }\n.card {\n  color: red\n  padding: 4px;\n}\n',
});

/**
 * Two-root workspace.
 *
 * `root-a` carries a project config whose class prefix is `alpha`; `root-b` has
 * no config at all, so its document's own `@setup` prefix (`beta`) is the only
 * one in play. `notes.md` gives the language-scoping assertion a non-Xessa
 * document inside a Xessa-adjacent root.
 */
const MULTI_ROOT = Object.freeze({
  workspaceFile: "xessa-two-roots.code-workspace",
  workspaceText: `${JSON.stringify(
    {
      folders: [
        { path: "./root-a", name: "root-a" },
        { path: "./root-b", name: "root-b" },
      ],
    },
    null,
    2,
  )}\n`,
  files: Object.freeze({
    "root-a/xessa.config.json": `${JSON.stringify(
      {
        include: ["**/*.cssx"],
        exclude: ["generated"],
        classes: { strategy: "prefix", prefix: "alpha" },
      },
      null,
      2,
    )}\n`,
    "root-a/entry.cssx": ".button {\n  color: red;\n  padding: 4px;\n}\n",
    "root-a/second.cssx": ".card {\n  padding: 8px;\n}\n",
    "root-a/broken.cssx": ".broken {\n  color: red\n  padding: 4px;\n}\n",
    "root-b/beta.cssx": '@setup { prefix: "beta"; }\n.tile { color: red; }\n',
    "root-b/notes.md": "# Root B\n\nNot a Xessa document.\n",
  }),
});

module.exports = { MULTI_ROOT, RESTRICTED_FILES };
