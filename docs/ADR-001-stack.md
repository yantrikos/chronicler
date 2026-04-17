# ADR-001: Tech Stack

**Status:** Accepted (revised 2026-04-17)
**Date:** 2026-04-17

## Decision

**React 19 + TypeScript + Vite + Tailwind + a small Node proxy server**, packaged as a **Docker stack** (`docker compose up`). The stack runs Chronicler + YantrikDB on `localhost` by default.

LLM providers: OpenAI-compatible adapter (covers OpenAI / Ollama / OpenRouter / vLLM / llama.cpp server / nano-gpt / etc.) + Anthropic native. All LLM + MCP calls are **proxied through the Node server** so the browser is immune to CORS blocks and API keys never leave the host.

## Context

Chronicler is a local-first roleplay client that imports the community character-card format (v2/v3). Core promise: trusted cross-session continuity, not agent autonomy. Content is often sensitive (NSFW, deeply personal).

## Rationale for revision

The original v1 of this ADR chose Tauri. That was wrong for the target audience. The LocalLLaMA / self-hosted-AI crowd — the exact users who will adopt Chronicler — already runs SillyTavern, Open WebUI, text-generation-webui, Ollama, and their entire LLM workflow via Docker and local web servers. They have `docker-compose.yml` muscle memory. A native binary installer is *unfamiliar friction*. The original ADR conflated "local-first" with "native app"; in practice local-first means "your data stays on your machine," which a Docker stack bound to localhost satisfies perfectly.

## Rationale for web + Docker

- **Target audience match.** Users of the closest-adjacent tools already self-host with Docker. `git clone && docker compose up -d` is the expected UX.
- **Cross-platform for free.** One image runs on Linux, macOS, and Windows (via Docker Desktop). No per-OS build or signing pipeline.
- **Multi-device access.** Homelab users run the stack on a server and hit it from laptop, phone, tablet — same pattern as Jellyfin, Open WebUI, etc.
- **Distribution.** No macOS notarization, no Windows code signing, no per-platform installer maintenance.
- **Debug.** Browser devtools beat webview devtools.
- **Security model is simple.** Bind to `127.0.0.1` by default. If users want remote access, they put Caddy / Tailscale / a reverse proxy in front — their existing homelab pattern.

## Why a Node proxy, not a pure static site

- **CORS.** Anthropic's API blocks browser origins. Most OpenAI-compat endpoints do too. Calling them from a browser directly is impossible without a server-side relay.
- **API key hygiene.** Keys can live in `.env` on the host, never exposed to the browser's localStorage or network traffic beyond `localhost → provider`.
- **MCP transport.** YantrikDB's MCP streamable-http endpoint is not guaranteed to set permissive CORS headers; proxying side-steps the question.

## What we kept

- React + TypeScript + Vite + Tailwind — all already in place, no rework.
- The entire orchestrator + write-contract + visibility-ACL + tests — transport-agnostic, unchanged.
- The provider adapter model (OpenAI-compat + Anthropic native) — unchanged, now speaks through the server.

## What we dropped

- Tauri shell, Rust sidecar, `src-tauri/` directory.
- Tauri CLI + Tauri SDK dependencies.
- Per-platform packaging story.

## Alternatives rejected

- **Tauri native app.** Was our v1 pick; rejected per audience match.
- **Pure static site + user-run local proxy (Caddy / nginx).** Adds a second config file, worse UX than a single `docker compose up`.
- **Bun for the server.** Not installed on all target machines; sticking with Node for the widest compatibility inside Docker.

## Future doors we're keeping open

- A Tauri shell over the same frontend remains possible if native-feel becomes a real ask (system tray, native notifications, auto-update).
- A mobile PWA install is almost free — the frontend already works in a browser.
