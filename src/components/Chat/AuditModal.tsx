// Character consistency audit. Shows whether a character's replies have stayed
// true to who it is supposed to be, and lets the player look at each reply that
// didn't. Deliberately honest about what it is: a model reading each reply
// against a list of traits, which catches plain contradictions more reliably
// than subtle ones and is only as good as the model doing the reading.

import type { AuditReport } from "../../lib/audit/run";
import { consistencyScore } from "../../lib/audit/run";

interface Props {
  characterName: string;
  traits: string[];
  onTraitsChange: (traits: string[]) => void;
  onExtract: () => void;
  extracting: boolean;
  report: AuditReport | null;
  running: { done: number; total: number } | null;
  judgeLabel: string | null;
  onRun: () => void;
  onCancel: () => void;
  onJump: (turnId: string) => void;
  onClose: () => void;
}

export function AuditModal(p: Props) {
  const score = p.report ? consistencyScore(p.report) : null;
  const pct = score === null ? null : Math.round(score * 100);
  const tone = pct === null ? "text-neutral-400" : pct >= 90 ? "text-emerald-300" : pct >= 75 ? "text-amber-300" : "text-rose-300";
  const traitText = p.traits.join("\n");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="Character consistency">
      <div className="max-h-[88vh] w-[680px] max-w-[96vw] overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900 shadow-2xl">
        <header className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
          <h2 className="text-base font-semibold">Consistency — {p.characterName}</h2>
          <button onClick={p.onClose} className="text-sm text-neutral-400 hover:text-neutral-100">close</button>
        </header>

        <section className="space-y-4 p-5">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-200">Traits to check against</h3>
              <button
                type="button"
                onClick={p.onExtract}
                disabled={p.extracting || !p.judgeLabel}
                className="text-[11px] text-neutral-400 hover:text-neutral-100 disabled:opacity-40"
              >
                {p.extracting ? "reading the card…" : "re-read from the card"}
              </button>
            </div>
            <textarea
              value={traitText}
              onChange={(e) => p.onTraitsChange(e.target.value.split("\n"))}
              rows={5}
              placeholder="One trait per line, e.g. “Never raises his voice”. Click “re-read from the card” to fill this in."
              className="w-full resize-y rounded-md border border-neutral-700 bg-neutral-950/60 px-3 py-2 text-xs leading-relaxed text-neutral-100 placeholder:text-neutral-600"
            />
            <p className="mt-1 text-[11px] text-neutral-500">
              Taken from the character card, plus any core traits it has developed. Edit freely — the audit checks replies against exactly this list.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {p.running ? (
              <>
                <span className="text-xs text-emerald-300 animate-pulse">Checking replies… {p.running.done} of {p.running.total}</span>
                <button onClick={p.onCancel} className="rounded-md border border-neutral-700 px-3 py-1 text-xs text-neutral-300">Stop</button>
              </>
            ) : (
              <button
                onClick={p.onRun}
                disabled={!p.judgeLabel || p.traits.filter((t) => t.trim()).length === 0}
                className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:bg-neutral-700 disabled:text-neutral-500"
              >
                {p.report ? "Run again" : "Check this chat"}
              </button>
            )}
            <span className="text-[11px] text-neutral-500">
              {p.judgeLabel ? `Judged by ${p.judgeLabel} · a few seconds per reply` : "Needs a real model — choose one in Settings."}
            </span>
          </div>

          {p.report && (
            <div className="space-y-3">
              <div className="rounded-lg border border-neutral-800 bg-neutral-950/50 px-4 py-3">
                {pct === null ? (
                  <p className="text-sm text-neutral-400">No replies could be checked{p.report.errors ? " — the model was unreachable" : ""}.</p>
                ) : (
                  <>
                    <p className={`text-3xl font-semibold ${tone}`}>{pct}% <span className="text-sm font-normal text-neutral-400">consistent</span></p>
                    <p className="text-xs text-neutral-400">
                      {p.report.audited - p.report.flagged} of {p.report.audited} replies had no contradiction with the traits
                      {p.report.errors ? ` · ${p.report.errors} could not be checked` : ""}
                      {p.report.partial ? " · stopped early" : ""}
                    </p>
                  </>
                )}
                <p className="mt-2 text-[11px] leading-snug text-neutral-500">
                  A model read each reply against the list above. In testing on plain contradictions, a small (4B) model caught about 8 in 10,
                  and mid-size and large ones caught all of them (all three caught the subtle ones we tried), with at most one false flag in 18
                  innocent replies. It can only check the traits on the list, so a clean result is not proof — and every flag below is worth a
                  look before you believe it.
                </p>
              </div>

              {p.report.by_trait.some((n) => n > 0) && (
                <div className="space-y-1">
                  {p.report.traits.map((t, i) => (
                    <div key={i} className="flex items-center gap-2 text-[11px]">
                      <span className="w-6 text-right text-neutral-500">{p.report!.by_trait[i] ?? 0}</span>
                      <div className="h-1.5 w-24 overflow-hidden rounded bg-neutral-800">
                        <div className="h-full bg-rose-400/80" style={{ width: `${Math.min(100, ((p.report!.by_trait[i] ?? 0) / Math.max(1, p.report!.audited)) * 400)}%` }} />
                      </div>
                      <span className="truncate text-neutral-400">{t}</span>
                    </div>
                  ))}
                </div>
              )}

              {p.report.findings.length > 0 ? (
                <ul className="space-y-2">
                  {p.report.findings.map((f) => (
                    <li key={f.turn_id} className="rounded-md border border-neutral-800 bg-neutral-950/40 p-2.5">
                      {f.flags.map((fl, i) => (
                        <div key={i} className="text-xs">
                          <p className="text-neutral-500">
                            against <span className="text-neutral-300">“{p.report!.traits[fl.trait - 1]}”</span>
                          </p>
                          <p className="mt-0.5 italic text-rose-200">“{fl.quote}”</p>
                          <p className="text-neutral-400">{fl.why}</p>
                        </div>
                      ))}
                      <button onClick={() => p.onJump(f.turn_id)} className="mt-1.5 text-[11px] text-emerald-400 hover:text-emerald-300">
                        show in chat →
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                pct !== null && <p className="text-xs text-neutral-400">No contradictions found in the replies that were checked.</p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
