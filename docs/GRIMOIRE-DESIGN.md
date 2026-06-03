# Chronicler Grimoire — Extension Platform Design

**Status**: design locked 2026-06-03 (3-round brainstorm: gpt-5.4 + deepseek-chat + Claude).
**Implementation**: tracked in saga epic #11 (Phase 10: Extension Surface), tasks #53–#54.

---

## Vision

Chronicler Grimoire is the extension platform — a typed, MCP-native plugin system with hot reload, declared capabilities, and three hook flavors that prevent the ordering pathologies that plague legacy roleplay-client plugin systems.

When this ships, the comparison-matrix cell "Extension ecosystem" flips from ❌ to ✅, and the differentiator is concrete: typed orchestration seams + MCP-native external capabilities + first-party Grimoire examples that prove every surface, all shipping with hot reload and a real test harness from day one.

## Core design decisions

**One package format, four contribution surfaces:**

1. **Hooks** — orchestrator lifecycle (`beforeRetrieve` / `afterRetrieve` / `beforeCompose` / `beforeChat` / `afterChat` / `beforeWrite` / `afterWrite`)
2. **Slash commands** — `/`-prefix autocomplete, callable from chat input + programmatically
3. **UI contributions** — slot-based component injection into named, narrow slots
4. **MCP integrations** — register additional MCP servers as tool/resource/prompt providers

Packs (themes, prompt packs, lorebook bundles) are NOT a fifth surface — they're a UX category over the same plugin format. A theme pack is a plugin that contributes CSS via a UI slot; a lorebook pack is a plugin that contributes entries via hooks.

**Three hook flavors** prevent ordering chaos:

- **Observer** — read-only listeners. Multiple plugins compose freely. Lowest trust tier.
- **Augmenter** — additive mutators (append system block, add memory). Multiple plugins compose by accumulation.
- **Strategy** — singleton replaceable seam (summarizer, reranker, exporter, moderation policy). ONE plugin per slot; conflicts surface in settings UI.

Plugin authors declare type per hook. The runtime enforces singleton semantics for strategies.

**MCP as tools + resources + prompts** — registration UI shows all three from day one, even if v1 only executes tools. Resources/prompts become first-class in v2 — MCP resource servers can participate in retrieval as a `mcp:<server>:<uri-pattern>` namespace alongside `character:` / `world:` / etc.

**Branding: "Grimoire"** — manifest `grimoire.json`, SDK `@chronicler/grimoire`, CLI `create-chronicler-grimoire`, GitHub topic `chronicler-grimoire`, in-app "Browse Grimoire." Distinct from "plugin" (generic, ST-tainted) and "extension" (VSCode-tainted).

## Manifest (`grimoire.json`)

```jsonc
{
  "id": "io.chronicler.dice",          // reverse-DNS; npm-namespace-safe
  "name": "Dice Roller",
  "version": "1.0.0",                  // semver
  "apiVersion": "^1.0.0",              // @chronicler/grimoire SDK version
  "description": "Dice slash commands with visual results",
  "author": "Chronicler Labs",
  "license": "MIT",
  "homepage": "https://github.com/yantrikos/grimoire-dice",
  "keywords": ["dice", "rp", "commands"],

  "permissions": {
    "network": ["api.open5e.com"],     // explicit hosts; "*" for any
    "filesystem": "plugin-data-only",  // sandboxed to own data dir
    "llm": false,                       // can call api.llm.*?
    "memory": "read"                    // "read" | "write" | false
  },

  "contributes": {
    "hooks": [
      { "point": "afterChat", "type": "observer", "handler": "onChat" }
    ],
    "commands": ["roll", "coinflip"],
    "ui": {
      "slots": ["inspector:tab"],       // named v1 slots only
      "messageDecorations": []          // v2
    },
    "mcpServers": [
      { "id": "dice-server", "url": "./mcp/dice-server.js" }
    ]
  },

  "settingsSchema": "./settings.schema.json",  // optional JSON Schema
  "entry": "./dist/index.js"
}
```

## SDK shape (`@chronicler/grimoire`)

```typescript
import { defineGrimoire, z } from "@chronicler/grimoire";

export default defineGrimoire({
  id: "io.chronicler.recap",

  settings: z.object({
    enabled: z.boolean().default(true),
    everyNTurns: z.number().int().min(1).default(8),
  }),

  setup(ctx) {
    // Hooks declared at setup time via api.hooks.*
    ctx.hooks.afterWrite.observe(async (event) => {
      const s = await ctx.settings.get();
      if (!s.enabled) return;
      if (event.turnCount % s.everyNTurns !== 0) return;
      const recap = await ctx.api.llm.chat({
        model: "default",
        messages: [/* ... */]
      });
      await ctx.api.memory.write({
        namespace: `session:${event.sessionId}`,
        text: recap.content,
        tier: "canon",
      });
    });

    // Slash command
    ctx.commands.register({
      id: "recap",
      name: "/recap",
      description: "Generate a session recap now",
      run: async (_args, api) => {
        await api.commands.trigger("recap-now");
      }
    });

    // UI slot
    ctx.ui.registerSlot("inspector:tab", {
      label: "Recap",
      component: RecapPanel,
    });
  }
});
```

### Capability-wrapped `api` (passed into all handlers)

- `api.fetch(url, init?)` — host-allowlisted per `permissions.network`
- `api.storage.{get,set,delete,clear}` — scoped KV backed by YantrikDB; per-plugin namespace
- `api.llm.chat(req)` — gated by `permissions.llm`
- `api.memory.{recall,write,update}` — gated by `permissions.memory`
- `api.mcp.{listServers,callTool,readResource,getPrompt}` — call into registered MCP servers
- `api.commands.{register,trigger,list}` — slash command registry access
- `api.logger.{info,warn,error}` — scoped logger with plugin id prefix
- `api.events.{on,off,emit}` — host-emitted lifecycle events only (settings changed, session switched); not arbitrary plugin-defined channels in v1

Enforcement is real for plugins using the SDK. Plugins that import `node:fs` etc. bypass enforcement — documented as "trust boundary; only install Grimoire entries from authors you trust."

## Runtime architecture

```
src/lib/grimoire/
  host.ts           — PluginHost: discover, validate, load, dispose
  loader.ts         — chokidar-watched plugins/ directory; hot-reload
  manifest.ts       — grimoire.json validator (zod schema)
  registry/
    hooks.ts        — hook registry + dispatcher (observer/augmenter/strategy)
    commands.ts     — slash command registry
    slots.ts        — UI slot registry
    mcp.ts          — MCP server registry
  capabilities.ts   — manifest-declared permission checks
  sdk-runtime.ts    — builds the `api` object passed to setup(ctx)
  errors.ts         — error isolation, auto-disable, crash dialog
```

**Hook dispatch contract:**
- Observer: fire-and-forget, errors caught + logged but don't block turn
- Augmenter: awaited in registration order (no priority in v1); returns mutated context; errors caught + plugin auto-disabled
- Strategy: exactly one registered handler invoked; if none, fallback to built-in; user-facing conflict UI if two plugins both register

**Error isolation:** plugin throws unhandled → that plugin disabled for the rest of the session. Banner: "Grimoire entry X crashed during afterChat — disabled. [view stack] [re-enable]". On next launch, fresh attempt. Third crash within first 3 turns → quarantine, requires manual re-enable.

## UI integration

**v1 slots (shipping tonight + this week):**
- `settings:section` — auto-rendered from JSON Schema; the default for every plugin
- `inspector:tab` — new tab in right sidebar (joins memory/character/threads/arcs/prefs)
- `chat:input:toolbar` — buttons next to the send button

**v2 slot expansions (post-launch):**
- `message:decoration` — bottom-of-message components
- `message:renderer` — content-type-keyed renderers (e.g. dice results, image cards)
- `message:contextMenu` — right-click actions on messages
- `character:card:footer` — additions to character card UI
- `session:list:item` — decorations in session list

The slot registry is the load-bearing v1 commitment. New slots added in v2 don't break v1 plugins; expanded API on existing slots requires apiVersion bump.

## MCP integration

**Settings UX (v1):**
- Settings → Tool servers section
- Add server: name, URL, optional auth token, transport (HTTP/SSE)
- Per-server: enable/disable, refresh-catalog, test-connection
- On save: catalog loaded, three sections shown: **Tools** (callable), **Resources** (browse-only v1), **Prompts** (browse-only v1)
- Per-tool: enable/disable toggle

**Per-character gating (v1.5):**
- CharacterEditor → Tools panel
- Checkbox per tool: "this character can use this tool"
- System prompt gets `<available_tools>` block listing only checked tools with schemas

**Orchestrator turn loop (v1.5):**
1. retrieve (unchanged)
2. compose with `<available_tools>` block
3. chat
4. **NEW**: parse tool calls from reply, validate against character policy, execute against right server, collect results
5. **NEW**: if tools were called, send follow-up chat with `<tool_results>` injected; loop until no more tool calls or max-iterations (default 3)
6. write final reply

**Tool result rendering:**
- text → inline
- image url → `<img>`
- audio url → audio player
- structured json → collapsible inspector

## Security model

**Capability declaration** required in manifest. Three tiers of trust:

1. **Pack-like Grimoire entries** — no `entry` field, only `contributes.ui` (CSS) or content. Safe by default.
2. **Trusted local plugins** — full SDK access per declared capabilities. Install dialog shows declared permissions. Enforcement on `api.*`; raw Node APIs bypass-able (documented).
3. **MCP servers** — separate trust boundary; remote/local clearly labeled; per-character gating limits blast radius.

**Install dialog** (mandatory on every new plugin):
> Grimoire entry "Dice Roller" requests:
> - Network access to: api.open5e.com
> - Memory: read-only
> - LLM access: no
>
> Chronicler enforces these declarations on official SDK calls. Plugins can bypass enforcement using raw Node APIs. Only install Grimoire entries from authors you trust.
> [Install] [View source] [Cancel]

**Runtime protections:**
- Hook timeouts (default 30s; configurable per hook type)
- Plugin crash auto-disable
- Safe-mode boot (`?safe=true` URL flag disables all plugins)
- Audit log: every tool call, every capability-gated API call

## Developer experience

**Hot reload (v1):**
- chokidar watches `plugins/**/*.{ts,mjs,js,json}`
- On change: dispose plugin, re-import module, re-call `setup(ctx)`, re-register contributions
- Server-side: Node module cache invalidation + require re-call
- Client-side: Vite HMR for UI components
- Settings, storage, and active state preserved across reloads (unless explicit `dispose()` cleans them)

**Test harness (`@chronicler/grimoire-test`, v1.5):**
```typescript
import { harness } from "@chronicler/grimoire-test";
import plugin from "./index";

const h = harness({ plugin });
const result = await h.runTurn({
  user: "Hello",
  scriptedReply: "Hi!",
});
expect(result.hooks.afterChat.called).toBe(true);
```
- In-memory orchestrator
- Scripted provider (returns pre-configured responses)
- Mock memory store with assertions
- `runTurn()` fires every hook in order and returns full state

**CLI scaffold (v2):**
- `npx create-chronicler-grimoire my-thing`
- Interactive prompts: type, hooks, settings, tests
- Output: working scaffold with `npm test` passing, README, dev script that watches + reinstalls

## Day-one Grimoire slate

First-party examples shipping in `plugins/` to prove every surface:

| # | Grimoire | Surfaces used | Proves |
|---|---|---|---|
| 1 | **Regex Content Filter** | hooks (afterChat observer) | observer pattern, settings schema |
| 2 | **Transcript Exporter** | hooks (afterWrite) + slash command (`/export`) | cross-surface composition |
| 3 | **Dice Roller** | slash command (`/roll`) + UI slot (toolbar) | slash + UI integration |
| 4 | **Memory Inspector** | UI slot (inspector:tab) | UI contribution, makes architecture visible |
| 5 | **Recap Generator** | hooks (afterWrite strategy) + slash command (`/recap`) | strategy hook, memory write |
| 6 | **Web Search** | MCP server registration + hook (afterRetrieve augmenter) | MCP tool calling + retrieval injection |
| 7 | **TTS Voices** | MCP server + UI slot (message decoration v2) | external service, multimodal results |
| 8 | **Image Portrait Generator** | MCP server + UI slot (message renderer v2) | image rendering, character actions |
| 9 | **Character Expressions** | hooks (afterChat) + UI slot (avatar) | visible character extension |
| 10 | **Prompt Style Pack** | hook (beforeCompose augmenter) | pack-style content delivery via hook |

## Distribution

**v1 (tonight + this week):**
- Filesystem install: `plugins/<id>/grimoire.json` + `dist/`
- Symlink support: `ln -s ~/dev/my-plugin plugins/my-plugin` works
- Curated `plugins.json` in our repo listing 6-10 first-party entries
- In-app "Browse Grimoire" modal fetches that JSON, lists entries with "View on GitHub" buttons (manual install instructions)

**v2 (next 2 weeks):**
- One-click install from Browse Grimoire modal (git clone into `plugins/`)
- Automated indexer: GitHub Action scans repos tagged `chronicler-grimoire`, validates manifests, builds community `plugins.json`
- Browse modal shows curated + community entries with filters

**v3 (months out, only if traction):**
- Registry server with versioning, signatures, optional ratings
- npm namespace `@chronicler-grimoire/*` for distribution
- Update notifications, version pinning

## Versioning

- `@chronicler/grimoire` SDK uses semver
- Manifest declares `apiVersion: "^1.0.0"` — host refuses to load incompatible Grimoire entries with clear error
- Deprecation policy: warn in one minor, remove in next major
- Migration codemods provided for breaking changes
- Plugin authors can use feature detection via `ctx.api.capabilities.has("hooks.strategy")`

## Implementation phases

**Tonight (4-6h):**
1. `grimoire.json` manifest spec + zod validator
2. In-tree SDK types in `src/grimoire-sdk/` (becomes `@chronicler/grimoire` package later)
3. `src/lib/grimoire/`: PluginHost, hook dispatcher (observer + augmenter only — strategy in v1.5), error isolation, auto-disable
4. Slash command runtime + `/` autocomplete UI in chat input
5. MCP server registration UX (add/remove/test, list tools+resources+prompts in three sections)
6. Hot reload via chokidar
7. Capability declarations + SDK wrappers (`api.fetch`, `api.storage`, `api.llm`, `api.memory`)
8. 2 first-party Grimoire entries: regex filter + transcript exporter
9. Browse Grimoire modal stub
10. `docs/GRIMOIRE.md` v1 (authoring guide + the 2 examples walkthrough)
11. Update `docs/COMPARISON.md` cell to "🟡 Grimoire: hooks + slash + MCP registration"

**This week (next session):**
- MCP tool calling wired into orchestrator turn loop
- Per-character tool gating UI
- Strategy hook type
- Plugin testing harness `@chronicler/grimoire-test`
- UI slot registry with 3 v1 slots wired
- 4 more first-party Grimoire entries (dice + memory inspector + recap + character expressions)
- npm-publishable `@chronicler/grimoire` package
- COMPARISON.md cell flips to ✅

**Following week (launch candidate):**
- Catalog indexer GitHub Action
- One-click install from Browse modal (git clone)
- CLI scaffold (`create-chronicler-grimoire`)
- Remaining first-party Grimoire entries (web search MCP, TTS MCP, image MCP)
- Capability enforcement worker-thread sandbox (still keeps trusted-local as default)
- Launch announcement copy

## Comparison-matrix differentiator copy

> **Grimoire** — typed, MCP-native extension platform. Hot reload, declared capabilities, three hook flavors that prevent the ordering pathologies older RP clients suffer from. Build a Grimoire entry in TypeScript with full IDE autocomplete, test it with a real orchestrator harness, register MCP tool servers per-character. The first-party Grimoire ships with examples for every surface — dice, TTS, image gen, character expressions, lorebook import, memory inspection, export — so authors learn by reading working code, not archaeology.
