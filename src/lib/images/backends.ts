// Image backends: an OpenAI-style /images/generations endpoint (which many
// local and hosted servers copy) and the AUTOMATIC1111 web-UI API. Each turns
// an ImageRequest into something displayable, and turns every failure into a
// readable Error — the UI shows it, it never crashes a chat.

import type { ImageBackend, ImageBackendConfig, ImageRequest, PostJson } from "./types";

const trimSlash = (u: string) => u.replace(/\/+$/, "");

function asDataUrl(b64: string, mime = "image/png"): string {
  return b64.startsWith("data:") ? b64 : `data:${mime};base64,${b64}`;
}

function detail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class OpenAIImagesBackend implements ImageBackend {
  constructor(private cfg: ImageBackendConfig, private post: PostJson) {}

  async generate(req: ImageRequest, signal?: AbortSignal): Promise<string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.cfg.api_key) headers.authorization = `Bearer ${this.cfg.api_key}`;
    let json: any;
    try {
      json = await this.post(
        `${trimSlash(this.cfg.base_url)}/images/generations`,
        headers,
        {
          ...(this.cfg.model ? { model: this.cfg.model } : {}),
          prompt: req.prompt,
          n: 1,
          size: `${req.width}x${req.height}`,
          response_format: "b64_json",
        },
        signal
      );
    } catch (e) {
      throw new Error(`image backend unreachable: ${detail(e)}`);
    }
    if (json?.error) throw new Error(`image backend error: ${json.error.message ?? json.error}`);
    const first = json?.data?.[0];
    if (first?.b64_json) return asDataUrl(first.b64_json);
    if (typeof first?.url === "string") return first.url;
    throw new Error("image backend returned no image");
  }
}

export class A1111Backend implements ImageBackend {
  constructor(private cfg: ImageBackendConfig, private post: PostJson) {}

  async generate(req: ImageRequest, signal?: AbortSignal): Promise<string> {
    let json: any;
    try {
      json = await this.post(
        `${trimSlash(this.cfg.base_url)}/sdapi/v1/txt2img`,
        { "content-type": "application/json" },
        {
          prompt: req.prompt,
          negative_prompt: req.negative ?? "",
          width: req.width,
          height: req.height,
          steps: 20,
          ...(this.cfg.model ? { override_settings: { sd_model_checkpoint: this.cfg.model } } : {}),
        },
        signal
      );
    } catch (e) {
      throw new Error(`image backend unreachable: ${detail(e)}`);
    }
    if (json?.error) throw new Error(`image backend error: ${json.detail ?? json.error}`);
    const b64 = json?.images?.[0];
    if (typeof b64 === "string" && b64.length > 0) return asDataUrl(b64);
    throw new Error("image backend returned no image");
  }
}

export function makeImageBackend(cfg: ImageBackendConfig, post: PostJson): ImageBackend {
  return cfg.kind === "a1111" ? new A1111Backend(cfg, post) : new OpenAIImagesBackend(cfg, post);
}
