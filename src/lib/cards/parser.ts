// Parse community-format v2/v3 character cards.
// Input can be either a PNG with tEXt/zTXt chunks or a raw JSON blob.
// See Saga task #5.

import type { AnyCard } from "./types";

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

export interface ParseResult {
  card: AnyCard;
  raw_json: string;
  source: "png" | "json";
  /** Data URL of the avatar image (PNG card only). Empty string for JSON imports. */
  avatar_url?: string;
}

export async function parseCard(source: Uint8Array | string): Promise<ParseResult> {
  if (typeof source === "string") {
    const card = normalize(JSON.parse(source));
    return { card, raw_json: source, source: "json" };
  }
  if (isPng(source)) {
    const cardJson = extractCardJsonFromPng(source);
    const card = normalize(JSON.parse(cardJson));
    // The entire PNG is the avatar image (metadata is embedded in tEXt chunks,
    // the visible bytes are a regular PNG). Convert to a data URL for display.
    const avatar_url = pngToDataUrl(source);
    return { card, raw_json: cardJson, source: "png", avatar_url };
  }
  const text = new TextDecoder().decode(source);
  const card = normalize(JSON.parse(text));
  return { card, raw_json: text, source: "json" };
}

function pngToDataUrl(bytes: Uint8Array): string {
  // btoa is browser-side; for Node the test/driver path uses JSON cards only.
  if (typeof btoa !== "function") return "";
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk))
    );
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  return true;
}

function extractCardJsonFromPng(bytes: Uint8Array): string {
  // Read IHDR+ chunks looking for tEXt/zTXt/iTXt with keyword "ccv3" or "chara".
  let offset = 8;
  while (offset < bytes.length - 12) {
    const length =
      (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3];
    const type = new TextDecoder("ascii").decode(
      bytes.subarray(offset + 4, offset + 8)
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (type === "tEXt" || type === "iTXt" || type === "zTXt") {
      const chunk = bytes.subarray(dataStart, dataEnd);
      const zeroIdx = chunk.indexOf(0);
      if (zeroIdx > -1) {
        const keyword = new TextDecoder("ascii").decode(chunk.subarray(0, zeroIdx));
        if (keyword === "ccv3" || keyword === "chara") {
          const payloadBytes = chunk.subarray(
            type === "tEXt" ? zeroIdx + 1 : zeroIdx + 2
          );
          const b64 = new TextDecoder("ascii").decode(payloadBytes).trim();
          return atob(b64);
        }
      }
    }
    if (type === "IEND") break;
    offset = dataEnd + 4; // skip CRC
  }
  throw new Error("PNG has no ccv3/chara tEXt chunk");
}

function normalize(parsed: unknown): AnyCard {
  const p = parsed as any;
  if (p?.spec === "chara_card_v3") return p as AnyCard;
  if (p?.spec === "chara_card_v2") return p as AnyCard;
  // Some older cards store the root fields directly — coerce to v2.
  if (p?.name && !p?.spec) {
    return {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: p.name,
        description: p.description,
        personality: p.personality,
        scenario: p.scenario,
        first_mes: p.first_mes ?? p.firstMes ?? p.greeting,
        mes_example: p.mes_example ?? p.mesExample ?? p.examples,
        tags: p.tags ?? [],
      },
    };
  }
  throw new Error("unrecognized character card format");
}
