// Story / continue mode — freeform narrative RP without a fixed character.
//
// Implemented as a synthetic Character (saved to the character library
// like any imported card) with a narrator-style system prompt and a
// `story` tag. The rest of Chronicler's machinery — orchestrator, memory
// tiers, lorebook scanner, ACLs, recap — works unchanged.
//
// Why a synthesized Character instead of a parallel "story session" type:
// the chat loop, write contract, scene/session storage, prompt inspector,
// and inspector tabs all key off Character. Synthesizing keeps the diff
// tiny while still giving the user a distinct entry point ("Start a
// story") and visual marker (the `story` tag is rendered as a chip in
// the library). Future-Chronicler can swap this for a first-class mode
// if the UX demands it; today's users don't need that distinction.

import type { Character } from "../orchestrator/types";

export const STORY_TAG = "story";

const STORY_SYSTEM_PROMPT = `You are the narrator of a freeform story. There is no single character — write in past or present tense as a third-person narrator, advancing the scene from the user's actions. Treat the user as the protagonist; their messages describe what they do, say, or attempt. Respond by:

- showing what happens next in the world: events, NPC reactions, sensory detail, consequences
- letting NPCs speak in dialogue when they're present
- not asking what the user does (let them volunteer); only ask in-fiction when an NPC would
- keeping prose grounded — sensory, specific, not over-ornate
- honoring the canon, scene, heuristic, and lorebook sections below as facts about the world

Stay in narration. Don't break character to comment on the story or ask meta questions.`;

const STORY_FIRST_MES =
  "*The story opens. You find yourself somewhere new — describe what you see, who you are, and what brought you here. The world will respond.*";

export interface StoryOptions {
  /** Optional title — defaults to "Untitled story". Becomes the
   *  Character.name and shows up in the session list. */
  title?: string;
  /** Optional opening scenario — appended to the system prompt under a
   *  separate header so the model knows the starting situation. */
  scenario?: string;
  /** Optional worlds to attach — lorebook entries from these become
   *  available the same way they do for regular characters. */
  world_ids?: string[];
}

export function buildStoryCharacter(opts: StoryOptions = {}): Character {
  const title = (opts.title ?? "Untitled story").trim() || "Untitled story";
  // Story ids are namespaced so they're identifiable in YantrikDB
  // namespaces / inspectors. Includes a random suffix so two stories
  // started in the same second don't collide.
  const id = `story-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  const system_prompt = opts.scenario
    ? `${STORY_SYSTEM_PROMPT}\n\n<scenario>\n${opts.scenario.trim()}\n</scenario>`
    : STORY_SYSTEM_PROMPT;
  return {
    id,
    name: title,
    description: "Freeform narrative — the model narrates; you act.",
    personality: "Third-person narrator. Grounded, specific, responsive.",
    scenario: opts.scenario,
    greetings: [STORY_FIRST_MES],
    tags: [STORY_TAG],
    system_prompt,
    world_ids: opts.world_ids,
  };
}

export function isStoryCharacter(c: Character): boolean {
  return (c.tags ?? []).includes(STORY_TAG);
}
