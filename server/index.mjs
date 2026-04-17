// Chronicler server — serves the built frontend and proxies API calls.
//
// Two responsibilities:
//   1. Serve dist/ as static (when present) for prod runs.
//   2. Handle /api/mcp/*  — forward to the configured YantrikDB MCP endpoint.
//      Handle POST /api/llm — generic proxy for LLM providers (CORS bypass).
//
// Config via env vars:
//   CHRONICLER_PORT              — default 3001
//   CHRONICLER_BIND              — default 127.0.0.1 (set 0.0.0.0 inside docker)
//   CHRONICLER_YANTRIKDB_URL     — default http://localhost:8420/mcp
//   CHRONICLER_YANTRIKDB_TOKEN   — optional bearer token for the MCP server
//   CHRONICLER_DIST              — path to frontend build, default ../dist
//
// /api/mcp/* is a transparent reverse proxy — preserves method, headers, body.
// /api/llm takes { target_url, method, headers, body } in the request body
// and forwards it. This pattern keeps API keys on the host (never in the
// browser) and side-steps CORS on any provider we want to reach.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.CHRONICLER_PORT ?? 3001);
const BIND = process.env.CHRONICLER_BIND ?? "127.0.0.1";
const YANTRIKDB_URL = process.env.CHRONICLER_YANTRIKDB_URL ?? "http://localhost:8420/mcp";
const YANTRIKDB_TOKEN = process.env.CHRONICLER_YANTRIKDB_TOKEN ?? "";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DIST_DIR = process.env.CHRONICLER_DIST
  ? normalize(process.env.CHRONICLER_DIST)
  : normalize(join(__dirname, "..", "dist"));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function proxyMcp(req, res) {
  // /api/mcp[/...] → YANTRIKDB_URL[/...]
  const prefix = "/api/mcp";
  const rest = req.url.slice(prefix.length);
  const target = YANTRIKDB_URL.replace(/\/$/, "") + rest;

  const headers = new Headers();
  // Pass through essential headers for MCP streamable-http + SSE
  for (const [k, v] of Object.entries(req.headers)) {
    if (["host", "connection", "content-length"].includes(k)) continue;
    if (Array.isArray(v)) headers.set(k, v.join(","));
    else if (v) headers.set(k, v);
  }
  if (YANTRIKDB_TOKEN && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${YANTRIKDB_TOKEN}`);
  }

  const init = {
    method: req.method,
    headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : await readBody(req),
    redirect: "manual",
  };

  let upstream;
  try {
    upstream = await fetch(target, init);
  } catch (err) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `mcp upstream unreachable: ${err.message}` }));
    return;
  }

  res.writeHead(
    upstream.status,
    Object.fromEntries(upstream.headers.entries())
  );
  if (upstream.body) {
    const reader = upstream.body.getReader();
    const pump = async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    };
    await pump();
  } else {
    res.end();
  }
}

const LLM_TIMEOUT_MS = Number(process.env.CHRONICLER_LLM_TIMEOUT_MS ?? 120_000);

async function proxyLlm(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405).end();
    return;
  }
  let payload;
  try {
    const raw = await readBody(req);
    payload = JSON.parse(raw.toString("utf8"));
  } catch (err) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `bad proxy payload: ${err.message}` }));
    return;
  }
  const { target_url, method = "POST", headers = {}, body } = payload;
  if (typeof target_url !== "string" || !/^https?:\/\//.test(target_url)) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "target_url required (http(s) URL)" }));
    return;
  }

  const started = Date.now();
  console.log(`[llm] → ${method} ${target_url}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  let upstream;
  try {
    upstream = await fetch(target_url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const reason =
      err.name === "AbortError"
        ? `timed out after ${LLM_TIMEOUT_MS}ms`
        : err.message;
    console.log(`[llm] ✗ ${target_url} (${reason})`);
    res.writeHead(502, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ error: `llm upstream unreachable: ${reason}` })
    );
    return;
  }

  console.log(
    `[llm] ← ${upstream.status} ${target_url} (headers in ${Date.now() - started}ms)`
  );

  res.writeHead(
    upstream.status,
    Object.fromEntries(upstream.headers.entries())
  );
  if (upstream.body) {
    const reader = upstream.body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    } catch (err) {
      console.log(`[llm] ✗ stream error: ${err.message}`);
    }
  }
  clearTimeout(timeout);
  res.end();
  console.log(
    `[llm] ● done ${target_url} (total ${Date.now() - started}ms)`
  );
}

async function serveStatic(req, res) {
  // SPA-style: map unknown paths back to index.html so client-side routes work.
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/" || path === "") path = "/index.html";
  const fullPath = normalize(join(DIST_DIR, path));
  if (!fullPath.startsWith(DIST_DIR)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const s = await stat(fullPath);
    if (s.isDirectory()) throw new Error("dir");
    const buf = await readFile(fullPath);
    const ext = extname(fullPath).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "cache-control":
        ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
    });
    res.end(buf);
  } catch {
    // Fallback to index.html for SPA routes
    try {
      const indexBuf = await readFile(join(DIST_DIR, "index.html"));
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache",
      });
      res.end(indexBuf);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found (dist/ missing — run `npm run build`)");
    }
  }
}

const server = createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/mcp")) return await proxyMcp(req, res);
    if (req.url === "/api/llm") return await proxyLlm(req, res);
    if (req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          yantrikdb_url: YANTRIKDB_URL,
          has_yantrikdb_token: Boolean(YANTRIKDB_TOKEN),
        })
      );
      return;
    }
    return await serveStatic(req, res);
  } catch (err) {
    console.error("[chronicler-server]", err);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    } else {
      res.end();
    }
  }
});

server.listen(PORT, BIND, () => {
  console.log(
    `[chronicler-server] listening on http://${BIND}:${PORT}  → mcp=${YANTRIKDB_URL}  dist=${DIST_DIR}`
  );
});
