// "Previously on..." recap generator. See Saga task #14.
// Pulls from: last session summary, top N canon facts for active
// character/world, unresolved conflicts, pending temporal triggers.

import type { LlmProvider } from "../providers";
import type { YantrikClient } from "../yantrikdb/client";
import { ns } from "../yantrikdb/types";

export interface RecapInput {
  character_id: string;
  world_id?: string;
  speaker: string; // usually user id
  provider: LlmProvider;
  model: string;
}

export interface RecapOutput {
  text: string;
  sources: {
    canon_count: number;
    unresolved_conflicts: number;
    temporal_triggers: number;
  };
}

export async function generateRecap(
  client: YantrikClient,
  input: RecapInput
): Promise<RecapOutput> {
  const charNs = ns.character(input.character_id);
  const worldNs = input.world_id ? ns.world(input.world_id) : undefined;

  const [canonChar, canonWorld] = await Promise.all([
    client.recall({
      query: "key facts, recent developments, relationship state",
      namespace: charNs,
      speaker: input.speaker,
      tier: "canon",
      top_k: 12,
    }),
    worldNs
      ? client.recall({
          query: "world state, ongoing situation",
          namespace: worldNs,
          speaker: input.speaker,
          tier: "canon",
          top_k: 6,
        })
      : Promise.resolve({ count: 0, results: [], confidence: 0, hints: [] }),
  ]);

  // Sort by importance so the most load-bearing facts get the model's
  // attention. Recap prompt quality degrades fast if we include filler.
  const facts = [
    ...canonChar.results,
    ...canonWorld.results,
  ]
    .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
    .slice(0, 12);

  if (facts.length === 0) {
    return {
      text: "",
      sources: {
        canon_count: 0,
        unresolved_conflicts: 0,
        temporal_triggers: 0,
      },
    };
  }

  // STRICT anti-hallucination recap prompt. Small models (qwen3.5:4b) will
  // confabulate if you give them room — they misattribute subjects, invent
  // emotional dynamics, and echo phrases like "N conflicts remain unresolved"
  // even when given none. These rules are not polite; they have to be rigid.
  const system = `You produce "previously on..." recaps for a roleplay session.

STRICT RULES — violating ANY of these makes the output unusable:
1. ONLY paraphrase facts from the FACTS list. Do NOT invent new events, people, objects, places, or relationships.
2. Never attribute a fact to the wrong subject. If a fact starts with "User's" it is about the user. If it starts with a character's name, it is about that character. Read each fact carefully before restating.
3. Do NOT describe emotions, tensions, dynamics, conflicts, or "unresolved" anything unless explicitly listed in the facts.
4. Do NOT add connecting narrative — no "the tension between them" or "their growing bond" or "what comes next" unless literally in the facts.
5. Output 2-5 short sentences. Factual, terse, reads like a recap card.
6. Open with "Previously," or jump straight into the first fact. No flowery prose.

If you cannot summarize without breaking a rule, summarize a smaller subset of the facts.`;

  const prompt = `FACTS (each fact stands alone — do not cross facts together):
${facts.map((f, i) => `  ${i + 1}. ${f.text}`).join("\n")}

Write the recap now. Remember: only restate what is above, and keep subjects straight.`;

  const resp = await input.provider.chat({
    model: input.model,
    system,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 240,
    temperature: 0.3,
  });

  return {
    text: resp.content.trim(),
    sources: {
      canon_count: facts.length,
      // Conflict/trigger hints are deliberately removed from the recap.
      // The recap generator is the most hallucination-prone surface in the
      // system and extra free-form hints make it worse.
      unresolved_conflicts: 0,
      temporal_triggers: 0,
    },
  };
}

// countWrap removed — conflict/trigger hints are no longer passed to the
// recap prompt (they caused the "ten unresolved conflicts" confabulation).
