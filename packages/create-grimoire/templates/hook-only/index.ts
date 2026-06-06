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
    hooks: [{ point: "afterChat", type: "observer" }],
  },
};

export default defineGrimoire({
  id: "{{PLUGIN_ID}}",

  setup(ctx) {
    ctx.hooks.afterChat.observe(async (event, api) => {
      // event.reply.content is the assistant reply.
      // event.sessionId, event.character are also available.
      api.logger.info(
        `${event.character.name} replied (${event.reply.content.length} chars)`
      );
    });

    return {
      dispose() {
        // Clean up timers / subscriptions here if any.
      },
    };
  },
});
