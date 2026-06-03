// Per-character preference settings. Stored in localStorage; per-character
// keyed. Used by the UI to toggle auto-keep behavior and by the orchestrator
// to decide whether new candidates auto-promote or wait for click.
//
// Note: the preferences THEMSELVES live in YantrikDB under namespace
// `preferences:<character_id>`. This file is just for the UI's local
// settings (toggles, dismissed cache, etc.).

export interface CharacterPrefSettings {
  /** True (default): ordinary interpretations auto-promote to active
   *  once they hit threshold without asking the user. */
  auto_keep_ordinary: boolean;
  /** False (default): private interpretations require one-click
   *  confirmation. True opts the user into auto-promotion for this
   *  character — power-user mode, never the default. */
  trust_private: boolean;
  /** Always false — there's no auto-keep for limits, this is the safety
   *  floor. Stored so the UI can render the toggle as disabled with an
   *  explanation. */
  auto_keep_limits: false;
}

const KEY_PREFIX = "chronicler.character_pref_settings_v1.";

export function defaultSettings(): CharacterPrefSettings {
  return {
    auto_keep_ordinary: true,
    trust_private: false,
    auto_keep_limits: false,
  };
}

export function loadCharacterPrefSettings(
  character_id: string
): CharacterPrefSettings {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + character_id);
    if (!raw) return defaultSettings();
    const parsed = JSON.parse(raw);
    return {
      auto_keep_ordinary:
        typeof parsed.auto_keep_ordinary === "boolean"
          ? parsed.auto_keep_ordinary
          : true,
      trust_private:
        typeof parsed.trust_private === "boolean"
          ? parsed.trust_private
          : false,
      auto_keep_limits: false, // never auto-keep limits — safety floor
    };
  } catch {
    return defaultSettings();
  }
}

export function saveCharacterPrefSettings(
  character_id: string,
  settings: CharacterPrefSettings
): void {
  try {
    localStorage.setItem(
      KEY_PREFIX + character_id,
      JSON.stringify({
        auto_keep_ordinary: settings.auto_keep_ordinary,
        trust_private: settings.trust_private,
      })
    );
  } catch {
    /* quota / unavailable — skip */
  }
}
