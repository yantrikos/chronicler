// Scene — the participants that can hear what's said in the current exchange.
// Drives visible_to ACLs on every memory written. See Saga tasks #20, #21.
//
// Key invariant: a memory's visible_to must match the audience that was
// present when the statement was made. If A tells the user a secret in a
// 1-on-1 scene, visible_to = [user, A]. If B later joins and the user
// repeats the secret aloud, a NEW memory is written with visible_to =
// [user, A, B]. We never mutate the original memory's visibility —
// provenance matters.

import type { Character } from "./types";

export interface Scene {
  id: string;
  participants: string[]; // character ids + "user"
  kind: "solo" | "group";
  created_at: string;
}

export function soloScene(characterId: string): Scene {
  return {
    id: `scene-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    participants: ["user", characterId],
    kind: "solo",
    created_at: new Date().toISOString(),
  };
}

export function groupScene(characterIds: string[]): Scene {
  return {
    id: `scene-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    participants: ["user", ...characterIds],
    kind: "group",
    created_at: new Date().toISOString(),
  };
}

/** The visible_to ACL for memories written during this scene. Everyone in the
 *  scene hears what's said — they all get visibility. World canon (shared
 *  lore) has visible_to = ["*"] and is written by card import, not by scene. */
export function sceneVisibleTo(scene: Scene): string[] {
  return [...scene.participants];
}

/** Validate that a speaker is a participant in the scene. Called before
 *  composing a turn for that speaker — prevents accidentally running the
 *  orchestrator with a speaker who isn't in the scene. */
export function assertParticipant(scene: Scene, speaker: string): void {
  if (!scene.participants.includes(speaker)) {
    throw new Error(
      `speaker "${speaker}" is not a participant of scene ${scene.id} (participants: ${scene.participants.join(
        ", "
      )})`
    );
  }
}

/** When a new participant joins an existing scene, the scene becomes a group
 *  scene. Prior memories stay with their original visibility — we do not
 *  retroactively grant access to the newcomer. They learn things only when
 *  told in the new scene. */
export function addParticipant(scene: Scene, characterId: string): Scene {
  if (scene.participants.includes(characterId)) return scene;
  return {
    ...scene,
    participants: [...scene.participants, characterId],
    kind: "group",
  };
}

export function participantsByCharacter(
  scene: Scene,
  charactersById: Record<string, Character>
): Character[] {
  return scene.participants
    .filter((p) => p !== "user" && charactersById[p])
    .map((p) => charactersById[p]);
}
