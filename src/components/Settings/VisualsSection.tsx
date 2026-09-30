// Settings → Visuals. Two independent, optional things:
//  • Ambient mood — a faint wash from the scene's time of day and mood. Free.
//  • Generated images — portraits and location backdrops from a backend the
//    user points us at. Off by default; nothing is ever requested until it is
//    switched on AND a backend is configured.

import { useState } from "react";
import { makeImageBackend } from "../../lib/images/backends";
import { createImageCache } from "../../lib/images/cache";
import {
  DEFAULT_BACKDROP_SIZE, DEFAULT_PORTRAIT_SIZE, DEFAULT_STYLE,
  type ImageBackendConfig, type ImagesConfig,
} from "../../lib/images/types";
import { proxyPostJson } from "../../lib/providers";

const EMPTY_BACKEND: ImageBackendConfig = { kind: "openai", base_url: "", api_key: "", model: "" };

export function VisualsSection({
  value,
  onChange,
}: {
  value: ImagesConfig | undefined;
  onChange: (next: ImagesConfig) => void;
}) {
  const cfg: ImagesConfig = value ?? {};
  const backend = cfg.backend ?? EMPTY_BACKEND;
  const [test, setTest] = useState<{ state: "idle" | "running" | "ok" | "error"; msg?: string; url?: string }>({ state: "idle" });
  const [cleared, setCleared] = useState(false);

  const set = (patch: Partial<ImagesConfig>) => onChange({ ...cfg, ...patch });
  const setBackend = (patch: Partial<ImageBackendConfig>) => set({ backend: { ...backend, ...patch } });

  async function runTest(): Promise<void> {
    if (!backend.base_url) {
      setTest({ state: "error", msg: "Enter the backend URL first." });
      return;
    }
    setTest({ state: "running" });
    const t0 = performance.now();
    try {
      const url = await makeImageBackend(backend, proxyPostJson).generate({
        prompt: `a lighthouse on a rocky coast at dusk, ${cfg.style?.trim() || DEFAULT_STYLE}`,
        width: 256,
        height: 256,
      });
      setTest({ state: "ok", url, msg: `worked — ${((performance.now() - t0) / 1000).toFixed(1)} s` });
    } catch (e) {
      setTest({ state: "error", msg: e instanceof Error ? e.message : String(e) });
    }
  }

  const input =
    "w-full rounded-md bg-neutral-900/70 border border-neutral-700 px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-600";
  const label = "block text-[10px] uppercase tracking-wider text-neutral-500";

  return (
    <div>
      <h3 className="text-sm font-semibold text-neutral-200 mb-2">Visuals</h3>
      <div className="border border-neutral-800 rounded-md p-3 bg-neutral-950 space-y-3">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={cfg.ambient !== false}
            onChange={(e) => set({ ambient: e.target.checked })}
          />
          <span className="text-[12px] text-neutral-300 leading-relaxed">
            Ambient mood
            <span className="block text-[11px] text-neutral-500">
              A faint wash over the interface that follows the scene's time of day and mood. No model or
              backend needed; it uses the scene board.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={cfg.generate === true}
            onChange={(e) => set({ generate: e.target.checked })}
          />
          <span className="text-[12px] text-neutral-300 leading-relaxed">
            Generated images
            <span className="block text-[11px] text-neutral-500">
              Character portraits (once per character) and a backdrop for each location. Off by default.
              Needs an image backend you run or pay for.
            </span>
          </span>
        </label>

        {cfg.generate && (
          <div className="space-y-2 pl-6">
            <p className="text-[11px] text-neutral-500 leading-relaxed">
              Prompts are built from the character card and the scene board only — never from what you type.
              They are sent to the backend below (through the Chronicler server), so a cloud backend sees your
              character descriptions and scene locations. Images are cached in this browser, so each one is
              generated once.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <label className={label}>
                Backend type
                <select
                  className={input}
                  value={backend.kind}
                  onChange={(e) => setBackend({ kind: e.target.value as ImageBackendConfig["kind"] })}
                >
                  <option value="openai">OpenAI-style (/images/generations)</option>
                  <option value="a1111">AUTOMATIC1111 (/sdapi/v1/txt2img)</option>
                </select>
              </label>
              <label className={label}>
                Model / checkpoint (optional)
                <input className={input} value={backend.model ?? ""} onChange={(e) => setBackend({ model: e.target.value })} />
              </label>
              <label className={`${label} col-span-2`}>
                Base URL
                <input
                  className={input}
                  value={backend.base_url}
                  placeholder={backend.kind === "a1111" ? "http://host.docker.internal:7860" : "https://api.openai.com/v1"}
                  onChange={(e) => setBackend({ base_url: e.target.value })}
                />
              </label>
              <label className={`${label} col-span-2`}>
                API key (if the backend needs one)
                <input
                  className={input}
                  type="password"
                  value={backend.api_key ?? ""}
                  onChange={(e) => setBackend({ api_key: e.target.value })}
                  autoComplete="off"
                />
              </label>
              <label className={label}>
                Portrait size
                <input className={input} value={backend.portrait_size ?? ""} placeholder={DEFAULT_PORTRAIT_SIZE} onChange={(e) => setBackend({ portrait_size: e.target.value })} />
              </label>
              <label className={label}>
                Backdrop size
                <input className={input} value={backend.backdrop_size ?? ""} placeholder={DEFAULT_BACKDROP_SIZE} onChange={(e) => setBackend({ backdrop_size: e.target.value })} />
              </label>
              <label className={`${label} col-span-2`}>
                Style (added to every prompt)
                <input className={input} value={cfg.style ?? ""} placeholder={DEFAULT_STYLE} onChange={(e) => set({ style: e.target.value })} />
              </label>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={runTest}
                disabled={test.state === "running"}
                className="rounded-md border border-neutral-700 hover:border-emerald-500/60 px-3 py-1 text-xs text-neutral-200 disabled:opacity-50"
              >
                {test.state === "running" ? "Testing…" : "Test backend"}
              </button>
              <button
                type="button"
                onClick={async () => {
                  await createImageCache().clear();
                  setCleared(true);
                }}
                className="rounded-md border border-neutral-700 hover:border-neutral-500 px-3 py-1 text-xs text-neutral-400"
              >
                {cleared ? "Cache cleared" : "Clear image cache"}
              </button>
              {test.state === "ok" && test.url && (
                <img src={test.url} alt="Test result" className="h-10 w-10 rounded object-cover border border-neutral-700" />
              )}
              {test.msg && (
                <span className={`text-[11px] ${test.state === "error" ? "text-rose-300" : "text-emerald-300"}`}>{test.msg}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
