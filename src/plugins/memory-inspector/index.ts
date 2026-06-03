// Memory Inspector — first-party Grimoire entry demonstrating the
// inspector:tab UI slot.
//
// Adds a tab to the right sidebar that shows raw recall results for the
// active character across the canonical namespaces (character / session /
// lorebook / world / preferences). Lets users SEE what's actually in the
// substrate without going through the orchestrator's filtered view.
//
// This is a debugging plugin — the kind that proves a platform is real.

import {
  defineGrimoire,
  type GrimoireManifest,
} from "../../lib/grimoire/types";
import { MemoryInspectorPanel } from "./MemoryInspectorPanel";

export const manifest: GrimoireManifest = {
  id: "io.chronicler.memory-inspector",
  name: "Memory Inspector",
  version: "0.1.0",
  apiVersion: "^0.1.0",
  description:
    "Adds an inspector tab showing raw recall across canonical namespaces",
  author: "Chronicler Labs",
  license: "MIT",
  keywords: ["debug", "memory", "ui"],
  permissions: {
    network: [],
    filesystem: "plugin-data-only",
    llm: false,
    memory: "read",
  },
  contributes: {
    ui: { slots: ["inspector:tab"] },
  },
};

export default defineGrimoire({
  id: "io.chronicler.memory-inspector",

  setup(ctx) {
    ctx.ui.registerSlot("inspector:tab", MemoryInspectorPanel, {
      title: "raw memory",
    });
    return {};
  },
});
