// Theme registry + persistence. The palettes themselves live in
// src/themes.css; this file only names them and applies the choice.

export type ThemeMode = "dark" | "light";

export interface ThemeDef {
  id: string;
  name: string;
  blurb: string;
  mode: ThemeMode;
  /** Swatch colours for the picker: [surface, panel, accent]. Approximations
   *  of the CSS palette — display only. */
  swatch: [string, string, string];
}

export const THEMES: ThemeDef[] = [
  {
    id: "aurora",
    name: "Aurora",
    blurb: "Ink-blue and violet, with a soft aurora glow.",
    mode: "dark",
    swatch: ["#15121f", "#241f36", "#8b6cf0"],
  },
  {
    id: "ember",
    name: "Ember",
    blurb: "Warm charcoal lit by firelight.",
    mode: "dark",
    swatch: ["#1a1512", "#2b231d", "#f08a3c"],
  },
  {
    id: "abyss",
    name: "Abyss",
    blurb: "Near-black for OLED, with a teal edge.",
    mode: "dark",
    swatch: ["#0a0d0e", "#151b1d", "#2fc4c0"],
  },
  {
    id: "verdant",
    name: "Verdant",
    blurb: "Deep forest and emerald.",
    mode: "dark",
    swatch: ["#0f1713", "#1b2a22", "#3fbf8a"],
  },
  {
    id: "parchment",
    name: "Parchment",
    blurb: "Warm paper and terracotta. Made for long reading.",
    mode: "light",
    swatch: ["#f8f2e8", "#efe5d3", "#c2683a"],
  },
  {
    id: "daylight",
    name: "Daylight",
    blurb: "Clean, cool and bright.",
    mode: "light",
    swatch: ["#f6f8fc", "#e9eef7", "#4f6ef0"],
  },
  {
    id: "classic",
    name: "Classic",
    blurb: "The original flat neutral and emerald.",
    mode: "dark",
    swatch: ["#0e0e10", "#262629", "#2fb383"],
  },
];

export const DEFAULT_THEME_ID = "aurora";
const STORAGE_KEY = "chronicler:theme";

export function getTheme(id: string | null | undefined): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function getStoredThemeId(): string {
  try {
    // ?theme=<id> wins for the session — handy for sharing and screenshots.
    const fromUrl = new URLSearchParams(window.location.search).get("theme");
    if (fromUrl && THEMES.some((t) => t.id === fromUrl)) return fromUrl;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && THEMES.some((t) => t.id === stored)) return stored;
  } catch {
    // storage blocked — fall through to the default
  }
  return DEFAULT_THEME_ID;
}

/** Apply a theme to the document. Safe to call repeatedly. */
export function applyTheme(id: string, opts: { persist?: boolean } = {}): ThemeDef {
  const theme = getTheme(id);
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.dataset.mode = theme.mode;
  // Keep browser chrome in step with the theme.
  document
    .querySelector('meta[name="color-scheme"]')
    ?.setAttribute("content", theme.mode);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme.swatch[0]);
  if (opts.persist) {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme.id);
    } catch {
      // storage blocked — the choice just won't survive a reload
    }
  }
  return theme;
}

/** Call once, before first render, so there is no flash of the wrong theme. */
export function initTheme(): void {
  applyTheme(getStoredThemeId());
}
