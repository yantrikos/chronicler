# Changelog

All notable changes to Chronicler are documented here. Versions follow [Semantic Versioning](https://semver.org/); pre-1.0 releases may include breaking changes between minor versions.

## [0.3.1] — 2026-06-06 — Preferences substrate round-trips

Bug fix: the preferences substrate appeared empty in the inspector even after the verifier successfully wrote 12 entries. Root cause: YantrikDB's `memory.list` and `recall` responses don't include the `metadata` map at all (verified empirically by direct MCP probe — write with `pref_state: "active"` then read returns no metadata field). The substrate was writing fields YantrikDB never exposed back.

**Fix**: encode the structured preference fields (state, level, sensitivity, evidence, polarity, etc.) in the text body itself with a marker prefix:

```
__GRIMOIRE_PREF_V1__
{"id":"...","state":"active","interpretation_level":"interpretation",...}
__END_PREF__
Adira likes long verbal teasing before any touch
```

The human-readable statement still appears at the end so `recall` snippets stay meaningful. Reads parse out the JSON; rows without the marker (pre-fix entries) are silently skipped.

Files: `src/lib/preferences/substrate.ts` (encode/decode helpers + writePreference/listPreferences rewritten + updatePreferenceState now uses delete+rewrite since metadata-update endpoints have the same strip behavior), `src/App.tsx` (pass `characterId` to updatePreferenceState), `src/lib/orchestrator/preference-former.ts` (same).

**Migration**: existing preference entries written before this fix are unparseable (no marker, no metadata to recover) and silently skipped at read time. Users re-run "look for patterns now" to regenerate; this should be a sub-second operation since the verifier's per-character cache produces the same items deterministically given the same memory inputs.

This closes the loop on the preferences feature shipped in v0.2.0 — the original substrate→verifier→state-machine→prompt-injection chain is now end-to-end demonstrable. Verified live: Adira yielded 3 new preferences from a single formation pass on local Ollama, all visible in the inspector.

---

## [0.3.0] — 2026-06-06 — Grimoire ships

The Phase 10 extension platform — Grimoire — is now a real ecosystem, not a substrate demo. Out-of-tree plugin install via the host volume mount with an in-app install wizard, a typed SDK package, a CLI scaffold, MCP tool calling with per-character gating, and **MCP resources as canon-equivalent retrieval** (the differentiator no other OSS RP client touches). The COMPARISON.md cell flips from 🟡 to ✅.

### Compared to v0.2.1, what closes the gaps

v0.2.1's CHANGELOG enumerated everything 0.2.1 was missing for a real Grimoire ship. Here's what 0.3.0 closes:

- ✅ **Out-of-tree install path** — drop a plugin folder into `~/.chronicler/plugins/<id>/` on the host, chronicler picks it up with hot reload. Server-side esbuild bundles TS source; chokidar watches the dir tree; SSE events drive browser-side dynamic re-import.
- ✅ **In-app install wizard** — Browse Grimoire modal accepts a git URL, server-side runs `git clone` into the mount, browser dynamic-imports, registers with the host. One-click install from any public github repo.
- ✅ **`@chronicler/grimoire` published as an SDK package** — `packages/grimoire-sdk/` with full type surface + `defineGrimoire` runtime + README. Plugin authors get real types via `npm install --save-dev @chronicler/grimoire`. (Publish step is a follow-up; package builds cleanly.)
- ✅ **`create-chronicler-grimoire` CLI scaffold** — `npx create-chronicler-grimoire my-plugin` → interactive prompts, four template choices (hook-only / slash-command / ui-slot / full), optional `npm install`. From zero to editing in <60 seconds.
- ✅ **MCP tool calling end-to-end** — OpenAI tools format threaded through the orchestrator turn loop. The model sees `serverId__toolName` qualified functions, calls them, the registry executes, results inject as `role: "tool"` messages, loop continues up to 3 iterations. Chat UI renders 🔧 bubbles with markdown for image/audio/text/json results.
- ✅ **Per-character tool gating** — checkbox grid in CharacterEditor with explicit `configured` flag disambiguating "default allow all" from "explicit deny all". Defense in depth at both definition collection and execution time.
- ✅ **MCP resources as retrieval source** — new `mcp:<serverId>:<uri>` namespace materialized as `RecallResult`-shaped rows that merge into canon-equivalent retrieval. Per-character opt-in with default-DENY (resources cost network + need explicit choice). 5-minute TTL cache. Parallel fetch with YantrikDB recalls. **This is the differentiator no other OSS RP client touches** — community lore servers, sourcebook scrapers, world databases all compose into a character's available context.

### Published to npm

- [`@chronicler/grimoire@0.1.0`](https://www.npmjs.com/package/@chronicler/grimoire) — `npm install --save-dev @chronicler/grimoire`
- [`create-chronicler-grimoire@0.1.0`](https://www.npmjs.com/package/create-chronicler-grimoire) — `npx create-chronicler-grimoire my-plugin`

Still open (deferred to 0.4):
- 🟡 **Memory Inspector plugin is still a structural demo.** UI slot wiring works; live `api.memory` from slot components needs prop-contract extension (next iteration).
- 🟡 **Preferences-on-reasoning-models** bug from v0.2.0 still open (saga #52). Local Ollama/Qwen models work normally; the bug only affects providers routing to reasoning models like deepseek-r1.

### v0.2.1 → v0.3.0 commit log (9 commits)

| Commit | Title |
|---|---|
| `3bea4a8` | grimoire: phase 10 foundation — typed plugin platform with hooks, slash, ui slots |
| `b9f0fe9` | grimoire: mcp server registry + settings UX (tool calling next) |
| `9dd42cb` | grimoire: mcp tool calling in the orchestrator turn loop |
| `8b04021` | grimoire: per-character mcp tool gating |
| `aeaa323` | chore: bump to 0.2.1 — Grimoire substrate (Phase 10 iteration) |
| `8e9e92f` | grimoire: out-of-tree plugin install via host volume mount |
| `745d531` | grimoire: in-app install wizard + uninstall + dynamic-loader tests |
| `751264a` | grimoire: fail install fast on git auth prompts, friendlier errors |
| `caed7a2` | grimoire: mcp resources as retrieval source + @chronicler/grimoire sdk package + create-chronicler-grimoire cli |

### Test suite

22/22 test files green:
- New since 0.2.0: `grimoire-host`, `grimoire-slash`, `grimoire-slots`, `mcp-registry`, `mcp-tool-loop`, `character-gating`, `grimoire-dynamic-loader`, `mcp-resources` (~60 new assertions)
- All 14 pre-existing test files still green

### Compared to the field

`docs/COMPARISON.md` Extension ecosystem cell flips from 🟡 to ✅. The differentiator copy:

> Typed SDK on npm, hooks (observer/augmenter/strategy), slash commands, hot reload, UI slots, MCP server registration + tool calling + per-character gating + **MCP resources as canon-equivalent retrieval**, out-of-tree install via `~/.chronicler/plugins/` mount with in-app git-URL install wizard, `npx create-chronicler-grimoire` scaffold.

The MCP-resources angle is the differentiator nobody else touches: third-party MCP servers exposing URI-addressable lore/canon data participate in retrieval alongside character/world canon. Community plugins can ship a server that exposes 10,000 forgotten-realms entries; a character opts in, those entries surface as canon-equivalent retrieval. The same MCP servers built for Claude Code, Cline, Zed, etc. work natively here. The ecosystem multiplier is real.

### Reference plugin

[`yantrikos/chronicler-grimoire-stats`](https://github.com/yantrikos/chronicler-grimoire-stats) — a community Grimoire plugin demonstrating three surfaces (afterWrite observer, `/stats` slash command, `inspector:tab` UI slot) in one repo. Zero permissions, MIT licensed, installable in one click via the Browse Grimoire modal. The pattern for community plugins.

---

## [0.2.1] — 2026-06-03 — Grimoire substrate (Phase 10 iteration, not the public ship)

Substrate work on the Phase 10 extension platform. The plumbing landed: typed plugin host, four contribution surfaces, MCP server registration, tool calling end-to-end with per-character gating, four first-party Grimoire entries. The **experience** isn't there yet — no out-of-tree install, no testing harness, no CLI scaffold, no community plugins exist. This is iteration toward the actual Grimoire ship at 0.3.0; tagged as 0.2.1 to keep the version namespace honest.

### Grimoire foundation (commit 3bea4a8)

- **Typed plugin platform**. Plugins live in `src/plugins/<id>/` with a `grimoire.json` manifest; loaded at boot via Vite's `import.meta.glob` with HMR for hot reload.
- **Four contribution surfaces wired**:
  - Hooks at 7 orchestrator lifecycle points with three flavors (observer / augmenter / strategy). Errors isolated per plugin; augmenter/strategy throws auto-disable until next launch.
  - Slash commands with `/`-prefix autocomplete in chat input; results render as synthetic system turns. Plugin-to-plugin invocation routes through the host with the target plugin's permissions.
  - UI slots (typed `SlotPropMap` for `inspector:tab` + `chat:input:toolbar` + `settings:section`). Plugin tabs render in the inspector strip with violet underlines.
  - MCP server registration (substrate; tool calling shipped in 9dd42cb below).
- **Capabilities** (network / filesystem / llm / memory) declared in manifest and enforced on the SDK-wrapped `api`. Plugins that import raw node modules bypass enforcement — documented as the trust boundary.
- **Four first-party Grimoire entries**:
  - `regex-filter` — afterChat observer + settings schema
  - `transcript-exporter` — afterWrite observer + `/export` slash command + scoped storage + browser-side markdown download
  - `dice-roller` — `/roll` / `/flip` / `/pick` with full dice notation parsing
  - `memory-inspector` — `inspector:tab` slot mount with React component (structural demo; live recall path is v0.4)

### MCP server registry + settings UX (commit b9f0fe9)

- **`src/lib/mcp/`** — `types.ts` (`McpServerConfig`, shaped `McpToolCallResult` discriminated union), `external-client.ts` (wraps the official `@modelcontextprotocol/sdk` Client with lazy connect, catalog loading, shaped tool-call results), `registry.ts` (localStorage-persisted configs, lifecycle, subscribe).
- **Settings UI** (`McpServersSection.tsx`) — add-server form, per-server enable/test/refresh/remove, three-column catalog browser (Tools / Resources / Prompts) with status chips.

### MCP tool calling in the orchestrator turn loop (commit 9dd42cb)

- **`ChatRequest.tools` + `ChatResponse.tool_calls`** in the OpenAI-compat provider; serializes `role: "tool"` messages and `tool_calls` on assistant turns per the OpenAI spec.
- **`src/lib/orchestrator/tool-loop.ts`** — `collectTools` (qualified names as `serverId__toolName`), `runToolLoop` (3-iteration cap, parallel execution per iteration, OpenAI-spec tool_call_id round-trip), `splitQualified` helper, `formatToolResultForModel` for context shaping.
- **Orchestrator integration** — `mcpRegistry` optional dep, tool-loop path bypasses streaming (per-iteration full responses needed for `tool_calls` detection).
- **Chat rendering** — tool invocations become synthetic system turns with 🔧 markdown bubbles; image URLs render as `<img>`, audio as link, JSON as code block, errors get ⚠.

### Per-character MCP tool gating (commit 8b04021)

- **`src/lib/mcp/character-gating.ts`** — localStorage round-trip with `configured: boolean` flag that disambiguates "default allow all" from "explicit deny all"; `resolveAllowedTools()` returns `undefined` for default and a `Set<string>` otherwise.
- **`CharacterToolGating.tsx`** — checkbox grid in CharacterEditor grouped by server, per-server "all" / "none" buttons, "reset to default" to drop the explicit allowlist.
- **Defense in depth** — gating filters at both tool-definition collection time (model never sees denied tools) AND at execution time (rejects unlisted tools even if the model hallucinates them).

### Test suite

19/19 test files green:
- New: `grimoire-host`, `grimoire-slash`, `grimoire-slots`, `mcp-registry`, `mcp-tool-loop`, `character-gating` (40+ new assertions)
- Existing 13 files all still green

### What 0.2.1 does NOT include (gating 0.3.0 → the real Grimoire ship)

- **No out-of-tree install path**. Plugins live in `src/plugins/`; users can't drop one in `~/.chronicler/plugins/` and have it load. v0.4 work.
- **No third-party plugins exist**. Only first-party examples.
- **Memory Inspector plugin is a structural demo**, not a functional inspector. The slot wiring works but live `api.memory` from UI slots isn't plumbed yet.
- **MCP value is invisible without a server registered**. Users without one see just an empty "Tool servers" section.
- **No plugin testing harness package** (`@chronicler/grimoire-test`).
- **No CLI scaffold** (`npx create-chronicler-grimoire`).
- **No MCP resources as retrieval source** — the `mcp:<server>:<uri>` namespace integration is v0.4.
- **Preferences-on-reasoning-models** bug from v0.2.0 still open ([saga #52](https://github.com/yantrikos/chronicler)).

### Compared to the field

`docs/COMPARISON.md` cell stays at 🟡 with updated copy reflecting MCP tool calling + per-character gating. The cell flips to ✅ at 0.3.0 when the install path + testing harness + at least one real community plugin ship together.

### Versioning rationale

Strict semver would call this a minor bump (new features, no breaks). Pre-1.0, version numbers are signaling release-readiness more than feature/fix distinction. 0.2.1 keeps 0.3.0 reserved for the launch-worthy Grimoire milestone — substrate iteration shouldn't burn a minor.

---

## [0.2.0] — 2026-06-03 — Phase 9: Interactive Memory + ST-parity polish

The biggest single release since v0.1. Phase 9 turns verified memory from passive retrieval into a user-steerable, character-visible system: arcs, relationship drift, retrieval provenance, scene intensity, and character preferences ship as five distinct inspector tabs and three new long-memory substrates. Alongside Phase 9, this release bundles ~6 weeks of pre-Phase-9 work that never made it to a tagged release — provider matrix expansion (Gemini, OpenRouter, nano-gpt streaming polish), Story / continue mode, World Info (global lorebooks), Tier B power features (token visualizer, branching, search), and scene presets.

### Phase 9 — Interactive Memory pillars

- **Arcs.** Cross-session narrative arcs grouped by entity / conflict / goal, with active / paused / resolved / abandoned states. The "return after a week" continuity feature: open the **arcs** tab and see what was live, what stalled, what to pick up.
- **Relationship drift.** Dyadic axes (trust ↑↓, dependency, defensiveness, openness) surface as canon-grounded labels on the **character** tab — not abstract personality scores but tagged shifts pointing at specific memories.
- **Retrieval provenance.** Each memory row carries `why_retrieved` chips ("entity:Mara", "tier:canon", "query_match:0.84") in the **memory** tab. The prompt inspector now shows the exact reason every memory was surfaced this turn.
- **Scene Intensity.** Session-level dropdown — Neutral / Fade to Black / Tasteful / Explicit — that injects an editable `<intensity>` snippet into the system prompt. First-class control, not a jailbreak. Explicit mode is uncensored by design; output filtering remains permanently off the table.
- **Character Preferences.** New `preferences:<character_id>` substrate with a 3-axis schema (interpretation_level × sensitivity × state machine) and brake mechanics against self-reinforcement. New **prefs** tab with Limits / Private / Preferences sections, identity notes, and per-character settings. Verifier-gated: nothing reaches the prompt unless you say "yes, that's her." Limits always require one-click confirmation (safety floor). 23 verifier tests cover identity-label rejection, regex final-guard, sensitivity-class invariants, brake mechanics, and dedup.

### Pre-Phase 9 — bundled work

- **Provider matrix.** Native Gemini provider, OpenRouter, nano-gpt; streaming polish across all providers; reasoning-field fallback (deepseek-r1, gpt-5 thinking) so verifier subsystems work even when models emit JSON via `message.reasoning` instead of `message.content`.
- **Story / continue mode.** Long-form narrative mode that maintains paragraph cohesion across turns.
- **World Info.** Global lorebooks attached at world scope, not just per-character. Position-aware (before_char / after_char) injection.
- **Tier B power features.** Per-turn token visualizer showing the actual budget breakdown; chat branching (alt timelines on any turn); chat-wide regex search.
- **Scene presets.** Sampling preset library (Slow Burn / High Heat / Companion / Storyteller) with per-character pinning.
- **Verified character learning v2.** Skill substrate (procedure / pattern / rule / lesson / reference) with verifier-gated define + outcome loop reinforcement + state machine (candidate → active → suppressed → archived).

### Compared to the field

- New [docs/COMPARISON.md](docs/COMPARISON.md) — head-to-head capability matrix against SillyTavern, RisuAI, and AgnAistic. README gets the headline 8-row summary.

### Test suite

12 test files, all green: three-day-continuity, auto-promote, extract, secret-stays-private, session-replay, lorebook, skill-former, skill-outcomes, lcdb-v0, slash, arcs, relationship-drift, preference-former.

### Notes

This release collapses what was internally tracked as 0.2.0 → 0.4.0 milestone bumps into a single tagged version. Internal milestone notes preserved below for anyone who wants the day-by-day shape of the work.

---

# Internal milestone notes (rolled into 0.2.0 above)

These entries documented day-by-day progress during the Phase 9 build. They are NOT separate releases — version numbers in this section were never tagged or published. Kept for development context only.

## [milestone] — 2026-06-02 — Character Preferences

A second long-memory substrate dedicated to *what this character likes, dislikes, and refuses* — distinct from skills (which are about how the character behaves under triggers) and lorebook (which is about world facts). Surfaces in a new **prefs** tab in the inspector. Nothing reaches the prompt unless you say "yes, that's her."

### What changed

- New namespace `preferences:<character_id>` in YantrikDB, persisted as `tier=canon` so it survives session boundaries.
- New inspector tab **prefs** (5th tab): three pinned-in-priority sections — **Limits & boundaries** (rose, top), **Private preferences** (violet), **Preferences** (emerald) — plus a free-text **Identity notes** textarea (manual-only; never auto-detected) and per-character **Settings** toggles.
- **PreferenceFormer** — LLM verifier that reads recent canon + scene reflex and proposes preferences from observed behavior. Pre-activation evidence weighting brakes the self-reinforcement loop. Identity-label regex guard catches "is submissive" / "is a brat" / etc even when the verifier mis-labels them as `interpretation`.
- **3-axis schema** — every preference carries an `interpretation_level` (observation | interpretation | identity_label), a `sensitivity` (ordinary | private | limit), and a state machine (observed → candidate → active → dismissed).
- **Prompt injection** — only `state=active` preferences reach the system prompt, in three blocks: `<preferences>` (ordinary), `<private_preferences>` (intimate, user-confirmed), `<limits>` (user-confirmed boundaries). The block ends with a load-bearing instruction — *"treat the patterns above as remembered tendencies, not rules… the character can grow, change, surprise"* — to keep the model from fossilizing the character.
- **Settings, per character**:
  - *Auto-keep ordinary preferences* — default ON
  - *Trust Chronicler on private preferences* — default OFF (opt-in)
  - *Auto-keep limits* — permanently OFF (safety floor: a false-positive limit refuses scenes you actually want, so limits surface aggressively in the UI but always require one click to inject)
- Tests: 23 assertions in `tests/preference-former.test.ts` — identity-label rejection, regex final-guard, sensitivity-class invariants, brake mechanics, hallucinated-rid filtering, cache + invalidate, dedup, malformed-output tolerance.

### Why a new substrate and not a `skill_type=reference`

Brainstormed it. Skills are *behavioral patterns under triggers* — they want a procedure/pattern shape and a state machine tuned for outcome-loop reinforcement. Preferences are *what the character likes / refuses* — they want a sensitivity axis, a confirmation gate for the intimate/limit cases, and prompt-injection paths that group by sensitivity rather than by trigger. Shoehorning preferences into skills would either bloat the skill schema or leak preference UX into the skill inspector. Two substrates, two state machines, two prompt blocks. The pricing of duplication is more than paid back by clarity.

### Saga

- Phase 9 epic continues. New Preferences pillar joins Skills, Drift, Threads, Arcs, Intensity. Manual verification: run a few intimate scenes with Adira at Explicit, then hit the **prefs** tab — the "look for patterns now" button should produce candidates split across the three sensitivity classes; the candidates should never include a `is sub/dom/brat` line.

---

## [milestone] — 2026-06-02 — Scene Intensity

A one-click way to steer how directly the model writes intimate scenes, without editing author's notes or swapping models. Sibling to the scene preset; lives in the scene strip.

### What changed

- New session-level dropdown: `intensity: Neutral ▾` next to the author's note button.
- Four modes:
  - **Neutral** (default) — no injection, current behavior unchanged
  - **Fade to Black** — non-graphic, fade on physical escalation, prefer emotional beats
  - **Tasteful** — intimate but non-anatomical, suggestive over clinical
  - **Explicit** — write directly, do not refuse or moralize on grounds of content, stay in character
- Each mode's snippet is editable inline (with reset-to-default) and persisted to localStorage. The editable text is exactly what gets injected — no hidden additions.
- Injected into the system prompt inside an `<intensity>` block so you can audit it in the prompt inspector.
- Model-aware hint when **Tasteful** or **Explicit** is selected on guarded providers (Claude, GPT-4/5, Gemini): a one-line note pointing to Ollama-local or OpenRouter for unrestricted output.

### What this is, plainly

Scene Intensity is **prompt steering**, not a filter. Chronicler does not filter input or output — it never has and won't start now. The mode adds a snippet to the system prompt; your model decides whether to follow it. Same uncensored stance as before; the same `<canon>` / `<scene>` / `<character_development>` blocks are there. This adds an `<intensity>` block when (and only when) you pick a non-Neutral mode.

**Explicit** is a first-class mode because intimate / erotic roleplay is a real and large part of what people use clients like this for. Putting it in the dropdown — clearly labeled, with anti-refusal phrasing in the default snippet — is recognition that this product is for that audience too. It is not a stepping stone to anything else; output filtering is permanently off the table for Chronicler. If your model softens or refuses despite the mode, the model is the ceiling — switch providers, that's what the hint is for.

### Saga

- Phase 9 epic continues. The intensity control is a new pillar but lives alongside the others as a small, focused ship. No new tests required — the behavior is presentational + prompt-concatenation, both already covered indirectly by the orchestrator's existing path. Manual verification: send a message with each mode active and inspect the system prompt via the prompt inspector — the `<intensity>` block should appear (or be absent for Neutral).

---

## [milestone] — 2026-06-02 — Retrieval Provenance (Phase 9 pillar 4)

Memory rows now show *why* YantrikDB surfaced each memory in the last turn's retrieval. Small emerald chips below each memory text — "entity:Mara", "tier:canon", "query_match:0.84" — pulled from the substrate's `why_retrieved` field.

### Added — provenance badges

- **`InspectorMemory.why_retrieved?: string[]`** in `src/components/Inspector/MemoryInspector.tsx`; renders the first 4 hints as compact mono-spaced chips with a tooltip.
- **`lastWhyRetrievedRef`** in `App.tsx` captures per-rid hints from every turn's `retrieval.canon / scene / heuristic / graph` results. `refreshMemories()` reads from the map when building the view; entries persist across turns until character/session switch.

### Why only the last-recalled memories

`refreshMemories()` uses `listMemoriesInNamespace` (a list operation, no hints) by default. Recall results (per-turn queries) are the only path that produces `why_retrieved`. The map persists across turns so memories that surfaced 3 turns ago still show their badges. Always-recalling on every inspector refresh would be wasteful; backfilling from saved turn history is a bigger lift — both deferred.

### Saga

- Task #51 closed. **Phase 9 epic now 4 of 5 pillars done** (Open Threads + Arcs + Relationship Drift + Retrieval Provenance). Only Deferred Follow-Through remains — informally already half-shipped via Open Threads + the existing `<scene_hooks>` injection; only "explicit follow-up candidate generation" would be net new, and the brainstorm conclusion was to wait for real usage to demand that before building.

---

## [milestone] — 2026-06-02 — Relationship Drift (Phase 9 pillar 3)

Characters notice when their relationship to you has shifted. Trust, defensiveness, openness, dependency — up or down — surfaced as canon-grounded patterns in the Character Development tab.

### Added — DriftFormer

- **`src/lib/orchestrator/relationship-drift.ts`** — same architectural template as `SkillFormer`: cheap input (recent canon memories for the dyad) → LLM verifier biased to reject → write to YantrikDB skill substrate.
- **Four axes only**: `trust`, `defensiveness`, `openness`, `dependency`. Two directions: `up`, `down`. Deliberately constrained — the UI doesn't become a personality test.
- **Stacked biases** in the verifier: default to `is_drift: false` on uncertainty, require ≥2 distinct canon memories of evidence, reject if the character card already describes the trait as baseline (not a shift if it's who they always were).
- **Evidence rid sanitization** — drops hallucinated rids the verifier sometimes invents.
- **Per-(character, target) cache** keeps LLM cost bounded; `invalidate()` hook for explicit re-verification.

### Where drift signals live

- Written as `skill_type="pattern"` with `applies_to=[character, target, axis, "direction_<dir>"]`. Skill id pattern: `<char>.drift.<target>_<axis>_<direction>`.
- Render in the existing **Character Development tab** alongside skills — the `applies_to` chips self-document the dyad ("ren / user / trust / direction_up"). Same approve / disable / archive controls already work.
- Surfaced into the system prompt via the existing skill compose path; no new prompt scaffolding.

### Refresh cadence

- Runs once per (character roster, session) change. Pulls top 20 canon per character; submits one candidate per character with target=user (multi-character matrix is v2). Cache prevents re-verification mid-session; users get fresh signals on session resume.

### Verification

- **`tests/relationship-drift.test.ts`** — 17 assertions: accept path with substrate write + applies_to shape, reject paths (no_drift verdict, <2 input memories, <2 evidence_rids, low confidence, malformed JSON), cache behavior (3 passes → 1 verifier call), invalidate() forces re-verify, hallucinated rid filtering.

### Saga

- Task #50 closed. Phase 9 epic now **3 of 5 pillars done** (Open Threads + Arcs + Relationship Drift). Remaining: 9.4 Retrieval provenance (polish-tier), Deferred Follow-Through (informally half-shipped via Open Threads + `<scene_hooks>` injection).

---

## [milestone] — 2026-06-02 — Arcs (Phase 9 pillar 2)

The "return after a week" continuity feature. Canon memories cluster into cross-session narrative arcs with active/paused/abandoned/resolved status. The recap banner surfaces active arcs so resuming a chat lands you oriented.

### Added — Arc clustering

- **`src/lib/arcs/cluster.ts`** — rule-based clusterer: groups canon by linked entity (preferring `metadata.entities`, falling back to capitalized-word frequency extraction). Status derives from `last_touched_at` per arc: <24h = active, <14d = paused, ≥14d = abandoned. Entity denylist drops generic noise (`user`, `scene`, `narrator`).
- **`src/lib/arcs/types.ts`** — `Arc { id, title, primary_entity, entities, members, last_touched_at, status }` with `ArcMember { rid, text, importance, touched_at }`.
- **`src/lib/arcs/overrides.ts`** — localStorage `ArcOverride { status: "resolved"|"archived"|"pinned" }`; same pattern as thread overrides.

### Added — Arcs tab

- **Fourth inspector tab `arcs · N`** alongside memory / character / threads. Status-colored cards (active emerald, paused amber, abandoned rose, resolved neutral), filter chips (All / Active / Paused / Abandoned / Archived). Each card: title, status badge, override badge, member count, most-recent member snippet (click rid → jump to Memory tab). Per-row actions: pin, resolve, archive, reset. Pinned arcs always float to the top.

### Added — Recap integration

- **`summarizeActiveArcs(arcs, cap=5)`** — deterministic rule-based one-line summary of active + paused arcs. Renders in the chat's recap banner below the LLM-generated "Previously on…" text. Stays OUT of any LLM prompt — the recap generator is the most hallucination-prone surface (see ADR notes); keeping the arcs line outside that path preserves the anti-confabulation guarantee.

### Verification

- **`tests/arcs.test.ts`** — 24 assertions: status derivation across thresholds, multi-entity clustering, member sort, entity denylist, fallback text extraction, summary line behavior, overall sort order (active → paused → abandoned).

### Saga

- Task #49 closed. Phase 9 epic now 2 of 5 pillars done (Open Threads + Arcs). Next sequenced: 9.3 Relationship drift signals (dyadic successor to retired #24).

---

## [milestone] — 2026-06-02 — Phase 9: Interactive Memory

Phase 4 (post-MVP cognition, scoped in April) was largely completed via displacement by Phase 6/7/8 work. This release closes out Phase 4 honestly — retiring items absorbed by Skills + World Info, splitting items that became background polish — and opens **Phase 9: Interactive Memory** with the first pillar shipped.

The positioning shift: memory moves from passive retrieval to **user-steerable and character-visible**. The Threads tab is the screenshot — "you promised X 3 sessions ago, never followed up — source memory `mem-1234` — last seen 4d ago." No other client can show that.

### Added — Open Threads Inspector (Phase 9 pillar 1)

- **Third inspector tab `threads · N`** alongside memory + character. Surfaces YantrikDB's temporal continuity (`temporal.upcoming` + `temporal.stale`) which was previously either invisible in the system prompt (`<scene_hooks>`) or outright discarded.
- **Two kinds of rows**: *scene hooks* (upcoming events with approaching beats — sky chip) and *stale* (important canon untouched for 14+ days — rose chip). Header shows a `N stale` warning when any are present.
- **Per-row provenance**: source memory rid (click to jump to Memory tab), last-seen short-date, linked entity chips. The "see what's happening" brand applied to temporal memory.
- **Per-row actions**: **pin** (keep visible until resolved), **resolve** (mark done), **snooze 24h / 7d** (re-surfaces automatically when the window expires), **dismiss** (permanent hide), **reset** (undo override). Overrides persist via `localStorage`; the underlying memories are never mutated.
- **Filter chips**: All / Open / Stale / Hidden — the Hidden tab lists overrides with a restore button so nothing is lost.
- **Sort order**: pinned → stale → upcoming → importance descending.

### Added — supporting plumbing

- `src/lib/threads/types.ts` — `Thread` interface (id, kind, text, rid, importance, last_seen_at, entities).
- `src/lib/threads/dismissals.ts` — localStorage override store with `isHidden()` helper that respects snooze-until.
- `src/lib/yantrikdb/client.ts` — new `listThreads(namespace, kind, {days, limit})` method: calls `temporal` MCP, parses memory list, extracts entities, generates stable ids (rid when available, ascii-folded text-slug fallback so dismissals survive reload).
- `src/components/Inspector/ThreadsInspector.tsx` (new).
- `App.tsx` — `refreshThreads()` fans out per-character; `threadOverridesRef` + version state drive a `useMemo` for `visibleThreads`; refresh fires on character/session switch alongside refreshMemories/refreshSkills.

### Saga reorganization

- **Phase 4 closed.** #24 (personality inference) retired — absorbed by Phase 8 Verified Character Learning. #25 (semantic lorebook) retired — delivered by Phase 6 World Info. #26 (temporal triggers) rescoped + shipped as Open Threads Inspector. #27 (consolidation polish) split — recap done, cadence ongoing non-roadmap, arc summaries moved to Phase 9.
- **Phase 9 epic created** ("Interactive Memory / Living Continuity"):
  - 9.1 Open Threads Inspector — DONE
  - 9.2 Cross-session arc summaries — NEXT (cluster canon by entity + time, surface active/paused/resolved/abandoned status)
  - 9.3 Relationship drift signals — dyadic successor to retired #24 (canon-grounded trust/defensiveness/openness deltas, surfaced in Character tab alongside skills)
  - 9.4 Retrieval provenance — per-memory "why was this recalled" badges

### Explicit scope cuts

- **No anniversary callbacks.** Model can do anniversaries from timestamps on canon memories when surfaced; no separate detector needed.
- **No autonomous follow-up generator.** Surfacing alone improves model behavior in scene.
- **No graph traversal for retrieval.** Recharacterized as background tuning, not a headline feature.
- **No agent integration / multi-user / plugins / mobile** for Phase 9. Pre-traction, the job is to make the core uniquely compelling, not expand surface area.

---

## [milestone] — 2026-06-01 — Provider matrix + Gemini

Adding a provider becomes a dropdown. Twelve common providers pre-filled. Gemini gets a native adapter.

### Added — provider templates

- **`src/lib/providers/templates.ts`** — twelve `PROVIDER_TEMPLATES`: Ollama, OpenAI, Anthropic, Google Gemini (native), Mistral, OpenRouter, Together AI, Groq, KoboldCpp/KoboldAI, llama.cpp server, vLLM, and "Other (OpenAI-compatible)" as a custom catch-all. Each template carries a sensible base URL + model default; the user just adds an API key.
- **Settings: "+ add provider…"** dropdown replaces the three hardcoded +Ollama/+OpenAI-compat/+Anthropic buttons. Pick from the menu, get a pre-configured entry.

### Added — Gemini native adapter

- **`GeminiProvider`** in `src/lib/providers/index.ts`. Handles Gemini's unique wire format: `contents[]` with `parts[]`, `systemInstruction` as a top-level field, `generationConfig` for sampling, API key in query string. Maps assistant↔model role. Streaming via `/streamGenerateContent?alt=sse`.
- `ProviderConfigEntry.kind` extended with `"gemini"`. `buildProvider` in `App.tsx` routes accordingly.

### Out of scope

- **Horde** — async job-based (submit → poll community workers); genuinely different model from the sync request/stream pattern. Real demand exists but it's a sizeable adapter; deferred to user request.
- Per-preset Gemini-specific family deltas (`presets.ts` currently treats Gemini as the OpenAI-compat fallback) — small follow-up if telemetry shows defaults need tuning.

### Saga

- Task #39 closed. Phase 7 (Power-user polish) epic now **5 of 5 done**. Phase 6 (Tier B power differentiators) also 4/4. Both post-launch epics complete.

---

## [milestone] — 2026-06-01 — Story / continue mode

Freeform narrative RP now has a dedicated entry point — no fixed character, narrator-style prose, the rest of the stack unchanged.

### Added — story mode

- **`+ new story`** button in the Library header. Prompts for an optional title and spins up a session with a synthesized "story character" (narrator system prompt + `story` tag).
- **`src/lib/story/factory.ts`** — `buildStoryCharacter({ title?, scenario?, world_ids? })` returns a `Character` with a third-person narrator system prompt: advances the scene from the user's actions, lets NPCs speak in dialogue, doesn't break to ask meta questions, honors canon / scene / lorebook as world facts.
- **Visual marker** — story characters render with a small violet `story` chip in the library grid so they're distinguishable from imported cards.

### Design

- Implemented as a regular Character (not a parallel session type). The entire chat loop, write contract, memory tiers, lorebook scanner with assigned worlds, recap, and the inspector tabs all key off Character — synthesizing keeps the diff tiny while still giving users a distinct entry point and a visual marker. Story characters are editable in the regular Character editor (so users can refine the narrator prompt or assign worlds).

### Saga

- Task #41 closed. Phase 7 (Power-user polish) epic now 4 of 5 done.

---

## [milestone] — 2026-06-01 — World Info (global lorebooks)

Lorebooks are no longer per-character only. Worlds are a first-class entity; multiple characters opt in to a world and share its lorebook entries.

### Added — World Info

- **World entity** (`src/lib/worlds/store.ts`) — id, name, optional description, persisted to localStorage parallel to characters and sessions.
- **`Character.world_ids?: string[]`** — characters belong to zero or more worlds. Legacy `world_id?: string` field kept; `listCharacters()` migrates on read by projecting `world_id` into `world_ids` so downstream consumers see the multi shape.
- **Lorebook scanner** unions namespaces (`lorebook:<character_id>` + every `lorebook:<world_id>` the character is in). Per-rid dedup catches the same entry being recalled twice.
- **Canon recall pipeline** fans out one recall per world; merged + deduped by rid alongside the character's own canon.
- **Worlds CRUD** lives in the Library above the character grid. Each card shows name, description, member-count chip, and three actions: edit lorebook, rename, delete. Delete cascades — every member character's `world_ids` array gets the deleted world id stripped, no dangling refs.
- **Character editor** gains a Worlds field — pill toggles for each defined world (hidden entirely when no worlds exist so the editor stays clean for users who don't care).
- **LorebookEditor reused** for world lorebooks — the YantrikDB namespace pattern (`lorebook:<id>`) is identical for both character and world targets; only the header label differs.

### Verification

- `tests/lorebook.test.ts` gains 5 multi-world assertions: per-character entries still surface, world entries from both A and B surface, distinct entries with the same key correctly dedupe to 2 not 4, legacy singular `world_id` still works.

### Saga

- Task #35 closed. Phase 6 (Tier B power differentiators) epic complete — all 4 of 4 done.

---

## [milestone] — 2026-06-01 — Tier B power features

Three Phase 6 power-user features land: configurable author's-note depth, multi-persona library with per-session quick-swap, and a three-step first-run wizard for new users.

### Added — author's note depth

- **Depth slider 0-5** under the author's note textarea. Depth 0 keeps the current behavior (note lives in the system prompt — broad steering). Depth N>0 omits the note from the system prompt and instead splices it into the message history as a synthetic system message N turns before the reply, where the model attends to it more strongly.
- Persisted per-session via `SessionMeta.author_note_depth`.
- `renderContext` return type widened to include `role: "system"` in history so the depth-N injection lands cleanly.

### Added — multi-persona

- **Persona library** (`ChroniclerConfig.user_personas`) with stable ids + `active_persona_id`. Single-persona configs migrate automatically.
- **Settings CRUD** — `PersonasSection` replaces the single-persona block. Add, rename, edit description, delete (gated when only one remains), radio for the default.
- **Per-session override** stored in `SessionMeta.persona_id`. Switching mid-session updates the system prompt's `<user>` block on the next turn.
- **Quick-swap dropdown** in the scene strip (`as <name>`) when ≥2 personas exist.
- `currentPersona()` helper used by recap, impersonate, and the header subtitle. New `activePersona(cfg)` helper for read paths.
- Personas live in config only — never round-tripped through character cards, preserving the user-controlled stack.

### Added — first-run wizard

- **Three-step modal** (`src/components/Onboarding/FirstRunWizard.tsx`) triggered exactly once per machine (`chronicler.onboarding_v1_dismissed` flag, versioned for future upgrade flows).
  - **Step 1 — Provider**: Ollama (local) / OpenAI / Anthropic / Skip. Smart URL + model defaults per choice; inline API key field where needed.
  - **Step 2 — Persona**: name + description, both optional.
  - **Step 3 — Character**: file picker for v2/v3 card import OR try-demo for Ren.
- Every step skippable; "skip the rest" header button dismisses immediately. Progress dots in footer.
- Patches apply per-step so partial completion still saves what the user provided.
- Detection (`shouldShowWizard`) checks: no real provider beyond mock + no named persona + no characters imported.

### Saga

- Tasks #34 (multi-persona), #36 (first-run wizard), #37 (author's note depth) closed. Phase 6 epic now 3 of 4 done.

---

## [milestone] — 2026-06-01 — Token visualizer + TTRPG floor

Two power-user features that don't require any new infrastructure.

### Added — token budget visualizer

- **Stacked retrieval budget bar** in the prompt inspector: canon / scene / drafts / graph segments coloured to match the tier palette, headroom in muted slate, hover-tooltips on every segment showing token count + budget %.
- **Truncation warnings**: any composer section that hit its allocation cap and dropped items shows a `⚠` glyph in its legend entry; the bar header shows aggregate "⚠ N truncated" so users can see when context was lost without opening every section.
- Backing: `ComposedContext.truncated_sections` plus a `dropped` counter from the fit-to-budget loop. `PromptCapture` now carries `breakdown`, `budget`, and `truncated_sections` for the visualizer to consume.

### Added — TTRPG slash commands

- **`/dice 2d6`, `/roll 1d20+5`, `/r`** — full dice grammar (+/- terms, mixed dice expressions, keep-highest `4d6kh3` for D&D ability scores, keep-lowest `4d6kl3` for disadvantage). Sanity caps prevent `1000d1000` accidents. Results render as a `role: "system"` "narrator" turn — the character sees the roll in scene history on the next turn and can react to it naturally.
- **`/init`** — rolls 1d20 per scene participant, outputs a sorted initiative list.
- **`/help`** (`/?`) — lists all commands inline.
- **Narrator turn rendering** — centered italic row, no avatar, no swipe/regen affordances, hover-to-delete. Stored persistently like any other turn.
- Unknown slash commands fall through to the LLM (matches SillyTavern-style behavior where some commands are RP shorthand).

### Verification

- **`tests/slash.test.ts`** — 40 assertions covering parser branches, dice expression evaluation (including malformed input rejection), keep-highest/keep-lowest, deterministic seed verification, every `executeSlash` kind.
- Saga tasks #38 (token visualizer) and a new TTRPG-commands task closed.

---

## [milestone] — 2026-06-01 — Scene presets + header cleanup

Sampling controls become discoverable. Replace a single anonymous slider panel that nobody knew how to tune with six **scene-coded presets** users actually pick by intent. Header is cleaner; the "+N skills" badge is now an entry-point.

### Added — scene presets

- **6 sampling presets** (`src/lib/sampling/presets.ts`): **Slow Burn** (default, grounded dialogue), **High Heat** (vivid, expressive), **Companion** (warm, supportive), **Storyteller** (long-form prose), **Game Master** (structured adventure), **Canon Keeper** (lore-respecting). Names converged from a multi-model brainstorm (gpt-5.4 + deepseek + claude) — generic SaaS labels rejected.
- **Model-family overrides** invisible to the user. Mistral/Llama get base values; Qwen reduces repetition penalty; Anthropic drops `min_p` + `repetition_penalty` entirely and cools temperature; DeepSeek widens `top_k`. Implemented as deltas on top of the base preset.
- **Header dropdown** (`src/components/Settings/PresetPicker.tsx`) with subtitle hints, active-preset highlight, and an Anthropic-aware "3/5" subscript when the provider strips fields.
- **Custom-state detection**: any slider wiggle in Settings flips the pill to "Custom (was: X)" with one-click reapply inside the dropdown menu.
- **Session-scoped preset** persisted in `SessionMeta.preset_id` so opening an old chat restores its mood. App-level `default_preset_id` in `ChroniclerConfig` for new sessions.
- **Provider-switch toast** when picking a preset on a provider that doesn't support every field: "*High Heat adjusted for Anthropic — 3 of 5 controls apply*".

### Changed — header UX

- Removed redundant "demo: Ren" button (the EmptyState splash already has the demo entry).
- "+ Mei (try group)" moved from header into the scene strip where scene participants live, restyled as a quiet emerald pill.
- "[backend · provider]" pill removed from header (info now lives in the Settings button tooltip).
- "+N skills" header badge is now a button that jumps to the Character Development tab.
- Visual divider added between PresetPicker and utility buttons.

### Scope decisions (and what stayed out)

- Sampling only. `disable_thinking`, max_tokens, retrieval budgets, lorebook depth, prompt scaffolding — all stay on their existing surfaces. Bundling them would make "High Heat" silently change retrieval, violating the predictability promise.
- Per-character preset binding deferred to v0.3 — the substrate-driven Character Development already gives per-character feel, and per-character sampling risks silent stranger-baked-in choices if we ever import from card JSON.
- Saga task #40 closed.

---

## [milestone] — 2026-06-01 — Verified character learning

The skill loop. Patterns the model shows repeatedly are distilled into
typed catalog entries, verified by an LLM that defaults to rejection,
surfaced back into future prompts when relevant, and tuned by outcome
scoring. The whole loop is covered by a CI-enforced ablation harness.

### Added — verified character learning

- **YantrikDB skill substrate integration** (`src/lib/orchestrator/skill-former.ts`). Cheap pattern/lesson/unresolved/contradiction triggers from `think()` go through an LLM verifier that returns strict JSON `{is_skill, skill_type, applies_to, body, confidence, why}`. Verifier prompt explicitly biases toward rejection on uncertainty; model stylistic tics, broad applies_to, and degenerate shapes get a final-guard pass too. Confirmed skills written via `client.skillDefine` with state=candidate. Cache by trigger_id so re-entry is free.
- **Outcome scoring + state machine** (`src/lib/orchestrator/skill-outcomes.ts`). `+1` if no regen / retcon / delete in the observation window, `-1` otherwise, `0` if the window hasn't closed yet. State derives from accumulated outcomes (read from substrate, not stored on the skill): candidate → active at net ≥+3 across ≥2 distinct sessions; active → suppressed at last-5 net ≤-2; suppressed → archived after 7 idle days. Sessions are recoverable from outcome notes (encoded JSON header). Process-local dedup guard prevents (skill, session, turn) tuples from being scored twice.
- **Skill surfacing in the per-turn pipeline.** `client.skillSurface(query, {applies_to: [character_id]})` joins the parallel retrieval call. Compose filters suppressed/archived skills (overrides win over derived state) and renders the surviving top-N as a `<character_development>` block in the system prompt, framed as habitual patterns rather than instructions. Default relevance cutoff `0.15` so off-topic skills don't fossilize.
- **Per-turn outcome wiring.** `onSend` scores the prior assistant turn positively; `onRegenerate` scores the target turn negatively *before* the new turn runs so suppression takes effect immediately; `onEditMessage` and `onDeleteMessage` on assistant turns score retcon and delete negatives respectively.
- **Character development inspector tab** (`src/components/Inspector/SkillInspector.tsx`). 4th tab alongside Memory. State-coloured cards (active emerald / candidate amber / suppressed slate / archived neutral), skill_type badges, applies_to tags, uses + success rate, per-row approve / disable / archive / reset controls. Overrides persist via localStorage and win over the derived state used by surfacing.
- **Header `+N skills` badge.** Amber count of newly-formed skills this session for observable proof the loop is firing.

### Added — instrumentation

- **Skill transition log** (`src/lib/instrumentation/skill-transition-log.ts`) — sibling of the memory promotion log with matching redaction posture (text/body redacted unless verbose env is on). Keeps memory and skill telemetry as separate contracts.

### Added — verification

- **`tests/skill-former.test.ts`** — 19 assertions covering verifier-no, verifier-yes, model-tic-rejected, broad-applies-to-rejected, cache hit, malformed JSON tolerated.
- **`tests/skill-outcomes.test.ts`** — 23 assertions covering all four scoring branches, candidate→active threshold (requires 2 distinct sessions), active→suppressed via negative streak, suppressed→archived idle, process-local dedup.
- **`tests/lcdb-v0.test.ts`** — Local Character Development Benchmark v0. 3 scenarios × 2 conditions (skills_on / skills_off), 24 hard assertions over 72 binary signals: reuse, restraint, model uptake, inspector faithfulness, outcome calibration. `OracleSurfaceTransport` approximates a perfect ranker so the test measures the surfacing-pipeline contract independent of the in-memory transport's substring scoring. CI-enforced.

### Added — docs

- **[docs/LCDB-v0.md](docs/LCDB-v0.md)** — benchmark methodology, what it tests vs explicitly doesn't, reproduction steps, latest results pointer.
- **docs/LCDB-v0-results.{json,md}** — auto-generated per CI run.
- **[docs/PATTERN.md](docs/PATTERN.md)** — new "Skills: the learning loop" section documenting the YantrikDB-narrows / LLM-verifies / outcomes-drive-state template, generalizable beyond Chronicler (anomaly triage, code review, support summarization).
- **README.md** — added "Verified character learning" bullet under "What makes it different" with link to LCDB-v0.md.

### Changed

- **`InMemoryTransport`** gains `skill` define/surface/outcome/get/list support so the dogfood loop works in mock mode and tests have a real substrate to write against.
- **`YantrikClient`** gains `skillDefine` / `skillSurface` / `skillOutcome` / `skillGet` / `skillList` wrappers.

---

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
