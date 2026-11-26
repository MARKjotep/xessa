/**
 * Minimal static server for the generated browser-test pages.
 *
 * No third-party dependency: Node's `http` serves `tests/browser/dist` with
 * explicit MIME types and no-store caching. Playwright starts this through
 * `webServer` and polls `/health`; the health endpoint is independent of the
 * generated artifacts so build/serve ordering cannot deadlock.
 */

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 4319);
const root = normalize(fileURLToPath(new URL("./dist/", import.meta.url)));
const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function contentType(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  if (url.pathname === "/health") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("ok");
    return;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    response.end("bad request");
    return;
  }

  const requested = pathname === "/" ? "/index.html" : pathname;
  const file = normalize(join(root, requested));
  if (file !== root && !file.startsWith(rootPrefix)) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("forbidden");
    return;
  }

  try {
    const data = await readFile(file);
    response.writeHead(200, {
      "content-type": contentType(file),
      "cache-control": "no-store",
    });
    response.end(data);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  }
});

server.listen(port, host, () => {
  console.log(`[browser-server] http://${host}:${port}/ serving ${root}`);
});

function shutDown(): void {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutDown);
process.on("SIGTERM", shutDown);
