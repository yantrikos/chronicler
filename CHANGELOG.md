# Changelog

All notable changes to Chronicler are documented here. Versions follow [Semantic Versioning](https://semver.org/); pre-1.0 releases may include breaking changes between minor versions.

## [0.1.0] — 2026-04-17 — First public release

Initial release. Everything below was shipped together over the initial build sprint.

### Added — core memory architecture

- Three-tier write contract (reflex / heuristic / canon) implemented as a metadata convention on YantrikDB primitives, not a schema fork
- LLM-based fact extractor (HybridExtractor: regex for reliable signals + strict-JSON LLM for inference) — malformed LLM output is silently dropped instead of polluting memory
- Anti-confabulation clause prepended to every system prompt; rejects invention of facts not in `<canon>` or `<scene>`
- Auto-promotion heuristic (heuristic → canon) with default threshold of 3 reinforcements across 2 sessions within 14 days, no corrections
- Session replay harness with structured per-decision logging — makes the auto-promotion calibration dial actually tunable
- Visibility ACLs (`metadata.visible_to`) enforced pre-ranking in retrieval; group-chat privacy is mechanically impossible to leak
- Lorebook scanner with full v2/v3 `character_book` semantics (keys + secondary_keys + selective + constant + position + insertion_order + case_sensitive + enabled)
- Retcon support via `canonical_status` field (canon / non-canon / dream / alternate-timeline / deleted-scene); memories stay retrievable but are rendered with status-appropriate framing
- Token-budgeted context composition (40% canon / 25% scene / 20% heuristic / 10% graph; total 4000 tokens default)
- Per-session `think()` consolidation on session end
- "Previously on..." recap generator pulling from consolidated canon, with strict anti-confab prompting (after real-world confabulation where we caught the recap misattributing facts)

### Added — stack

- React 19 + TypeScript + Vite + Tailwind v4 + react-markdown
- Node HTTP proxy server — serves built SPA, proxies `/api/mcp/*` to YantrikDB, proxies `POST /api/llm` to configured LLM providers (keeps API keys host-side, bypasses browser CORS)
- Docker Compose stack (`docker compose up -d`) bundling Chronicler + YantrikDB with isolated persistent volume, binding to `127.0.0.1` by default
- Official Model Context Protocol SDK for YantrikDB transport (streamable-http + SSE support)

### Added — providers

- Ollama native (`/api/chat` with `think: false` support for Qwen3)
- OpenAI-compatible (OpenAI, OpenRouter, nano-gpt, vLLM, llama.cpp server, etc.)
- Anthropic native
- Streaming on all three via SSE
- Per-provider sampling controls (temperature, top_p, top_k, min_p, repetition_penalty)
- Separate extraction-provider setting (smaller/faster model for background fact extraction)
- Mock provider for tests

### Added — RP client features

- v2/v3 character card import (PNG + JSON), avatar extraction, lorebook preservation, round-trip raw card storage
- Alternate greetings with dropdown picker
- User persona (name + description) injected into system prompt
- Author's note (per-session persistent steering instruction)
- Live token streaming with cursor caret
- Message primitives on hover: edit / delete / regenerate / continue / impersonate
- Swipes on the last assistant turn (‹ X / N › counter + navigation)
- Impersonate-user button (LLM generates your next line, editable before send)
- Character avatars from card PNG or deterministic initials fallback
- Markdown rendering in chat bubbles and recap banner
- Session list with rename, delete, per-session Markdown export
- Group chat with per-character context composition, speaker selector, visibility-aware retrieval
- Memory inspector with tier filtering (Canon / Drafts / Scene / All), pin / demote / forget / retcon controls
- Prompt inspector modal — see exactly what was sent to the LLM on the last turn, with per-section token counts
- Settings: memory backend, providers, persona, sampling, extraction-provider selector, backup export/import

### Added — tests

- `three-day-continuity` (the MVP gate — day-3 recap correctness)
- `auto-promote` (sink-risk mechanics)
- `extract` (structured-JSON extraction + adversarial inputs)
- `secret-stays-private` (marquee demo property)
- `session-replay` (tuning harness)
- `lorebook` (trigger semantics)
- `mcp-connectivity` (live stack integration smoke)
- `drive-session` (live end-to-end driver against real YantrikDB + real Ollama)

All 7 automated suites required to pass before any release.

### Added — docs

- README with positioning, quick start, feature list, architecture diagram
- ADR-001: stack decision (Tauri → web+Docker pivot rationale)
- ADR-002: memory metadata conventions / three-tier write contract
- DOGFOOD.md: pre-launch testing protocol with pre-declared ship/no-ship rules
- PATTERN.md: standalone write-up of the reusable memory pattern
- SUPPORT.md: reporting flow with privacy-safe hygiene
- CHANGELOG.md (this file)

### Added — branding

- SVG icon / favicon / apple-touch-icon, three-bar mark representing the tier contract
- Logo + Mark React components, full wordmark or mark-only based on context
- EmptyState splash for new users
- PWA manifest for install

### Security / privacy defaults

- All traffic binds to `127.0.0.1` unless you actively remove that binding
- `promotion-log` and `session-log` redact free-text fields by default; verbose mode requires `CHRONICLER_VERBOSE_LOGS=1` (local-only)
- GitHub Issues disabled on the repo; session-content bug reports route to private email per SUPPORT.md
- API keys carried in proxy request bodies that stay on localhost — never in the browser's network traffic to external origins

### Licensed

- MIT (this repo)
- YantrikDB dependency remains AGPL-3.0 — does not propagate to Chronicler via the MCP boundary

### Deferred to post-1.0

- Light-mode theme (dark-only for now; full theming pass is a standalone refactor)
- Message search across sessions
- Mobile-responsive layout (desktop-first)
- Image generation / TTS / sprite expressions
- Instruct-template-per-model (not needed on current providers; would be needed for raw `llama.cpp` server users)
- Lorebook extensions beyond v2/v3 spec (recursive scanning, probability/priority, arbitrary-depth injection)
- Personality inference as reviewable suggestions (YantrikDB supports it; UI not wired)
- Temporal triggers (stale subplots surfacing) — YantrikDB supports; UI not wired
- Tauri native wrapper (possible future, web+Docker is primary)
