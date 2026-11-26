/**
 * Command-line argument parsing for `xessa`.
 *
 * Parsing is strict: unknown flags, missing flag values, extra positional
 * arguments and a missing command all fail with exit code 2 (invocation error).
 * `--help` and `--version` short-circuit every other rule.
 */

/** Commands the CLI dispatches. */
export type CommandName = "build" | "check" | "watch" | "clean" | "format" | "help";

/** Parsed CLI invocation. */
export interface CliInvocation {
  /** Selected command; `help` when only `--help`/`--version` was requested. */
  readonly command: CommandName;
  /** Optional source file for single-entry build/check/watch. */
  readonly file?: string;
  /** Explicit `--config` path, absolute or relative to the working directory. */
  readonly configPath?: string;
  /** Emit machine-readable JSON (build/check/clean) or NDJSON (watch). */
  readonly json: boolean;
  /** Report planned work without writing or deleting. */
  readonly dryRun: boolean;
  /** `true` for `--minify`, `false` for `--no-minify`, `undefined` when unset. */
  readonly minify?: boolean;
  /** `true` for `--check`: report files that `format` would change, write nothing. */
  readonly check?: boolean;
}

/** Parse outcome for {@link parseArgs}. */
export type ParseOutcome =
  | {
      readonly ok: true;
      readonly invocation: CliInvocation;
      readonly help: boolean;
      readonly version: boolean;
    }
  | {
      readonly ok: false;
      readonly message: string;
      /** Whether `--json` was seen before the failure, so callers can emit JSON. */
      readonly json: boolean;
    };

/** Usage text written by `--help`. */
export const USAGE = `xessa — compile Xessa stylesheets

Usage:
  xessa build [file] [flags]
  xessa check [file] [flags]
  xessa watch [file] [flags]
  xessa clean [flags]
  xessa format [file] [flags]
  xessa --help
  xessa --version

Commands:
  build    Compile the project (config include globs) or one file and write outputs
  check    Report diagnostics and planned outputs without writing anything
  watch    Rebuild changed entries until interrupted
  clean    Delete compiler-owned outputs that were not modified since generation
  format   Format sources canonically (with --check to report without writing)

Flags:
  --config <path>   Use a specific xessa.config.json instead of the nearest one
  --json            Print machine-readable results
  --dry-run         Report planned work without writing files or deleting them
  --minify          Emit compact CSS
  --no-minify       Emit expanded CSS
  --check           With format: list files that would change; write nothing
  -h, --help        Show this help
  -v, --version     Print the CLI version

Exit codes:
  0  success
  1  compile, validation or formatting errors (or --check found changes)
  2  invocation or configuration errors
`;

const COMMANDS: ReadonlySet<string> = new Set([
  "build",
  "check",
  "watch",
  "clean",
  "format",
  "help",
]);

const VALUE_FLAGS: ReadonlySet<string> = new Set(["--config"]);

/** Parse process arguments (without `node`/script) into an invocation. */
export function parseArgs(argv: readonly string[]): ParseOutcome {
  let command: CommandName | undefined;
  const positionals: string[] = [];
  let configPath: string | undefined;
  let json = false;
  let dryRun = false;
  let minify: boolean | undefined;
  let check = false;
  let help = false;
  let version = false;
  let flagsEnded = false;
  let index = 0;

  while (index < argv.length) {
    const raw = argv[index];
    index += 1;
    if (raw === undefined) break;

    if (!flagsEnded && raw === "--") {
      flagsEnded = true;
      continue;
    }

    if (!flagsEnded && raw.startsWith("-") && raw !== "-") {
      const equals = raw.indexOf("=");
      const name = equals < 0 ? raw : raw.slice(0, equals);
      const inlineValue = equals < 0 ? undefined : raw.slice(equals + 1);

      if (name === "-h" || name === "--help") {
        help = true;
        continue;
      }
      if (name === "-v" || name === "--version") {
        version = true;
        continue;
      }
      if (name === "--json") {
        if (inlineValue !== undefined) return fail("--json does not take a value.", json);
        json = true;
        continue;
      }
      if (name === "--dry-run") {
        if (inlineValue !== undefined) return fail("--dry-run does not take a value.", json);
        dryRun = true;
        continue;
      }
      if (name === "--minify") {
        if (inlineValue !== undefined) return fail("--minify does not take a value.", json);
        minify = true;
        continue;
      }
      if (name === "--no-minify") {
        if (inlineValue !== undefined) return fail("--no-minify does not take a value.", json);
        minify = false;
        continue;
      }
      if (name === "--check") {
        if (inlineValue !== undefined) return fail("--check does not take a value.", json);
        check = true;
        continue;
      }
      if (VALUE_FLAGS.has(name)) {
        // A value flag never consumes another option as its value: `--config
        // --json` is a missing path, not a configuration named `--json`. A bare
        // `-` is a legal value (standard input / literal dash).
        if (inlineValue === undefined) {
          const next = argv[index];
          if (next === undefined || next === "" || (next.startsWith("-") && next !== "-")) {
            return fail(`${name} requires a path.`, json);
          }
          index += 1;
          if (name === "--config") {
            if (configPath !== undefined) return fail("--config may be given only once.", json);
            configPath = next;
          }
          continue;
        }
        if (inlineValue === "") return fail(`${name} requires a path.`, json);
        if (name === "--config") {
          if (configPath !== undefined) return fail("--config may be given only once.", json);
          configPath = inlineValue;
        }
        continue;
      }
      return fail(`Unknown option "${raw}".`, json);
    }

    if (command === undefined) {
      if (!COMMANDS.has(raw)) return fail(`Unknown command "${raw}".`, json);
      command = raw as CommandName;
      continue;
    }
    positionals.push(raw);
  }

  if (help || version) {
    return {
      ok: true,
      invocation: {
        command: "help",
        ...(configPath === undefined ? {} : { configPath }),
        json,
        dryRun,
        ...(minify === undefined ? {} : { minify }),
        ...(check ? { check: true } : {}),
      },
      help,
      version,
    };
  }

  if (command === undefined) {
    return fail("Missing command. Run xessa --help for usage.", json);
  }

  if (check && command !== "format") {
    return fail("--check is only valid for xessa format.", json);
  }

  // `check` never writes, so `--dry-run` cannot change its behaviour; accepting
  // it silently made the JSON report contradict the invocation (CSSX-T12).
  if (dryRun && command === "check") {
    return fail("--dry-run is not valid for xessa check.", json);
  }

  const maxPositionals = command === "clean" ? 0 : 1;
  if (positionals.length > maxPositionals) {
    return fail(
      maxPositionals === 0
        ? `xessa ${command} does not take a file argument.`
        : `xessa ${command} accepts at most one file argument.`,
      json,
    );
  }

  const file = positionals[0];
  return {
    ok: true,
    invocation: {
      command,
      ...(file === undefined ? {} : { file }),
      ...(configPath === undefined ? {} : { configPath }),
      json,
      dryRun,
      ...(minify === undefined ? {} : { minify }),
      ...(check ? { check: true } : {}),
    },
    help: false,
    version: false,
  };
}

function fail(message: string, json: boolean): ParseOutcome {
  return { ok: false, message, json };
}
