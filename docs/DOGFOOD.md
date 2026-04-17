# Dogfooding Protocol

The only test that matters for Chronicler is whether memory stays coherent and useful over real multi-hour sessions. No amount of unit tests answers that. This doc is the protocol for running that test honestly on yourself before shipping.

## Setup

```bash
# 1. Bring up the stack (Chronicler + YantrikDB)
docker compose up -d

# 2. Check it's healthy
curl -s http://localhost:3001/api/health

# 3. Open the app
open http://localhost:3001   # or point your browser there manually

# 4. In Settings → Providers, add one (OpenAI-compat or Anthropic) with your API key.
#    The memory backend defaults to YantrikDB via /api/mcp — leave it.

# 5. Quick smoke: click "demo: Ren", send "hi", verify you get a reply and a
#    memory appears in the inspector. Close the browser, reload, confirm the
#    memory is still there.
```

## Instrumentation (already on by default)

- `~/.chronicler/logs/promotion-YYYYMMDD.jsonl` — tier transitions (redacted text)
- `~/.chronicler/logs/session-YYYYMMDD.jsonl` — turn + reinforcement events (redacted text)

Local-only verbose mode (text included): set `CHRONICLER_VERBOSE_LOGS=1` on the chronicler service or run `localStorage.setItem('chronicler.verboseLogs', '1')` in the browser console. Leave off for normal dogfood — structural data is what matters.

## Week-1 schedule

| Day | What | Duration |
|---|---|---|
| 0 | Setup. Pin thresholds at defaults. Don't touch code. | ~2h |
| 1 | Session 1: slow-burn emotional/relationship RP, single character | 3h |
| 2 | Review day-1 logs. No tuning. Write observations. | 2h |
| 3 | Session 2: plot/procedural RP, same character. Skim day-3 recap on start. | 3h |
| 4 | Session 3: group chat, different world. Meta-test ACLs. | 2h |
| 5 | Consolidate findings. Replay harness with 2–3 threshold variants. | half-day |
| 6 | Write pattern article + README grounded in real data | full day |
| 7 | Push repo public. Post to LocalLLaMA + HN. | half-day |

## Post-session observation template (copy into a private notebook)

```
Session: [N]  Date: [YYYY-MM-DD]  Duration: [Xh Ym]
Character(s): [ids]  Scenario: [one line, no content]
Model / provider: [e.g. anthropic claude-opus-4-7]

Promotion log summary:
  - N memories promoted heuristic→canon this session
  - M of those feel correct on inspection
  - K feel wrong — note the IDs

Retrieval observations:
  - Did the "Previously on..." recap surface the right facts? (Y/N + which missed)
  - Did any recall mid-scene feel intrusive or wrong? (count; note IDs only)
  - Did latency stay under 2s per turn? (approx worst case)

Continuity observations:
  - Did the character reference anything that wasn't in memory? (confabulation risk)
  - Did the character forget anything canon? (retrieval-miss risk)

Privacy / ACL observations (group-chat sessions only):
  - Did any character reference a fact they shouldn't have had access to? (Y/N)
  - Any near-misses worth noting? (yes/no + brief structural note)

Gut feel:
  - Did the memory system feel alive? (subjective, 1–5)
  - Was it ever actively annoying? (count of moments)

Threshold observations:
  - Did auto-promotion fire? (count of promotions)
  - Did any promotion feel premature in retrospect?
```

## Decision rule (pre-declared, do not renegotiate at the decision point)

After week 1:

**HARD BLOCK — do not ship:**
- Any ACL violation: a character referenced a fact that wasn't in their visibility
- Canon self-contradiction: the system confidently asserted ¬X after establishing X in the same session
- Cross-session memory loss: the day-3 recap fails to reference any day-1 canon

**SOFT BLOCK — +1 week tuning, then re-evaluate:**
- More than 30% of injected canon was irrelevant to the active scene
- "Actively annoying" happened 2+ times in any 3-hour session

**SHIP:**
- None of the above, even if the product doesn't yet feel magical. Absence of harm is the bar.

## Rules during the week

- **No mid-session tuning.** Thresholds are locked from day 0 to day 5 regardless. Tuning mid-stream invalidates the traces.
- **No transcripts leave the machine.** Ever. Notes are structural. The LLM provider already sees the content — that's it.
- **No feature additions.** The week is about measurement, not building. Code changes only for catastrophic bugs.
- **No silent overrides of the decision rule.** If hard block fires, ship is delayed. If soft block fires, +1 week. Write the verdict somewhere you can see before you decide whether to push.

## After the week

Regardless of ship/no-ship, write up:
1. The **findings** (structural, non-content)
2. The **threshold changes** if any, and why
3. The **failure modes** that surfaced
4. The **gaps** — things week 1 didn't test (cross-provider, >10h sessions, etc.)

This becomes the README's "what's proven / what's not yet proven" sections AND the body of the pattern article on the YantrikDB side.

## Troubleshooting

**Browser tab shows nothing after `docker compose up -d`:**
Check `docker compose logs -f chronicler` — the service needs `yantrikdb` to pass its healthcheck (first run takes ~60-90s because it downloads the embedding model). The compose file has `depends_on: condition: service_healthy` so chronicler waits.

**"Card import failed" / "Turn failed" red banner in the app:**
The error message will name the failure. Common: YantrikDB unreachable (compose service not running), invalid provider API key (check Settings), wrong model name for your provider.

**Memory backend status bar says `[memory]` but I want `[yantrikdb]`:**
Settings → Memory backend → YantrikDB (MCP). URL should be `/api/mcp` (default). The server proxies this to the YantrikDB service inside docker.
