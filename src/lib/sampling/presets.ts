// Scene-coded sampling presets.
//
// SillyTavern's community knowledge about "what sampler tuple works for ERP
// on Mistral" lives in Discord screenshots and Reddit comments. This file is
// where that folklore stops being folklore. Six presets, scene-named for the
// audience that actually uses them, with model-family deltas under the hood
// so the same preset feels right on Mistral, Qwen, Claude, Llama, DeepSeek,
// and unknown OpenAI-compat fallbacks.
//
// Brainstorm (gpt-5.4 + deepseek-chat + claude) converged on this set in
// /code-review-equivalent two-round debate. See CHANGELOG v0.2.0 for the
// rationale; this file just ships the result.
//
// Scope: sampling only. Anything else (disable_thinking, max_tokens,
// retrieval budgets, lorebook depth, prompt scaffolding) stays on its
// existing surface — bundling them into presets makes "High Heat" silently
// change retrieval behavior, which violates the predictability promise.

import type { ProviderConfigEntry } from "../config";
import type { SamplingOptions } from "../providers";

export type PresetId =
  | "slow_burn"
  | "high_heat"
  | "companion"
  | "storyteller"
  | "game_master"
  | "canon_keeper";

export interface SamplingPreset {
  id: PresetId;
  label: string;
  subtitle: string;
  description: string;
  base: Required<SamplingOptions>;
}

export const DEFAULT_PRESET_ID: PresetId = "slow_burn";

export const PRESETS: SamplingPreset[] = [
  {
    id: "slow_burn",
    label: "Slow Burn",
    subtitle: "grounded dialogue, room for chemistry",
    description:
      "Default. Steady, in-character dialogue. Good for romantic buildup, everyday chat, fandom conversations, subtle scenes.",
    base: {
      temperature: 0.82,
      top_p: 0.92,
      top_k: 40,
      min_p: 0.06,
      repetition_penalty: 1.08,
    },
  },
  {
    id: "high_heat",
    label: "High Heat",
    subtitle: "vivid, impulsive, expressive",
    description:
      "For intense romantic, erotic, or emotionally charged scenes. Higher temperature and looser sampling for vivid, less clinical phrasing; minimal repetition penalty so rhythmic phrasing and call-backs survive.",
    base: {
      temperature: 0.98,
      top_p: 0.95,
      top_k: 60,
      min_p: 0.03,
      repetition_penalty: 1.04,
    },
  },
  {
    id: "companion",
    label: "Companion",
    subtitle: "warm, supportive, emotionally stable",
    description:
      "Comfort chat, reassurance, reflective conversation. Tight sampling for steady tone, higher repetition penalty to break out of reassurance loops.",
    base: {
      temperature: 0.72,
      top_p: 0.90,
      top_k: 30,
      min_p: 0.08,
      repetition_penalty: 1.10,
    },
  },
  {
    id: "storyteller",
    label: "Storyteller",
    subtitle: "collaborative prose and long-form scenes",
    description:
      "Co-writing, scene continuation, descriptive prose. Broader vocabulary range than dialogue presets; stronger repetition penalty because long-form models echo sentence scaffolds.",
    base: {
      temperature: 0.86,
      top_p: 0.94,
      top_k: 50,
      min_p: 0.05,
      repetition_penalty: 1.12,
    },
  },
  {
    id: "game_master",
    label: "Game Master",
    subtitle: "structured adventure, consequences, NPC motion",
    description:
      "TTRPG, quests, world-state progression. Lower variance for rule-like consistency; higher repetition penalty to break recap loops and 'what do you do?' templating.",
    base: {
      temperature: 0.78,
      top_p: 0.90,
      top_k: 40,
      min_p: 0.07,
      repetition_penalty: 1.10,
    },
  },
  {
    id: "canon_keeper",
    label: "Canon Keeper",
    subtitle: "tighter voice, lore-respecting chat",
    description:
      "Fandom IP characters, rehearsal, or any character with a strong card-defined voice. Cooler temperature and tighter top-p/top-k keep the model on-character; aggressive min_p suppresses OOC drift.",
    base: {
      temperature: 0.68,
      top_p: 0.88,
      top_k: 30,
      min_p: 0.08,
      repetition_penalty: 1.12,
    },
  },
];

export function getPreset(id: PresetId): SamplingPreset {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`unknown preset id: ${id}`);
  return p;
}

// ----------------------------------------------------------------------
// Family detection
// ----------------------------------------------------------------------
//
// Best-effort match by model string. We do NOT need a perfect taxonomy —
// catching the major families (Mistral / Qwen / Llama / Claude / DeepSeek)
// covers ~95% of provider configurations in practice. Unknown falls back to
// the OpenAI-compat path which just passes through whatever the provider
// supports.

export type ModelFamily =
  | "anthropic"
  | "mistral"
  | "qwen"
  | "llama"
  | "deepseek"
  | "openai_compat";

export function detectModelFamily(
  provider: ProviderConfigEntry | undefined
): ModelFamily {
  if (!provider) return "openai_compat";
  if (provider.kind === "anthropic") return "anthropic";
  const name = (provider.model ?? "").toLowerCase();
  if (/mixtral|mistral/.test(name)) return "mistral";
  if (/qwen/.test(name)) return "qwen";
  if (/llama|hermes|wizard/.test(name)) return "llama";
  if (/deepseek/.test(name)) return "deepseek";
  return "openai_compat";
}

// ----------------------------------------------------------------------
// Resolution
// ----------------------------------------------------------------------
//
// Two outputs from `resolvePreset`:
//   1. `sampling`: the SamplingOptions to actually send to the provider.
//      Unsupported fields are stripped (Anthropic loses min_p and rep_pen
//      regardless of preset).
//   2. `supportedFields`: an array of the field names that survived, used
//      by the UI to render the "3 of 5 controls apply" subscript.

export interface ResolvedPreset {
  preset_id: PresetId;
  sampling: SamplingOptions;
  family: ModelFamily;
  supported_fields: Array<keyof SamplingOptions>;
}

export function resolvePreset(
  presetId: PresetId,
  provider: ProviderConfigEntry | undefined
): ResolvedPreset {
  const preset = getPreset(presetId);
  const family = detectModelFamily(provider);
  const adjusted = applyFamilyDelta(preset, family);
  const { sampling, supported_fields } = stripUnsupported(adjusted, family);
  return { preset_id: presetId, sampling, family, supported_fields };
}

// Family delta table — applied to the base preset BEFORE stripping
// unsupported fields. Numbers are absolute deltas; clamps keep us inside
// the safe-band.
function applyFamilyDelta(
  preset: SamplingPreset,
  family: ModelFamily
): Required<SamplingOptions> {
  const out = { ...preset.base };
  switch (family) {
    case "anthropic":
      // Claude runs hot at equivalent numeric settings; cool the temperature
      // and never let it drop below 0.60. Cap top_k at 40 to keep voice
      // consistent.
      out.temperature = Math.max(0.6, out.temperature - 0.08);
      out.top_k = Math.min(out.top_k, 40);
      break;
    case "qwen":
      // Qwen-family models echo less, so the standard rep_penalty over-
      // corrects. Hotter presets also need a slight cool-down to avoid
      // structural weirdness.
      out.repetition_penalty = Math.max(1.0, out.repetition_penalty - 0.04);
      if (preset.id === "high_heat" || preset.id === "storyteller") {
        out.temperature = Math.max(0.5, out.temperature - 0.03);
      }
      break;
    case "mistral":
      // Mistral is the family the base values were tuned for. Nothing to do.
      break;
    case "llama":
      // Llama-family is tolerant; base values are fine.
      break;
    case "deepseek":
      // DeepSeek benefits from a wider top_k (its empirical sweet spot).
      out.top_k = out.top_k + 10;
      break;
    case "openai_compat":
      // Unknown — base values, let the provider sort out which fields it
      // honors.
      break;
  }
  return out;
}

// Anthropic strips min_p + repetition_penalty (not supported by the v1
// messages API). Other families pass through; the provider drops fields it
// doesn't understand.
function stripUnsupported(
  full: Required<SamplingOptions>,
  family: ModelFamily
): {
  sampling: SamplingOptions;
  supported_fields: Array<keyof SamplingOptions>;
} {
  if (family === "anthropic") {
    return {
      sampling: {
        temperature: full.temperature,
        top_p: full.top_p,
        top_k: full.top_k,
      },
      supported_fields: ["temperature", "top_p", "top_k"],
    };
  }
  return {
    sampling: { ...full },
    supported_fields: [
      "temperature",
      "top_p",
      "top_k",
      "min_p",
      "repetition_penalty",
    ],
  };
}

// ----------------------------------------------------------------------
// Custom-state detection
// ----------------------------------------------------------------------
//
// Once the user wiggles any slider, the preset display flips to
// "Custom (was: X)" with a one-click reapply button. We need a stable
// equality check that ignores fields the provider strips.

export function samplingMatchesPreset(
  current: SamplingOptions | undefined,
  resolved: ResolvedPreset
): boolean {
  if (!current) return false;
  for (const field of resolved.supported_fields) {
    const a = current[field];
    const b = resolved.sampling[field];
    if (a === undefined && b === undefined) continue;
    if (a === undefined || b === undefined) return false;
    if (typeof a === "number" && typeof b === "number") {
      if (Math.abs(a - b) > 0.005) return false;
    } else if (a !== b) {
      return false;
    }
  }
  return true;
}
