---
name: nanoclaw-release
description: Use when bumping the NanoClaw version after a PR is merged to main — reads the last git tag, determines the correct semver bump, appends CHANGELOG.md in the established format, bumps package.json, commits, tags, and pushes. Run this before nanoclaw-deploy-droplet.
---

# nanoclaw-release

Phase [8] of `/build-it`. Only runs for core-fix and container-or-channel changes. Skip for op-utility-skill and feature-skill PRs.

## Step 1: Determine the version bump

```bash
# Read the last published tag (source of truth — not package.json)
git fetch --tags
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
echo "Last tag: $LAST_TAG"
```

Compute the next version:
- **Patch** (default): bug fixes, infra, CI, docs, skill additions
- **Minor**: new user-visible channel or major new capability
- **Major**: only if `CHANGELOG.md` has a `[BREAKING]` entry in this release window

```bash
# Example: bump patch from v1.2.53
# v1.2.53 → v1.2.54
```

**Note on version mismatch:** `package.json` may be ahead of the last git tag — this is normal if releases were bumped without tagging. Always use `git describe --tags` as the source of truth, not `package.json`.

## Step 2: Append to CHANGELOG.md (first)

Open `CHANGELOG.md`. Match the existing format exactly:

```markdown
## [1.2.54] - 2026-04-21

- Brief description of what changed
- [BREAKING] If applicable: what broke and migration path
```

Rules:
- One entry per release, newest at top
- Use `[BREAKING]` tag for anything that requires user action on upgrade
- Keep entries concise — this is a log, not a release essay
- Group related commits into one bullet, not one per commit

If there are `[BREAKING]` entries, also append to `RELEASE-NOTES.md` (create it if missing):

```markdown
## v1.2.54 — YYYY-MM-DD

**Breaking change:** [what changed]

**Migration:** [one-sentence action the user must take]
```

## Step 3: Bump package.json

```bash
npm version patch --no-git-tag-version
# (or minor/major depending on decision from Step 1)
```

This updates `package.json` and `package-lock.json`. Do NOT use `npm version` without `--no-git-tag-version` — that would create a git tag automatically, bypassing the annotated tag we'll create in Step 4.

## Step 4: Commit

```bash
git add CHANGELOG.md package.json package-lock.json
# Add RELEASE-NOTES.md if it was updated
git commit -m "release: v1.2.54"
git push origin main
```

## Step 5: Create and push the annotated tag

```bash
git tag -a v1.2.54 -m "Release v1.2.54"
git push origin v1.2.54
```

Annotated tags (not lightweight) are required so `git describe` works correctly on the droplet.

## Verify

```bash
git describe --tags --abbrev=0
# Should print: v1.2.54

grep '\[1.2.54\]' CHANGELOG.md
# Should find the entry
```

## Common mistakes

| Mistake | Fix |
|---|---|
| Using `package.json` version instead of `git describe` to determine the base | Use `git describe --tags --abbrev=0` — package.json may be stale |
| Using `npm version` without `--no-git-tag-version` | Always add the flag — let Step 5 create the tag explicitly |
| Creating a lightweight tag instead of annotated | Use `git tag -a` — lightweight tags don't carry a message and break `git describe` |
| Pushing the tag before pushing main | Push main first (Step 4), then the tag (Step 5) |
| Writing CHANGELOG after bumping version | Write CHANGELOG first (Step 2) — makes the commit message and review cleaner |
