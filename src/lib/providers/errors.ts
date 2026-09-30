// Turn a failed provider response into a message a person can act on.
//
// Before this, streaming failures read "Ollama (local) stream failed: 404" —
// the status code only. To someone whose character never answers, that says
// nothing: the real reason ("model 'qwen3:4b' not found", "couldn't reach the
// server") was in the response body and was thrown away. The proxy already
// passes it through; this reads it and adds a plain-language hint for the
// handful of causes that account for most first-run failures.

export interface ProviderErrorContext {
  /** Human label of the provider, e.g. "Ollama (local)". */
  label: string;
  status: number;
  /** The upstream's own explanation, already extracted (may be empty). */
  detail: string;
  baseUrl?: string;
  model?: string;
}

/** Pull the most useful sentence out of an error body. Handles the shapes the
 *  supported providers use: {error:"…"}, {error:{message}}, {message}, plain text. */
export function extractErrorDetail(body: string): string {
  const text = body.trim();
  if (!text) return "";
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    const err = o.error;
    if (typeof err === "string") return err.trim();
    if (err && typeof err === "object") {
      const m = (err as Record<string, unknown>).message;
      if (typeof m === "string") return m.trim();
    }
    if (typeof o.message === "string") return o.message.trim();
  } catch {
    /* not JSON — use the text as-is */
  }
  return text.replace(/\s+/g, " ").slice(0, 240);
}

/** One readable message: what happened, what to try, and the raw status/detail
 *  so nothing is hidden from someone debugging. */
export function friendlyProviderError(c: ProviderErrorContext): string {
  const d = c.detail;
  const raw = `HTTP ${c.status}${d ? `: ${d}` : ""}`;
  const model = c.model ? `"${c.model}"` : "that model";
  const where = c.baseUrl ? ` at ${c.baseUrl}` : "";

  let hint = "";
  if (c.status === 502 && /unreachable|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|timed out/i.test(d)) {
    hint =
      `Couldn't reach ${c.label}${where}. Check that it is running and that the address in Settings is right. ` +
      `If Chronicler runs in Docker, "localhost" means the container itself — use http://host.docker.internal:11434 ` +
      `for Ollama on the same machine (on Linux, also start Ollama with OLLAMA_HOST=0.0.0.0).`;
  } else if (c.status === 404 && /not found|does not exist|no such model|unknown model/i.test(d)) {
    hint =
      `${c.label} doesn't have ${model}. For Ollama, run "ollama pull ${c.model ?? "<model>"}" in a terminal, ` +
      `or choose a model you already have in Settings.`;
  } else if (c.status === 401 || c.status === 403) {
    hint = `${c.label} rejected the credentials. Check the API key in Settings.`;
  } else if (c.status === 429) {
    hint = `${c.label} is rate-limiting this key or the quota is used up. Wait a moment or check your plan.`;
  } else if (c.status === 404) {
    hint = `${c.label} answered "not found" — the address${where} or the model name may be wrong. Check both in Settings.`;
  } else if (c.status >= 500) {
    hint = `${c.label} reported a server error. Try again; if it keeps happening, check that service's logs.`;
  }
  return hint ? `${hint} (${raw})` : `${c.label} failed (${raw})`;
}

/** Read a failed Response (bounded) and build the Error to throw. Never throws itself. */
export async function providerHttpError(
  label: string,
  res: { status: number; text: () => Promise<string> },
  extra: { baseUrl?: string; model?: string } = {}
): Promise<Error> {
  let body = "";
  try {
    body = (await res.text()).slice(0, 2000);
  } catch {
    /* body unreadable — the status alone is still reported */
  }
  return new Error(friendlyProviderError({ label, status: res.status, detail: extractErrorDetail(body), ...extra }));
}
