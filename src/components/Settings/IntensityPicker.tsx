// Scene Intensity dropdown — sibling to the scene preset, lives in the
// scene strip. Soft prompt steering, NOT a content filter. The component
// is explicit about that in its footer disclaimer + model-aware hint
// (load-bearing UX: converts "this toggle is broken" into "oh, I need a
// different model" when guarded providers soften the request).
//
// Per-mode snippets editable inline (with reset-to-default). Edits
// persist via lib/intensity/store.ts — same pattern as skill overrides.

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_INTENSITY_ID,
  INTENSITIES,
  INTENSITY_ORDER,
  type IntensityId,
  type ProviderHintInput,
  getIntensity,
  intensityHint,
} from "../../lib/intensity/registry";

interface Props {
  intensityId: IntensityId | undefined;
  provider: ProviderHintInput | undefined;
  /** Effective snippet for the CURRENT intensity (default merged with
   *  any user override). Shown in the edit textarea. */
  currentSnippet: string;
  /** True iff the current snippet is the default (i.e. user has not
   *  overridden it). Drives the "reset to default" affordance. */
  isDefault: boolean;
  onSelect: (id: IntensityId) => void;
  onSaveSnippet: (id: IntensityId, snippet: string) => void;
  onResetSnippet: (id: IntensityId) => void;
}

export function IntensityPicker({
  intensityId,
  provider,
  currentSnippet,
  isDefault,
  onSelect,
  onSaveSnippet,
  onResetSnippet,
}: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click + escape; cancels any inline edit too.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false);
        setEditing(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setEditing(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  // Sync edit draft when intensity changes or panel reopens.
  useEffect(() => {
    if (editing) setDraft(currentSnippet);
  }, [editing, currentSnippet]);

  const activeId: IntensityId = intensityId ?? DEFAULT_INTENSITY_ID;
  const active = getIntensity(activeId);
  const hint = intensityHint(activeId, provider);

  // Button visual: brand-neutral except for Explicit, which gets a
  // distinct rose tint so users can see at a glance "yes, this scene
  // is set to explicit." Affirmation, not warning.
  const buttonTone =
    activeId === "explicit"
      ? "border-rose-700/60 text-rose-300 hover:border-rose-600"
      : activeId === "fade_to_black"
      ? "border-sky-700/60 text-sky-300 hover:border-sky-600"
      : activeId === "tasteful"
      ? "border-amber-700/60 text-amber-300 hover:border-amber-600"
      : "border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200";

  return (
    <div className="relative" ref={ref}>
      <button
        className={`text-[11px] rounded border px-2 py-0.5 flex items-center gap-1.5 transition-colors ${buttonTone}`}
        onClick={() => setOpen((v) => !v)}
        title={`Scene Intensity: ${active.label} — ${active.hint}`}
      >
        <span className="text-neutral-500">intensity:</span>
        <span className="font-medium">{active.label}</span>
        <span className="text-neutral-600">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-[380px] bg-neutral-900 border border-neutral-800 rounded-md shadow-xl z-40">
          {!editing && (
            <>
              <ul className="py-1">
                {INTENSITY_ORDER.map((id) => {
                  const m = INTENSITIES[id];
                  const isActive = id === activeId;
                  return (
                    <li key={id}>
                      <button
                        className={`w-full text-left px-3 py-2 hover:bg-neutral-800 transition-colors ${
                          isActive ? "bg-neutral-800/60" : ""
                        }`}
                        onClick={() => {
                          onSelect(id);
                          setOpen(false);
                        }}
                      >
                        <div className="flex items-baseline gap-2">
                          <span
                            className={`text-[13px] font-medium ${
                              isActive
                                ? id === "explicit"
                                  ? "text-rose-300"
                                  : id === "fade_to_black"
                                  ? "text-sky-300"
                                  : id === "tasteful"
                                  ? "text-amber-300"
                                  : "text-neutral-100"
                                : "text-neutral-100"
                            }`}
                          >
                            {m.label}
                          </span>
                          {isActive && (
                            <span className="text-[9px] uppercase tracking-wider text-emerald-500/80">
                              active
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-neutral-500 mt-0.5">
                          {m.hint}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {hint && (
                <div className="border-t border-neutral-800 px-3 py-2 bg-amber-900/10">
                  <p className="text-[11px] text-amber-300/90 leading-snug">
                    ⓘ {hint}
                  </p>
                </div>
              )}
              {activeId !== "neutral" && (
                <div className="border-t border-neutral-800 px-3 py-2 flex items-center justify-between">
                  <button
                    onClick={() => {
                      setDraft(currentSnippet);
                      setEditing(true);
                    }}
                    className="text-[11px] text-neutral-400 hover:text-neutral-200"
                  >
                    edit snippet
                  </button>
                  {!isDefault && (
                    <button
                      onClick={() => onResetSnippet(activeId)}
                      className="text-[11px] text-neutral-500 hover:text-neutral-300"
                      title="Restore the default snippet for this mode"
                    >
                      reset to default
                    </button>
                  )}
                </div>
              )}
              <div className="border-t border-neutral-800 px-3 py-2">
                <p className="text-[10px] text-neutral-500 leading-snug">
                  Steers the model's writing style. Does not filter output;
                  Chronicler doesn't filter what your model produces.
                </p>
              </div>
            </>
          )}
          {editing && (
            <div className="p-3 space-y-2">
              <div className="flex items-baseline justify-between">
                <p className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold">
                  {active.label} snippet
                </p>
                <p className="text-[10px] text-neutral-600 font-mono">
                  injected into &lt;intensity&gt; block
                </p>
              </div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.currentTarget.value)}
                rows={8}
                className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1.5 text-[12px] text-neutral-200 font-mono resize-y focus:outline-none focus:border-neutral-600"
              />
              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={() => setEditing(false)}
                  className="text-[11px] text-neutral-500 hover:text-neutral-300"
                >
                  cancel
                </button>
                <button
                  onClick={() => {
                    onSaveSnippet(activeId, draft);
                    setEditing(false);
                  }}
                  className="text-[11px] px-2 py-0.5 rounded bg-emerald-700/70 hover:bg-emerald-700 text-emerald-50"
                >
                  save
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
