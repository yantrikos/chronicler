// Thinking control per backend + the message for a reply with no text.
// Run: npx tsx tests/thinking.test.ts

import { emptyReplyMessage, guessThinkingStyle, ollamaThinkOff, openAiThinkingFields } from "../src/lib/providers/thinking";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

console.log("--- ollamaThinkOff ---");
check(ollamaThinkOff("qwen3.5:4b") === false && ollamaThinkOff("qwen3.8:latest") === false && ollamaThinkOff("qwen2.5:7b") === false, "Qwen and other models get think:false");
check(ollamaThinkOff("gpt-oss:20b") === "low" && ollamaThinkOff("GPT-OSS:120b") === "low", "gpt-oss cannot be turned off (it ignores false), so it gets its lowest level");

console.log("--- openAiThinkingFields ---");
check(JSON.stringify(openAiThinkingFields("reasoning_effort")) === '{"reasoning_effort":"none"}', "Ollama /v1 style sends reasoning_effort:none");
check(JSON.stringify(openAiThinkingFields("template_kwargs")) === '{"chat_template_kwargs":{"enable_thinking":false}}', "vLLM / llama.cpp style sends chat_template_kwargs.enable_thinking=false");
check(Object.keys(openAiThinkingFields("none")).length === 0 && Object.keys(openAiThinkingFields(undefined)).length === 0, "no style sends nothing (real OpenAI rejects unknown fields)");

console.log("--- guessThinkingStyle ---");
check(guessThinkingStyle("http://host.docker.internal:11434/v1") === "reasoning_effort" && guessThinkingStyle("http://localhost:11434") === "reasoning_effort", "port 11434 is Ollama");
check(guessThinkingStyle("https://api.openai.com/v1") === "none" && guessThinkingStyle("http://localhost:8000/v1") === "none", "anything else: unsure, so nothing is sent");

console.log("--- emptyReplyMessage ---");
const a = emptyReplyMessage("Ollama (local)", { thinkingChars: 4000, finishReason: "length", completed: true, maxTokens: 1024 });
check(a.includes("spent its whole reply budget (1024 tokens) thinking") && a.includes("Turn thinking off"), "all tokens spent thinking: says so and what to do");
check(emptyReplyMessage("X", { thinkingChars: 500, finishReason: "stop", completed: true }).includes("only hidden reasoning"), "reasoning but no text");
check(emptyReplyMessage("X", { thinkingChars: 0, completed: false }).includes("timed out or dropped"), "stream ended early with nothing: timed out or dropped");
check(emptyReplyMessage("X", { thinkingChars: 0, completed: true }).includes("empty reply"), "a clean but empty reply is called that");

console.log("\n--- PASS: thinking ---");
process.exit(0);
