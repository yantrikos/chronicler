import type { PromptCapture, TokenUsage } from "../../lib/orchestrator/types";

interface Props {
  capture: PromptCapture | null;
  onClose: () => void;
}

export function PromptInspector({ capture, onClose }: Props) {
  if (!capture) {
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg w-[640px] max-h-[80vh] p-6">
          <header className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold">Prompt inspector</h2>
            <button onClick={onClose} className="text-neutral-400 hover:text-neutral-100 text-sm">close</button>
          </header>
          <p className="text-sm text-neutral-400 italic">
            No prompt captured yet — send a turn first.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg w-[860px] max-h-[88vh] flex flex-col">
        <header className="px-5 py-3 border-b border-neutral-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Prompt inspector</h2>
            <p className="text-[11px] text-neutral-500 mt-0.5 font-mono">
              model={capture.model} · ~{capture.token_estimate.total} tokens ·
              captured {new Date(capture.captured_at).toLocaleTimeString()}
            </p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-100 text-sm">
            close
          </button>
        </header>
        {capture.breakdown && capture.budget && (
          <BudgetBar
            breakdown={capture.breakdown}
            budgetTotal={capture.budget.total}
            truncated={capture.truncated_sections ?? []}
          />
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 font-mono text-[12px]">
          <section>
            <div className="flex items-baseline justify-between mb-1">
              <h3 className="text-xs uppercase tracking-wider text-neutral-400 font-semibold">
                system
              </h3>
              <span className="text-[10px] text-neutral-600">
                ~{capture.token_estimate.system} tokens
              </span>
            </div>
            <pre className="whitespace-pre-wrap bg-neutral-950 border border-neutral-800 rounded p-3 text-neutral-300 max-h-[40vh] overflow-y-auto">
              {capture.system}
            </pre>
          </section>
          <section>
            <div className="flex items-baseline justify-between mb-1">
              <h3 className="text-xs uppercase tracking-wider text-neutral-400 font-semibold">
                messages
              </h3>
              <span className="text-[10px] text-neutral-600">
                ~{capture.token_estimate.messages} tokens · {capture.messages.length} messages
              </span>
            </div>
            <div className="space-y-1.5">
              {capture.messages.map((m, i) => (
                <div
                  key={i}
                  className={`rounded p-2 border ${
                    m.role === "user"
                      ? "bg-emerald-900/20 border-emerald-900/40"
                      : m.role === "assistant"
                      ? "bg-neutral-800/60 border-neutral-700"
                      : "bg-neutral-900 border-neutral-800"
                  }`}
                >
                  <p className="text-[10px] uppercase tracking-wider text-neutral-500 mb-0.5">
                    {m.role}
                  </p>
                  <pre className="whitespace-pre-wrap text-neutral-200">
                    {m.content}
                  </pre>
                </div>
              ))}
            </div>
          </section>
        </div>
        <footer className="px-5 py-2.5 border-t border-neutral-800 flex items-center justify-between text-[11px] text-neutral-500">
          <span>what the LLM actually saw on the last turn</span>
          <button
            onClick={() => {
              const text = JSON.stringify(capture, null, 2);
              navigator.clipboard?.writeText(text).catch(() => undefined);
            }}
            className="text-neutral-400 hover:text-neutral-100"
          >
            copy as JSON
          </button>
        </footer>
      </div>
    </div>
  );
}

// Per-section token usage bar. Reads composed.token_usage + the total
// budget cap; visualizes how the four memory tiers fit into the available
// context window. Truncated sections (where the composer hit the cap and
// had to drop items) get a warning glyph so users can see context loss.
//
// Coloring matches the inspector's tier-pill palette: emerald=canon,
// slate=scene, amber=heuristic (drafts), violet=graph. Anything past the
// composer's allocated slots (system_prompt scaffolding, message history,
// lorebook framing) is rendered as a final "overhead" segment in neutral.
const SECTION_META: Array<{
  key: keyof Pick<TokenUsage, "canon" | "scene" | "heuristic" | "graph">;
  label: string;
  bgClass: string;
  textClass: string;
}> = [
  {
    key: "canon",
    label: "canon",
    bgClass: "bg-emerald-600",
    textClass: "text-emerald-300",
  },
  {
    key: "scene",
    label: "scene",
    bgClass: "bg-slate-500",
    textClass: "text-slate-300",
  },
  {
    key: "heuristic",
    label: "drafts",
    bgClass: "bg-amber-600",
    textClass: "text-amber-300",
  },
  {
    key: "graph",
    label: "graph",
    bgClass: "bg-violet-600",
    textClass: "text-violet-300",
  },
];

function BudgetBar({
  breakdown,
  budgetTotal,
  truncated,
}: {
  breakdown: TokenUsage;
  budgetTotal: number;
  truncated: Array<"canon" | "scene" | "heuristic" | "graph">;
}) {
  const usedComposed =
    breakdown.canon +
    breakdown.scene +
    breakdown.heuristic +
    breakdown.graph;
  // Headroom = composer budget minus what the four sections actually used.
  // We don't show "overhead" because the composer caps don't know about
  // anti-confab framing or lorebook insertion costs — those land on the
  // overall token_estimate at the inspector header.
  const headroom = Math.max(0, budgetTotal - usedComposed);
  const truncatedSet = new Set(truncated);

  return (
    <div className="px-5 py-2.5 border-b border-neutral-800 bg-neutral-950/60">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-neutral-500 mb-1.5">
        <span>retrieval budget</span>
        <span className="font-mono normal-case tracking-normal text-neutral-400">
          {usedComposed} / {budgetTotal} tokens
          {truncated.length > 0 && (
            <span
              className="ml-2 text-amber-400"
              title={`Truncated: ${truncated.join(", ")} — some items didn't fit`}
            >
              ⚠ {truncated.length} truncated
            </span>
          )}
        </span>
      </div>
      <div
        className="h-2 w-full rounded-sm overflow-hidden flex bg-neutral-900 border border-neutral-800"
        title={`${usedComposed} of ${budgetTotal} tokens used by composed sections`}
      >
        {SECTION_META.map((sec) => {
          const used = breakdown[sec.key];
          if (used <= 0) return null;
          const pct = (used / budgetTotal) * 100;
          return (
            <div
              key={sec.key}
              className={sec.bgClass}
              style={{ width: `${pct}%` }}
              title={`${sec.label}: ${used} tokens (${Math.round(pct)}% of budget)`}
            />
          );
        })}
        {headroom > 0 && (
          <div
            className="bg-neutral-800/40"
            style={{ width: `${(headroom / budgetTotal) * 100}%` }}
            title={`${headroom} tokens unused`}
          />
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-3 flex-wrap text-[10px]">
        {SECTION_META.map((sec) => {
          const used = breakdown[sec.key];
          const isTruncated = truncatedSet.has(sec.key);
          return (
            <span
              key={sec.key}
              className={`flex items-center gap-1 ${sec.textClass}`}
            >
              <span className={`w-2 h-2 rounded-sm ${sec.bgClass}`} />
              <span className="font-mono">
                {sec.label} {used}
              </span>
              {isTruncated && (
                <span
                  className="text-amber-400 font-mono"
                  title={`${sec.label} hit its budget cap — some items were dropped`}
                >
                  ⚠
                </span>
              )}
            </span>
          );
        })}
        {headroom > 0 && (
          <span className="flex items-center gap-1 text-neutral-500">
            <span className="w-2 h-2 rounded-sm bg-neutral-800 border border-neutral-700" />
            <span className="font-mono">free {headroom}</span>
          </span>
        )}
      </div>
    </div>
  );
}
