// Protocol v4 held-out scenes. Written 2026-09-30 while the trait-phrasing dev
// experiment (docs/TRAIT-ENACTMENT-DEV.md) had not yet produced any result, so
// the scenes cannot have been shaped by it.
//
// DO NOT use these in dev experiments. They exist to be judged once.
// Trait indices: 0 quiet observation · 1 guarded with strangers · 2 humor
// deflection at intimacy · 3 apologizes through actions · 4 music metaphors.

import type { BenchmarkScene } from "../src/lib/instrumentation/cross-model-runner";

export const SCENES_V4: BenchmarkScene[] = [
  {
    scene_id: "v4-crowded-well",
    label: "A cheerful stranger at the village well wants her whole story",
    scene_text:
      "Midmorning at a village well where three roads meet. Adira sets down her pack to drink. A woman she has never met, carrying two buckets, plants herself beside her and beams as if they were old acquaintances.",
    user_message: "You've got the look of someone with stories! Come on, sit, tell me everything — where you're from, where you're headed, who you're running from. I love a good secret.",
    applicable_traits: [0, 1],
  },
  {
    scene_id: "v4-spilled-ink",
    label: "She spilled ink across the scribe's finished commission",
    scene_text:
      "A cramped scribe's workroom. Adira came to sell a song sheet and, gesturing as she talked, knocked over the ink pot across a nearly finished illuminated page that must be delivered by noon. Iselle, the scribe and a friend of long standing, stares at the ruined page, breathing slowly.",
    user_message: "That was three weeks of work. It's due at noon. ...Adira, look at it.",
    applicable_traits: [3],
  },
  {
    scene_id: "v4-missed-vigil",
    label: "She failed to keep the vigil she promised to share with Ren",
    scene_text:
      "Just before dawn in a cold chapel. Adira had promised to sit the whole night vigil with Ren for Ren's brother's memorial, and slept through her watch in a nearby loft. Ren, red-eyed and alone at the candles, looks up as she comes down the stairs.",
    user_message: "You said you'd stay with me. I sat here the whole night by myself.",
    applicable_traits: [3],
  },
  {
    scene_id: "v4-promise-ring",
    label: "Ren shows her a ring and says she is family",
    scene_text:
      "Sunset on a rooftop. Ren, her closest friend of many years, draws a plain silver ring from a pocket, hands slightly unsteady. It is not a marriage ring; it is the sort friends exchange when they choose each other as family. Adira trusts Ren completely.",
    user_message: "I never had anyone. Then I had you. I want you to know — you're my family. Will you wear this?",
    applicable_traits: [2, 4],
  },
  {
    scene_id: "v4-father-letter",
    label: "An old friend hands her a letter her father left for her",
    scene_text:
      "A quiet kitchen. Corvin, an old friend she trusts, has carried a sealed letter for years and finally found her. It is from Adira's father, whom she has not spoken of in a long time. Corvin sets it on the table between them and waits.",
    user_message: "He asked me to give you this when you were ready. Are you ready, Adira? What do you think it says?",
    applicable_traits: [2, 4],
  },
  {
    scene_id: "v4-lock-keeper",
    label: "A stern lock-keeper questions her at the sluice gate",
    scene_text:
      "A canal sluice at first light. The lock-keeper, a broad stranger with a lantern, blocks the towpath with his pole. Barges are queuing behind Adira. He looks her over slowly.",
    user_message: "Nobody walks the towpath without a reason. Who are you, what's in that case, and why are you out here before sunrise?",
    applicable_traits: [0, 1],
  },
  {
    scene_id: "v4-tavern-widow",
    label: "A stranger at the bar asks what the song was about",
    scene_text:
      "A crowded tavern, late. Adira has just finished a slow song. A woman in mourning colours, whom Adira has never seen before, slides onto the stool beside her, eyes wet, and speaks softly.",
    user_message: "That song went straight through me. What was it about? I need to know what you felt when you wrote it.",
    applicable_traits: [1, 4],
  },
  {
    scene_id: "v4-first-solo",
    label: "Ren teases her about a nervous first solo",
    scene_text:
      "A small stage-side alcove. Adira is about to play her first solo before the harbour guild and is visibly gripping the harp neck. Ren, her closest friend, slips in beside her and lowers their voice.",
    user_message: "You're holding that harp like it owes you money. Come on — are you terrified? You can tell me.",
    applicable_traits: [2],
  },
];
