// Transcript Exporter — first-party Grimoire entry demonstrating an
// `afterWrite` observer hook + a `/export` slash command.
//
// Tracks each session's turns in plugin-scoped storage and emits a
// downloadable Markdown file when /export fires. Good template for
// data-pipeline plugins (write to external store, generate artifacts).

import {
  defineGrimoire,
  type GrimoireManifest,
} from "../../lib/grimoire/types";

export const manifest: GrimoireManifest = {
  id: "io.chronicler.transcript-exporter",
  name: "Transcript Exporter",
  version: "0.1.0",
  apiVersion: "^0.1.0",
  description:
    "Accumulates session turns and exports them as Markdown via /export",
  author: "Chronicler Labs",
  license: "MIT",
  keywords: ["export", "transcript", "markdown"],
  permissions: {
    network: [],
    filesystem: "plugin-data-only",
    llm: false,
    memory: "read",
  },
  contributes: {
    hooks: [{ point: "afterWrite", type: "observer" }],
    commands: ["export"],
  },
};

interface StoredTurn {
  role: "user" | "assistant";
  speaker?: string;
  content: string;
  ts: string;
}

const STORAGE_KEY = (sessionId: string) => `turns:${sessionId}`;

export default defineGrimoire({
  id: "io.chronicler.transcript-exporter",

  setup(ctx) {
    ctx.hooks.afterWrite.observe(async (event, api) => {
      const existing = ((await api.storage.get<StoredTurn[]>(
        STORAGE_KEY(event.sessionId)
      )) ?? []) as StoredTurn[];
      const incoming: StoredTurn[] = [];
      if (event.userTurn) {
        incoming.push({
          role: "user",
          speaker: event.userTurn.speaker,
          content: event.userTurn.content,
          ts: event.userTurn.created_at,
        });
      }
      incoming.push({
        role: "assistant",
        speaker: event.assistantTurn.speaker,
        content: event.assistantTurn.content,
        ts: event.assistantTurn.created_at,
      });
      await api.storage.set(
        STORAGE_KEY(event.sessionId),
        [...existing, ...incoming]
      );
    });

    ctx.commands.register({
      name: "export",
      description:
        "Export the current session as Markdown (downloads to your browser)",
      run: async (args, api) => {
        const sessionId = args.trim();
        if (!sessionId) {
          return {
            kind: "error",
            content:
              "Usage: /export <session-id> — pass the active session id (visible in the URL)",
          };
        }
        const turns = (await api.storage.get<StoredTurn[]>(
          STORAGE_KEY(sessionId)
        )) ?? [];
        if (turns.length === 0) {
          return {
            kind: "system",
            content: `No turns accumulated for session ${sessionId}`,
          };
        }
        const md = renderMarkdown(sessionId, turns);
        downloadMarkdown(`chronicler-${sessionId}.md`, md);
        return {
          kind: "system",
          content: `Exported ${turns.length} turn${turns.length === 1 ? "" : "s"} as chronicler-${sessionId}.md`,
        };
      },
    });

    return {
      dispose() {
        /* nothing to release */
      },
    };
  },
});

function renderMarkdown(sessionId: string, turns: StoredTurn[]): string {
  const lines: string[] = [
    `# Chronicler session: ${sessionId}`,
    "",
    `_${turns.length} turn${turns.length === 1 ? "" : "s"}, exported ${new Date().toISOString()}_`,
    "",
  ];
  for (const t of turns) {
    const who = t.speaker ?? (t.role === "user" ? "User" : "Character");
    lines.push(`## ${who} _(${t.role}, ${t.ts})_`);
    lines.push("");
    lines.push(t.content);
    lines.push("");
  }
  return lines.join("\n");
}

function downloadMarkdown(filename: string, body: string): void {
  const blob = new Blob([body], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
