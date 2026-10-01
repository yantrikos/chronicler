import { limit, setLimitOverrides } from "./lib/limits";
import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { ChatPane } from "./components/Chat/ChatPane";
import {
  MemoryInspector,
  type InspectorMemory,
} from "./components/Inspector/MemoryInspector";
import { PromptInspector } from "./components/Inspector/PromptInspector";
import { BrowseGrimoireModal } from "./components/Grimoire/BrowseModal";
import {
  ThinkPanel,
  type ThinkConflict,
  type ThinkTrigger,
} from "./components/Inspector/ThinkPanel";
import { SettingsPanel } from "./components/Settings/SettingsPanel";
import { CharacterLibrary } from "./components/Library/CharacterLibrary";
import { CharacterEditor } from "./components/Library/CharacterEditor";
import { LorebookEditor } from "./components/Library/LorebookEditor";
import { ChatSearch } from "./components/Chat/ChatSearch";
import { Logo, Mark } from "./components/Brand/Logo";
import { EmptyState } from "./components/Brand/EmptyState";
import { HelpOverlay } from "./components/Brand/HelpOverlay";
import { useKeyboardShortcuts } from "./lib/ui/keyboard";
import { Orchestrator } from "./lib/orchestrator";
import type { Character, ChatTurn, PromptCapture, TurnAttachment } from "./lib/orchestrator/types";
import { VisionDescriber } from "./lib/vision/describe";
import { prepareImage } from "./lib/vision/prepare";
import { putImage } from "./lib/vision/attachments";
import type { DescribeUi } from "./components/Chat/ChatPane";
import { parseCard } from "./lib/cards/parser";
import { decomposeCard, buildSystemPrompt } from "./lib/cards/decompose";
import { YantrikClient } from "./lib/yantrikdb/client";
import { InMemoryTransport } from "./lib/yantrikdb/memory-transport";
import { McpTransport } from "./lib/yantrikdb/mcp-transport";
import type { YantrikDBTransport, RecallResult } from "./lib/yantrikdb/client";
import {
  AnthropicProvider,
  GeminiProvider,
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
import {
  SkillFormer,
  type FormedSkill,
} from "./lib/orchestrator/skill-former";
import { DriftFormer } from "./lib/orchestrator/relationship-drift";
import {
  PreferenceFormer,
  applyUserDisposition,
} from "./lib/orchestrator/preference-former";
import type { InspectorPreference } from "./lib/preferences/types";
import {
  listPreferences,
  updatePreferenceState,
  writePreference,
} from "./lib/preferences/substrate";
import {
  loadCharacterPrefSettings,
  saveCharacterPrefSettings,
  type CharacterPrefSettings,
} from "./lib/preferences/store";
import { PreferenceInspector } from "./components/Inspector/PreferenceInspector";
import { PluginHost } from "./lib/grimoire/host";
import { LocalStorageBackend } from "./lib/grimoire/sdk-runtime";
import { loadInTreePlugins } from "./lib/grimoire/loader";
import {
  loadOutOfTreePlugins,
  subscribeToPluginEvents,
} from "./lib/grimoire/dynamic-loader";
import { McpServerRegistry } from "./lib/mcp/registry";
import type { ToolInvocation } from "./lib/orchestrator/tool-loop";
import {
  loadCharacterGating,
  resolveAllowedTools,
} from "./lib/mcp/character-gating";
import {
  loadCharacterResourceOptIn,
  resolveEnabledResources,
} from "./lib/mcp/resource-opt-in";
import { listCoreTraitsForCharacter } from "./lib/skills/core-trait-promotions";
import { CoreTraitVerifier } from "./lib/skills/core-trait-verifier";
import { CoreTraitPromoter } from "./lib/skills/core-trait-promoter";
import { SelfModelGenerator } from "./lib/identity/self-model-generator";
import { applyEnactments, ensureEnactments, traitKey } from "./lib/identity/trait-enactment";
import { NoModelBar, NO_MODEL_MESSAGE } from "./components/Notices/NoModelBar";
import { LlmGate, gateBackground, gateChat, shouldGate } from "./lib/providers/gate";
import { loadEnactments, saveEnactments } from "./lib/identity/enactment-store";
import {
  loadSelfModel,
  writeSelfModel,
} from "./lib/identity/self-model-substrate";
import type { SelfModel } from "./lib/identity/self-model-types";
import {
  aggregateIdentity,
  type InspectorIdentity,
} from "./lib/identity/aggregator";
import { IdentityInspector } from "./components/Inspector/IdentityInspector";
import { PUBLISHED_BENCHMARK } from "./lib/identity/published-benchmark";
import {
  SkillOutcomeTracker,
  type SkillObservation,
  deriveState,
  decodeNote,
} from "./lib/orchestrator/skill-outcomes";
import type { SkillState } from "./lib/instrumentation/skill-transition-log";
import {
  SkillInspector,
  type InspectorSkill,
} from "./components/Inspector/SkillInspector";
import {
  clearSkillOverride,
  loadSkillOverrides,
  setSkillOverride,
} from "./lib/skills/overrides";
import { PresetPicker } from "./components/Settings/PresetPicker";
import { parseSlash, executeSlash } from "./lib/slash/commands";
import { IntensityPicker } from "./components/Settings/IntensityPicker";
import {
  DEFAULT_INTENSITY_ID,
  INTENSITIES,
  type IntensityId,
} from "./lib/intensity/registry";
import {
  clearIntensitySnippet,
  loadIntensitySnippets,
  saveIntensitySnippet,
} from "./lib/intensity/store";
import {
  FirstRunWizard,
  markWizardDismissed,
  shouldShowWizard,
} from "./components/Onboarding/FirstRunWizard";
import {
  type World,
  deleteWorld as storeDeleteWorld,
  listWorlds,
  newWorldId,
  saveWorld,
} from "./lib/worlds/store";
import { buildStoryCharacter } from "./lib/story/factory";
import { DEMOS, type DemoKey } from "./lib/cards/demos";
import { ThreadsInspector } from "./components/Inspector/ThreadsInspector";
import type { Thread } from "./lib/threads/types";
import {
  type ThreadOverride,
  type ThreadStatus,
  clearThreadOverride,
  isHidden,
  loadThreadOverrides,
  setThreadOverride,
} from "./lib/threads/dismissals";
import { ArcInspector } from "./components/Inspector/ArcInspector";
import { clusterArcs, summarizeActiveArcs } from "./lib/arcs/cluster";
import type { Arc } from "./lib/arcs/types";
import {
  type ArcOverride,
  type ArcOverrideStatus,
  clearArcOverride,
  loadArcOverrides,
  setArcOverride,
} from "./lib/arcs/overrides";
import {
  DEFAULT_PRESET_ID,
  PRESETS,
  resolvePreset,
  samplingMatchesPreset,
  type PresetId,
} from "./lib/sampling/presets";
import { startSession } from "./lib/session/lifecycle";
import { generateRecap } from "./lib/recap/generator";
import { hasStoryHistory } from "./lib/recap/history";
import { ThemeMenu, MoreMenu, SyncBadge } from "./components/Chat/HeaderMenus";
import { SceneHud } from "./components/Chat/SceneHud";
import { SceneTracker } from "./lib/scene/tracker";
import { emptySceneState, renderSceneStatus, type SceneState } from "./lib/scene/state";
import { loadScene, saveScene, clearScene } from "./lib/scene/store";
import { getSyncEngine } from "./lib/storage/sync";
import { ChapterWriter, stepChronicle } from "./lib/story/chronicler";
import { WINDOW, deleteChapter, editChapter, editEarlier, emptyChronicle as emptyStory, historyStart, renderChronicle, resolveCovered, type Chronicle } from "./lib/story/chronicle";
import { loadChronicle, saveChronicle, clearChronicle } from "./lib/story/store";
import { StoryHud } from "./components/Chat/StoryHud";
import { AuditModal } from "./components/Chat/AuditModal";
import { ConsistencyJudge } from "./lib/audit/judge";
import { extractDeclaredTraits } from "./lib/audit/traits";
import { runAudit, type AuditReport } from "./lib/audit/run";
import { loadReport, saveReport, loadTraits, saveTraits } from "./lib/audit/store";
import { LedgerTracker } from "./lib/scene/ledger-tracker";
import { dismiss as dismissDeed, dueDeeds, emptyLedger, markNudged, openDeeds, renderConsequences, type Ledger } from "./lib/scene/ledger";
import { loadLedger, saveLedger } from "./lib/scene/ledger-store";
import { ImageService } from "./lib/images/service";
import { createImageCache } from "./lib/images/cache";
import { ambientFor } from "./lib/images/ambient";
import { proxyPostJson } from "./lib/providers";
import { BEATS, advancePacing, markBeatUsed, pickBeat, turnsUntilBeat, type PacingLevel } from "./lib/scene/pacing";
import {
  activePersona,
  activeProvider,
  providerForRole,
  needsProvider,
  defaultConfig,
  extractionProvider,
  loadConfig,
  saveConfig,
  type ChroniclerConfig,
  type ProviderConfigEntry,
  type UserPersona,
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

/** True for a model server on this machine or the local network — somewhere a
 *  private photo is not leaving the player's own hands. */
function isLocalProvider(p: ProviderConfigEntry): boolean {
  if (p.kind !== "ollama" && p.kind !== "openai-compat") return false;
  const host = (() => {
    try {
      return new URL(p.base_url ?? "http://localhost").hostname;
    } catch {
      return "";
    }
  })();
  return /^(localhost|127\.|\[?::1\]?|host\.docker\.internal|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(host) || host.endsWith(".local");
}

function buildProvider(p: ProviderConfigEntry): LlmProvider {
  if (p.kind === "anthropic") return new AnthropicProvider(p.api_key);
  if (p.kind === "gemini")
    return new GeminiProvider(
      p.api_key,
      p.base_url ?? "https://generativelanguage.googleapis.com/v1beta"
    );
  if (p.kind === "ollama")
    return new OllamaProvider(
      p.base_url ?? "http://host.docker.internal:11434",
      p.label,
      p.disable_thinking ?? false,
      p.context_window
    );
  if (p.kind === "openai-compat")
    return new OpenAICompatProvider(
      p.base_url ?? "https://api.openai.com/v1",
      p.api_key,
      p.label,
      p.disable_thinking ?? false,
      p.thinking_style
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

function buildExtractorFromConfig(cfg: ChroniclerConfig, gate?: LlmGate | null): {
  extractor: Extractor;
  provider_label: string;
} {
  const p = extractionProvider(cfg);
  if (!p || p.kind === "mock")
    return { extractor: new RegexExtractor(), provider_label: "regex-only" };
  const provider = gate ? gateBackground(buildProvider(p), gate) : buildProvider(p);
  return {
    extractor: new HybridExtractor(new LlmExtractor(provider, p.model)),
    provider_label: p.label,
  };
}

function App() {
  const [config, setConfig] = useState<ChroniclerConfig>(defaultConfig);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [promptInspectorOpen, setPromptInspectorOpen] = useState(false);
  const [browseGrimoireOpen, setBrowseGrimoireOpen] = useState(false);
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
  // Aborts the in-flight generation (Stop button / Esc).
  const abortRef = useRef<AbortController | null>(null);
  // Mobile: the inspector column is a slide-over drawer below the lg breakpoint.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [recap, setRecap] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Active scene preset for the current session. Falls back to the app
  // default; null only before the first session loads. Switching a preset
  // overwrites the active provider's sampling fields and persists to
  // SessionMeta.preset_id so the choice survives reloads.
  const [activePresetId, setActivePresetId] = useState<PresetId>(
    DEFAULT_PRESET_ID
  );
  const [presetToast, setPresetToast] = useState<string | null>(null);
  // Scene Intensity (Neutral / Fade to Black / Tasteful / Explicit).
  // Per-session via SessionMeta.intensity_id; app-level default via
  // ChroniclerConfig.default_intensity_id. Defaults to Neutral so
  // existing users see no behavior change.
  const [activeIntensityId, setActiveIntensityId] =
    useState<IntensityId>(DEFAULT_INTENSITY_ID);
  // Per-mode snippet overrides loaded from localStorage. The lookup
  // table is recomputed when a user saves/resets; effective snippet is
  // override > default.
  const intensitySnippetsRef = useRef<Partial<Record<IntensityId, string>>>(
    {}
  );
  const [intensitySnippetsVersion, setIntensitySnippetsVersion] = useState(0);
  /** Lightweight "doing background work" indicator for actions that fire
   *  multi-second async work without an obvious in-place affordance
   *  (demo load, card import, session switch). Null = idle. Shown as a
   *  blocking-style banner at the top of the chat area. */
  const [busyAction, setBusyAction] = useState<string | null>(null);
  // Per-session persona override. null = use the app-level active persona.
  // Setting it via onSwitchPersona persists to SessionMeta.persona_id.
  const [activePersonaId, setActivePersonaId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState<boolean>(false);

  const transportRef = useRef<YantrikDBTransport>(new InMemoryTransport());
  const clientRef = useRef<YantrikClient>(new YantrikClient(transportRef.current));
  const providerRef = useRef<LlmProvider>(new MockProvider());
  const extractorRef = useRef<Extractor>(new RegexExtractor());
  const modelRef = useRef<string>("mock");
  const samplingRef = useRef<
    import("./lib/providers").SamplingOptions | undefined
  >(undefined);
  const personaRef = useRef<UserPersona | undefined>(undefined);
  /** Per-session persona override (id). Wins over config.active_persona_id
   *  when resolving personaRef in rebuildRuntime + onSwitchPersona. */
  const sessionPersonaIdRef = useRef<string | undefined>(undefined);
  const conflictVerifierRef = useRef<ConflictVerifier | null>(null);
  const skillFormerRef = useRef<SkillFormer | null>(null);
  const driftFormerRef = useRef<DriftFormer | null>(null);
  const preferenceFormerRef = useRef<PreferenceFormer | null>(null);
  /** Phase 11 Pillar 1: verifier + promoter for core-trait crystallization.
   *  Built alongside the other formers in rebuildRuntime. Promoter runs
   *  on session-start per character via runCoreTraitPromotion(). */
  const coreTraitVerifierRef = useRef<CoreTraitVerifier | null>(null);
  const coreTraitPromoterRef = useRef<CoreTraitPromoter | null>(null);
  /** Phase 11 Pillar 2: self-model generator + in-memory cache. The
   *  generator runs on session-start alongside the promoter; the cache
   *  feeds per-turn synchronous lookup so the orchestrator opts can
   *  include selfModel without an await. */
  const selfModelGeneratorRef = useRef<SelfModelGenerator | null>(null);
  // Scene status board — location, time, who is present… — kept per session.
  const sceneTrackerRef = useRef<SceneTracker | null>(null);
  const [sceneBoard, setSceneBoard] = useState<SceneState>(emptySceneState);
  const [sceneUpdating, setSceneUpdating] = useState(false);
  const sceneBoardRef = useRef<SceneState>(sceneBoard);
  sceneBoardRef.current = sceneBoard;
  const liveSessionRef = useRef<string | null>(null);
  // Consequence ledger — things the player did that the world may answer.
  const ledgerTrackerRef = useRef<LedgerTracker | null>(null);
  const [ledger, setLedger] = useState<Ledger>(emptyLedger);
  const ledgerRef = useRef<Ledger>(ledger);
  ledgerRef.current = ledger;
  // The chronicle — "the story so far" for chats longer than the recent window.
  const chronicleWriterRef = useRef<ChapterWriter | null>(null);
  const [chronicle, setChronicle] = useState<Chronicle>(emptyStory);
  const chronicleRef = useRef<Chronicle>(chronicle);
  chronicleRef.current = chronicle;
  const [chronicleBusy, setChronicleBusy] = useState(false);
  const chronicleRunning = useRef(false);
  const turnsRef = useRef<ChatTurn[]>([]);
  // Character consistency audit.
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditTraits, setAuditTraits] = useState<string[]>([]);
  const [auditReport, setAuditReport] = useState<AuditReport | null>(null);
  const [auditRunning, setAuditRunning] = useState<{ done: number; total: number } | null>(null);
  const [auditExtracting, setAuditExtracting] = useState(false);
  const auditCancel = useRef(false);
  const charactersRef = useRef<Character[]>([]);
  turnsRef.current = turns;
  charactersRef.current = characters;

  // Optional graphics (all off unless enabled in Settings).
  const imageServiceRef = useRef<ImageService | null>(null);
  if (!imageServiceRef.current) imageServiceRef.current = new ImageService(createImageCache(), proxyPostJson);
  const [generatedPortraits, setGeneratedPortraits] = useState<Record<string, string>>({});
  const generatedPortraitsRef = useRef(generatedPortraits);
  generatedPortraitsRef.current = generatedPortraits;
  const [backdropUrl, setBackdropUrl] = useState<string | null>(null);
  const [imageStatus, setImageStatus] = useState<{ busy: string | null; error?: string }>({ busy: null });
  useEffect(() => {
    liveSessionRef.current = sessionId;
    getSyncEngine()?.pin(sessionId ? `chronicler.session.${sessionId}.turns` : null);
    setSceneBoard(sessionId ? loadScene(sessionId) : emptySceneState());
    setLedger(sessionId ? loadLedger(sessionId) : emptyLedger());
    const stored = sessionId ? loadChronicle(sessionId) : emptyStory();
    chronicleRef.current = stored;
    setChronicle(stored);
    // An existing long chat with no chronicle yet catches up in the background.
    if (sessionId) {
      const t = window.setTimeout(() => void extendChronicle(), 1500);
      return () => window.clearTimeout(t);
    }
  }, [sessionId]);

  // Portraits: one per character without an avatar, generated once and cached.
  useEffect(() => {
    const cfg = config.images;
    if (!cfg?.generate || !cfg.backend?.base_url) return;
    let cancelled = false;
    void (async () => {
      for (const c of characters) {
        if (c.avatar_url || generatedPortraitsRef.current[c.id]) continue;
        setImageStatus({ busy: `portrait of ${c.name}` });
        try {
          const r = await imageServiceRef.current!.portrait({ name: c.name, description: c.description }, cfg);
          if (cancelled) return;
          setGeneratedPortraits((p) => ({ ...p, [c.id]: r.url }));
          setImageStatus({ busy: null });
        } catch (e) {
          if (!cancelled) setImageStatus({ busy: null, error: e instanceof Error ? e.message : String(e) });
          return; // don't hammer a failing backend
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [characters, config.images]);

  // Backdrop: redrawn when the scene moves (location or time of day), debounced.
  useEffect(() => {
    const cfg = config.images;
    if (!cfg?.generate || !cfg.backend?.base_url || !sceneBoard.location) {
      setBackdropUrl(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setImageStatus({ busy: "scene backdrop" });
      imageServiceRef
        .current!.backdrop(sceneBoardRef.current, cfg)
        .then((r) => {
          if (cancelled) return;
          if (r) setBackdropUrl(r.url);
          setImageStatus({ busy: null });
        })
        .catch((e) => {
          if (!cancelled) setImageStatus({ busy: null, error: e instanceof Error ? e.message : String(e) });
        });
    }, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sceneBoard.location, sceneBoard.time, config.images]);

  function redrawBackdrop(): void {
    const cfg = config.images;
    if (!cfg?.generate || !cfg.backend?.base_url) return;
    setImageStatus({ busy: "scene backdrop" });
    imageServiceRef
      .current!.backdrop(sceneBoardRef.current, cfg, undefined, true)
      .then((r) => {
        if (r) setBackdropUrl(r.url);
        setImageStatus({ busy: null });
      })
      .catch((e) => setImageStatus({ busy: null, error: e instanceof Error ? e.message : String(e) }));
  }
  const selfModelByCharacterRef = useRef<Map<string, SelfModel>>(new Map());
  /** Phase 11 Pillar 3: identity inspector view-model. Recomputed when
   *  skills/promotions/self-model change. */
  const [inspectedIdentity, setInspectedIdentity] = useState<InspectorIdentity | null>(null);
  const [isSelfModelRegenerating, setIsSelfModelRegenerating] = useState(false);
  /** Grimoire plugin host. Lives across rebuilds (its state — loaded
   *  plugins, hook registrations, slash commands — survives provider/config
   *  changes). The orchestrator picks it up by ref. */
  const grimoireHostRef = useRef<PluginHost | null>(null);
  /** External MCP server registry — third-party servers users register
   *  for TTS / image gen / dice / web search / etc. Persists configs to
   *  localStorage; clients lazy-connect on first use. */
  const mcpRegistryRef = useRef<McpServerRegistry>(new McpServerRegistry());
  const [grimoireSlashCommands, setGrimoireSlashCommands] = useState<
    { name: string; description: string }[]
  >([]);
  const skillTrackerRef = useRef<SkillOutcomeTracker | null>(null);
  // Per-skill derived state. Populated lazily by the outcome tracker on
  // every record/refresh; consumed by the orchestrator's getSkillState
  // callback to gate prompt surfacing (suppressed/archived → hidden).
  const skillStateRef = useRef<Map<string, SkillState>>(new Map());
  // Which skills were injected into each assistant turn's prompt. The
  // outcome loop scores the skills from the prior assistant turn when the
  // user sends their next message, or when a regenerate / edit / delete
  // signals a negative.
  const promptedSkillsByTurnRef = useRef<Map<string, string[]>>(new Map());
  /** Per-rid why_retrieved hints captured from the most recent turn's
   *  retrieval pass. Surfaces as small chips on memory rows in the
   *  inspector so users can see WHY each memory was recalled. Cleared
   *  on character/session change. */
  const lastWhyRetrievedRef = useRef<Map<string, string[]>>(new Map());
  // Skills formed this session, accumulated in a ref so we can show a count
  // in the header without re-triggering a render on every formation. The
  // Skills tab in Phase 8.3 reads the substrate directly, not this list.
  const formedSkillsRef = useRef<FormedSkill[]>([]);
  const [formedSkillCount, setFormedSkillCount] = useState(0);
  // User overrides for skill state (approve/disable/archive). Loaded once
  // and mutated through helpers that persist to localStorage. Wins over
  // derived state inside getSkillState.
  const skillOverridesRef = useRef<Map<string, SkillState>>(new Map());
  const [inspectedSkills, setInspectedSkills] = useState<InspectorSkill[]>([]);
  const [inspectorTab, setInspectorTab] = useState<string>("memory");
  // Bumps whenever a Grimoire plugin loads/unloads or registers a slot —
  // forces the tab strip + slash autocomplete to re-render. The value
  // itself is referenced below in JSX to make React track it as a dep.
  const [grimoireVersion, setGrimoireVersion] = useState(0);
  void grimoireVersion;
  /** Active character preferences pulled from the preferences:<id>
   *  namespace. Repopulated on character change + after PreferenceFormer
   *  runs. */
  const [inspectedPreferences, setInspectedPreferences] = useState<
    InspectorPreference[]
  >([]);
  /** Per-character preference settings (auto-keep toggles, identity
   *  notes). Localstorage-backed. Keyed by character_id. */
  const characterPrefSettingsRef = useRef<
    Map<string, CharacterPrefSettings>
  >(new Map());
  const [characterPrefSettingsVersion, setCharacterPrefSettingsVersion] =
    useState(0);
  /** Per-character identity notes (manual-only labels: sub/dom/etc).
   *  Localstorage-backed. */
  const identityNotesRef = useRef<Map<string, string>>(new Map());
  /** Last-run formation status, shown beneath the "look for patterns now"
   *  button. Visible feedback so users don't have to open dev console. */
  const [preferenceStatus, setPreferenceStatus] = useState<string | null>(
    null
  );
  /** Open threads — populated by refreshThreads() from the per-character
   *  namespace via client.listThreads(upcoming) + (stale). Renders in the
   *  Threads tab. */
  const [allThreads, setAllThreads] = useState<Thread[]>([]);
  /** Per-thread overrides (dismissed/snoozed/resolved/pinned). Loaded
   *  from localStorage at boot; filtered against allThreads at render. */
  const threadOverridesRef = useRef<Map<string, ThreadOverride>>(new Map());
  const [threadOverridesVersion, setThreadOverridesVersion] = useState(0);
  /** True while the user-triggered formation run is in flight — used by
   *  the Character Development tab's button to show a spinner + disable. */
  const [formationRunning, setFormationRunning] = useState(false);
  /** Arc overrides — same pattern as threads but for cross-session
   *  narrative clusters. Lives in localStorage. */
  const arcOverridesRef = useRef<Map<string, ArcOverride>>(new Map());
  const [arcOverridesVersion, setArcOverridesVersion] = useState(0);
  const [streamingText, setStreamingText] = useState<string | undefined>(undefined);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [authorNote, setAuthorNote] = useState<string>("");
  const [authorNoteDepth, setAuthorNoteDepth] = useState<number>(0);
  const [authorNoteOpen, setAuthorNoteOpen] = useState(false);
  const [greetingIndex, setGreetingIndex] = useState<number>(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [editingCharacterId, setEditingCharacterId] = useState<string | null>(null);
  const [lorebookCharacterId, setLorebookCharacterId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlightTurnId, setHighlightTurnId] = useState<string | undefined>(undefined);
  // Cache of full memory records (populated via memory.get). Avoids re-fetching
  // the same rid on every refresh.
  const metaCacheRef = useRef<Map<string, Record<string, unknown>>>(new Map());
  const [triggers, setTriggers] = useState<ThinkTrigger[]>([]);
  const [conflicts, setConflicts] = useState<ThinkConflict[]>([]);
  const [runningThink, setRunningThink] = useState(false);
  const lastUserTurnAtRef = useRef<number>(Date.now());
  const [view, setView] = useState<"library" | "chat">("chat");
  const [libraryCharacters, setLibraryCharacters] = useState<Character[]>([]);
  const [worlds, setWorlds] = useState<World[]>([]);

  useEffect(() => {
    const cfg = loadConfig();
    setConfig(cfg);
    rebuildRuntime(cfg);
    const sess = listSessions();
    setSessions(sess);
    const chars = listCharacters();
    setLibraryCharacters(chars);
    setWorlds(listWorlds());
    // Land on the library view when there are prior characters and no
    // in-progress chat; jump to chat if nothing imported yet.
    if (chars.length > 0) setView("library");
    // First-run: no real providers + no persona + no characters → wizard.
    if (shouldShowWizard(cfg)) {
      setWizardOpen(true);
    }
  }, []);

  /** Merge a config patch from the wizard and persist. Used at each step
   *  so partial completion still saves what the user provided. */
  function applyWizardPatch(patch: Partial<ChroniclerConfig>): void {
    const next: ChroniclerConfig = { ...config, ...patch };
    setConfig(next);
    saveConfig(next);
    rebuildRuntime(next);
  }

  function dismissWizard(): void {
    markWizardDismissed();
    setWizardOpen(false);
  }

  // -------- Worlds CRUD --------
  // Worlds are shared lorebook containers. The store is localStorage-only;
  // entries themselves live in YantrikDB under `lorebook:<world_id>`.
  function onCreateWorld(): void {
    const name = prompt("Name this world:", "Salt Coast")?.trim();
    if (!name) return;
    const world: World = {
      id: newWorldId(),
      name,
      created_at: new Date().toISOString(),
    };
    saveWorld(world);
    setWorlds(listWorlds());
  }

  function onEditWorld(id: string): void {
    const w = worlds.find((x) => x.id === id);
    if (!w) return;
    const name = prompt("Rename world:", w.name)?.trim();
    if (!name || name === w.name) return;
    saveWorld({ ...w, name });
    setWorlds(listWorlds());
  }

  function onDeleteWorld(id: string): void {
    storeDeleteWorld(id);
    // Cascade: remove this world id from every character's world_ids list
    // so we don't leave dangling references. Characters with no remaining
    // worlds stay, just without the lost world's lorebook.
    const updated = libraryCharacters.map((c) =>
      (c.world_ids ?? []).includes(id)
        ? { ...c, world_ids: (c.world_ids ?? []).filter((w) => w !== id) }
        : c
    );
    for (const c of updated) {
      if (c.world_ids !== libraryCharacters.find((x) => x.id === c.id)?.world_ids) {
        storeSaveCharacter(c);
      }
    }
    setLibraryCharacters(listCharacters());
    setWorlds(listWorlds());
  }

  function onEditWorldLorebook(id: string): void {
    // Reuse the existing LorebookEditor; it accepts any character_id-shaped
    // namespace. We thread a synthetic "character" with the world id so
    // LorebookEditor writes go to lorebook:<world_id>. The editor doesn't
    // care that the id refers to a world; the YantrikDB namespace is just
    // a string.
    setLorebookCharacterId(id);
  }

  /** Spin up a freeform-narrative session — synthesizes a story character
   *  (narrator system prompt + `story` tag) and starts a new session for
   *  it. Story characters live in the regular character library so they
   *  appear in the grid with a `story` chip. */
  async function onStartStory(): Promise<void> {
    const title = prompt("Title this story (optional):", "Untitled story")
      ?.trim();
    if (title === undefined) return; // user cancelled
    const story = buildStoryCharacter({ title: title || undefined });
    storeSaveCharacter(story);
    setLibraryCharacters(listCharacters());
    setCharacters([story]);
    setSystemPrompts((p) => ({ ...p, [story.id]: story.system_prompt ?? "" }));
    setView("chat");
    await startNewSessionForCharacter(story);
  }

  // Persist turns on every change (cheap — localStorage sync, no race).
  useEffect(() => {
    if (!sessionId || !scene) return;
    saveTurns(sessionId, turns);
    if (characters.length > 0) {
      const meta = metaFromScene(sessionId, scene, characters, turns, {
        greeting_index: greetingIndex,
        author_note: authorNote,
        author_note_depth: authorNoteDepth,
        intensity_id: activeIntensityId,
      });
      saveSessionMeta(meta);
      setSessions(listSessions());
    }
  }, [
    turns,
    sessionId,
    scene,
    characters,
    greetingIndex,
    authorNote,
    authorNoteDepth,
    activeIntensityId,
  ]);

  // Refresh the inspector whenever the character roster or session changes.
  // Calling refreshMemories() from inside the import handler would read the
  // stale `characters` closure — useEffect waits until React has flushed
  // the state, so we query the right namespaces.
  useEffect(() => {
    if (characters.length === 0) {
      setInspectedIdentity(null);
      return;
    }
    void refreshMemories();
    void refreshSkills();
    void refreshPreferences();
    void refreshThreads();
    void refreshThinkPanel(`character:${characters[0].id}`);
    // Identity inspector view-model — recomputed from current substrates
    // for the primary character.
    setInspectedIdentity(
      recomputeIdentity(characters[0].id, characters[0].name)
    );
    // Relationship drift runs once per session/character change. The
    // DriftFormer's per-(character, target) cache prevents redundant
    // LLM calls during the same session. To re-evaluate after meaningful
    // new canon, users can switch sessions or reload — telemetry-driven
    // re-trigger cadence is a follow-up.
    void runDriftFormation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characters.map((c) => c.id).join(","), sessionId]);

  function rebuildRuntime(cfg: ChroniclerConfig) {
    setLimitOverrides(cfg.limits); // the limits in Settings → Advanced, applied on load and on every save
    const prev = transportRef.current;
    if (prev instanceof McpTransport) prev.close().catch(() => undefined);
    transportRef.current = buildTransport(cfg);
    clientRef.current = new YantrikClient(transportRef.current);
    const p = activeProvider(cfg);
    const rawProvider = p ? buildProvider(p) : new MockProvider();
    // Chat and background work (fact extraction, scene board, ledger, story summary) share one model
    // server by default. Give chat priority there so a message sent right after a reply isn't stuck
    // behind background calls — on a big, slow model that wait is most of a minute. See providers/gate.ts.
    const gate = shouldGate(p, extractionProvider(cfg), isLocalProvider) ? new LlmGate() : null;
    const provider = gate ? gateChat(rawProvider, gate) : rawProvider;
    providerRef.current = provider;
    modelRef.current = p?.model ?? "mock";
    extractorRef.current = buildExtractorFromConfig(cfg, gate).extractor;

    // Build a conflict verifier using the extraction provider (small/fast)
    // when configured, falling back to the generation provider. Skip for
    // MockProvider — nothing to verify with against.
    const xp = extractionProvider(cfg);
    if (xp && xp.kind !== "mock") {
      const vp = gate ? gateBackground(buildProvider(xp), gate) : buildProvider(xp);
      conflictVerifierRef.current = new ConflictVerifier(vp, xp.model);
      skillFormerRef.current = new SkillFormer(
        clientRef.current,
        vp,
        xp.model
      );
      driftFormerRef.current = new DriftFormer(
        clientRef.current,
        vp,
        xp.model
      );
      preferenceFormerRef.current = new PreferenceFormer(
        clientRef.current,
        vp,
        xp.model
      );
      coreTraitVerifierRef.current = new CoreTraitVerifier(vp, xp.model);
      coreTraitPromoterRef.current = new CoreTraitPromoter(
        clientRef.current,
        coreTraitVerifierRef.current
      );
      selfModelGeneratorRef.current = new SelfModelGenerator(vp, xp.model);
      sceneTrackerRef.current = new SceneTracker(vp, xp.model);
      ledgerTrackerRef.current = new LedgerTracker(vp, xp.model);
      chronicleWriterRef.current = new ChapterWriter(vp, xp.model);
    } else if (p && p.kind !== "mock") {
      conflictVerifierRef.current = new ConflictVerifier(rawProvider, p.model);
      skillFormerRef.current = new SkillFormer(
        clientRef.current,
        rawProvider,
        p.model
      );
      driftFormerRef.current = new DriftFormer(
        clientRef.current,
        rawProvider,
        p.model
      );
      preferenceFormerRef.current = new PreferenceFormer(
        clientRef.current,
        rawProvider,
        p.model
      );
      coreTraitVerifierRef.current = new CoreTraitVerifier(rawProvider, p.model);
      coreTraitPromoterRef.current = new CoreTraitPromoter(
        clientRef.current,
        coreTraitVerifierRef.current
      );
      selfModelGeneratorRef.current = new SelfModelGenerator(rawProvider, p.model);
      sceneTrackerRef.current = new SceneTracker(rawProvider, p.model);
      ledgerTrackerRef.current = new LedgerTracker(rawProvider, p.model);
      chronicleWriterRef.current = new ChapterWriter(rawProvider, p.model);
    } else {
      conflictVerifierRef.current = null;
      skillFormerRef.current = null;
      driftFormerRef.current = null;
      preferenceFormerRef.current = null;
      coreTraitVerifierRef.current = null;
      coreTraitPromoterRef.current = null;
      selfModelGeneratorRef.current = null;
      sceneTrackerRef.current = null;
      ledgerTrackerRef.current = null;
      chronicleWriterRef.current = null;
    }
    // The outcome tracker is provider-independent — it just talks to
    // YantrikDB. Always build it; even in MockProvider mode it correctly
    // no-ops on transport calls.
    skillTrackerRef.current = new SkillOutcomeTracker(clientRef.current);
    skillStateRef.current = new Map();
    promptedSkillsByTurnRef.current = new Map();
    skillOverridesRef.current = loadSkillOverrides();
    threadOverridesRef.current = loadThreadOverrides();
    arcOverridesRef.current = loadArcOverrides();
    intensitySnippetsRef.current = loadIntensitySnippets();

    samplingRef.current = p
      ? {
          temperature: p.temperature,
          top_p: p.top_p,
          top_k: p.top_k,
          min_p: p.min_p,
          repetition_penalty: p.repetition_penalty,
        }
      : undefined;
    // Resolve the effective persona: session override (loaded into
     // sessionPersonaIdRef) wins; falls back to the app-level active.
    const sessionOverride = sessionPersonaIdRef.current
      ? cfg.user_personas?.find((p) => p.id === sessionPersonaIdRef.current)
      : undefined;
    personaRef.current = sessionOverride ?? activePersona(cfg);
    refreshMemories();
  }

  const orchestrator = useMemo(
    () =>
      new Orchestrator({
        client: clientRef.current,
        provider: providerRef.current,
        model: modelRef.current,
        extractor: extractorRef.current,
        // Recent messages the model reads verbatim. With a chronicle, start at the
        // first message no chapter covers (never fewer than the window, never more
        // than window + chunk - 1) so nothing is ever in neither place.
        getRecentTurns: async () => {
          const covered = config.story_summary === false ? 0 : resolveCovered(turns, chronicleRef.current);
          return covered > 0 ? turns.slice(historyStart(turns.length, covered)) : turns.slice(-WINDOW);
        },
        userPersona: personaRef.current,
        sampling: samplingRef.current,
        maxResponseTokens: activeProvider(config)?.max_response_tokens,
        getSkillState: (skill_id) =>
          skillOverridesRef.current.get(skill_id) ??
          skillStateRef.current.get(skill_id),
        grimoire: grimoireHostRef.current ?? undefined,
        mcpRegistry: mcpRegistryRef.current,
      }),
    [turns, config, grimoireSlashCommands]
  );

  // Initialize Grimoire host once. The host's lifecycle is independent of
  // the orchestrator's rebuild cycle — plugins stay loaded across config
  // changes. The orchestrator picks up the host via the closure above.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const host = new PluginHost({
        client: clientRef.current,
        provider: providerRef.current,
        model: modelRef.current,
        storage: new LocalStorageBackend(),
      });
      grimoireHostRef.current = host;
      // Subscribe to host version bumps — when plugins load/unload or
      // register slots, re-read the contribution lists into React state.
      const unsubscribe = host.subscribe(() => {
        if (cancelled) return;
        setGrimoireSlashCommands(
          host.commands.list().map((c) => ({
            name: c.name,
            description: c.description,
          }))
        );
        setGrimoireVersion(host.getVersion());
      });
      try {
        await loadInTreePlugins(host);
      } catch (e) {
        console.warn("[grimoire] in-tree loader failed", e);
      }
      // Load out-of-tree plugins (host's ~/.chronicler/plugins/, mounted
      // into the container). Non-fatal if the server isn't running or
      // the mount is empty.
      try {
        await loadOutOfTreePlugins(host);
      } catch (e) {
        console.warn("[grimoire] out-of-tree initial load failed", e);
      }
      const unsubscribePluginEvents = subscribeToPluginEvents(host);
      if (cancelled) {
        unsubscribe();
        unsubscribePluginEvents();
        return;
      }
      setGrimoireSlashCommands(
        host.commands.list().map((c) => ({
          name: c.name,
          description: c.description,
        }))
      );
      setGrimoireVersion(host.getVersion());
      // Tee both unsubscribes so the cleanup function below can call them.
      (host as unknown as {
        __unsubscribe?: () => void;
        __unsubscribePluginEvents?: () => void;
      }).__unsubscribe = unsubscribe;
      (host as unknown as {
        __unsubscribePluginEvents?: () => void;
      }).__unsubscribePluginEvents = unsubscribePluginEvents;
    })();
    return () => {
      cancelled = true;
      const h = grimoireHostRef.current;
      if (h) {
        const x = h as unknown as {
          __unsubscribe?: () => void;
          __unsubscribePluginEvents?: () => void;
        };
        if (x.__unsubscribe) x.__unsubscribe();
        if (x.__unsubscribePluginEvents) x.__unsubscribePluginEvents();
        void h.unloadAll();
      }
      grimoireHostRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Invoke a Grimoire slash command from the chat input. SlashResult is
   *  rendered as a synthetic system-role turn so the user sees it in the
   *  chat history. Errors get a distinct visual treatment via the role. */
  async function onSlashCommand(name: string, args: string): Promise<void> {
    const host = grimoireHostRef.current;
    if (!host) {
      console.warn("[grimoire] no host available for /" + name);
      return;
    }
    const result = await host.triggerCommand(name, args);
    if (!result) return;
    // Build a system turn so the result appears in the chat history.
    const synthetic: ChatTurn = {
      id: crypto.randomUUID(),
      role: "system",
      speaker: result.kind === "error" ? "system:error" : "system:slash",
      content:
        result.kind === "error"
          ? `⚠ ${result.content}`
          : result.content,
      created_at: new Date().toISOString(),
      session_id: sessionId ?? "no-session",
    };
    setTurns((prev) => [...prev, synthetic]);
  }

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

      // Skill formation runs in the background — YantrikDB's pattern /
      // lesson / unresolved / contradiction triggers are the inputs.
      // The former caches per trigger_id so re-entry is free; we don't
      // need to await its completion to render the panel.
      void runSkillFormation(ns, trigs);
    } catch {
      // non-fatal
    }
  }

  /** Feed skill-candidate triggers through the LLM verifier and persist
   *  confirmed skills to YantrikDB's skill substrate. Non-blocking, cached. */
  async function runSkillFormation(
    namespaceArg: string,
    trigs: ThinkTrigger[]
  ): Promise<void> {
    const former = skillFormerRef.current;
    if (!former) return; // mock provider mode — skip
    const characterId = namespaceArg.startsWith("character:")
      ? namespaceArg.slice("character:".length)
      : null;
    if (!characterId) return;
    const candidateKinds = new Set([
      "pattern",
      "lesson",
      "unresolved",
      "contradiction",
    ]);
    const candidates = trigs
      .filter((t) => candidateKinds.has(t.trigger_type))
      .map((t) => ({
        trigger_id: t.id,
        reason: t.reason,
        source_rids: t.source_rids,
        character_id: characterId,
        character_name: characters.find((c) => c.id === characterId)?.name,
      }));
    if (candidates.length === 0) return;
    try {
      const formed = await former.formFromCandidates(candidates);
      if (formed.length > 0) {
        const seen = new Set(formedSkillsRef.current.map((s) => s.skill_id));
        const fresh = formed.filter((s) => !seen.has(s.skill_id));
        if (fresh.length > 0) {
          formedSkillsRef.current = [...formedSkillsRef.current, ...fresh];
          setFormedSkillCount(formedSkillsRef.current.length);
          // New skills landed — pull the catalog so the inspector tab
          // reflects them without waiting for the user to open it.
          void refreshSkills();
        }
      }
    } catch {
      // verifier failures are already swallowed inside the former
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

  /** Pull the active character's skill catalog from YantrikDB, derive
   *  state per skill (overrides win), populate both the inspector view
   *  and skillStateRef which the pipeline uses to gate prompt surfacing. */
  async function refreshSkills(): Promise<void> {
    if (characters.length === 0) {
      setInspectedSkills([]);
      return;
    }
    const client = clientRef.current;
    const now = new Date();
    const out: InspectorSkill[] = [];
    for (const char of characters) {
      const list = await client
        .skillList({ applies_to: [char.id], limit: 100 })
        .catch(() => [] as Awaited<ReturnType<typeof client.skillList>>);
      for (const s of list) {
        // Substrate's `list` doesn't return outcomes — pull them via `get`
        // to derive state. Cap the requests; in practice a session has
        // dozens of skills, not hundreds.
        const full = await client.skillGet(s.skill_id).catch(() => null);
        const outcomes = (full?.outcomes ?? []) as Array<{
          succeeded: boolean;
          note?: string;
          at: string;
        }>;
        const successes = outcomes.filter((o) => o.succeeded).length;
        // Drop outcomes that don't carry our encoded note — they didn't
        // come from Chronicler's tracker and shouldn't drive transitions.
        const trackedOutcomes = outcomes.filter((o) => decodeNote(o.note));
        const derived = deriveState(trackedOutcomes, now, "candidate");
        const override = skillOverridesRef.current.get(s.skill_id);
        const finalState: SkillState = override ?? derived;
        skillStateRef.current.set(s.skill_id, derived);
        out.push({
          skill_id: s.skill_id,
          body: s.body,
          skill_type: s.skill_type,
          applies_to: s.applies_to,
          state: finalState,
          uses: outcomes.length,
          successes,
        });
      }
    }
    // Sort active first, then candidate, then suppressed/archived. Within
    // each group, most-used first.
    const order: Record<SkillState, number> = {
      core_trait: 0,
      active: 1,
      candidate: 2,
      suppressed: 3,
      archived: 4,
    };
    out.sort(
      (a, b) => order[a.state] - order[b.state] || b.uses - a.uses
    );
    setInspectedSkills(out);
  }

  function onSkillApprove(skill_id: string): void {
    skillOverridesRef.current = setSkillOverride(skill_id, "active");
    setInspectedSkills((ss) =>
      ss.map((s) => (s.skill_id === skill_id ? { ...s, state: "active" } : s))
    );
  }
  function onSkillDisable(skill_id: string): void {
    skillOverridesRef.current = setSkillOverride(skill_id, "suppressed");
    setInspectedSkills((ss) =>
      ss.map((s) =>
        s.skill_id === skill_id ? { ...s, state: "suppressed" } : s
      )
    );
  }
  function onSkillArchive(skill_id: string): void {
    skillOverridesRef.current = setSkillOverride(skill_id, "archived");
    setInspectedSkills((ss) =>
      ss.map((s) =>
        s.skill_id === skill_id ? { ...s, state: "archived" } : s
      )
    );
  }

  /** Phase 11 Pillar 3 — identity inspector handlers. Disabling a core
   *  trait keeps the YantrikDB substrate intact but writes a
   *  `suppressed` override so deriveCoreTraitsForCharacter skips it on
   *  injection. Re-enabling clears the override. */
  function onDisableCoreTrait(skill_id: string): void {
    skillOverridesRef.current = setSkillOverride(skill_id, "suppressed");
    setInspectedIdentity((id) => (id ? recomputeIdentity(id.character_id, id.character_name) : id));
  }
  function onEnableCoreTrait(skill_id: string): void {
    skillOverridesRef.current = clearSkillOverride(skill_id);
    setInspectedIdentity((id) => (id ? recomputeIdentity(id.character_id, id.character_name) : id));
  }

  /** Manual regeneration trigger from the inspector. Fires the same
   *  formation runner as session-start with manualRefresh: true. */
  async function onRegenerateSelfModel(): Promise<void> {
    if (isSelfModelRegenerating) return;
    setIsSelfModelRegenerating(true);
    try {
      await runSelfModelFormation({ manualRefresh: true });
      if (characters[0]) {
        const updated = recomputeIdentity(characters[0].id, characters[0].name);
        setInspectedIdentity(updated);
      }
    } finally {
      setIsSelfModelRegenerating(false);
    }
  }

  function recomputeIdentity(
    characterId: string,
    characterName: string
  ): InspectorIdentity {
    const disabled = new Set<string>();
    for (const [skill_id, state] of skillOverridesRef.current) {
      if (state === "suppressed" || state === "archived") disabled.add(skill_id);
    }
    return aggregateIdentity({
      character_id: characterId,
      character_name: characterName,
      self_model: selfModelByCharacterRef.current.get(characterId) ?? null,
      skills: inspectedSkills,
      disabled_skill_ids: disabled,
    });
  }

  /** Number of crystallized core traits for the primary character —
   *  used by the inspector tab strip badge. */
  const identityCoreTraitCount = inspectedIdentity?.core_traits.length ?? 0;
  function onSkillClearOverride(skill_id: string): void {
    skillOverridesRef.current = clearSkillOverride(skill_id);
    const derived = skillStateRef.current.get(skill_id) ?? "candidate";
    setInspectedSkills((ss) =>
      ss.map((s) => (s.skill_id === skill_id ? { ...s, state: derived } : s))
    );
  }

  // -------- Open Threads --------
  /** Pull upcoming + stale memories for every active character and unify
   *  into a single Thread[] for the inspector. Falls back to empty on
   *  transport errors; the inspector renders an empty state cleanly. */
  async function refreshThreads(): Promise<void> {
    if (characters.length === 0) {
      setAllThreads([]);
      return;
    }
    const client = clientRef.current;
    try {
      const batches = await Promise.all(
        characters.flatMap((c) => [
          client.listThreads(`character:${c.id}`, "upcoming", { limit: 20 }),
          client.listThreads(`character:${c.id}`, "stale", {
            days: 14,
            limit: 20,
          }),
        ])
      );
      const seen = new Set<string>();
      const out: Thread[] = [];
      for (const batch of batches) {
        for (const t of batch) {
          if (seen.has(t.id)) continue;
          seen.add(t.id);
          out.push(t);
        }
      }
      // Stable order: pinned first, then stale, then upcoming, importance desc.
      const overrides = threadOverridesRef.current;
      out.sort((a, b) => {
        const ap = overrides.get(a.id)?.status === "pinned" ? 0 : 1;
        const bp = overrides.get(b.id)?.status === "pinned" ? 0 : 1;
        if (ap !== bp) return ap - bp;
        if (a.kind !== b.kind) return a.kind === "stale" ? -1 : 1;
        return (b.importance ?? 0) - (a.importance ?? 0);
      });
      setAllThreads(out);
    } catch {
      setAllThreads([]);
    }
  }

  function onThreadAction(
    id: string,
    status: ThreadStatus,
    untilIso?: string
  ): void {
    threadOverridesRef.current = setThreadOverride(id, status, {
      until: untilIso,
    });
    setThreadOverridesVersion((v) => v + 1);
  }

  function onThreadClearOverride(id: string): void {
    threadOverridesRef.current = clearThreadOverride(id);
    setThreadOverridesVersion((v) => v + 1);
  }

  function onArcAction(id: string, status: ArcOverrideStatus): void {
    arcOverridesRef.current = setArcOverride(id, status);
    setArcOverridesVersion((v) => v + 1);
  }

  function onArcClearOverride(id: string): void {
    arcOverridesRef.current = clearArcOverride(id);
    setArcOverridesVersion((v) => v + 1);
  }

  // -------- Scene Intensity --------
  /** Resolve the effective snippet for the given intensity: user
   *  override (from localStorage) wins over registry default. Returns
   *  the empty string for Neutral or when the override is the empty
   *  string (which signals "user explicitly cleared it"). */
  function effectiveIntensitySnippet(id: IntensityId): string {
    const override = intensitySnippetsRef.current[id];
    if (override !== undefined) return override;
    return INTENSITIES[id].default_snippet;
  }
  /** True iff the user has NOT overridden the snippet for this mode
   *  (i.e. effective === default). Drives the "reset to default"
   *  affordance in the picker. */
  function isIntensityDefault(id: IntensityId): boolean {
    return intensitySnippetsRef.current[id] === undefined;
  }
  function onIntensitySelect(id: IntensityId): void {
    setActiveIntensityId(id);
    // Also persist as the app-level default so newly-created sessions
    // start with the user's most recent choice. Per-session value is
    // captured by the existing useEffect that watches activeIntensityId.
    const next: ChroniclerConfig = {
      ...config,
      default_intensity_id: id,
    };
    setConfig(next);
    saveConfig(next);
  }
  function onIntensitySaveSnippet(id: IntensityId, snippet: string): void {
    saveIntensitySnippet(id, snippet);
    intensitySnippetsRef.current = loadIntensitySnippets();
    setIntensitySnippetsVersion((v) => v + 1);
  }
  function onIntensityResetSnippet(id: IntensityId): void {
    clearIntensitySnippet(id);
    intensitySnippetsRef.current = loadIntensitySnippets();
    setIntensitySnippetsVersion((v) => v + 1);
  }

  /** Manual "look for patterns now" — runs think() on the active
   *  character's namespace then the full skill + drift formation
   *  pipeline. Used from the Character Development tab when prior
   *  memory exists but no skills have surfaced (the auto-cadence is
   *  every-4-turns + on-session-end; existing data hasn't seen it). */
  async function onRunFormationNow(): Promise<void> {
    if (characters.length === 0 || formationRunning) return;
    setFormationRunning(true);
    setBusyAction("Looking for patterns in this character's memory…");
    const client = clientRef.current;
    const primary = characters[0];
    try {
      await client
        .think(`character:${primary.id}`)
        .catch(() => undefined);
      // refreshThinkPanel populates the trigger list which runSkillFormation
      // then consumes. runDriftFormation + runPreferenceFormation pull canon
      // directly.
      await refreshThinkPanel(`character:${primary.id}`);
      await runDriftFormation();
      await runPreferenceFormation();
      await runCoreTraitPromotion();
      await refreshSkills();
      // Self-model regenerates AFTER core traits + refreshed skills land —
      // core_trait promotions are its primary input, and we read trait
      // bodies from the inspectedSkills list inside the formation runner.
      await runSelfModelFormation();
      await refreshPreferences();
    } finally {
      setFormationRunning(false);
      setBusyAction(null);
    }
  }

  /** Pull recent canon + scene reflex tagged with character_id, run the
   *  preference verifier. Confirmed preferences write to the
   *  preferences:<id> substrate. Settings.auto_keep_ordinary controls
   *  whether new ordinary interpretations auto-activate; private +
   *  limit always start as candidate. */
  async function runPreferenceFormation(): Promise<void> {
    const former = preferenceFormerRef.current;
    if (!former) {
      const msg =
        "Formation skipped — no verifier provider configured. " +
        "Open settings and add an extraction or generation provider.";
      console.warn("[prefs] " + msg);
      setPreferenceStatus(msg);
      return;
    }
    if (characters.length === 0) {
      console.warn("[prefs] formation skipped — no character loaded");
      return;
    }
    // Drop cached verifier output so a re-click actually re-asks the LLM.
    // Without this, an earlier empty result would stick across clicks.
    for (const c of characters) former.invalidate(c.id);
    const statusParts: string[] = [];
    const client = clientRef.current;
    for (const char of characters) {
      const settings = getCharSettings(char.id);
      // Pull memories by namespace using memory.list — no semantic query
      // needed. (Earlier attempt with recall(query: "") returned 0 because
      // yantrikdb rejects empty queries. listMemoriesInNamespace is the
      // right primitive here: namespace-scoped + recency-ordered.)
      const [charRows, sessionRows] = await Promise.all([
        client.listMemoriesInNamespace(`character:${char.id}`, 60).catch((e) => {
          console.warn("[prefs] character list failed", e);
          return [] as RecallResult[];
        }),
        sessionId
          ? client.listMemoriesInNamespace(`session:${sessionId}`, 60).catch((e) => {
              console.warn("[prefs] session list failed", e);
              return [] as RecallResult[];
            })
          : Promise.resolve([] as RecallResult[]),
      ]);
      const seen = new Set<string>();
      const merged: RecallResult[] = [];
      for (const r of charRows) {
        if (seen.has(r.rid)) continue;
        seen.add(r.rid);
        merged.push(r);
      }
      for (const r of sessionRows) {
        if (seen.has(r.rid)) continue;
        seen.add(r.rid);
        merged.push(r);
      }
      console.log(
        `[prefs] ${char.name}: char_ns=${charRows.length} session_ns=${sessionRows.length} merged=${merged.length}`
      );
      if (merged.length < 2) {
        const msg = `${char.name}: no memories to analyze yet`;
        console.log(`[prefs] ${msg}`);
        statusParts.push(msg);
        continue;
      }
      try {
        const formed = await former.formFromCandidate(
          {
            character_id: char.id,
            character_name: char.name,
            session_id: sessionId ?? "no-session",
            recent_memories: merged,
          },
          settings
        );
        const visible = formed.filter(
          (f) => f.preference.interpretation_level !== "observation"
        ).length;
        console.log(
          `[prefs] ${char.name}: verifier formed ${formed.length} (${visible} visible, ${formed.length - visible} observations are hidden)`
        );
        if (formed.length === 0) {
          statusParts.push(
            `${char.name}: scanned ${merged.length} memories, verifier produced 0 candidates (see console for raw LLM output)`
          );
        } else if (visible === 0) {
          statusParts.push(
            `${char.name}: verifier produced ${formed.length} observations only (UI hides observations; ${merged.length} memories scanned)`
          );
        } else {
          statusParts.push(
            `${char.name}: ${visible} new preference${visible === 1 ? "" : "s"} surfaced`
          );
        }
      } catch (e) {
        console.warn(`[prefs] ${char.name}: verifier threw`, e);
        statusParts.push(`${char.name}: verifier failed — see console`);
      }
    }
    setPreferenceStatus(statusParts.join(" · "));
  }

  /** Fetch the per-character settings, lazily initializing from
   *  localStorage on first read. */
  function getCharSettings(character_id: string): CharacterPrefSettings {
    let s = characterPrefSettingsRef.current.get(character_id);
    if (!s) {
      s = loadCharacterPrefSettings(character_id);
      characterPrefSettingsRef.current.set(character_id, s);
    }
    return s;
  }

  /** Phase 11 Pillar 2: hydrate the in-memory self-model cache for
   *  every active character from YantrikDB, then check each against
   *  the generator's needsRefresh predicate. Regenerate + persist when
   *  the inputs have shifted or the weekly refresh window elapsed.
   *  Failures are logged; the cache keeps the prior model so per-turn
   *  injection doesn't break on generation errors. */
  async function runSelfModelFormation(
    opts: { manualRefresh?: boolean } = {}
  ): Promise<void> {
    const generator = selfModelGeneratorRef.current;
    if (!generator || characters.length === 0) return;
    const client = clientRef.current;
    for (const char of characters) {
      try {
        const existing = await loadSelfModel(client, char.id);
        if (existing) selfModelByCharacterRef.current.set(char.id, existing);

        const coreTraits = listCoreTraitsForCharacter(char.id).map((p) => {
          const skill = inspectedSkills.find(
            (s) => s.skill_id === p.skill_id
          );
          return {
            skill_id: p.skill_id,
            body: skill?.body ?? "",
            rank: p.promotion.rank,
          };
        });
        // Without crystallized traits the self-model has no anchor — skip
        // until Pillar 1 lands for this character.
        if (coreTraits.length === 0) continue;

        const inputs = {
          character_id: char.id,
          character_name: char.name,
          core_traits: coreTraits.filter((t) => t.body.length > 0),
          canon_excerpts: [] as string[],
          drift_summary: "",
          active_preferences:
            derivePromptedPreferences(char.id)?.ordinary ?? [],
        };

        const needs = await generator.needsRefresh(existing, inputs, {
          manualRefresh: opts.manualRefresh,
        });
        if (!needs) continue;

        const generated = await generator.generate(inputs);
        if (!generated) {
          console.warn(
            `[self-model] ${char.name}: generation returned null (LLM error or non-first-person output)`
          );
          continue;
        }
        await writeSelfModel(client, generated);
        selfModelByCharacterRef.current.set(char.id, generated);
        console.log(
          `[self-model] ${char.name}: generated ${generated.header.paragraph_count}-paragraph self-model`
        );
      } catch (e) {
        console.warn(`[self-model] ${char.name} formation failed`, e);
      }
    }
  }

  /** Phase 11 Pillar 2: per-turn lookup. Reads from the in-memory cache
   *  hydrated by runSelfModelFormation. No-op when no model exists. */
  function deriveSelfModelForCharacter(
    characterId: string
  ): string | undefined {
    const model = selfModelByCharacterRef.current.get(characterId);
    const body = model?.body?.trim();
    return body && body.length > 0 ? body : undefined;
  }

  /** Phase 11 Pillar 1: run the core-trait promotion sweep for every
   *  active character. Promotes eligible active skills to `core_trait`
   *  and demotes any whose success rate has decayed. Non-blocking;
   *  failures are logged but don't surface. */
  async function runCoreTraitPromotion(): Promise<void> {
    const promoter = coreTraitPromoterRef.current;
    if (!promoter || characters.length === 0) return;
    for (const char of characters) {
      try {
        const result = await promoter.run({
          character_id: char.id,
          character_name: char.name,
        });
        if (result.promoted.length > 0 || result.demoted.length > 0) {
          console.log(
            `[core-traits] ${char.name}: ${result.promoted.length} crystallized, ` +
              `${result.demoted.length} demoted, ${result.rejected.length} rejected ` +
              `(${result.skipped_quantitative} skipped by criteria)`
          );
        }
      } catch (e) {
        console.warn(`[core-traits] ${char.name} promotion failed`, e);
      }
    }
  }

  async function refreshPreferences(): Promise<void> {
    if (characters.length === 0) {
      setInspectedPreferences([]);
      return;
    }
    const client = clientRef.current;
    const all: InspectorPreference[] = [];
    for (const char of characters) {
      const prefs = await listPreferences(client, char.id).catch(() => []);
      all.push(...prefs);
    }
    // Sort: limits first (within their group), then by recency.
    const sensOrder = { limit: 0, private: 1, ordinary: 2 } as const;
    all.sort((a, b) => {
      const s =
        (sensOrder[a.sensitivity] ?? 9) - (sensOrder[b.sensitivity] ?? 9);
      if (s !== 0) return s;
      return b.created_at.localeCompare(a.created_at);
    });
    setInspectedPreferences(all);
  }

  function onPreferenceKeep(pref: InspectorPreference): void {
    const client = clientRef.current;
    void applyUserDisposition(
      client,
      preferenceFormerRef.current!,
      pref,
      "kept",
      pref.character_id
    ).then(() => refreshPreferences());
  }
  function onPreferenceDismiss(pref: InspectorPreference): void {
    const client = clientRef.current;
    void applyUserDisposition(
      client,
      preferenceFormerRef.current!,
      pref,
      "dismissed",
      pref.character_id
    ).then(() => refreshPreferences());
  }
  async function onPreferenceEdit(
    pref: InspectorPreference,
    newStatement: string
  ): Promise<void> {
    const trimmed = newStatement.trim();
    if (!trimmed || trimmed === pref.statement) return;
    // Edit = rewrite as new preference + dismiss old. Keeps the
    // dedup-by-id invariant clean.
    const client = clientRef.current;
    await updatePreferenceState(client, pref.rid, "dismissed", {
      characterId: pref.character_id,
    });
    await writePreference(client, {
      ...pref,
      id: undefined as unknown as string, // let writePreference recompute
      statement: trimmed,
      state: "active", // user-edited → user-confirmed
      created_at: new Date().toISOString(),
    });
    await refreshPreferences();
  }
  function onIdentityNotesChange(characterId: string, notes: string): void {
    identityNotesRef.current.set(characterId, notes);
    try {
      localStorage.setItem(
        `chronicler.identity_notes_v1.${characterId}`,
        notes
      );
    } catch {
      /* skip */
    }
  }
  function onCharacterPrefSettingsChange(
    characterId: string,
    next: CharacterPrefSettings
  ): void {
    characterPrefSettingsRef.current.set(characterId, next);
    saveCharacterPrefSettings(characterId, next);
    setCharacterPrefSettingsVersion((v) => v + 1);
  }
  /** Split the character's active preferences into the three buckets
   *  the orchestrator's anti-confab block expects. ONLY state=active
   *  rows reach the prompt — observed/candidate/dismissed are inspector-
   *  only. The trailing "tendencies not rules" instruction is appended
   *  by withAntiConfabulation when any bucket has content. */
  /** Phase 11 Pillar 1: pull the character's crystallized core traits
   *  ranked highest first, capped at TOP_K (7 — Miller's number). Bodies
   *  are fetched live from `inspectedSkills` since the skill list is the
   *  authoritative source; the promotions map only carries the verifier
   *  verdict + rank + crystallization metadata. */
  function deriveCoreTraitsForCharacter(
    characterId: string,
    /** `enact`: for the PROMPT only — add each trait's "On the page:" line when
     *  one has been made. The consistency audit calls this without it and must
     *  keep seeing the plain traits. */
    opts?: { enact?: boolean }
  ): string[] | undefined {
    const TOP_K = 7;
    const promotions = listCoreTraitsForCharacter(characterId);
    if (promotions.length === 0) return undefined;
    const skillsById = new Map(
      inspectedSkills.map((s) => [s.skill_id, s.body])
    );
    const traits: string[] = [];
    for (const p of promotions) {
      const body = skillsById.get(p.skill_id);
      if (body && body.length > 0) traits.push(body);
      if (traits.length >= TOP_K) break;
    }
    if (traits.length === 0) return undefined;
    return opts?.enact ? applyEnactments(traits, loadEnactments()) : traits;
  }

  function derivePromptedPreferences(
    characterId: string
  ): { ordinary: string[]; private: string[]; limits: string[] } | undefined {
    const active = inspectedPreferences.filter(
      (p) => p.character_id === characterId && p.state === "active"
    );
    if (active.length === 0) return undefined;
    const buckets = {
      ordinary: [] as string[],
      private: [] as string[],
      limits: [] as string[],
    };
    for (const p of active) {
      const bucket =
        p.sensitivity === "limit" ? "limits" : (p.sensitivity as "ordinary" | "private");
      buckets[bucket].push(p.statement);
    }
    if (
      buckets.ordinary.length === 0 &&
      buckets.private.length === 0 &&
      buckets.limits.length === 0
    ) {
      return undefined;
    }
    return buckets;
  }

  function safeJson(v: unknown): string {
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }

  /** Render an MCP tool invocation as a chat-bubble markdown block. The
   *  format is intentionally compact: the qualified tool name + a result
   *  preview. Image/audio results use markdown so the existing renderer
   *  picks them up. */
  function renderToolInvocation(inv: ToolInvocation): string {
    const headline = `🔧 **${inv.qualifiedName}** _(${inv.durationMs}ms)_`;
    const argLine = Object.keys(inv.args).length > 0
      ? `\n\n\`\`\`json\n${JSON.stringify(inv.args, null, 2)}\n\`\`\``
      : "";
    switch (inv.result.kind) {
      case "text":
        return `${headline}${argLine}\n\n${inv.result.text}`;
      case "image":
        return `${headline}${argLine}\n\n![${inv.toolName}](${inv.result.url})`;
      case "audio":
        return `${headline}${argLine}\n\n[audio: ${inv.result.url}](${inv.result.url})`;
      case "json":
        return `${headline}${argLine}\n\n\`\`\`json\n${safeJson(inv.result.data)}\n\`\`\``;
      case "error":
        return `${headline}${argLine}\n\n⚠ ${inv.result.message}`;
    }
  }

  function loadIdentityNotes(characterId: string): string {
    let cached = identityNotesRef.current.get(characterId);
    if (cached !== undefined) return cached;
    try {
      const raw = localStorage.getItem(
        `chronicler.identity_notes_v1.${characterId}`
      );
      cached = raw ?? "";
    } catch {
      cached = "";
    }
    identityNotesRef.current.set(characterId, cached);
    return cached;
  }

  /** Pull recent canon for each active character and run the relationship
   *  drift verifier. Confirmed drift signals write to the skill substrate
   *  as pattern entries with applies_to=[char, target, axis, dir tag] —
   *  they surface naturally in the Character Development tab through the
   *  existing skill render path. Target is "user" for v1. */
  async function runDriftFormation(): Promise<void> {
    const former = driftFormerRef.current;
    if (!former || characters.length === 0) return;
    const client = clientRef.current;
    try {
      const candidates = await Promise.all(
        characters.map(async (char) => {
          const recall = await client
            .recall({
              query: "recent interactions, relationship signals",
              namespace: `character:${char.id}`,
              speaker: char.id,
              tier: "canon",
              top_k: 20,
            })
            .catch(() => null);
          if (!recall || recall.results.length < 2) return null;
          return {
            character_id: char.id,
            character_name: char.name,
            target: "user",
            target_label: currentPersona().name,
            recent_memories: recall.results,
          };
        })
      );
      const real = candidates.filter(
        (c): c is NonNullable<typeof c> => c !== null
      );
      if (real.length === 0) return;
      const formed = await former.formFromCandidates(real);
      if (formed.length > 0) {
        // New drift entries are stored as skills; refresh the Character
        // tab so they appear in-tab without a page reload.
        void refreshSkills();
      }
    } catch {
      // non-fatal — drift is best-effort enrichment, never blocks the loop
    }
  }

  /** Resolve a preset against the active provider and write the resulting
   *  sampling tuple onto the provider config (so Settings reflects it).
   *  Stash the choice on the session meta so it survives reloads.
   *
   *  opts.silent suppresses the provider-switch toast (used when restoring
   *  a session — the user didn't actively switch).
   *  opts.persist=false skips writing to session meta + config (used when
   *  re-resolving on session load: we already loaded the right id). */
  function onPickPreset(
    id: PresetId,
    opts: { silent?: boolean; persist?: boolean } = {}
  ): void {
    const provider = activeProvider(config);
    const resolved = resolvePreset(id, provider);
    setActivePresetId(id);
    if (provider) {
      const nextProviders = config.providers.map((p) =>
        p.id === provider.id
          ? {
              ...p,
              temperature: resolved.sampling.temperature,
              top_p: resolved.sampling.top_p,
              top_k: resolved.sampling.top_k,
              min_p: resolved.sampling.min_p,
              repetition_penalty: resolved.sampling.repetition_penalty,
            }
          : p
      );
      const nextConfig: ChroniclerConfig = {
        ...config,
        providers: nextProviders,
        default_preset_id:
          opts.persist === false ? config.default_preset_id : id,
      };
      setConfig(nextConfig);
      if (opts.persist !== false) saveConfig(nextConfig);
      samplingRef.current = resolved.sampling;
    }
    if (opts.persist !== false && sessionId) {
      const meta = sessions.find((s) => s.id === sessionId);
      if (meta) {
        const next = { ...meta, preset_id: id };
        saveSessionMeta(next);
        setSessions(listSessions());
      }
    }
    if (!opts.silent && provider) {
      const preset = PRESETS.find((p) => p.id === id);
      const supported = resolved.supported_fields.length;
      if (supported < 5) {
        setPresetToast(
          `${preset?.label} adjusted for ${provider.label} — ${supported} of 5 controls apply`
        );
      } else {
        setPresetToast(`${preset?.label} applied`);
      }
    }
  }

  /** Resolve the persona that should be injected into the system prompt
   *  for the active session — session override wins over the app-level
   *  active persona. Safe to call any time after config loads. */
  function currentPersona(): UserPersona {
    if (activePersonaId) {
      const override = config.user_personas?.find((p) => p.id === activePersonaId);
      if (override) return override;
    }
    return activePersona(config);
  }

  /** Swap the persona for the current session. Persists the choice on
   *  SessionMeta so it survives reload + session list refresh. Updates
   *  personaRef so the next turn's prompt uses the new persona. */
  function onSwitchPersona(id: string): void {
    setActivePersonaId(id);
    sessionPersonaIdRef.current = id;
    const next = config.user_personas?.find((p) => p.id === id);
    if (next) personaRef.current = next;
    if (sessionId) {
      const meta = sessions.find((s) => s.id === sessionId);
      if (meta) {
        saveSessionMeta({ ...meta, persona_id: id });
        setSessions(listSessions());
      }
    }
  }

  /** True iff any sampling field on the active provider differs from what
   *  the active preset would resolve to. Drives the "Custom (was: X)"
   *  pill label and the reapply affordance in the dropdown. */
  function isSamplingCustom(): boolean {
    const provider = activeProvider(config);
    if (!provider) return false;
    const resolved = resolvePreset(activePresetId, provider);
    const current = {
      temperature: provider.temperature,
      top_p: provider.top_p,
      top_k: provider.top_k,
      min_p: provider.min_p,
      repetition_penalty: provider.repetition_penalty,
    };
    return !samplingMatchesPreset(current, resolved);
  }

  // Dismiss the preset toast after a couple of seconds.
  useEffect(() => {
    if (!presetToast) return;
    const t = setTimeout(() => setPresetToast(null), 2400);
    return () => clearTimeout(t);
  }, [presetToast]);

  async function refreshMemories() {
    const whyMap = lastWhyRetrievedRef.current;
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
        why_retrieved: whyMap.get(m.rid),
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
            why_retrieved: whyMap.get(rid),
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
        void refreshRecapFor(char);
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
    setRecap(""); // clear any previous-session recap so it doesn't bleed
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
    // Pull "Previously on…" from prior canon so re-opening a character
    // with persisted memory doesn't feel like a fresh stranger. Matches
    // switchSession() + startNewSession() behavior (parity bug fix).
    void refreshRecapFor(primary);
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
    await refreshRecapFor(primary);
  }

  async function switchSession(id: string): Promise<void> {
    const meta = sessions.find((s) => s.id === id);
    if (!meta) return;
    // A cold chat may have been dropped from the browser cache to make room;
    // the server has it. Fetch it back BEFORE touching any state. This must
    // stay above every setState: an await between setSessionId() and
    // setTurns() lets the effect that persists turns run with the new session
    // id and the OLD turns, overwriting the chat with the wrong data.
    await getSyncEngine()?.ensureLocal(`chronicler.session.${meta.id}.turns`);
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
    setAuthorNoteDepth(meta.author_note_depth ?? 0);
    setActiveIntensityId(
      (meta.intensity_id as IntensityId | undefined) ??
        (config.default_intensity_id as IntensityId | undefined) ??
        DEFAULT_INTENSITY_ID
    );
    // Restore the session's persona override (or clear if none).
    sessionPersonaIdRef.current = meta.persona_id ?? undefined;
    setActivePersonaId(meta.persona_id ?? null);
    const personaForSession = meta.persona_id
      ? config.user_personas?.find((p) => p.id === meta.persona_id) ??
        activePersona(config)
      : activePersona(config);
    personaRef.current = personaForSession;
    setGreetingIndex(meta.greeting_index ?? 0);
    setNextSpeakerId(chars[0].id);
    setTurns(loadTurns(meta.id));
    // Restore the session's preset choice (or fall back to app default).
    const restored =
      (meta.preset_id as PresetId | undefined) ??
      (config.default_preset_id as PresetId | undefined) ??
      DEFAULT_PRESET_ID;
    setActivePresetId(restored);
    // Re-resolve against the active provider so a session opened on a
    // different model than it was created on still gets correct sampling.
    void onPickPreset(restored, { silent: true, persist: false });
    const primary = chars[0];
    void refreshRecapFor(primary);
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
    setBusyAction(`Importing ${file.name}…`);
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
        personality: parsed.card.data.personality,
        scenario: parsed.card.data.scenario,
        mes_example: parsed.card.data.mes_example,
        tags: parsed.card.data.tags,
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
    } finally {
      setBusyAction(null);
    }
  }

  async function loadDemoCharacter(which: DemoKey = "ren") {
    const meta = DEMOS[which];
    if (!meta) return;
    setBusyAction(`Loading demo character: ${meta.label}…`);
    const fakeCard = meta.card;
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
    } finally {
      setBusyAction(null);
    }
  }

  /** Refresh the "Previously on…" banner. Only characters that have actually
   *  been played get one — a fresh card's canon is just its description, and
   *  recapping that as prior story is false. */
  async function refreshRecapFor(char: Character): Promise<void> {
    if (!hasStoryHistory(listSessions(), char.id)) {
      setRecap("");
      return;
    }
    try {
      const r = await generateRecap(clientRef.current, {
        character_id: char.id,
        world_id: char.world_id,
        speaker: "user",
        provider: providerRef.current,
        model: modelRef.current,
      });
      setRecap(r.text);
    } catch {
      // A missing recap is cosmetic; never surface it as an error.
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
    // Never let the placeholder mock provider "answer" as if it were a model.
    if (needsProvider(config)) {
      setErrorMsg(NO_MODEL_MESSAGE);
      return;
    }
    setThinking(true);
    setStreamingText("");
    const abort = new AbortController();
    abortRef.current = abort;
    // Pacing: if the scene board has been still long enough, hand the model one
    // private story beat. Never on regenerate/continue (skipWrites), and only
    // when there is a board to measure stillness with.
    let storyBeat: string | undefined;
    if (
      !opts.skipWrites &&
      sceneTrackerRef.current &&
      config.scene_tracking !== false
    ) {
      const board = sceneBoardRef.current;
      const ledgerOn = ledgerTrackerRef.current && config.consequences !== false;
      const beat = pickBeat(
        board,
        pacingLevel(config),
        Math.random,
        ledgerOn ? { deeds: openDeeds(ledgerRef.current) } : undefined
      );
      if (beat) {
        storyBeat = beat.text(board);
        const marked = markBeatUsed(board, beat);
        sceneBoardRef.current = marked; // the tracker reads the ref later this turn
        setSceneBoard(marked);
        if (sessionId) saveScene(sessionId, marked);
      }
    }
    // Consequences: deeds that have aged enough are put to the model this turn
    // (never on regenerate/continue), then not again for a while.
    let consequences: string[] | undefined;
    // Deeds age in exchanges (one reply each), not in chat messages.
    const turnNo = exchangeNo(baseTurns);
    if (!opts.skipWrites && ledgerTrackerRef.current && config.consequences !== false) {
      const due = dueDeeds(ledgerRef.current, turnNo);
      if (due.length > 0) {
        consequences = renderConsequences(due, turnNo);
        const marked = markNudged(ledgerRef.current, due.map((d) => d.id), turnNo);
        ledgerRef.current = marked;
        setLedger(marked);
        if (sessionId) saveLedger(sessionId, marked);
      }
    }
    try {
      const { assistant_turn, writes_promise, prompted_skill_ids, retrieval, tool_invocations } = await orchestrator.turn(
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
          authorNoteDepth,
          intensitySnippet: effectiveIntensitySnippet(activeIntensityId),
          preferences: derivePromptedPreferences(speakerChar.id),
          identityNotes: loadIdentityNotes(speakerChar.id) || undefined,
          coreTraits: deriveCoreTraitsForCharacter(speakerChar.id, { enact: config.enact_traits === true }),
          selfModel: deriveSelfModelForCharacter(speakerChar.id),
          allowedTools: resolveAllowedTools(loadCharacterGating(speakerChar.id)),
          mcpEnabledResources: resolveEnabledResources(
            loadCharacterResourceOptIn(speakerChar.id)
          ),
          onChunk: (_chunk, accumulated) => setStreamingText(accumulated),
          signal: abort.signal,
          sceneStatus: renderSceneStatus(sceneBoardRef.current),
          storyBeat,
          consequences,
          storySoFar: config.story_summary === false ? undefined : renderChronicle(chronicleRef.current) || undefined,
        }
      );
      setLastPromptCapture(orchestrator.getLastPromptCapture());
      // Surface MCP tool invocations as synthetic system turns so the
      // user sees what the character invoked. One bubble per call with
      // server::tool name + result preview. Renders BEFORE the assistant
      // reply since calls happened first.
      if (tool_invocations.length > 0) {
        const toolBubbles: ChatTurn[] = tool_invocations.map((inv) => ({
          id: crypto.randomUUID(),
          role: "system",
          speaker: "system:tool",
          content: renderToolInvocation(inv),
          created_at: new Date().toISOString(),
          session_id: sessionId,
        }));
        setTurns((prev) => [...prev, ...toolBubbles]);
      }
      // Capture why_retrieved hints from this turn's recalls so the
      // memory inspector can show provenance badges. Merge into the
      // existing map rather than replacing — older recall hints stay
      // valid for memories that didn't re-surface this turn.
      const whyMap = lastWhyRetrievedRef.current;
      for (const r of [
        ...retrieval.canon,
        ...retrieval.scene,
        ...retrieval.heuristic,
        ...retrieval.graph,
      ]) {
        if (r.why_retrieved && r.why_retrieved.length > 0) {
          whyMap.set(r.rid, r.why_retrieved);
        }
      }
      // Record which skills were prompted into this turn so the outcome
      // loop can score them when the user reacts (or doesn't). For
      // regenerate-as-swipe, the previous skills WERE shown to the user;
      // the regeneration itself is the negative signal we'll score below.
      if (prompted_skill_ids.length > 0) {
        const targetTurnId = opts.asSwipeOf?.id ?? assistant_turn.id;
        promptedSkillsByTurnRef.current.set(targetTurnId, prompted_skill_ids);
      }
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
      updateSceneBoard(sessionId, speakerChar, userTurn, assistant_turn, opts.skipWrites);
      updateLedger(sessionId, speakerChar, userTurn, assistant_turn, turnNo, opts.skipWrites);
      window.setTimeout(() => void extendChronicle(), 400); // after the new turn is in state
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
      // Stop before any text arrived: nothing to keep, and not an error.
      if (abort.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[chronicler] turn failed:", err);
      setErrorMsg(`Turn failed: ${msg}`);
    } finally {
      if (abortRef.current === abort) abortRef.current = null;
      setThinking(false);
      setStreamingText(undefined);
    }
  }

  /** Ask the tracker what changed in this exchange and fold it into the board.
   *  Fire-and-forget: it never blocks the reply. If the player edited the board
   *  while it ran, the model's result is dropped rather than overwriting them. */
  function updateSceneBoard(
    sid: string,
    char: Character,
    userTurn: ChatTurn | undefined,
    reply: ChatTurn,
    skip?: boolean
  ): void {
    const tracker = sceneTrackerRef.current;
    if (skip || !tracker || config.scene_tracking === false) return;
    const base = sceneBoardRef.current;
    setSceneUpdating(true);
    void tracker
      .update({
        state: base,
        userName: activePersona(config).name,
        characterName: char.name,
        userText: userTurn?.content,
        replyText: reply.content,
      })
      .then((next) => {
        if (liveSessionRef.current !== sid) return;
        if (sceneBoardRef.current !== base) return; // edited meanwhile
        // A turn where the board did not change is a still turn.
        const advanced = advancePacing(next, next !== base);
        if (advanced === base) return;
        setSceneBoard(advanced);
        saveScene(sid, advanced);
      })
      .finally(() => setSceneUpdating(false));
  }

  /** The model that reads replies for the consistency audit: the background
   *  provider (small, cheap, already configured for the trackers). */
  function auditJudge(): { judge: ConsistencyJudge; provider: LlmProvider; model: string; label: string } | null {
    const bp = providerForRole(config, "background");
    if (!bp || bp.kind === "mock") return null;
    const provider = buildProvider({ ...bp, disable_thinking: true });
    return { judge: new ConsistencyJudge(provider, bp.model), provider, model: bp.model, label: bp.model };
  }

  // Optional setting: make the "On the page:" line for any core trait that lacks
  // one. Background, never blocks a turn; a trait that cannot be restated simply
  // shows as itself. Off unless the player turned it on.
  const enactRunning = useRef(false);
  const enactCancelled = useRef(false);
  useEffect(() => {
    enactCancelled.current = false;
    return () => {
      enactCancelled.current = true;
    };
  }, []);
  useEffect(() => {
    if (config.enact_traits !== true || enactRunning.current) return;
    const bp = providerForRole(config, "background");
    if (!bp || bp.kind === "mock") return;
    const jobs = characters
      .map((c) => ({ name: c.name, traits: deriveCoreTraitsForCharacter(c.id) ?? [] }))
      .filter((j) => j.traits.length > 0);
    if (jobs.length === 0) return;
    let cache = loadEnactments();
    if (jobs.every((j) => j.traits.every((t) => traitKey(t) in cache))) return;
    enactRunning.current = true;
    const provider = buildProvider({ ...bp, disable_thinking: true });
    void (async () => {
      try {
        for (const j of jobs) {
          const r = await ensureEnactments(provider, bp.model, j.name, j.traits, cache, { get cancelled() { return enactCancelled.current; } });
          cache = r.cache;
          if (r.added > 0) saveEnactments(cache);
        }
      } finally {
        enactRunning.current = false;
      }
    })();
    // A run always finishes; it is only stopped when the app unmounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.enact_traits, inspectedSkills, characters]);

  /** Declared traits from the card, merged with any core traits the character
   *  has developed. The player edits the result before auditing. */
  async function extractAuditTraits(): Promise<void> {
    const char = charactersRef.current[0];
    const j = auditJudge();
    if (!char || !j) return;
    setAuditExtracting(true);
    try {
      const declared = await extractDeclaredTraits(j.provider, j.model, char.name, char.system_prompt ?? char.description ?? "");
      const core = deriveCoreTraitsForCharacter(char.id) ?? [];
      const seen = new Set<string>();
      const merged = [...declared, ...core].filter((t) => !seen.has(t.toLowerCase()) && !!seen.add(t.toLowerCase()));
      setAuditTraits(merged);
      saveTraits(char.id, merged);
    } finally {
      setAuditExtracting(false);
    }
  }

  function openAudit(): void {
    const char = charactersRef.current[0];
    if (!char) return;
    setAuditReport(sessionId ? loadReport(sessionId) : null);
    const stored = loadTraits(char.id);
    setAuditTraits(stored ?? []);
    setAuditOpen(true);
    if (!stored || stored.length === 0) void extractAuditTraits();
  }

  async function startAudit(): Promise<void> {
    const char = charactersRef.current[0];
    const j = auditJudge();
    if (!char || !j || !sessionId || auditRunning) return;
    const traits = auditTraits.map((t) => t.trim()).filter(Boolean);
    saveTraits(char.id, traits);
    auditCancel.current = false;
    setAuditRunning({ done: 0, total: 0 });
    try {
      const report = await runAudit({
        turns: turnsRef.current,
        sessionId,
        traits,
        judgeModel: j.model,
        judge: (t, reply) => j.judge.judge(t, reply, char.name),
        onProgress: (done, total) => setAuditRunning({ done, total }),
        shouldCancel: () => auditCancel.current,
      });
      setAuditReport(report);
      saveReport(sessionId, report);
    } finally {
      setAuditRunning(null);
    }
  }

  function jumpToTurn(turnId: string): void {
    setAuditOpen(false);
    setHighlightTurnId(turnId);
    window.setTimeout(() => document.getElementById(`turn-${turnId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 80);
  }

  /** Bring the chronicle up to date: write a chapter for every chunk of messages
   *  that has left the recent window. Single-flight, runs in the background, and
   *  stops if you switch chats. If you edit the chronicle while it works, it
   *  re-reads and carries on rather than overwriting you. */
  async function extendChronicle(): Promise<void> {
    const writer = chronicleWriterRef.current;
    const sid = liveSessionRef.current;
    if (!writer || !sid || config.story_summary === false || chronicleRunning.current) return;
    chronicleRunning.current = true;
    setChronicleBusy(true);
    try {
      for (let i = 0; i < 60; i++) {
        if (liveSessionRef.current !== sid) return;
        const base = chronicleRef.current;
        const next = await stepChronicle(base, turnsRef.current, writer, {
          userName: activePersona(config).name,
          characterName: charactersRef.current[0]?.name ?? "Character",
        });
        if (!next) return; // nothing left to summarise, or the model is unreachable
        if (liveSessionRef.current !== sid) return;
        if (chronicleRef.current !== base) continue; // edited meanwhile: redo from the new state
        chronicleRef.current = next;
        setChronicle(next);
        saveChronicle(sid, next);
      }
    } finally {
      chronicleRunning.current = false;
      setChronicleBusy(false);
    }
  }

  function updateChronicle(next: Chronicle): void {
    chronicleRef.current = next;
    setChronicle(next);
    if (sessionId) saveChronicle(sessionId, next);
  }

  /** After a reply: if something consequential seems to have happened (a cheap
   *  check), ask the tracker to record it, and to note deeds the reply answered.
   *  Fire-and-forget; dropped if the player changed the ledger meanwhile. */
  function updateLedger(
    sid: string,
    char: Character,
    userTurn: ChatTurn | undefined,
    reply: ChatTurn,
    turn: number,
    skip?: boolean
  ): void {
    const tracker = ledgerTrackerRef.current;
    if (skip || !tracker || config.consequences === false) return;
    const base = ledgerRef.current;
    void tracker
      .update({
        ledger: base,
        turn,
        userName: activePersona(config).name,
        characterName: char.name,
        present: sceneBoardRef.current.present,
        userText: userTurn?.content,
        replyText: reply.content,
      })
      .then((next) => {
        if (next === base || liveSessionRef.current !== sid) return;
        if (ledgerRef.current !== base) return; // changed meanwhile
        setLedger(next);
        saveLedger(sid, next);
      });
  }

  /** Describe an image the player attached, for the composer to show and let
   *  them edit before it enters the story. The bytes are kept locally; only the
   *  description ever reaches the story model, and it is never written to
   *  memory. If the vision model can't or won't describe it, the player gets an
   *  empty description to write themselves. */
  async function describeAttachedImage(file: Blob): Promise<DescribeUi> {
    const vp = providerForRole(config, "vision");
    if (!vp) return { ok: false, error: "No vision model is set. Choose one in Settings → Vision." };
    if (!isLocalProvider(vp)) {
      const key = `chronicler:vision-ok:${vp.id}`;
      let ok = false;
      try {
        ok = window.localStorage.getItem(key) === "1";
      } catch {
        /* ignore */
      }
      if (!ok) {
        ok = window.confirm(
          `This image will be sent to "${vp.label}" (${vp.model}), which is not on this device.\n\nOnly send images you are comfortable sharing with that service. Continue?`
        );
        if (!ok) return { ok: false, error: "Cancelled — the image was not sent." };
        try {
          window.localStorage.setItem(key, "1");
        } catch {
          /* ignore */
        }
      }
    }
    let prepared;
    try {
      prepared = await prepareImage(file);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    await putImage({ id: prepared.id, mime: prepared.mime, b64: prepared.b64 });
    const describer = new VisionDescriber(buildProvider({ ...vp, disable_thinking: true }), vp.model);
    const ctx = renderSceneStatus(sceneBoardRef.current);
    const r = await describer.describe({ image: prepared.b64, sceneContext: ctx.length ? ctx : undefined });
    const base = { id: prepared.id, kind: "image" as const, mime: prepared.mime, width: prepared.width, height: prepared.height };
    if (r.ok) {
      return { ok: true, thumb: prepared.dataUrl, attachment: { ...base, description: r.text, described_by: vp.model } };
    }
    const warning =
      r.reason === "refused"
        ? "The vision model would not describe this image. Write a short description yourself."
        : r.reason === "empty"
        ? "The vision model returned nothing. Write a short description yourself."
        : `Could not reach the vision model${r.detail ? ` (${r.detail.slice(0, 80)})` : ""}. Write a short description yourself.`;
    return { ok: true, thumb: prepared.dataUrl, attachment: { ...base, description: "" }, warning };
  }

  /** The number of the exchange being played: replies so far, plus one. */
  function exchangeNo(ts: ChatTurn[]): number {
    return ts.filter((t) => t.role === "assistant").length + 1;
  }

  function pacingLevel(cfg: ChroniclerConfig): PacingLevel {
    return cfg.pacing ?? "gentle";
  }

  function onPacingChange(level: PacingLevel): void {
    const next = { ...config, pacing: level };
    saveConfig(next);
    setConfig(next);
  }

  function stopGeneration(): void {
    abortRef.current?.abort();
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

  async function onSend(text: string, attachments?: TurnAttachment[]): Promise<boolean | void> {
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
    // Slash commands are intercepted before going to the LLM. They land
    // as system turns in the scene log so subsequent character replies
    // can react to the dice roll naturally.
    const parsed = parseSlash(text);
    if (parsed) {
      const result = executeSlash(parsed, {
        participants: characters.map((c) => ({ id: c.id, name: c.name })),
        random: Math.random,
      });
      if (!result) {
        setErrorMsg(`Bad dice expression: ${parsed.args || "(empty)"}`);
        return;
      }
      const systemTurn: ChatTurn = {
        id: crypto.randomUUID(),
        role: "system",
        speaker: "narrator",
        content: result.output,
        created_at: new Date().toISOString(),
        session_id: sessionId,
      };
      setTurns([...turns, systemTurn]);
      return;
    }
    const speakerId = nextSpeakerId ?? characters[0].id;
    const speakerChar = characters.find((c) => c.id === speakerId);
    if (!speakerChar) {
      setErrorMsg(`Speaker "${speakerId}" not found among ${characters.length} characters.`);
      return;
    }
    // No real model connected (e.g. a browser that pulled its chats from the server but was never
    // set up): refuse before adding the message, and report false so the composer keeps the text.
    if (needsProvider(config)) {
      setErrorMsg(NO_MODEL_MESSAGE);
      return false;
    }
    // Before sending the next user turn, score the prior assistant turn's
    // skills positively — the user moved on without regenerating, editing,
    // or deleting. That's the "no negative signal" path.
    const prior = [...turns].reverse().find((t) => t.role === "assistant");
    if (prior) {
      void scoreSkillsForTurn(prior.id, {
        turns_observed: 2,
        regenerated_within: Infinity,
        retconned_within: Infinity,
        deleted_related: false,
      });
    }
    const userTurn: ChatTurn = {
      id: crypto.randomUUID(),
      role: "user",
      speaker: "user",
      content: text,
      created_at: new Date().toISOString(),
      session_id: sessionId,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    };
    const nextTurns = [...turns, userTurn];
    setTurns(nextTurns);
    await runAssistantTurn(nextTurns, userTurn, speakerChar);
  }

  /** Score every skill that was injected into the given assistant turn's
   *  prompt, then refresh the local state cache used by the pipeline's
   *  suppression filter. Safe to call multiple times — the tracker
   *  internally dedupes per (skill, session, turn) tuple. The dedup key
   *  uses the turn's index in `turns` so different assistant turns score
   *  independently while regen-then-send on the SAME turn dedups
   *  correctly (regen wins as the first observation, send is ignored). */
  async function scoreSkillsForTurn(
    turnId: string,
    obs: Omit<SkillObservation, "surfaced_at_turn">
  ): Promise<void> {
    const tracker = skillTrackerRef.current;
    const skills = promptedSkillsByTurnRef.current.get(turnId);
    if (!tracker || !skills || skills.length === 0 || !sessionId) return;
    const turnIdx = turns.findIndex((t) => t.id === turnId);
    if (turnIdx < 0) return;
    const full: SkillObservation = { ...obs, surfaced_at_turn: turnIdx };
    for (const skill_id of skills) {
      try {
        const res = await tracker.record(skill_id, sessionId, full, {
          currentState: skillStateRef.current.get(skill_id) ?? "candidate",
        });
        skillStateRef.current.set(skill_id, res.state_after);
      } catch {
        // tracker swallows substrate errors; nothing to do at the UI level
      }
    }
  }

  function onEditMessage(turnId: string, newContent: string) {
    setTurns((ts) =>
      ts.map((t) => (t.id === turnId ? { ...t, content: newContent } : t))
    );
    // Edits to an assistant turn are a retcon — score skills negatively.
    const edited = turns.find((t) => t.id === turnId);
    if (edited?.role === "assistant") {
      void scoreSkillsForTurn(turnId, {
        turns_observed: 1,
        regenerated_within: Infinity,
        retconned_within: 0,
        deleted_related: false,
      });
    }
  }

  function onDeleteMessage(turnId: string) {
    const deleted = turns.find((t) => t.id === turnId);
    setTurns((ts) => ts.filter((t) => t.id !== turnId));
    if (deleted?.role === "assistant") {
      void scoreSkillsForTurn(turnId, {
        turns_observed: 1,
        regenerated_within: Infinity,
        retconned_within: Infinity,
        deleted_related: true,
      });
    }
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

    // Regenerate IS the negative signal — the user wasn't happy with the
    // skills' contribution to this turn. Score before we run the new turn
    // so the suppression filter can already exclude them downstream.
    void scoreSkillsForTurn(turnId, {
      turns_observed: 1,
      regenerated_within: 0,
      retconned_within: Infinity,
      deleted_related: false,
    });

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
      else if (searchOpen) {
        setSearchOpen(false);
        setHighlightTurnId(undefined);
      }
      else if (lorebookCharacterId) setLorebookCharacterId(null);
      else if (editingCharacterId) setEditingCharacterId(null);
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
    onSearch: () => setSearchOpen((v) => !v),
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

  async function onExportSession(id: string) {
    const meta = sessions.find((s) => s.id === id);
    if (!meta) return;
    await getSyncEngine()?.ensureLocal(`chronicler.session.${id}.turns`);
    const exportTurns = id === sessionId ? turns : loadTurns(id);
    const storedChars = listCharacters();
    const chars = meta.character_ids
      .map((cid) => storedChars.find((c) => c.id === cid))
      .filter((c): c is Character => !!c);
    const md = exportSessionMarkdown(
      meta,
      exportTurns,
      chars,
      currentPersona().name
    );
    const safeTitle =
      meta.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "session";
    const date = new Date(meta.last_at).toISOString().slice(0, 10);
    downloadText(`chronicler-${safeTitle}-${date}.md`, md);
  }

  async function onExportBackup() {
    const allSessions = listSessions();
    // A complete backup needs every chat, including any dropped from the cache.
    await Promise.all(allSessions.map((m) => getSyncEngine()?.ensureLocal(`chronicler.session.${m.id}.turns`)));
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
    const cur = currentPersona();
    const personaName = cur.name;
    const personaDesc = cur.description ?? "";
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
        max_tokens: limit("reply.impersonate_tokens"),
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

  /** Threads after applying user overrides — pinned stays visible,
   *  dismissed/resolved/snoozed-not-yet-expired drop. Reactive to
   *  threadOverridesVersion so toggling an action re-filters. */
  const visibleThreads = useMemo(() => {
    const overrides = threadOverridesRef.current;
    return allThreads.filter((t) => {
      const o = overrides.get(t.id);
      if (o?.status === "pinned") return true;
      return !isHidden(o);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allThreads, threadOverridesVersion]);

  /** Arcs derived from canon memories via the rule-based clusterer. The
   *  clusterer is pure + cheap; recomputing on every memories change is
   *  fine for the inspector's scale (dozens to hundreds of memories). */
  const arcs = useMemo<Arc[]>(() => {
    // Cluster only canon — heuristics/reflex aren't durable narrative.
    const canonOnly = memories.filter((m) => m.tier === "canon");
    return clusterArcs(
      canonOnly.map((m) => ({
        rid: m.rid,
        text: m.text,
        importance: m.importance,
        touched_at: m.created_at ?? new Date().toISOString(),
        entities: undefined, // clusterer falls back to text extraction
      }))
    );
  }, [memories]);

  // Arc count for the tab badge — respect archived overrides.
  const arcVisibleCount = useMemo(() => {
    const overrides = arcOverridesRef.current;
    return arcs.filter((a) => overrides.get(a.id)?.status !== "archived")
      .length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arcs, arcOverridesVersion]);

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

  // Rendered from BOTH the library and chat views. It used to live only in the chat view's return, so a
  // browser that landed on the library (any browser with prior chats, e.g. after pulling them from the
  // server) opened the wizard invisibly.
  const wizardElement = wizardOpen ? (
    <FirstRunWizard
      onComplete={applyWizardPatch}
      onImportCard={(f) => {
        void onImportCard(f);
        dismissWizard();
      }}
      onTryDemo={() => {
        void loadDemoCharacter("ren");
        dismissWizard();
      }}
      onSkip={dismissWizard}
    />
  ) : null;

  if (view === "library") {
    return (
      <div className="h-screen text-sm flex flex-col">
        {needsProvider(config) && <NoModelBar onOpenSettings={() => setSettingsOpen(true)} />}
        <div className="flex-1 min-h-0">
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
          onDemo={(key) => {
            setView("chat");
            void loadDemoCharacter(key);
          }}
          onDeleteCharacter={(id) => {
            import("./lib/session/store").then(({ deleteCharacter }) => {
              deleteCharacter(id);
              setLibraryCharacters(listCharacters());
            });
          }}
          onEditCharacter={(id) => setEditingCharacterId(id)}
          onOpenSettings={() => setSettingsOpen(true)}
          worlds={worlds}
          onCreateWorld={onCreateWorld}
          onEditWorld={onEditWorld}
          onEditWorldLorebook={onEditWorldLorebook}
          onDeleteWorld={onDeleteWorld}
          onStartStory={() => void onStartStory()}
        />
        </div>
        {wizardElement}
        {editingCharacterId &&
          (() => {
            const target = libraryCharacters.find(
              (c) => c.id === editingCharacterId
            );
            if (!target) return null;
            return (
              <CharacterEditor
                character={target}
                client={clientRef.current}
                worlds={worlds}
                mcpRegistry={mcpRegistryRef.current}
                onOpenLorebook={() => {
                  setLorebookCharacterId(target.id);
                  setEditingCharacterId(null);
                }}
                onClose={() => setEditingCharacterId(null)}
                onSave={async (updated) => {
                  storeSaveCharacter(updated);
                  setLibraryCharacters(listCharacters());
                  setCharacters((cs) =>
                    cs.map((c) => (c.id === updated.id ? updated : c))
                  );
                  if (updated.system_prompt) {
                    setSystemPrompts((p) => ({
                      ...p,
                      [updated.id]: updated.system_prompt as string,
                    }));
                  }
                }}
              />
            );
          })()}
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
            mcpRegistry={mcpRegistryRef.current}
            yantrikClient={clientRef.current}
          />
        )}
      </div>
    );
  }

  return (
    <div className="grid h-dvh grid-cols-1 lg:grid-cols-[1fr_340px] text-sm">
      {/* Ambient scene mood: a faint wash from the board's time of day and
          mood. Pure CSS, no model; off via Settings → Visuals. */}
      {config.images?.ambient !== false && ambientFor(sceneBoard) && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-10 transition-[background] duration-1000"
          style={{ background: ambientFor(sceneBoard) as string }}
        />
      )}
      <div className="relative isolate flex flex-col min-h-0">
        {backdropUrl && (
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 bg-cover bg-center opacity-45"
            style={{ backgroundImage: `url("${backdropUrl}")` }}
          />
        )}
        <header className="relative z-20 px-3 sm:px-6 py-3 border-b border-neutral-800 bg-neutral-950/70 backdrop-blur flex flex-wrap items-center justify-between gap-y-2">
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
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="lg:hidden text-xs rounded border border-neutral-800 hover:border-neutral-700 text-neutral-300 px-2.5 py-1"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open memory and sessions panel"
              aria-expanded={drawerOpen}
            >
              ☰ panel
            </button>
            {formedSkillCount > 0 && (
              <button
                className="text-[10px] font-mono rounded border border-amber-700/60 text-amber-400 hover:bg-amber-900/30 px-1.5 py-0.5 transition-colors"
                onClick={() => {
                  setInspectorTab("skills");
                  void refreshSkills();
                }}
                title={`${formedSkillCount} verified character skill${formedSkillCount === 1 ? "" : "s"} learned this session — click to view`}
              >
                +{formedSkillCount} skill{formedSkillCount === 1 ? "" : "s"}
              </button>
            )}
            <PresetPicker
              presetId={activePresetId}
              isCustom={isSamplingCustom()}
              provider={activeProvider(config)}
              onSelect={(id) => onPickPreset(id)}
              onReapply={() => onPickPreset(activePresetId)}
            />
            <SyncBadge />
            <ThemeMenu />
            <button
              className="text-xs rounded-lg border border-neutral-700/70 bg-neutral-900/40 hover:border-emerald-500/60 text-neutral-300 hover:text-neutral-100 px-2.5 py-1.5"
              onClick={() => setSettingsOpen(true)}
              title={`Settings · ${backendLabel} · ${providerLabel}`}
            >
              settings
            </button>
            <MoreMenu
              onImportCard={onImportCard}
              onOpenPrompt={() => setPromptInspectorOpen(true)}
              onOpenGrimoire={() => setBrowseGrimoireOpen(true)}
              onOpenHelp={() => setHelpOpen(true)}
              onOpenAudit={openAudit}
            />
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
              {characters.length === 1 && characters[0].id.startsWith("ren-") && (
                <button
                  className="text-[11px] px-2 py-0.5 rounded-full border border-emerald-700/60 text-emerald-300 hover:border-emerald-600 hover:text-emerald-200"
                  onClick={() => loadDemoCharacter("mei")}
                  title="Add Mei to make this a group scene"
                >
                  + Mei (try group)
                </button>
              )}
              {(config.user_personas?.length ?? 0) > 1 && (
                <div className="flex items-center gap-1">
                  <span className="text-[10px] uppercase tracking-wider text-neutral-500">
                    as
                  </span>
                  <select
                    className="text-xs bg-neutral-900 border border-neutral-800 rounded px-2 py-0.5 text-neutral-200"
                    value={currentPersona().id}
                    onChange={(e) => onSwitchPersona(e.currentTarget.value)}
                    title="User persona for this session"
                  >
                    {config.user_personas?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
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
              <div className="ml-auto flex items-center gap-1.5">
                <IntensityPicker
                  key={`intensity-${intensitySnippetsVersion}`}
                  intensityId={activeIntensityId}
                  provider={
                    activeProvider(config)
                      ? {
                          kind: activeProvider(config)!.kind,
                          model: activeProvider(config)!.model,
                        }
                      : undefined
                  }
                  currentSnippet={effectiveIntensitySnippet(activeIntensityId)}
                  isDefault={isIntensityDefault(activeIntensityId)}
                  onSelect={onIntensitySelect}
                  onSaveSnippet={onIntensitySaveSnippet}
                  onResetSnippet={onIntensityResetSnippet}
                />
                <button
                  onClick={() => setAuthorNoteOpen((v) => !v)}
                  className={`text-[11px] px-2 py-0.5 rounded border ${
                    authorNote.trim()
                      ? "border-amber-700/60 bg-amber-900/20 text-amber-200"
                      : "border-neutral-800 text-neutral-400 hover:text-neutral-200"
                  }`}
                  title="Author's note — persistent steering for the scene"
                >
                  author's note{authorNote.trim() ? " •" : ""}
                </button>
              </div>
            </div>
            {authorNoteOpen && (
              <div className="px-6 pb-2 pt-0 space-y-1.5">
                <textarea
                  value={authorNote}
                  onChange={(e) => setAuthorNote(e.currentTarget.value)}
                  placeholder="Steering notes injected every turn, e.g. 'Ren is being more introspective today' or 'use third person narration'"
                  rows={2}
                  className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-xs text-neutral-100 resize-y focus:outline-none focus:border-neutral-600"
                />
                <div className="flex items-center gap-3 text-[10px] text-neutral-500">
                  <span className="uppercase tracking-wider">depth</span>
                  <input
                    type="range"
                    min={0}
                    max={5}
                    step={1}
                    value={authorNoteDepth}
                    onChange={(e) =>
                      setAuthorNoteDepth(Number(e.currentTarget.value))
                    }
                    className="flex-1 max-w-[180px] accent-emerald-500"
                  />
                  <span className="font-mono text-neutral-400 min-w-[64px]">
                    {authorNoteDepth === 0
                      ? "system prompt"
                      : `${authorNoteDepth} turn${authorNoteDepth === 1 ? "" : "s"} back`}
                  </span>
                  <span
                    className="text-neutral-600 cursor-help"
                    title="0 = note lives in the system prompt (default, broad steering). 1-5 = injected as a system message N turns before the reply, where the model attends to it more strongly. Higher = closer to the current turn."
                  >
                    (?)
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
        {needsProvider(config) && <NoModelBar onOpenSettings={() => setSettingsOpen(true)} />}
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
        {presetToast && (
          <div className="px-6 py-1.5 bg-emerald-900/50 border-b border-emerald-800/60 text-emerald-100 text-[11px] flex items-center justify-between gap-4">
            <span>{presetToast}</span>
            <button
              onClick={() => setPresetToast(null)}
              className="text-emerald-300 hover:text-white text-[10px]"
            >
              ×
            </button>
          </div>
        )}
        {busyAction && (
          <div className="px-6 py-1.5 bg-neutral-800/60 border-b border-neutral-700 text-neutral-200 text-[11px] flex items-center gap-2">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full border-2 border-emerald-500/40 border-t-emerald-400 animate-spin"
              aria-hidden
            />
            <span>{busyAction}</span>
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
              onDemo={(key) => loadDemoCharacter(key)}
              onOpenSettings={() => setSettingsOpen(true)}
              hasPriorSessions={sessions.length > 0}
            />
          ) : (
            <div className="flex h-full min-h-0 flex-col">
            {config.story_summary !== false && chronicleWriterRef.current && (
              <StoryHud
                chronicle={chronicle}
                busy={chronicleBusy}
                onEditChapter={(id, text) => updateChronicle(editChapter(chronicleRef.current, id, text))}
                onDeleteChapter={(id) => updateChronicle(deleteChapter(chronicleRef.current, id))}
                onEditEarlier={(text) => updateChronicle(editEarlier(chronicleRef.current, text))}
                onRebuild={() => {
                  if (sessionId) clearChronicle(sessionId);
                  updateChronicle(emptyStory());
                  window.setTimeout(() => void extendChronicle(), 50);
                }}
              />
            )}
            <SceneHud
              state={sceneBoard}
              tracking={
                config.scene_tracking === false
                  ? "off"
                  : sceneTrackerRef.current
                  ? "on"
                  : "needs-model"
              }
              updating={sceneUpdating}
              consequences={
                config.consequences !== false && ledgerTrackerRef.current
                  ? {
                      deeds: openDeeds(ledger),
                      turn: exchangeNo(turns),
                      answered: ledger.deeds.filter((d) => d.status === "answered").length,
                      onDismiss: (id: string) => {
                        const next = dismissDeed(ledgerRef.current, id);
                        ledgerRef.current = next;
                        setLedger(next);
                        if (sessionId) saveLedger(sessionId, next);
                      },
                    }
                  : undefined
              }
              images={
                config.images?.generate
                  ? { busy: imageStatus.busy, error: imageStatus.error, hasBackdrop: !!backdropUrl, onRedraw: redrawBackdrop }
                  : undefined
              }
              pacing={{
                level: pacingLevel(config),
                turnsUntil: turnsUntilBeat(sceneBoard, pacingLevel(config)),
                lastBeat: BEATS.find((b) => b.id === sceneBoard.last_beat)?.label,
                onChange: onPacingChange,
              }}
              onChange={(next) => {
                setSceneBoard(next);
                if (sessionId) saveScene(sessionId, next);
              }}
              onClear={() => {
                setSceneBoard(emptySceneState());
                if (sessionId) clearScene(sessionId);
              }}
            />
            <div className="flex-1 min-h-0">
            <ChatPane
              turns={turns}
              onSend={onSend}
              vision={
                providerForRole(config, "vision")
                  ? {
                      label: `${providerForRole(config, "vision")!.model}${isLocalProvider(providerForRole(config, "vision")!) ? " (local)" : ""}`,
                      describe: describeAttachedImage,
                    }
                  : undefined
              }
              isThinking={thinking}
              onStop={stopGeneration}
              streamingText={streamingText}
              slashCommands={grimoireSlashCommands}
              onSlashCommand={onSlashCommand}
              recap={recap}
              activeArcsLine={summarizeActiveArcs(arcs)}
              characterName={
                characters.length === 1
                  ? characters[0].name
                  : characters.length > 1
                  ? characters.find((c) => c.id === nextSpeakerId)?.name
                  : undefined
              }
              speakerNames={{
                ...Object.fromEntries(characters.map((c) => [c.id, c.name])),
                user: currentPersona().name,
              }}
              speakerAvatars={{
                ...generatedPortraits, // a card's own avatar always wins
                ...Object.fromEntries(
                  characters
                    .filter((c) => c.avatar_url)
                    .map((c) => [c.id, c.avatar_url as string])
                ),
              }}
              hasBackdrop={!!backdropUrl}
              highlightTurnId={highlightTurnId}
              onEditMessage={onEditMessage}
              onDeleteMessage={onDeleteMessage}
              onRegenerate={onRegenerate}
              onContinue={onContinue}
              onImpersonate={onImpersonate}
              onSwipeChange={onSwipeChange}
              onFork={onForkSession}
            />
            </div>
            </div>
          )}
        </div>
      </div>
      {drawerOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={`flex flex-col bg-neutral-950/95 lg:bg-neutral-950/70 backdrop-blur border-l border-neutral-800 overflow-hidden
          fixed inset-y-0 right-0 z-40 w-[88vw] max-w-[360px] transition-transform duration-200
          ${drawerOpen ? "translate-x-0" : "translate-x-full"}
          lg:static lg:z-auto lg:w-auto lg:max-w-none lg:translate-x-0 lg:h-full`}
      >
        <button
          className="lg:hidden self-end m-2 text-xs text-neutral-400 hover:text-neutral-100 border border-neutral-800 rounded px-2 py-1"
          onClick={() => setDrawerOpen(false)}
        >
          close ✕
        </button>
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
        <div className="flex-1 min-h-0 flex flex-col bg-neutral-950 border-l border-neutral-800">
          <div className="flex border-b border-neutral-800 text-[11px]">
            <button
              className={`flex-1 px-3 py-1.5 text-left ${
                inspectorTab === "memory"
                  ? "text-neutral-100 border-b-2 border-emerald-500/60"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
              onClick={() => setInspectorTab("memory")}
            >
              memory{memories.length > 0 ? ` · ${memories.length}` : ""}
            </button>
            <button
              className={`flex-1 px-3 py-1.5 text-left ${
                inspectorTab === "skills"
                  ? "text-neutral-100 border-b-2 border-emerald-500/60"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
              onClick={() => {
                setInspectorTab("skills");
                void refreshSkills();
              }}
            >
              character{inspectedSkills.length > 0 ? ` · ${inspectedSkills.length}` : ""}
            </button>
            <button
              className={`flex-1 px-3 py-1.5 text-left ${
                inspectorTab === "preferences"
                  ? "text-neutral-100 border-b-2 border-emerald-500/60"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
              onClick={() => {
                setInspectorTab("preferences");
                void refreshPreferences();
              }}
            >
              {(() => {
                const pending = inspectedPreferences.filter(
                  (p) => p.state === "candidate"
                ).length;
                const active = inspectedPreferences.filter(
                  (p) => p.state === "active"
                ).length;
                if (pending > 0) return `prefs · ${pending} to review`;
                if (active > 0) return `prefs · ${active}`;
                return "prefs";
              })()}
            </button>
            <button
              className={`flex-1 px-3 py-1.5 text-left ${
                inspectorTab === "threads"
                  ? "text-neutral-100 border-b-2 border-emerald-500/60"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
              onClick={() => {
                setInspectorTab("threads");
                void refreshThreads();
              }}
            >
              threads{visibleThreads.length > 0 ? ` · ${visibleThreads.length}` : ""}
            </button>
            <button
              className={`flex-1 px-3 py-1.5 text-left ${
                inspectorTab === "arcs"
                  ? "text-neutral-100 border-b-2 border-emerald-500/60"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
              onClick={() => setInspectorTab("arcs")}
            >
              arcs{arcVisibleCount > 0 ? ` · ${arcVisibleCount}` : ""}
            </button>
            {/* Phase 11 Pillar 3: identity tab. Distinct fuchsia accent
              * to match the core_trait state badge. Always present so
              * users can see "no traits yet" + understand the substrate. */}
            <button
              className={`flex-1 px-3 py-1.5 text-left ${
                inspectorTab === "identity"
                  ? "text-neutral-100 border-b-2 border-fuchsia-500/60"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
              onClick={() => setInspectorTab("identity")}
              title="Crystallized identity: self-model + core traits + timeline"
            >
              identity
              {identityCoreTraitCount > 0 ? ` · ${identityCoreTraitCount}` : ""}
            </button>
            {/* Grimoire-contributed inspector tabs. Re-renders when
              * grimoireVersion bumps (plugin load/unload). */}
            {grimoireHostRef.current?.slots.get("inspector:tab").map((c) => {
              const tabId = `grimoire:${c.pluginId}`;
              return (
                <button
                  key={tabId}
                  className={`flex-1 px-3 py-1.5 text-left ${
                    inspectorTab === tabId
                      ? "text-neutral-100 border-b-2 border-violet-500/60"
                      : "text-neutral-500 hover:text-neutral-300"
                  }`}
                  onClick={() => setInspectorTab(tabId)}
                  title={`Grimoire: ${c.pluginId}`}
                >
                  {c.title ?? c.pluginId.split(".").pop()}
                </button>
              );
            })}
          </div>
          <div className="flex-1 min-h-0">
            {inspectorTab === "memory" ? (
              <MemoryInspector
                memories={memories}
                onForget={onForget}
                onPromote={onPromote}
                onDemote={onDemote}
                onRetcon={onRetcon}
              />
            ) : inspectorTab === "skills" ? (
              <SkillInspector
                skills={inspectedSkills}
                onApprove={onSkillApprove}
                onDisable={onSkillDisable}
                onArchive={onSkillArchive}
                onClearOverride={onSkillClearOverride}
                onRunFormation={() => void onRunFormationNow()}
                isFormationRunning={formationRunning}
              />
            ) : inspectorTab === "preferences" ? (
              (() => {
                const primary = characters[0];
                if (!primary) {
                  return (
                    <div className="p-6 text-xs text-neutral-500">
                      Load a character to see preferences.
                    </div>
                  );
                }
                void characterPrefSettingsVersion; // re-render on settings change
                const settings = getCharSettings(primary.id);
                const forChar = inspectedPreferences.filter(
                  (p) => p.character_id === primary.id
                );
                return (
                  <PreferenceInspector
                    characterName={primary.name}
                    preferences={forChar}
                    settings={settings}
                    identityNotes={loadIdentityNotes(primary.id)}
                    isFormationRunning={formationRunning}
                    formationStatus={preferenceStatus}
                    onRunFormation={() => void onRunFormationNow()}
                    onKeep={onPreferenceKeep}
                    onDismiss={onPreferenceDismiss}
                    onEdit={onPreferenceEdit}
                    onIdentityNotesChange={(notes) =>
                      onIdentityNotesChange(primary.id, notes)
                    }
                    onSettingsChange={(next) =>
                      onCharacterPrefSettingsChange(primary.id, next)
                    }
                  />
                );
              })()
            ) : inspectorTab === "threads" ? (
              <ThreadsInspector
                threads={visibleThreads}
                overrides={threadOverridesRef.current}
                totalBeforeFilter={allThreads.length}
                onAction={onThreadAction}
                onClearOverride={onThreadClearOverride}
                onJumpToMemory={(rid) => {
                  setInspectorTab("memory");
                  // Best-effort: scroll the memory row into view after the
                  // tab swap renders. Memory rows currently aren't keyed
                  // by rid in the DOM; this is intentionally a no-op
                  // beyond switching tabs until that's wired (small follow-up).
                  void rid;
                }}
              />
            ) : inspectorTab === "arcs" ? (
              <ArcInspector
                arcs={arcs}
                overrides={arcOverridesRef.current}
                onAction={onArcAction}
                onClearOverride={onArcClearOverride}
                onJumpToMemory={(rid) => {
                  setInspectorTab("memory");
                  void rid;
                }}
              />
            ) : inspectorTab === "identity" ? (
              <IdentityInspector
                identity={inspectedIdentity}
                onRegenerateSelfModel={onRegenerateSelfModel}
                isRegenerating={isSelfModelRegenerating}
                onDisableTrait={onDisableCoreTrait}
                onEnableTrait={onEnableCoreTrait}
                benchmarkResult={PUBLISHED_BENCHMARK}
              />
            ) : inspectorTab.startsWith("grimoire:") ? (
              (() => {
                const pluginId = inspectorTab.slice("grimoire:".length);
                const contrib = grimoireHostRef.current
                  ?.slots.get("inspector:tab")
                  .find((c) => c.pluginId === pluginId);
                if (!contrib) {
                  return (
                    <div className="p-6 text-xs text-neutral-500">
                      Plugin {pluginId} no longer contributes to this slot.
                    </div>
                  );
                }
                const Component = contrib.component;
                return (
                  <Component
                    pluginId={pluginId}
                    characterId={characters[0]?.id ?? null}
                  />
                );
              })()
            ) : null}
          </div>
        </div>
      </aside>
      {auditOpen && (
        <AuditModal
          characterName={characters[0]?.name ?? "Character"}
          traits={auditTraits}
          onTraitsChange={setAuditTraits}
          onExtract={() => void extractAuditTraits()}
          extracting={auditExtracting}
          report={auditReport}
          running={auditRunning}
          judgeLabel={auditJudge()?.label ?? null}
          onRun={() => void startAudit()}
          onCancel={() => {
            auditCancel.current = true;
          }}
          onJump={jumpToTurn}
          onClose={() => setAuditOpen(false)}
        />
      )}
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
          mcpRegistry={mcpRegistryRef.current}
          yantrikClient={clientRef.current}
        />
      )}
      {promptInspectorOpen && (
        <PromptInspector
          capture={lastPromptCapture}
          onClose={() => setPromptInspectorOpen(false)}
        />
      )}
      {browseGrimoireOpen && (
        <BrowseGrimoireModal onClose={() => setBrowseGrimoireOpen(false)} />
      )}
      {searchOpen && (
        <ChatSearch
          currentTurns={turns}
          currentSessionId={sessionId}
          onClose={() => {
            setSearchOpen(false);
            setHighlightTurnId(undefined);
          }}
          onJumpToTurn={(turnId) => {
            setHighlightTurnId(turnId);
            const el = document.getElementById(`turn-${turnId}`);
            el?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
          onJumpToSession={async (newSessionId, turnId) => {
            await switchSession(newSessionId);
            // give React a tick to render the new session's turns, then jump
            setTimeout(() => {
              setHighlightTurnId(turnId);
              const el = document.getElementById(`turn-${turnId}`);
              el?.scrollIntoView({ behavior: "smooth", block: "center" });
            }, 100);
          }}
        />
      )}
      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
      {wizardElement}
      {lorebookCharacterId &&
        (() => {
          // The same editor handles both per-character and world lorebooks
          // — the YantrikDB namespace prefix is identical (`lorebook:<id>`),
          // it's only the UI labeling that changes. Look the id up in
          // characters first, then worlds.
          const charTarget = libraryCharacters.find(
            (c) => c.id === lorebookCharacterId
          );
          if (charTarget) {
            return (
              <LorebookEditor
                characterId={charTarget.id}
                characterName={charTarget.name}
                worldId={charTarget.world_id}
                client={clientRef.current}
                onClose={() => {
                  setLorebookCharacterId(null);
                  refreshMemories();
                }}
              />
            );
          }
          const worldTarget = worlds.find((w) => w.id === lorebookCharacterId);
          if (worldTarget) {
            return (
              <LorebookEditor
                characterId={worldTarget.id}
                characterName={`world: ${worldTarget.name}`}
                client={clientRef.current}
                onClose={() => {
                  setLorebookCharacterId(null);
                  refreshMemories();
                }}
              />
            );
          }
          return null;
        })()}
    </div>
  );
}

export default App;
