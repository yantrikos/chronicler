import { useState } from "react";
import { THEMES, applyTheme, getStoredThemeId } from "../../lib/ui/theme";

/** Appearance picker. Applies instantly and persists per device — a theme is
 *  a display preference, so it is deliberately not part of the saved config
 *  (no Save button, and it is not carried in backups). */
export function ThemePicker() {
  const [active, setActive] = useState(getStoredThemeId);

  function choose(id: string): void {
    applyTheme(id, { persist: true });
    setActive(id);
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-neutral-200 mb-2">Appearance</h3>
      <div
        role="radiogroup"
        aria-label="Theme"
        className="grid grid-cols-2 sm:grid-cols-3 gap-2"
      >
        {THEMES.map((t) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => choose(t.id)}
              className={`text-left rounded-lg border p-2.5 ${
                selected
                  ? "border-emerald-500 ring-1 ring-emerald-500/60 bg-neutral-800"
                  : "border-neutral-700 hover:border-neutral-500 bg-neutral-900"
              }`}
            >
              <div
                className="h-9 rounded-md mb-2 flex items-end gap-1 p-1 border border-black/20"
                style={{ background: t.swatch[0] }}
                aria-hidden="true"
              >
                <span className="flex-1 h-4 rounded" style={{ background: t.swatch[1] }} />
                <span className="w-6 h-4 rounded" style={{ background: t.swatch[2] }} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-neutral-100">{t.name}</span>
                <span className="text-[10px] text-neutral-500">{t.mode}</span>
              </div>
              <p className="text-[10px] text-neutral-400 leading-snug mt-0.5">{t.blurb}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
