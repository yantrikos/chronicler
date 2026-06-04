// Server-side Grimoire plugin loader. Scans a host-mounted directory
// for plugins, validates their manifests, bundles their source via
// esbuild, and serves the bundles to the browser for dynamic import.
//
// Lifecycle:
//   - PLUGINS_DIR is a docker volume mount (host's ~/.chronicler/plugins/
//     by default). Each subdirectory is one plugin: <id>/grimoire.json +
//     index.ts (or index.js).
//   - On startup, scan all subdirs, validate manifests, esbuild-bundle
//     each into an in-memory ESM blob.
//   - chokidar watches for changes; rebuild on file modify.
//   - HTTP endpoints:
//       GET /api/grimoire/plugins         → [{id, manifest, source, bundledAt}]
//       GET /api/grimoire/plugin/:id/bundle.js → the ESM bundle (cache-busted by mtime)
//       SSE  /api/grimoire/events         → push notification when a plugin reloads

import chokidar from "chokidar";
import * as esbuild from "esbuild";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const PLUGINS_DIR =
  process.env.CHRONICLER_PLUGINS_DIR ?? "/data/plugins";

/** Map<pluginId, {manifest, bundle, bundledAt, sourcePath, error?}>. */
const plugins = new Map();

/** SSE clients registered via /api/grimoire/events. */
const sseClients = new Set();

/** Bump on every plugin add/change/remove. Clients use this as a quick
 *  poll target before reaching for SSE. */
let version = 0;

function logInfo(...args) {
  console.log("[grimoire-plugins]", ...args);
}
function logWarn(...args) {
  console.warn("[grimoire-plugins]", ...args);
}

async function readManifest(dir) {
  const manifestPath = path.join(dir, "grimoire.json");
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/** esbuild plugin: resolve `@chronicler/grimoire` imports to a tiny
 *  inline shim. The host-side SDK is purely a typing surface +
 *  identity functions (`defineGrimoire = x => x`); plugins don't need
 *  the real types at runtime. This lets plugin authors write
 *  `import { defineGrimoire } from "@chronicler/grimoire"` cleanly
 *  without an npm install or relative path acrobatics. */
const grimoireSdkShim = {
  name: "grimoire-sdk-shim",
  setup(build) {
    build.onResolve({ filter: /^@chronicler\/grimoire$/ }, () => ({
      path: "@chronicler/grimoire",
      namespace: "grimoire-sdk-shim",
    }));
    build.onLoad(
      { filter: /.*/, namespace: "grimoire-sdk-shim" },
      () => ({
        contents: `
          export const defineGrimoire = (def) => def;
          export const GRIMOIRE_SDK_VERSION = "0.1.0";
        `,
        loader: "js",
      })
    );
  },
};

/** esbuild plugin: resolve `react` and `react/jsx-runtime` imports
 *  to the host-app's React instance (exposed via globalThis at app
 *  boot). Sharing React across the plugin / host boundary is mandatory
 *  for hooks to work — React enforces same-instance hook calls.
 *  Without this, plugins that use React Hooks crash on first render. */
const reactSharedShim = {
  name: "react-shared-shim",
  setup(build) {
    build.onResolve({ filter: /^react$/ }, () => ({
      path: "react",
      namespace: "react-shared",
    }));
    build.onLoad(
      { filter: /.*/, namespace: "react-shared" },
      () => ({
        contents: `
          const R = globalThis.__chronicler_react;
          if (!R) throw new Error("[grimoire] host has not exposed React on globalThis.__chronicler_react");
          export default R;
          export const useState = R.useState;
          export const useEffect = R.useEffect;
          export const useMemo = R.useMemo;
          export const useRef = R.useRef;
          export const useCallback = R.useCallback;
          export const useLayoutEffect = R.useLayoutEffect;
          export const useContext = R.useContext;
          export const useReducer = R.useReducer;
          export const useImperativeHandle = R.useImperativeHandle;
          export const useDebugValue = R.useDebugValue;
          export const useId = R.useId;
          export const useTransition = R.useTransition;
          export const useDeferredValue = R.useDeferredValue;
          export const useSyncExternalStore = R.useSyncExternalStore;
          export const createContext = R.createContext;
          export const Fragment = R.Fragment;
          export const memo = R.memo;
          export const forwardRef = R.forwardRef;
          export const lazy = R.lazy;
          export const Suspense = R.Suspense;
          export const StrictMode = R.StrictMode;
          export const Children = R.Children;
          export const createElement = R.createElement;
          export const cloneElement = R.cloneElement;
          export const isValidElement = R.isValidElement;
        `,
        loader: "js",
      })
    );
    build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
      path: "react/jsx-runtime",
      namespace: "react-jsx-shared",
    }));
    build.onLoad(
      { filter: /.*/, namespace: "react-jsx-shared" },
      () => ({
        contents: `
          const R = globalThis.__chronicler_react_jsx;
          if (!R) throw new Error("[grimoire] host has not exposed react/jsx-runtime on globalThis.__chronicler_react_jsx");
          export const jsx = R.jsx;
          export const jsxs = R.jsxs;
          export const Fragment = R.Fragment;
        `,
        loader: "js",
      })
    );
  },
};

async function bundlePlugin(dir, id) {
  // Try index.ts first, then index.js. Skip if neither exists.
  let entry = null;
  for (const candidate of ["index.ts", "index.js", "index.mjs"]) {
    const p = path.join(dir, candidate);
    if (existsSync(p)) {
      entry = p;
      break;
    }
  }
  if (!entry) throw new Error(`no index.{ts,js,mjs} in plugin ${id}`);

  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    write: false,
    // react / react/jsx-runtime are handled by reactSharedShim below —
    // they're rewritten to pull from globalThis at runtime so plugins
    // and the host share the same React instance (required for hooks).
    external: ["react-dom"],
    // Be permissive with JSX.
    loader: { ".ts": "ts", ".tsx": "tsx" },
    minify: false,
    sourcemap: "inline",
    metafile: false,
    plugins: [grimoireSdkShim, reactSharedShim],
    // Resolve JSX for .tsx files using React automatic runtime.
    jsx: "automatic",
  });
  const file = result.outputFiles[0];
  return file.text;
}

async function reloadOne(id) {
  const dir = path.join(PLUGINS_DIR, id);
  try {
    const manifest = await readManifest(dir);
    if (!manifest) {
      // Manifest missing — drop the plugin.
      if (plugins.has(id)) {
        plugins.delete(id);
        version++;
        logInfo(`removed ${id} (manifest gone)`);
        notifyClients();
      }
      return;
    }
    if (manifest.id !== id) {
      logWarn(
        `${id}: manifest id (${manifest.id}) does not match directory name; using directory name as canonical`
      );
    }
    const bundle = await bundlePlugin(dir, id);
    plugins.set(id, {
      manifest,
      bundle,
      bundledAt: new Date().toISOString(),
      sourcePath: dir,
    });
    version++;
    logInfo(`loaded ${id} v${manifest.version ?? "?"} (${bundle.length} bytes)`);
    notifyClients();
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    plugins.set(id, {
      manifest: { id, name: id, version: "?", apiVersion: "*" },
      bundle: "",
      bundledAt: new Date().toISOString(),
      sourcePath: dir,
      error: err,
    });
    version++;
    logWarn(`failed to load ${id}: ${err}`);
    notifyClients();
  }
}

function notifyClients() {
  const payload = `data: ${JSON.stringify({ type: "reload", version })}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      // Client disconnected; will be cleaned up on next write attempt.
    }
  }
}

async function scanAll() {
  if (!existsSync(PLUGINS_DIR)) {
    logInfo(`plugins dir ${PLUGINS_DIR} does not exist; out-of-tree plugins disabled`);
    return;
  }
  let entries;
  try {
    entries = await fs.readdir(PLUGINS_DIR, { withFileTypes: true });
  } catch (e) {
    logWarn(`cannot read ${PLUGINS_DIR}:`, e.message);
    return;
  }
  const subdirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  for (const id of subdirs) {
    await reloadOne(id);
  }
}

let watcher = null;

export async function initGrimoirePluginServer() {
  await scanAll();
  if (existsSync(PLUGINS_DIR)) {
    // Watch for file changes in plugin source — rebuild affected plugin.
    watcher = chokidar.watch(PLUGINS_DIR, {
      ignoreInitial: true,
      depth: 3,
      ignored: /node_modules|\.git/,
    });
    watcher.on("all", (event, p) => {
      // Resolve which plugin id this change belongs to (the first path
      // component under PLUGINS_DIR).
      const rel = path.relative(PLUGINS_DIR, p);
      if (!rel || rel.startsWith("..")) return;
      const id = rel.split(path.sep)[0];
      if (!id) return;
      logInfo(`${event}: ${rel} → reload ${id}`);
      reloadOne(id).catch((e) => logWarn(`reload ${id} failed`, e));
    });
    logInfo(`watching ${PLUGINS_DIR} for plugin changes`);
  }
}

/** Per-request handlers wired by server/index.mjs. */
export function handleGrimoireRequest(req, res) {
  const url = new URL(req.url, "http://x");
  const pathname = url.pathname;

  if (pathname === "/api/grimoire/plugins" && req.method === "GET") {
    const out = Array.from(plugins.entries()).map(([id, p]) => ({
      id,
      manifest: p.manifest,
      bundledAt: p.bundledAt,
      sourcePath: p.sourcePath,
      bundleUrl: `/api/grimoire/plugin/${encodeURIComponent(id)}/bundle.js`,
      error: p.error,
    }));
    res.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-cache",
    });
    res.end(JSON.stringify({ version, plugins: out }));
    return true;
  }

  const bundleMatch = pathname.match(
    /^\/api\/grimoire\/plugin\/([^/]+)\/bundle\.js$/
  );
  if (bundleMatch && req.method === "GET") {
    const id = decodeURIComponent(bundleMatch[1]);
    const p = plugins.get(id);
    if (!p || p.error) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end(p?.error ?? "not found");
      return true;
    }
    res.writeHead(200, {
      "content-type": "application/javascript; charset=utf-8",
      // Bundles change with mtime; clients use ?v= cache-bust.
      "cache-control": "no-cache",
    });
    res.end(p.bundle);
    return true;
  }

  if (pathname === "/api/grimoire/install" && req.method === "POST") {
    void handleInstall(req, res);
    return true;
  }

  if (pathname.match(/^\/api\/grimoire\/uninstall\/[^/]+$/) && req.method === "POST") {
    const id = decodeURIComponent(pathname.split("/").pop());
    void handleUninstall(id, res);
    return true;
  }

  if (pathname === "/api/grimoire/events" && req.method === "GET") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ type: "hello", version })}\n\n`);
    sseClients.add(res);
    req.on("close", () => {
      sseClients.delete(res);
    });
    return true;
  }

  return false; // not handled — let server fall through
}

/** POST /api/grimoire/install — body {gitUrl, dirName?}.
 *  Clones a git URL into <PLUGINS_DIR>/<dirName>. dirName defaults to
 *  the repo's name stripped of .git suffix. Rejects if PLUGINS_DIR is
 *  read-only (e.g. the default docker mount). Returns {ok, id} or
 *  {error}. */
async function handleInstall(req, res) {
  let body = "";
  for await (const chunk of req) body += chunk.toString("utf8");
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid JSON body" }));
    return;
  }
  const gitUrl = String(payload?.gitUrl ?? "").trim();
  if (!/^(https?|git|ssh):\/\//.test(gitUrl) && !gitUrl.startsWith("git@")) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "gitUrl must be an http(s)/git/ssh URL" }));
    return;
  }
  // Derive dirName from the URL if not provided.
  let dirName = String(payload?.dirName ?? "").trim();
  if (!dirName) {
    const tail = gitUrl.split("/").pop() ?? "";
    dirName = tail.replace(/\.git$/, "").trim();
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(dirName)) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: `dirName "${dirName}" invalid (allowed: a-z A-Z 0-9 _ -)`,
      })
    );
    return;
  }
  // Detect read-only mount up front so the failure message is helpful.
  try {
    const probePath = path.join(PLUGINS_DIR, ".write-probe");
    await fs.writeFile(probePath, "");
    await fs.unlink(probePath);
  } catch (e) {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: `${PLUGINS_DIR} is not writable from the container. Edit docker-compose.yml to drop ':ro' on the volume mount, restart, and retry.`,
      })
    );
    return;
  }
  const target = path.join(PLUGINS_DIR, dirName);
  if (existsSync(target)) {
    res.writeHead(409, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: `plugin directory "${dirName}" already exists; uninstall first or use a different dirName`,
      })
    );
    return;
  }
  logInfo(`installing ${gitUrl} → ${target}`);
  const cloned = await runCommand("git", ["clone", "--depth", "1", gitUrl, target]);
  if (cloned.code !== 0) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: `git clone failed (exit ${cloned.code}): ${cloned.stderr.slice(0, 500)}`,
      })
    );
    return;
  }
  // chokidar will pick up the new dir; explicit reload to make the
  // response wait until the manifest is loaded.
  await reloadOne(dirName);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, id: dirName }));
}

async function handleUninstall(id, res) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid plugin id" }));
    return;
  }
  const target = path.join(PLUGINS_DIR, id);
  if (!existsSync(target)) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `plugin "${id}" not installed` }));
    return;
  }
  try {
    await fs.rm(target, { recursive: true, force: true });
  } catch (e) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: `removing ${target} failed: ${e instanceof Error ? e.message : String(e)}`,
      })
    );
    return;
  }
  plugins.delete(id);
  version++;
  notifyClients();
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, id }));
}

function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d) => (stderr += d.toString("utf8")));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.on("error", (err) =>
      resolve({ code: -1, stdout, stderr: err.message })
    );
  });
}

export function shutdownGrimoirePluginServer() {
  if (watcher) {
    watcher.close().catch(() => undefined);
    watcher = null;
  }
  for (const res of sseClients) {
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }
  sseClients.clear();
}
