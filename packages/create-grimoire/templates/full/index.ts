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
    hooks: [{ point: "afterWrite", type: "observer" }],
    commands: ["status"],
    ui: { slots: ["inspector:tab"] },
  },
};

export default defineGrimoire({
  id: "{{PLUGIN_ID}}",

  setup(ctx) {
    let turnCount = 0;

    ctx.hooks.afterWrite.observe(async (event, api) => {
      turnCount++;
      await api.storage.set("turnCount", turnCount);
    });

    ctx.commands.register({
      name: "status",
      description: "Show plugin status",
      run: async (_args, api) => {
        const count = (await api.storage.get<number>("turnCount")) ?? 0;
        return {
          kind: "system",
          content: `📊 {{PLUGIN_NAME}} has observed ${count} turn${count === 1 ? "" : "s"}`,
        };
      },
    });

    ctx.ui.registerSlot("inspector:tab", Panel, { title: "{{PLUGIN_NAME}}" });

    return {};
  },
});
