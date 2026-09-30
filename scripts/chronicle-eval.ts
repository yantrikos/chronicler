// Does the chronicle let a long roleplay remember its own past?
//
// A scripted 38-message story with six planted facts (a promise, a name, a
// hidden key, why the ferry stopped, an injured ankle, a lent compass). The
// chronicle is built with the real code path, then a reader model answers six
// questions about those facts as the character — first with only the last
// messages (today's behaviour), then with the chronicle in the prompt.
// Also measured: which planted facts the chapters kept, and how many proper
// nouns the summariser INVENTED (capitalised words that appear nowhere in the
// story).
//
// Run:  npx tsx scripts/chronicle-eval.ts
//       WRITERS=qwen3.5:4b,qwen3.6:35b READERS=qwen3.5:4b,qwen3.5:9b npx tsx scripts/chronicle-eval.ts

import { composeContext, renderContext } from "../src/lib/orchestrator/compose";
import type { ChatRequest, ChatResponse, LlmProvider } from "../src/lib/providers";
import type { ChatTurn } from "../src/lib/orchestrator/types";
import {
  emptyChronicle, historyStart, renderChronicle, resolveCovered, totalChars, type Chronicle,
} from "../src/lib/story/chronicle";
import { ChapterWriter, stepChronicle } from "../src/lib/story/chronicler";

const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
const WRITERS = (process.env.WRITERS ?? "qwen3.5:4b,qwen3.5:9b,qwen3.6:35b").split(",");
const READERS = (process.env.READERS ?? "qwen3.5:4b,qwen3.5:9b").split(",");

class Ollama implements LlmProvider {
  name = "eval"; calls = 0; ms = 0;
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const t0 = performance.now();
    const res = await fetch(`${OLLAMA}/api/chat`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: req.model, stream: false, think: false, messages: [{ role: "system", content: req.system }, ...req.messages],
        options: { temperature: req.temperature ?? 0.2, num_predict: req.max_tokens ?? 300 } }) });
    this.calls++; this.ms += performance.now() - t0;
    return { content: ((await res.json()) as any).message?.content ?? "" };
  }
}

const LINES: string[] = [
  "*I push open the door of The Salt Page and shake the rain off my coat.* Evening, Ren.",
  "*Ren looks up from the ledger.* Sam. Late for browsing. Tea?",
  "Please. Ren, I need to borrow your brass lantern — the one from the shelf.",
  "*He hesitates, then lifts it down.* The lighthouse lantern. Take it, but it belongs at the lighthouse.",
  "I promise I'll return the lantern to the lighthouse before dawn. You have my word.",
  "*Ren nods slowly.* Then I'll hold you to it, Sam. Before dawn.",
  "Who kept the lighthouse before it went dark?",
  "*He sets down his cup.* A man named Aldous Finch. He vanished three winters ago.",
  "Aldous Finch. Did he leave anything behind?",
  "*Ren shrugs.* Nothing anyone ever found. He was a private man.",
  "*I lean on the counter and it creaks. One board is loose beneath my foot.*",
  "*Ren's eyes narrow.* That board's been loose for years. Pry it up, if you like.",
  "*I pry it up. Underneath lies a small brass key wrapped in oilcloth.* Ren! A key!",
  "*Ren stares.* Hidden under the floorboard behind my own counter. Finch must have put it there.",
  "We should ask Odalys at the harbor. She knows everyone.",
  "Odalys is the harbormaster. She'll be at the pier at this hour.",
  "*We walk out into the rain toward the harbor and find Odalys mending a net.*",
  "*Odalys looks up.* Sam, Ren. If you're after the ferry to Port Llyr — it stopped running after the storm last week.",
  "Stopped entirely? How do we get to Port Llyr, then?",
  "*Odalys shakes her head.* Not by ferry. The landing was washed out. Walk the coast road or wait.",
  "We'll walk. *I climb up onto the seawall to look down the coast road.*",
  "Careful, the stones are slick —",
  "*My foot slips on the wet stone and I wrench my left ankle badly.* Ah! My left ankle!",
  "*Ren rushes over.* Sit. That's twisted, not broken. You'll not walk far on it tonight.",
  "Then I suppose the coast road will have to wait. *I wince.*",
  "*Ren considers.* Take my grandfather's compass, for when you do go. It always points true.",
  "You'd lend me your grandfather's compass?",
  "I would. Bring it back with the lantern, and we'll call it even.",
  "Thank you. *I turn the compass over in my hands.* It's heavy.",
  "*Ren smiles.* Brass, and older than this shop. Now, are you hungry?",
  "Starving. What is there?",
  "Mrs. Hale's fish pie, and bread still warm from the oven.",
  "*I eat and watch the rain on the window.* This is good pie.",
  "The best on the coast, and she won't hear otherwise. More tea?",
  "Yes please. Is the weather going to clear by morning, do you think?",
  "*Ren glances at the window.* The wind's turning. It should clear by dawn.",
  "Then I'll rest a while here by the stove.",
  "*He banks the fire.* Rest. I'll wake you in good time.",
];
// Two further blocks, for STORY=long: ~86 messages in all, so the oldest chapters
// have been merged into the coarser "earlier" paragraph by the time we ask.
const BLOCK_B: string[] = [
  "*I wake to grey light and the smell of tea.* Is it dawn already?",
  "*Ren sets a cup beside me.* Nearly. The storm's blown itself out. You slept well.",
  "*I flex my ankle and grimace.* Still sore. *A letter lies on the counter.* Is that for me?",
  "It came for you yesterday. From Port Llyr. The postmark says your sister, Mara.",
  "*I open it and read.* Mara writes that she's found work at the cannery and asks when I'll visit.",
  "Then all the more reason to walk the coast road when you can. *Ren rummages under the counter.*",
  "*He hands me a folded grey wool scarf.* For the wind on the road. It's cold out there.",
  "A grey wool scarf. Thank you, Ren. *I wrap it around my neck.*",
  "Odalys stopped by while you slept. She wanted you warned about a smuggler called Vance working the coast.",
  "Vance? What does he smuggle?",
  "*Ren lowers his voice.* Anything that pays. Odalys says he's already been seen near the old landing.",
  "Then I'll keep my eyes open. *I finish my tea.*",
  "You should eat before you set off. *Ren slices bread and cheese.*",
  "*I eat quickly, then stand and test my weight on the ankle.* Better. I think I can manage the road.",
  "Take it slowly. The compass is on the shelf by the door.",
  "*I take the compass, the lantern, and the scarf.* I'll be back before dark.",
  "*Ren walks me to the door.* Mind the lantern, Sam. It belongs to the lighthouse.",
  "I remember. *I step out into the cold morning.*",
  "*The coast road is muddy. Gulls wheel overhead as I limp along.*",
  "*A cart rattles up behind me and the driver slows.* Need a lift, friend?",
  "*He is a stout man with a red beard.* Name's Bram. I'm hauling barrels to the cannery.",
  "The cannery! My sister works there. I'd be grateful for the ride, Bram.",
  "*I climb up beside him.* Do you know a woman named Mara?",
  "Mara? Aye, the new girl on the packing line. Quick hands, that one.",
];
const BLOCK_C: string[] = [
  "*The cart bumps along the road toward Port Llyr.* How far is the town?",
  "Another hour, maybe two. The road's slow after the storm.",
  "*We pass the washed-out ferry landing, planks strewn across the mud.*",
  "Told you the storm did for that. Nothing crossing there for weeks.",
  "*In Port Llyr, Bram drops me at a crooked little market street.* Thank you, Bram!",
  "*The stalls are crowded. A tinker sells pots and pans from a cart.*",
  "*I stop at a copper kettle gleaming in the sun.* How much for the kettle?",
  "Seven silver coins, and a bargain at that.",
  "*I count out seven silver coins and take the kettle.* A gift for Ren.",
  "*I ask for directions to the lighthouse and a woman points up a steep lane.*",
  "That's the old keeper's lane. Widow Pell holds the second key to the lighthouse door, if you need it.",
  "Widow Pell. Where do I find her?",
  "The blue door with the cracked step, halfway up. She doesn't like visitors, mind.",
  "*I climb the lane and knock at the blue door.* Widow Pell? I'm a friend of Ren's.",
  "*A small woman peers out.* Ren's friend? Then you'd best come in.",
  "*Her kitchen smells of pine smoke.* I have something of Finch's. He left it with me before he vanished.",
  "*She presses a tarnished brass locket into my hand.* He said to give it to whoever came asking.",
  "*I open the locket. Inside is a tiny portrait of a girl and the words 'For Elin'.*",
  "Elin was his daughter. She left for the mainland years ago. He never spoke of her.",
  "*I close the locket carefully.* I'll take it to the lighthouse, and I'll keep it safe.",
  "*Widow Pell nods.* Then go. And take the second key — the door sticks.",
  "*She gives me an iron key. I thank her and step back into the lane.*",
  "*The lighthouse stands above the town, its lamp dark.* At last.",
  "*I fit the iron key to the door and it grinds open.*",
];
const LONG = process.env.STORY === "long";
const ALL_LINES = LONG ? [...LINES, ...BLOCK_B, ...BLOCK_C] : LINES;
const TURNS: ChatTurn[] = ALL_LINES.map((content, i) => ({
  id: `t${i}`, role: i % 2 === 0 ? "user" : "assistant", speaker: i % 2 === 0 ? "user" : "ren", content, created_at: "", session_id: "s",
}));
const NAMES = { userName: "Sam", characterName: "Ren" };

const QA: { q: string; fact: string; ok: RegExp }[] = [
  { q: "Ren, remind me — what exactly did I promise you about the lantern?", fact: "the promise", ok: /(dawn|return|back|lighthouse)/i },
  { q: "What was the name of the man who kept the lighthouse?", fact: "the keeper's name", ok: /(aldous|finch)/i },
  { q: "Where did we find that key, again?", fact: "the hidden key", ok: /(floor\s?board|under|beneath|counter)/i },
  { q: "Why can't we just take the ferry to Port Llyr?", fact: "why the ferry stopped", ok: /(storm|washed|stopped|landing)/i },
  { q: "Which part of me did I hurt on the seawall?", fact: "the injured ankle", ok: /ankle/i },
  { q: "What did you say I should take with me when I finally walk the coast road?", fact: "the compass", ok: /compass/i },
];
if (LONG) {
  QA.push(
    { q: "Remind me, what's my sister's name and where does she work?", fact: "sister Mara (block B)", ok: /mara/i },
    { q: "Who did Odalys warn us about on the coast?", fact: "the smuggler Vance (block B)", ok: /vance/i },
    { q: "What did I pay for the kettle, and what is it made of?", fact: "the copper kettle (block C)", ok: /(seven|7)/i },
    { q: "Who holds the second key to the lighthouse door?", fact: "Widow Pell (block C)", ok: /pell/i },
  );
}
/** Regexes for whether a chapter kept each planted fact. */
const KEPT: [string, RegExp, number][] = [
  ["the promise", /(promis|swore|vow|pledg)[^.]*(lantern|return|dawn)|(lantern)[^.]*(promis|dawn)|(return|bring)[^.]*(lantern)[^.]*(dawn|lighthouse)/i, 4],
  ["the keeper's name", /aldous finch|finch/i, 7],
  ["the hidden key", /key/i, 12],
  ["why the ferry stopped", /(ferry)[^.]*(storm|washed|stopped|halt)|(storm)[^.]*(ferry)|landing/i, 17],
  ["the injured ankle", /ankle/i, 22],
  ["the compass", /compass/i, 25],
];

async function buildChronicle(model: string): Promise<{ c: Chronicle; provider: Ollama; fallbacks: number }> {
  const provider = new Ollama();
  const writer = new ChapterWriter(provider, model);
  let c = emptyChronicle();
  // The same stall-proof step the app uses.
  for (let guard = 0; guard < 20; guard++) {
    const next = await stepChronicle(c, TURNS, writer, NAMES);
    if (!next) break;
    c = next;
  }
  return { c, provider, fallbacks: c.chapters.filter((ch) => ch.fallback).length };
}

const emptyRetrieval = { canon: [], scene: [], heuristic: [], graph: [], temporal_triggers: [], pending_conflicts: 0, surfaced_skills: [], latency_ms: 0 };

async function ask(reader: string, question: string, chronicle: string | undefined, covered: number): Promise<string> {
  const start = chronicle ? historyStart(TURNS.length, covered) : TURNS.length - 10;
  const recent = TURNS.slice(start);
  const ctx = composeContext(emptyRetrieval, recent, undefined, { storySoFar: chronicle });
  const { system, history } = renderContext(ctx, "You are Ren, a calm, observant bookseller. Reply in 1-3 sentences, in character, and answer the question directly.");
  const provider = new Ollama();
  const r = await provider.chat({ model: reader, system, messages: [...history, { role: "user", content: question }], max_tokens: 120, temperature: 0.3 });
  return r.content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

async function main(): Promise<void> {
  const storyWords = new Set(ALL_LINES.join(" ").toLowerCase().match(/[a-z']+/g));
  console.log(`Chronicle eval — ${TURNS.length}-message story, ${QA.length} questions${LONG ? " (oldest facts sit behind merged chapters)" : " about facts from turns 4–28"}\n`);

  // Baseline: today's behaviour (last 10 messages only).
  console.log("WITHOUT the chronicle (last 10 messages only — how the app works today)");
  for (const reader of READERS) {
    let hit = 0; const miss: string[] = [];
    for (const item of QA) { const a = await ask(reader, item.q, undefined, 0); if (item.ok.test(a)) hit++; else miss.push(item.fact); }
    console.log(`  reader ${reader.padEnd(13)} ${hit}/${QA.length} answered correctly   missed: ${miss.join(", ") || "—"}`);
  }

  for (const writerModel of WRITERS) {
    const { c, provider, fallbacks } = await buildChronicle(writerModel);
    const text = renderChronicle(c);
    const covered = resolveCovered(TURNS, c);
    // Only facts inside chaptered territory count; later ones ride in the raw history.
    const inScope = KEPT.filter(([, , at]) => at < covered);
    const kept = inScope.filter(([, re]) => re.test(text)).map(([n]) => n);
    const lost = inScope.filter(([, re]) => !re.test(text)).map(([n]) => n);
    const caps = (text.match(/(?<![.!?]\s)(?<!^)\b[A-Z][a-z]+\b/g) ?? []).filter((w) => !storyWords.has(w.toLowerCase()));
    console.log(`\nCHRONICLE written by ${writerModel}: ${c.chapters.length} chapters${fallbacks ? ` (${fallbacks} plain-extract fallbacks)` : ""}, ${totalChars(c)} chars, ${Math.round(provider.ms / Math.max(1, provider.calls) / 100) / 10}s/chapter`);
    console.log(`  facts kept ${kept.length}/${inScope.length} (of those covered by chapters; the rest are in the raw history)${lost.length ? `   LOST: ${lost.join(", ")}` : ""}   invented proper nouns: ${caps.length ? caps.join(", ") : "none"}`);
    console.log(`  earlier paragraph: ${c.earlier ? `${c.earlier.length} chars — "${c.earlier.slice(0, 200)}…"` : "(none — no merge was needed)"}   stored ${totalChars(c)} chars, in the prompt ${text.length}`);
    console.log(`  text: "${text.slice(0, 520)}${text.length > 520 ? "…" : ""}"`);
    for (const reader of READERS) {
      let hit = 0; const miss: string[] = [];
      for (const item of QA) { const a = await ask(reader, item.q, text, covered); if (item.ok.test(a)) hit++; else miss.push(item.fact); }
      console.log(`  reader ${reader.padEnd(13)} ${hit}/${QA.length} answered correctly   missed: ${miss.join(", ") || "—"}`);
    }
  }
}
main();
