# Chronicler Grimoire — Authoring Guide

The Grimoire is Chronicler's extension platform. A **Grimoire entry** (or just "a Grimoire") is a typed TypeScript module that extends Chronicler by registering hooks, slash commands, UI contributions, or MCP server integrations.

> Looking for the design rationale? See [GRIMOIRE-DESIGN.md](GRIMOIRE-DESIGN.md). This document is the authoring reference.

## Quick start

The fastest way to learn the contract is to read the two first-party examples in this repo:

- [`src/plugins/regex-filter/`](../src/plugins/regex-filter/) — observer hook + settings schema
- [`src/plugins/transcript-exporter/`](../src/plugins/transcript-exporter/) — observer hook + slash command + storage

Both are ~100 lines and demonstrate the full author surface in <5 minutes of reading.

## Minimum viable Grimoire entry

A Grimoire entry is a directory under `src/plugins/<id>/` (for in-tree plugins shipped with the app) with an `index.ts` that exports:

```typescript
import { defineGrimoire, type GrimoireManifest } from "../../lib/grimoire/types";

export const manifest: GrimoireManifest = {
  id: "io.example.my-thing",
  name: "My Thing",
  version: "0.1.0",
  apiVersion: "^0.1.0",
  description: "What it does",
  permissions: {
    network: [],
    filesystem: "plugin-data-only",
    llm: false,
    memory: "read",
  },
  contributes: {
    hooks: [{ point: "afterChat", type: "observer" }],
  },
};

export default defineGrimoire({
  id: "io.example.my-thing",

  setup(ctx) {
    ctx.hooks.afterChat.observe((event, api) => {
      api.logger.info("character said:", event.reply.content.length, "chars");
    });

    return {
      dispose() {
        // Clean up subscriptions / timers / sockets here.
      },
    };
  },
});
```

That's the whole contract. The host loads this file at startup (via Vite's `import.meta.glob`), validates the manifest, calls `setup(ctx)` with a typed context, and tracks the returned runtime.

## Manifest reference

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | yes | Reverse-DNS-ish unique id (e.g. `io.org.name`). Must match `defineGrimoire({ id })`. |
| `name` | `string` | yes | Human-readable name shown in the Browse Grimoire UI. |
| `version` | `string` | yes | Semver (e.g. `1.0.0`). |
| `apiVersion` | `string` | yes | Semver range targeting `@chronicler/grimoire` (e.g. `^0.1.0`). Host refuses to load incompatible. |
| `description` | `string` | no | One-line description. |
| `author`, `license`, `homepage`, `keywords` | `string[]` / `string` | no | Discovery metadata. |
| `permissions` | `GrimoirePermissions` | no | Capability declarations (see below). |
| `contributes` | object | no | Which surfaces the plugin extends. Used by the host to validate and by Browse UI to render badges. |
| `settingsSchema` | `string` | no | Path to a JSON Schema file (relative to plugin dir). Drives auto-rendered settings UI. |

### Permissions

Capability declarations are enforced when plugins use the SDK-wrapped API (`api.fetch`, `api.llm`, `api.memory`, etc). Plugins that bypass the SDK via raw `fetch` or `import('node:fs')` escape enforcement — this is documented as a trust boundary; users are warned at install time.

| Field | Values | Default | Effect |
|---|---|---|---|
| `network` | `string[]` (hosts) or `["*"]` | `[]` | Allowed hosts for `api.fetch`. Use exact hosts or wildcard `"*.example.com"`. |
| `filesystem` | `false` \| `"plugin-data-only"` \| `"read-app-data"` | `"plugin-data-only"` | Filesystem scope. v1 stores plugin data in localStorage; full FS in v1.5. |
| `llm` | `boolean` | `false` | Whether `api.llm.chat()` is allowed. |
| `memory` | `false` \| `"read"` \| `"write"` | `"read"` | YantrikDB access via `api.memory.{recall,write}`. |

## Hooks

Hooks fire at lifecycle points in the orchestrator's per-turn pipeline. Each hook has a **type** that determines how it composes with other plugins:

| Type | Composition | Errors | Use for |
|---|---|---|---|
| **observer** | Multiple plugins fire in parallel | Logged, plugin NOT disabled | Analytics, telemetry, external-store writes, audit logs |
| **augmenter** | Multiple plugins compose by accumulation (run in registration order) | Plugin auto-disabled on error | Adding to retrieval results, appending system blocks, mutating reply content |
| **strategy** | ONE plugin per hook point (singleton) | Plugin auto-disabled on error; conflicts rejected at registration | Replacing a built-in subsystem: summarizer, reranker, exporter, moderation policy |

Hook points available in v1:

| Point | Fires | Context fields |
|---|---|---|
| `beforeRetrieve` | Before YantrikDB recall | `sessionId`, `character`, `userMessage` |
| `afterRetrieve` | After recall, before compose | `sessionId`, `character`, `results: { canon, scene, heuristic }` |
| `beforeCompose` | Before system prompt assembly | `sessionId`, `character` |
| `beforeChat` | Before LLM call | `sessionId`, `character`, `systemPrompt`, `messages` |
| `afterChat` | After LLM reply | `sessionId`, `character`, `reply`, `mutatedContent?` |
| `beforeWrite` | Before memory writes | `sessionId`, `character`, `userTurn?`, `assistantTurn` |
| `afterWrite` | After memory writes | `sessionId`, `character`, `userTurn?`, `assistantTurn`, `turnCount` |

### Registration

```typescript
setup(ctx) {
  // Observer — read-only, no mutation
  ctx.hooks.afterChat.observe(async (event, api) => {
    api.logger.info("got reply");
  });

  // Augmenter — return mutated context to flow to next handler
  ctx.hooks.beforeChat.augment(async (event, api) => {
    return {
      ...event,
      systemPrompt: event.systemPrompt + "\n\n[my plugin] keep replies short.",
    };
  });

  // Strategy — singleton; throws at registration if another plugin owns the slot
  ctx.hooks.afterChat.strategy(async (event) => {
    return { ...event, mutatedContent: stripHtml(event.reply.content) };
  });

  return { dispose() {} };
}
```

## Slash commands

Slash commands appear in the chat input autocomplete when the user types `/`. The Grimoire host routes invocations to the registering plugin.

```typescript
setup(ctx) {
  ctx.commands.register({
    name: "roll",              // exposed as /roll
    description: "Roll dice notation, e.g. /roll 2d6+3",
    run: async (args, api) => {
      const result = parseAndRoll(args);
      return { kind: "text", content: result };
    },
  });
}
```

`SlashResult` kinds:
- `{ kind: "text", content }` — render as a message in chat
- `{ kind: "system", content }` — render as a system note (small, neutral styling)
- `{ kind: "error", content }` — render as an error (red, prominent)

Plugin-to-plugin: another plugin can invoke your command via `api.commands.trigger("roll", "2d6")`. The target plugin runs with its own manifest permissions, not the caller's.

## The `api` object

Every hook handler and command receives a capability-wrapped `api` object scoped to the plugin:

| Member | Capability-gated by | Notes |
|---|---|---|
| `api.plugin` | always available | `{ id, manifest }` metadata |
| `api.logger.{info,warn,error}` | always | Prefixed console output |
| `api.storage.{get,set,delete,clear}` | always | Plugin-scoped KV (localStorage in v1) |
| `api.settings.{get,set}` | always | Plugin settings; validated against manifest's `settingsSchema` |
| `api.fetch(url, init?)` | `permissions.network` | Host-allowlisted |
| `api.llm.chat({...})` | `permissions.llm === true` | Goes through Chronicler's active provider |
| `api.memory.recall(...)` | `permissions.memory !== false` | YantrikDB recall, scoped to plugin namespace by default |
| `api.memory.write(...)` | `permissions.memory === "write"` | Writes go to `grimoire:<plugin-id>` namespace |
| `api.yantrik()` | always | Direct YantrikClient — escape hatch for advanced use |
| `api.commands.{list,trigger}` | always | Cross-plugin command invocation |

## Lifecycle + hot reload

Plugins are loaded at app startup via Vite's `import.meta.glob('/src/plugins/*/index.ts')`. When you edit a plugin file:
1. Vite HMR re-runs the module
2. The host disposes the existing entry (calls its `dispose()`)
3. The new module is loaded with a fresh `setup(ctx)` call

This means **all your registrations rebind** on every edit. Make sure your `setup()` is idempotent (don't poke external systems just because you re-loaded).

Plugins that throw inside `setup()` get rejected. Plugins whose hooks throw at runtime: observer errors are logged; augmenter/strategy errors auto-disable the plugin for the rest of the session.

## What's NOT in v1

- **Out-of-tree install paths** — for v1, plugins live in `src/plugins/` and ship with the app build. The dynamic loader (drop a folder in `~/.chronicler/plugins/` and it shows up) lands in v2.
- **UI slot mounting** — settings sections and inspector tabs work via auto-rendered JSON Schema and the existing inspector tab API. The full slot registry (sidebar panels, message decorations, custom renderers) lands in v1.5.
- **MCP tool calling in the orchestrator turn loop** — MCP server registration UI lands in v1.5. The substrate (registering servers, listing tools/resources/prompts) is reserved in the manifest.
- **CLI scaffold** — `npx create-chronicler-grimoire` lands in v2.
- **Browse Grimoire catalog** — stub modal in v1, automated indexer in v2.

See [GRIMOIRE-DESIGN.md](GRIMOIRE-DESIGN.md) for the full roadmap.

## Tests

Two test files exercise the host contract:

- [`tests/grimoire-host.test.ts`](../tests/grimoire-host.test.ts) — manifest validation, setup invocation, dispose, hot replace, error isolation per hook type, strategy singleton conflict
- [`tests/grimoire-slash.test.ts`](../tests/grimoire-slash.test.ts) — command registration, prefix match for autocomplete, dispatch, error handling, conflict detection, cleanup on dispose

Run with `npm test` (added to the suite as of v0.3.0).

## Reporting bugs / suggesting hook points

If a plugin you want to build needs a hook point that doesn't exist, open an issue with the use case. New hook points are easy to add (one line in `HookContextMap` + one line in `Orchestrator.turn()`); the bar is "is there a real plugin that needs this?", not "is it theoretically useful?"
