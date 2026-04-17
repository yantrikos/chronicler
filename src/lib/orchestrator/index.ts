// Orchestrator — the policy layer. One call per turn:
//   1. retrieve in parallel
//   2. compose within token budget
//   3. send to LLM
//   4. write post-turn

import type { LlmProvider } from "../providers";
import type { YantrikClient } from "../yantrikdb/client";
import { withAntiConfabulation } from "./anti-confabulation";
import { composeContext, renderContext, approxTokens } from "./compose";
import { retrieveForTurn, type RetrievalResult } from "./pipeline";
import type { ChatTurn, PromptCapture, TurnRequest } from "./types";
import { writeTurn } from "./write";
import { reinforceAndMaybePromote } from "./auto-promote";
import type { Extractor } from "./extract";
import { assertParticipant, sceneVisibleTo, type Scene } from "./scene";
import { scanLorebook, partitionByPosition } from "./lorebook";

export interface OrchestratorDeps {
  client: YantrikClient;
  provider: LlmProvider;
  model: string;
  getRecentTurns: (sessionId: string) => Promise<ChatTurn[]>;
  /** Optional extractor for post-turn fact classification. If omitted, falls
   *  back to RegexExtractor — fine for tests, regex-naive for production.
   *  Real deployments should pass a HybridExtractor(LlmExtractor(...)). */
  extractor?: Extractor;
  /** Optional user persona — name + description injected into the system
   *  prompt so the character knows who they are talking to. */
  userPersona?: { name: string; description?: string };
  /** Optional sampling controls forwarded to the provider. */
  sampling?: import("../providers").SamplingOptions;
}

export class Orchestrator {
  private lastCapture: PromptCapture | null = null;
  constructor(private deps: OrchestratorDeps) {}

  /** Returns the prompt most recently sent to the LLM — what `<canon>`,
   *  `<scene>`, and message history actually looked like. Feeds the prompt
   *  inspector UI. null until the first turn runs. */
  getLastPromptCapture(): PromptCapture | null {
    return this.lastCapture;
  }

  async turn(
    req: TurnRequest,
    characterSystemPrompt: string,
    scene?: Scene,
    opts?: {
      skipWrites?: boolean;
      continueFromTurnId?: string;
      authorNote?: string;
      onChunk?: (chunk: string, accumulated: string) => void;
    }
  ): Promise<{
    assistant_turn: ChatTurn;
    retrieval: RetrievalResult;
    token_usage: number;
    writes_promise: Promise<void>;
  }> {
    if (scene) assertParticipant(scene, req.speaker);
    const t0 = performance.now();
    const [retrieval, recent] = await Promise.all([
      retrieveForTurn(this.deps.client, req),
      this.deps.getRecentTurns(req.session_id),
    ]);
    const t1 = performance.now();

    // Build scan text from the current user message + most-recent turns for
    // lorebook keyword matching. Default scan depth = 3 messages back.
    const scanText = [
      req.user_message?.content ?? "",
      ...recent.slice(-3).map((t) => t.content),
    ]
      .filter((s) => s.length > 0)
      .join("\n");

    const activatedLore = await scanLorebook(this.deps.client, {
      character_id: req.character.id,
      world_id: req.character.world_id,
      recent_text: scanText,
    }).catch(() => []);
    const { before: loreBefore, after: loreAfter } =
      partitionByPosition(activatedLore);

    const composed = composeContext(retrieval, recent, req.token_budget);
    const rendered = renderContext(
      composed,
      withAntiConfabulation(characterSystemPrompt, {
        userPersona: this.deps.userPersona,
        authorNote: opts?.authorNote,
        lorebookBefore: loreBefore,
        lorebookAfter: loreAfter,
      })
    );

    if (req.user_message) {
      rendered.history.push({
        role: "user",
        content: req.user_message.content,
      });
    }

    // Capture for the prompt inspector before firing the LLM.
    this.lastCapture = {
      system: rendered.system,
      messages: rendered.history,
      model: this.deps.model,
      token_estimate: {
        system: approxTokens(rendered.system),
        messages: rendered.history.reduce(
          (n, m) => n + approxTokens(m.content),
          0
        ),
        total: 0, // filled below
      },
      captured_at: new Date().toISOString(),
    };
    this.lastCapture.token_estimate.total =
      this.lastCapture.token_estimate.system +
      this.lastCapture.token_estimate.messages;

    const chatReq = {
      model: this.deps.model,
      system: rendered.system,
      messages: rendered.history,
      max_tokens: 420,
      sampling: this.deps.sampling,
    };
    let reply: { content: string };
    if (opts?.onChunk && this.deps.provider.stream) {
      // Streaming path: accumulate chunks and emit them to the UI.
      let acc = "";
      for await (const chunk of this.deps.provider.stream(chatReq)) {
        acc += chunk;
        opts.onChunk(chunk, acc);
      }
      reply = { content: acc };
    } else {
      reply = await this.deps.provider.chat(chatReq);
    }
    const t2 = performance.now();

    const assistant_turn: ChatTurn = {
      id: crypto.randomUUID(),
      role: "assistant",
      speaker: req.character.id,
      content: reply.content,
      created_at: new Date().toISOString(),
      session_id: req.session_id,
      in_reply_to: req.user_message?.id,
    };

    console.log(
      `[orchestrator] turn retrieval=${Math.round(t1 - t0)}ms chat=${Math.round(t2 - t1)}ms`
    );

    // Post-turn writes fire-and-forget so the UI sees the reply immediately.
    // Returns a promise the caller can await to refresh the inspector once
    // the background work (extraction, remember, reinforce, auto-promote)
    // has finished. Skipped for regenerate/continue since the user is just
    // iterating on the same turn and we don't want duplicate writes.
    const writes_promise = (async () => {
      if (opts?.skipWrites) return;
      const wt0 = performance.now();
      try {
        await writeTurn(this.deps.client, {
          session_id: req.session_id,
          speaker: req.speaker,
          character: req.character,
          user_turn: req.user_message,
          assistant_turn,
          visible_to: scene ? sceneVisibleTo(scene) : ["*"],
          extractor: this.deps.extractor,
        });
        await reinforceAndMaybePromote(this.deps.client, composed.heuristic, {
          session_id: req.session_id,
        });
      } catch (err) {
        console.error("[orchestrator] post-turn writes failed", err);
      } finally {
        console.log(
          `[orchestrator] post-turn writes took ${Math.round(performance.now() - wt0)}ms`
        );
      }
    })();

    return {
      assistant_turn,
      retrieval,
      token_usage: composed.token_usage.total,
      writes_promise,
    };
  }
}
