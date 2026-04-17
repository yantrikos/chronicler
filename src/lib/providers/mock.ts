// MockProvider — deterministic, scriptable. Used by the 3-day continuity test
// harness and any unit test that shouldn't burn API tokens.

import type { ChatRequest, ChatResponse, LlmProvider } from "./index";

export interface MockBehavior {
  // Turn-scripted replies in order. If exhausted, uses fallback.
  scripted?: string[];
  fallback?: (req: ChatRequest) => string;
}

export class MockProvider implements LlmProvider {
  name = "mock";
  private i = 0;
  constructor(private behavior: MockBehavior = {}) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const scripted = this.behavior.scripted ?? [];
    if (this.i < scripted.length) {
      return { content: scripted[this.i++] };
    }
    if (this.behavior.fallback) {
      return { content: this.behavior.fallback(req) };
    }
    return {
      content: recapAwareFallback(req),
    };
  }

  reset(): void {
    this.i = 0;
  }
}

/**
 * Default fallback: if the system prompt looks like a recap request, echo
 * some of the facts back in the reply. Otherwise produce a bland in-character
 * reply that doesn't confabulate. Used by the 3-day test.
 */
function recapAwareFallback(req: ChatRequest): string {
  const isRecapRequest = /previously on|recap|compose a brief/i.test(req.system);
  if (isRecapRequest) {
    const userMsg = req.messages[req.messages.length - 1]?.content ?? "";
    const factLines = userMsg
      .split("\n")
      .filter((l) => /^\s*\d+\./.test(l))
      .map((l) => l.replace(/^\s*\d+\.\s*/, "").trim())
      .slice(0, 5);
    if (factLines.length === 0) return "Previously, nothing notable happened.";
    return `Previously: ${factLines.join(" ")}`;
  }
  return "(stays in character, does not invent anything not in canon)";
}
