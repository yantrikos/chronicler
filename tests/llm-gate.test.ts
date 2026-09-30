// Chat goes first: background calls wait for it, are cancelled if it starts, and are retried after.
// Run: npx tsx tests/llm-gate.test.ts

import { GATE_ABORT, LlmGate, backendKey, gateBackground, gateChat, shouldGate } from "../src/lib/providers/gate";
import type { ProviderConfigEntry } from "../src/lib/config";
import type { ChatRequest, ChatResponse, LlmProvider } from "../src/lib/providers";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const REQ: ChatRequest = { model: "m", system: "s", messages: [{ role: "user", content: "hi" }] };

/** A provider whose chat() takes `ms`, honours the abort signal like fetch does, and records each attempt. */
class Slow implements LlmProvider {
  name = "slow";
  attempts: Array<{ startedAt: number; aborted: boolean; reason?: unknown }> = [];
  constructor(private ms: number, private reply = "ok") {}
  chat(req: ChatRequest): Promise<ChatResponse> {
    const rec = { startedAt: Date.now(), aborted: false as boolean, reason: undefined as unknown };
    this.attempts.push(rec);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve({ content: this.reply }), this.ms);
      req.signal?.addEventListener("abort", () => {
        clearTimeout(t);
        rec.aborted = true;
        rec.reason = req.signal!.reason;
        reject(req.signal!.reason);
      });
    });
  }
  async *stream(_req: ChatRequest): AsyncIterable<string> {
    yield "a";
    await sleep(this.ms);
    yield "b";
  }
}

async function main(): Promise<void> {
  console.log("--- idle: nothing changes ---");
  const g0 = new LlmGate(30);
  const t0 = Date.now();
  const r0 = await gateBackground(new Slow(10), g0).chat(REQ);
  check(r0.content === "ok" && Date.now() - t0 < 100, "with no chat going on, a background call runs immediately and returns its result");

  console.log("--- a background call WAITS while chat is in flight ---");
  const g1 = new LlmGate(40);
  const bgProv = new Slow(10);
  g1.chatStart();
  const p1 = gateBackground(bgProv, g1).chat(REQ);
  await sleep(120);
  check(bgProv.attempts.length === 0, "it has not even started while chat is active");
  g1.chatEnd();
  await sleep(20);
  check(bgProv.attempts.length === 0, "and still waits through the short quiet moment after chat ends");
  const r1 = await p1;
  check(r1.content === "ok" && bgProv.attempts.length === 1, "then it runs once, and returns its result");

  console.log("--- a RUNNING background call is cancelled when chat starts, then retried ---");
  const g2 = new LlmGate(40);
  const slowBg = new Slow(200);
  const p2 = gateBackground(slowBg, g2).chat(REQ);
  await sleep(50);
  check(slowBg.attempts.length === 1 && !slowBg.attempts[0].aborted, "the background call is in flight");
  const tChat = Date.now();
  g2.chatStart();
  await sleep(10);
  check(slowBg.attempts[0].aborted && slowBg.attempts[0].reason === GATE_ABORT, "chat starting cancels it immediately, with the yield-to-chat reason");
  await sleep(150);
  check(slowBg.attempts.length === 1, "it stays parked while chat is still going");
  g2.chatEnd();
  const r2 = await p2;
  check(r2.content === "ok" && slowBg.attempts.length === 2 && slowBg.attempts[1].startedAt - tChat >= 190, "after chat it is retried from the start, and the caller simply gets its answer (only later)");

  console.log("--- it gives up after repeated cancellations ---");
  const g3 = new LlmGate(10, 2);
  const slow3 = new Slow(500);
  const p3 = gateBackground(slow3, g3).chat(REQ).then(() => "resolved", (e) => `rejected:${String(e)}`);
  for (let i = 0; i < 4; i++) {
    await sleep(40);
    g3.chatStart();
    await sleep(10);
    g3.chatEnd();
  }
  const out3 = await p3;
  check(out3 === `rejected:${GATE_ABORT}` && slow3.attempts.length === 3, "after 2 retries (3 attempts) it stops, so a rapid typist cannot cause endless repeated work");

  console.log("--- the caller's own abort is respected ---");
  const g4 = new LlmGate(20);
  g4.chatStart();
  const ctl = new AbortController();
  const p4 = gateBackground(new Slow(10), g4).chat({ ...REQ, signal: ctl.signal }).then(() => "resolved", () => "rejected");
  await sleep(30);
  ctl.abort();
  check((await p4) === "rejected", "aborting while it waits for chat rejects it (no hang)");
  const slow5 = new Slow(300);
  const g5 = new LlmGate(20);
  const ctl5 = new AbortController();
  const p5 = gateBackground(slow5, g5).chat({ ...REQ, signal: ctl5.signal }).then(() => "resolved", () => "rejected");
  await sleep(50);
  ctl5.abort(new Error("user"));
  check((await p5) === "rejected" && slow5.attempts.length === 1, "aborting while it runs rejects it and is NOT retried");

  console.log("--- gateChat marks chat busy for the life of the request ---");
  const g6 = new LlmGate(20);
  const chatProv = gateChat(new Slow(80), g6);
  const pc = chatProv.chat(REQ);
  await sleep(10);
  check(g6.busy, "busy while a chat() is in flight");
  await pc;
  check(g6.busy, "and through the quiet moment after it");
  await sleep(50);
  check(!g6.busy, "then idle");
  const it = chatProv.stream!(REQ)[Symbol.asyncIterator]();
  await it.next();
  check(g6.busy, "busy while a reply is streaming");
  await it.return?.();
  await sleep(50);
  check(!g6.busy, "released when the consumer stops early (Stop pressed)");
  const failing: LlmProvider = { name: "f", chat: async () => { throw new Error("boom"); } };
  await gateChat(failing, g6).chat(REQ).catch(() => undefined);
  await sleep(50);
  check(!g6.busy, "released when the request fails");

  console.log("--- shouldGate / backendKey ---");
  const P = (over: Partial<ProviderConfigEntry>): ProviderConfigEntry => ({ id: "a", kind: "ollama", label: "x", api_key: "", model: "m", base_url: "http://host.docker.internal:11434", ...over });
  const local = () => true;
  check(backendKey(P({ base_url: "http://H:11434/v1/" })) === backendKey(P({ base_url: "http://h:11434" })), "backendKey ignores case, /v1 and trailing slashes");
  check(shouldGate(P({}), P({ id: "b", model: "other" }), local), "same local server, different model: they queue on it, so gate");
  check(!shouldGate(P({}), P({ id: "b", base_url: "http://host.docker.internal:8000/v1", kind: "openai-compat" }), local), "a different local server: nothing to queue behind, no gate");
  check(!shouldGate(P({ base_url: "https://api.openai.com/v1", kind: "openai-compat" }), P({ base_url: "https://api.openai.com/v1", kind: "openai-compat" }), () => false), "hosted APIs: no gate");
  check(!shouldGate(P({ kind: "mock" }), P({}), local) && !shouldGate(undefined, P({}), local), "mock or missing providers: no gate");

  console.log("\n--- PASS: llm-gate ---");
}
main().then(() => process.exit(0));
