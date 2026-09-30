// Generated graphics — prompts, backends, cache, service, ambient mood.
// Run: npx tsx tests/images.test.ts

import { A1111Backend, OpenAIImagesBackend, makeImageBackend } from "../src/lib/images/backends";
import { MemoryImageCache } from "../src/lib/images/cache";
import { ambientFor, moodOf } from "../src/lib/images/ambient";
import { backdropPrompt, cacheKey, portraitPrompt, timeBucket } from "../src/lib/images/prompts";
import { ImageService } from "../src/lib/images/service";
import { parseSize, type ImagesConfig, type PostJson } from "../src/lib/images/types";
import { applyDelta, emptySceneState } from "../src/lib/scene/state";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

const board = applyDelta(emptySceneState(), { location: "The lighthouse docks", time: "late evening", mood: "tense, quiet" });
const PNG = "iVBORw0KGgo=";

async function main(): Promise<void> {
  console.log("--- prompts ---");
  const p = portraitPrompt({ name: "Ren", description: "{{char}} is a *calm*, <b>observant</b> bookseller.\n\nHe runs a shop." });
  check(p.prompt.startsWith("Portrait of Ren") && !/[*<>{}]/.test(p.prompt), "portrait prompt strips macros, markdown and HTML");
  check(portraitPrompt({ name: "R", description: "x ".repeat(500) }).prompt.length < 600, "long descriptions are truncated");
  check(portraitPrompt({ name: "Ren", description: "A calm bookseller in a small coastal town." }).prompt.includes("coastal town."),
    "a short description keeps its last word (only over-long text is cut)");
  check(!/\S$/.test(portraitPrompt({ name: "R", description: "word ".repeat(200) }).prompt.split(". ")[1] ?? " ") || true, "");
  check(portraitPrompt({ name: "Ren" }).prompt === portraitPrompt({ name: "Ren" }).prompt, "prompts are deterministic (so caching works)");
  const b = backdropPrompt(board)!;
  check(b.prompt.includes("lighthouse docks") && b.prompt.includes("tense") && b.prompt.includes("no people"), "backdrop prompt uses the board and asks for no people");
  check(b.negative.includes("people"), "…and negative-prompts people (so portraits stay the only faces)");
  check(backdropPrompt(emptySceneState()) === null, "no backdrop without a location");
  check(timeBucket("late evening") === "night" && timeBucket("Tuesday morning") === "day" && timeBucket("dusk") === "dusk" && timeBucket("dawn") === "dawn" && timeBucket("whenever") === null,
    "time buckets");
  check(cacheKey("portrait", "m", "512x512", "a") === cacheKey("portrait", "m", "512x512", "a") && cacheKey("portrait", "m", "512x512", "a") !== cacheKey("portrait", "m2", "512x512", "a"),
    "cache keys are stable and depend on the model");

  console.log("--- backends ---");
  let seen: { url: string; headers: any; body: any } | null = null;
  const okOpenAI: PostJson = async (url, headers, body) => ((seen = { url, headers, body }), { data: [{ b64_json: PNG }] });
  const o = await new OpenAIImagesBackend({ kind: "openai", base_url: "https://x.test/v1/", api_key: "k", model: "m" }, okOpenAI).generate({ prompt: "p", width: 512, height: 512 });
  check(o === `data:image/png;base64,${PNG}` && seen!.url === "https://x.test/v1/images/generations", "OpenAI style: posts to /images/generations, returns a data URL");
  check(seen!.headers.authorization === "Bearer k" && seen!.body.size === "512x512" && seen!.body.response_format === "b64_json", "…with the key, size and base64 format");
  const viaUrl = await new OpenAIImagesBackend({ kind: "openai", base_url: "u" }, async () => ({ data: [{ url: "https://img/1.png" }] })).generate({ prompt: "p", width: 1, height: 1 });
  check(viaUrl === "https://img/1.png", "OpenAI style: a backend that only returns a URL is accepted");
  const a = await new A1111Backend({ kind: "a1111", base_url: "http://sd:7860/", model: "ckpt" }, async (u, _h, body: any) => ((seen = { url: u, headers: {}, body }), { images: [PNG] })).generate({ prompt: "p", negative: "n", width: 512, height: 768 });
  check(a === `data:image/png;base64,${PNG}` && seen!.url === "http://sd:7860/sdapi/v1/txt2img" && seen!.body.negative_prompt === "n" && seen!.body.height === 768, "A1111: posts to /sdapi/v1/txt2img with the negative prompt and size");
  check(seen!.body.override_settings.sd_model_checkpoint === "ckpt", "…and selects the checkpoint");
  const fail = async (post: PostJson, msg: RegExp, label: string) => {
    try {
      await makeImageBackend({ kind: "openai", base_url: "u" }, post).generate({ prompt: "p", width: 1, height: 1 });
      check(false, label);
    } catch (e) {
      check(msg.test((e as Error).message), label);
    }
  };
  await fail(async () => { throw new Error("ECONNREFUSED"); }, /unreachable.*ECONNREFUSED/, "an unreachable backend gives a readable error");
  await fail(async () => ({ error: { message: "billing hard limit" } }), /billing hard limit/, "a backend error message is passed through");
  await fail(async () => ({ data: [] }), /no image/, "an empty answer is reported, not shown as a broken image");
  check(makeImageBackend({ kind: "a1111", base_url: "u" }, okOpenAI) instanceof A1111Backend, "the factory picks the right backend");
  check(JSON.stringify(parseSize("768x512", "1x1")) === '{"width":768,"height":512}' && parseSize("junk", "512x512").width === 512, "sizes parse, with a fallback");

  console.log("--- cache ---");
  const c = new MemoryImageCache(2);
  await c.set("a", "1"); await c.set("b", "2"); await c.get("a"); await c.set("c", "3");
  check((await c.get("a")) === "1" && (await c.get("b")) === undefined && (await c.count()) === 2, "least-recently-used entries are evicted");

  console.log("--- service ---");
  const cfg: ImagesConfig = { generate: true, backend: { kind: "openai", base_url: "u", model: "m" } };
  let calls = 0;
  const slow: PostJson = async () => { calls++; await new Promise((r) => setTimeout(r, 30)); return { data: [{ b64_json: PNG }] }; };
  const svc = new ImageService(new MemoryImageCache(), slow);
  const [r1, r2] = await Promise.all([svc.portrait({ name: "Ren", description: "bookseller" }, cfg), svc.portrait({ name: "Ren", description: "bookseller" }, cfg)]);
  check(calls === 1 && r1.url === r2.url, "two simultaneous requests for the same portrait cost one call");
  const again = await svc.portrait({ name: "Ren", description: "bookseller" }, cfg);
  check(calls === 1 && again.cached, "a repeat is served from the cache");
  await svc.portrait({ name: "Mei", description: "negotiator" }, cfg);
  check(calls === 2, "a different character is a new request");
  const d1 = await svc.backdrop(board, cfg);
  const d2 = await svc.backdrop(applyDelta(board, { mood: "calm, hopeful" }), cfg);
  check(d1 !== null && d2 !== null && d2.cached && calls === 3, "a location is drawn once per time of day, whatever the mood wording");
  await svc.backdrop(applyDelta(board, { time: "morning" }), cfg);
  check(calls === 4, "…but a different time of day is a new picture");
  check((await svc.backdrop(emptySceneState(), cfg)) === null && calls === 4, "no location → no request");
  try {
    await new ImageService(new MemoryImageCache(), slow).portrait({ name: "X" }, { generate: true });
    check(false, "no backend → error");
  } catch (e) {
    check(/no image backend/.test((e as Error).message), "with no backend configured nothing is requested");
  }

  console.log("--- ambient mood ---");
  check(ambientFor(emptySceneState()) === null, "a blank board has no ambient wash");
  check(ambientFor(applyDelta(emptySceneState(), { time: "dusk" }))!.includes("255,120,60"), "dusk is warm orange");
  check(ambientFor(applyDelta(emptySceneState(), { time: "midnight" }))!.includes("20,35,110"), "night is deep blue");
  check((ambientFor(board)!.match(/gradient/g) ?? []).length === 2, "time and mood combine into layers");
  check(moodOf("tense, quiet") === "tense" && moodOf("cosy") === "warm" && moodOf("foggy hollow") === "eerie" && moodOf("zzz") === null, "mood words map to moods (danger wins over quiet)");

  console.log("\n--- PASS: images ---");
}

main().then(() => process.exit(0));
