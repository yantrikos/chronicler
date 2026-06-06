# @chronicler/grimoire

TypeScript SDK for authoring [Chronicler](https://github.com/yantrikos/chronicler) Grimoire plugins.

## Install

```bash
npm install --save-dev @chronicler/grimoire
```

## Usage

```typescript
import {
  defineGrimoire,
  type GrimoireManifest,
} from "@chronicler/grimoire";

export const manifest: GrimoireManifest = {
  id: "io.example.my-plugin",
  name: "My Plugin",
  version: "0.1.0",
  apiVersion: "^0.1.0",
  permissions: {
    network: [],
    filesystem: "plugin-data-only",
    llm: false,
    memory: "read",
  },
  contributes: {
    hooks: [{ point: "afterChat", type: "observer" }],
    commands: ["greet"],
  },
};

export default defineGrimoire({
  id: "io.example.my-plugin",

  setup(ctx) {
    ctx.hooks.afterChat.observe(async (event, api) => {
      api.logger.info(`character ${event.character.name} replied with ${event.reply.content.length} chars`);
    });

    ctx.commands.register({
      name: "greet",
      description: "Print a greeting",
      run: async (args) => ({
        kind: "text",
        content: `Hello ${args || "there"}!`,
      }),
    });

    return {};
  },
});
```

## Surfaces

Plugins extend Chronicler via four contribution types:

| Surface | What | Example |
|---|---|---|
| **Hooks** | Lifecycle events in the orchestrator's per-turn pipeline | `afterChat` observer that logs every reply |
| **Slash commands** | `/`-prefix commands typed in the chat input | `/roll 2d6+3` |
| **UI slots** | React components mounted into named host slots | A "stats" tab in the inspector |
| **MCP servers** | External tool/resource providers | TTS, image gen, dice, web search |

Three hook flavors prevent ordering chaos:

- **`observe`** — read-only listener. Multiple plugins compose freely. Errors logged but plugin stays enabled.
- **`augment`** — additive mutator. Multiple plugins compose by accumulation. Errors auto-disable the plugin for the session.
- **`strategy`** — singleton replaceable seam (summarizer, reranker, etc). ONE plugin per hook point; conflicts rejected at registration.

## Hook points

| Point | Receives | Common use |
|---|---|---|
| `beforeRetrieve` | session + character + user message | inject extra retrieval keys |
| `afterRetrieve` | retrieval results | filter or rerank candidates |
| `beforeCompose` | session + character | influence prompt assembly |
| `beforeChat` | system prompt + messages | mutate the LLM input |
| `afterChat` | reply | rewrite, log, content-filter |
| `beforeWrite` | turn data | influence what gets persisted |
| `afterWrite` | finalized turn + turn count | observe, sync to external store |

## Installing your plugin

For development, link the package locally and drop your plugin into Chronicler's plugins directory:

```bash
git clone https://github.com/your-name/your-plugin.git ~/.chronicler/plugins/your-plugin
```

Or via the Browse Grimoire UI in Chronicler: paste your repo URL, click install.

## Permissions

Capabilities are declared upfront in the manifest and enforced when your plugin uses the SDK-wrapped API (`api.fetch`, `api.llm`, `api.memory`). Plugins that bypass the SDK via raw Node modules escape enforcement — documented as the trust boundary.

| Field | Values | Effect |
|---|---|---|
| `network` | `string[]` (hosts) or `["*"]` | Allowed hosts for `api.fetch` |
| `filesystem` | `false` \| `"plugin-data-only"` \| `"read-app-data"` | Filesystem scope |
| `llm` | `boolean` | Whether `api.llm.chat()` is allowed |
| `memory` | `false` \| `"read"` \| `"write"` | YantrikDB access |

## Compatibility

The `apiVersion` field in your manifest declares which SDK version your plugin targets. Chronicler refuses to load plugins whose `apiVersion` doesn't satisfy the host's installed SDK version (via semver).

Current SDK: `0.1.0`. Add `"apiVersion": "^0.1.0"` to your manifest.

## License

MIT
