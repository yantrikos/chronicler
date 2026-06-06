import { defineGrimoire, type GrimoireManifest } from "@chronicler/grimoire";

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
    commands: ["greet"],
  },
};

export default defineGrimoire({
  id: "{{PLUGIN_ID}}",

  setup(ctx) {
    ctx.commands.register({
      name: "greet",
      description: "Print a friendly greeting",
      run: async (args, api) => {
        const target = args.trim() || "there";
        return { kind: "text", content: `Hello, ${target}! 👋` };
      },
    });

    return {};
  },
});
