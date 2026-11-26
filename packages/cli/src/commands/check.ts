/**
 * `xessa check` — diagnostics only.
 *
 * Check compiles and plans every entry exactly like a build but never writes an
 * artifact or touches the manifest. Exit code 1 means at least one error
 * diagnostic (including output-planning errors); 0 means clean or warnings only.
 */

import type { CliInvocation } from "../args.js";
import { prepareProject } from "../project.js";
import { invocationFailure } from "../report.js";
import { emitReport, executeBuild, reportExitCode } from "./build.js";

/** Run `xessa check [file]`. */
export async function runCheck(invocation: CliInvocation, cwd: string): Promise<number> {
  const prepared = await prepareProject(invocation, cwd);
  if (!prepared.ok) return invocationFailure(invocation.command, prepared.message, invocation.json);
  if (!prepared.context.singleEntry && prepared.context.entries.length === 0) {
    return invocationFailure(
      invocation.command,
      "No .cssx sources matched the project include globs.",
      invocation.json,
    );
  }

  let outcome: Awaited<ReturnType<typeof executeBuild>>;
  try {
    outcome = await executeBuild({
      context: prepared.context,
      write: false,
      dryRun: false,
      prune: false,
      ...(invocation.minify === undefined ? {} : { minify: invocation.minify }),
    });
  } catch (error) {
    return invocationFailure(
      invocation.command,
      error instanceof Error ? error.message : String(error),
      invocation.json,
    );
  }

  emitReport(outcome.report, invocation.json);
  return reportExitCode(outcome.report);
}
