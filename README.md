# Chronicler

**Local-first roleplay client with a memory that actually works.**

Chronicler is an open-source, self-hosted roleplay/character-chat app. You run it on your own machine via `docker compose up`. It imports the community v2/v3 character-card format (chub.ai-compatible), talks to any OpenAI-compatible LLM endpoint (OpenAI, Anthropic, Ollama, OpenRouter, llama.cpp, vLLM, nano-gpt, …), and remembers the things that matter about every character across every session — automatically, locally, without sending anything to a cloud.

> The problem with existing RP clients isn't the UI — it's that memory falls apart after a few sessions. Chronicler is built around a persistent cognitive memory engine (YantrikDB) and a strict three-tier write contract that keeps canon clean and accumulates real continuity over hundreds of hours.

---

## Quick start

```bash
git clone https://github.com/yantrikos/chronicler && cd chronicler
docker compose up -d
open http://localhost:3001
```

Both images are published to GitHub Container Registry — first `docker compose up` pulls them (~500 MB total) instead of building locally. If you modify the code, `docker compose build` rebuilds; subsequent `up` uses your rebuilt image.

Prefer no `git clone`? A single-file install:

```bash
curl -O https://raw.githubusercontent.com/yantrikos/chronicler/main/docker-compose.yml
docker compose up -d
```

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

All of the above is verified by automated tests: `three-day-continuity`, `auto-promote`, `secret-stays-private`, `session-replay`, `lorebook`, `extract`, `mcp-connectivity`. Everything green.

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

## License

TBD before public release.

---

Built by [@spranab](https://github.com/spranab). Powered by [YantrikDB](https://github.com/yantrikos/yantrikdb).

Companion read: [docs/PATTERN.md](docs/PATTERN.md) — a standalone write-up of the memory architecture, useful if you're building anything that needs a trustworthy memory layer on top of a language model.
