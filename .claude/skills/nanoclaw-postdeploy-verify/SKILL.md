---
name: nanoclaw-postdeploy-verify
description: Use after deploying NanoClaw to production to confirm the service is healthy — runs smoke-send.ts probes, checks logs for errors, optionally verifies the deployed version, and rolls back automatically on critical failures.
---

# nanoclaw-postdeploy-verify

Phase [10] of `/build-it`. Run within 2 minutes of service restart.

## Step 1: Run smoke probes

```bash
npx tsx scripts/smoke-send.ts
```

Expected output (all 4 lines):
```
[smoke-send] Service is active
[smoke-send] SKIP: health socket not responding (...)   ← normal if NANOCLAW_HEALTH not set
[smoke-send] Container runtime healthy
[smoke-send] No recent ERROR log entries
[smoke-send] All critical probes passed.
```

Exit code `0` = probes passed. Exit code `2` = service not active (critical failure — go to Rollback).

The health socket probe showing `SKIP` is normal unless `NANOCLAW_HEALTH=1` is in the droplet's environment. It does NOT indicate a problem.

## Step 2: Check logs manually

```bash
ssh root@46.101.149.155 "tail -30 /root/nanoclaw/logs/nanoclaw.log"
```

**Pass criteria:**
- Channels connect: lines containing `Connected to Slack` / `Telegram bot connected`
- Scheduler starts: `Scheduler loop started`
- No ERROR lines: `grep '"level":50'` returns nothing

**What `"level":50` means:** ERROR. One or two warnings (`level:40`) are acceptable. A fatal (`level:60`) means immediate rollback.

## Step 3: Verify deployed version (optional but recommended for tagged releases)

```bash
ssh root@46.101.149.155 "cd /root/nanoclaw && git describe --tags --abbrev=0"
```

Should print the tag you just deployed (e.g., `v1.2.54`). If it prints an older tag, the pull may not have completed — investigate before declaring success.

## Pass criteria summary

A deploy is verified when ALL of the following are true:
1. `smoke-send.ts` exits `0`
2. Channels are connected in logs (Slack and/or Telegram)
3. No `"level":50` or `"level":60` entries in the last 30 log lines
4. (If tagged release) `git describe` on droplet returns expected tag

## Update the deploy log

Append to `docs/DEPLOY-LOG.md`:

```
- <ISO-TS> | <tag or main@sha> | from <prev-sha> | ok | nanoclaw@46.101.149.155
```

Also update the mission INDEX.md entry: change `deploy:pending` to `deploy:ok@<ISO-TS>`.

## Rollback

If step 1 exits `2` (service not active) or step 2 shows fatal/error-cascade:

```bash
PREV=$(ssh root@46.101.149.155 "cat /root/nanoclaw/.prev-deploy-sha 2>/dev/null")
ssh root@46.101.149.155 "cd /root/nanoclaw && git checkout $PREV && npm ci --prefer-offline --silent && npm run build --silent && systemctl restart nanoclaw 2>/dev/null || systemctl --user restart nanoclaw"
sleep 4
npx tsx scripts/smoke-send.ts
```

After rollback: update `docs/DEPLOY-LOG.md` with `| rollback@<ISO-TS>` and update the INDEX.md entry to `deploy:rollback@<ISO-TS>`.

## Common mistakes

| Mistake | Fix |
|---|---|
| Treating `SKIP` on health socket as a failure | It's not — health socket is opt-in |
| Checking logs before the service has fully started | Wait 3–5 s after restart before tailing logs |
| Declaring success based only on `systemctl status` | Status can be `active` while channels failed to connect — always check logs |
| Not updating DEPLOY-LOG.md | This is the deploy audit trail — always update it |
