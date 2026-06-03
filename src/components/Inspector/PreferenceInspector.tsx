// Preferences tab — character-level memory of habits, tastes, dynamics,
// and limits. Three rounds of brainstorm converged on:
//
//   - Limits & boundaries pinned to the top (asymmetric cost of getting
//     them wrong; need to be obvious)
//   - Preferences (ordinary) auto-active after threshold (no friction)
//   - Private preferences (intimate) require ONE-CLICK confirmation
//     before injection into prompts (the discovery feels collaborative)
//   - Identity notes are a separate manual-only textarea (never
//     auto-generated; user types role/dynamic labels themselves)
//
// UX copy is deliberately non-clinical: "Chronicler noticed…" /
// "Yes, that's her" / "Not right" — discovery framing, not approval.

import { useMemo, useState } from "react";
import type {
  InspectorPreference,
  PreferenceState,
  Sensitivity,
} from "../../lib/preferences/types";
import type { CharacterPrefSettings } from "../../lib/preferences/store";

interface Props {
  preferences: InspectorPreference[];
  settings: CharacterPrefSettings;
  identityNotes: string;
  characterName?: string;
  onKeep: (pref: InspectorPreference) => void;
  onDismiss: (pref: InspectorPreference) => void;
  onEdit: (pref: InspectorPreference, newStatement: string) => void;
  onIdentityNotesChange: (notes: string) => void;
  onSettingsChange: (settings: CharacterPrefSettings) => void;
  onRunFormation?: () => void;
  isFormationRunning?: boolean;
  /** Last-run status string shown beneath the button. */
  formationStatus?: string | null;
}

const sensitivityChip: Record<Sensitivity, string> = {
  ordinary: "bg-emerald-700/60 text-emerald-100",
  private: "bg-violet-700/60 text-violet-100",
  limit: "bg-rose-700/70 text-rose-100",
};

const stateChip: Record<PreferenceState, string> = {
  observed: "bg-neutral-700 text-neutral-300",
  candidate: "bg-amber-700/60 text-amber-100",
  active: "bg-emerald-700/60 text-emerald-100",
  dismissed: "bg-neutral-800 text-neutral-500",
};

export function PreferenceInspector({
  preferences,
  settings,
  identityNotes,
  characterName,
  onKeep,
  onDismiss,
  onEdit,
  onIdentityNotesChange,
  onSettingsChange,
  onRunFormation,
  isFormationRunning,
  formationStatus,
}: Props) {
  // Group preferences by sensitivity, respecting state filters.
  const groups = useMemo(() => {
    const visible = preferences.filter(
      (p) => p.state !== "dismissed" && p.interpretation_level !== "observation"
    );
    return {
      limits: visible.filter((p) => p.sensitivity === "limit"),
      ordinary: visible.filter((p) => p.sensitivity === "ordinary"),
      private: visible.filter((p) => p.sensitivity === "private"),
    };
  }, [preferences]);

  const totalActionable =
    groups.limits.length + groups.ordinary.length + groups.private.length;
  const pendingCandidates = preferences.filter(
    (p) => p.state === "candidate"
  ).length;

  return (
    <div className="flex h-full flex-col">
      <header className="px-4 py-3 border-b border-neutral-800">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-100">
            Preferences
          </h2>
          {pendingCandidates > 0 && (
            <span
              className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-700/60 text-amber-50"
              title={`${pendingCandidates} discoveries waiting for your read`}
            >
              {pendingCandidates} to review
            </span>
          )}
        </div>
        <p className="text-xs text-neutral-500 mt-0.5">
          Habits, tastes, dynamics, and limits {characterName ? `for ${characterName}` : ""} — discovered across sessions, you decide what sticks.
        </p>
        {onRunFormation && (
          <button
            onClick={onRunFormation}
            disabled={isFormationRunning}
            className="mt-2 text-[11px] px-2 py-0.5 rounded border border-emerald-700/60 hover:border-emerald-600 text-emerald-300 hover:text-emerald-200 disabled:opacity-50 disabled:cursor-wait inline-flex items-center gap-1.5"
            title="Re-scan recent memories for new preferences now"
          >
            {isFormationRunning && (
              <span
                className="inline-block w-2 h-2 rounded-full border border-emerald-400/30 border-t-emerald-300 animate-spin"
                aria-hidden
              />
            )}
            {isFormationRunning ? "noticing…" : "look for patterns now"}
          </button>
        )}
        {formationStatus && !isFormationRunning && (
          <p className="text-[11px] text-neutral-500 mt-2 leading-relaxed">
            {formationStatus}
          </p>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {totalActionable === 0 && (
          <div className="text-xs text-neutral-600 italic px-2 py-8 text-center leading-relaxed space-y-2">
            <p>No discovered patterns yet.</p>
            <p className="text-neutral-700">
              As you play with {characterName ?? "this character"} across
              scenes, Chronicler will quietly notice what they tend to like,
              avoid, or push back on. Limits and boundaries show up here first
              when detected. Nothing reaches the prompt unless you say
              "yes, that's her."
            </p>
          </div>
        )}

        {groups.limits.length > 0 && (
          <Section
            title="Limits & boundaries"
            subtitle="surfaced first — confirm to keep these out of bounds"
          >
            {groups.limits.map((p) => (
              <PreferenceCard
                key={p.rid}
                pref={p}
                accentClass="border-rose-800/40 bg-rose-900/10"
                primaryLabel="Protect this"
                onKeep={onKeep}
                onDismiss={onDismiss}
                onEdit={onEdit}
              />
            ))}
          </Section>
        )}

        {groups.private.length > 0 && (
          <Section
            title="Private preferences"
            subtitle="discovered in intimate scenes — your call before it sticks"
          >
            {groups.private.map((p) => (
              <PreferenceCard
                key={p.rid}
                pref={p}
                accentClass="border-violet-700/40 bg-violet-900/10"
                primaryLabel="Yes, that's her"
                onKeep={onKeep}
                onDismiss={onDismiss}
                onEdit={onEdit}
              />
            ))}
          </Section>
        )}

        {groups.ordinary.length > 0 && (
          <Section
            title="Preferences"
            subtitle="everyday habits and tastes — usually safe to keep"
          >
            {groups.ordinary.map((p) => (
              <PreferenceCard
                key={p.rid}
                pref={p}
                accentClass="border-emerald-700/40 bg-emerald-900/10"
                primaryLabel="Yes, that's her"
                onKeep={onKeep}
                onDismiss={onDismiss}
                onEdit={onEdit}
              />
            ))}
          </Section>
        )}

        <Section
          title="Identity notes"
          subtitle="what you'd write on the inside cover — manual only, never auto-detected"
        >
          <textarea
            value={identityNotes}
            onChange={(e) => onIdentityNotesChange(e.currentTarget.value)}
            rows={3}
            placeholder={`e.g. ${characterName ?? "Adira"} is verbally dominant in bed, switches outside of it. Hates being called pet names other than her own.`}
            className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1.5 text-[12px] text-neutral-200 resize-y focus:outline-none focus:border-neutral-600"
          />
          <p className="text-[10px] text-neutral-600 mt-1 leading-snug">
            Injected into the system prompt as &lt;identity_notes&gt;. Nothing
            here gets auto-detected — role/dynamic labels are too high-stakes
            to extract from scenes; type them yourself when you're ready.
          </p>
        </Section>

        <Section title="Settings" subtitle="per-character preference behavior">
          <SettingToggle
            label="Auto-keep ordinary preferences"
            description="Everyday habits surface in the prompt as soon as they're observed across 2+ scenes."
            checked={settings.auto_keep_ordinary}
            onChange={(v) =>
              onSettingsChange({ ...settings, auto_keep_ordinary: v })
            }
          />
          <SettingToggle
            label="Trust Chronicler on private preferences"
            description="Skip the one-click review for intimate discoveries. Off by default — opt in only if you're comfortable."
            checked={settings.trust_private}
            onChange={(v) =>
              onSettingsChange({ ...settings, trust_private: v })
            }
          />
          <SettingToggle
            label="Auto-keep limits"
            description="Always off. Limits are safety-critical in both directions — false positives refuse scenes you want; false negatives allow scenes you don't. One click stays as the floor."
            checked={false}
            disabled
            onChange={() => undefined}
          />
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="mb-2">
        <h3 className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold">
          {title}
        </h3>
        {subtitle && (
          <p className="text-[10px] text-neutral-600 mt-0.5">{subtitle}</p>
        )}
      </header>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function PreferenceCard({
  pref,
  accentClass,
  primaryLabel,
  onKeep,
  onDismiss,
  onEdit,
}: {
  pref: InspectorPreference;
  accentClass: string;
  primaryLabel: string;
  onKeep: (p: InspectorPreference) => void;
  onDismiss: (p: InspectorPreference) => void;
  onEdit: (p: InspectorPreference, newStatement: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(pref.statement);
  const evidenceCount = pref.evidence.length;

  return (
    <article className={`rounded-md border p-3 ${accentClass}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider font-mono ${sensitivityChip[pref.sensitivity]}`}
        >
          {pref.sensitivity}
        </span>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider font-mono ${stateChip[pref.state]}`}
        >
          {pref.state}
        </span>
        {pref.polarity === "negative" && (
          <span className="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider font-mono bg-neutral-800 text-neutral-400">
            negative
          </span>
        )}
        <span className="text-[10px] text-neutral-500 font-mono ml-auto">
          {evidenceCount} {evidenceCount === 1 ? "moment" : "moments"} · {(pref.confidence * 100).toFixed(0)}%
        </span>
      </div>

      {editing ? (
        <div className="mt-2 space-y-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            rows={2}
            className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-sm text-neutral-200 resize-y focus:outline-none focus:border-neutral-600"
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => {
                setEditing(false);
                setDraft(pref.statement);
              }}
              className="text-[11px] text-neutral-500 hover:text-neutral-300"
            >
              cancel
            </button>
            <button
              onClick={() => {
                onEdit(pref, draft.trim());
                setEditing(false);
              }}
              className="text-[11px] px-2 py-0.5 rounded bg-emerald-700/70 hover:bg-emerald-700 text-emerald-50"
            >
              save
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm mt-2 text-neutral-200 leading-snug">
          {pref.state === "candidate" && (
            <span className="text-neutral-500 text-[11px] italic mr-1.5">
              Chronicler noticed:
            </span>
          )}
          {pref.statement}
        </p>
      )}

      {pref.evidence.length > 0 && !editing && (
        <details className="mt-1.5">
          <summary className="text-[10px] text-neutral-600 hover:text-neutral-400 cursor-pointer font-mono">
            evidence · {evidenceCount}
          </summary>
          <ul className="mt-1 space-y-0.5">
            {pref.evidence.slice(0, 5).map((e, i) => (
              <li key={i} className="text-[10px] text-neutral-500 leading-snug">
                <span className="font-mono text-neutral-600">
                  {e.pre_activation ? "✓" : "~"}
                </span>{" "}
                {e.text_excerpt
                  ? `"${e.text_excerpt.slice(0, 140)}${e.text_excerpt.length > 140 ? "…" : ""}"`
                  : `(${e.source} · ${e.rid ?? "no-rid"})`}
              </li>
            ))}
            {pref.evidence.length > 5 && (
              <li className="text-[10px] text-neutral-700">
                + {pref.evidence.length - 5} more
              </li>
            )}
          </ul>
        </details>
      )}

      {!editing && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {pref.state !== "active" && (
            <button
              onClick={() => onKeep(pref)}
              className="text-[11px] px-2 py-0.5 rounded bg-emerald-700/60 hover:bg-emerald-700 text-emerald-50"
              title="Confirm this and add it to the prompt going forward"
            >
              {primaryLabel}
            </button>
          )}
          <button
            onClick={() => setEditing(true)}
            className="text-[11px] px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
          >
            Close, but edit
          </button>
          <button
            onClick={() => onDismiss(pref)}
            className="text-[11px] px-2 py-0.5 rounded bg-neutral-800 hover:bg-red-900 text-neutral-400 hover:text-red-200 ml-auto"
            title="Not right — dismiss and don't re-suggest"
          >
            Not right
          </button>
        </div>
      )}
    </article>
  );
}

function SettingToggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`block rounded border border-neutral-800 bg-neutral-950 p-2.5 ${
        disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:border-neutral-700"
      }`}
    >
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => !disabled && onChange(e.currentTarget.checked)}
          disabled={disabled}
          className="accent-emerald-500"
        />
        <span className="text-[12px] font-medium text-neutral-200">
          {label}
        </span>
      </div>
      <p className="text-[10px] text-neutral-500 leading-snug mt-1 pl-6">
        {description}
      </p>
    </label>
  );
}
