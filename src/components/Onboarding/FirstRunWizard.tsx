// First-run wizard. Three steps: provider → persona → first character.
//
// Triggered exactly once per machine — a localStorage flag dismisses it
// permanently (unless the user clears storage). Each step is skippable
// because power users want to dive into Settings directly; the wizard
// is a guide, not a gate.
//
// We do NOT validate provider credentials here — Settings handles that.
// The wizard just makes "where do I even start" obvious for new users.

import { useState } from "react";
import type {
  ChroniclerConfig,
  ProviderConfigEntry,
  UserPersona,
} from "../../lib/config";

const DISMISS_KEY = "chronicler.onboarding_v1_dismissed";

export function hasDismissedWizard(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function markWizardDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** Detect first-run state — no real providers wired, no persona set, no
 *  characters imported. We treat the mock-only default config as
 *  "untouched": if the user added any provider beyond Mock or set a
 *  non-"You" persona, the wizard stays out of the way. */
export function shouldShowWizard(
  cfg: ChroniclerConfig,
  hasCharacters: boolean
): boolean {
  if (hasDismissedWizard()) return false;
  const realProviders = (cfg.providers ?? []).filter((p) => p.kind !== "mock");
  const personaConfigured =
    (cfg.user_personas ?? []).some((p) => p.name && p.name !== "You" && p.name !== "Untitled persona");
  return !realProviders.length && !personaConfigured && !hasCharacters;
}

type ProviderQuickPick = "ollama" | "openai" | "anthropic" | "skip";

interface Props {
  onComplete: (patch: Partial<ChroniclerConfig>) => void;
  onImportCard: (file: File) => void;
  onTryDemo: () => void;
  onSkip: () => void;
}

export function FirstRunWizard({
  onComplete,
  onImportCard,
  onTryDemo,
  onSkip,
}: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [providerKind, setProviderKind] = useState<ProviderQuickPick>("ollama");
  const [providerUrl, setProviderUrl] = useState<string>(
    "http://host.docker.internal:11434"
  );
  const [providerModel, setProviderModel] = useState<string>("qwen3:4b");
  const [providerKey, setProviderKey] = useState<string>("");
  const [personaName, setPersonaName] = useState<string>("");
  const [personaDesc, setPersonaDesc] = useState<string>("");

  function finishProviderStep(): Partial<ChroniclerConfig> {
    if (providerKind === "skip") return {};
    const provider: ProviderConfigEntry = buildProvider(
      providerKind,
      providerUrl,
      providerModel,
      providerKey
    );
    return {
      providers: [
        { id: "mock", kind: "mock", label: "Mock (scripted)", api_key: "", model: "mock" },
        provider,
      ],
      active_provider_id: provider.id,
    };
  }

  function finishPersonaStep(): Partial<ChroniclerConfig> {
    if (!personaName.trim()) return {};
    const persona: UserPersona = {
      id: "default",
      name: personaName.trim(),
      description: personaDesc.trim() || undefined,
    };
    return {
      user_personas: [persona],
      active_persona_id: persona.id,
      user_persona: persona, // legacy back-compat field
    };
  }

  function next() {
    if (step === 1) {
      onComplete(finishProviderStep());
      setStep(2);
    } else if (step === 2) {
      onComplete(finishPersonaStep());
      setStep(3);
    }
  }

  function finish() {
    markWizardDismissed();
    onSkip();
  }

  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-6"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg w-[560px] max-h-[88vh] flex flex-col">
        <header className="px-5 py-3 border-b border-neutral-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-neutral-100">
              Welcome to Chronicler
            </h2>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Step {step} of 3 · skip any step you don't need
            </p>
          </div>
          <button
            onClick={finish}
            className="text-[11px] text-neutral-500 hover:text-neutral-200"
          >
            skip the rest
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          {step === 1 && (
            <StepProvider
              kind={providerKind}
              url={providerUrl}
              model={providerModel}
              apiKey={providerKey}
              onKind={(k) => {
                setProviderKind(k);
                // Helpful URL/model defaults per kind
                if (k === "ollama") {
                  setProviderUrl("http://host.docker.internal:11434");
                  setProviderModel("qwen3:4b");
                } else if (k === "openai") {
                  setProviderUrl("https://api.openai.com/v1");
                  setProviderModel("gpt-4o-mini");
                } else if (k === "anthropic") {
                  setProviderUrl("");
                  setProviderModel("claude-sonnet-4-6");
                }
              }}
              onUrl={setProviderUrl}
              onModel={setProviderModel}
              onApiKey={setProviderKey}
            />
          )}
          {step === 2 && (
            <StepPersona
              name={personaName}
              description={personaDesc}
              onName={setPersonaName}
              onDescription={setPersonaDesc}
            />
          )}
          {step === 3 && (
            <StepCharacter
              onImport={onImportCard}
              onDemo={() => {
                onTryDemo();
                finish();
              }}
            />
          )}
        </div>
        <footer className="px-5 py-3 border-t border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {[1, 2, 3].map((n) => (
              <span
                key={n}
                className={`w-2 h-2 rounded-full ${
                  n === step
                    ? "bg-emerald-500"
                    : n < step
                    ? "bg-emerald-700/50"
                    : "bg-neutral-700"
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {step < 3 ? (
              <>
                <button
                  onClick={() => {
                    if (step === 1) setStep(2);
                    else setStep(3);
                  }}
                  className="text-[11px] text-neutral-500 hover:text-neutral-200 px-2 py-1"
                >
                  skip this step
                </button>
                <button
                  onClick={next}
                  className="text-sm rounded bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1"
                >
                  next →
                </button>
              </>
            ) : (
              <button
                onClick={finish}
                className="text-sm rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 px-3 py-1"
              >
                close
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

function buildProvider(
  kind: Exclude<ProviderQuickPick, "skip">,
  url: string,
  model: string,
  apiKey: string
): ProviderConfigEntry {
  if (kind === "ollama") {
    return {
      id: "ollama-local",
      kind: "ollama",
      label: "Ollama (local)",
      base_url: url,
      api_key: "",
      model,
      disable_thinking: true,
    };
  }
  if (kind === "openai") {
    return {
      id: "openai-main",
      kind: "openai-compat",
      label: "OpenAI",
      base_url: url || "https://api.openai.com/v1",
      api_key: apiKey,
      model,
    };
  }
  return {
    id: "anthropic-main",
    kind: "anthropic",
    label: "Anthropic",
    api_key: apiKey,
    model,
  };
}

function StepProvider({
  kind,
  url,
  model,
  apiKey,
  onKind,
  onUrl,
  onModel,
  onApiKey,
}: {
  kind: ProviderQuickPick;
  url: string;
  model: string;
  apiKey: string;
  onKind: (k: ProviderQuickPick) => void;
  onUrl: (v: string) => void;
  onModel: (v: string) => void;
  onApiKey: (v: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-neutral-100 mb-1">
          Pick an LLM provider
        </h3>
        <p className="text-[11px] text-neutral-500 leading-relaxed">
          Chronicler is BYO-model — point it at whatever you already use.
          You can change this any time from Settings.
        </p>
      </div>
      <div className="space-y-1.5">
        <ProviderChoice
          id="ollama"
          selected={kind}
          onSelect={onKind}
          title="Ollama (local)"
          subtitle="Runs models on your machine. Free. No data leaves localhost. Best fit for Chronicler's privacy promise."
        />
        <ProviderChoice
          id="openai"
          selected={kind}
          onSelect={onKind}
          title="OpenAI"
          subtitle="GPT-4o, GPT-4.1, etc. Requires an OpenAI API key."
        />
        <ProviderChoice
          id="anthropic"
          selected={kind}
          onSelect={onKind}
          title="Anthropic"
          subtitle="Claude Sonnet / Opus. Requires an Anthropic API key. Strong at long-form roleplay."
        />
        <ProviderChoice
          id="skip"
          selected={kind}
          onSelect={onKind}
          title="Skip — I'll configure later"
          subtitle="The mock provider stays active; nothing real will respond until you add a provider in Settings."
        />
      </div>
      {kind !== "skip" && (
        <div className="space-y-2 pt-2 border-t border-neutral-800">
          {kind !== "anthropic" && (
            <LabeledField
              label="API URL"
              value={url}
              onChange={onUrl}
              placeholder={
                kind === "ollama"
                  ? "http://host.docker.internal:11434"
                  : "https://api.openai.com/v1"
              }
            />
          )}
          <LabeledField
            label="Model"
            value={model}
            onChange={onModel}
            placeholder={
              kind === "ollama" ? "qwen3:4b" : "gpt-4o-mini"
            }
          />
          {kind !== "ollama" && (
            <LabeledField
              label="API key"
              value={apiKey}
              onChange={onApiKey}
              placeholder="sk-…"
              type="password"
            />
          )}
        </div>
      )}
    </div>
  );
}

function ProviderChoice({
  id,
  selected,
  onSelect,
  title,
  subtitle,
}: {
  id: ProviderQuickPick;
  selected: ProviderQuickPick;
  onSelect: (id: ProviderQuickPick) => void;
  title: string;
  subtitle: string;
}) {
  const isActive = selected === id;
  return (
    <button
      onClick={() => onSelect(id)}
      className={`w-full text-left rounded-md border p-2.5 transition-colors ${
        isActive
          ? "border-emerald-600 bg-emerald-950/30"
          : "border-neutral-800 bg-neutral-950 hover:border-neutral-700"
      }`}
    >
      <div className="text-sm font-medium text-neutral-100">{title}</div>
      <div className="text-[11px] text-neutral-500 leading-relaxed mt-0.5">
        {subtitle}
      </div>
    </button>
  );
}

function StepPersona({
  name,
  description,
  onName,
  onDescription,
}: {
  name: string;
  description: string;
  onName: (v: string) => void;
  onDescription: (v: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-neutral-100 mb-1">
          Who are you in the scene?
        </h3>
        <p className="text-[11px] text-neutral-500 leading-relaxed">
          Optional. Lets the character know who they're talking to. You can
          add more personas later and swap between them per session.
        </p>
      </div>
      <LabeledField
        label="Your name"
        value={name}
        onChange={onName}
        placeholder="e.g. Alex, Volkov, anonymous traveler…"
      />
      <label className="block">
        <span className="text-[11px] text-neutral-500 uppercase tracking-wider">
          Description (optional)
        </span>
        <textarea
          value={description}
          onChange={(e) => onDescription(e.currentTarget.value)}
          rows={3}
          placeholder="A traveler visiting the coastal town for the week. Curious about old stories."
          className="mt-0.5 w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-sm text-neutral-100 resize-y focus:outline-none focus:border-neutral-600"
        />
      </label>
    </div>
  );
}

function StepCharacter({
  onImport,
  onDemo,
}: {
  onImport: (file: File) => void;
  onDemo: () => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-neutral-100 mb-1">
          Add a character
        </h3>
        <p className="text-[11px] text-neutral-500 leading-relaxed">
          Drop in a SillyTavern v2/v3 character card (PNG or JSON), or try
          the built-in demo character to see how it works.
        </p>
      </div>
      <label className="block rounded-md border border-dashed border-neutral-700 hover:border-neutral-600 px-4 py-6 text-center cursor-pointer">
        <span className="text-sm text-neutral-200">Import a card</span>
        <p className="text-[11px] text-neutral-500 mt-1">
          PNG (with embedded card metadata) or JSON. Available on chub.ai or
          your own collection.
        </p>
        <input
          type="file"
          accept=".png,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) onImport(f);
          }}
        />
      </label>
      <button
        onClick={onDemo}
        className="w-full text-sm rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-200 px-4 py-2"
      >
        Try the demo character (Ren — Salt Coast bookshop owner)
      </button>
    </div>
  );
}

function LabeledField({
  label,
  value,
  onChange,
  placeholder,
  type,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "password";
}) {
  return (
    <label className="block">
      <span className="text-[11px] text-neutral-500 uppercase tracking-wider">
        {label}
      </span>
      <input
        type={type ?? "text"}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder={placeholder}
        className="mt-0.5 w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-sm text-neutral-100 focus:outline-none focus:border-neutral-600"
      />
    </label>
  );
}
