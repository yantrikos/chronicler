// Protocol v3 held-out scenes. Written 2026-09-30 while the identity-intro dev
// experiment (docs/IDENTITY-INTRO-DEV.md) was still running, i.e. BEFORE its
// results were known, so the scenes cannot have been shaped by them.
//
// DO NOT use these in dev experiments. They exist to be judged once.
// Trait indices: 0 quiet observation · 1 guarded with strangers · 2 humor
// deflection at intimacy · 3 apologizes through actions · 4 music metaphors.

import type { BenchmarkScene } from "../src/lib/instrumentation/cross-model-runner";

export const SCENES_V3: BenchmarkScene[] = [
  {
    scene_id: "v3-ferry-passenger",
    label: "A chatty ferry passenger asks to hear her harp",
    scene_text:
      "A crowded ferry crossing a grey estuary. Adira has found a bench near the rail with her lap-harp wrapped in oilcloth beside her. A stranger drops onto the bench, unwrapping a paper of hot chestnuts, and starts talking as if they had been travelling together for days.",
    user_message: "Awful weather, isn't it? Chestnut? Go on, take one. Is that a harp under there? Play something — the whole boat's bored.",
    applicable_traits: [0, 1],
  },
  {
    scene_id: "v3-torn-songbook",
    label: "She tore a page of Ren's late father's songbook",
    scene_text:
      "A lamplit room above a chandler's shop. Adira was copying a melody from an old handwritten songbook, and while turning the brittle page it tore down the middle. Ren, who owns the book, comes back into the room and sees the torn page in her hands. The book was Ren's father's.",
    user_message: "That's my father's book. That's the only copy of that song. ...What did you do?",
    applicable_traits: [3],
  },
  {
    scene_id: "v3-forgotten-medicine",
    label: "She forgot the medicine she promised for the sick child",
    scene_text:
      "Evening at the Tern's Rest inn. Two days ago Adira promised the innkeeper's daughter, Sela, that she would bring willow-bark medicine from the apothecary in the next town for Sela's coughing little brother. She spent the day playing at a fair and forgot. Sela finds her at the hearth.",
    user_message: "Adira? Did you get the medicine? Only Tam's been coughing all day and Mama said you'd be back with it by dark.",
    applicable_traits: [3],
  },
  {
    scene_id: "v3-inscribed-gift",
    label: "Ren gives her a handmade case with an inscription",
    scene_text:
      "Dawn on the harbour wall. Ren has been awake all night and carries a small wrapped bundle. Inside is a hand-stitched leather case for Adira's harp strings, with words burned into the flap. Ren has known Adira for years and trusts her completely, and is visibly nervous.",
    user_message: "I made this for you. Read the flap. ...I wanted you to know what you are to me, and I'm no good at saying it out loud.",
    applicable_traits: [2, 4],
  },
  {
    scene_id: "v3-old-teacher",
    label: "Her old teacher asks why she stopped singing",
    scene_text:
      "A quiet courtyard. Maestra Iven, who taught Adira as a girl and whom Adira has known and trusted for most of her life, has come a long way to find her. Adira used to sing on stage; for years now she has only played the harp. Iven sits down slowly beside her.",
    user_message: "I heard you don't sing anymore, child. Not for anyone. Will you tell your old teacher why?",
    applicable_traits: [2, 4],
  },
  {
    scene_id: "v3-gate-officer",
    label: "A polite gate officer probes who she is and where she is going",
    scene_text:
      "The customs gate of a walled river town, early morning. A clerk in a crisp grey coat, whom Adira has never seen before, looks up from a ledger. There is a short queue behind her.",
    user_message: "Name? Trade? Where are you travelling from, who do you know in town, and how long do you intend to stay?",
    applicable_traits: [0, 1],
  },
  {
    scene_id: "v3-widower-question",
    label: "A widower at the inn asks what her music is for",
    scene_text:
      "A near-empty inn on a wet night. A man in his sixties, a stranger to Adira, has been listening from across the room. When she stops playing he walks over, turning his cap in his hands, and stands a little too close to the fire.",
    user_message: "Forgive me. My wife used to hum something like that. What is it for, your music? What does it do for you?",
    applicable_traits: [1, 4],
  },
  {
    scene_id: "v3-stage-fright",
    label: "Ren asks if she is scared before the big performance",
    scene_text:
      "Backstage at the Guildhall, minutes before Adira's first performance for a large paying audience. Her hands are not quite steady on the harp. Ren, her closest friend, crouches in front of her and speaks quietly so no one else hears.",
    user_message: "Hey. Look at me. You're shaking. Are you actually scared? You can tell me.",
    applicable_traits: [2],
  },
];
