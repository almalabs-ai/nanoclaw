---
name: nanoclaw-docs-sync
description: Use when anchor docs (CLAUDE.md, CONTRIBUTING.md, README.md) may have drifted from the codebase after a PR — runs the freshness auditor, fixes failures, writes an ADR for non-trivial design choices, updates the mission index, and commits. Also use standalone after any direct-to-main commit that bypassed a PR.
---

# nanoclaw-docs-sync

Phase [7.5] of `/build-it`. Non-skippable. Run against the PR branch before merge.

## Step 1: Run the auditor

```bash
npx tsx scripts/docs-scan.ts
```

If "All doc-freshness checks passed" — skip to Step 3. Otherwise, fix every failure.

## Step 2: Fix failures

| Failure type | Fix |
|---|---|
| `Skill 'X' not listed in CLAUDE.md` | Add `\| \`/X\` \| <description> \|` to the skill table in `CLAUDE.md` |
| `Channel 'X' has no active import` | Uncomment (or add) `import './X.js';` in `src/channels/index.ts` |
| `Container skill 'X' not mentioned in CLAUDE.md` | Add `X` to the Container Skills table in `CLAUDE.md` |
| `Git tag 'vX' has no entry in CHANGELOG.md` | Add `## [X.Y.Z] - YYYY-MM-DD` entry; see existing entries for format |
| `'spec'/'plan' references missing file` | Fix the path in the YAML header of the spec/plan file, or create the missing file |
| `INDEX.md references non-existent file` | Fix the markdown link in `docs/superpowers/INDEX.md` |

**Anchor doc update rules (strict):**
- **`CLAUDE.md`**: update skill table, Key Files table, or channels section when those changed. Do NOT add prose.
- **`README.md`**: update only if user-visible capabilities changed (new channel, major feature). Leave philosophy alone.
- **`CONTRIBUTING.md`**: update only if the contribution flow itself changed (new skill type, new PR template requirement).
- **`docs/DEPLOYMENT-DO.md`**: update only if deploy mechanics changed (new env var, new service file path).

Run `npx tsx scripts/docs-scan.ts` again to confirm 0 failures before proceeding.

## Step 3: Write an ADR (if a non-trivial design decision was made)

An ADR is warranted when the mission made a choice that a future maintainer would question. Examples: chose UDS over HTTP for health endpoint; chose direct git pull over a registry; chose vitest over jest.

If warranted, write `docs/superpowers/decisions/YYYY-MM-DD-<slug>.md`:

```markdown
# ADR: <title>

**Date:** YYYY-MM-DD  
**Mission:** <slug>  
**Status:** accepted

## Decision
[One sentence: what was chosen]

## Context
[2-3 sentences: what forced the decision]

## Consequences
[What this enables + what it rules out]
```

If the mission had no non-obvious design choices, skip this step.

## Step 4: Append to INDEX.md

Add a line at the top of the `## Index` section in `docs/superpowers/INDEX.md`:

```
- YYYY-MM-DD | ALM-<id> (or "none") | <changeType> | <slug> | spec:<path> plan:<path> pr:#<n> tag:<vX.Y.Z or pending> | deploy:pending
```

Fill in whatever is known. Leave unknowns as `pending` or `tbd`.

## Step 5: Commit

```bash
git add CLAUDE.md CONTRIBUTING.md README.md docs/superpowers/decisions/ docs/superpowers/INDEX.md
git commit -m "docs: sync for <slug>"
```

Only stage files that actually changed. The commit message must be `docs: sync for <slug>` (required by the CI freshness test pattern).

## Verify

```bash
npm test -- src/docs-freshness.test.ts
```

All 6 tests must pass. If any fail, fix before proceeding to phase [8].
