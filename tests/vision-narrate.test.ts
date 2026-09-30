// How a shared image reads in the story, and what must NOT see it.
// Run: npx tsx tests/vision-narrate.test.ts

import { imageDirection, narrateUserTurn } from "../src/lib/vision/narrate";
import { fitWithin } from "../src/lib/vision/prepare";
import { composeContext, renderContext } from "../src/lib/orchestrator/compose";
import { Orchestrator } from "../src/lib/orchestrator";
import { YantrikClient } from "../src/lib/yantrikdb/client";
import { InMemoryTransport } from "../src/lib/yantrikdb/memory-transport";
import { MockProvider } from "../src/lib/providers/mock";
import type { ChatTurn, Character, TurnAttachment } from "../src/lib/orchestrator/types";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

const att = (description: string): TurnAttachment => ({ id: "h1", kind: "image", mime: "image/jpeg", width: 10, height: 10, description });
function turn(content: string, attachments?: TurnAttachment[], role: ChatTurn["role"] = "user"): ChatTurn {
  return { id: content.slice(0, 8) + Math.random(), role, speaker: role, content, created_at: "", session_id: "s", attachments };
}

async function main(): Promise<void> {
  console.log("--- the stage direction ---");
  check(imageDirection({}) === "" && imageDirection({ attachments: [] }) === "", "no attachment → nothing");
  check(imageDirection({ attachments: [att("A brass key on a table.")] }) === "*[An image is shown: A brass key on a table.]*", "reads as a stage direction, not as speech");
  check(!imageDirection({ attachments: [att("A sign: \"x]\" here")] }).slice(0, -2).includes("]"), "a stray ] in a description can't break out of the direction");
  check(imageDirection({ attachments: [att("One."), att("Two.")] }).split("\n").length === 2, "several images, one direction each");
  check(narrateUserTurn({ content: "What is this?", attachments: [att("A key.")] }) === "*[An image is shown: A key.]*\nWhat is this?", "the direction comes first, then what was said");
  check(narrateUserTurn({ content: "", attachments: [att("A key.")] }) === "*[An image is shown: A key.]*", "an image with no words is just the direction");
  check(narrateUserTurn({ content: "((push the plot))", attachments: [att("A key.")] }) === "*[An image is shown: A key.]*", "a directive-only turn with an image isn't padded with filler");
  check(narrateUserTurn({ content: "Hello ((secret))" }) === "Hello", "without an image nothing changes (OOC still stripped)");

  console.log("--- image sizing ---");
  check(JSON.stringify(fitWithin(4000, 2000)) === '{"width":1024,"height":512}', "large images fit within 1024 on the long edge");
  check(JSON.stringify(fitWithin(300, 200)) === '{"width":300,"height":200}', "small images are never upscaled");
  check(fitWithin(5000, 1).height === 1, "extreme aspect ratios keep at least one pixel");

  console.log("--- prompt integration ---");
  const ctx = composeContext(
    { canon: [], scene: [], heuristic: [], graph: [], temporal_triggers: [], pending_conflicts: 0, surfaced_skills: [], latency_ms: 0 },
    [turn("hi", undefined, "assistant"), turn("Look at this.", [att("A lighthouse at dusk.")])]
  );
  const { history } = renderContext(ctx, "You are Ren.");
  check(history[1].content.startsWith("*[An image is shown: A lighthouse at dusk.]*") && history[1].content.endsWith("Look at this."), "earlier turns' images stay in the history the model reads");

  console.log("--- what must NOT see the description ---");
  const client = new YantrikClient(new InMemoryTransport());
  const ren: Character = { id: "ren", name: "Ren", world_id: "w", description: "A bookseller." };
  const seen: string[] = [];
  const provider = new MockProvider({ scripted: ["Ren studies it."] });
  const realChat = provider.chat.bind(provider);
  provider.chat = async (req) => ((seen.push(req.system + "\n" + req.messages.map((m) => m.content).join("\n")), realChat(req)));
  const orch = new Orchestrator({ client, provider, model: "m", getRecentTurns: async () => [] });
  const user = turn("Remember that I like green tea.", [att("A woman in her thirties, possibly the character's mother.")]);
  const { writes_promise } = await orch.turn({ session_id: "s1", user_id: "user", speaker: "user", user_message: user, character: ren }, "You are Ren.");
  await writes_promise;
  const stored = JSON.stringify(await client.listMemoriesInNamespace("character:ren", 100)).toLowerCase();
  check(seen[0].includes("An image is shown: A woman in her thirties"), "the story model is given the description");
  check(stored.includes("green tea"), "what the player typed is still remembered");
  check(!stored.includes("mother") && !stored.includes("thirties"), "a vision model's guess is never written to memory");

  console.log("\n--- PASS: vision-narrate ---");
}

main().then(() => process.exit(0));
