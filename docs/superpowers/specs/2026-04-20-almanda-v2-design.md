# Almanda v2 — Company Assistant MCP Bundle + Persona Redesign

**Date:** 2026-04-20  
**Author:** Andrey Oleynik  
**Status:** Approved — proceeding to implementation

---

## Context

NanoClaw fork runs v1 (Slack + Telegram + identity + policy for ~30 Almalab employees). This spec covers the deferred v2 bundle: Company Knowledge Base MCP, Linear, GitHub, Slack Intel, and a persona redesign — structured so the architecture scales to planned v3 capabilities (meeting scheduling, attendance reporting) without re-design.

---

## Architecture: Three-Tier Capability Composition

Every capability slots into three tiers:

| Tier | Location | Loading | Purpose |
|---|---|---|---|
| **1 — Persona + Capability Index** | `groups/global/CLAUDE.md` | Always-loaded | Almanda identity, global operating rules, one-line index pointing each capability to its Tier-3 playbook |
| **2 — MCP server instructions** | Server `instructions` field | Auto-surfaced by SDK | Routing hints owned by the server. Do NOT duplicate in CLAUDE.md — that causes drift. |
| **3 — On-demand playbook** | `container/skills/<cap>/SKILL.md` | Loaded via SDK skill description-match | Tool names, read/write boundaries, approval patterns, worked examples |

**Discovery fragility:** Tier 3 fires only when the skill `description` matches. Tier 1 index MUST carry the minimum behavioral spine per capability. Verify each skill with three non-obvious user phrasings.

**Main-group gap:** `container/agent-runner/src/index.ts:416–420` guards global CLAUDE.md behind `!containerInput.isMain`. Must remove this guard (one-line anchor, logged in `docs/UPSTREAM-PRS.md`) so the main group sees Tier 1.

---

## Almanda Persona

### Identity rename

`Andy` → `Almanda` in `groups/main/CLAUDE.md`, `groups/global/CLAUDE.md`, `groups/slack_main/CLAUDE.md`, `groups/tg_andrey/CLAUDE.md`. These are install-local data files, not upstream code.

### Global operating rules (new section in `groups/global/CLAUDE.md`)

> If you can read it, retrieve it, or look it up — just do it. Never say "I can pull this doc" when you can pull it.
>
> Ask for approval before:
> - Creating or updating a Linear issue
> - Opening, commenting on, or merging a GitHub issue or PR
> - Posting a message to a Slack channel (except main group DMs)
> - Any other action that creates or modifies something outside your workspace
>
> For write actions: describe exactly what you'll do, then ask "Should I go ahead?" in one line.
>
> Suggest (don't execute) when scope is ambiguous: "Search for X — want me to try?"

### Capability Index (`groups/global/CLAUDE.md`)

| Capability | Tools | Playbook |
|---|---|---|
| Company Knowledge Base | mcp__alma-library__ask, search, list_sources | /company-kb |
| Linear | mcp__linear__* | /linear-ops |
| GitHub | mcp__github__* | /github-ops |
| Slack Intel | mcp__slack-intel__* | /slack-intel |
| Meeting scheduling (v3) | TBD | TBD |
| Attendance reporting (v3) | TBD | TBD |

---

## Permission Model

| Mechanism | Location | Used for |
|---|---|---|
| **Prose** (ask before write) | Tier 1 + Tier 3 per skill | Routine writes — create issue, post message, open PR |
| **Policy** (hard deny) | `~/.config/nanoclaw/policy.json` + `src/policy/checkCapability` | Catastrophic writes — force-push main, delete issue, post to public channel |

v2 MVP: prose only. Policy hard-gates enumerated below but deferred to Phase 2.5.

Policy capability names for Phase 2.5: `linear.delete`, `github.force_push_main`, `github.merge_without_review`, `slack.post_public`.

---

## Credential Delivery Pattern

OneCLI-first with `.env` fallback — matching `add-gmail` pattern. Each skill installer:
1. `grep -q 'ONECLI_URL=' .env` → if yes, direct to `${ONECLI_URL}/connections?connect=<service>`
2. If not, prompt for token → write to `.env`
3. In all cases: add var to `allowedVars` in `src/container-runner.ts` (anchor)

---

## Phased Delivery

### Phase 0 — `skill/add-almanda-core`

Persona rename + global rules + capability-index scaffold + main-group fix + ops-playbook skill.

**Files:**
- `groups/main/CLAUDE.md`, `groups/global/CLAUDE.md`, `groups/slack_main/CLAUDE.md`, `groups/tg_andrey/CLAUDE.md` — Andy → Almanda; new Operating Rules + Capabilities sections in global
- `container/agent-runner/src/index.ts` — drop `!containerInput.isMain` guard (~line 418)
- `docs/UPSTREAM-PRS.md` — log anchor
- **New:** `container/skills/almanda-ops/SKILL.md`
- **New:** `.claude/skills/add-almanda-core/SKILL.md`

**Acceptance test:** Every group (main + non-main) receives Operating Rules in system context. Write-action probes trigger approval request.

---

### Phase 1 — `skill/add-company-kb`

Proves the three-tier pattern end-to-end. All later phases are clones of this.

**Files:**
- `container/agent-runner/src/index.ts` — `mcpServers.alma-library` (type: http, url, Bearer from env), `mcp__alma-library__*` in allowedTools
- `src/container-runner.ts` — `ALMA_LIBRARY_API_KEY` in allowedVars
- `.env.example` — `ALMA_LIBRARY_API_KEY=`
- **New:** `container/skills/company-kb/SKILL.md`
- **New:** `.claude/skills/add-company-kb/SKILL.md`
- `groups/global/CLAUDE.md` — fill in Company Knowledge Base capability-index row

**Acceptance test:** "who is Andrey?" → calls `mcp__alma-library__ask`, cites source, no WebSearch. "who invented the transistor?" → WebSearch (not internal). Container logs show MCP registration.

---

### Phase 2 — Parallel skills (after Phase 1 validates the pattern)

#### 2a — `skill/add-linear-ops`
Spike first: evaluate Linear's official HTTP MCP vs `@tacticlaunch/mcp-linear`. Lock choice in skill.  
Env var: `LINEAR_API_KEY`.

#### 2b — `skill/add-github-ops`
Spike: official `github-mcp-server` binary in container image vs `gh` CLI wrapper skill. Default: official binary; fall back to CLI if container image growth is unacceptable.  
Env var: `GH_TOKEN`.

#### 2c — `skill/add-slack-intel` (spike first)
Evaluate: `korotovsky/slack-mcp-server` (community stdio) > custom `slack-intel-mcp-stdio.ts` reusing `src/channels/slack.ts` > Bash/SDK fallback.  
Reuse existing `SLACK_BOT_TOKEN`/`SLACK_APP_TOKEN` from outbound channel. Requires added scopes: `channels:history`, `groups:history`, `im:history`, `users:read`, `search:read`.

---

### Phase 2.5 — `skill/add-write-policy-gates` (post-MVP, optional)

Add `linear.delete`, `github.force_push_main`, `github.merge_without_review`, `slack.post_public` to `policy.json`. Wire `checkCapability` at MCP tool wrappers. Dependency: Phase 2 live.

---

### Phase 3 — v3 capabilities (separate brainstorm+plan cycles)

- `skill/add-meeting-scheduling` — Google Calendar MCP
- `skill/add-attendance-reporting` — HR-system MCP or timesheet parser

Scaling proof: each adds (1 Tier-1 index row) + (1 container skill) + (1 MCP/CLI) + (one `allowedVars` anchor).

---

## Critical File Hotspots

- `container/agent-runner/src/index.ts:452,477,418` — allowedTools, mcpServers, systemPrompt guard
- `src/container-runner.ts:85–93` — allowedVars
- `groups/global/CLAUDE.md` — Tier 1, rewritten Phase 0, appended each phase
- `docs/UPSTREAM-PRS.md` — every anchor logged here
- `.env.example` — one env var per external service

## Reuse Notes

- `src/policy/policy.ts` `checkCapability` — no changes needed for Phase 2.5, only `policy.json` entries + wrappers
- `src/channels/slack.ts` — Slack auth/socket reuse for Slack Intel, do not duplicate
- `src/identity/people.json` + `NANOCLAW_CALLER_ID` — already injected into containers, do not re-invent caller context
- `add-gmail` OneCLI-detection pattern — template for every installer credential step

## Next Steps

1. `superpowers:writing-plans` → Phase 0 detailed implementation plan (TDD tasks, verification gates)
2. Execute Phase 0 via `superpowers:executing-plans`
3. Phase 1 plan after Phase 0 ships; Phase 2 skills planned in parallel after Phase 1 validates
