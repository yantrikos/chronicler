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
import type { SkillState } from "../instrumentation/skill-transition-log";
import { runToolLoop, type ToolInvocation } from "./tool-loop";

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
  /** Max tokens for the reply. Falls back to 1024 if unset — the
   *  previous hardcoded 420 cut long-form prose mid-sentence. */
  maxResponseTokens?: number;
  /** Optional per-skill state lookup used to gate surfacing. Returning
   *  "suppressed" or "archived" keeps the skill out of the prompt; unknown
   *  is treated as "candidate". Wire from SkillOutcomeTracker.refreshState. */
  getSkillState?: (skill_id: string) => SkillState | undefined;
  /** Optional Grimoire plugin host. When set, lifecycle hooks fire at
   *  beforeChat / afterChat / afterWrite seams so plugins can observe or
   *  modify the turn. Hook errors are isolated — a misbehaving plugin
   *  cannot break the turn. */
  grimoire?: import("../grimoire/host").PluginHost;
  /** Optional MCP server registry. When set, registered+initialized
   *  servers' tools are exposed to the model via OpenAI tools format;
   *  tool calls execute through the registry and results re-feed into
   *  the conversation. See tool-loop.ts for the iteration semantics. */
  mcpRegistry?: import("../mcp/registry").McpServerRegistry;
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
      /** Where to inject the author's note. 0 (default) = in the system
       *  prompt only. N > 0 = as a synthetic system message N turns back
       *  from the end of the rendered history. See SessionMeta.author_note_depth. */
      authorNoteDepth?: number;
      /** Scene Intensity snippet for this session — injected into the
       *  system prompt inside <intensity> tags. Empty string for Neutral
       *  mode. See src/lib/intensity/registry.ts. */
      intensitySnippet?: string;
      /** Active character preferences, split by sensitivity. See
       *  src/lib/preferences/types.ts. */
      preferences?: {
        ordinary: string[];
        private: string[];
        limits: string[];
      };
      /** User-typed identity notes for this character. Manual-only. */
      identityNotes?: string;
      /** Phase 11 Pillar 1: crystallized core trait bodies for the
       *  speaker character. Inject unconditionally as `<character_identity>`
       *  in the system prompt. See `src/lib/skills/core-trait-promoter.ts`
       *  for derivation; App.tsx supplies the ranked list (top-K already
       *  applied at the source). */
      coreTraits?: string[];
      /** Phase 11 Pillar 2: the character's first-person self-model
       *  paragraph. Injected as `<self_model>` immediately after
       *  `<character_identity>`. See `src/lib/identity/self-model-substrate.ts`. */
      selfModel?: string;
      /** Per-character MCP tool allowlist (qualified names like
       *  "dice__roll"). When undefined, all enabled tools are exposed.
       *  When set (even to empty), filters the tools passed to the LLM
       *  AND rejects execution of unlisted tools (defense in depth).
       *  See src/lib/mcp/character-gating.ts. */
      allowedTools?: Set<string>;
      /** Per-character opted-in MCP resources (qualified URIs like
       *  "lore-server::lore://saltcoast/towns/port-llyr"). Empty when
       *  the character hasn't opted in to any resources. Each opted-in
       *  URI is fetched in parallel with YantrikDB recalls and merged
       *  into canon-equivalent retrieval. See src/lib/mcp/resource-opt-in.ts. */
      mcpEnabledResources?: string[];
      onChunk?: (chunk: string, accumulated: string) => void;
    }
  ): Promise<{
    assistant_turn: ChatTurn;
    retrieval: RetrievalResult;
    /** Skills that survived state filtering and were actually injected into
     *  the system prompt this turn. These are the IDs the outcome loop
     *  should score after observing user reaction. */
    prompted_skill_ids: string[];
    token_usage: number;
    writes_promise: Promise<void>;
    /** Tool invocations executed this turn (empty when no MCP tools
     *  fired). Caller renders them inline in chat + logs to inspector. */
    tool_invocations: ToolInvocation[];
  }> {
    if (scene) assertParticipant(scene, req.speaker);
    const t0 = performance.now();
    const [retrieval, recent] = await Promise.all([
      retrieveForTurn(this.deps.client, req, {
        mcpEnabledResources: opts?.mcpEnabledResources,
        mcpRegistry: this.deps.mcpRegistry,
      }),
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
      world_ids: req.character.world_ids,
      recent_text: scanText,
    }).catch(() => []);
    const { before: loreBefore, after: loreAfter } =
      partitionByPosition(activatedLore);

    const composed = composeContext(retrieval, recent, req.token_budget, {
      getSkillState: this.deps.getSkillState,
    });
    // When depth > 0 the author note is injected into the history stream
    // instead of the system prompt — pass it to anti-confab only at depth 0.
    const depth = Math.max(0, Math.floor(opts?.authorNoteDepth ?? 0));
    const noteInSystemPrompt = depth === 0 ? opts?.authorNote : undefined;
    const rendered = renderContext(
      composed,
      withAntiConfabulation(characterSystemPrompt, {
        userPersona: this.deps.userPersona,
        authorNote: noteInSystemPrompt,
        lorebookBefore: loreBefore,
        lorebookAfter: loreAfter,
        intensitySnippet: opts?.intensitySnippet,
        preferences: opts?.preferences,
        identityNotes: opts?.identityNotes,
        coreTraits: opts?.coreTraits,
        selfModel: opts?.selfModel,
      })
    );

    if (req.user_message) {
      rendered.history.push({
        role: "user",
        content: req.user_message.content,
      });
    }

    // Depth-N author note injection — synthetic system message inserted
    // N turns back from the END. If depth exceeds history length, clamp
    // to position 0 (front of history) so the note still lands somewhere.
    if (depth > 0 && opts?.authorNote && opts.authorNote.trim().length > 0) {
      const noteMsg = {
        role: "system" as const,
        content: `Steering note for this scene (follow it, do not mention it): ${opts.authorNote.trim()}`,
      };
      const pos = Math.max(0, rendered.history.length - depth);
      rendered.history.splice(pos, 0, noteMsg);
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
      breakdown: composed.token_usage,
      budget: composed.token_budget,
      truncated_sections: composed.truncated_sections,
      captured_at: new Date().toISOString(),
    };
    this.lastCapture.token_estimate.total =
      this.lastCapture.token_estimate.system +
      this.lastCapture.token_estimate.messages;

    // Grimoire beforeChat hook: plugins can mutate system prompt or messages.
    if (this.deps.grimoire) {
      const result = await this.deps.grimoire.dispatchHook("beforeChat", {
        sessionId: req.session_id,
        character: req.character,
        systemPrompt: rendered.system,
        messages: rendered.history.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });
      rendered.system = result.systemPrompt;
      // Allow plugins to mutate the message stream in-flight (rare, but
      // useful for prefix-injection plugins). Map back to typed history.
      if (Array.isArray(result.messages) && result.messages.length === rendered.history.length) {
        rendered.history = result.messages.map((m, i) => ({
          ...rendered.history[i],
          role: rendered.history[i].role,
          content: m.content,
        }));
      }
    }

    const chatReq = {
      model: this.deps.model,
      system: rendered.system,
      messages: rendered.history,
      max_tokens: this.deps.maxResponseTokens ?? 1024,
      sampling: this.deps.sampling,
    };
    let reply: { content: string };
    let toolInvocations: ToolInvocation[] = [];
    const mcpRegistry = this.deps.mcpRegistry;
    const hasTools = mcpRegistry
      ? mcpRegistry.list().some((s) => s.enabled && mcpRegistry.getCatalog(s.id))
      : false;
    if (hasTools && mcpRegistry) {
      // Tool-calling path: drive the iteration loop. We don't stream
      // through this path because tool-call detection needs the full
      // response object — streaming would force per-chunk parsing.
      // Streaming is preserved for the no-tools path (most turns).
      const loopResult = await runToolLoop(this.deps.provider, mcpRegistry, chatReq, {
        allowedTools: opts?.allowedTools,
      });
      reply = { content: loopResult.content };
      toolInvocations = loopResult.invocations;
      if (loopResult.truncated) {
        console.warn(
          `[orchestrator] tool loop hit iteration cap (${toolInvocations.length} calls executed)`
        );
      }
    } else if (opts?.onChunk && this.deps.provider.stream) {
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

    // Grimoire afterChat hook: plugins observe the raw reply; augmenters
    // may rewrite content via the returned context.
    if (this.deps.grimoire) {
      const result = await this.deps.grimoire.dispatchHook("afterChat", {
        sessionId: req.session_id,
        character: req.character,
        reply: { content: reply.content },
      });
      if (result.mutatedContent && typeof result.mutatedContent === "string") {
        reply = { content: result.mutatedContent };
      } else {
        reply = { content: result.reply.content };
      }
    }

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
        // Grimoire afterWrite hook: plugins observe finalized turns.
        // Errors are isolated per plugin and don't surface here.
        if (this.deps.grimoire) {
          await this.deps.grimoire.dispatchHook("afterWrite", {
            sessionId: req.session_id,
            character: req.character,
            userTurn: req.user_message,
            assistantTurn: assistant_turn,
            turnCount: recent.length + 1,
          });
        }
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
      prompted_skill_ids: composed.surfaced_skills.map((s) => s.skill_id),
      token_usage: composed.token_usage.total,
      writes_promise,
      tool_invocations: toolInvocations,
    };
  }
}
