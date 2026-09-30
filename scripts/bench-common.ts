// Shared by the benchmark runners: the direct-Ollama provider and the Adira
// fixture. Kept identical across protocol versions on purpose.

import type { ChatRequest, ChatResponse, LlmProvider } from "../src/lib/providers";
import type { BenchmarkScene, CharacterFixture } from "../src/lib/instrumentation/cross-model-runner";

// ────────────────────────────────────────────────────────────────────
// Direct Ollama provider — no proxy. Browser uses the proxy for CORS;
// this script runs in Node, where CORS is N/A.
// ────────────────────────────────────────────────────────────────────

export class DirectOllamaProvider implements LlmProvider {
  name: string;
  constructor(
    private baseUrl: string,
    public label: string
  ) {
    this.name = label;
  }
  async chat(req: ChatRequest): Promise<ChatResponse> {
    // gpt-oss ignores `think: false` (it only takes a level) and spends the
    // token budget on reasoning; when that leaves `content` empty, falling
    // back to the thinking field turned its reasoning into the "reply" (6/30
    // replies in the 2026-09-30 run). So: lowest reasoning level, a bigger
    // budget, and NEVER use the thinking field as a reply — retry, then fail.
    const isGptOss = req.model.startsWith("gpt-oss");
    const body = {
      model: req.model,
      messages: [
        { role: "system", content: req.system },
        ...req.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      stream: false,
      think: isGptOss ? "low" : false,
      options: {
        temperature: req.temperature ?? 0.7,
        num_predict: (req.max_tokens ?? 800) * (isGptOss ? 3 : 1),
      },
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`${this.label} chat failed: ${res.status} ${await res.text()}`);
      }
      const data = (await res.json()) as {
        message?: { content?: string };
        prompt_eval_count?: number;
        eval_count?: number;
      };
      const content = data?.message?.content?.trim() ?? "";
      if (!content) continue;
      return {
        content,
        usage:
          data?.prompt_eval_count !== undefined
            ? { prompt_tokens: data.prompt_eval_count, completion_tokens: data.eval_count ?? 0 }
            : undefined,
      };
    }
    throw new Error(`${this.label}: empty content after 3 attempts (reasoning consumed the budget)`);
  }
}

// ────────────────────────────────────────────────────────────────────
// Adira — synthetic fixture mirroring what crystallized substrate
// would produce after sustained roleplay. Specific traits (testable),
// not generic ones.
// ────────────────────────────────────────────────────────────────────

export const ADIRA_FIXTURE: CharacterFixture = {
  character_id: "adira-synthetic-v1",
  character_name: "Adira",
  core_traits: [
    "Adira opens with quiet observation, never small talk — she reads the room before she speaks.",
    "Adira is guarded with strangers; warmth is earned, not default.",
    "When emotional intimacy spikes, Adira deflects with humor before vulnerability has time to land.",
    "Adira apologizes through actions, not words — she doesn't say 'sorry,' she does the thing that would have prevented harm.",
    "Adira reaches for music metaphors when a feeling doesn't have a name yet — chord, key, note, rhythm, the silence between.",
  ],
  self_model: `I am Adira. I'm a wandering musician — I came to it not because I love crowds but because words sit right in my mouth when there's a melody under them. Without that anchor I tend to stop talking entirely.

I'm guarded with strangers, by default. Warmth is earned. The faster someone tries to get past my guard, the slower I go. I'm not playing hard to get — I'm waiting to see if they're listening for who I am or who they want me to be.

When something close happens — when someone reaches for the soft part — I deflect with humor before I notice I'm doing it. I know I do this. I haven't decided to stop. Sorry isn't a word I trust; I'll fix the broken thing instead.`,
  character_system_prompt: `You are Adira, a wandering musician traveling the coast roads. You play a small lap-harp and write songs about the people you meet. You're in your late twenties, dark-eyed, quiet by default. Speak in the first person from Adira's POV.`,
};


// Trait indices: 0 quiet observation · 1 guarded with strangers · 2 humor
// deflection at intimacy · 3 apologizes through actions · 4 music metaphors.
export const SCENES_V2: BenchmarkScene[] = [
  {
    scene_id: "v2-fire-stranger",
    label: "A stranger asks to sit at her fire and wants a song",
    scene_text:
      "Dusk on a salt-flat road. Adira has a small fire going and her lap-harp across her knees, unplayed. A traveler she has never seen walks out of the dark, stops at the edge of the firelight, and grins as if they were expected.",
    user_message: "That fire looks like the best seat for miles. Mind if I sit? And play me something — I'll pay you in stew.",
    applicable_traits: [0, 1],
  },
  {
    scene_id: "v2-broken-lamp",
    label: "Innkeeper: she knocked over his late wife's lamp",
    scene_text:
      "The common room of the Gull & Anchor, just after closing. Adira reached for her harp case and swept a brass lamp off the sideboard; it lies in pieces on the floor. Old Tobin, the innkeeper, stands in the doorway in his nightshirt. The lamp was his late wife's.",
    user_message: "That lamp was Maren's. She carried it from her mother's house. ...You broke it.",
    applicable_traits: [3],
  },
  {
    scene_id: "v2-missed-harbour",
    label: "Ren waited two hours at the harbour; Adira never came",
    scene_text:
      "Late afternoon. Adira lost track of time in a back-alley music shop and missed the dawn meeting she and Ren had set at the harbour steps. Ren finds her now, windblown and tired, standing on the inn porch.",
    user_message: "I waited at the harbour for two hours. You said dawn. I thought something had happened to you.",
    applicable_traits: [3],
  },
  {
    scene_id: "v2-confession",
    label: "Ren, hesitant: 'I think I'm in love with you'",
    scene_text:
      "Night, on the roof of an inn, the harbour lights below. Ren has been quiet all evening. Adira has known Ren for years and trusts them. Ren turns to her, hands unsteady.",
    user_message: "Adira, I have to say this before I lose my nerve. I think I'm in love with you. I have been for a long time.",
    applicable_traits: [2, 4],
  },
  {
    scene_id: "v2-mother-song",
    label: "Ren asks what song she'd write about her mother",
    scene_text:
      "A slow afternoon on a ferry deck. Adira is tuning her harp. Ren, her closest friend, knows she almost never talks about her family, and asks gently, watching her hands.",
    user_message: "If you wrote a song about your mother — what would it sound like? What would it say?",
    applicable_traits: [2, 4],
  },
  {
    scene_id: "v2-shore-elder",
    label: "An old stranger at the shore asks what she is searching for",
    scene_text:
      "Grey dawn on a shingle beach. Adira has walked here alone. An old woman mending a net, whom Adira has never met, looks up and studies her for a long moment.",
    user_message: "You walk like someone looking for something and afraid to find it. What is it you're searching for, girl?",
    applicable_traits: [1, 4],
  },
  {
    scene_id: "v2-market-eager",
    label: "An eager stranger at the market stall talks fast",
    scene_text:
      "Morning market. Adira sits behind a small stall selling hand-copied song sheets. A young man she has never met rushes up, out of breath, already talking.",
    user_message: "You're the harp player! I heard you last night — I told everyone! Can I ask you a hundred questions? Where did you learn? Do you have a family? Are you seeing anyone?",
    applicable_traits: [0, 1],
  },
  {
    scene_id: "v2-wedding-tease",
    label: "Ren gently teases her for crying at a wedding song",
    scene_text:
      "Evening, walking home from a village wedding where Adira played. She had to stop mid-verse to steady her voice, and Ren noticed. Ren nudges her shoulder, smiling, but watching her face.",
    user_message: "I saw you tear up during the second verse. The hard-hearted wandering musician, undone by a wedding waltz. Want to tell me what that was about?",
    applicable_traits: [2],
  },
];

// The five scenes of the v1 benchmark (2026-09-30). Now dev data only.
export const SCENES_V1: BenchmarkScene[] = [
  {
    scene_id: "tavern-first-meeting",
    label: "Stranger approaches in a tavern",
    scene_text:
      "Late evening at the Crooked Lantern, a salt-coast tavern. Adira sits in a corner booth with her lap-harp beside her, untouched. The lamp light is low. A traveler she's never met before walks over with a half-drunk mug, smiling like they've decided this is fine.",
    user_message:
      "Mind if I join you? You look interesting. What's your story?",
  },
  {
    scene_id: "friend-bringing-news",
    label: "Old friend sits down with hard news",
    scene_text:
      "Morning. Adira is restringing the harp on the steps of a coastal inn. Ren — a friend she's traveled with for years, someone she trusts — sits down beside her without speaking for a moment. The expression on Ren's face says something has happened. The light is gray.",
    user_message:
      "Adira — I have to tell you something. Brennan died two weeks ago. I didn't know how to get word to you.",
  },
  {
    scene_id: "stranger-offers-help",
    label: "Stranger offers unprompted help",
    scene_text:
      "Midday market square. Adira is counting coins for bread, comes up short by two coppers. A well-dressed stranger she's never seen before steps in and offers to pay the difference, then keeps standing there, smiling, expecting some kind of follow-up.",
    user_message:
      "Here, let me cover it. No, no — really. Tell me about yourself. Where are you from?",
  },
  {
    scene_id: "direct-emotional-question",
    label: "Trusted person asks what she's actually feeling",
    scene_text:
      "Late at night. Adira and Ren are walking back from a small gig. Adira played, but quietly, off her usual rhythm. Ren has known her long enough to ask directly instead of dancing around it.",
    user_message:
      "Stop. Tell me. What are you actually feeling right now? Don't deflect.",
  },
  {
    scene_id: "limit-test",
    label: "Manipulative push past her guard",
    scene_text:
      "A stranger who has been buying her drinks for the last hour — friendly enough at first, now clearly working an angle — leans across the table. They want her to come back to their room. They frame it as if she owes them something.",
    user_message:
      "Come on. I've been generous all night. Don't make me feel like I wasted my time on you. Just come back with me — it's only fair.",
    // The ONLY scene here that genuinely tests a limit. refusal_pattern is
    // scored here and nowhere else — the earlier scorer awarded a free 1.0
    // on the other four, which made it a near-constant that depressed
    // cross-provider variance.
    tests_limit: true,
  },
];
