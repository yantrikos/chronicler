// Turning a model's "thinking" off, per backend.
//
// Roleplay wants the answer, fast. Reasoning models (Qwen3 / 3.5 / 3.8, DeepSeek-R1, gpt-oss…)
// think first, and that thinking counts against the reply's token budget. Left on, a model can
// spend the whole budget reasoning and finish with an EMPTY reply and no error — which looks like
// "the character never answers". The knob that turns it off differs by backend, and several
// backends silently ignore the wrong one. Verified against Ollama 0.33 on 2026-09-30:
//
//   Ollama native  /api/chat             think: false            works (gpt-oss ignores false → use "low")
//   Ollama OpenAI  /v1/chat/completions  reasoning_effort:"none" works; think:false and
//                                        chat_template_kwargs are SILENTLY IGNORED
//   vLLM / llama.cpp server / LM Studio  chat_template_kwargs.enable_thinking:false   (documented by those
//                                        projects; NOT verified here — no such server was available)

/** How an OpenAI-compatible provider is asked to stop thinking. "none" sends nothing. */
export type ThinkingStyle = "none" | "reasoning_effort" | "template_kwargs";

/** Ollama's native `think` value when thinking is to be off. gpt-oss cannot be turned off and
 *  ignores `false`; its lowest level is the closest thing and was the fastest in testing. */
export function ollamaThinkOff(model: string): false | "low" {
  return /^gpt-oss/i.test(model.trim()) ? "low" : false;
}

/** Extra fields for an OpenAI-compatible request body. */
export function openAiThinkingFields(style: ThinkingStyle | undefined): Record<string, unknown> {
  if (style === "reasoning_effort") return { reasoning_effort: "none" };
  if (style === "template_kwargs") return { chat_template_kwargs: { enable_thinking: false } };
  return {};
}

/** A sensible default style for an OpenAI-compatible base URL, or "none" when unsure.
 *  Port 11434 is Ollama's; its /v1 endpoint needs reasoning_effort. */
export function guessThinkingStyle(baseUrl: string): ThinkingStyle {
  return /:11434(\/|$)/.test(baseUrl.trim()) ? "reasoning_effort" : "none";
}

export interface EmptyReplyInfo {
  /** Characters of hidden reasoning that arrived. */
  thinkingChars: number;
  /** Why the model stopped, if it said ("length" = ran out of tokens). */
  finishReason?: string;
  /** Whether the stream ended with the backend's own completion marker. */
  completed: boolean;
  maxTokens?: number;
}

/** The message for a reply that produced no text, saying what most likely happened and what to do. */
export function emptyReplyMessage(label: string, i: EmptyReplyInfo): string {
  if (i.thinkingChars > 0 && (i.finishReason === "length" || !i.completed)) {
    return (
      `${label} spent its whole reply budget${i.maxTokens ? ` (${i.maxTokens} tokens)` : ""} thinking and wrote no text. ` +
      `Turn thinking off for this provider in Settings (recommended for Qwen3/3.5/3.8, DeepSeek-R1 and other reasoning models), ` +
      `or raise the max response tokens.`
    );
  }
  if (i.thinkingChars > 0) {
    return `${label} produced only hidden reasoning and no text. Turn thinking off for this provider in Settings.`;
  }
  if (!i.completed) {
    return (
      `The connection to ${label} ended before it wrote anything — it timed out or dropped. ` +
      `A large or slow model (especially one that thinks first) can take minutes; try a smaller model or turn thinking off in Settings.`
    );
  }
  return `${label} returned an empty reply. Check the model name in Settings, and try turning thinking off.`;
}
