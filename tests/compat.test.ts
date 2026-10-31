// What each model refuses, learned from the real error messages the major APIs document.
// Run: npx tsx tests/compat.test.ts

import { compatKey, describeCompat, emptyCompat, forgetCompat, getCompat, learnFromRejection, paramsMentioned, saveCompat, sendAdaptive, sentKeys } from "../src/lib/providers/compat";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}
const SENT = ["model", "messages", "max_tokens", "temperature", "top_p", "stream"];

console.log("--- recognising the refused parameter from real messages ---");
let c = emptyCompat();
let l = learnFromRejection(c, "anthropic", 400, "`temperature` is deprecated for this model.", ["model", "messages", "max_tokens", "temperature"]);
check(l.changed && c.drop.join() === "temperature", "Claude: \"`temperature` is deprecated for this model\" -> leave out temperature");
c = emptyCompat();
l = learnFromRejection(c, "anthropic", 400, "`temperature` and `top_p` cannot both be specified for this model. Please use only one.", ["temperature", "top_p"]);
check(c.drop.sort().join() === "temperature,top_p", "Claude: temperature + top_p together -> both named, both left out (one is re-added by the provider)");
c = emptyCompat();
l = learnFromRejection(c, "openai", 400, "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", SENT);
check(c.tokenParam === "max_completion_tokens" && !c.drop.includes("max_tokens"), "OpenAI reasoning models: max_tokens -> max_completion_tokens (max_tokens is never just dropped)");
c = emptyCompat();
l = learnFromRejection(c, "openai", 400, "Unsupported value: 'temperature' does not support 0.9 with this model. Only the default (1) value is supported.", SENT);
check(c.drop.join() === "temperature", "OpenAI: \"temperature does not support 0.9 ... only the default (1)\" -> leave out temperature");
c = emptyCompat();
l = learnFromRejection(c, "openai", 400, "Unsupported parameter: 'top_p' is not supported with this model.", SENT);
check(c.drop.join() === "top_p", "OpenAI: top_p refused -> leave out top_p, keep temperature");
c = emptyCompat();
l = learnFromRejection(c, "gemini", 400, 'Invalid JSON payload received. Unknown name "topK" at \'generation_config\': Cannot find field.', sentKeys({ model: "m", generationConfig: { temperature: 1, topK: 40, topP: 0.9, maxOutputTokens: 100 } }));
check(c.drop.join() === "top_k", "Gemini: Unknown name \"topK\" -> leave out top_k (its camelCase spelling is understood)");
c = emptyCompat();
l = learnFromRejection(c, "openai", 400, "Expected last role User or Tool (or Assistant with prefix True) for serving but got assistant", SENT);
check(c.strictRoles === true, "Mistral-style: \"Expected last role User…\" -> strict message ordering");
c = emptyCompat();
l = learnFromRejection(c, "openai", 400, "Unexpected role 'system' after role 'assistant'", SENT);
check(c.strictRoles === true, "Mistral-style: a system message mid-history -> strict message ordering");

console.log("--- what is NOT learned ---");
c = emptyCompat();
check(!learnFromRejection(c, "openai", 429, "Rate limit: temperature", SENT).changed && !learnFromRejection(c, "openai", 500, "unsupported temperature", SENT).changed, "only a 400/422 refusal teaches anything (not rate limits or server errors)");
check(!learnFromRejection(c, "openai", 400, "Incorrect API key provided", SENT).changed, "an unrelated 400 (bad key) changes nothing");
check(!learnFromRejection(c, "openai", 400, "Invalid 'model': model not found", SENT).changed, "a wrong model name changes nothing");
check(!learnFromRejection(c, "openai", 400, "The temperature parameter is great", SENT).changed, "merely mentioning a parameter without refusing it changes nothing");
check(paramsMentioned("unsupported: temperature", ["max_tokens"]).length === 0, "a parameter we did not send is never 'dropped'");
check(!learnFromRejection(emptyCompat(), "openai", 400, "Unsupported parameter: 'messages' is invalid", SENT).changed, "required fields (model, messages) are never dropped");

console.log("--- describing it ---");
c = { drop: ["temperature", "top_p"], tokenParam: "max_completion_tokens", strictRoles: true };
check(describeCompat(c).join(" | ") === "leaves out temperature, top_p | sends max_completion_tokens instead of max_tokens | uses strict message ordering", "Settings can say, in words, what was adapted");

console.log("--- remembering ---");
forgetCompat();
const key = compatKey("anthropic", "https://api.anthropic.com/", "claude-x");
check(key === compatKey("anthropic", "HTTPS://api.anthropic.com", "claude-x"), "the key ignores case and a trailing slash");
check(key !== compatKey("anthropic", "https://api.anthropic.com", "claude-y"), "a different model has its own rules");
saveCompat(key, { drop: ["temperature"] });
check(getCompat(key).drop.join() === "temperature" && getCompat(compatKey("anthropic", "https://api.anthropic.com", "claude-y")).drop.length === 0, "what is learned for one model is not applied to another");
forgetCompat(key);
check(getCompat(key).drop.length === 0, "forgetting one model resets just that model");

console.log("--- sentKeys ---");
check(sentKeys({ model: "m", generationConfig: { topP: 0.9, temperature: 1 }, options: { num_predict: 5 } }).includes("top_p"), "Gemini's nested topP is seen as top_p");

console.log("--- the retry loop ---");
forgetCompat();
let calls = 0;
const posted: Array<Record<string, unknown>> = [];
const post = async (body: Record<string, unknown>) => {
  calls++;
  posted.push(body);
  if ("temperature" in body) return new Response(JSON.stringify({ error: { message: "`temperature` is deprecated for this model." } }), { status: 400 });
  if ("top_p" in body) return new Response("Unsupported parameter: 'top_p' is not supported with this model.", { status: 400 });
  return new Response("{}", { status: 200 });
};
const build = (cc: ReturnType<typeof emptyCompat>) => ({ model: "m", max_tokens: 5, ...(cc.drop.includes("temperature") ? {} : { temperature: 0.9 }), ...(cc.drop.includes("top_p") ? {} : { top_p: 0.9 }) });
const r1 = await sendAdaptive({ key: "k1", kind: "openai", build, post });
check(r1.res.status === 200 && calls === 3 && r1.learned.length === 2, "two different refusals in a row are both worked out (3 calls), then it succeeds");
calls = 0;
const r2 = await sendAdaptive({ key: "k1", kind: "openai", build, post });
check(r2.res.status === 200 && calls === 1 && r2.learned.length === 0, "the next call is right the first time — it remembered");
calls = 0;
const alwaysBad = async () => { calls++; return new Response("Incorrect API key provided", { status: 400 }); };
const r3 = await sendAdaptive({ key: "k2", kind: "openai", build, post: alwaysBad });
check(r3.res.status === 400 && calls === 1 && (await r3.res.text()) === "Incorrect API key provided", "an unrelated 400 is not retried, and its text is preserved for the error message");
calls = 0;
const stubborn = async () => { calls++; return new Response("Unsupported parameter: 'temperature'", { status: 400 }); };
const r4 = await sendAdaptive({ key: "k3", kind: "openai", build: () => ({ temperature: 1, model: "m" }), post: stubborn, maxAttempts: 3 });
check(calls <= 2 && r4.res.status === 400, "a request that keeps failing for a parameter it can no longer drop stops, rather than looping");

console.log("\n--- PASS: compat ---");
process.exit(0);
