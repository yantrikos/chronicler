// Let the user's reply go first.
//
// One model server does one thing at a time. Chronicler makes background calls after every reply
// (fact extraction, scene board, ledger, story summary) and by default they use the SAME model as
// the chat. On a small model they take a couple of seconds and nobody notices. On a big, slow one
// (qwen3.8 27B runs ~5 tokens/s on an M4 Pro) they take most of a minute — and a message you send
// right after a reply queues BEHIND them: measured, the second reply's first word arrived after
// 38 s instead of 3.5 s.
//
// The gate gives chat priority on a shared backend:
//   - a background call WAITS while a chat request is in flight (plus a short quiet moment after);
//   - a background call already running is CANCELLED the instant a chat request starts — the proxy
//     then cancels it at the model server — and is RETRIED once chat is idle, so nothing is lost,
//     only delayed. (After a few cancellations it gives up, so a rapid typist never starves the
//     server with endlessly repeated work.)
// It is applied only when chat and background share the same LOCAL backend; a separate background
// model or a hosted API has no queue to jump, so nothing changes there.

import type { ProviderConfigEntry } from "../config";
import { limit } from "../limits";
import type { ChatRequest, ChatResponse, LlmProvider } from "./index";

/** The abort reason for "chat needs the model"; anything else that aborts is the caller's own. */
export const GATE_ABORT = "chronicler:yield-to-chat";

export class LlmGate {
  private active = 0;
  private running = new Set<AbortController>();
  private waiters: Array<() => void> = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private idleMs = limit("gate.quiet_ms"),
    private maxYields = limit("gate.max_retries")
  ) {}

  /** A chat request is in flight (or its quiet moment hasn't passed). */
  get busy(): boolean {
    return this.active > 0 || this.timer !== undefined;
  }

  chatStart(): void {
    this.active++;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    for (const c of this.running) c.abort(GATE_ABORT);
  }

  chatEnd(): void {
    this.active = Math.max(0, this.active - 1);
    if (this.active > 0) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const w = this.waiters;
      this.waiters = [];
      for (const f of w) f();
    }, this.idleMs);
  }

  /** Resolves when chat has been idle for the quiet moment; rejects if `signal` aborts first. */
  whenIdle(signal?: AbortSignal): Promise<void> {
    if (!this.busy) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        this.waiters = this.waiters.filter((f) => f !== go);
        reject(signal?.reason instanceof Error ? signal.reason : new DOMException("aborted", "AbortError"));
      };
      const go = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(go);
    });
  }

  /** Run background work: waits for chat to be idle, is cancelled if chat starts, then retried. */
  async runBackground<T>(fn: (signal: AbortSignal) => Promise<T>, outer?: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await this.whenIdle(outer);
      const ctl = new AbortController();
      const onOuter = () => ctl.abort(outer?.reason);
      outer?.addEventListener("abort", onOuter, { once: true });
      this.running.add(ctl);
      try {
        return await fn(ctl.signal);
      } catch (e) {
        if (ctl.signal.aborted && ctl.signal.reason === GATE_ABORT && attempt < this.maxYields && !outer?.aborted) continue;
        throw e;
      } finally {
        this.running.delete(ctl);
        outer?.removeEventListener("abort", onOuter);
      }
    }
  }
}

/** The chat provider: marks chat as busy for the life of each request. */
export function gateChat(provider: LlmProvider, gate: LlmGate): LlmProvider {
  const wrapped: LlmProvider = {
    name: provider.name,
    async chat(req: ChatRequest): Promise<ChatResponse> {
      gate.chatStart();
      try {
        return await provider.chat(req);
      } finally {
        gate.chatEnd();
      }
    },
  };
  if (provider.stream) {
    wrapped.stream = async function* (req: ChatRequest) {
      gate.chatStart();
      try {
        yield* provider.stream!(req);
      } finally {
        gate.chatEnd();
      }
    };
  }
  return wrapped;
}

/** A background provider: yields to chat (see the header comment). */
export function gateBackground(provider: LlmProvider, gate: LlmGate): LlmProvider {
  const wrapped: LlmProvider = {
    name: provider.name,
    chat: (req: ChatRequest) => gate.runBackground((signal) => provider.chat({ ...req, signal }), req.signal),
  };
  if (provider.stream) {
    wrapped.stream = async function* (req: ChatRequest) {
      await gate.whenIdle(req.signal);
      yield* provider.stream!(req);
    };
  }
  return wrapped;
}

/** Normalised identity of a model server: host + port, ignoring /v1 and trailing slashes. */
export function backendKey(p: ProviderConfigEntry): string {
  const base = (p.base_url ?? "").trim().toLowerCase().replace(/\/v1\/?$/, "").replace(/\/+$/, "");
  return base || p.kind;
}

/** Gate only when chat and background share one LOCAL backend — that is the only place they queue. */
export function shouldGate(
  chat: ProviderConfigEntry | undefined,
  background: ProviderConfigEntry | undefined,
  isLocal: (p: ProviderConfigEntry) => boolean
): boolean {
  if (!chat || !background || chat.kind === "mock" || background.kind === "mock") return false;
  return isLocal(chat) && isLocal(background) && backendKey(chat) === backendKey(background);
}
