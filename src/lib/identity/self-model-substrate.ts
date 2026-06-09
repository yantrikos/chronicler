// Phase 11 Pillar 2 — self-model YantrikDB substrate adapter.
//
// One row per character; new generations overwrite. Uses the same
// marker-in-text encoding pattern as src/lib/preferences/substrate.ts
// (YantrikDB strips metadata on read; structured fields must live in
// the text body).

import type { YantrikClient } from "../yantrikdb/client";
import type { SelfModel, SelfModelHeader } from "./self-model-types";

const NS = (character_id: string) => `self:${character_id}`;
const PREFIX = "__GRIMOIRE_SELF_V1__";
const END = "__END_SELF__";

function encodeBody(model: SelfModel): string {
  return `${PREFIX}\n${JSON.stringify(model.header)}\n${END}\n${model.body.trim()}`;
}

function decodeBody(text: string): SelfModel | null {
  if (!text.startsWith(PREFIX)) return null;
  const endIdx = text.indexOf(END);
  if (endIdx === -1) return null;
  const headerStr = text.slice(PREFIX.length + 1, endIdx).trim();
  let header: SelfModelHeader;
  try {
    const parsed = JSON.parse(headerStr) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as Record<string, unknown>).character_id !== "string" ||
      typeof (parsed as Record<string, unknown>).inputs_hash !== "string"
    ) {
      return null;
    }
    header = parsed as SelfModelHeader;
  } catch {
    return null;
  }
  const body = text.slice(endIdx + END.length).trim();
  if (!body) return null;
  return { header, body };
}

/** Write or replace the self-model for a character. New writes don't
 *  delete old rows — preferences substrate skips legacy rows the same
 *  way. To keep the namespace lean, we forget the previous row first. */
export async function writeSelfModel(
  client: YantrikClient,
  model: SelfModel
): Promise<string> {
  const existing = await loadSelfModel(client, model.header.character_id);
  if (existing && (existing as SelfModel & { rid?: string }).rid) {
    await client
      .forget((existing as SelfModel & { rid?: string }).rid!)
      .catch(() => undefined);
  }
  const namespace = NS(model.header.character_id);
  const { rid } = await client.remember({
    text: encodeBody(model),
    namespace,
    importance: 0.95,
    certainty: 0.95,
    source: "system",
    metadata: {
      tier: "canon",
      canonical_status: "canon",
      visible_to: ["*"],
      character_id: model.header.character_id,
      session_id: "self_model",
    },
  });
  return rid;
}

/** Load the most-recent valid self-model row for a character (null if
 *  none or only legacy/malformed rows). Returns the rid alongside so the
 *  caller can forget the row on replace. */
export async function loadSelfModel(
  client: YantrikClient,
  character_id: string
): Promise<(SelfModel & { rid: string }) | null> {
  const rows = await client.listMemoriesInNamespace(NS(character_id), 50);
  let newest: (SelfModel & { rid: string }) | null = null;
  for (const r of rows) {
    const text = (r as { text?: string }).text ?? "";
    const decoded = decodeBody(text);
    if (!decoded) continue;
    if (
      !newest ||
      Date.parse(decoded.header.generated_at) >
        Date.parse(newest.header.generated_at)
    ) {
      newest = { ...decoded, rid: (r as { rid?: string }).rid ?? "" };
    }
  }
  return newest;
}
