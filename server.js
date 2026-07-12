"use strict";

const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { URL } = require("node:url");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function isAllowedTikTokUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === "https:" &&
      (hostname === "tiktok.com" ||
        hostname.endsWith(".tiktok.com") ||
        hostname === "vm.tiktok.com" ||
        hostname === "vt.tiktok.com")
    );
  } catch (_error) {
    return false;
  }
}

async function proxyTikTokOEmbed(reqUrl, res) {
  const targetUrl = reqUrl.searchParams.get("url");
  if (!targetUrl || !isAllowedTikTokUrl(targetUrl)) {
    sendJson(res, 400, {
      error: "invalid_tiktok_url",
      message: "Provide a public HTTPS TikTok URL."
    });
    return;
  }

  const oembedUrl = new URL("https://www.tiktok.com/oembed");
  oembedUrl.searchParams.set("url", targetUrl);

  try {
    const response = await fetch(oembedUrl, {
      headers: {
        accept: "application/json",
        "user-agent": "Looper/0.1 (+local-development)"
      },
      signal: AbortSignal.timeout(8000)
    });

    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (_error) {
      payload = { raw: text };
    }

    if (!response.ok) {
      sendJson(res, response.status, {
        error: "tiktok_oembed_failed",
        status: response.status,
        payload
      });
      return;
    }

    sendJson(res, 200, {
      provider: "tiktok_oembed",
      fetchedAt: new Date().toISOString(),
      sourceUrl: targetUrl,
      data: payload
    });
  } catch (error) {
    sendJson(res, 502, {
      error: "tiktok_oembed_unavailable",
      message: error.message
    });
  }
}

function resolveStaticPath(reqUrl) {
  const pathname = reqUrl.pathname === "/" ? "/index.html" : reqUrl.pathname;
  const decoded = decodeURIComponent(pathname);
  const normalized = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(root, normalized);
  const relative = path.relative(root, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return filePath;
}

async function serveStatic(reqUrl, res) {
  const filePath = resolveStaticPath(reqUrl);
  if (!filePath) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": mimeTypes[ext] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(content);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    sendJson(res, 500, { error: "static_file_error", message: error.message });
  }
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && reqUrl.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      app: "looper",
      version: "0.1.0"
    });
    return;
  }

  if (req.method === "GET" && reqUrl.pathname === "/api/tiktok/oembed") {
    await proxyTikTokOEmbed(reqUrl, res);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  await serveStatic(reqUrl, res);
});

function getLanUrls() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => `http://${entry.address}:${port}`);
}

server.listen(port, host, () => {
  console.log(`Looper running locally at http://localhost:${port}`);
  for (const url of getLanUrls()) {
    console.log(`Looper available on your network at ${url}`);
  }
});
