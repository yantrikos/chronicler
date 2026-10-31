// Learn what each model will accept.
//
// Model APIs keep changing which request parameters they take, and they disagree: Claude's newer models
// reject `temperature` ("`temperature` is deprecated for this model"); OpenAI's reasoning models reject
// `max_tokens` (use `max_completion_tokens`) and any non-default temperature; Mistral insists on strict
// message ordering; Gemini names its sampling fields differently. A fixed request can never be right for
// every model, and a model released tomorrow will have new rules. So instead of guessing, the provider
// reads the 400, works out which parameter (or ordering) was refused, retries without it, and REMEMBERS —
// per server and model — so it is right the first time on the next message and the next session.

export type CompatKind = "openai" | "anthropic" | "gemini" | "ollama";

export interface Compat {
  /** Optional request parameters this model refused; left out from now on. */
  drop: string[];
  /** OpenAI reasoning models: `max_tokens` must be sent as `max_completion_tokens`. */
  tokenParam?: "max_completion_tokens";
  /** The server insists on strictly alternating roles, starting with the user and ending with the user. */
  strictRoles?: boolean;
}

/** Parameters that are optional everywhere — safe to leave out. (Never model, messages or the token limit.) */
const OPTIONAL = [
  "temperature", "top_p", "top_k", "min_p", "repetition_penalty", "frequency_penalty", "presence_penalty",
  "seed", "stop", "logit_bias", "reasoning_effort", "think", "chat_template_kwargs", "stream_options",
] as const;

/** How a parameter may be spelled in an error message (Gemini says topP, others top_p). */
const ALIASES: Record<string, string[]> = {
  top_p: ["top_p", "topP"],
  top_k: ["top_k", "topK"],
  frequency_penalty: ["frequency_penalty", "frequencyPenalty"],
  presence_penalty: ["presence_penalty", "presencePenalty"],
};

const REFUSAL_WORDS = /unsupported|not supported|isn't supported|deprecated|unknown|unrecognized|unrecognised|invalid|does not support|doesn't support|cannot|can't|only the default|not allowed|not permitted|extra inputs|unexpected|not available/i;

export const emptyCompat = (): Compat => ({ drop: [] });

/** The optional parameters we sent that this error message names. */
export function paramsMentioned(text: string, sent: readonly string[]): string[] {
  const out: string[] = [];
  for (const p of OPTIONAL) {
    if (!sent.includes(p)) continue;
    const names = ALIASES[p] ?? [p];
    if (names.some((n) => new RegExp(`(^|[^a-z0-9_])${n}([^a-z0-9_]|$)`, "i").test(text))) out.push(p);
  }
  return out;
}

export interface Learned {
  changed: boolean;
  /** Plain-language notes about what was learned, e.g. "leaves out temperature". */
  notes: string[];
}

/** Update `c` from a refused request. Only 400 / 422 are treated as "the request itself was refused". */
export function learnFromRejection(c: Compat, kind: CompatKind, status: number, text: string, sent: readonly string[]): Learned {
  const notes: string[] = [];
  if (status !== 400 && status !== 422) return { changed: false, notes };

  if (kind === "openai" && c.tokenParam !== "max_completion_tokens" && sent.includes("max_tokens") && /max_completion_tokens/i.test(text) && /max_tokens/i.test(text)) {
    c.tokenParam = "max_completion_tokens";
    notes.push("sends max_completion_tokens instead of max_tokens");
  }
  if (REFUSAL_WORDS.test(text)) {
    for (const p of paramsMentioned(text, sent)) {
      if (!c.drop.includes(p)) {
        c.drop.push(p);
        notes.push(`leaves out ${p}`);
      }
    }
  }
  if (kind === "openai" && !c.strictRoles && /(\brole\b|alternat|last message|first message|must be (a )?user|after (an )?assistant|expected last role)/i.test(text)) {
    c.strictRoles = true;
    notes.push("uses strict message ordering");
  }
  return { changed: notes.length > 0, notes };
}

/** Human-readable description of what has been adapted, for Settings → Test connection. */
export function describeCompat(c: Compat): string[] {
  const out: string[] = [];
  if (c.drop.length) out.push(`leaves out ${c.drop.join(", ")}`);
  if (c.tokenParam) out.push("sends max_completion_tokens instead of max_tokens");
  if (c.strictRoles) out.push("uses strict message ordering");
  return out;
}

// ── persistence (per browser; tiny; never throws) ──
const LS_KEY = "chronicler.provider.compat.v1";
const memory = new Map<string, Compat>();

function readAll(): Record<string, Compat> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Compat>) : {};
  } catch {
    return {};
  }
}

/** One entry per server + model: the same key with a different model is a different set of rules. */
export const compatKey = (kind: CompatKind, baseUrl: string, model: string): string =>
  `${kind}|${baseUrl.trim().toLowerCase().replace(/\/+$/, "")}|${model.trim()}`;

export function getCompat(key: string): Compat {
  const stored = readAll()[key] ?? memory.get(key);
  return { drop: [...(stored?.drop ?? [])], tokenParam: stored?.tokenParam, strictRoles: stored?.strictRoles };
}

export function saveCompat(key: string, c: Compat): void {
  memory.set(key, c);
  try {
    const all = readAll();
    all[key] = c;
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable — it is remembered for this page load only */
  }
}

/** Forget what was learned (all models, or one). A model that gains support can then be tried again. */
export function forgetCompat(key?: string): void {
  if (key === undefined) memory.clear();
  else memory.delete(key);
  try {
    if (key === undefined) localStorage.removeItem(LS_KEY);
    else {
      const all = readAll();
      delete all[key];
      localStorage.setItem(LS_KEY, JSON.stringify(all));
    }
  } catch {
    /* ignore */
  }
}

/** Top-level keys of a request body plus the sampling keys nested under Gemini's `generationConfig` and Ollama's `options`. */
export function sentKeys(body: Record<string, unknown>): string[] {
  const keys = new Set(Object.keys(body));
  for (const nested of ["generationConfig", "options"]) {
    const o = body[nested];
    if (o && typeof o === "object") for (const k of Object.keys(o as Record<string, unknown>)) keys.add(k);
  }
  // Gemini's spellings map back onto the common names.
  if (keys.has("topP")) keys.add("top_p");
  if (keys.has("topK")) keys.add("top_k");
  return [...keys];
}

export interface AdaptiveResult {
  res: Response;
  /** What this call learned (empty when the first try worked). */
  learned: string[];
}

/** POST, and if the model refuses a parameter or ordering, learn it, retry, and remember. At most `maxAttempts` tries. */
export async function sendAdaptive(opts: {
  key: string;
  kind: CompatKind;
  build: (c: Compat) => Record<string, unknown>;
  post: (body: Record<string, unknown>) => Promise<Response>;
  maxAttempts?: number;
}): Promise<AdaptiveResult> {
  const compat = getCompat(opts.key);
  const learned: string[] = [];
  const max = opts.maxAttempts ?? 6; // a model can need several adjustments at once (e.g. token name + temperature + top_p)
  for (let attempt = 1; ; attempt++) {
    const body = opts.build(compat);
    const res = await opts.post(body);
    if ((res.status !== 400 && res.status !== 422) || attempt >= max) return { res, learned };
    const text = await res.text();
    const l = learnFromRejection(compat, opts.kind, res.status, text, sentKeys(body));
    if (!l.changed) return { res: new Response(text, { status: res.status }), learned };
    learned.push(...l.notes);
    saveCompat(opts.key, compat);
  }
}
