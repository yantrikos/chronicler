import React from "react";
import ReactDOM from "react-dom/client";
import * as JsxRuntime from "react/jsx-runtime";
import App from "./App";

// Expose React + jsx-runtime to out-of-tree Grimoire plugins.
// Plugins compiled by the server-side bundler get their `react` imports
// rewritten to read from these globals so they share the host's React
// instance. Without this, plugin hooks crash with the "two React
// instances" error. See server/grimoire-plugins.mjs:reactSharedShim.
(globalThis as unknown as Record<string, unknown>).__chronicler_react = React;
(globalThis as unknown as Record<string, unknown>).__chronicler_react_jsx =
  JsxRuntime;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
