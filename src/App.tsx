import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { ChatPane } from "./components/Chat/ChatPane";
import {
  MemoryInspector,
  type InspectorMemory,
} from "./components/Inspector/MemoryInspector";
import { PromptInspector } from "./components/Inspector/PromptInspector";
import {
  ThinkPanel,
  type ThinkConflict,
  type ThinkTrigger,
} from "./components/Inspector/ThinkPanel";
import { SettingsPanel } from "./components/Settings/SettingsPanel";
import { CharacterLibrary } from "./components/Library/CharacterLibrary";
import { Logo, Mark } from "./components/Brand/Logo";
import { EmptyState } from "./components/Brand/EmptyState";
import { HelpOverlay } from "./components/Brand/HelpOverlay";
import { useKeyboardShortcuts } from "./lib/ui/keyboard";
import { Orchestrator } from "./lib/orchestrator";
import type { Character, ChatTurn, PromptCapture } from "./lib/orchestrator/types";
import { parseCard } from "./lib/cards/parser";
import { decomposeCard, buildSystemPrompt } from "./lib/cards/decompose";
import { YantrikClient } from "./lib/yantrikdb/client";
import { InMemoryTransport } from "./lib/yantrikdb/memory-transport";
import { McpTransport } from "./lib/yantrikdb/mcp-transport";
import type { YantrikDBTransport } from "./lib/yantrikdb/client";
import {
  AnthropicProvider,
  OllamaProvider,
  OpenAICompatProvider,
  type LlmProvider,
} from "./lib/providers";
import { MockProvider } from "./lib/providers/mock";
import {
  HybridExtractor,
  LlmExtractor,
  RegexExtractor,
  type Extractor,
} from "./lib/orchestrator/extract";
import {
  ConflictVerifier,
  type ConflictCheck,
} from "./lib/orchestrator/verify-conflict";
import { startSession } from "./lib/session/lifecycle";
import { generateRecap } from "./lib/recap/generator";
import {
  activeProvider,
  defaultConfig,
  extractionProvider,
  loadConfig,
  saveConfig,
  type ChroniclerConfig,
  type ProviderConfigEntry,
} from "./lib/config";
import {
  soloScene,
  addParticipant,
  type Scene,
} from "./lib/orchestrator/scene";
import {
  listSessions,
  saveSessionMeta,
  deleteSession as storeDeleteSession,
  loadTurns,
  saveTurns,
  metaFromScene,
  listCharacters,
  saveCharacter as storeSaveCharacter,
  type SessionMeta,
} from "./lib/session/store";
import {
  exportSessionMarkdown,
  downloadText,
  buildBackup,
  parseBackup,
} from "./lib/session/export";
import { SessionList } from "./components/Sessions/SessionList";

function buildTransport(cfg: ChroniclerConfig): YantrikDBTransport {
  if (cfg.yantrikdb.kind === "mcp" && cfg.yantrikdb.mcp) {
    return new McpTransport({
      kind: cfg.yantrikdb.mcp.kind,
      url: cfg.yantrikdb.mcp.url,
      authToken: cfg.yantrikdb.mcp.authToken,
    });
  }
  return new InMemoryTransport();
}

function buildProvider(p: ProviderConfigEntry): LlmProvider {
  if (p.kind === "anthropic") return new AnthropicProvider(p.api_key);
  if (p.kind === "ollama")
    return new OllamaProvider(
      p.base_url ?? "http://host.docker.internal:11434",
      p.label,
      p.disable_thinking ?? false
    );
  if (p.kind === "openai-compat")
    return new OpenAICompatProvider(
      p.base_url ?? "https://api.openai.com/v1",
      p.api_key,
      p.label,
      p.disable_thinking ?? false
    );
  return new MockProvider();
}

// YantrikDB's trigger + conflict streams include housekeeping/low-signal
// entries that we don't want cluttering the Think panel:
//   - redundancy triggers are auto-merged by refreshThinkPanel above
//   - minor conflicts with low priority are similarity heuristics, not
//     semantic contradictions (e.g. "Ren is smirking" vs "Ren holds a fork"
//     share an entity + some vocabulary but are obviously compatible)
// We filter aggressively in the UI so what remains is actually actionable.
function filterVisibleTriggers(
  trigs: ThinkTrigger[]
): ThinkTrigger[] {
  return trigs.filter((t) => t.trigger_type !== "redundancy");
}

function filterVisibleConflicts(
  confs: ThinkConflict[]
): ThinkConflict[] {
  return confs.filter((c) => {
    // Trust YantrikDB's own priority classification: minor/low-priority
    // pairs are noise under the similarity-based detector. Show only
    // contradictions that the engine itself flags as non-trivial.
    if (c.priority === "low" && c.conflict_type === "minor") return false;
    return true;
  });
}

function inferTier(
  metaTier: string | undefined,
  namespace: string,
  importance: number
): InspectorMemory["tier"] {
  // If the server somehow returned our metadata intact, trust it.
  if (metaTier === "canon" || metaTier === "heuristic" || metaTier === "reflex")
    return metaTier;
  // Otherwise infer from namespace conventions used by Chronicler writes.
  if (namespace.startsWith("session:")) return "reflex";
  if (namespace.startsWith("lorebook:")) return "canon";
  if (namespace.startsWith("world:")) return "canon";
  if (namespace.startsWith("character:")) {
    // Seed canon writes ship with importance 0.7; heuristic inferences
    // default to 0.4. Threshold at 0.65 splits them cleanly.
    return importance >= 0.65 ? "canon" : "heuristic";
  }
  return "heuristic";
}

function buildExtractorFromConfig(cfg: ChroniclerConfig): {
  extractor: Extractor;
  provider_label: string;
} {
  const p = extractionProvider(cfg);
  if (!p || p.kind === "mock")
    return { extractor: new RegexExtractor(), provider_label: "regex-only" };
  const provider = buildProvider(p);
  return {
    extractor: new HybridExtractor(new LlmExtractor(provider, p.model)),
    provider_label: p.label,
  };
}

function App() {
  const [config, setConfig] = useState<ChroniclerConfig>(defaultConfig);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [promptInspectorOpen, setPromptInspectorOpen] = useState(false);
  const [lastPromptCapture, setLastPromptCapture] =
    useState<PromptCapture | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [systemPrompts, setSystemPrompts] = useState<Record<string, string>>({});
  const [scene, setScene] = useState<Scene | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [nextSpeakerId, setNextSpeakerId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [memories, setMemories] = useState<InspectorMemory[]>([]);
  const [thinking, setThinking] = useState(false);
  const [recap, setRecap] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const transportRef = useRef<YantrikDBTransport>(new InMemoryTransport());
  const clientRef = useRef<YantrikClient>(new YantrikClient(transportRef.current));
  const providerRef = useRef<LlmProvider>(new MockProvider());
  const extractorRef = useRef<Extractor>(new RegexExtractor());
  const modelRef = useRef<string>("mock");
  const samplingRef = useRef<
    import("./lib/providers").SamplingOptions | undefined
  >(undefined);
  const personaRef = useRef<
    import("./lib/config").UserPersona | undefined
  >(undefined);
  const conflictVerifierRef = useRef<ConflictVerifier | null>(null);
  const [streamingText, setStreamingText] = useState<string | undefined>(undefined);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [authorNote, setAuthorNote] = useState<string>("");
  const [authorNoteOpen, setAuthorNoteOpen] = useState(false);
  const [greetingIndex, setGreetingIndex] = useState<number>(0);
  const [helpOpen, setHelpOpen] = useState(false);
  // Cache of full memory records (populated via memory.get). Avoids re-fetching
  // the same rid on every refresh.
  const metaCacheRef = useRef<Map<string, Record<string, unknown>>>(new Map());
  const [triggers, setTriggers] = useState<ThinkTrigger[]>([]);
  const [conflicts, setConflicts] = useState<ThinkConflict[]>([]);
  const [runningThink, setRunningThink] = useState(false);
  const lastUserTurnAtRef = useRef<number>(Date.now());
  const [view, setView] = useState<"library" | "chat">("chat");
  const [libraryCharacters, setLibraryCharacters] = useState<Character[]>([]);

  useEffect(() => {
    const cfg = loadConfig();
    setConfig(cfg);
    rebuildRuntime(cfg);
    const sess = listSessions();
    setSessions(sess);
    const chars = listCharacters();
    setLibraryCharacters(chars);
    // Land on the library view when there are prior characters and no
    // in-progress chat; jump to chat if nothing imported yet.
    if (chars.length > 0) setView("library");
  }, []);

  // Persist turns on every change (cheap — localStorage sync, no race).
  useEffect(() => {
    if (!sessionId || !scene) return;
    saveTurns(sessionId, turns);
    if (characters.length > 0) {
      const meta = metaFromScene(sessionId, scene, characters, turns, {
        greeting_index: greetingIndex,
        author_note: authorNote,
      });
      saveSessionMeta(meta);
      setSessions(listSessions());
    }
  }, [turns, sessionId, scene, characters, greetingIndex, authorNote]);

  // Refresh the inspector whenever the character roster or session changes.
  // Calling refreshMemories() from inside the import handler would read the
  // stale `characters` closure — useEffect waits until React has flushed
  // the state, so we query the right namespaces.
  useEffect(() => {
    if (characters.length === 0) return;
    void refreshMemories();
    void refreshThinkPanel(`character:${characters[0].id}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characters.map((c) => c.id).join(","), sessionId]);

  function rebuildRuntime(cfg: ChroniclerConfig) {
    const prev = transportRef.current;
    if (prev instanceof McpTransport) prev.close().catch(() => undefined);
    transportRef.current = buildTransport(cfg);
    clientRef.current = new YantrikClient(transportRef.current);
    const p = activeProvider(cfg);
    const provider = p ? buildProvider(p) : new MockProvider();
    providerRef.current = provider;
    modelRef.current = p?.model ?? "mock";
    extractorRef.current = buildExtractorFromConfig(cfg).extractor;

    // Build a conflict verifier using the extraction provider (small/fast)
    // when configured, falling back to the generation provider. Skip for
    // MockProvider — nothing to verify with against.
    const xp = extractionProvider(cfg);
    if (xp && xp.kind !== "mock") {
      const vp = buildProvider(xp);
      conflictVerifierRef.current = new ConflictVerifier(vp, xp.model);
    } else if (p && p.kind !== "mock") {
      conflictVerifierRef.current = new ConflictVerifier(provider, p.model);
    } else {
      conflictVerifierRef.current = null;
    }

    samplingRef.current = p
      ? {
          temperature: p.temperature,
          top_p: p.top_p,
          top_k: p.top_k,
          min_p: p.min_p,
          repetition_penalty: p.repetition_penalty,
        }
      : undefined;
    personaRef.current = cfg.user_persona;
    refreshMemories();
  }

  const orchestrator = useMemo(
    () =>
      new Orchestrator({
        client: clientRef.current,
        provider: providerRef.current,
        model: modelRef.current,
        extractor: extractorRef.current,
        getRecentTurns: async () => turns.slice(-10),
        userPersona: personaRef.current,
        sampling: samplingRef.current,
      }),
    [turns, config]
  );

  async function refreshThinkPanel(ns: string) {
    const client = clientRef.current;
    try {
      const [trigs, confs] = await Promise.all([
        client.triggerPending(ns),
        client.conflictList(ns),
      ]);

      // Two classes of maintenance triggers we handle automatically —
      // YantrikDB is nagging us about bookkeeping we can dispatch without
      // any user judgment:
      //   - redundancy: "two memories are ~100% similar" → consolidate
      //   - conflict_escalation: "you have N open conflicts, review them"
      //       → run the LLM verifier over ALL conflicts and dismiss the
      //         pairs that are actually compatible, then ack the trigger
      const redundant = trigs.filter((t) => t.trigger_type === "redundancy");
      const escalations = trigs.filter(
        (t) => t.trigger_type === "conflict_escalation"
      );

      // Also proactively bulk-dismiss the minor+low noise even if there's
      // no escalation trigger yet — YantrikDB's similarity detector produces
      // enough of these per turn that waiting for escalation is slow.
      const trivialCount = confs.filter(
        (c) => c.priority === "low" && c.conflict_type === "minor"
      ).length;

      if (
        redundant.length > 0 ||
        escalations.length > 0 ||
        trivialCount >= 5
      ) {
        void (async () => {
          await Promise.all(
            redundant.map((t) =>
              client.triggerAct(t.id).catch(() => undefined)
            )
          );
          await dismissFalsePositiveConflicts(confs);
          if (escalations.length > 0) {
            await Promise.all(
              escalations.map((t) =>
                client.triggerAct(t.id).catch(() => undefined)
              )
            );
          }
          await client.think(ns).catch(() => undefined);
          const [freshTrigs, freshConfs] = await Promise.all([
            client.triggerPending(ns),
            client.conflictList(ns),
          ]);
          setTriggers(filterVisibleTriggers(freshTrigs));
          await updateConflictsWithVerification(freshConfs);
        })();
      }

      setTriggers(filterVisibleTriggers(trigs));
      await updateConflictsWithVerification(confs);
    } catch {
      // non-fatal
    }
  }

  /** Dispatch YantrikDB's conflict backlog:
   *    1. Bulk-dismiss anything YantrikDB itself classifies as minor+low.
   *       Its own heuristic already says "low confidence" — trust it and
   *       don't waste LLM tokens.
   *    2. LLM-verify only the medium/high priority candidates (capped per
   *       refresh to bound latency).
   *    3. Dismiss the LLM-verified compatibles on the YantrikDB side so
   *       the count actually drops.
   *
   *  This keeps conflict detection useful without paying LLM tokens on
   *  thousands of similarity false-positives. Verifier cache dedupes
   *  across refreshes. */
  async function dismissFalsePositiveConflicts(
    candidates: ThinkConflict[]
  ): Promise<void> {
    const client = clientRef.current;
    const trivialNoise = candidates.filter(
      (c) => c.priority === "low" && c.conflict_type === "minor"
    );
    if (trivialNoise.length > 0) {
      // Fire in parallel — each resolve is ~20ms on YantrikDB.
      await Promise.all(
        trivialNoise.map((c) =>
          client.conflictResolve(c.id, "dismiss").catch(() => undefined)
        )
      );
    }

    const verifier = conflictVerifierRef.current;
    if (!verifier) return;
    const MAX_VERIFY_PER_REFRESH = 12;
    const nontrivial = candidates
      .filter(
        (c) =>
          !(c.priority === "low" && c.conflict_type === "minor") &&
          c.a?.text &&
          c.b?.text
      )
      .slice(0, MAX_VERIFY_PER_REFRESH);
    if (nontrivial.length === 0) return;
    const checks = await verifier
      .verifyBatch(
        nontrivial.map((c) => ({ id: c.id, a: c.a, b: c.b }))
      )
      .catch(() => [] as ConflictCheck[]);
    const dismissals = checks.filter(
      (v) => v.verdict === "compatible" && v.confidence !== "low"
    );
    if (dismissals.length === 0) return;
    await Promise.all(
      dismissals.map((v) =>
        client.conflictResolve(v.conflict_id, "dismiss").catch(() => undefined)
      )
    );
  }

  // Candidate list comes from YantrikDB's cheap similarity-based detector.
  // Before showing, we run an LLM pass over candidates (cached per
  // conflict_id, bounded parallelism) to separate real contradictions from
  // coincidental word overlap. This is the "YantrikDB narrows, LLM
  // verifies" pattern.
  async function updateConflictsWithVerification(
    raw: ThinkConflict[]
  ): Promise<void> {
    // First cut: hide what YantrikDB itself rates as minor+low (noise).
    const passing = filterVisibleConflicts(raw);
    const verifier = conflictVerifierRef.current;
    // With no verifier available (mock provider), trust YantrikDB's own
    // priority and show everything that passed.
    if (!verifier) {
      setConflicts(passing);
      return;
    }

    // Paint what we have immediately so the UI isn't blank while the LLM
    // verifies in the background.
    setConflicts(passing);

    const checks: ConflictCheck[] = await verifier
      .verifyBatch(
        passing.map((c) => ({ id: c.id, a: c.a, b: c.b }))
      )
      .catch(() => [] as ConflictCheck[]);

    const verdictById = new Map(checks.map((v) => [v.conflict_id, v]));
    const verified: ThinkConflict[] = passing
      .map((c) => {
        const v = verdictById.get(c.id);
        if (!v) return c;
        // Replace detection_reason with the verifier's explanation so the
        // UI reflects the LLM judgment rather than the raw similarity score.
        return {
          ...c,
          detection_reason: `${v.verdict}/${v.confidence} — ${v.explanation}`,
          conflict_type: v.verdict === "contradiction" ? "contradiction" : c.conflict_type,
          priority:
            v.verdict === "contradiction" && v.confidence === "high"
              ? "high"
              : v.verdict === "contradiction"
              ? "medium"
              : c.priority,
        };
      })
      // Keep only pairs the LLM believes are real contradictions (or high-
      // priority YantrikDB flags the verifier couldn't decisively dismiss).
      .filter((c) => {
        const v = verdictById.get(c.id);
        if (!v) return c.priority === "high";
        return v.verdict === "contradiction" && v.confidence !== "low";
      });
    setConflicts(verified);
  }

  async function onRunThink() {
    if (characters.length === 0 || runningThink) return;
    setRunningThink(true);
    try {
      const primary = characters[0];
      const ns = `character:${primary.id}`;
      await clientRef.current.think(ns).catch(() => undefined);
      await refreshThinkPanel(ns);
      await refreshMemories();
    } finally {
      setRunningThink(false);
    }
  }

  async function onActTrigger(id: string) {
    const target = triggers.find((t) => t.id === id);
    if (!target || characters.length === 0) return;
    // Housekeeping triggers are auto-acted in refreshThinkPanel — if one
    // slipped into the visible list, still apply it silently.
    if (target.trigger_type === "redundancy") {
      await clientRef.current.triggerAct(id).catch(() => undefined);
      const ns = `character:${characters[0].id}`;
      await clientRef.current.think(ns).catch(() => undefined);
      await refreshThinkPanel(ns);
      await refreshMemories();
      return;
    }
    // Real character urge — have them speak it.
    await proactivelySpeak(target);
    await clientRef.current.triggerAct(id).catch(() => undefined);
    setTriggers((ts) => ts.filter((t) => t.id !== id));
  }

  async function onDismissTrigger(id: string) {
    await clientRef.current.triggerDismiss(id).catch(() => undefined);
    setTriggers((ts) => ts.filter((t) => t.id !== id));
  }

  async function onResolveConflict(
    id: string,
    strategy: "keep_a" | "keep_b" | "merge" | "dismiss"
  ) {
    await clientRef.current.conflictResolve(id, strategy).catch(() => undefined);
    setConflicts((cs) => cs.filter((c) => c.id !== id));
    await refreshMemories();
  }

  async function proactivelySpeak(trigger: ThinkTrigger) {
    if (characters.length === 0 || !sessionId || !scene) return;
    const speakerChar = characters.find(
      (c) => c.id === (nextSpeakerId ?? characters[0].id)
    );
    if (!speakerChar) return;
    const hint = trigger.reason || "(follow an inner urge)";
    const priorNote = authorNote;
    setAuthorNote(
      (priorNote ? `${priorNote}\n\n` : "") +
        `You have an urge right now: ${hint}. Act on it naturally this turn without announcing it or breaking character.`
    );
    try {
      await runAssistantTurn(turns, undefined, speakerChar, { skipWrites: false });
    } finally {
      setAuthorNote(priorNote);
    }
  }

  async function refreshMemories() {
    if (transportRef.current instanceof InMemoryTransport) {
      const all = transportRef.current.all();
      const view: InspectorMemory[] = all.map((m) => ({
        rid: m.rid,
        text: m.text,
        tier: (m.metadata.tier as InspectorMemory["tier"]) ?? "heuristic",
        canonical_status: m.metadata
          .canonical_status as InspectorMemory["canonical_status"],
        certainty: m.certainty,
        importance: m.importance,
        source: m.source,
        namespace: m.namespace,
        created_at: m.created_at,
      }));
      setMemories(view);
      return;
    }

    // MCP transport: pull memories for the active scene's namespaces in
    // parallel. Dedupe by rid so we don't double-count shared canon.
    if (characters.length === 0) {
      setMemories([]);
      return;
    }
    const primary = characters[0];
    const client = clientRef.current;
    try {
      const requests: Promise<Awaited<ReturnType<typeof client.listMemoriesInNamespace>>>[] =
        [];
      for (const c of characters) {
        requests.push(client.listMemoriesInNamespace(`character:${c.id}`, 200));
        requests.push(
          client.listMemoriesInNamespace(`lorebook:${c.id}`, 100)
        );
      }
      if (primary.world_id) {
        requests.push(
          client.listMemoriesInNamespace(`world:${primary.world_id}`, 100)
        );
      }
      if (sessionId) {
        requests.push(
          client.listMemoriesInNamespace(`session:${sessionId}`, 60)
        );
      }
      const batches = await Promise.all(requests);
      const seen = new Set<string>();
      const view: InspectorMemory[] = [];
      for (const batch of batches) {
        for (const r of batch) {
          const rid = (r as { rid?: string }).rid;
          if (!rid || seen.has(rid)) continue;
          seen.add(rid);
          // Start with cached full metadata if we've fetched it before.
          const cached = metaCacheRef.current.get(rid) ?? null;
          const meta =
            cached ??
            ((r as { metadata?: Record<string, unknown> }).metadata ?? {});
          const ns = (r as { namespace?: string }).namespace ?? "";
          const importance = (r as { importance?: number }).importance ?? 0.5;
          const tier = inferTier(meta.tier as string | undefined, ns, importance);
          view.push({
            rid,
            text: (r as { text?: string }).text ?? "",
            tier,
            canonical_status:
              meta.canonical_status as InspectorMemory["canonical_status"],
            certainty: (r as { certainty?: number }).certainty ?? 0.5,
            importance,
            source: String(
              (r as { source?: string }).source ?? meta.source ?? "user"
            ),
            namespace: ns,
          });
        }
      }
      const tierOrder: Record<string, number> = {
        canon: 0,
        heuristic: 1,
        reflex: 2,
      };
      const byTierThenImportance = (a: InspectorMemory, b: InspectorMemory) => {
        const t = (tierOrder[a.tier] ?? 9) - (tierOrder[b.tier] ?? 9);
        if (t !== 0) return t;
        return (b.importance ?? 0) - (a.importance ?? 0);
      };
      view.sort(byTierThenImportance);
      setMemories(view);

      // Second pass: for rids we don't have cached full metadata for, fire
      // memory.get in parallel and update the inspector once the ground
      // truth arrives. This is the "recall returns highlights; get returns
      // the exact record" contract on the read side.
      const missing = view
        .filter((m) => !metaCacheRef.current.has(m.rid))
        .slice(0, 80); // cap per refresh to bound request volume
      if (missing.length > 0) {
        void enrichMemories(missing).then((enrichedAll) => {
          // Merge enriched tier/canonical_status back into the view, update
          // the cache, and re-render.
          setMemories((prev) => {
            const byRid = new Map(enrichedAll.map((e) => [e.rid, e]));
            const merged = prev.map((m) => {
              const full = byRid.get(m.rid);
              if (!full) return m;
              metaCacheRef.current.set(m.rid, full.metadata);
              const realTier =
                (full.metadata.tier as InspectorMemory["tier"] | undefined) ??
                m.tier;
              return {
                ...m,
                tier: realTier,
                canonical_status:
                  (full.metadata
                    .canonical_status as InspectorMemory["canonical_status"]) ??
                  m.canonical_status,
                certainty: full.certainty ?? m.certainty,
                source: full.source ?? m.source,
              };
            });
            merged.sort(byTierThenImportance);
            return merged;
          });
        });
      }
    } catch (err) {
      console.error("[chronicler] refreshMemories failed", err);
    }
  }

  async function enrichMemories(
    items: InspectorMemory[]
  ): Promise<
    Array<{
      rid: string;
      metadata: Record<string, unknown>;
      certainty?: number;
      source?: string;
    }>
  > {
    const client = clientRef.current;
    const records = await Promise.all(
      items.map((m) =>
        client.getMemory(m.rid).catch(() => null)
      )
    );
    const out: Array<{
      rid: string;
      metadata: Record<string, unknown>;
      certainty?: number;
      source?: string;
    }> = [];
    for (const r of records) {
      if (!r) continue;
      out.push({
        rid: r.rid,
        metadata: r.metadata,
        certainty: r.certainty,
        source: r.source,
      });
    }
    return out;
  }

  async function addCharacter(char: Character, systemPrompt: string) {
    storeSaveCharacter({ ...char, system_prompt: systemPrompt });
    setLibraryCharacters(listCharacters());
    setCharacters((prev) => {
      if (prev.some((c) => c.id === char.id)) return prev;
      const next = [...prev, char];
      if (prev.length === 0) {
        const s = soloScene(char.id);
        setScene(s);
        setNextSpeakerId(char.id);
        startSession(clientRef.current, {
          user_id: "user",
          character_ids: [char.id],
          world_id: char.world_id,
        }).then((ss) => {
          setSessionId(ss.id);
          // Seed the first assistant turn with the chosen greeting so new
          // chats open with the character already "present" — matches ST/chub.
          const greetings = char.greetings ?? [];
          if (greetings.length > 0) {
            const greeting = greetings[0];
            setGreetingIndex(0);
            setTurns([
              {
                id: crypto.randomUUID(),
                role: "assistant",
                speaker: char.id,
                content: greeting,
                created_at: new Date().toISOString(),
                session_id: ss.id,
              },
            ]);
          }
        });
        generateRecap(clientRef.current, {
          character_id: char.id,
          world_id: char.world_id,
          speaker: "user",
          provider: providerRef.current,
          model: modelRef.current,
        }).then((r) => setRecap(r.text));
      } else {
        setScene((s) => (s ? addParticipant(s, char.id) : s));
      }
      return next;
    });
    setSystemPrompts((prev) => ({ ...prev, [char.id]: systemPrompt }));
  }

  async function startNewSessionForCharacter(primary: Character): Promise<void> {
    const s = soloScene(primary.id);
    setScene(s);
    setNextSpeakerId(primary.id);
    setAuthorNote("");
    setGreetingIndex(0);
    const ss = await startSession(clientRef.current, {
      user_id: "user",
      character_ids: [primary.id],
      world_id: primary.world_id,
    });
    setSessionId(ss.id);
    const greetings = primary.greetings ?? [];
    setTurns(
      greetings.length > 0
        ? [
            {
              id: crypto.randomUUID(),
              role: "assistant",
              speaker: primary.id,
              content: greetings[0],
              created_at: new Date().toISOString(),
              session_id: ss.id,
            },
          ]
        : []
    );
    await refreshMemories();
    await refreshThinkPanel(`character:${primary.id}`);
  }

  async function startNewSession(): Promise<void> {
    if (characters.length === 0) return;
    const primary = characters[0];
    const s = soloScene(primary.id);
    setScene(s);
    setNextSpeakerId(primary.id);
    setAuthorNote("");
    setGreetingIndex(0);
    const ss = await startSession(clientRef.current, {
      user_id: "user",
      character_ids: [primary.id],
      world_id: primary.world_id,
    });
    setSessionId(ss.id);
    const greetings = primary.greetings ?? [];
    setTurns(
      greetings.length > 0
        ? [
            {
              id: crypto.randomUUID(),
              role: "assistant",
              speaker: primary.id,
              content: greetings[0],
              created_at: new Date().toISOString(),
              session_id: ss.id,
            },
          ]
        : []
    );
    const r = await generateRecap(clientRef.current, {
      character_id: primary.id,
      world_id: primary.world_id,
      speaker: "user",
      provider: providerRef.current,
      model: modelRef.current,
    });
    setRecap(r.text);
  }

  async function switchSession(id: string): Promise<void> {
    const meta = sessions.find((s) => s.id === id);
    if (!meta) return;
    const stored = listCharacters();
    const chars = meta.character_ids
      .map((cid) => stored.find((c) => c.id === cid))
      .filter((c): c is Character => !!c);
    if (chars.length === 0) {
      setErrorMsg(`Session "${meta.title}" has no matching characters on this machine.`);
      return;
    }
    setCharacters(chars);
    const prompts: Record<string, string> = {};
    for (const c of chars) prompts[c.id] = c.system_prompt ?? "";
    setSystemPrompts(prompts);
    setScene({
      id: meta.scene_id,
      participants: meta.scene_participants,
      kind: meta.scene_kind,
      created_at: meta.scene_created_at,
    });
    setSessionId(meta.id);
    setAuthorNote(meta.author_note ?? "");
    setGreetingIndex(meta.greeting_index ?? 0);
    setNextSpeakerId(chars[0].id);
    setTurns(loadTurns(meta.id));
    const primary = chars[0];
    generateRecap(clientRef.current, {
      character_id: primary.id,
      world_id: primary.world_id,
      speaker: "user",
      provider: providerRef.current,
      model: modelRef.current,
    }).then((r) => setRecap(r.text));
  }

  function onRenameSession(id: string, title: string) {
    const meta = sessions.find((s) => s.id === id);
    if (!meta) return;
    const next = { ...meta, title };
    saveSessionMeta(next);
    setSessions(listSessions());
  }

  function onDeleteSession(id: string) {
    storeDeleteSession(id);
    setSessions(listSessions());
    if (id === sessionId) {
      setSessionId(null);
      setTurns([]);
      setScene(null);
    }
  }

  function onChangeGreeting(nextIdx: number) {
    if (characters.length === 0) return;
    const primary = characters[0];
    const greetings = primary.greetings ?? [];
    if (!greetings[nextIdx]) return;
    setGreetingIndex(nextIdx);
    // Only swap the opening turn if nothing else has been added yet.
    if (turns.length === 1 && turns[0].role === "assistant") {
      setTurns([{ ...turns[0], content: greetings[nextIdx] }]);
    }
  }

  async function onImportCard(file: File) {
    setErrorMsg(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = await parseCard(bytes);
      const decomposed = await decomposeCard(
        clientRef.current,
        parsed.card,
        parsed.raw_json,
        { session_id: "import", user_id: "user" }
      );
      const char: Character = {
        id: decomposed.character_id,
        name: decomposed.name,
        world_id: decomposed.world_id,
        description: parsed.card.data.description,
        avatar_url: parsed.avatar_url,
        greetings: decomposed.greetings,
        raw_card: parsed.raw_json,
      };
      await addCharacter(char, buildSystemPrompt(parsed.card));
      refreshMemories();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[chronicler] card import failed:", err);
      setErrorMsg(
        `Card import failed: ${msg}. ${
          config.yantrikdb.kind === "mcp"
            ? "Is yantrikdb-mcp running at the configured URL? Check Settings → memory backend."
            : ""
        }`.trim()
      );
    }
  }

  async function loadDemoCharacter(which: "ren" | "mei" = "ren") {
    const cards = {
      ren: {
        spec: "chara_card_v2" as const,
        spec_version: "2.0" as const,
        data: {
          name: "Ren",
          description: "A calm, observant bookseller in a small coastal town.",
          personality: "Quiet, perceptive, dry humor. Listens more than speaks.",
          scenario: "Visit to Ren's second-hand bookshop, The Salt Page.",
          first_mes: "*looks up from the ledger* Found something?",
        },
      },
      mei: {
        spec: "chara_card_v2" as const,
        spec_version: "2.0" as const,
        data: {
          name: "Mei",
          description: "A wandering journalist, Ren's sometimes-visitor.",
          personality: "Curious, warm, asks more questions than she answers.",
          scenario: "Runs into the user in town, always with a notebook.",
          first_mes: "*looks up from her notebook* Oh — hi there.",
        },
      },
    };
    const fakeCard = cards[which];
    const rawJson = JSON.stringify(fakeCard);
    setErrorMsg(null);
    try {
      const decomposed = await decomposeCard(
        clientRef.current,
        fakeCard,
        rawJson,
        { session_id: "import", user_id: "user" }
      );
      const char: Character = {
        id: decomposed.character_id,
        name: fakeCard.data.name,
        world_id: decomposed.world_id,
        description: fakeCard.data.description,
        greetings: decomposed.greetings,
      };
      await addCharacter(char, buildSystemPrompt(fakeCard));
      refreshMemories();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[chronicler] demo load failed:", err);
      setErrorMsg(
        `Demo load failed: ${msg}. ${
          config.yantrikdb.kind === "mcp"
            ? "Is yantrikdb-mcp running at the configured URL? Check Settings → memory backend, or switch to in-memory for a quick smoke test."
            : ""
        }`.trim()
      );
    }
  }

  async function runAssistantTurn(
    baseTurns: ChatTurn[],
    userTurn: ChatTurn | undefined,
    speakerChar: Character,
    opts: {
      skipWrites?: boolean;
      appendTo?: ChatTurn;
      /** When set, add the new generation as a swipe on this turn instead of
       *  creating a new turn. Used by regenerate on the last assistant turn. */
      asSwipeOf?: ChatTurn;
    } = {}
  ): Promise<void> {
    if (!sessionId || !scene) return;
    setThinking(true);
    setStreamingText("");
    try {
      const { assistant_turn, writes_promise } = await orchestrator.turn(
        {
          session_id: sessionId,
          user_id: "user",
          speaker: speakerChar.id,
          user_message: userTurn,
          character: speakerChar,
        },
        systemPrompts[speakerChar.id] ?? "",
        scene,
        {
          skipWrites: opts.skipWrites,
          authorNote: authorNote.trim() ? authorNote : undefined,
          onChunk: (_chunk, accumulated) => setStreamingText(accumulated),
        }
      );
      setLastPromptCapture(orchestrator.getLastPromptCapture());
      if (opts.appendTo) {
        setTurns([
          ...baseTurns.slice(0, -1),
          {
            ...opts.appendTo,
            content: opts.appendTo.content.trimEnd() + " " + assistant_turn.content.trimStart(),
          },
        ]);
      } else if (opts.asSwipeOf) {
        // Regenerate-as-swipe: add the new content to the target turn's
        // swipes list and switch to it, rather than replacing the turn.
        const existing = opts.asSwipeOf;
        const existingSwipes = existing.swipes ?? [existing.content];
        const newSwipes = [...existingSwipes, assistant_turn.content];
        setTurns((ts) =>
          ts.map((t) =>
            t.id === existing.id
              ? {
                  ...t,
                  swipes: newSwipes,
                  swipe_index: newSwipes.length - 1,
                  content: assistant_turn.content,
                  created_at: new Date().toISOString(),
                }
              : t
          )
        );
      } else {
        setTurns([...baseTurns, assistant_turn]);
      }
      refreshMemories();
      if (scene.kind === "group") {
        const idx = characters.findIndex((c) => c.id === speakerChar.id);
        const next = characters[(idx + 1) % characters.length];
        setNextSpeakerId(next.id);
      }
      writes_promise.then(async () => {
        await refreshMemories();
        // After every Nth turn, run think() so conflicts + urges stay fresh
        // without waiting for session end.
        if ((turns.length + 1) % 4 === 0 && characters.length > 0) {
          const ns = `character:${characters[0].id}`;
          await clientRef.current.think(ns).catch(() => undefined);
          await refreshThinkPanel(ns);
        }
      }).catch(() => undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[chronicler] turn failed:", err);
      setErrorMsg(`Turn failed: ${msg}`);
    } finally {
      setThinking(false);
      setStreamingText(undefined);
    }
  }

  // Proactive-speak loop: checks every 15s whether the character should
  // take initiative. Off by default; user enables in Settings.
  useEffect(() => {
    if (!config.proactive_mode || config.proactive_mode === "off") return;
    if (characters.length === 0) return;
    const idleMs = (config.proactive_idle_seconds ?? 180) * 1000;
    const check = async () => {
      const idleFor = Date.now() - lastUserTurnAtRef.current;
      if (thinking) return;
      const gate =
        config.proactive_mode === "passive" ? idleFor >= idleMs : true;
      if (!gate) return;
      const primary = characters[0];
      const trigs = await clientRef.current.triggerPending(
        `character:${primary.id}`
      );
      setTriggers(trigs);
      // Skip redundancy/maintenance triggers — they're memory housekeeping,
      // not character urges. Only let truly urge-ish types drive proactive
      // speaking.
      const urgeKinds = new Set([
        "curiosity",
        "unresolved",
        "emotional",
        "contradiction",
        "unresolved_thread",
      ]);
      const urgeTrigs = trigs.filter((t) => urgeKinds.has(t.trigger_type));
      if (urgeTrigs.length === 0) return;
      const pick = urgeTrigs
        .slice()
        .sort((a, b) => (b.urgency ?? 0) - (a.urgency ?? 0))[0];
      if (!pick) return;
      if (config.proactive_mode === "passive" && (pick.urgency ?? 0) < 0.5)
        return;
      await proactivelySpeak(pick);
      await clientRef.current.triggerAct(pick.id).catch(() => undefined);
      lastUserTurnAtRef.current = Date.now();
    };
    const interval = setInterval(() => void check(), 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.proactive_mode, config.proactive_idle_seconds, characters, thinking]);

  async function onSend(text: string) {
    setErrorMsg(null);
    lastUserTurnAtRef.current = Date.now();
    if (characters.length === 0) {
      setErrorMsg("No character loaded yet. Click 'demo: Ren' or '+ card' first.");
      return;
    }
    if (!sessionId || !scene) {
      setErrorMsg("Session still initializing — wait a moment and try again.");
      return;
    }
    const speakerId = nextSpeakerId ?? characters[0].id;
    const speakerChar = characters.find((c) => c.id === speakerId);
    if (!speakerChar) {
      setErrorMsg(`Speaker "${speakerId}" not found among ${characters.length} characters.`);
      return;
    }
    const userTurn: ChatTurn = {
      id: crypto.randomUUID(),
      role: "user",
      speaker: "user",
      content: text,
      created_at: new Date().toISOString(),
      session_id: sessionId,
    };
    const nextTurns = [...turns, userTurn];
    setTurns(nextTurns);
    await runAssistantTurn(nextTurns, userTurn, speakerChar);
  }

  function onEditMessage(turnId: string, newContent: string) {
    setTurns((ts) =>
      ts.map((t) => (t.id === turnId ? { ...t, content: newContent } : t))
    );
  }

  function onDeleteMessage(turnId: string) {
    setTurns((ts) => ts.filter((t) => t.id !== turnId));
  }

  async function onForkSession(atTurnId: string) {
    if (!sessionId || !scene || characters.length === 0) return;
    const idx = turns.findIndex((t) => t.id === atTurnId);
    if (idx < 0) return;
    const forkTurns = turns.slice(0, idx + 1).map((t) => ({
      ...t,
      id: crypto.randomUUID(), // fresh ids so editing in branch doesn't hit original
    }));
    const forkSessionId = `session-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const now = new Date().toISOString();
    const meta = {
      ...(sessions.find((s) => s.id === sessionId) ?? {
        title: "session",
        character_ids: characters.map((c) => c.id),
        world_id: characters[0].world_id,
        created_at: now,
        preview: "",
        turn_count: forkTurns.length,
        scene_kind: scene.kind,
        scene_participants: scene.participants,
        scene_id: scene.id,
        scene_created_at: scene.created_at,
      }),
      id: forkSessionId,
      title: `${
        sessions.find((s) => s.id === sessionId)?.title ?? "session"
      } ↱ fork`,
      last_at: now,
      turn_count: forkTurns.length,
      preview:
        forkTurns[forkTurns.length - 1]?.content
          .replace(/\s+/g, " ")
          .slice(0, 80) ?? "",
      parent_session_id: sessionId,
      forked_at_turn_id: atTurnId,
      greeting_index: greetingIndex,
      author_note: authorNote,
    } as SessionMeta;
    saveSessionMeta(meta);
    saveTurns(forkSessionId, forkTurns);
    setSessions(listSessions());
    setSessionId(forkSessionId);
    setTurns(forkTurns);
  }

  async function onRegenerate(turnId: string) {
    const idx = turns.findIndex((t) => t.id === turnId);
    if (idx < 0) return;
    const target = turns[idx];
    if (target.role !== "assistant") return;
    const speakerChar = characters.find((c) => c.id === target.speaker);
    if (!speakerChar || !sessionId) return;

    const isLast = idx === turns.length - 1;
    if (isLast) {
      // Preserve prior content as a swipe; generate a new one alongside.
      const before = turns.slice(0, idx);
      const maybeUser =
        before[before.length - 1]?.role === "user"
          ? before[before.length - 1]
          : undefined;
      await runAssistantTurn(before, maybeUser, speakerChar, {
        skipWrites: true,
        asSwipeOf: target,
      });
    } else {
      // Middle-message regen: truncate everything after and replace (ST
      // convention — swipes only make sense for the latest reply).
      const before = turns.slice(0, idx);
      const maybeUser =
        before[before.length - 1]?.role === "user"
          ? before[before.length - 1]
          : undefined;
      setTurns(before);
      await runAssistantTurn(before, maybeUser, speakerChar, { skipWrites: true });
    }
  }

  useKeyboardShortcuts({
    onEscape: () => {
      if (helpOpen) setHelpOpen(false);
      else if (promptInspectorOpen) setPromptInspectorOpen(false);
      else if (settingsOpen) setSettingsOpen(false);
      else if (authorNoteOpen) setAuthorNoteOpen(false);
    },
    onFocusInput: () => {
      const ta = document.querySelector<HTMLTextAreaElement>(
        'textarea[placeholder^="Type a message"]'
      );
      ta?.focus();
    },
    onRegenerateLast: () => {
      const last = [...turns].reverse().find((t) => t.role === "assistant");
      if (last) onRegenerate(last.id);
    },
    onHelp: () => setHelpOpen(true),
  });

  function onSwipeChange(turnId: string, newIndex: number) {
    setTurns((ts) =>
      ts.map((t) => {
        if (t.id !== turnId) return t;
        const s = t.swipes ?? [];
        if (newIndex < 0 || newIndex >= s.length) return t;
        return { ...t, swipe_index: newIndex, content: s[newIndex] };
      })
    );
  }

  async function onContinue(turnId: string) {
    const idx = turns.findIndex((t) => t.id === turnId);
    if (idx < 0) return;
    const target = turns[idx];
    if (target.role !== "assistant") return;
    const speakerChar = characters.find((c) => c.id === target.speaker);
    if (!speakerChar || !sessionId) return;
    await runAssistantTurn(turns, undefined, speakerChar, {
      skipWrites: true,
      appendTo: target,
    });
  }

  async function onForget(rid: string) {
    await clientRef.current.forget(rid);
    refreshMemories();
  }

  async function onPromote(rid: string) {
    await clientRef.current.promoteToCanon(rid, "user_pin");
    refreshMemories();
  }

  async function onDemote(rid: string) {
    await clientRef.current.demoteToHeuristic(rid, "user_demote");
    refreshMemories();
  }

  async function onRetcon(
    rid: string,
    status: import("./lib/yantrikdb/types").CanonicalStatus
  ) {
    await clientRef.current.setCanonicalStatus(rid, status);
    refreshMemories();
  }

  function onExportSession(id: string) {
    const meta = sessions.find((s) => s.id === id);
    if (!meta) return;
    const exportTurns = id === sessionId ? turns : loadTurns(id);
    const storedChars = listCharacters();
    const chars = meta.character_ids
      .map((cid) => storedChars.find((c) => c.id === cid))
      .filter((c): c is Character => !!c);
    const md = exportSessionMarkdown(
      meta,
      exportTurns,
      chars,
      config.user_persona?.name ?? "You"
    );
    const safeTitle =
      meta.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "session";
    const date = new Date(meta.last_at).toISOString().slice(0, 10);
    downloadText(`chronicler-${safeTitle}-${date}.md`, md);
  }

  function onExportBackup() {
    const allSessions = listSessions();
    const bundled = allSessions.map((m) => ({
      meta: m,
      turns: loadTurns(m.id),
    }));
    const backup = buildBackup(config, listCharacters(), bundled);
    const date = new Date().toISOString().slice(0, 10);
    downloadText(
      `chronicler-backup-${date}.json`,
      JSON.stringify(backup, null, 2)
    );
  }

  async function onImportBackup(file: File) {
    setErrorMsg(null);
    try {
      const text = await file.text();
      const backup = parseBackup(text);
      saveConfig(backup.config);
      setConfig(backup.config);
      rebuildRuntime(backup.config);
      for (const c of backup.characters) storeSaveCharacter(c);
      for (const s of backup.sessions) {
        saveSessionMeta(s.meta);
        saveTurns(s.meta.id, s.turns);
      }
      setSessions(listSessions());
      alert(
        `Restored ${backup.characters.length} characters and ${backup.sessions.length} sessions.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Backup import failed: ${msg}`);
    }
  }

  async function onImpersonate(currentDraft: string): Promise<string | null> {
    if (characters.length === 0 || !scene) return null;
    const speakerChar = characters.find((c) => c.id === (nextSpeakerId ?? characters[0].id));
    if (!speakerChar) return null;
    const personaName = config.user_persona?.name ?? "You";
    const personaDesc = config.user_persona?.description ?? "";
    const history = turns
      .slice(-8)
      .map((t) => {
        const label = t.role === "user" ? personaName : speakerChar.name;
        return `${label}: ${t.content}`;
      })
      .join("\n\n");
    const system =
      `You are writing the next message for a USER playing as "${personaName}" in a roleplay scene with "${speakerChar.name}". ` +
      (personaDesc ? `Character info for the user you are playing: ${personaDesc}. ` : "") +
      "Output ONLY the user's next message — no quotes, no meta commentary, no narration headers. " +
      "Keep it natural and in-scene, roughly 1-3 sentences. " +
      (currentDraft
        ? `Continue or rewrite this partial draft:\n${currentDraft}`
        : "Invent a natural next line.");
    try {
      const reply = await providerRef.current.chat({
        model: modelRef.current,
        system,
        messages: [
          {
            role: "user",
            content:
              "SCENE SO FAR (last few turns):\n\n" +
              (history || "(no prior turns yet — open the scene)"),
          },
        ],
        max_tokens: 200,
        sampling: samplingRef.current,
      });
      return reply.content.trim();
    } catch (err) {
      setErrorMsg(
        `Impersonate failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return null;
    }
  }

  const backendLabel =
    config.yantrikdb.kind === "mcp" ? "yantrikdb" : "memory";
  const providerLabel = activeProvider(config)?.label ?? "mock";

  const headerTitle =
    characters.length === 0
      ? "Chronicler"
      : characters.length === 1
      ? characters[0].name
      : characters.map((c) => c.name).join(" & ");

  const headerSubtitle =
    characters.length === 0
      ? "Local-first roleplay with living memory."
      : characters.length === 1
      ? characters[0].description ?? ""
      : `Group scene · ${characters.length} characters`;

  if (view === "library") {
    return (
      <div className="h-screen text-sm">
        <CharacterLibrary
          characters={libraryCharacters}
          sessions={sessions}
          onPickCharacter={(id) => {
            // resume latest session with this character, or start new
            const latest = sessions
              .filter((s) => s.character_ids.includes(id))
              .sort((a, b) => b.last_at.localeCompare(a.last_at))[0];
            if (latest) {
              setView("chat");
              void switchSession(latest.id);
            } else {
              // hydrate into chat + start a new session
              const ch = libraryCharacters.find((c) => c.id === id);
              if (ch) {
                setCharacters([ch]);
                setSystemPrompts((p) => ({
                  ...p,
                  [ch.id]: ch.system_prompt ?? "",
                }));
                setView("chat");
                void startNewSessionForCharacter(ch);
              }
            }
          }}
          onNewSessionFor={(id) => {
            const ch = libraryCharacters.find((c) => c.id === id);
            if (!ch) return;
            setCharacters([ch]);
            setSystemPrompts((p) => ({
              ...p,
              [ch.id]: ch.system_prompt ?? "",
            }));
            setView("chat");
            void startNewSessionForCharacter(ch);
          }}
          onImportFile={(f) => {
            setView("chat");
            void onImportCard(f);
          }}
          onDemo={() => {
            setView("chat");
            void loadDemoCharacter("ren");
          }}
          onDeleteCharacter={(id) => {
            import("./lib/session/store").then(({ deleteCharacter }) => {
              deleteCharacter(id);
              setLibraryCharacters(listCharacters());
            });
          }}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        {settingsOpen && (
          <SettingsPanel
            config={config}
            onClose={() => setSettingsOpen(false)}
            onSave={(cfg) => {
              saveConfig(cfg);
              setConfig(cfg);
              rebuildRuntime(cfg);
            }}
            onExportBackup={onExportBackup}
            onImportBackup={onImportBackup}
          />
        )}
      </div>
    );
  }

  return (
    <div className="grid h-screen grid-cols-[1fr_340px] text-sm">
      <div className="flex flex-col">
        <header className="px-6 py-3 border-b border-neutral-800 bg-neutral-950 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setView("library")}
              title="back to library"
              className="hover:opacity-70 transition-opacity"
            >
              {characters.length === 0 ? (
                <Logo size={28} />
              ) : (
                <Mark size={24} />
              )}
            </button>
            {characters.length > 0 && (
              <div className="min-w-0 max-w-[40ch]">
                <h1 className="text-base font-semibold text-neutral-100 leading-tight truncate">
                  {headerTitle}
                </h1>
                <p
                  className="text-[11px] text-neutral-500 mt-0.5 truncate"
                  title={headerSubtitle}
                >
                  {headerSubtitle}
                </p>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs cursor-pointer text-neutral-400 hover:text-neutral-200 border border-neutral-800 rounded px-2.5 py-1">
              + card
              <input
                type="file"
                accept=".png,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  if (f) onImportCard(f);
                }}
              />
            </label>
            {characters.length === 0 && (
              <button
                className="text-xs rounded bg-emerald-700/80 hover:bg-emerald-600 text-white px-2.5 py-1"
                onClick={() => loadDemoCharacter("ren")}
              >
                demo: Ren
              </button>
            )}
            {characters.length === 1 && characters[0].id.startsWith("ren-") && (
              <button
                className="text-xs rounded bg-emerald-700/80 hover:bg-emerald-600 text-white px-2.5 py-1"
                onClick={() => loadDemoCharacter("mei")}
                title="Add Mei to make this a group scene"
              >
                + Mei (group)
              </button>
            )}
            <button
              className="text-xs rounded border border-neutral-800 hover:border-neutral-700 text-neutral-400 hover:text-neutral-100 px-2.5 py-1"
              onClick={() => setPromptInspectorOpen(true)}
              title="see what was sent to the LLM on the last turn"
            >
              prompt
            </button>
            <button
              className="text-xs rounded border border-neutral-800 hover:border-neutral-700 text-neutral-500 hover:text-neutral-200 w-7 h-7 flex items-center justify-center"
              onClick={() => setHelpOpen(true)}
              title="Keyboard shortcuts (?)"
            >
              ?
            </button>
            <button
              className="text-xs rounded border border-neutral-800 hover:border-neutral-700 text-neutral-400 hover:text-neutral-100 px-2.5 py-1"
              onClick={() => setSettingsOpen(true)}
            >
              settings
            </button>
            <span className="text-[10px] font-mono text-neutral-600">
              [{backendLabel} · {providerLabel}]
            </span>
          </div>
        </header>
        {characters.length > 0 && (
          <div className="border-b border-neutral-800 bg-neutral-950/60">
            <div className="px-6 py-2 flex items-center gap-2 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider text-neutral-500">
                scene
              </span>
              {characters.map((c) => (
                <span
                  key={c.id}
                  className="text-xs px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-200 flex items-center gap-1.5"
                >
                  {c.avatar_url && (
                    <img
                      src={c.avatar_url}
                      alt=""
                      className="w-5 h-5 rounded-full object-cover"
                    />
                  )}
                  {c.name}
                </span>
              ))}
              {characters.length === 1 &&
                (characters[0].greetings?.length ?? 0) > 1 && (
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] uppercase tracking-wider text-neutral-500">
                      greeting
                    </span>
                    <select
                      className="text-xs bg-neutral-900 border border-neutral-800 rounded px-2 py-0.5 text-neutral-200"
                      value={greetingIndex}
                      onChange={(e) =>
                        onChangeGreeting(Number(e.currentTarget.value))
                      }
                    >
                      {characters[0].greetings?.map((_, i) => (
                        <option key={i} value={i}>
                          {i + 1} / {characters[0].greetings?.length}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              {characters.length > 1 && (
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-neutral-500">
                    next to speak
                  </span>
                  <select
                    className="text-xs bg-neutral-900 border border-neutral-800 rounded px-2 py-0.5 text-neutral-200"
                    value={nextSpeakerId ?? ""}
                    onChange={(e) => setNextSpeakerId(e.currentTarget.value)}
                  >
                    {characters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <button
                onClick={() => setAuthorNoteOpen((v) => !v)}
                className={`ml-auto text-[11px] px-2 py-0.5 rounded border ${
                  authorNote.trim()
                    ? "border-amber-700/60 bg-amber-900/20 text-amber-200"
                    : "border-neutral-800 text-neutral-400 hover:text-neutral-200"
                }`}
                title="Author's note — persistent steering for the scene"
              >
                author's note{authorNote.trim() ? " •" : ""}
              </button>
            </div>
            {authorNoteOpen && (
              <div className="px-6 pb-2 pt-0">
                <textarea
                  value={authorNote}
                  onChange={(e) => setAuthorNote(e.currentTarget.value)}
                  placeholder="Steering notes injected every turn, e.g. 'Ren is being more introspective today' or 'use third person narration'"
                  rows={2}
                  className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-xs text-neutral-100 resize-y focus:outline-none focus:border-neutral-600"
                />
              </div>
            )}
          </div>
        )}
        {errorMsg && (
          <div className="px-6 py-2 bg-red-900/60 border-b border-red-700 text-red-100 text-xs flex items-start justify-between gap-4">
            <span className="font-mono">{errorMsg}</span>
            <button
              onClick={() => setErrorMsg(null)}
              className="text-red-200 hover:text-white"
            >
              dismiss
            </button>
          </div>
        )}
        <div className="flex-1 min-h-0">
          {characters.length === 0 ? (
            <EmptyState
              onImport={() => {
                const inp = document.createElement("input");
                inp.type = "file";
                inp.accept = ".png,.json";
                inp.onchange = () => {
                  const f = inp.files?.[0];
                  if (f) onImportCard(f);
                };
                inp.click();
              }}
              onDemo={() => loadDemoCharacter("ren")}
              onOpenSettings={() => setSettingsOpen(true)}
              hasPriorSessions={sessions.length > 0}
            />
          ) : (
            <ChatPane
              turns={turns}
              onSend={onSend}
              isThinking={thinking}
              streamingText={streamingText}
              recap={recap}
              characterName={
                characters.length === 1
                  ? characters[0].name
                  : characters.length > 1
                  ? characters.find((c) => c.id === nextSpeakerId)?.name
                  : undefined
              }
              speakerNames={{
                ...Object.fromEntries(characters.map((c) => [c.id, c.name])),
                user: config.user_persona?.name ?? "You",
              }}
              speakerAvatars={Object.fromEntries(
                characters
                  .filter((c) => c.avatar_url)
                  .map((c) => [c.id, c.avatar_url as string])
              )}
              onEditMessage={onEditMessage}
              onDeleteMessage={onDeleteMessage}
              onRegenerate={onRegenerate}
              onContinue={onContinue}
              onImpersonate={onImpersonate}
              onSwipeChange={onSwipeChange}
              onFork={onForkSession}
            />
          )}
        </div>
      </div>
      <aside className="flex h-full flex-col bg-neutral-950 border-l border-neutral-800 overflow-hidden">
        <SessionList
          sessions={sessions}
          activeId={sessionId ?? undefined}
          characterAvatars={Object.fromEntries(
            libraryCharacters
              .filter((c) => c.avatar_url)
              .map((c) => [c.id, c.avatar_url as string])
          )}
          onSelect={switchSession}
          onNew={startNewSession}
          onDelete={onDeleteSession}
          onRename={onRenameSession}
          onExport={onExportSession}
        />
        <ThinkPanel
          characterName={characters[0]?.name}
          triggers={triggers}
          conflicts={conflicts}
          onActTrigger={onActTrigger}
          onDismissTrigger={onDismissTrigger}
          onResolveConflict={onResolveConflict}
          onRunThink={onRunThink}
          isThinking={runningThink}
        />
        <div className="flex-1 min-h-0">
          <MemoryInspector
            memories={memories}
            onForget={onForget}
            onPromote={onPromote}
            onDemote={onDemote}
            onRetcon={onRetcon}
          />
        </div>
      </aside>
      {settingsOpen && (
        <SettingsPanel
          config={config}
          onClose={() => setSettingsOpen(false)}
          onSave={(cfg) => {
            saveConfig(cfg);
            setConfig(cfg);
            rebuildRuntime(cfg);
          }}
          onExportBackup={onExportBackup}
          onImportBackup={onImportBackup}
        />
      )}
      {promptInspectorOpen && (
        <PromptInspector
          capture={lastPromptCapture}
          onClose={() => setPromptInspectorOpen(false)}
        />
      )}
      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

export default App;
