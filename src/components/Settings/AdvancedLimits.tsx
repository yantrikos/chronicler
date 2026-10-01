// Settings → Advanced: every tunable limit (lib/limits.ts) in one place.
// Nothing here is required — each field shows its default and an empty field uses it.

import { useEffect, useState } from "react";
import type { ChroniclerConfig } from "../../lib/config";
import { LIMITS, LIMIT_GROUPS, limitDef, sanitizeLimit, type LimitDef, type LimitKey } from "../../lib/limits";

const UNIT: Record<LimitDef["unit"], string> = { tokens: "tokens", seconds: "s", ms: "ms", share: "of budget", count: "×" };

function LimitField({ def, value, onCommit }: { def: LimitDef; value: number | undefined; onCommit: (v: number | undefined) => void }) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => setText(value === undefined ? "" : String(value)), [value]);

  // A valid number is saved the moment it is typed, so an edit can never be lost by pressing Save (or Enter)
  // without clicking away first. An out-of-range number is held as text and only tidied when you leave the field —
  // clamping on every keystroke would turn "9" into the minimum before you could finish typing "900".
  function onType(raw: string) {
    setText(raw);
    if (raw.trim() === "") {
      setNote(null);
      return onCommit(undefined);
    }
    const n = Number(raw);
    if (Number.isFinite(n) && n >= def.min && n <= def.max) {
      setNote(null);
      onCommit(sanitizeLimit(def.key, n));
    }
  }

  function tidy() {
    if (text.trim() === "") return;
    const s = sanitizeLimit(def.key, text);
    if (s === undefined) {
      setText(value === undefined ? "" : String(value));
      return setNote("Not a number — kept the previous value.");
    }
    setNote(Number(text) !== s ? `Adjusted to ${s} (allowed ${def.min}–${def.max}).` : null);
    setText(String(s));
    onCommit(s);
  }

  return (
    <div className="grid grid-cols-[1fr_auto] items-start gap-x-3 gap-y-0.5 py-1.5 border-b border-neutral-900 last:border-0">
      <div>
        <div className="text-xs text-neutral-200">{def.label}</div>
        <div className="text-[11px] leading-relaxed text-neutral-500">{def.help}</div>
        {note && <div className="text-[11px] text-amber-300">{note}</div>}
      </div>
      <div className="flex items-center gap-1.5 pt-0.5">
        <input
          type="number"
          inputMode="decimal"
          step={def.step ?? 1}
          min={def.min}
          max={def.max}
          value={text}
          placeholder={String(def.default)}
          aria-label={def.label}
          onChange={(e) => onType(e.currentTarget.value)}
          onBlur={tidy}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          className={`w-24 bg-neutral-900 border rounded px-2 py-0.5 text-xs text-right text-neutral-100 focus:outline-none focus:border-neutral-500 ${
            value === undefined ? "border-neutral-800" : "border-emerald-700"
          }`}
        />
        <span className="w-14 text-[10px] text-neutral-500">{UNIT[def.unit]}</span>
        <button
          type="button"
          onClick={() => {
            setNote(null);
            onCommit(undefined);
          }}
          disabled={value === undefined}
          title="Use the default"
          className="text-[10px] text-neutral-500 hover:text-neutral-200 disabled:opacity-30"
        >
          reset
        </button>
      </div>
    </div>
  );
}

export function AdvancedLimits({ value, onChange }: { value: ChroniclerConfig; onChange: (cfg: ChroniclerConfig) => void }) {
  const overrides = value.limits ?? {};
  const changed = Object.keys(overrides).filter((k) => limitDef(k as LimitKey)).length;

  function set(key: LimitKey, v: number | undefined) {
    const next = { ...overrides };
    if (v === undefined) delete next[key];
    else next[key] = v;
    onChange({ ...value, limits: Object.keys(next).length ? next : undefined });
  }

  return (
    <div>
      <details className="border border-neutral-800 rounded-md bg-neutral-950">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-neutral-200 hover:text-white">
          Advanced — limits {changed > 0 && <span className="ml-2 text-[11px] font-normal text-emerald-400">{changed} changed</span>}
        </summary>
        <div className="px-3 pb-3">
          <p className="text-[11px] leading-relaxed text-neutral-500 pb-2">
            Every number Chronicler uses to cap a model call, size the prompt, wait for a model or schedule background work is listed here, with its default.
            Leave a field empty to use the default. The reply length and context window of a particular model are set on that provider, under
            <em> sampling &amp; limits</em>.
          </p>
          {LIMIT_GROUPS.map((group) => {
            const rows = LIMITS.filter((l) => l.group === group);
            const body = rows.map((def) => <LimitField key={def.key} def={def} value={overrides[def.key]} onCommit={(v) => set(def.key as LimitKey, v)} />);
            return group === "Background tasks" ? (
              <details key={group} className="mt-2">
                <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-neutral-400 hover:text-neutral-200">
                  {group} — most tokens each call may write ({rows.length})
                </summary>
                <div className="mt-1">{body}</div>
              </details>
            ) : (
              <div key={group} className="mt-2">
                <h4 className="text-[11px] uppercase tracking-wider text-neutral-400 pb-0.5">{group}</h4>
                {body}
              </div>
            );
          })}
          <div className="pt-2">
            <button
              type="button"
              onClick={() => onChange({ ...value, limits: undefined })}
              disabled={changed === 0}
              className="text-[11px] rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:border-neutral-500 disabled:opacity-40"
            >
              reset all to defaults
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}
