import React from "react";
import ReactDOM from "react-dom/client";
import * as JsxRuntime from "react/jsx-runtime";
import App from "./App";
import { initTheme } from "./lib/ui/theme";
import { bootSync } from "./lib/storage/sync";

// Expose React + jsx-runtime to out-of-tree Grimoire plugins.
// Plugins compiled by the server-side bundler get their `react` imports
// rewritten to read from these globals so they share the host's React
// instance. Without this, plugin hooks crash with the "two React
// instances" error. See server/grimoire-plugins.mjs:reactSharedShim.
(globalThis as unknown as Record<string, unknown>).__chronicler_react = React;
(globalThis as unknown as Record<string, unknown>).__chronicler_react_jsx =
  JsxRuntime;

// Apply the saved theme before first paint so there is no flash.
initTheme();

// Sync first, render second: on a browser that has lost its data, the first
// render must already see the chats the server holds. Without a storage server
// (Vite dev mode) bootSync returns immediately.
void (async () => {
  await bootSync({ timeoutMs: 4000 });
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
})();
