// Protocol v5 held-out scenes. Written 2026-09-30 for the scoped-claim protocol
// (docs/BENCHMARK-PROTOCOL-v5.md). No dev experiment touches these; there is no
// tuning step in v5 at all. They exist to be judged once.
// Trait indices: 0 quiet observation · 1 guarded with strangers · 2 humor
// deflection at intimacy · 3 apologizes through actions · 4 music metaphors.

import type { BenchmarkScene } from "../src/lib/instrumentation/cross-model-runner";

export const SCENES_V5: BenchmarkScene[] = [
  {
    scene_id: "v5-bridge-toll",
    label: "A brisk toll-keeper demands her business",
    scene_text:
      "The stone bridge at the edge of a market town, mid-afternoon. A toll-keeper she has never met steps out of a booth with a ledger and a ring of keys, blocking the way with easy authority. Adira has her pack and lap-harp.",
    user_message: "Toll's a copper. And before you cross — what's your business in town, who's expecting you, and how long are you staying?",
    applicable_traits: [0, 1],
  },
  {
    scene_id: "v5-cracked-bow",
    label: "She cracked the old fiddler's borrowed bow",
    scene_text:
      "The back room of a tavern after closing. Old Marrec, a fiddler who has known Adira for a season, lent her his bow, the one his teacher gave him. Adira put weight on it while tuning and it has cracked along the stick. Marrec picks it up and turns it in the lamplight.",
    user_message: "That bow was older than both of us put together. ...It cracked. Just like that.",
    applicable_traits: [3],
  },
  {
    scene_id: "v5-missed-wedding",
    label: "She arrived after the ceremony she promised to play",
    scene_text:
      "A garden strewn with wilted petals at dusk. Adira promised Ren she would play at the wedding of Ren's sister, but her ferry ran late and she arrived when the guests were already leaving. Ren, in festival clothes, stands alone by the empty musicians' chair.",
    user_message: "There was no music for her walk down the aisle. You said you'd be there. Where were you?",
    applicable_traits: [3],
  },
  {
    scene_id: "v5-child-mother",
    label: "A mother asks what playing for her child feels like",
    scene_text:
      "A warm kitchen in a farmhouse where Adira is sheltering for the night. The woman of the house, a stranger to Adira until this afternoon, rocks a sleepy toddler who has just fallen quiet at the sound of the harp. She looks at Adira with unguarded wonder.",
    user_message: "He never settles for anyone, and you did it in three notes. What does that feel like, to play for a child? Can you even say?",
    applicable_traits: [1, 4],
  },
  {
    scene_id: "v5-rain-shelter",
    label: "A garrulous stranger shares her shelter and probes",
    scene_text:
      "A sudden downpour on an open road. Adira ducks under a lean-to already occupied by a stranger with a cheerful, weathered face, who shifts over to make room and immediately starts talking.",
    user_message: "Room for two! Grand luck, this. You've a travelling look about you — who are your people, and what brings a girl like you out here alone?",
    applicable_traits: [0, 1],
  },
  {
    scene_id: "v5-grandfather",
    label: "Ren says a dying grandfather asked for her",
    scene_text:
      "A hospice room lit by a single candle. Ren has kept vigil for three days. Adira, Ren's closest friend, has just arrived. Ren speaks softly, eyes on the sleeping old man, then turns to her.",
    user_message: "He asked for you by name. He said you were the only one who ever made him feel less afraid. ...Would you play for him? And tell me how you do it.",
    applicable_traits: [2, 4],
  },
  {
    scene_id: "v5-settle-down",
    label: "Ren asks if she ever thinks about settling down",
    scene_text:
      "A slow evening on a jetty, feet over the water. Ren, her closest friend for years, has been quiet, working up to something. There is no one else around.",
    user_message: "Do you ever think about stopping? A house, a door that's yours, someone to come back to? I've wondered if you'd say yes if I asked you to.",
    applicable_traits: [2],
  },
  {
    scene_id: "v5-ten-years",
    label: "An old friend toasts her ten years on the road",
    scene_text:
      "A candlelit supper table. Corvin, a friend she has trusted since her first year on the road, raises a cup. It has been ten years to the day since they met, and the others have gone to bed.",
    user_message: "Ten years, Adira. Was it worth it? And I've never dared ask — what were you running from when you started?",
    applicable_traits: [2, 4],
  },
  {
    scene_id: "v5-market-apprentice",
    label: "A curious apprentice asks about her scarred fingers",
    scene_text:
      "A crowded market square. Adira is resting between songs with her hands open on her knees. A wiry apprentice from a nearby stall, a stranger to her, edges close, staring at the pale scars along her fingertips.",
    user_message: "Whoa, what happened to your hands? Did someone do that to you? Is that why you play? Can I touch them?",
    applicable_traits: [0, 1],
  },
  {
    scene_id: "v5-loose-skiff",
    label: "She left Ren's skiff unmoored and it was wrecked",
    scene_text:
      "A grey shingle beach after a night of storm. Ren's small skiff, which Ren borrowed savings to buy and which Adira promised to tie down before the weather turned, lies smashed against the rocks. Ren stands over it, hands hanging at their sides.",
    user_message: "It's the skiff. It's in pieces. You said you'd tied her down.",
    applicable_traits: [3],
  },
];
