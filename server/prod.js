import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { GET } from "./deals-handler.js";

function publishedWebhook() {
  try {
    const value = process.env.BITRIX_WEBHOOK_URL;
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

const port = Number(process.env.PORT) || 4173;
const root = join(process.cwd(), "dist");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

function cacheControl(pathname) {
  if (pathname.startsWith("/assets/") && /-[A-Za-z0-9_]{6,}\.[a-z0-9]+$/i.test(pathname)) {
    return "public, max-age=31536000, immutable";
  }
  return "no-store";
}

function filePath(pathname) {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const rel = decoded === "/" ? "index.html" : normalize(decoded).replace(/^[/\\]+/, "");
  const path = join(root, rel);
  if (path !== root && !path.startsWith(`${root}${sep}`)) return null;
  return path;
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/api/oformlenie") {
    if (req.method !== "GET") {
      res.writeHead(405, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        allow: "GET",
      });
      res.end(JSON.stringify({ connected: false, deals: [] }));
      return;
    }
    const response = await GET(req, { env: process.env }, publishedWebhook());
    res.writeHead(response.status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }

  const path = filePath(url.pathname);
  if (path) {
    try {
      const data = await readFile(path);
      const type = types[extname(path)] ?? "application/octet-stream";
      res.writeHead(200, {
        "content-type": type,
        "cache-control": cacheControl(url.pathname),
      });
      res.end(data);
      return;
    } catch {
      // Missing files fall through to the app shell.
    }
  }

  try {
    const html = await readFile(join(root, "index.html"));
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(html);
  } catch {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("App shell is missing.");
  }
}).listen(port, "0.0.0.0");
