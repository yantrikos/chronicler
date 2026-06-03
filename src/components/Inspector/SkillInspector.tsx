// Skills tab — surfaces YantrikDB's skill_substrate for the active
// character. Labeled "Character Development" externally; "skills" only
// appears in code and docs (avoids the gamification connotation).
//
// Each row shows: skill body, type badge, derived state, applies_to,
// outcome summary. Per-row actions: approve (force → active), disable
// (force → suppressed), archive (force → archived). State changes persist
// via the localStorage overrides layer so the orchestrator's surfacing
// filter sees them on the next turn.

import { useMemo, useState } from "react";
import type { SkillState } from "../../lib/instrumentation/skill-transition-log";

export interface InspectorSkill {
  skill_id: string;
  body: string;
  skill_type: string;
  applies_to: string[];
  state: SkillState;
  uses: number;
  successes: number;
}

interface Props {
  skills: InspectorSkill[];
  onApprove?: (skill_id: string) => void;
  onDisable?: (skill_id: string) => void;
  onArchive?: (skill_id: string) => void;
  onClearOverride?: (skill_id: string) => void;
  /** Manual run-now hook — fires think() → SkillFormer → DriftFormer in
   *  sequence so the user can populate this tab on demand instead of
   *  waiting for the every-4-turns auto-cadence. */
  onRunFormation?: () => void;
  /** True while the manual run is in flight — disables the button + shows
   *  a spinner. */
  isFormationRunning?: boolean;
}

const stateStyle: Record<SkillState, string> = {
  candidate: "border-amber-500/40 bg-amber-500/5",
  active: "border-emerald-500/40 bg-emerald-500/5",
  suppressed: "border-slate-500/40 bg-slate-500/5 opacity-60",
  archived: "border-neutral-700 bg-neutral-900/40 opacity-40",
};

const statePill: Record<SkillState, string> = {
  candidate: "bg-amber-600 text-amber-50",
  active: "bg-emerald-600 text-emerald-50",
  suppressed: "bg-slate-600 text-slate-50",
  archived: "bg-neutral-700 text-neutral-200",
};

const typePill: Record<string, string> = {
  procedure: "bg-sky-700/60 text-sky-100",
  pattern: "bg-violet-700/60 text-violet-100",
  rule: "bg-rose-700/60 text-rose-100",
  lesson: "bg-teal-700/60 text-teal-100",
  reference: "bg-neutral-700 text-neutral-200",
};

type StateFilter = "all" | SkillState;

export function SkillInspector({
  skills,
  onApprove,
  onDisable,
  onArchive,
  onClearOverride,
  onRunFormation,
  isFormationRunning,
}: Props) {
  const [filter, setFilter] = useState<StateFilter>("all");

  const counts = useMemo(
    () => ({
      candidate: skills.filter((s) => s.state === "candidate").length,
      active: skills.filter((s) => s.state === "active").length,
      suppressed: skills.filter((s) => s.state === "suppressed").length,
      archived: skills.filter((s) => s.state === "archived").length,
    }),
    [skills]
  );

  const filtered = useMemo(
    () => skills.filter((s) => filter === "all" || s.state === filter),
    [skills, filter]
  );

  return (
    <div className="flex h-full flex-col">
      <header className="px-4 py-3 border-b border-neutral-800">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-100">
            Character development
          </h2>
          <span className="text-[10px] font-mono text-neutral-500">
            {skills.length} learned
          </span>
        </div>
        <p className="text-xs text-neutral-500 mt-0.5">
          Patterns this character has shown across past scenes
        </p>
        {onRunFormation && (
          <button
            onClick={onRunFormation}
            disabled={isFormationRunning}
            className="mt-2 text-[11px] px-2 py-0.5 rounded border border-emerald-700/60 hover:border-emerald-600 text-emerald-300 hover:text-emerald-200 disabled:opacity-50 disabled:cursor-wait inline-flex items-center gap-1.5"
            title="Run YantrikDB's think() loop and re-verify skill candidates now (otherwise runs every 4 turns)"
          >
            {isFormationRunning && (
              <span
                className="inline-block w-2 h-2 rounded-full border border-emerald-400/30 border-t-emerald-300 animate-spin"
                aria-hidden
              />
            )}
            {isFormationRunning ? "thinking…" : "look for patterns now"}
          </button>
        )}
      </header>

      <div className="px-3 py-2 border-b border-neutral-800 flex gap-1 text-xs flex-wrap">
        <StateChip
          active={filter === "all"}
          label={`All ${skills.length}`}
          onClick={() => setFilter("all")}
        />
        <StateChip
          active={filter === "active"}
          label={`Active ${counts.active}`}
          tone="active"
          onClick={() => setFilter("active")}
        />
        <StateChip
          active={filter === "candidate"}
          label={`Candidate ${counts.candidate}`}
          tone="candidate"
          onClick={() => setFilter("candidate")}
        />
        <StateChip
          active={filter === "suppressed"}
          label={`Suppressed ${counts.suppressed}`}
          tone="suppressed"
          onClick={() => setFilter("suppressed")}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filtered.length === 0 && (
          <div className="text-xs text-neutral-600 italic px-2 py-8 text-center leading-relaxed space-y-2">
            {skills.length === 0 ? (
              <>
                <p>No verified behaviors yet.</p>
                <p className="text-neutral-700">
                  Patterns surface when the character shows a recurring
                  behavior across 2+ scenes AND an LLM verifier confirms
                  it's a real character trait (not just a model phrasing
                  tic). Keep chatting, or {onRunFormation ? "use the look-for-patterns button above to run the loop on existing memory now" : "run the think loop"}.
                </p>
              </>
            ) : (
              <p>{`No ${filter} skills.`}</p>
            )}
          </div>
        )}
        {filtered.map((s) => (
          <article
            key={s.skill_id}
            className={`rounded-md border p-3 ${stateStyle[s.state]}`}
          >
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider font-mono ${statePill[s.state]}`}
              >
                {s.state}
              </span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider font-mono ${
                  typePill[s.skill_type] ?? "bg-neutral-700 text-neutral-200"
                }`}
              >
                {s.skill_type}
              </span>
              <span className="text-[10px] text-neutral-500 font-mono ml-auto">
                {s.uses > 0
                  ? `${s.successes}/${s.uses} (${Math.round(
                      (s.successes / s.uses) * 100
                    )}%)`
                  : "no outcomes yet"}
              </span>
            </div>
            <p className="text-sm mt-2 text-neutral-200 leading-snug">
              {s.body}
            </p>
            <p className="text-[10px] text-neutral-500 font-mono mt-1.5 break-all">
              {s.skill_id}
            </p>
            {s.applies_to.length > 0 && (
              <div className="mt-1 flex gap-1 flex-wrap">
                {s.applies_to.map((tag) => (
                  <span
                    key={tag}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-2.5 flex gap-1.5 items-center flex-wrap">
              {s.state !== "active" && onApprove && (
                <button
                  className="text-[11px] px-2 py-0.5 rounded bg-emerald-700/60 hover:bg-emerald-700 text-emerald-50"
                  onClick={() => onApprove(s.skill_id)}
                  title="Force this skill into the prompt going forward"
                >
                  approve
                </button>
              )}
              {s.state === "active" && onDisable && (
                <button
                  className="text-[11px] px-2 py-0.5 rounded bg-slate-700/60 hover:bg-slate-700 text-slate-50"
                  onClick={() => onDisable(s.skill_id)}
                  title="Stop surfacing this skill until you approve again"
                >
                  disable
                </button>
              )}
              {s.state !== "archived" && onArchive && (
                <button
                  className="text-[11px] px-2 py-0.5 rounded bg-neutral-800 hover:bg-red-900 text-neutral-300 ml-auto"
                  onClick={() => onArchive(s.skill_id)}
                  title="Archive this skill permanently"
                >
                  archive
                </button>
              )}
              {onClearOverride && (
                <button
                  className="text-[11px] px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-400"
                  onClick={() => onClearOverride(s.skill_id)}
                  title="Remove manual state override (let outcomes decide)"
                >
                  reset
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function StateChip({
  active,
  label,
  tone,
  onClick,
}: {
  active: boolean;
  label: string;
  tone?: SkillState;
  onClick: () => void;
}) {
  const base = "px-2 py-0.5 rounded border text-[11px] transition-colors";
  const activeCls = tone
    ? statePill[tone]
    : "bg-neutral-200 text-neutral-900 border-neutral-200";
  const idleCls = "border-neutral-800 text-neutral-400 hover:text-neutral-200";
  return (
    <button
      onClick={onClick}
      className={`${base} ${active ? activeCls : idleCls}`}
    >
      {label}
    </button>
  );
}
