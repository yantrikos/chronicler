import { Mark } from "./Logo";

interface Props {
  onImport: () => void;
  onDemo: () => void;
  onOpenSettings: () => void;
  hasPriorSessions: boolean;
}

export function EmptyState({
  onImport,
  onDemo,
  onOpenSettings,
  hasPriorSessions,
}: Props) {
  return (
    <div className="h-full flex items-center justify-center p-10 bg-neutral-900">
      <div className="max-w-md text-center">
        <div className="flex justify-center mb-6">
          <Mark size={72} />
        </div>
        <h1 className="text-2xl font-semibold text-neutral-100 tracking-tight">
          Chronicler
        </h1>
        <p className="text-sm text-neutral-400 mt-1.5 leading-relaxed">
          Local-first roleplay with living memory.
          <br />
          Import a character, chat, return tomorrow and pick up where you left off.
        </p>

        <div className="mt-8 flex flex-col gap-2 items-stretch">
          <button
            onClick={onImport}
            className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 text-sm font-medium"
          >
            Import a character card
          </button>
          <button
            onClick={onDemo}
            className="rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-200 px-4 py-2 text-sm"
          >
            Try with the demo character
          </button>
          {hasPriorSessions && (
            <p className="text-[11px] text-neutral-500 mt-2">
              Prior sessions are listed on the right. Click one to resume.
            </p>
          )}
        </div>

        <div className="mt-8 pt-6 border-t border-neutral-800 text-[11px] text-neutral-500 space-y-1">
          <p>
            First time? Open{" "}
            <button
              onClick={onOpenSettings}
              className="underline hover:text-neutral-300"
            >
              Settings
            </button>{" "}
            to add your LLM provider (Ollama local, OpenAI, Anthropic) and set your persona.
          </p>
          <p className="text-neutral-600">
            Your data never leaves this machine.
          </p>
        </div>
      </div>
    </div>
  );
}
