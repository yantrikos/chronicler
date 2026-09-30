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
import { Storage, handleStorageRequest } from "./storage.mjs";
import {
  initGrimoirePluginServer,
  handleGrimoireRequest,
} from "./grimoire-plugins.mjs";

const PORT = Number(process.env.CHRONICLER_PORT ?? 3001);
const BIND = process.env.CHRONICLER_BIND ?? "127.0.0.1";
const YANTRIKDB_URL = process.env.CHRONICLER_YANTRIKDB_URL ?? "http://localhost:8420/mcp";
const YANTRIKDB_TOKEN = process.env.CHRONICLER_YANTRIKDB_TOKEN ?? "";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Durable storage (chats, characters, shared images). See server/storage.mjs.
const DATA_DIR = process.env.CHRONICLER_DATA_DIR ?? join(__dirname, "..", "data");
const storage = new Storage(DATA_DIR);
await storage.init();
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

// Largest request body the proxy will buffer. A downscaled 1024px image is a
// few hundred KB as base64; anything near this cap is a mistake, and without a
// cap one oversized upload could pin the process.
const MAX_BODY_BYTES = Number(process.env.CHRONICLER_MAX_BODY_BYTES ?? 16 * 1024 * 1024);

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on("data", (c) => {
      size += c.length;
      // Past the cap: keep draining the socket (so we can still answer) but
      // stop buffering, so memory stays bounded.
      if (size > MAX_BODY_BYTES) tooBig = true;
      else chunks.push(c);
    });
    req.on("end", () =>
      tooBig
        ? reject(Object.assign(new Error(`request body over ${MAX_BODY_BYTES} bytes`), { code: "E2BIG" }))
        : resolve(Buffer.concat(chunks))
    );
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

// Two limits, because a slow machine is slow in two different ways:
//  - FIRST BYTE: how long to wait for the model to begin answering. Loading a big model and reading
//    a long prompt on CPU can take minutes, and a reasoning model thinks before it emits anything.
//    (CHRONICLER_LLM_TIMEOUT_MS, the old single limit, now means this.)
//  - IDLE: how long the stream may go silent once it has started. It is reset by every chunk, so a
//    reply that is slow but steady is never cut off. The old design capped the WHOLE exchange at
//    120s, which silently truncated any reply taking longer than two minutes end to end.
const LLM_TIMEOUT_MS = Number(process.env.CHRONICLER_LLM_TIMEOUT_MS ?? 600_000);
const LLM_IDLE_MS = Number(process.env.CHRONICLER_LLM_IDLE_MS ?? 180_000);

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
    res.writeHead(err.code === "E2BIG" ? 413 : 400, { "content-type": "application/json" });
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
  let timer;
  let timedOut = null; // why we aborted, if we did
  let clientGone = false;
  const arm = (ms, why) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = why;
      controller.abort();
    }, ms);
  };
  arm(LLM_TIMEOUT_MS, `no response from the model after ${Math.round(LLM_TIMEOUT_MS / 1000)}s`);
  // The browser went away (Stop pressed, tab closed): cancel the upstream request so Ollama stops
  // generating instead of finishing a reply nobody will read — and blocking the next one.
  res.on("close", () => {
    if (!res.writableFinished) {
      clientGone = true;
      controller.abort();
    }
  });

  let upstream;
  try {
    upstream = await fetch(target_url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (clientGone) {
      console.log(`[llm] ✗ ${target_url} (client disconnected; request cancelled)`);
      return;
    }
    const reason = timedOut ?? (err.name === "AbortError" ? "aborted" : err.message);
    console.log(`[llm] ✗ ${target_url} (${reason})`);
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `llm upstream unreachable: ${reason}` }));
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
    arm(LLM_IDLE_MS, `the model went silent for ${Math.round(LLM_IDLE_MS / 1000)}s mid-reply`);
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        arm(LLM_IDLE_MS, `the model went silent for ${Math.round(LLM_IDLE_MS / 1000)}s mid-reply`);
        res.write(Buffer.from(value));
      }
    } catch (err) {
      clearTimeout(timer);
      if (clientGone) {
        console.log(`[llm] ✗ ${target_url} (client disconnected; upstream cancelled after ${Date.now() - started}ms)`);
        return;
      }
      // Headers are already sent, so a status can't report this. End the connection abruptly (NOT a
      // clean end): the browser then sees the stream fail instead of mistaking a cut-off reply for a
      // finished one.
      console.log(`[llm] ✗ stream error: ${timedOut ?? err.message}`);
      res.destroy(new Error(timedOut ?? err.message));
      return;
    }
  }
  clearTimeout(timer);
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
    if (await handleStorageRequest(storage, req, res)) return;
    if (req.url === "/api/llm") return await proxyLlm(req, res);
    if (req.url.startsWith("/api/grimoire/")) {
      if (handleGrimoireRequest(req, res)) return;
    }
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

server.listen(PORT, BIND, async () => {
  console.log(
    `[chronicler-server] listening on http://${BIND}:${PORT}  → mcp=${YANTRIKDB_URL}  dist=${DIST_DIR}`
  );
  // Bring up the Grimoire out-of-tree plugin loader after the HTTP
  // server is accepting connections. Failure here is non-fatal — the
  // app still works, just without external plugins.
  try {
    await initGrimoirePluginServer();
  } catch (e) {
    console.warn("[grimoire-plugins] init failed:", e);
  }
});
