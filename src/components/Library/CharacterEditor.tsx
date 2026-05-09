// In-app character editor. Lets users tweak personality / scenario /
// description / first_mes / alternate_greetings / tags on imported cards
// without leaving Chronicler. On save:
//   - updates the Character in localStorage (so reloads see the new values)
//   - writes new canon-tier seed memories for changed fields with
//     source=user_edit (preserves history; doesn't blow away the originals)
//   - regenerates system_prompt from edited fields
//   - rebuilds the raw_card JSON for round-trip export
//
// Saga task #31.

import { useState } from "react";
import type { Character } from "../../lib/orchestrator/types";
import type { YantrikClient } from "../../lib/yantrikdb/client";
import { rememberAsCanon } from "../../lib/yantrikdb/client";

interface Props {
  character: Character;
  onClose: () => void;
  onSave: (updated: Character) => void | Promise<void>;
  client?: YantrikClient;
  onOpenLorebook?: () => void;
}

export function CharacterEditor({ character, onClose, onSave, client, onOpenLorebook }: Props) {
  const [draft, setDraft] = useState<Character>({ ...character });

  function update<K extends keyof Character>(key: K, value: Character[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function commit() {
    const next: Character = {
      ...draft,
      // Rebuild system_prompt from edited fields so the next turn picks up
      // the changes. Format mirrors buildSystemPrompt in cards/decompose.ts.
      system_prompt: buildPromptFromCharacter(draft),
      // Update the embedded raw_card JSON so a future export keeps changes.
      raw_card: rebuildRawCard(draft),
    };

    // Append canon memories for fields that changed — doesn't blow away the
    // originals (those keep source=imported_seed). User-edits land alongside
    // with source=user_edit so the prompt inspector and memory inspector
    // both reflect provenance.
    if (client) {
      await persistChangedFields(client, character, next).catch(() => undefined);
    }

    await onSave(next);
    onClose();
  }

  const greetingsText = (draft.greetings ?? []).join("\n---\n");

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-neutral-900 border border-neutral-800 rounded-lg w-[720px] max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {draft.avatar_url ? (
              <img
                src={draft.avatar_url}
                alt=""
                className="w-9 h-9 rounded-full object-cover"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-neutral-800 flex items-center justify-center text-xs font-mono text-neutral-300">
                {draft.name?.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div>
              <h2 className="text-base font-semibold text-neutral-100">
                Edit character
              </h2>
              <p className="text-[11px] text-neutral-500 font-mono mt-0.5">
                id={draft.id}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-100 text-sm"
          >
            close
          </button>
        </header>

        <section className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <Field label="name">
            <input
              value={draft.name}
              onChange={(e) => update("name", e.currentTarget.value)}
              className="w-full bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-sm text-neutral-100 focus:outline-none focus:border-neutral-600"
            />
          </Field>

          <Field
            label="description"
            hint="What is this character, in a sentence or two?"
          >
            <textarea
              value={draft.description ?? ""}
              onChange={(e) => update("description", e.currentTarget.value)}
              rows={3}
              className="w-full bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-sm text-neutral-100 resize-y focus:outline-none focus:border-neutral-600"
            />
          </Field>

          <Field
            label="personality"
            hint="Voice, demeanor, behavioral patterns. Used in the system prompt every turn."
          >
            <textarea
              value={draft.personality ?? ""}
              onChange={(e) => update("personality", e.currentTarget.value)}
              rows={3}
              className="w-full bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-sm text-neutral-100 resize-y focus:outline-none focus:border-neutral-600"
            />
          </Field>

          <Field
            label="scenario"
            hint="Where + when. The opening situation."
          >
            <textarea
              value={draft.scenario ?? ""}
              onChange={(e) => update("scenario", e.currentTarget.value)}
              rows={2}
              className="w-full bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-sm text-neutral-100 resize-y focus:outline-none focus:border-neutral-600"
            />
          </Field>

          <Field
            label="greetings"
            hint="One greeting per block, separated by --- on its own line. First is the default; the rest are alternates."
          >
            <textarea
              value={greetingsText}
              onChange={(e) =>
                update(
                  "greetings",
                  e.currentTarget.value
                    .split(/^---$/m)
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0)
                )
              }
              rows={5}
              className="w-full bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-sm text-neutral-100 resize-y focus:outline-none focus:border-neutral-600 font-mono text-[12px]"
            />
            <p className="text-[10px] text-neutral-600 mt-1 font-mono">
              {(draft.greetings ?? []).length} greeting
              {(draft.greetings ?? []).length === 1 ? "" : "s"}
            </p>
          </Field>

          <Field
            label="example dialogues"
            hint="Sample exchanges that anchor the character's voice. Optional."
          >
            <textarea
              value={draft.mes_example ?? ""}
              onChange={(e) => update("mes_example", e.currentTarget.value)}
              rows={4}
              className="w-full bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-sm text-neutral-100 resize-y focus:outline-none focus:border-neutral-600 font-mono text-[12px]"
            />
          </Field>

          <Field label="tags">
            <input
              value={(draft.tags ?? []).join(", ")}
              onChange={(e) =>
                update(
                  "tags",
                  e.currentTarget.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0)
                )
              }
              placeholder="comma, separated, tags"
              className="w-full bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-sm text-neutral-100 focus:outline-none focus:border-neutral-600"
            />
          </Field>
        </section>

        <footer className="px-5 py-3 border-t border-neutral-800 flex items-center justify-between">
          {onOpenLorebook ? (
            <button
              onClick={onOpenLorebook}
              className="text-xs rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 px-2.5 py-1"
              title="Edit this character's lorebook entries"
            >
              edit lorebook →
            </button>
          ) : (
            <p className="text-[11px] text-neutral-500">
              Edits write canon memories with <code>source=user_edit</code>;
              originals stay intact.
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 rounded"
            >
              cancel
            </button>
            <button
              onClick={commit}
              className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 text-white rounded"
            >
              save
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-neutral-500 font-semibold">
        {label}
      </span>
      <div className="mt-1">{children}</div>
      {hint && (
        <p className="text-[11px] text-neutral-600 mt-1 leading-relaxed">
          {hint}
        </p>
      )}
    </label>
  );
}

function buildPromptFromCharacter(c: Character): string {
  const parts: string[] = [];
  parts.push(`You are ${c.name}.`);
  if (c.personality) parts.push(`Personality: ${c.personality}`);
  if (c.scenario) parts.push(`Scenario: ${c.scenario}`);
  if (c.description) parts.push(`Description: ${c.description}`);
  if (c.mes_example) parts.push(`Example dialogue:\n${c.mes_example}`);
  return parts.join("\n\n");
}

function rebuildRawCard(c: Character): string {
  // Try to preserve any extra fields from the original raw_card by parsing
  // and patching, falling back to a fresh v2 card structure.
  let base: { spec?: string; spec_version?: string; data?: Record<string, unknown> };
  try {
    base = c.raw_card ? JSON.parse(c.raw_card) : ({} as typeof base);
  } catch {
    base = {};
  }
  const data = (base.data ?? {}) as Record<string, unknown>;
  const greetings = c.greetings ?? [];
  return JSON.stringify({
    spec: base.spec ?? "chara_card_v2",
    spec_version: base.spec_version ?? "2.0",
    data: {
      ...data,
      name: c.name,
      description: c.description ?? "",
      personality: c.personality ?? "",
      scenario: c.scenario ?? "",
      first_mes: greetings[0] ?? "",
      alternate_greetings: greetings.slice(1),
      mes_example: c.mes_example ?? "",
      tags: c.tags ?? [],
    },
  });
}

async function persistChangedFields(
  client: YantrikClient,
  prev: Character,
  next: Character
): Promise<void> {
  // For each field that changed, write a fresh canon-tier memory tagged
  // with source="user_edit" so the prompt inspector + memory inspector
  // can distinguish user-edited canon from imported seeds. Originals stay.
  const inputs: Array<{ field: string; old: string; next: string }> = [];
  const cmp = (
    field: keyof Character,
    label: string
  ): void => {
    const o = String(prev[field] ?? "").trim();
    const n = String(next[field] ?? "").trim();
    if (o !== n && n.length > 0) {
      inputs.push({ field: label, old: o, next: n });
    }
  };
  cmp("description", "Description");
  cmp("personality", "Personality");
  cmp("scenario", "Scenario");
  cmp("mes_example", "Example dialogue");

  // Greetings changed too?
  const oldG = (prev.greetings ?? []).join("|");
  const newG = (next.greetings ?? []).join("|");
  if (oldG !== newG && (next.greetings?.[0] ?? "").length > 0) {
    inputs.push({
      field: "First message template",
      old: prev.greetings?.[0] ?? "",
      next: next.greetings?.[0] ?? "",
    });
  }

  if (inputs.length === 0) return;

  const memInputs = inputs.map(({ field, next: n }) =>
    rememberAsCanon(`${field} of ${next.name}: ${n}`, "user-edit", {
      character_id: next.id,
      world_id: next.world_id,
      visible_to: ["*"],
    })
  );
  // Override source on each input to user_edit (rememberAsCanon defaults to
  // "user", which is fine here too — the canonical_status field stays canon).
  for (const i of memInputs) i.source = "user";
  await client.rememberBatch(memInputs);
}
