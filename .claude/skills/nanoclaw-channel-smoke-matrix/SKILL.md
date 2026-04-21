---
name: nanoclaw-channel-smoke-matrix
description: Use when a PR touches channel code, router, or container skills and you need to know which tests to run and in what order — maps changed files to their unit test coverage, runs the targeted tests, and determines whether a live container smoke test is also needed.
---

# nanoclaw-channel-smoke-matrix

Phase [5] verification helper for `/build-it`. Determines the right test scope based on what was changed.

## Step 1: Map changed files to test suites

```bash
git diff --name-only main..HEAD
```

Use this table to decide what to run:

| Changed path | Run these tests |
|---|---|
| `src/channels/telegram.ts` | `npm test -- src/channels/telegram.test.ts` |
| `src/channels/slack.ts` | `npm test -- src/channels/slack.test.ts` |
| `src/channels/registry.ts` | `npm test -- src/channels/registry.test.ts` |
| `src/router.ts` | `npm test -- src/formatting.test.ts src/routing.test.ts` |
| `src/ipc.ts` | `npm test -- src/ipc-auth.test.ts` |
| `src/index.ts` | `npm test -- src/routing.test.ts` (integration) |
| `src/identity/` | `npm test -- src/identity/people.test.ts` |
| `src/policy/` | `npm test -- src/policy/policy.test.ts` |
| `container/skills/` | Run full `npm test` — container skills affect all groups |
| `container/agent-runner/` | Full `npm test` + container smoke (see Step 3) |
| `container/Dockerfile` | Full `npm test` + container smoke (see Step 3) |

When in doubt, run `npm test` (all 376 tests, ~500 ms — fast enough to always run).

## Step 2: Run unit tests

```bash
# Targeted (fast, for PR review):
npm test -- src/channels/telegram.test.ts src/formatting.test.ts

# Full suite (always required before finalizing):
npm test
```

All tests must pass. If any fail, invoke `superpowers:systematic-debugging` before proceeding.

## Step 3: Container smoke test (only when `container/` changed)

A live container smoke is only needed when `container/Dockerfile`, `container/agent-runner/src/`, or `container/skills/` was modified. For `src/channels/` or `src/router.ts` changes alone, unit tests are sufficient.

If container smoke is needed:

```bash
# 1. Rebuild the container image locally
./container/build.sh

# 2. Run a minimal agent invocation against a throwaway group
# (Use the claw CLI if installed, or create a test message via IPC)
# Verify: container starts, agent responds, no fatal errors in output
```

The container smoke test is intentionally lightweight — the goal is "agent can spin up and respond," not full message-flow testing. Full integration is tested by the live deploy + nanoclaw-postdeploy-verify.

## Step 4: Report

Report which tests were run and their results:

```
Channel smoke matrix:
  ✅ src/channels/telegram.test.ts — 61 tests passed
  ✅ src/formatting.test.ts — 11 tests passed  
  ✅ Full npm test — 376 passed
  ⬜ Container smoke — skipped (no container/ changes)
```

If any test fails, it must be fixed before proceeding to phase [6] code review.

## Common mistakes

| Mistake | Fix |
|---|---|
| Running only the channel test but not `npm test` | Always run the full suite before marking done |
| Running container smoke for `src/` only changes | Skip it — live integration is tested post-deploy |
| Treating formatting.test.ts as unrelated to router changes | `src/router.ts` contains `formatMessages` — always run formatting tests when router changes |
| Skipping the matrix because "it's a minor change" | The matrix takes <30 s — always run it |
