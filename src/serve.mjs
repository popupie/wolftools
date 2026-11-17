import { createReadStream } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, relative, resolve, sep } from "node:path";

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ttf", "font/ttf"],
  [".wasm", "application/wasm"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function safePath(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0")) return undefined;
  if (decoded.endsWith("/")) decoded += "index.html";
  const path = resolve(root, `.${normalize(decoded)}`);
  const inside = relative(root, path);
  if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`))
    return undefined;
  return path;
}

function rangeFrom(header, size) {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  )
    return null;
  return { start, end: Math.min(end, size - 1) };
}

export async function serveWebExport({
  rootDir,
  port = 4177,
  host = "127.0.0.1",
}) {
  const root = resolve(rootDir);
  const details = await stat(root).catch(() => undefined);
  if (!details?.isDirectory())
    throw new Error(`Web export folder was not found: ${root}`);
  const metadata = await readFile(join(root, "browser-game.json"), "utf8")
    .then(JSON.parse)
    .catch(() => undefined);
  if (metadata?.layout === "combined") {
    throw new Error(
      "Serve a combined export from its game folder, not web/: shared assets live in the parent Data folder.",
    );
  }
  const combined = await readFile(
    join(root, "web", "browser-game.json"),
    "utf8",
  )
    .then(JSON.parse)
    .then((data) => data.layout === "combined")
    .catch(() => false);
  const launchPath = combined ? "web/" : "";
  await access(join(root, launchPath, "index.html")).catch(() => {
    throw new Error(`Web export has no index.html: ${root}`);
  });
  const numericPort = Number(port);
  if (
    !Number.isInteger(numericPort) ||
    numericPort < 0 ||
    numericPort > 65535
  ) {
    throw new Error(`Invalid port: ${port}`);
  }

  const server = createServer(async (request, response) => {
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("Accept-Ranges", "bytes");
    try {
      const url = new URL(
        request.url || "/",
        `http://${request.headers.host || "localhost"}`,
      );
      const path = safePath(root, url.pathname);
      const file = path && (await stat(path).catch(() => undefined));
      if (!path || !file?.isFile()) {
        response.writeHead(404, {
          "Content-Type": "text/plain; charset=utf-8",
        });
        response.end("Not found\n");
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" });
        response.end();
        return;
      }

      const range = rangeFrom(request.headers.range, file.size);
      if (range === null) {
        response.writeHead(416, { "Content-Range": `bytes */${file.size}` });
        response.end();
        return;
      }
      const start = range?.start ?? 0;
      const end = range?.end ?? Math.max(0, file.size - 1);
      const length = file.size === 0 ? 0 : end - start + 1;
      const headers = {
        "Cache-Control": "no-cache",
        // Browser Woditor compares the HEAD response with its stored asset revision.
        ETag: `W/"${file.size}-${file.mtimeMs}"`,
        "Content-Length": length,
        "Content-Type":
          MIME_TYPES.get(extname(path).toLowerCase()) ||
          "application/octet-stream",
      };
      if (range)
        headers["Content-Range"] = `bytes ${start}-${end}/${file.size}`;
      response.writeHead(range ? 206 : 200, headers);
      if (request.method === "HEAD" || file.size === 0) {
        response.end();
        return;
      }
      createReadStream(path, { start, end }).pipe(response);
    } catch (error) {
      if (!response.headersSent)
        response.writeHead(500, {
          "Content-Type": "text/plain; charset=utf-8",
        });
      response.end(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  });

  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(numericPort, host, accept);
  });
  const address = server.address();
  const actualPort =
    typeof address === "object" && address ? address.port : numericPort;
  return {
    server,
    root,
    host,
    port: actualPort,
    url: `http://${host}:${actualPort}/${launchPath}`,
  };
}
