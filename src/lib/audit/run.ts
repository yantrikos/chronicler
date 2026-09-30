// Audit a whole chat: check each of the character's replies against its traits
// and summarise. The judge is injected so the logic is testable without a model.

import type { ChatTurn } from "../orchestrator/types";
import type { Flag } from "./judge";

export interface ReplyFinding {
  turn_id: string;
  flags: Flag[];
}

export interface AuditReport {
  session_id: string;
  /** ISO time the audit ran. */
  at: string;
  /** Model that judged, so the result can be weighed. */
  judge_model: string;
  traits: string[];
  /** Replies actually checked. */
  audited: number;
  /** Replies the judge could not check (model unreachable, etc.). */
  errors: number;
  /** Replies with at least one contradiction. */
  flagged: number;
  /** Contradictions per trait (index = trait number - 1). */
  by_trait: number[];
  findings: ReplyFinding[];
  /** True if the run was cancelled before finishing. */
  partial?: boolean;
}

/** Share of audited replies with no flagged contradiction (0..1). */
export function consistencyScore(r: Pick<AuditReport, "audited" | "flagged">): number | null {
  return r.audited === 0 ? null : 1 - r.flagged / r.audited;
}

export const MAX_REPLIES = 60;

/** The character's replies to check: assistant turns, newest MAX_REPLIES, in order. */
export function repliesToAudit(turns: ChatTurn[], max = MAX_REPLIES): ChatTurn[] {
  return turns.filter((t) => t.role === "assistant" && t.content.trim().length >= 12).slice(-max);
}

export interface RunOptions {
  turns: ChatTurn[];
  sessionId: string;
  traits: string[];
  judgeModel: string;
  judge: (traits: string[], reply: string) => Promise<Flag[]>;
  onProgress?: (done: number, total: number) => void;
  shouldCancel?: () => boolean;
  concurrency?: number;
  now?: () => Date;
}

export async function runAudit(o: RunOptions): Promise<AuditReport> {
  const replies = repliesToAudit(o.turns);
  const findings: ReplyFinding[] = new Array(replies.length);
  const checked: boolean[] = new Array(replies.length).fill(false);
  let errors = 0;
  let done = 0;
  let next = 0;
  let cancelled = false;
  const worker = async () => {
    while (true) {
      if (o.shouldCancel?.()) {
        cancelled = true;
        return;
      }
      const i = next++;
      if (i >= replies.length) return;
      try {
        const flags = await o.judge(o.traits, replies[i].content);
        findings[i] = { turn_id: replies[i].id, flags };
        checked[i] = true;
      } catch {
        errors++;
      }
      o.onProgress?.(++done, replies.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency ?? 2) }, worker));
  const done_findings = findings.filter((f, i) => checked[i] && f);
  const by_trait = o.traits.map(() => 0);
  for (const f of done_findings) for (const fl of f.flags) by_trait[fl.trait - 1] = (by_trait[fl.trait - 1] ?? 0) + 1;
  return {
    session_id: o.sessionId,
    at: (o.now?.() ?? new Date()).toISOString(),
    judge_model: o.judgeModel,
    traits: o.traits,
    audited: done_findings.length,
    errors,
    flagged: done_findings.filter((f) => f.flags.length > 0).length,
    by_trait,
    findings: done_findings.filter((f) => f.flags.length > 0),
    ...(cancelled ? { partial: true } : {}),
  };
}
