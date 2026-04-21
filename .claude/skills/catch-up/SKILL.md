---
name: catch-up
description: Use when starting a fresh Claude Code session on NanoClaw and needing to quickly reconstruct the current state of a mission — what was done, where it stands, and what comes next. Use for "catch me up", "where did we leave off", or before resuming interrupted work.
---

# catch-up

Reconstruct the state of an in-progress or recently completed mission from committed artifacts. Takes ~60 seconds.

## Step 1: Check the mission index

```bash
cat docs/superpowers/INDEX.md
```

If there are entries, find the most recent one. Each line has: `DATE | LINEAR | TYPE | SLUG | spec plan review pr tag deploy`.

## Step 2: Check the deploy log

```bash
tail -5 docs/DEPLOY-LOG.md
```

This shows the last production deploy. If `deploy:pending` in INDEX.md, the mission is still in progress.

## Step 3: Locate the in-flight manifest (if mission in progress)

```bash
ls docs/superpowers/specs/.inflight-*.json 2>/dev/null
```

If found, read it — it contains `{changeType, linearId, touchedAreas[], upstreamEligible, currentPhase}`.

## Step 4: Read the plan doc

For the mission slug, open `docs/superpowers/plans/YYYY-MM-DD-<slug>.md`. Scan the task list for the last `✅` or completed step — that's where we left off.

## Step 5: Check local branch and git log

```bash
git log --oneline -8
git status --short
```

This shows what was committed, what's staged, and any uncommitted work.

## Report format

Summarize in this order:

1. **Mission**: slug + Linear ID (or "no active mission")
2. **Current phase**: which of the 11 `/build-it` phases (or "deployed")
3. **Last artifact**: the most recent committed thing (spec, plan, PR, tag, deploy entry)
4. **Next action**: one concrete sentence
5. **Blockers**: anything missing or broken

## If INDEX.md is empty

The `/build-it` skill hasn't been used yet. Check `git log --oneline -10` and `docs/DEPLOY-LOG.md` directly — look for recent feature commits to infer what was worked on. The plan doc at `docs/superpowers/plans/` is the authoritative source of what's complete.

## Quick state signals

| Signal | Meaning |
|---|---|
| `.inflight-*.json` exists | Mission in progress — read it |
| `deploy:pending` in INDEX.md | PR merged, not yet deployed |
| `deploy:ok@...` in INDEX.md | Mission complete |
| Local branch ahead of origin | Unpushed work |
| `docs/DEPLOY-LOG.md` has recent entry | Last deploy was successful |
