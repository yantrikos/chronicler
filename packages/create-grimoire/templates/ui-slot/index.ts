import { defineGrimoire, type GrimoireManifest } from "@chronicler/grimoire";
import { Panel } from "./Panel";

export const manifest: GrimoireManifest = {
  id: "{{PLUGIN_ID}}",
  name: "{{PLUGIN_NAME}}",
  version: "0.1.0",
  apiVersion: "^0.1.0",
  description: "{{PLUGIN_DESCRIPTION}}",
  author: "{{PLUGIN_AUTHOR}}",
  license: "{{PLUGIN_LICENSE}}",
  permissions: {
    network: [],
    filesystem: "plugin-data-only",
    llm: false,
    memory: false,
  },
  contributes: {
    ui: { slots: ["inspector:tab"] },
  },
};

export default defineGrimoire({
  id: "{{PLUGIN_ID}}",

  setup(ctx) {
    ctx.ui.registerSlot("inspector:tab", Panel, {
      title: "{{PLUGIN_NAME}}",
    });
    return {};
  },
});
