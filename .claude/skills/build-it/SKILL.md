---
name: build-it
description: Use when a NanoClaw maintainer describes a change they want to make — drives the complete SDLC from intake through deployed production: brainstorm, plan, worktree, implement, test, review, PR, docs-sync, release, deploy, post-deploy verify. One command for the full lifecycle.
---

# build-it

End-to-end SDLC for the Alma fork. The maintainer describes intent; this skill drives all phases.

**Usage:** `/build-it "<intent>"` or `/build-it <linear-url>`

For resuming interrupted work: `/catch-up` to see state, then continue from the last completed phase.

## Change type (ask first)

Before starting, identify the change type — it determines which phases run:

| Type | What it is | Skips |
|---|---|---|
| **core-fix** | `src/` bug/security fix | — |
| **feature-skill** | New `/add-*` skill (branch-based) | Phases [8], [9], [10] |
| **op-utility-skill** | Instruction-only skill or utility on main | Phases [8], [9], [10] |
| **container-or-channel** | `container/` or `src/channels/` | — |

Use `AskUserQuestion` if the intent doesn't make the type obvious.

---

## Phase [0] — Intake

1. If the argument is a Linear URL (`linear.app/.*/ALM-\d+`), pull the ticket using the Linear MCP tools to get title, description, and acceptance criteria.
2. If freeform, ask: "Should I open a Linear ticket for tracking? (Y/n)"
3. Write `docs/superpowers/specs/.inflight-<date>-<slug>.json`:
   ```json
   {"changeType":"<type>","linearId":"ALM-<n>","slug":"<slug>","touchedAreas":[],"upstreamEligible":false,"currentPhase":0}
   ```

## Phase [1] — Brainstorm

**REQUIRED SKILL:** `superpowers:brainstorming`

Pre-load the intake manifest as context. The skill will produce `docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md`.

After the spec is approved by the user: update the inflight manifest `currentPhase: 1`.

## Phase [2] — Plan

**REQUIRED SKILL:** `superpowers:writing-plans`

Inject change-type-specific scaffolding from `references/change-types.md`. Output: `docs/superpowers/plans/YYYY-MM-DD-<slug>.md`.

Update `currentPhase: 2`.

## Phase [3] — Worktree

**REQUIRED SKILL:** `superpowers:using-git-worktrees`

Branch naming: `ALM-<id>-<slug>` (Linear-sourced) or `<type>/<slug>` (freeform).

After baseline tests are green: update `currentPhase: 3`.

## Phase [4] — Implement

**REQUIRED SKILLS:** `superpowers:subagent-driven-development` + `superpowers:test-driven-development`

On any failure: invoke `superpowers:systematic-debugging`. After 3 failed fix attempts, stop and surface to the maintainer.

Update `currentPhase: 4` when all plan tasks are complete.

## Phase [5] — Self-verify

**REQUIRED SKILLS:** `superpowers:verification-before-completion` + `nanoclaw-channel-smoke-matrix`

Run: `npm run format:check && npm run typecheck && npm run lint && npm test`

All must exit 0. Then run the channel smoke matrix per the changed files. Evidence required before claiming pass.

Update `currentPhase: 5`.

## Phase [6] — Code review

**REQUIRED SKILLS:** `superpowers:requesting-code-review` → `superpowers:receiving-code-review`

Pass the spec + plan + diff to the code-reviewer agent. Fix Critical before proceeding, Important before merge. If Qodo PR comments exist after phase [7], also run `/qodo-pr-resolver`.

Update `currentPhase: 6`.

## Phase [7] — Finish branch + PR

**REQUIRED SKILL:** `superpowers:finishing-a-development-branch`

Default: Option 2 (push + PR on `almalabs-ai/nanoclaw`).

**ALWAYS pass `--repo almalabs-ai/nanoclaw --base main --head <branch>` to `gh pr create`.** Never omit `--repo` — it will default to the upstream `qwibitai/nanoclaw` otherwise.

Use the PR template from `references/pr-template.md`. Poll CI until green before declaring ready to merge.

Update `currentPhase: 7` and write the PR number into the inflight manifest.

## Phase [7.5] — Docs sync

**REQUIRED SKILL:** `nanoclaw-docs-sync`

Run against the PR branch before merge. Must pass `npm test` (including all 6 docs-freshness tests) before merging.

Update `currentPhase: 7.5`.

## Phase [8] — Release

**REQUIRED SKILL:** `nanoclaw-release`  
**Skip for:** feature-skill, op-utility-skill

After CI is green and the PR is merged to main.

Update `currentPhase: 8` and write the tag into the inflight manifest.

## Phase [9] — Deploy

**REQUIRED SKILL:** `nanoclaw-deploy-droplet`  
**Skip for:** feature-skill, op-utility-skill

Use Mode A (tagged) if a tag was created in phase [8], Mode B (direct pull) otherwise.

Update `currentPhase: 9`.

## Phase [10] — Post-deploy verify

**REQUIRED SKILL:** `nanoclaw-postdeploy-verify`  
**Skip for:** feature-skill, op-utility-skill

On pass: update `docs/superpowers/INDEX.md` entry from `deploy:pending` to `deploy:ok@<ISO-TS>`. Update `docs/DEPLOY-LOG.md`. Delete `docs/superpowers/specs/.inflight-<slug>.json`.

On rollback: update INDEX.md to `deploy:rollback@<ISO-TS>` and stop.

---

## Checkpoint contract

Every phase boundary saves its output to disk. If the session ends mid-pipeline:
1. Run `/catch-up` to see current phase from the inflight manifest
2. Resume from that phase — do NOT restart from [0]

## Common mistakes

| Mistake | Fix |
|---|---|
| Opening PR without `--repo almalabs-ai/nanoclaw` | Always explicit — see Phase [7] |
| Running phase [8] for a feature-skill | Check change type — skills don't get version-tagged |
| Skipping docs-sync because "nothing changed in docs" | Run it anyway — it catches drift introduced by the code changes |
| Deleting `.inflight-*.json` before phase [10] passes | Keep it until post-deploy is confirmed |
