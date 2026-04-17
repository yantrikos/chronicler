import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { ChatPane } from "./components/Chat/ChatPane";
import {
  MemoryInspector,
  type InspectorMemory,
} from "./components/Inspector/MemoryInspector";
import { PromptInspector } from "./components/Inspector/PromptInspector";
import { SettingsPanel } from "./components/Settings/SettingsPanel";
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
  const [streamingText, setStreamingText] = useState<string | undefined>(undefined);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [authorNote, setAuthorNote] = useState<string>("");
  const [authorNoteOpen, setAuthorNoteOpen] = useState(false);
  const [greetingIndex, setGreetingIndex] = useState<number>(0);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const cfg = loadConfig();
    setConfig(cfg);
    rebuildRuntime(cfg);
    setSessions(listSessions());
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

  function refreshMemories() {
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
    setMemories([]);
  }

  async function addCharacter(char: Character, systemPrompt: string) {
    storeSaveCharacter({ ...char, system_prompt: systemPrompt });
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
      writes_promise.then(() => refreshMemories()).catch(() => undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[chronicler] turn failed:", err);
      setErrorMsg(`Turn failed: ${msg}`);
    } finally {
      setThinking(false);
      setStreamingText(undefined);
    }
  }

  async function onSend(text: string) {
    setErrorMsg(null);
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

  return (
    <div className="grid h-screen grid-cols-[1fr_340px] text-sm">
      <div className="flex flex-col">
        <header className="px-6 py-3 border-b border-neutral-800 bg-neutral-950 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {characters.length === 0 ? (
              <Logo size={28} />
            ) : (
              <Mark size={24} />
            )}
            {characters.length > 0 && (
              <div>
                <h1 className="text-base font-semibold text-neutral-100 leading-tight">
                  {headerTitle}
                </h1>
                <p className="text-[11px] text-neutral-500 mt-0.5">
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
            />
          )}
        </div>
      </div>
      <aside className="flex h-full flex-col bg-neutral-950 border-l border-neutral-800 overflow-hidden">
        <SessionList
          sessions={sessions}
          activeId={sessionId ?? undefined}
          characterAvatars={Object.fromEntries(
            listCharacters()
              .filter((c) => c.avatar_url)
              .map((c) => [c.id, c.avatar_url as string])
          )}
          onSelect={switchSession}
          onNew={startNewSession}
          onDelete={onDeleteSession}
          onRename={onRenameSession}
          onExport={onExportSession}
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
