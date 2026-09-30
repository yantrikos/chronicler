// The one place that decides whether an image is needed and gets it: cache
// first, then the backend, with in-flight de-duplication so two triggers for
// the same picture cost one request. Nothing here runs unless the caller has
// already checked the user enabled generation.

import type { SceneState } from "../scene/state";
import { makeImageBackend } from "./backends";
import type { ImageCache } from "./cache";
import { backdropPrompt, cacheKey, portraitPrompt, timeBucket, type PortraitSubject } from "./prompts";
import {
  DEFAULT_BACKDROP_SIZE, DEFAULT_PORTRAIT_SIZE, parseSize,
  type ImagesConfig, type PostJson,
} from "./types";

export interface ImageResult {
  url: string;
  cached: boolean;
}

export class ImageService {
  private inflight = new Map<string, Promise<ImageResult>>();
  /** Number of requests actually sent to the backend (for tests / display). */
  requests = 0;

  constructor(private cache: ImageCache, private post: PostJson) {}

  private async fetchOnce(
    key: string,
    cfg: ImagesConfig,
    size: string,
    prompt: string,
    negative: string,
    signal?: AbortSignal,
    force = false
  ): Promise<ImageResult> {
    if (!force) {
      const hit = await this.cache.get(key);
      if (hit) return { url: hit, cached: true };
      const running = this.inflight.get(key);
      if (running) return running;
    }
    if (!cfg.backend) throw new Error("no image backend configured");
    const backend = makeImageBackend(cfg.backend, this.post);
    const { width, height } = parseSize(size, size);
    const job = (async () => {
      this.requests++;
      const url = await backend.generate({ prompt, negative, width, height }, signal);
      await this.cache.set(key, url);
      return { url, cached: false };
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  portrait(c: PortraitSubject, cfg: ImagesConfig, signal?: AbortSignal): Promise<ImageResult> {
    const size = cfg.backend?.portrait_size ?? DEFAULT_PORTRAIT_SIZE;
    const { prompt, negative } = portraitPrompt(c, cfg.style?.trim() || undefined);
    return this.fetchOnce(cacheKey("portrait", cfg.backend?.model, size, prompt), cfg, size, prompt, negative, signal);
  }

  /** null when the board has no location yet. The cache key uses the location
   *  and time bucket only — not the mood wording — so a place is drawn at most
   *  once per time of day however the board phrases it. */
  async backdrop(board: SceneState, cfg: ImagesConfig, signal?: AbortSignal, force = false): Promise<ImageResult | null> {
    const p = backdropPrompt(board, cfg.style?.trim() || undefined);
    if (!p) return null;
    const size = cfg.backend?.backdrop_size ?? DEFAULT_BACKDROP_SIZE;
    const key = cacheKey("backdrop", cfg.backend?.model, size, `${board.location!.toLowerCase()}|${timeBucket(board.time) ?? ""}`);
    return this.fetchOnce(key, cfg, size, p.prompt, p.negative, signal, force);
  }
}
