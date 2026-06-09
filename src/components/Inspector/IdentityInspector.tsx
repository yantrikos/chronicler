// Phase 11 Pillar 3 — Identity Inspector.
//
// Makes character emergence visible. Shows the self-model, core traits
// ranked + crystallization timeline, with actions to regenerate the
// self-model or disable individual traits from prompt injection.
//
// Mounts as a 6th inspector tab. Data flows in via props — App.tsx
// aggregates from the substrate refs and passes the InspectorIdentity.

import { useState } from "react";
import type { InspectorCoreTrait, InspectorIdentity } from "../../lib/identity/aggregator";

interface Props {
  identity: InspectorIdentity | null;
  /** Regenerate the self-model (forces a manualRefresh path). The host
   *  passes a function that fires Pillar 2's runSelfModelFormation. */
  onRegenerateSelfModel: () => Promise<void>;
  isRegenerating: boolean;
  /** Disable a core trait from prompt injection. Persisted via the
   *  same skill-overrides path the existing SkillInspector uses. */
  onDisableTrait: (skillId: string) => void;
  /** Re-enable a previously-disabled trait. */
  onEnableTrait: (skillId: string) => void;
}

export function IdentityInspector({
  identity,
  onRegenerateSelfModel,
  isRegenerating,
  onDisableTrait,
  onEnableTrait,
}: Props) {
  if (!identity) {
    return (
      <div className="p-6 text-xs text-neutral-500">
        Load a character to see their crystallizing identity.
      </div>
    );
  }
  const { character_name, self_model, core_traits, crystallization_timeline } =
    identity;
  return (
    <div className="flex h-full flex-col text-neutral-200">
      <Header identity={identity} />
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <SelfModelSection
          characterName={character_name}
          selfModel={self_model}
          onRegenerate={onRegenerateSelfModel}
          isRegenerating={isRegenerating}
        />
        <CoreTraitsSection
          traits={core_traits}
          onDisable={onDisableTrait}
          onEnable={onEnableTrait}
        />
        <CrystallizationTimelineSection traits={crystallization_timeline} />
      </div>
    </div>
  );
}

function Header({ identity }: { identity: InspectorIdentity }) {
  const crystSince = identity.crystallized_since
    ? new Date(identity.crystallized_since).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;
  return (
    <header className="px-4 py-3 border-b border-neutral-800">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-neutral-100">
          {identity.character_name}
        </h2>
        <span className="text-[10px] font-mono text-neutral-500">
          {identity.core_traits.length} trait
          {identity.core_traits.length === 1 ? "" : "s"}
        </span>
      </div>
      <p className="text-[11px] text-neutral-500 mt-0.5">
        {crystSince
          ? `Crystallizing since ${crystSince} · ${identity.sessions_observed} session${
              identity.sessions_observed === 1 ? "" : "s"
            } observed`
          : "No identity has crystallized yet — keep playing through scenes."}
      </p>
    </header>
  );
}

interface SelfModelSectionProps {
  characterName: string;
  selfModel: InspectorIdentity["self_model"];
  onRegenerate: () => Promise<void>;
  isRegenerating: boolean;
}

function SelfModelSection({
  characterName,
  selfModel,
  onRegenerate,
  isRegenerating,
}: SelfModelSectionProps) {
  const hasSelfModel = selfModel !== null;
  return (
    <section className="rounded-md border border-neutral-800 bg-neutral-900/40 p-3">
      <header className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-[12px] font-medium text-violet-300">
            Self-model
          </h3>
          {hasSelfModel && selfModel && (
            <p className="text-[10px] text-neutral-500 mt-0.5">
              Generated{" "}
              {new Date(selfModel.header.generated_at).toLocaleString()} by{" "}
              <code className="text-emerald-400">{selfModel.header.model_used}</code>
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void onRegenerate()}
          disabled={isRegenerating}
          className="rounded border border-violet-700/60 hover:border-violet-600 disabled:opacity-50 disabled:cursor-wait px-2 py-0.5 text-[10px] text-violet-300"
        >
          {isRegenerating ? "generating…" : hasSelfModel ? "regen" : "generate"}
        </button>
      </header>
      {hasSelfModel && selfModel ? (
        <div className="text-[12px] text-neutral-200 leading-relaxed whitespace-pre-line">
          {selfModel.body}
        </div>
      ) : (
        <p className="text-[11px] text-neutral-500 italic">
          {characterName} doesn't yet have a first-person self-model. One will
          generate once a few core traits crystallize, or hit{" "}
          <span className="text-violet-300">generate</span> to force it.
        </p>
      )}
    </section>
  );
}

function CoreTraitsSection({
  traits,
  onDisable,
  onEnable,
}: {
  traits: InspectorCoreTrait[];
  onDisable: (id: string) => void;
  onEnable: (id: string) => void;
}) {
  if (traits.length === 0) {
    return (
      <section className="rounded-md border border-neutral-800 bg-neutral-900/40 p-3">
        <h3 className="text-[12px] font-medium text-fuchsia-300 mb-1">
          Core traits
        </h3>
        <p className="text-[11px] text-neutral-500 italic">
          No traits have crystallized yet. Skills promote past <em>active</em>{" "}
          into core traits when they sustain over 8 outcomes across 4 sessions
          for 7+ days at 60%+ success rate, and the LLM verifier confirms the
          pattern is identity-level rather than situational.
        </p>
      </section>
    );
  }
  return (
    <section className="rounded-md border border-neutral-800 bg-neutral-900/40 p-3">
      <h3 className="text-[12px] font-medium text-fuchsia-300 mb-2">
        Core traits <span className="text-neutral-500">({traits.length})</span>
      </h3>
      <ul className="space-y-1.5">
        {traits.map((t) => (
          <CoreTraitRow
            key={t.skill_id}
            trait={t}
            onDisable={onDisable}
            onEnable={onEnable}
          />
        ))}
      </ul>
    </section>
  );
}

function CoreTraitRow({
  trait,
  onDisable,
  onEnable,
}: {
  trait: InspectorCoreTrait;
  onDisable: (id: string) => void;
  onEnable: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const stars = Math.max(1, Math.round(trait.rank * 5));
  return (
    <li
      className={`rounded border p-2 ${
        trait.active_in_prompt
          ? "border-fuchsia-800/50 bg-fuchsia-950/20"
          : "border-neutral-800 bg-neutral-950/50 opacity-60"
      }`}
    >
      <div className="flex items-start gap-2">
        <span
          className="text-fuchsia-300 font-mono text-[10px] mt-0.5 tracking-tight"
          title={`Rank ${trait.rank.toFixed(2)} of 1.0`}
        >
          {"★".repeat(stars) + "☆".repeat(5 - stars)}
        </span>
        <div className="flex-1 min-w-0">
          <p
            className="text-[12px] text-neutral-100 cursor-pointer"
            onClick={() => setExpanded(!expanded)}
          >
            {trait.body || (
              <span className="italic text-neutral-500">
                (skill body unavailable — substrate may not be loaded)
              </span>
            )}
          </p>
          {expanded && (
            <div className="mt-2 space-y-1 text-[10px] text-neutral-400 leading-relaxed">
              <p>
                <span className="text-violet-300">Why crystallized:</span>{" "}
                {trait.verifier_reasoning}
              </p>
              <p>
                <span className="text-emerald-300">Evidence at promotion:</span>{" "}
                net {trait.evidence.total_net_score} across{" "}
                {trait.evidence.distinct_sessions} sessions,{" "}
                {Math.round(trait.evidence.days_active)} days active,{" "}
                {Math.round(trait.evidence.success_rate * 100)}% success rate.
              </p>
              <p className="text-neutral-500">
                Crystallized {new Date(trait.crystallized_at).toLocaleString()}.
              </p>
            </div>
          )}
        </div>
        <div className="flex-none">
          {trait.active_in_prompt ? (
            <button
              type="button"
              onClick={() => onDisable(trait.skill_id)}
              title="Stop injecting this trait into the character_identity block"
              className="rounded border border-neutral-700 hover:border-neutral-500 px-1.5 py-0.5 text-[10px] text-neutral-300"
            >
              disable
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onEnable(trait.skill_id)}
              className="rounded border border-emerald-700/60 hover:border-emerald-600 px-1.5 py-0.5 text-[10px] text-emerald-300"
            >
              enable
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function CrystallizationTimelineSection({ traits }: { traits: InspectorCoreTrait[] }) {
  if (traits.length === 0) return null;
  return (
    <section className="rounded-md border border-neutral-800 bg-neutral-900/40 p-3">
      <h3 className="text-[12px] font-medium text-emerald-300 mb-2">
        Crystallization timeline
      </h3>
      <ol className="space-y-1 text-[11px]">
        {traits.map((t, idx) => {
          const when = new Date(t.crystallized_at).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          });
          return (
            <li
              key={t.skill_id}
              className="flex gap-3 items-baseline border-l border-neutral-800 pl-3"
            >
              <span className="text-[10px] font-mono text-neutral-500 whitespace-nowrap min-w-[3rem]">
                {idx + 1}. {when}
              </span>
              <span className="text-neutral-300 truncate">
                {t.body || (
                  <em className="text-neutral-600">(body unavailable)</em>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
