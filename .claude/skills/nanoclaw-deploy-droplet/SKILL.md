---
name: nanoclaw-deploy-droplet
description: Use when deploying NanoClaw changes to the production DigitalOcean droplet after a PR is merged — handles both quick (no tag) and tagged-release deploys, decides whether to rebuild the container, verifies with smoke-send.ts, and rolls back on failure.
---

# nanoclaw-deploy-droplet

Deploy merged changes to the production droplet. Run this skill after any PR that touches `src/` or `container/` is merged to `almalabs-ai/nanoclaw` main.

**Skip this skill** for: op-utility skill PRs (SKILL.md only), pure doc changes, container-skills-only changes that don't affect the agent image.

## Prerequisites

Confirm `~/.config/nanoclaw/deploy.json` exists:

```bash
cat ~/.config/nanoclaw/deploy.json
```

If missing, create it:

```bash
mkdir -p ~/.config/nanoclaw
cat > ~/.config/nanoclaw/deploy.json <<'EOF'
{
  "dropletIp": "46.101.149.155",
  "dropletUser": "root",
  "nanoclaw_dir": "/root/nanoclaw"
}
EOF
```

## Deploy — two modes

### Mode A: Tagged release (use after `nanoclaw-release` creates a tag)

```bash
ssh root@46.101.149.155 "cd /root/nanoclaw && bash scripts/remote-deploy.sh <tag>"
# e.g. bash scripts/remote-deploy.sh v1.4.2
```

`remote-deploy.sh` fetches the tag, runs `npm ci + build`, optionally rebuilds the container (see below), and restarts the service.

### Mode B: Direct pull (no tag yet — use until `nanoclaw-release` skill is installed)

```bash
# 1. Save rollback anchor
ssh root@46.101.149.155 "cd /root/nanoclaw && git rev-parse HEAD > .prev-deploy-sha"

# 2. Pull, build, restart
ssh root@46.101.149.155 "cd /root/nanoclaw && git pull origin main && npm ci --prefer-offline --silent && npm run build --silent"

# 3. See "Container rebuild" section — decide if needed

# 4. Restart
ssh root@46.101.149.155 "systemctl restart nanoclaw 2>/dev/null || systemctl --user restart nanoclaw"
```

## Container rebuild decision

Only rebuild if the PR changed anything under `container/`:

```bash
# Check if container/ was in the diff
git diff --name-only HEAD~1 HEAD | grep -q '^container/' && echo "REBUILD" || echo "SKIP"
```

If REBUILD:

```bash
ssh root@46.101.149.155 "cd /root/nanoclaw && docker builder prune -af --filter type=exec.cachemount 2>/dev/null; ./container/build.sh"
```

**Do not skip the prune** — `--no-cache` alone doesn't invalidate COPY steps (see `CLAUDE.md` Container Build Cache note). Container rebuild takes ~5 min.

## Verify

```bash
npx tsx scripts/smoke-send.ts
```

Expected output:
```
[smoke-send] Service is active
[smoke-send] Container runtime healthy
[smoke-send] No recent ERROR log entries
[smoke-send] All critical probes passed.
```

The health socket probe is skipped unless `NANOCLAW_HEALTH=1` is set in the droplet's environment — that's normal.

Also confirm in logs:

```bash
ssh root@46.101.149.155 "tail -20 /root/nanoclaw/logs/nanoclaw.log"
```

Look for: channels connected, scheduler started, no `level":50` (ERROR) lines.

## Rollback

If smoke fails or the service crashes:

```bash
# Retrieve the pre-deploy SHA saved in step 2
PREV=$(ssh root@46.101.149.155 "cat /root/nanoclaw/.prev-deploy-sha 2>/dev/null")

if [ -n "$PREV" ]; then
  ssh root@46.101.149.155 "cd /root/nanoclaw && git checkout $PREV && npm ci --prefer-offline --silent && npm run build --silent && systemctl restart nanoclaw 2>/dev/null || systemctl --user restart nanoclaw"
else
  echo "No rollback anchor found — check git log on the droplet and checkout manually"
fi
```

After rollback, run `npx tsx scripts/smoke-send.ts` again to confirm the previous version is healthy.

## Common mistakes

| Mistake | Fix |
|---|---|
| Skipping container rebuild after `container/` changes | Check git diff — always rebuild if container/ touched |
| Using `git checkout HEAD~1` for rollback | Use the saved `.prev-deploy-sha` — HEAD~1 is wrong if multiple commits merged |
| Not saving `.prev-deploy-sha` before pull | Run the save step BEFORE pull, not after |
| Running smoke check before service has started | Wait 3–5 s after restart before running `smoke-send.ts` |
