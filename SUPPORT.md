# Support

Chronicler handles sensitive personal content by default. **Do not paste session transcripts, character dialogue, or memory text into public issue trackers.**

## Reporting bugs

GitHub Issues is disabled for this repo. Two channels:

### Structural bugs (safe to share publicly)
Setup failures, crashes, the app won't start, build errors, config problems — these almost never contain session content. Use **GitHub Discussions** (Q&A category). Include: OS, Node/Rust versions, what you ran, error output.

### Session-level bugs (involves content)
Anything that touches what the character said, what the memory system stored, what got recalled, what was inferred — use **private email**. Send to: `developer@pranab.co.in`.

What to include:
- A **description of the failure in your own words** ("Mei mentioned a detail she should not have known")
- The **structural trace** — Chronicler writes redacted logs to `~/.chronicler/logs/` by default. Attach those.
- **Do not paste transcripts.** If a specific line is essential, rewrite it as a neutral placeholder: "character said something about the user's hometown that contradicted an earlier pinned fact."

### Why this is strict

The target audience skews NSFW/private. Public session content becomes searchable, potentially trained on, and can embarrass users whose RP was never meant to leave their machine. We'd rather be harder to report to than leak someone's late-night story.

## Getting involved

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the full contributor flow. Short version:

- Discussion-first for feature proposals or larger changes
- PRs welcome for bug fixes, card-format compatibility, extractor improvements, provider adapters, documentation tightening
- All 7 test suites must pass; privacy and memory-trust properties are non-negotiable
- Commit style: short imperative, no conventional-commits requirement

For **security vulnerabilities**: do NOT use Discussions. See [SECURITY.md](SECURITY.md).

## What will not get answered

- Requests for features that require autonomous personality mutation (that's deliberate — personality changes are user-opt-in, see ADR-002)
- Support for uncensored model hosting / jailbreaks (we're LLM-agnostic, bring your own provider)
- Integration with specific paid character marketplaces beyond the v2/v3 card format
