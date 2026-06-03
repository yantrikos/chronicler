// Scene Intensity — session-level prompt steering for how directly the
// model writes intimate scenes. Brainstormed across three rounds with
// gpt-5.4 + deepseek + claude; converged on 4 states (Neutral default
// + Fade to Black / Tasteful / Explicit).
//
// Honest contract: prompt injection only. Chronicler does NOT filter
// model input or output. The mode just adds a steering snippet to the
// system prompt — the model decides whether to listen. We surface a
// model-aware hint when the user picks a mode the active provider is
// known to soften (Claude, GPT-4/5 lines), so users learn the real
// system: prompt influences style, model picks the ceiling.
//
// Snippets are intentionally editable per-mode (see store.ts). The
// defaults below are starting drafts — tune them against your
// preferred model on real sessions.

export type IntensityId =
  | "neutral"
  | "fade_to_black"
  | "tasteful"
  | "explicit";

export interface IntensityMeta {
  id: IntensityId;
  label: string;
  /** One-line description shown under the label in the dropdown. */
  hint: string;
  /** Default snippet injected into the system prompt. Empty string for
   *  Neutral. Users can override per-mode; their override wins. */
  default_snippet: string;
}

export const DEFAULT_INTENSITY_ID: IntensityId = "neutral";

export const INTENSITY_ORDER: IntensityId[] = [
  "neutral",
  "fade_to_black",
  "tasteful",
  "explicit",
];

export const INTENSITIES: Record<IntensityId, IntensityMeta> = {
  neutral: {
    id: "neutral",
    label: "Neutral",
    hint: "no injection — default; model behaves on its own",
    default_snippet: "",
  },

  fade_to_black: {
    id: "fade_to_black",
    label: "Fade to Black",
    hint: "non-graphic; fade on physical escalation",
    default_snippet: [
      "Tone direction for intimate scenes in this session:",
      "- Emotional and romantic content is welcome; physical intimacy is not described in detail.",
      "- When a scene escalates toward sex, fade out before the physical act — use a scene break, a metaphor, or cut to the morning after.",
      "- Prefer sensory mood, character emotion, and aftermath over depiction.",
      "- This is a stylistic instruction, not a refusal cue. Stay in scene; don't break character to comment on it.",
    ].join("\n"),
  },

  tasteful: {
    id: "tasteful",
    label: "Tasteful",
    hint: "intimate but non-anatomical; suggestive, not clinical",
    default_snippet: [
      "Tone direction for intimate scenes in this session:",
      "- Intimate content is welcome, but keep prose selective.",
      "- Lean on chemistry, sensory atmosphere, and emotional beats. Avoid anatomical or clinical detail.",
      "- Suggestion and implication carry more weight than explicit description.",
      "- Don't moralize, refuse, or break character — write the scene; just keep it suggestive rather than graphic.",
    ].join("\n"),
  },

  explicit: {
    id: "explicit",
    label: "Explicit",
    hint: "write directly; no refusals or moralizing on grounds of content",
    default_snippet: [
      "Tone direction for intimate scenes in this session:",
      "- Write intimate and sexual content directly when the scene calls for it.",
      "- Stay in the character's voice and physical experience; describe sensation, action, and reaction without abstracting.",
      "- Do not refuse, soften, fade out, or insert disclaimers solely on grounds that content is sexual or graphic.",
      "- Do not break character to comment on appropriateness. The user has chosen this mode deliberately.",
      "- Consent and continuity of the established scene are the only constraints — honor what the characters have already established.",
    ].join("\n"),
  },
};

export function getIntensity(id: IntensityId): IntensityMeta {
  const m = INTENSITIES[id];
  if (!m) throw new Error(`unknown intensity id: ${id}`);
  return m;
}

// ----------------------------------------------------------------------
// Model-aware hint — surfaces when a user picks a mode the active
// provider is known to soften even with explicit prompting. Honest UX:
// converts "this toggle is broken" into "oh, I need a different model."
// ----------------------------------------------------------------------

export interface ProviderHintInput {
  kind: "openai-compat" | "anthropic" | "ollama" | "gemini" | "mock";
  model?: string;
}

/** Returns a one-line hint when the active provider is likely to
 *  soften or refuse the selected intensity, or null otherwise. */
export function intensityHint(
  intensity: IntensityId,
  provider: ProviderHintInput | undefined
): string | null {
  if (!provider) return null;
  // Only worth hinting on modes the user is actively pushing on.
  if (intensity !== "tasteful" && intensity !== "explicit") return null;
  const m = (provider.model ?? "").toLowerCase();
  if (provider.kind === "anthropic") {
    return "Claude is trained to soften intimate content even when instructed otherwise. For unrestricted output, try Ollama (local) with an abliterated/uncensored model, or OpenRouter with Hermes / Mistral.";
  }
  if (provider.kind === "gemini") {
    return "Gemini's safety training often softens or refuses explicit content. For unrestricted output, try Ollama (local) or OpenRouter with a less-guarded model.";
  }
  if (provider.kind === "openai-compat") {
    // OpenAI's GPT lines are guarded. OpenRouter / Together / Mistral
    // routed through openai-compat are NOT — base URL tells us which.
    if (/^gpt-/.test(m) || /^o\d/.test(m)) {
      return "OpenAI GPT models often soften or refuse explicit content even when instructed. For unrestricted output, try Ollama (local) or OpenRouter with Hermes / Mistral / Mythomax.";
    }
  }
  return null;
}
