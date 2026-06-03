import { Mark } from "./Logo";
import { DEMOS, DEMO_ORDER, type DemoKey } from "../../lib/cards/demos";

interface Props {
  onImport: () => void;
  onDemo: (key: DemoKey) => void;
  onOpenSettings: () => void;
  hasPriorSessions: boolean;
}

const categoryDot: Record<string, string> = {
  romance: "bg-rose-500",
  companion: "bg-emerald-500",
  fiction: "bg-violet-500",
  ttrpg: "bg-amber-500",
  fandom_ip: "bg-sky-500",
  practice: "bg-teal-500",
};

export function EmptyState({
  onImport,
  onDemo,
  onOpenSettings,
  hasPriorSessions,
}: Props) {
  return (
    <div className="h-full overflow-y-auto bg-neutral-900">
      <div className="max-w-3xl mx-auto px-8 py-12">
        <div className="text-center">
          <div className="flex justify-center mb-5">
            <Mark size={64} />
          </div>
          <h1 className="text-2xl font-semibold text-neutral-100 tracking-tight">
            Chronicler
          </h1>
          <p className="text-sm text-neutral-400 mt-1.5 leading-relaxed max-w-md mx-auto">
            Local-first roleplay with living memory. Import a card or try one
            of the demos below — characters survive across sessions, machine
            restarts, anything.
          </p>
          <div className="mt-5">
            <button
              onClick={onImport}
              className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 text-sm font-medium"
            >
              Import a character card (PNG / JSON)
            </button>
          </div>
        </div>

        <div className="mt-10">
          <p className="text-[11px] uppercase tracking-wider text-neutral-500 font-semibold mb-3 text-center">
            Or try a demo — one for each major roleplay style
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {DEMO_ORDER.filter((k) => k !== "mei").map((k) => {
              const d = DEMOS[k];
              return (
                <button
                  key={k}
                  onClick={() => onDemo(k)}
                  className="text-left rounded-md border border-neutral-800 bg-neutral-950 hover:border-neutral-700 hover:bg-neutral-900 transition-colors p-3"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${categoryDot[d.category] ?? "bg-neutral-500"}`}
                      aria-hidden
                    />
                    <span className="text-sm font-semibold text-neutral-100">
                      {d.label}
                    </span>
                    <span className="text-[9px] uppercase tracking-wider text-neutral-600 font-mono ml-auto">
                      {d.recommended_preset.replace("_", " ")}
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-500 leading-snug">
                    {d.subtitle}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {hasPriorSessions && (
          <p className="text-[11px] text-neutral-500 mt-6 text-center">
            Prior sessions are listed on the right. Click one to resume —
            characters remember everything from before.
          </p>
        )}

        <div className="mt-10 pt-6 border-t border-neutral-800 text-[11px] text-neutral-500 space-y-1 max-w-md mx-auto text-center">
          <p>
            First time? Open{" "}
            <button
              onClick={onOpenSettings}
              className="underline hover:text-neutral-300"
            >
              Settings
            </button>{" "}
            to add your LLM provider (Ollama local, OpenAI, Anthropic, Gemini,
            Mistral, OpenRouter…) and set your persona.
          </p>
          <p className="text-neutral-600">
            Your data never leaves this machine. No content filtering — you
            pick the model.
          </p>
        </div>
      </div>
    </div>
  );
}
