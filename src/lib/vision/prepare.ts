// Turn whatever the player attached into a small JPEG. Re-encoding through a
// canvas also drops metadata (EXIF location, camera, timestamps) — a shared
// photo should not carry more than its pixels to a model.

export const MAX_SIDE = 1024;
const QUALITY = 0.85;
/** Refuse absurd inputs before decoding them. */
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;

export interface PreparedImage {
  /** SHA-256 hex of the JPEG bytes. */
  id: string;
  b64: string;
  mime: "image/jpeg";
  width: number;
  height: number;
  /** Size of the re-encoded JPEG. */
  bytes: number;
  /** Data URL for showing a thumbnail. */
  dataUrl: string;
}

/** Size to fit within MAX_SIDE on the longer edge, never upscaling. */
export function fitWithin(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function prepareImage(file: Blob): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) throw new Error("That file is not an image.");
  if (file.size > MAX_INPUT_BYTES) throw new Error("That image is too large (over 25 MB).");
  const bmp = await createImageBitmap(file);
  const { width, height } = fitWithin(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process the image in this browser.");
  // JPEG has no alpha: paint white first so transparent PNGs don't turn black.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close?.();
  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/jpeg", QUALITY));
  if (!blob) throw new Error("Could not encode the image.");
  const buf = await blob.arrayBuffer();
  const dataUrl = canvas.toDataURL("image/jpeg", QUALITY);
  return {
    id: await sha256Hex(buf),
    b64: dataUrl.slice(dataUrl.indexOf(",") + 1),
    mime: "image/jpeg",
    width,
    height,
    bytes: blob.size,
    dataUrl,
  };
}
