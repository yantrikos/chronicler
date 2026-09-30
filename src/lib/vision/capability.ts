// Does a model read images? For Ollama this is knowable: /api/show lists the
// model's capabilities, and "vision" is one of them. Other provider kinds
// don't expose it uniformly, so it is set by hand in Settings.

import type { ProviderConfigEntry } from "../config";
import type { PostJson } from "../images/types";

/** true/false when known, undefined when it can't be determined. */
export async function detectVision(p: ProviderConfigEntry, post: PostJson): Promise<boolean | undefined> {
  if (p.kind !== "ollama" || !p.base_url) return undefined;
  const root = p.base_url.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
  try {
    const json = (await post(`${root}/api/show`, { "content-type": "application/json" }, { model: p.model })) as {
      capabilities?: unknown;
    };
    return Array.isArray(json.capabilities) ? json.capabilities.includes("vision") : undefined;
  } catch {
    return undefined;
  }
}
