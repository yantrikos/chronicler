# Chronicler vs SillyTavern, RisuAI, AgnAistic

A short, honest comparison of where Chronicler sits relative to the major
open-source roleplay clients. Written for people deciding which client
to invest hours in.

**TL;DR.** SillyTavern is the most mature and customizable OSS client by
a wide margin — if you want the deepest extension ecosystem, use it.
RisuAI is a polished modern UX if you want native macOS/Windows desktop
binaries. AgnAistic is the right pick if multi-user shared worlds matter
more than character depth. **Chronicler's bet is a different one**: take
a single mid-sized roleplay (one character, hundreds of hours,
intentional continuity) and make memory actually hold across that arc —
verified, inspectable, never confabulated. Everything else in the
product flows from that bet.

---

## Capability matrix

Legend: ✅ first-class · 🟡 partial / via plugin · ❌ absent / not designed for · ❓ not researched in depth

| Capability | Chronicler | SillyTavern | RisuAI | AgnAistic |
|---|---|---|---|---|
| **Memory & continuity** | | | | |
| Cross-session memory | ✅ tiered (canon / heuristic / reflex) with promotion paths | 🟡 via SmartContext + Summarize extensions | 🟡 lorebook + chat history; no auto-tiering | 🟡 per-chat memory book, slot-based |
| Conflict detection on memory writes | ✅ LLM verifier, auto-resolve on canonical wins | ❌ | ❌ | ❌ |
| Memory namespaces (character / session / world) | ✅ enforced by orchestrator | ❌ flat | ❌ flat | 🟡 per-character book |
| Memory inspector (forget / promote / retcon) | ✅ in-app | 🟡 lorebook editor only | 🟡 lorebook editor only | 🟡 memory book editor |
| Provenance ("why was this surfaced?") | ✅ `why_retrieved` chips on every memory | ❌ | ❌ | ❌ |
| Anti-confabulation system clause | ✅ prepended automatically; non-removable | ❌ user's responsibility (jailbreak prompts) | ❌ | ❌ |
| **Character continuity** | | | | |
| v2/v3 character cards (chub.ai compatible) | ✅ | ✅ | ✅ | 🟡 own format, partial import |
| Lorebook / world info | ✅ scanned per-turn, position-aware | ✅ deepest in class | ✅ native UI | ✅ memory book |
| Group chats | ✅ with per-memory `visible_to` ACL — characters can't recall secrets they weren't told | ✅ mature | ✅ | ✅ |
| Persona (user identity) | ✅ | ✅ | ✅ | ✅ |
| Skills substrate (behavioral patterns) | ✅ verifier-gated, with state machine | ❌ | ❌ | ❌ |
| Relationship drift (trust↑↓, dependency, openness, defensiveness) | ✅ axis labels, canon-grounded | ❌ | ❌ | ❌ |
| Preferences substrate (likes / limits, intimate-aware) | 🟡 v0.2 — substrate + UI shipped; formation flaky on reasoning-model providers | ❌ | ❌ | ❌ |
| **Author tools** | | | | |
| Author's note | ✅ with depth control | ✅ | ✅ | ✅ |
| Scene Intensity dropdown (Neutral / Fade to Black / Tasteful / Explicit) | ✅ first-class | ❌ via jailbreak prompts | ❌ via author's note | ❌ |
| Sampling preset library (Slow Burn / High Heat / Companion / Storyteller) | ✅ | 🟡 via custom presets | 🟡 via custom presets | 🟡 |
| Prompt inspector (token budget, retrieval breakdown, truncation) | ✅ shows exact bytes sent | 🟡 prompt manager shows structure, not retrieval reasoning | 🟡 | ❌ |
| **Architecture & openness** | | | | |
| Local-first (no cloud calls except chosen LLM) | ✅ | ✅ | ✅ | ✅ (when self-hosted) |
| One-command self-host (`docker compose up`) | ✅ two containers | 🟡 node + extensions setup | ✅ desktop binary | 🟡 node + db setup |
| Multi-user / shared worlds | ❌ single-user | 🟡 instance-per-user | ❌ | ✅ designed for it |
| Provider support (OpenAI / Anthropic / Ollama / OpenRouter / local) | ✅ | ✅ most extensive | ✅ | ✅ |
| **Output filtering** (any kind) | ❌ never — explicitly NSFW-affirming | ❌ | ❌ | ❌ |
| Extension ecosystem | 🟡 **Grimoire** (v0.2.1) — typed SDK, hooks (observer/augmenter/strategy), slash commands, hot reload, UI slots, MCP server registration **and tool calling** with per-character gating. Dynamic install path + community plugins ship in v0.3. | ✅ huge | 🟡 themes / scripts | 🟡 |
| **Maturity** | | | | |
| First release | 2026 | 2023 | 2023 | 2023 |
| Public install base | small (early) | very large | large | medium |
| Mobile | ❌ | 🟡 PWA / responsive | ❌ | ✅ responsive web |

Notes on accuracy: claims about Chronicler are verified against this
repo. Claims about other clients reflect their public design at the
time of writing — corrections welcome via PR.

---

## Where Chronicler is different

### 1. Memory is structured, not summarized

The standard pattern across OSS clients is "context pack": stuff
recent messages + lorebook hits + (optionally) a vector-recalled
chunk + a rolling summary into the system prompt. Works for ~10
sessions, falls apart at 50+.

Chronicler stores every turn against a **three-tier write contract**:

- **canon** — durable facts the user asserts out of frame, or that a
  character establishes in-scene as backstory. Survives forever.
- **heuristic** — observed patterns and preferences. Promoted to canon
  by repetition and verifier acceptance.
- **reflex** — turn-level dialogue and beats. Recency-decayed; surfaces
  in the current scene but rarely beyond.

The orchestrator retrieves from all three with separate budgets,
shows you the split in the prompt inspector, and lets you promote/
demote/retcon individual memories. The character's experience of "we
talked about this last month" is grounded in actual recall, not a
summary the model improvised.

### 2. The anti-confabulation clause is built in

Every system prompt Chronicler sends starts with this clause:

> Treat only the facts in `<canon>` and `<scene>` as real. Do not
> reference prior events, relationships, or character history that are
> not present in those sections. If asked about something not in
> memory, respond in character by asking, deflecting, saying you
> don't recall, or changing the subject. Never invent.

SillyTavern users typically add equivalent text to their jailbreak
prompts — but it's optional, gets dropped between exports, and isn't
universal across the community's prompt presets. In Chronicler it's
**non-removable**, sits above the character card, and applies
uniformly. The result: when memory is empty, the character notices —
they don't invent a shared history that doesn't exist.

### 3. Three lenses on character continuity, not one

OSS clients give you the lorebook for world facts and the chat history
for the rest. Chronicler splits character continuity into three
substrates, each with its own writer, inspector, and prompt-injection
path:

- **Skills** — behavioral patterns the character has shown across
  scenes ("Adira deflects with humor when emotional intimacy spikes").
  Verifier-gated, surfaced when applicable triggers fire.
- **Relationship drift** — dyadic changes on labeled axes (trust ↑↓,
  dependency ↑↓, defensiveness ↑↓, openness ↑↓) grounded in named
  canon memories.
- **Preferences** — what the character likes, dislikes, or refuses,
  split by sensitivity (ordinary / private / limit). User-confirmed
  before reaching the prompt.

Each shows up as a separate inspector tab. You can see exactly which
preferences / skills / drift labels are being injected this turn, and
disable individual entries without affecting the others.

### 4. The intimate scene is a first-class control, not a workaround

Chronicler ships **Scene Intensity** as a dropdown next to the author's
note: Neutral / Fade to Black / Tasteful / Explicit. Each mode has an
editable snippet that gets injected into the system prompt inside an
`<intensity>` block — visible in the prompt inspector, no hidden
modifications.

**Explicit** is a first-class mode because intimate/erotic roleplay is
a real and large segment of what OSS roleplay clients are actually used
for. Treating it as a workaround (jailbreak prompts, model-swap
gymnastics) is the default elsewhere. Chronicler's stance is the
opposite: output filtering is permanently off the table. If your model
refuses or softens despite the mode, the model is the ceiling — switch
providers, and Chronicler will point you at unrestricted ones.

### 5. You can see what was sent

The prompt inspector shows:

- The exact bytes that hit the LLM this turn
- The token budget breakdown (canon: X, heuristic: Y, scene: Z, …)
- Which sections were truncated to fit
- The retrieval provenance for every memory that landed

If the character says something surprising — good or bad — you can
trace it back to its source in one click. No other OSS client exposes
retrieval reasoning at this granularity.

---

## Where Chronicler is behind

Honest about the gaps:

- **No extension ecosystem.** SillyTavern's biggest moat is the
  extensions community. We don't have one and won't for a while.
- **No mobile.** Desktop browser only.
- **Small install base.** A few hundred users at v0.4 vs SillyTavern's
  ~100k+.
- **No fine-tune / training surface.** AgnAistic and others offer
  light-touch character training; we don't.

---

## Where each tool wins

Use **SillyTavern** if you want the deepest customization, an
extension for every edge case, and a community that's seen every
prompt-engineering trick. The cost is configuration sprawl and memory
that's still effectively per-session.

Use **RisuAI** if you prefer a polished single-binary desktop app and
your roleplay is closer to short-arc storytelling than long
continuity.

Use **AgnAistic** if you're building a shared world with multiple
human users, or want a hosted multi-user surface.

Use **Chronicler** if you want a character that remembers you — really
remembers you — across hundreds of hours, with the ability to see and
correct what they remember, and with an explicit, unapologetic stance
on intimate roleplay.

---

*Last updated 2026-06-03. PRs welcome — particularly to correct any
inaccurate claim about another client.*
