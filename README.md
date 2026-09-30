# Chronicler — self-hosted AI roleplay client with long-term memory

**A local-first alternative to SillyTavern, RisuAI, and Faraday, built around memory that survives long campaigns.**

[![Docker images](https://img.shields.io/badge/docker-ghcr.io-blue?logo=docker)](https://github.com/orgs/yantrikos/packages)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-27%2F27%20green-brightgreen)](#develop)

Chronicler is an open-source, self-hosted **AI roleplay and character-chat app** you run on your own machine with `docker compose up`. It imports the community **v2/v3 character card** format (chub.ai-compatible), talks to **any OpenAI-compatible LLM** — Ollama, OpenAI, Anthropic, OpenRouter, llama.cpp, vLLM, nano-gpt — and remembers what matters about every character across every session, automatically and locally, without sending anything to a cloud.

> The problem with existing RP clients isn't the UI — it's that **memory falls apart after a few sessions**. Chronicler is built on a persistent cognitive memory engine ([YantrikDB](https://github.com/yantrikos/yantrikdb)) with a strict three-tier write contract that keeps canon clean and accumulates real continuity over hundreds of hours.

**What you get that other clients don't:** verified long-term memory instead of a rolling summary · per-memory `visible_to` ACL so characters can't recall secrets they were never told · a prompt inspector showing exactly what was sent and why · **native MCP support** (tools, resources, prompts) · an extension SDK on npm.

**Looking for** a SillyTavern alternative with real memory · an AI companion that remembers across sessions · a local/offline character chat app · long-term memory for LLM roleplay · an MCP-native chat client? That's what this is.

---

## Quick start

**Fastest — one file, no clone:**

```bash
curl -O https://raw.githubusercontent.com/yantrikos/chronicler/main/docker-compose.yml
docker compose up -d
open http://localhost:3001
```

Docker pulls both published images (~500 MB total) from [GitHub Container Registry](https://github.com/orgs/yantrikos/packages) and starts the stack. First boot waits ~60s for YantrikDB to finish loading its embedding model.

**Or clone for development:**

```bash
git clone https://github.com/yantrikos/chronicler && cd chronicler
docker compose up -d
```

`docker compose up` prefers the published image; if you modify the source and run `docker compose build`, it rebuilds locally and your image replaces the pulled one.

## Published images

| Image | Purpose | Size |
|---|---|---|
| `ghcr.io/yantrikos/chronicler:latest` | Web + API proxy | ~270 MB |
| `ghcr.io/yantrikos/chronicler-yantrikdb:latest` | YantrikDB MCP server + CPU-only torch | ~1.9 GB |

Both are multi-platform (linux/amd64 + linux/arm64) and rebuilt on every push to `main` via [`.github/workflows/docker-images.yml`](.github/workflows/docker-images.yml). Semver tags (`v0.1.0`, etc.) publish stable versions as they're cut.

## First-run in the app

1. **Settings → Your persona** — name + optional description
2. **Settings → Providers** — add Ollama (local), OpenAI-compat, or Anthropic with a model name
3. **Settings → Extraction provider** (optional) — small/fast model for background fact extraction. **Use 7B or larger** (e.g. `qwen2.5:7b`). Measured 2026-08-04: at 1.5B the extractor cannot reliably follow fact-attribution rules and will write the user's facts as facts about the character — e.g. storing *"Ren's birthday is April 2nd"* when April 2nd is yours and the character merely repeated it back. 7B and 9B attribute correctly. A structural filter catches the worst artifacts regardless of model, but it cannot repair a confidently mis-attributed fact.
4. **Settings → Proactive messages** — off by default; `passive` lets the character take initiative when urges accumulate and you've been idle
5. **+ card** to import a v2/v3 character card, or **demo: Ren** to try the built-in character
6. Type. Memories appear in the right sidebar as they land.

First-run flow:

1. **Settings → Your persona** — set your user name and (optionally) a short description.
2. **Settings → Providers** — add an Ollama (local), OpenAI-compat (nano-gpt / OpenRouter / local endpoints), or Anthropic provider with a model name. For Qwen3-family Ollama models, check "disable thinking" — massive latency cut.
3. **Settings → extraction provider** (optional) — pick a smaller, faster model to run the fact extractor in parallel with generation.
4. **Settings → save.**
5. **+ card** to import a v2/v3 character card (.png or .json), or **demo: Ren** to try a built-in character.
6. Type and send. First reply takes a beat while memories seed; subsequent turns stream.

---

## What makes it different

- **Three-tier write contract.** Every memory is tagged as **reflex** (ephemeral scene state), **heuristic** (inferred, reviewable), or **canon** (durable, user-confirmed). Chat noise doesn't pollute canon; drafts promote to canon only after repeated, uncorrected reinforcement across sessions. Full user-facing inspector with pin / demote / forget / retcon controls.
- **Mechanically enforced privacy in group chats.** Each memory carries a `visible_to` ACL. In a group scene, a character physically cannot recall a secret they weren't told — the retrieval layer filters before ranking. Not prompt-engineered, not relying on the model's discretion.
- **Semantic lorebook replacement.** Community `character_book` entries are honored with full trigger semantics (keys + secondary keys + selective + constant + position + insertion_order + case sensitivity) AND supplemented by semantic recall. Retires the brittle keyword-only mechanic without breaking compatibility.
- **Session replay harness.** Every tier transition logs a structured entry; the auto-promotion threshold can be retuned and replayed against prior sessions to see exactly which promotions would have fired. The "sink-risk" of the whole system is visible and tunable.
- **Anti-confabulation clause.** Prepended to every system prompt: "treat only the facts in `<canon>` and `<scene>` as real, do not reference prior events not in those sections." Combined with the visibility ACL, the model cannot invent memory it wasn't given.
- **"Previously on..." recap at session start.** Pulled from consolidated canon, not raw chat history. Strict anti-confab prompting on the recap itself after we caught (and fixed) a real-world confabulation where the recap misattributed facts.
- **Verified character learning.** Patterns the model shows repeatedly across sessions (deflection styles, conduct rules, decision rituals, lessons from past failures) get distilled into typed `skill_substrate` entries — but only after an LLM verifier passes on each candidate, biased toward rejection. Skills surface back into future prompts when relevant, score `+1` / `−1` from user reactions (regenerate / edit / delete vs accept and move on), and transition through `candidate → active → suppressed → archived` based on accumulated outcomes. There's a "Character development" tab next to "Memory" with approve / disable / archive controls; the local override always wins over the derived state. See [docs/LCDB-v0.md](docs/LCDB-v0.md) for the ablation harness that proves the contract holds.
- **Crystallizing character identity** (Phase 11, *experimental*). Skills that hold up over weeks of sessions promote past `active` into a 5th state, `core_trait` — always-on identity facets like *"Adira is fundamentally guarded with strangers"* that inject into every system prompt unconditionally, alongside a periodically-generated first-person self-model (*"I am Adira. I'm a wandering musician…"*). The Identity inspector makes all of it auditable. **Status, stated plainly:** the substrate and a cross-model benchmark harness both ship, but the benchmark does *not* yet demonstrate model-independent character — mean trait adherence was 0.275, and the run had no control arm. An earlier README claimed "σ=0.087 moderate model-independence"; that was computed on a blended score and is [retracted](docs/CHARACTER-EMERGENCE-RESULTS.md). The gap where the core-trait verifier rejected almost every real trait was found and fixed on 2026-09-29 (it accepted 0–2 of 8 test patterns; it now accepts 5–6 of 8 with no false accepts among 26 negatives — see [IDENTITY-LAYER.md](docs/IDENTITY-LAYER.md)), but promotion still needs days of accumulated evidence and the layer has not yet been shown end to end on real play. A separate **consistency audit** (Settings → More → *Check character consistency*) measures drift from the character card directly. Treat this as research in progress, not a working feature. See [the thesis](docs/CHARACTER-EMERGENCE.md) and [the corrected results](docs/CHARACTER-EMERGENCE-RESULTS.md).

All of the above is verified by automated tests: `three-day-continuity`, `auto-promote`, `secret-stays-private`, `session-replay`, `lorebook`, `extract`, `skill-former`, `skill-outcomes`, `lcdb-v0`, `mcp-connectivity`, `core-trait-promoter`, `self-model-generator`, `identity-aggregator`, `cross-model-benchmark`. Everything green.

For a head-to-head comparison against SillyTavern, RisuAI, and AgnAistic, see [docs/COMPARISON.md](docs/COMPARISON.md). Headline:

| | Chronicler | SillyTavern | RisuAI | AgnAistic |
|---|---|---|---|---|
| Tiered cross-session memory (canon / heuristic / reflex) | ✅ | 🟡 plugin | 🟡 lorebook | 🟡 memory book |
| Anti-confabulation clause built into every prompt | ✅ | ❌ user adds | ❌ | ❌ |
| Memory conflict detection + auto-resolve | ✅ | ❌ | ❌ | ❌ |
| Skills + drift + preferences substrates (3 inspectors) | ✅ | ❌ | ❌ | ❌ |
| **Model-independent character continuity** (substrate-driven) | 🟡 Phase 11 — substrate + benchmark harness ship; the effect is **not yet demonstrated** ([results, with correction](docs/CHARACTER-EMERGENCE-RESULTS.md)) | ❌ | ❌ | ❌ |
| Prompt inspector with token budget + retrieval reasoning | ✅ | 🟡 structure only | 🟡 | ❌ |
| Group-chat memory ACL (`visible_to`, retrieval-time filter) | ✅ | ❌ prompt-level | ❌ | ❌ |
| Scene Intensity dropdown (first-class, no jailbreak) | ✅ | ❌ | ❌ | ❌ |
| Extension ecosystem | ✅ Grimoire (v0.3 hooks + slash + UI slots + MCP tools/resources + npx scaffold) | ✅ huge | 🟡 | 🟡 |

---

## Table-stakes RP features

Because the above is wasted if you can't actually RP:

- **Edit / delete / regenerate / continue / swipes** — hover any message for the toolbar; cycle swipes on the last reply with ‹ › arrows.
- **Impersonate user** — click "impersonate" near the Send button and the LLM suggests your next line, which you can edit before sending.
- **Character avatars** — embedded card PNG image, or initials fallback with deterministic color per character.
- **Markdown rendering** — `**bold**`, `*italic*`, code, block quotes, lists.
- **Streaming tokens** — see the reply appear word by word.
- **Author's note** — persistent scene-level steering instruction, per-session.
- **Alternate greetings** — dropdown picker for multi-greeting cards.
- **Sampling controls** — temperature, top_p, top_k, min_p, repetition_penalty; per provider.
- **Prompt inspector** — see the exact system prompt + history sent to the LLM on every turn, including which lorebook entries activated.
- **Session list** — switch between past chats, rename, delete, export each as a Markdown transcript.
- **Backup / restore** — export full config + characters + all sessions as a single JSON for machine-to-machine transfer.
- **User persona** — set your name + a short self-description, injected into every system prompt.
- **Group chats** — add a second character; each turn composes context from that character's POV only (privacy ACLs enforced live).

---

## Updating

```bash
docker compose pull
docker compose up -d
```

Pulls the latest published images and restarts. Your memory DB persists in the named volume (`chronicler-memory`) across restarts.

## Stack

- **Frontend:** React 19 + TypeScript + Vite + Tailwind v4 + react-markdown
- **Server:** tiny Node HTTP proxy — serves the built SPA, routes `/api/mcp/*` to YantrikDB, routes `POST /api/llm` to configured providers (keeps API keys host-side, no browser CORS)
- **Memory:** [YantrikDB](https://github.com/yantrikos/yantrikdb) — local semantic memory with knowledge graph, conflict detection, consolidation, temporal triggers, personality inference, procedural memory
- **LLM:** Ollama native (`/api/chat` with `think: false` support) + OpenAI-compatible + Anthropic native; streaming on all three

See [docs/ADR-001-stack.md](docs/ADR-001-stack.md) for why web+Docker over native (yes, we pivoted from Tauri).

## Architecture

```
┌─── browser (React + TS) ──────────────────────────┐
│  ChatPane    SessionList    MemoryInspector      │
│  Settings    PromptInspector                     │
└───────────────────────────┬───────────────────────┘
                            │ fetch
                            ▼
┌─── Node proxy (same origin) ──────────────────────┐
│  /api/mcp/*  → transparent reverse proxy         │
│  POST /api/llm → { target_url, method, headers,  │
│                     body }  → upstream provider  │
│  /  /index.html  → serves dist/                  │
└──┬─────────────────────┬──────────────────────────┘
   │                     │
   ▼                     ▼
┌─────────────┐    ┌──────────────┐
│  YantrikDB  │    │ any LLM      │
│  (docker    │    │ (Ollama /    │
│   service)  │    │  Anthropic / │
│             │    │  OpenAI API) │
└─────────────┘    └──────────────┘
```

## Repo layout

```
chronicler/
  server/index.mjs              Node proxy + static
  src/
    lib/
      yantrikdb/                typed MCP client + conventions
      orchestrator/             per-turn pipeline, compose, write, extract, scene,
                                auto-promote, lorebook scanner, anti-confabulation
      cards/                    v2/v3 parser + decomposition
      providers/                OpenAI-compat / Anthropic / Ollama / Mock
      session/                  lifecycle, store, markdown export
      recap/                    previously-on generator
      instrumentation/          promotion + session logs (redacted by default)
    components/
      Chat/                     ChatPane with recap + swipes + toolbar
      Inspector/                MemoryInspector + PromptInspector
      Sessions/                 SessionList
      Settings/                 SettingsPanel
    App.tsx
  Dockerfile                    web build + runtime
  yantrikdb.Dockerfile          yantrikdb-mcp image with CPU-only torch
  docker-compose.yml            both services wired
  docs/
    ADR-001-stack.md            why web+Docker
    ADR-002-memory-conventions.md   the three-tier write contract
    DOGFOOD.md                  pre-launch testing protocol
    PATTERN.md                  the reusable memory pattern (standalone read)
  tests/                        seven test suites, all required to ship
```

## Privacy

- All traffic binds to `127.0.0.1` by default. Remote access requires you to remove that binding yourself and add an auth layer in front (Tailscale / Caddy).
- LLM API keys live in your browser's localStorage and in the proxy request body; they never leave your machine except to reach the provider you configured.
- Promotion and session logs redact memory text by default. Opt into verbose local-only logging with `CHRONICLER_VERBOSE_LOGS=1`.
- **Session content is never transmitted to anywhere except your configured LLM provider.** The YantrikDB service runs alongside Chronicler in the same Docker network; your memories never leave your machine.
- Group-chat privacy is enforced mechanically via per-memory `visible_to` ACLs and pre-ranking retrieval filters — verified by `tests/secret-stays-private.test.ts`.

## Reporting bugs / getting involved

- **Bugs and usage questions** → [SUPPORT.md](SUPPORT.md). GitHub Issues is intentionally disabled because session content is often sensitive; structural bugs route to Discussions, content-bearing reports route to private email.
- **Contributing code** → [CONTRIBUTING.md](CONTRIBUTING.md). Scope is narrow and deliberate; discussion-first for new feature areas.
- **Security** → [SECURITY.md](SECURITY.md). Private email, coordinated disclosure.
- **Code of Conduct** → [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Contributor Covenant 2.1 + project-specific notes.

## Develop

```bash
npm install

# frontend dev with HMR (expects API sidecar on :3001)
npm run dev

# second terminal: API sidecar
npm run dev:server

# full prod-mode run
npm run build && npm start

# seven-suite test run (pure TS, no services required)
npm test

# live MCP integration smoke (requires compose stack running)
npm run test:integration
```

## Non-goals (deferred by design, not oversight)

- Autonomous character behavior / personality evolution without user consent — see `docs/ADR-002` for why this is a soft-suggestion-only feature
- Mobile-responsive layout — desktop browser first
- Image generation / TTS / sprite expressions — leave to adjacent tools
- A hosted SaaS offering — this is self-hosted by design
- Full plugin ecosystem — intentionally closed surface until dogfood signal says otherwise

## Related projects

Chronicler is the roleplay client. The memory underneath it is a separate stack you can use on its own:

- [yantrikdb](https://github.com/yantrikos/yantrikdb) — the cognitive memory engine Chronicler stores canon in: temporal decay, consolidation, contradiction detection. Rust with Python bindings, Apache-2.0.
- [yantrikdb-mcp](https://github.com/yantrikos/yantrikdb-mcp) — the same memory as an MCP server for Claude Code, Cursor and Windsurf (`pip install yantrikdb-mcp`). This is what Chronicler's docker-compose runs.
- [yantrikdb-server](https://github.com/yantrikos/yantrikdb-server) — HTTP gateway and HA cluster, if you want one memory store behind several clients.
- [@chronicler/grimoire](https://www.npmjs.com/package/@chronicler/grimoire) — the plugin SDK for extending this app (hooks, slash commands, UI slots, MCP integration).

## License

MIT — see [LICENSE](LICENSE).

Chronicler talks to [YantrikDB](https://github.com/yantrikos/yantrikdb) over
its MCP server (the default in `docker-compose.yml`). The engine is Apache-2.0
as of 2026-08-18, so both sides of that boundary are permissive and nothing
here imposes obligations on your own code or a service you host.

---

Built by [@spranab](https://github.com/spranab). Powered by [YantrikDB](https://github.com/yantrikos/yantrikdb).

Companion read: [docs/PATTERN.md](docs/PATTERN.md) — a standalone write-up of the memory architecture, useful if you're building anything that needs a trustworthy memory layer on top of a language model.
