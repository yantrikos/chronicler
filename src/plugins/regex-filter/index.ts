// Regex Content Filter — first-party Grimoire entry demonstrating an
// `afterChat` observer hook with settings.
//
// Watches every assistant reply for configurable regex patterns. Logs hits
// to the console; doesn't block the reply (observer mode = read-only).
// Good template for safety scans, telemetry, content audits.

import {
  defineGrimoire,
  type GrimoireManifest,
} from "../../lib/grimoire/types";

export const manifest: GrimoireManifest = {
  id: "io.chronicler.regex-filter",
  name: "Regex Content Filter",
  version: "0.1.0",
  apiVersion: "^0.1.0",
  description:
    "Scans assistant replies against configurable regex patterns and logs matches",
  author: "Chronicler Labs",
  license: "MIT",
  keywords: ["safety", "telemetry", "moderation"],
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

interface FilterSettings {
  patterns: { name: string; regex: string }[];
}

const DEFAULTS: FilterSettings = {
  patterns: [
    { name: "phone", regex: "\\b\\d{3}[-.]?\\d{3}[-.]?\\d{4}\\b" },
    { name: "email", regex: "\\b[\\w.+-]+@[\\w-]+\\.[\\w.-]+\\b" },
  ],
};

export default defineGrimoire({
  id: "io.chronicler.regex-filter",
  defaultSettings: DEFAULTS as unknown as Record<string, unknown>,

  setup(ctx) {
    ctx.hooks.afterChat.observe(async (event, api) => {
      const stored = await api.settings.get();
      const settings: FilterSettings =
        Object.keys(stored).length > 0
          ? (stored as unknown as FilterSettings)
          : DEFAULTS;
      const text = event.reply.content;
      for (const { name, regex } of settings.patterns ?? []) {
        let re: RegExp;
        try {
          re = new RegExp(regex, "gi");
        } catch {
          continue;
        }
        const hits = text.match(re);
        if (hits && hits.length > 0) {
          api.logger.warn(
            `pattern '${name}' matched ${hits.length}× in reply (session ${event.sessionId})`,
            hits.slice(0, 3)
          );
        }
      }
    });

    return {
      dispose() {
        // No persistent resources to release.
      },
    };
  },
});
