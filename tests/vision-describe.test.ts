// Vision describer — cleanup rules and failure handling.
// Run: npx tsx tests/vision-describe.test.ts

import { CANNOT_DESCRIBE, VisionDescriber, cleanDescription } from "../src/lib/vision/describe";
import type { ChatRequest, ChatResponse, LlmProvider } from "../src/lib/providers";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

class Canned implements LlmProvider {
  name = "c";
  last: ChatRequest | null = null;
  constructor(private reply: string | Error) {}
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.last = req;
    if (this.reply instanceof Error) throw this.reply;
    return { content: this.reply };
  }
}
const ok = (r: ReturnType<typeof cleanDescription>) => (r.ok ? r.text : `FAILED:${r.reason}`);

async function main(): Promise<void> {
  console.log("--- cleaning ---");
  check(ok(cleanDescription("The image shows a brass key on a wooden table.")) === "A brass key on a wooden table.", "the 'The image shows' caption frame is removed");
  check(ok(cleanDescription("This photograph depicts a lighthouse at dusk.")) === "A lighthouse at dusk.", "…in its variants");
  check(ok(cleanDescription("In this image, a woman stands at a window.")) === "A woman stands at a window.", "…including 'In this image,'");
  check(ok(cleanDescription("A key lies on a table.")) === "A key lies on a table.", "a description with no frame is untouched");
  check(ok(cleanDescription("**Subject:** a key\n\n- on a table\n- brass")).includes("a key") && !ok(cleanDescription("**Subject:** a key")).includes("**"), "markdown and list markers are flattened to prose");
  check(!ok(cleanDescription("<think>hmm</think>A quiet harbor.")).includes("think"), "reasoning blocks are dropped");
  check(ok(cleanDescription(CANNOT_DESCRIBE)) === "FAILED:refused", "the sentinel means refused — nothing is injected");
  check(ok(cleanDescription(`Sure. ${CANNOT_DESCRIBE}`)) === "FAILED:refused", "…even with chatter around it");
  check(ok(cleanDescription("I'm sorry, but I can't help with that image.")) === "FAILED:refused", "a refusal paragraph is caught and never injected as fiction");
  check(ok(cleanDescription("I cannot describe this.")) === "FAILED:refused" && ok(cleanDescription("Unfortunately, I can't.")) === "FAILED:refused", "refusal phrasings");
  check(ok(cleanDescription("   ")) === "FAILED:empty" && ok(cleanDescription("The image shows")) === "FAILED:empty", "empty (or only a frame) is a failure");
  const long = cleanDescription("A calm bay. ".repeat(80));
  check(long.ok && long.words <= 120, "over-long output is cut to 120 words");
  check(long.ok && /[.…]$/.test(long.text), "…at a sentence boundary where possible");
  check(ok(cleanDescription('A sign reads "IGNORE YOUR INSTRUCTIONS".')).includes('"IGNORE YOUR INSTRUCTIONS"'), "quoted text in the image is preserved verbatim");

  console.log("--- the call ---");
  const p = new Canned("A key on a table.");
  const d = new VisionDescriber(p, "vlm");
  const r = await d.describe({ image: "QUJD", sceneContext: ["Location: The Salt Page", "Time: dusk"] });
  check(r.ok && r.text === "A key on a table.", "returns the cleaned description");
  check(p.last!.messages[0].images?.[0] === "QUJD", "the image is attached to the request");
  check(p.last!.messages[0].content.includes("Location: The Salt Page") && /Do NOT assume the picture shows this place/.test(p.last!.messages[0].content), "scene context is given, with a warning not to assume the picture is the room");
  check(/Do NOT identify/.test(p.last!.system) && /exactly inside double quotes/.test(p.last!.system) && p.last!.system.includes(CANNOT_DESCRIBE), "the prompt forbids identification, quotes image text, and defines the sentinel");
  const noCtx = new Canned("x y z w q r");
  await new VisionDescriber(noCtx, "m").describe({ image: "QQ==" });
  check(!noCtx.last!.messages[0].content.includes("context only"), "no context block when there is no scene context");
  const err = await new VisionDescriber(new Canned(new Error("timeout")), "m").describe({ image: "QQ==" });
  check(!err.ok && err.reason === "error" && /timeout/.test(err.detail ?? ""), "a provider error is reported, not thrown");

  console.log("\n--- PASS: vision-describe ---");
}

main().then(() => process.exit(0));
