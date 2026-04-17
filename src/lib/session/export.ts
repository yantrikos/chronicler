// Session export — produce a Markdown transcript of a session with its
// metadata header, and a full config backup/restore pair for moving
// Chronicler between machines.

import type { Character, ChatTurn } from "../orchestrator/types";
import type { SessionMeta } from "./store";
import type { ChroniclerConfig } from "../config";

export function exportSessionMarkdown(
  meta: SessionMeta,
  turns: ChatTurn[],
  characters: Character[],
  userName: string
): string {
  const charactersMap = Object.fromEntries(characters.map((c) => [c.id, c.name]));
  const header = [
    `# ${meta.title}`,
    "",
    `> Session ${meta.id}`,
    `> Started: ${new Date(meta.created_at).toLocaleString()}`,
    `> Ended: ${new Date(meta.last_at).toLocaleString()}`,
    `> Turns: ${meta.turn_count}`,
    `> Characters: ${meta.character_ids.map((id) => charactersMap[id] ?? id).join(", ")}`,
    meta.author_note
      ? `> Author's note: ${meta.author_note.replace(/\n/g, " ")}`
      : null,
    "",
    "---",
    "",
  ]
    .filter((l) => l !== null)
    .join("\n");

  const body = turns
    .map((t) => {
      const name =
        t.role === "user" ? userName : charactersMap[t.speaker] ?? t.speaker;
      const header = `**${name}:**`;
      return `${header}\n\n${t.content}\n`;
    })
    .join("\n---\n\n");

  return `${header}\n${body}`;
}

export function downloadText(filename: string, text: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface ChroniclerBackup {
  version: 1;
  exported_at: string;
  config: ChroniclerConfig;
  characters: Character[];
  sessions: Array<{ meta: SessionMeta; turns: ChatTurn[] }>;
}

export function buildBackup(
  config: ChroniclerConfig,
  characters: Character[],
  sessions: Array<{ meta: SessionMeta; turns: ChatTurn[] }>
): ChroniclerBackup {
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    config,
    characters,
    sessions,
  };
}

export function parseBackup(raw: string): ChroniclerBackup {
  const parsed = JSON.parse(raw);
  if (parsed.version !== 1) {
    throw new Error(`Unsupported backup version: ${parsed.version}`);
  }
  return parsed as ChroniclerBackup;
}
