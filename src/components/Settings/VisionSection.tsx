// Settings → Vision. Which model reads images the player shares.
//
// Chosen from the same provider list as everything else, so a strong text-only
// chat model can be paired with a small vision model (or the chat model can
// serve as its own eyes if it can read images). Nothing is sent anywhere
// unless a vision provider resolves AND the player attaches an image.

import { useState } from "react";
import { providerForRole, type ChroniclerConfig, type ProviderConfigEntry } from "../../lib/config";
import { proxyPostJson } from "../../lib/providers";
import { clearImages } from "../../lib/vision/attachments";
import { detectVision } from "../../lib/vision/capability";

export function VisionSection({
  value,
  onChange,
}: {
  value: ChroniclerConfig;
  onChange: (next: ChroniclerConfig) => void;
}) {
  const [detect, setDetect] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);
  const effective = providerForRole(value, "vision");
  const chat = providerForRole(value, "chat");

  const setProvider = (id: string, patch: Partial<ProviderConfigEntry>) =>
    onChange({ ...value, providers: value.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)) });

  async function runDetect(p: ProviderConfigEntry): Promise<void> {
    setDetect("Checking…");
    const can = await detectVision(p, proxyPostJson);
    if (can === undefined) {
      setDetect(p.kind === "ollama" ? "Could not reach the model server to check." : "Only Ollama models can be detected — tick the box yourself.");
      return;
    }
    setProvider(p.id, { supports_vision: can });
    setDetect(can ? "This model can read images." : "This model cannot read images.");
  }

  const select = "w-full rounded-md bg-neutral-900/70 border border-neutral-700 px-2 py-1 text-xs text-neutral-100";
  // The provider whose capability the player is looking at: the one chosen for
  // vision, else the chat model (which may serve as its own eyes).
  const target = value.providers.find((p) => p.id === (value.roles?.vision ?? "")) ?? chat;

  return (
    <div>
      <h3 className="text-sm font-semibold text-neutral-200 mb-2">Vision</h3>
      <div className="border border-neutral-800 rounded-md p-3 bg-neutral-950 space-y-2">
        <p className="text-[11px] text-neutral-500 leading-relaxed">
          Lets you attach an image to a message. A vision model writes a short description, you can edit it,
          and only that description reaches the story — the story model never sees the image, and the
          description is never saved to memory. Images you share are stored in this browser.
        </p>
        <label className="block text-[10px] uppercase tracking-wider text-neutral-500">
          Vision model
          <select
            className={select}
            value={value.roles?.vision ?? ""}
            onChange={(e) => {
              const roles = { ...(value.roles ?? {}) };
              if (e.target.value) roles.vision = e.target.value;
              else delete roles.vision;
              onChange({ ...value, roles });
              setDetect(null);
            }}
          >
            <option value="">Same as chat (if it can read images)</option>
            {value.providers
              .filter((p) => p.kind !== "mock")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} — {p.model}
                  {p.supports_vision ? " (reads images)" : ""}
                </option>
              ))}
          </select>
        </label>

        {target && target.kind !== "mock" && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[12px] text-neutral-300 cursor-pointer">
              <input
                type="checkbox"
                checked={target.supports_vision === true}
                onChange={(e) => setProvider(target.id, { supports_vision: e.target.checked })}
              />
              {target.label} can read images
            </label>
            {target.kind === "ollama" && (
              <button
                type="button"
                onClick={() => void runDetect(target)}
                className="rounded-md border border-neutral-700 hover:border-emerald-500/60 px-2.5 py-1 text-xs text-neutral-200"
              >
                Detect
              </button>
            )}
            {detect && <span className="text-[11px] text-neutral-400">{detect}</span>}
          </div>
        )}

        <p className={`text-[11px] ${effective ? "text-emerald-300" : "text-neutral-500"}`}>
          {effective
            ? `Attaching images is on — they will be described by ${effective.label} (${effective.model}).`
            : "Off — no vision model is set and the chat model isn't marked as able to read images."}
        </p>

        <button
          type="button"
          onClick={async () => {
            await clearImages();
            setCleared(true);
          }}
          className="rounded-md border border-neutral-700 hover:border-neutral-500 px-2.5 py-1 text-xs text-neutral-400"
        >
          {cleared ? "Stored images cleared" : "Clear stored images"}
        </button>
      </div>
    </div>
  );
}
