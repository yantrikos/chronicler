# Contributing to Chronicler

First: this is a maintained-but-small project. The scope is intentionally narrow — **make LLM memory trustworthy for multi-session roleplay**, and everything in service of that. Contributions that sharpen that focus are extremely welcome. Contributions that widen it meet more scrutiny.

## Before you start

Read these first, in order:

1. **[README.md](README.md)** — what Chronicler is and isn't
2. **[docs/PATTERN.md](docs/PATTERN.md)** — the memory architecture and failure modes it addresses
3. **[docs/ADR-002-memory-conventions.md](docs/ADR-002-memory-conventions.md)** — the three-tier write contract (any change touching memory semantics must update this)
4. **[docs/DOGFOOD.md](docs/DOGFOOD.md)** — pre-declared ship/no-ship rules. These apply to PRs too.

If a change touches how memories are written, classified, retrieved, or promoted, read ADR-002 carefully before proposing it.

## Development setup

```bash
git clone <your-fork> && cd chronicler
npm install
docker compose up -d    # optional: full stack for integration testing

# frontend dev with HMR (expects Node proxy on :3001)
npm run dev

# in a second terminal, run the proxy
npm run dev:server

# or: prod-mode run
npm run build && npm start

# all test suites (required to pass before any PR)
npm test
npm run test:integration   # requires a running yantrikdb-mcp
```

## Pull request expectations

### Must pass

- `npx tsc --noEmit` — no TypeScript errors
- `npm test` — all 7 automated suites green. **No exceptions.** If your change would fail one, explain in the PR body why it's correct behavior and update the test.
- `npx vite build` — frontend bundles cleanly
- `docker compose build` — the production image builds

### Nice to have

- A new test covering the behavior you added or fixed. The test suites listed in CHANGELOG have names that describe properties; add yours to match.
- Screenshots or a short recording for UI changes
- An ADR update if you're changing architectural decisions

### Won't merge

- Any change that weakens the privacy properties (visibility ACL, log redaction defaults, localhost-only binding without opt-out of consequences documented)
- Any change that loosens the memory trust contract (auto-promotion without threshold tuning evidence, writes that bypass the tier distinction, recap prompts without anti-confabulation framing)
- Silent dependencies — a PR that adds a new runtime dep needs a justification in the body. We keep the surface small on purpose.
- Secrets of any kind in committed files, even test keys. Use env vars or config files excluded via `.gitignore`.

## Commit + branch style

- Short imperative commits ("add swipe navigation on last assistant turn", "fix MCP transport URL resolution in Node"). Body optional. No conventional-commits requirement.
- Branch names: `feature/short-desc`, `fix/short-desc`, `docs/short-desc`.
- Rebase or squash before the merge is fine; we don't enforce either, pick what keeps history readable.

## Scope: what we're actively interested in

- **New LLM providers** (Gemini, Mistral, DeepSeek native, llama.cpp raw, Horde, etc.) — follow the pattern in [providers/index.ts](src/lib/providers/index.ts)
- **Lorebook extensions** from the v3 spec we haven't implemented (recursive scanning, probability, depth-based injection)
- **Instruct templates** per model for raw endpoints that don't apply chat templates themselves
- **Additional test suites** exercising edge cases in memory correctness, privacy, or promotion behavior
- **Bug fixes** of any kind — open a Discussion first if you want to confirm it's a bug before writing a fix
- **Card format compatibility** fixes — chub.ai v3 has evolving corners; real-world card bugs are very welcome
- **Documentation tightening** — factual fixes, clearer explanations, examples. PATTERN.md especially welcomes feedback from people building similar systems.

## Scope: please open a Discussion before a PR

- New feature areas not in the current feature list (image gen, TTS, translation, extensions platform, multi-user accounts)
- UI theming / accessibility overhauls (light mode is planned but needs its own refactor — coordinate first)
- Alternative memory engines — we're coupled to YantrikDB by design, pluggability is welcome but needs architectural coordination
- Changes to default auto-promotion thresholds

## Scope: deliberately out

- Cloud / SaaS offering. This project stays self-hosted.
- Mobile-native apps. Web PWA is the mobile story.
- Cryptocurrency / NFT integration of any kind.
- Features designed to work around model safety / alignment in providers' APIs. Use a different provider — the model selection is yours.

## Reporting + feedback channels

- **Structural bugs, build issues, docs issues**: open a Discussion in the Q&A category
- **Feature proposals**: open a Discussion in the Ideas category
- **Anything touching session content** (memory went wrong, lorebook misfired in a specific scene, etc.): **private email to `developer@pranab.co.in`** per [SUPPORT.md](SUPPORT.md). Do not paste transcripts publicly.
- **Security concerns**: see [SECURITY.md](SECURITY.md).

## Code of Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Contributor Covenant 2.1. Enforcement is at the maintainer's discretion; the target audience and the topic area both attract a wide range of people, and we'll moderate for respectful collaboration.

## Thanks

The project is better when people who actually use it for long sessions come back with specific complaints and specific fixes. If you've run 20+ hours of RP through this and have observations, that's the kind of contribution that matters most.
