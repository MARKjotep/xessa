/**
 * Lexical path and CSS string utilities for the resolver.
 *
 * The compiler never touches the filesystem: every path is an absolute POSIX
 * path supplied by the {@link ModuleHost}, and these helpers only normalize or
 * compare strings. No `node:path` import keeps the core platform-independent
 * and bundled-host friendly.
 */

/**
 * Normalize a path to forward slashes and collapse `.`/`..` segments lexically.
 *
 * Absolute paths keep a single leading slash; relative paths keep leading
 * `..` segments. A Windows drive prefix such as `C:` is treated as an ordinary
 * first segment because hosts already convert platform separators at their
 * boundary.
 */
export function normalizePosixPath(path: string): string {
  const slashed = path.replace(/\\/g, "/");
  const absolute = slashed.startsWith("/");
  const segments: string[] = [];

  for (const segment of slashed.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      const last = segments[segments.length - 1];
      if (last !== undefined && last !== "..") segments.pop();
      else if (!absolute) segments.push("..");
      continue;
    }
    segments.push(segment);
  }

  const body = segments.join("/");
  if (absolute) return body === "" ? "/" : `/${body}`;
  return body === "" ? "." : body;
}

/**
 * Whether `target` lies inside `root`, including the root itself.
 *
 * Comparison is lexical and case-sensitive: host implementations own symlink
 * and case policy through {@link ModuleHost.canonicalize}. Both arguments are
 * normalized first, so trailing separators and `..` segments do not affect the
 * result.
 */
export function isWithinWorkspace(root: string, target: string): boolean {
  const base = trimTrailingSlash(normalizePosixPath(root));
  const candidate = normalizePosixPath(target);
  if (base === "/") return candidate.startsWith("/");
  return candidate === base || candidate.startsWith(`${base}/`);
}

function trimTrailingSlash(path: string): string {
  if (path === "/") return path;
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

/**
 * Decode the raw text between the quotes of a `@use` specifier.
 *
 * The parser deliberately keeps CSS string escapes raw; resolution needs the
 * authored path. Hexadecimal escapes (`\74`) consume up to six digits plus one
 * optional whitespace terminator, escaped newlines are removed, other escaped
 * characters stand for themselves, and invalid code points become U+FFFD per
 * CSS string rules.
 */
export function decodeCssString(raw: string): string {
  let decoded = "";
  let index = 0;

  while (index < raw.length) {
    const character = raw.charAt(index);
    if (character !== "\\") {
      decoded += character;
      index += 1;
      continue;
    }

    index += 1;
    if (index >= raw.length) break;

    const escaped = raw.charAt(index);
    if (escaped === "\n") {
      index += 1;
      continue;
    }
    if (escaped === "\r") {
      index += 1;
      if (raw.charAt(index) === "\n") index += 1;
      continue;
    }
    if (escaped === "\f") {
      index += 1;
      continue;
    }

    if (!isHexDigit(escaped)) {
      decoded += escaped;
      index += 1;
      continue;
    }

    let digits = "";
    while (digits.length < 6 && index < raw.length && isHexDigit(raw.charAt(index))) {
      digits += raw.charAt(index);
      index += 1;
    }

    const terminator = raw.charAt(index);
    if (terminator === "\r") {
      index += 1;
      if (raw.charAt(index) === "\n") index += 1;
    } else if (
      terminator === " " ||
      terminator === "\t" ||
      terminator === "\n" ||
      terminator === "\f"
    ) {
      index += 1;
    }

    const codePoint = Number.parseInt(digits, 16);
    decoded += String.fromCodePoint(isValidCodePoint(codePoint) ? codePoint : 0xfffd);
  }

  return decoded;
}

function isHexDigit(character: string): boolean {
  return (
    (character >= "0" && character <= "9") ||
    (character >= "a" && character <= "f") ||
    (character >= "A" && character <= "F")
  );
}

function isValidCodePoint(codePoint: number): boolean {
  if (!Number.isFinite(codePoint) || codePoint === 0) return false;
  if (codePoint > 0x10ffff) return false;
  return codePoint < 0xd800 || codePoint > 0xdfff;
}
