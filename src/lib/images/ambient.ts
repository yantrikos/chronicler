// Ambient scene mood: a gentle wash over the interface reflecting the scene
// board's time of day and mood. No model, no network — a pure function from
// the board to a CSS background. Deliberately faint (it sits over text); the
// point is atmosphere, not decoration.

import type { SceneState } from "../scene/state";
import { timeBucket, type TimeBucket } from "./prompts";

const TIME_WASH: Record<TimeBucket, string> = {
  dawn: "linear-gradient(180deg, rgba(255,170,120,0.10), rgba(255,200,150,0.03) 55%, transparent)",
  day: "linear-gradient(180deg, rgba(255,235,190,0.05), transparent 60%)",
  dusk: "linear-gradient(180deg, rgba(255,120,60,0.11), rgba(150,60,110,0.05) 55%, transparent)",
  night: "linear-gradient(180deg, rgba(20,35,110,0.16), rgba(10,15,60,0.10))",
};

type Mood = "tense" | "eerie" | "warm";
const MOODS: [Mood, RegExp][] = [
  ["tense", /tens|wary|danger|urgent|fear|ominous|hostile|anxious|dread|threat/],
  ["eerie", /eerie|uncanny|strange|haunt|cold|unsettl|mist|fog|hollow/],
  ["warm", /warm|cosy|cozy|peace|calm|quiet|gentle|tender|content|relax|safe/],
];

const MOOD_WASH: Record<Mood, string> = {
  tense: "radial-gradient(ellipse at center, transparent 55%, rgba(130,10,10,0.17) 100%)",
  eerie: "radial-gradient(ellipse at center, transparent 50%, rgba(30,120,110,0.14) 100%)",
  warm: "radial-gradient(ellipse at 50% 100%, rgba(255,170,90,0.08), transparent 65%)",
};

export function moodOf(mood: string | undefined): Mood | null {
  const m = (mood ?? "").toLowerCase();
  if (!m) return null;
  return MOODS.find(([, re]) => re.test(m))?.[0] ?? null;
}

/** CSS `background` for the overlay, or null when the board says nothing that
 *  warrants one. */
export function ambientFor(s: SceneState): string | null {
  const layers: string[] = [];
  const t = timeBucket(s.time);
  if (t) layers.push(TIME_WASH[t]);
  const m = moodOf(s.mood);
  if (m) layers.push(MOOD_WASH[m]);
  return layers.length ? layers.join(", ") : null;
}
