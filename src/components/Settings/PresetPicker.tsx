// Header dropdown that picks a scene preset. The active preset's resolved
// sampling tuple flows into the orchestrator's per-turn config; advanced
// per-provider sliders in Settings still reflect / override the resolved
// values, but most users will never open that panel once presets exist.
//
// The pill shows the current preset name plus, on Anthropic, a small
// subscript indicating which sampling fields actually apply for the
// active provider (e.g. "3 of 5"). When the user has wiggled a slider
// in Settings, the pill flips to "Custom (was: <name>)" with a one-click
// "reapply" affordance inside the dropdown.

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_PRESET_ID,
  PRESETS,
  getPreset,
  resolvePreset,
  type PresetId,
  type ResolvedPreset,
} from "../../lib/sampling/presets";
import type { ProviderConfigEntry } from "../../lib/config";

interface Props {
  /** Active preset for the current session. */
  presetId: PresetId | undefined;
  /** True iff the user has manually overridden any sampling field on the
   *  active provider since the preset was last applied. */
  isCustom: boolean;
  /** Active provider — needed to resolve preset → effective sampling for
   *  the subscript hint and to label the dropdown items accurately. */
  provider: ProviderConfigEntry | undefined;
  onSelect: (id: PresetId) => void;
  onReapply: () => void;
}

export function PresetPicker({
  presetId,
  isCustom,
  provider,
  onSelect,
  onReapply,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const activeId: PresetId = presetId ?? DEFAULT_PRESET_ID;
  const active = getPreset(activeId);
  const resolved = resolvePreset(activeId, provider);

  return (
    <div className="relative" ref={ref}>
      <button
        className={`text-[11px] rounded border px-2 py-1 flex items-center gap-1.5 transition-colors ${
          isCustom
            ? "border-amber-700/60 text-amber-300 hover:border-amber-600"
            : "border-neutral-800 text-neutral-300 hover:border-neutral-700 hover:text-neutral-100"
        }`}
        onClick={() => setOpen((v) => !v)}
        title={
          isCustom
            ? `Custom (was: ${active.label}). Click to switch or reapply.`
            : `${active.label} — ${active.subtitle}`
        }
      >
        <span className="text-neutral-500">scene:</span>
        <span className="font-medium">
          {isCustom ? `Custom (was: ${active.label})` : active.label}
        </span>
        <FieldsHint resolved={resolved} />
        <span className="text-neutral-600">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-[320px] bg-neutral-900 border border-neutral-800 rounded-md shadow-xl z-40">
          <ul className="py-1">
            {PRESETS.map((p) => {
              const isActive = p.id === activeId && !isCustom;
              return (
                <li key={p.id}>
                  <button
                    className={`w-full text-left px-3 py-2 hover:bg-neutral-800 transition-colors ${
                      isActive ? "bg-neutral-800/60" : ""
                    }`}
                    onClick={() => {
                      onSelect(p.id);
                      setOpen(false);
                    }}
                  >
                    <div className="flex items-baseline gap-2">
                      <span
                        className={`text-[13px] font-medium ${
                          isActive ? "text-emerald-300" : "text-neutral-100"
                        }`}
                      >
                        {p.label}
                      </span>
                      {isActive && (
                        <span className="text-[9px] uppercase tracking-wider text-emerald-500/80">
                          active
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-neutral-500 mt-0.5">
                      {p.subtitle}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          {isCustom && (
            <div className="border-t border-neutral-800 px-3 py-2 flex items-center justify-between">
              <span className="text-[11px] text-amber-400">
                You've edited sampling manually.
              </span>
              <button
                className="text-[11px] px-2 py-0.5 rounded bg-amber-700/60 hover:bg-amber-700 text-amber-50"
                onClick={() => {
                  onReapply();
                  setOpen(false);
                }}
              >
                Reapply {active.label}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FieldsHint({ resolved }: { resolved: ResolvedPreset }) {
  // Only render the hint when the provider strips some fields — keeps the
  // pill quiet on the common case.
  if (resolved.supported_fields.length === 5) return null;
  return (
    <span
      className="text-[9px] font-mono text-neutral-500 ml-1"
      title={`Only ${resolved.supported_fields.join(", ")} apply on this provider`}
    >
      {resolved.supported_fields.length}/5
    </span>
  );
}
