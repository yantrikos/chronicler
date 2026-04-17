# GitHub Repo Setup

Run these once after creating the repo, in the order given. Requires `gh` CLI authenticated.

## One-time setup

```bash
# Assuming the repo has been created as spranab/chronicler (or your org)
REPO=spranab/chronicler   # ← change this
```

### Description + topics

```bash
gh repo edit "$REPO" \
  --description "Local-first roleplay with living memory. Self-hosted. Imports v2/v3 character cards. Runs on any LLM." \
  --homepage "https://github.com/$REPO" \
  --add-topic roleplay \
  --add-topic character-ai \
  --add-topic local-first \
  --add-topic llm \
  --add-topic memory \
  --add-topic rag \
  --add-topic self-hosted \
  --add-topic ollama \
  --add-topic anthropic \
  --add-topic docker \
  --add-topic typescript \
  --add-topic react \
  --add-topic character-card
```

### Disable Issues, enable Discussions

```bash
# Disable issues (session content is sensitive — see SUPPORT.md)
gh repo edit "$REPO" --enable-issues=false

# Enable Discussions (Q&A and Ideas only)
gh repo edit "$REPO" --enable-discussions=true
```

Then via the web UI at `https://github.com/$REPO/settings`:

- **Discussions → Categories**: keep `Q&A`, `Ideas`, `Show and tell`. Delete or hide: `General`, `Announcements` (for now; re-enable later when there are announcements to make). Do NOT enable `Polls` or anything that invites raw content.
- **Features → Issues**: confirm disabled.
- **Features → Wiki**: disable. Docs live in `/docs/` in-repo.
- **Features → Projects**: disable unless you plan to use it actively.

### Social preview image

`docs/social-preview.svg` exists in this repo at 1280×640. To use it as the GitHub social preview, you need a PNG — generate one with:

```bash
npm install  # pulls in sharp as a devDependency
npm run build:icons
# produces public/social-preview-1280x640.png
```

Then upload it at `https://github.com/$REPO/settings` → **Social preview** → drag-and-drop.

### Branch protections (once you invite contributors)

```bash
gh api repos/$REPO/branches/main/protection \
  -f required_status_checks.strict=true \
  -f enforce_admins=false \
  -f required_pull_request_reviews.required_approving_review_count=1 \
  -f restrictions= \
  -X PUT
```

Adjust once CI is wired up.

### CI placeholder

A `.github/workflows/` dir is not yet included — add one after first public feedback. Minimum acceptable CI:

- `npm ci`
- `npx tsc --noEmit`
- `npm test` (runs all 7 test suites)
- `docker compose build` (smoke test the image builds)

A complete workflow example is intentionally left out until we've dogfooded enough to know what actually needs protecting.

## Release tagging

```bash
# After the 0.1.0 code lands on main:
git tag -a v0.1.0 -m "v0.1.0 — first public release"
git push origin v0.1.0

gh release create v0.1.0 \
  --title "v0.1.0 — Chronicler, first public release" \
  --notes-file CHANGELOG.md \
  --draft

# Review the draft at https://github.com/$REPO/releases then publish.
```

## The SUPPORT.md + ISSUE_TEMPLATE config is already in place

The repo ships with `SUPPORT.md` (routing) and `.github/ISSUE_TEMPLATE/config.yml` (disables blank issues, points to Discussions + private email). These take effect automatically when the repo is pushed to GitHub.

## Post-launch checklist

- [ ] Repo description + topics set
- [ ] Issues disabled, Discussions enabled with Q&A / Ideas / Show-and-tell categories
- [ ] Wiki, Projects disabled (unless actively used)
- [ ] Social preview image uploaded
- [ ] v0.1.0 release draft created and reviewed
- [ ] README screenshots added (human task — after real dogfood session)
- [ ] Demo video linked in README (human task)
- [ ] PATTERN.md cross-posted to r/LocalLLaMA and HN with repo link (human task)
