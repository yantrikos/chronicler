# Security Policy

## Reporting a vulnerability

**Do not open a public GitHub Discussion or PR for a suspected security issue.**

Email **developer@pranab.co.in** with:

1. A clear description of the vulnerability
2. Steps to reproduce (locally; do not share traffic from other people's instances)
3. What the impact is — what an attacker could read, write, or cause
4. (Optional) a suggested fix or mitigation

You'll get an initial acknowledgement within 72 hours. Fix timelines depend on severity — critical issues affecting privacy properties are patched with the highest priority.

If you publish your findings after a reasonable disclosure window (30 days for non-critical, 7 days for actively exploited) we have no beef — disclosure is part of the deal. We'd appreciate coordinating on timing.

## What counts as security-class

- **Privacy property violations.** The `visible_to` ACL, namespace isolation between characters, and redacted-by-default logs are load-bearing. Any path that causes a character to read another character's private memories, or causes log output to include memory text or session content without `CHRONICLER_VERBOSE_LOGS=1`, is a security issue.
- **Proxy bypass or abuse.** The `/api/llm` proxy is designed so API keys and target URLs are carried in request bodies that never leave localhost. A vulnerability enabling unauthenticated external callers to use the proxy as an open relay, or leaking keys via logs / error messages / response headers, is a security issue.
- **Arbitrary file read / write via the Node server.** The static-file path normalizes against `DIST_DIR`; any path-traversal that escapes it is a security issue.
- **MCP injection.** Malicious responses from a rogue MCP server should not be able to execute code in the browser or the Node proxy. If they can, report it.
- **Card import that compromises the host.** v2/v3 card PNG parsing is done in the browser; a malformed card that causes more than a clean parse error is a security issue.
- **Docker escape.** The default docker-compose mounts a named volume for YantrikDB data. An issue allowing container-level access to unexpected host paths is a security issue.

## What is NOT a security issue (won't trigger an embargo)

- Model-generated content that's offensive, inappropriate, or confabulatory. Those are model / prompt issues — route via [SUPPORT.md](SUPPORT.md).
- LLMs accessed with the user's own API keys reading the user's own prompts. The user provided the keys and the data; that's the design.
- Running Chronicler on a public network without adding an auth layer. The stack binds to `127.0.0.1` by default; removing that binding without fronting it with Caddy / Tailscale / your own auth is an operational choice, not a Chronicler vulnerability.
- Lorebook entries that trigger when you'd rather they didn't. That's a prompt design / author issue.

## Threat model Chronicler is designed against

- **Accidental privacy leaks in group chats.** Handled by visibility ACLs filtered pre-ranking (see `tests/secret-stays-private.test.ts`).
- **Accidental content exposure via logs.** Handled by text-field redaction defaults (see `src/lib/instrumentation/`).
- **Accidental content exposure via public bug reports.** Handled by SUPPORT.md's private email routing + disabled GitHub Issues.
- **LLM confabulation inventing facts that weren't in memory.** Handled by the anti-confabulation clause and strict recap prompting.

Threats we explicitly do NOT defend against (yet — all documented):

- Multi-user hostile scenarios on a shared Chronicler instance. The product assumes a single trusted user, self-hosted.
- Encrypted-at-rest memory. YantrikDB stores to disk; disk encryption is the OS's job.
- Adversarial card supply chain. We parse cards as untrusted input (good) but don't sandbox the extraction LLM's output. An adversarially-crafted card that produces prompt-injection payloads to the model is on the user to notice.

## Thanks

Vulnerability reports are genuinely appreciated. Public acknowledgement in the CHANGELOG for the fix release is offered unless you'd prefer to stay anonymous.
