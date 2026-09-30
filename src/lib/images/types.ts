// Optional generated graphics. Everything here is opt-in: nothing is ever
// requested from an image backend unless the user turned "Generated images"
// on in Settings and pointed it at a backend they control.

export type ImageBackendKind = "openai" | "a1111";

export interface ImageBackendConfig {
  kind: ImageBackendKind;
  /** OpenAI-style: e.g. https://api.openai.com/v1 (or any compatible server).
   *  A1111: the server root, e.g. http://host.docker.internal:7860 */
  base_url: string;
  api_key?: string;
  model?: string;
  /** "WxH" — portraits are square-ish, backdrops wide. */
  portrait_size?: string;
  backdrop_size?: string;
}

export interface ImagesConfig {
  /** Tint the interface with the scene's time of day and mood. Needs no
   *  backend and no model. Default: on. */
  ambient?: boolean;
  /** Generate character portraits and location backdrops. Default: off. */
  generate?: boolean;
  backend?: ImageBackendConfig;
  /** Appended to every prompt so images share one look. */
  style?: string;
}

export interface ImageRequest {
  prompt: string;
  negative?: string;
  width: number;
  height: number;
}

/** Sends one JSON POST and returns the parsed JSON body. Injectable so the
 *  backends can be tested without a network. */
export type PostJson = (
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal
) => Promise<unknown>;

export interface ImageBackend {
  /** Returns something an <img src> / CSS url() can show: a data: URL, or the
   *  backend's own URL when it only returns one. */
  generate(req: ImageRequest, signal?: AbortSignal): Promise<string>;
}

export const DEFAULT_STYLE =
  "painterly digital illustration, soft dramatic lighting, rich colour, no text, no watermark";
export const DEFAULT_NEGATIVE = "text, watermark, signature, logo, extra fingers, deformed, blurry, low quality";
export const DEFAULT_PORTRAIT_SIZE = "512x512";
export const DEFAULT_BACKDROP_SIZE = "1024x576";

export function parseSize(size: string | undefined, fallback: string): { width: number; height: number } {
  const m = /^(\d{2,4})\s*[x×]\s*(\d{2,4})$/i.exec((size ?? "").trim()) ?? /^(\d{2,4})\s*[x×]\s*(\d{2,4})$/i.exec(fallback)!;
  return { width: Number(m[1]), height: Number(m[2]) };
}
