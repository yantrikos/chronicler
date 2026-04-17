import type { PromptCapture } from "../../lib/orchestrator/types";

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
