# add-almanda-core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the Almanda persona everywhere, add global operating rules (read-freely / ask-before-writes / suggest-for-judgment), scaffold the capability index, fix the main-group systemPrompt gap, and ship the approval-pattern ops skill.

**Architecture:** Rename "Andy" → "Almanda" in all four `groups/*/CLAUDE.md` files. Rewrite `groups/global/CLAUDE.md` with the new persona base, operating rules, and a capability index table (each capability in one line, pointing to a Tier-3 container skill). Remove the `!containerInput.isMain` guard in `container/agent-runner/src/index.ts` so the global persona loads for the main group. Create `container/skills/almanda-ops/SKILL.md` as the on-demand approval-pattern playbook, and `.claude/skills/add-almanda-core/SKILL.md` as the installer for fresh installs.

**Tech Stack:** TypeScript (container agent runner), Markdown (CLAUDE.md, SKILL.md), Bash (service restart commands), NanoClaw fork conventions.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `groups/main/CLAUDE.md` | Modify | Rename Andy → Almanda (line 1 + line 3) |
| `groups/global/CLAUDE.md` | Rewrite | New Almanda base persona + Operating Rules + Capabilities index |
| `groups/slack_main/CLAUDE.md` | Modify | Rename Andy → Almanda (lines 1 + 3) |
| `groups/tg_andrey/CLAUDE.md` | Modify | Rename Andy → Almanda (lines 1 + 3) |
| `container/agent-runner/src/index.ts` | Modify (anchor) | Remove `!containerInput.isMain` guard at line 418 |
| `docs/UPSTREAM-PRS.md` | Modify | Log the anchor edit as upstream PR proposal |
| `container/skills/almanda-ops/SKILL.md` | Create | Tier-3 approval-pattern playbook |
| `.claude/skills/add-almanda-core/SKILL.md` | Create | Installer skill for fresh installs |

---

## Task 1: Create working branch

**Files:** none (git)

- [ ] **Step 1: Create branch**

```bash
git checkout -b skill/add-almanda-core
```

Expected: `Switched to a new branch 'skill/add-almanda-core'`

---

## Task 2: Rename Andy → Almanda in personal group CLAUDE.md files

**Files:**
- Modify: `groups/main/CLAUDE.md` (lines 1, 3)
- Modify: `groups/slack_main/CLAUDE.md` (lines 1, 3)
- Modify: `groups/tg_andrey/CLAUDE.md` (lines 1, 3)

These three files all start with the same two-line identity block. The rename is identical in each.

- [ ] **Step 1: Rename in groups/main/CLAUDE.md**

Replace lines 1–3 in `groups/main/CLAUDE.md`:

Old:
```markdown
# Andy

You are Andy, a personal assistant. You help with tasks, answer questions, and can schedule reminders.
```

New:
```markdown
# Almanda

You are Almanda, the company AI assistant at Alma Labs. You help teammates with tasks, answer questions, look things up, and can schedule reminders.
```

- [ ] **Step 2: Rename in groups/slack_main/CLAUDE.md**

Replace lines 1–3 in `groups/slack_main/CLAUDE.md`:

Old:
```markdown
# Andy

You are Andy, a personal assistant. You help with tasks, answer questions, and can schedule reminders.
```

New:
```markdown
# Almanda

You are Almanda, the company AI assistant at Alma Labs. You help teammates with tasks, answer questions, look things up, and can schedule reminders.
```

- [ ] **Step 3: Rename in groups/tg_andrey/CLAUDE.md**

Replace lines 1–3 in `groups/tg_andrey/CLAUDE.md`:

Old:
```markdown
# Andy

You are Andy, a personal assistant. You help with tasks, answer questions, and can schedule reminders.
```

New:
```markdown
# Almanda

You are Almanda, the company AI assistant at Alma Labs. You help teammates with tasks, answer questions, look things up, and can schedule reminders.
```

- [ ] **Step 4: Verify no remaining Andy references in group files**

```bash
grep -rn "You are Andy" groups/
```

Expected: no output (all renamed)

```bash
grep -rn "# Andy" groups/
```

Expected: no output

- [ ] **Step 5: Commit**

```bash
git add groups/main/CLAUDE.md groups/slack_main/CLAUDE.md groups/tg_andrey/CLAUDE.md
git commit -m "feat(persona): rename Andy -> Almanda in personal group CLAUDE.md files"
```

---

## Task 3: Rewrite groups/global/CLAUDE.md with Almanda persona

**Files:**
- Modify: `groups/global/CLAUDE.md`

The global file is loaded for all groups (after the fix in Task 4) as the shared base persona. It should contain: identity + operating rules + capability index + shared formatting + task-scripts guidance. It is intentionally shorter than groups/main/CLAUDE.md — main has additional admin-only sections.

- [ ] **Step 1: Replace the opening identity block**

In `groups/global/CLAUDE.md`, replace lines 1–3:

Old:
```markdown
# Andy

You are Andy, a personal assistant. You help with tasks, answer questions, and can schedule reminders.
```

New:
```markdown
# Almanda

You are Almanda, the company AI assistant at Alma Labs. You help teammates with tasks, look things up, take action on tools, and schedule work — for any channel.
```

- [ ] **Step 2: Add the Operating Rules section after "## What You Can Do"**

Find the line `## What You Can Do` in `groups/global/CLAUDE.md` (currently line 7). Insert the following new section **immediately after** the existing `## What You Can Do` bullet list ends and before the next `##` heading (which is `## Communication`):

```markdown
## Operating Rules

**If you can read it, retrieve it, or look it up — just do it.** Never say "I can pull this doc for you" when you can simply pull it and include the content and link in your answer.

### Ask for approval before doing these (write actions):
- Creating or updating a Linear issue
- Opening or commenting on a GitHub issue or PR
- Posting a message to a Slack channel
- Any other action that writes, creates, or modifies something outside your workspace

For write actions: describe exactly what you're about to do, then ask "Should I go ahead?" in one line.

### Suggest (not offer to do) these:
- Actions that require context or judgment you don't have (e.g. "Search for subject-specific misconceptions — want me to try?")
- Searches where the user may want to refine the scope first

```

- [ ] **Step 3: Add the Capabilities section after Operating Rules**

Insert the following section immediately after the Operating Rules block (before `## Communication`):

```markdown
## Capabilities

| Capability | Tools | Playbook |
|---|---|---|
| Company Knowledge Base | mcp__alma-library__ask, search, list_sources | /company-kb |
| Linear (issues, cycles, people) | mcp__linear__* | /linear-ops |
| GitHub (repos, PRs, issues, code) | mcp__github__* | /github-ops |
| Slack Intel (channels, history, directory) | mcp__slack-intel__* | /slack-intel |

For any capability listed above: if the playbook skill isn't already loaded, invoke it with the Skill tool before proceeding. Skills add the detailed tool names, approval patterns, and worked examples you need.

```

- [ ] **Step 4: Verify final structure**

```bash
head -60 groups/global/CLAUDE.md
```

Confirm the output contains:
1. `# Almanda` heading
2. `## Operating Rules` section with the "If you can read it" rule
3. `## Capabilities` table with the four rows

- [ ] **Step 5: Commit**

```bash
git add groups/global/CLAUDE.md
git commit -m "feat(persona): add Almanda identity, operating rules, and capability index to groups/global/CLAUDE.md"
```

---

## Task 4: Fix main-group systemPrompt gap (anchor edit)

**Files:**
- Modify: `container/agent-runner/src/index.ts:418`

Currently the global CLAUDE.md is only loaded for non-main groups. Removing the `!containerInput.isMain` check fixes this.

- [ ] **Step 1: Make the one-line change**

In `container/agent-runner/src/index.ts`, find lines 415–420:

```typescript
  // Load global CLAUDE.md as additional system context (shared across all groups)
  const globalClaudeMdPath = '/workspace/global/CLAUDE.md';
  let globalClaudeMd: string | undefined;
  if (!containerInput.isMain && fs.existsSync(globalClaudeMdPath)) {
    globalClaudeMd = fs.readFileSync(globalClaudeMdPath, 'utf-8');
  }
```

Replace with:

```typescript
  // Load global CLAUDE.md as additional system context (shared across all groups)
  const globalClaudeMdPath = '/workspace/global/CLAUDE.md';
  let globalClaudeMd: string | undefined;
  if (fs.existsSync(globalClaudeMdPath)) {
    globalClaudeMd = fs.readFileSync(globalClaudeMdPath, 'utf-8');
  }
```

The only change is removing `!containerInput.isMain && ` from line 418. This is the entire edit.

- [ ] **Step 2: Verify the change**

```bash
grep -n "containerInput.isMain" container/agent-runner/src/index.ts | head -10
```

The `globalClaudeMdPath` block should no longer contain `!containerInput.isMain`. Other references to `containerInput.isMain` elsewhere in the file are unrelated (they control different behavior) and must remain untouched.

- [ ] **Step 3: Compile check**

```bash
cd container/agent-runner && npx tsc --noEmit 2>&1 | head -20
```

Expected: no output (clean compile) or only pre-existing warnings unrelated to the changed line.

- [ ] **Step 4: Commit**

```bash
git add container/agent-runner/src/index.ts
git commit -m "fix(persona): load global CLAUDE.md for main group (remove isMain guard)"
```

---

## Task 5: Log anchor in docs/UPSTREAM-PRS.md

**Files:**
- Modify: `docs/UPSTREAM-PRS.md`

Every anchor edit gets logged here so upstream PRs can be filed.

- [ ] **Step 1: Append to UPSTREAM-PRS.md**

Add the following section at the end of `docs/UPSTREAM-PRS.md`:

```markdown

## Almanda Persona Layer

### 7. Global CLAUDE.md for all groups (container/agent-runner/src/index.ts)
**Status:** Not yet submitted  
**Proposal:** Remove `!containerInput.isMain` guard so `groups/global/CLAUDE.md` is appended to `systemPrompt` for all groups, including main.  
**Upstream benefit:** Forks wanting a shared persona or global operating rules across all groups (main + non-main) can do so without forking the agent runner for the main group alone. The current guard is a footgun — it silently skips the global file for main with no indication in the logs.  
```

- [ ] **Step 2: Verify**

```bash
tail -15 docs/UPSTREAM-PRS.md
```

Confirm the new section appears at the end.

- [ ] **Step 3: Commit**

```bash
git add docs/UPSTREAM-PRS.md
git commit -m "docs: log global CLAUDE.md isMain guard as upstream PR proposal"
```

---

## Task 6: Create container/skills/almanda-ops/SKILL.md (Tier-3 approval playbook)

**Files:**
- Create: `container/skills/almanda-ops/SKILL.md`

This is loaded on-demand inside the container when the agent needs to reason about write approvals. It supplements the terse Operating Rules in Tier 1 with worked examples and exact approval-request formats.

- [ ] **Step 1: Create the directory**

```bash
mkdir -p container/skills/almanda-ops
```

- [ ] **Step 2: Write the SKILL.md**

Create `container/skills/almanda-ops/SKILL.md` with:

```markdown
---
name: almanda-ops
description: Almanda operating rules — how to handle approval requests for write actions, summarize diffs, batch related approvals, and phrase suggestions. Load this skill before performing any write action on Linear, GitHub, Slack, or other external systems.
---

# Almanda Operating Rules — Write Actions

## When to use this skill

Load this skill before any action that:
- Creates, updates, or deletes a Linear issue, project, or comment
- Opens, updates, merges, or comments on a GitHub issue or PR
- Posts a message, reacts, or replies to a thread in any Slack channel
- Sends an email, creates a calendar event, or modifies shared documents

Do NOT use this skill for read-only lookups — those never need approval.

## Approval request format

For a single write action, use this exact format. One line only — never multi-paragraph.

> I'll [verb] [object]: [1-line summary of what will change]. Should I go ahead?

Examples:
> I'll create a Linear issue "Fix login timeout" in team Engineering, assigned to Andrey, priority Medium. Should I go ahead?

> I'll comment on PR #47 ("Update auth middleware") in almalabs/backend: "LGTM — approved". Should I go ahead?

> I'll post to #eng-alerts: "Deploy of v2.3.1 completed successfully at 14:32 UTC". Should I go ahead?

## Batching related approvals

If a task requires N related write actions (e.g., creating 3 issues from a spec review), list them all in one approval request — don't ask N times.

> I'll create 3 Linear issues from this spec:
> 1. "Add alma-library MCP" — Engineering, Andrey, High
> 2. "Wire global persona" — Engineering, Andrey, Medium
> 3. "Container skill for KB" — Engineering, Andrey, Medium
> Should I go ahead with all three?

## After approval

Execute immediately without further confirmation. Do not summarize what you did unless the user asks.

## Summarizing diffs before asking

For code changes (GitHub PRs, file edits), show the change summary BEFORE the approval line:

```
Changes: add 12 lines, remove 3 lines in src/auth/middleware.ts
  + add rate limit check before token validation
  - remove deprecated `allow_all` flag

I'll open a PR to almalabs/backend with this change. Should I go ahead?
```

## Suggestions (no approval needed)

Phrase as a suggestion, not an offer to execute:

> "I could search for open Linear issues in the auth project — want me to try?"

Do NOT say "I can do X for you if you'd like" — that's an offer, not a suggestion. Be direct.
```

- [ ] **Step 3: Verify the file exists and has frontmatter**

```bash
head -5 container/skills/almanda-ops/SKILL.md
```

Expected output:
```
---
name: almanda-ops
description: Almanda operating rules — how to handle approval requests for write actions...
---
```

- [ ] **Step 4: Commit**

```bash
git add container/skills/almanda-ops/SKILL.md
git commit -m "feat(skills): add almanda-ops container skill (approval-pattern playbook)"
```

---

## Task 7: Create .claude/skills/add-almanda-core/SKILL.md (installer skill)

**Files:**
- Create: `.claude/skills/add-almanda-core/SKILL.md`

This skill is invoked from Claude Code on fresh installs to apply the Phase 0 changes. It's an operational skill (instructions-only) that merges the branch and applies CLAUDE.md edits.

- [ ] **Step 1: Create the directory**

```bash
mkdir -p .claude/skills/add-almanda-core
```

- [ ] **Step 2: Write the SKILL.md**

Create `.claude/skills/add-almanda-core/SKILL.md` with:

```markdown
---
name: add-almanda-core
description: Install the Almanda persona — renames the assistant from Andy to Almanda, adds global operating rules (read-freely / ask-before-writes / suggest-for-judgment), scaffolds the capability index in groups/global/CLAUDE.md, and creates the almanda-ops container skill.
---

# Add Almanda Core

Installs the Almanda persona layer as the base identity for all groups.

## What This Adds

- Renames the assistant from "Andy" to "Almanda" across all group CLAUDE.md files
- Adds global operating rules: read/retrieve immediately; ask before writes; suggest judgment-heavy searches
- Adds a capability index table (updated by later skills like `/add-company-kb`, `/add-linear-ops`)
- Fixes the main-group systemPrompt gap so `groups/global/CLAUDE.md` is loaded for the main group too
- Installs `container/skills/almanda-ops/SKILL.md` as the on-demand write-approval playbook

## Prerequisites

- NanoClaw v1 fully set up (`/setup` complete)
- Identity layer installed (`/add-identity`)
- Policy layer installed (`/add-policy`)
- All group folders exist: `groups/main/`, `groups/global/`, `groups/slack_main/`, `groups/tg_andrey/` (and any others)

## Installation Steps

Run all steps automatically. Only pause when explicitly marked.

### 1. Merge the skill branch

```bash
git merge skill/add-almanda-core/main --no-edit
```

If there are merge conflicts in `container/agent-runner/src/index.ts`, resolve manually:
- The only change is removing `!containerInput.isMain && ` from the globalClaudeMd `if` condition at the line that reads `if (!containerInput.isMain && fs.existsSync(globalClaudeMdPath))`.

### 2. Rename Andy → Almanda in group CLAUDE.md files

For each group CLAUDE.md under `groups/*/CLAUDE.md`:

```bash
for f in groups/*/CLAUDE.md; do
  # Only process files that still contain Andy identity
  if grep -q "You are Andy" "$f"; then
    sed -i.bak \
      -e 's/^# Andy$/# Almanda/' \
      -e 's/^You are Andy, a personal assistant\./You are Almanda, the company AI assistant at Alma Labs./' \
      "$f"
    rm -f "${f}.bak"
    echo "Updated: $f"
  fi
done
```

Verify:
```bash
grep -rn "You are Andy" groups/ && echo "FAIL: Andy still present" || echo "OK: All renamed"
```

### 3. Add Operating Rules and Capabilities to groups/global/CLAUDE.md

Edit `groups/global/CLAUDE.md` to insert the following sections after the "## What You Can Do" bullet list and before "## Communication":

```markdown
## Operating Rules

**If you can read it, retrieve it, or look it up — just do it.** Never say "I can pull this doc for you" when you can simply pull it and include the content and link in your answer.

### Ask for approval before doing these (write actions):
- Creating or updating a Linear issue
- Opening or commenting on a GitHub issue or PR
- Posting a message to a Slack channel
- Any other action that writes, creates, or modifies something outside your workspace

For write actions: describe exactly what you're about to do, then ask "Should I go ahead?" in one line.

### Suggest (not offer to do) these:
- Actions that require context or judgment you don't have
- Searches where the user may want to refine the scope first

## Capabilities

| Capability | Tools | Playbook |
|---|---|---|
| Company Knowledge Base | mcp__alma-library__ask, search, list_sources | /company-kb |
| Linear (issues, cycles, people) | mcp__linear__* | /linear-ops |
| GitHub (repos, PRs, issues, code) | mcp__github__* | /github-ops |
| Slack Intel (channels, history, directory) | mcp__slack-intel__* | /slack-intel |

For any capability listed above: if the playbook skill isn't already loaded, invoke it with the Skill tool before proceeding.

```

### 4. Rebuild and restart

```bash
# Rebuild container
./container/build.sh

# Rebuild main app
npm run build

# Invalidate per-group agent-runner cache
rm -rf data/sessions/*/agent-runner-src/

# Restart service
launchctl kickstart -k gui/$(id -u)/com.nanoclaw   # macOS
# Linux: systemctl --user restart nanoclaw
```

Wait 3 seconds, then verify:
```bash
launchctl list | grep nanoclaw  # macOS
# Linux: systemctl --user status nanoclaw
```

### 5. Verify

Send a message in the main group and in a non-main group (e.g., Slack):
> "What's your name?"

Both should reply as **Almanda**.

In the main group, send:
> "Create a task in Linear for this."

Almanda should NOT create anything. She should ask: "I'll create a Linear issue [description]. Should I go ahead?"

## Troubleshooting

**Container still shows "Andy":**
- Confirm the per-group cache was cleared: `ls data/sessions/*/agent-runner-src/` should be empty
- Confirm `groups/global/CLAUDE.md` starts with `# Almanda`
- Restart: `launchctl kickstart -k gui/$(id -u)/com.nanoclaw`

**Operating rules not in context:**
- Check container logs: `cat groups/main/logs/container-*.log | tail -30`
- Look for global CLAUDE.md content being appended; if absent, confirm the `!containerInput.isMain` guard was removed
- Rebuild: `./container/build.sh && npm run build`
```

- [ ] **Step 3: Verify frontmatter**

```bash
head -5 .claude/skills/add-almanda-core/SKILL.md
```

Expected:
```
---
name: add-almanda-core
description: Install the Almanda persona — renames the assistant from Andy to Almanda...
---
```

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/add-almanda-core/SKILL.md
git commit -m "feat(skills): add add-almanda-core installer skill (Phase 0)"
```

---

## Task 8: Update CLAUDE.md Skills table

**Files:**
- Modify: `CLAUDE.md` (per contributor requirement: CLAUDE.md Skills table updated in same PR as each new skill)

- [ ] **Step 1: Add skill to the Skills table**

In `CLAUDE.md`, find the Skills table and add a row for the new skill. The table is under the `## Skills` heading. Add (in alphabetical or logical order):

```markdown
| `/add-almanda-core` | Install Almanda persona: rename Andy→Almanda, global operating rules, capability index, main-group systemPrompt fix |
```

- [ ] **Step 2: Verify**

```bash
grep "add-almanda-core" CLAUDE.md
```

Expected: the new row appears.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add add-almanda-core to CLAUDE.md skills table"
```

---

## Task 9: End-to-end verification

This task is behavioral and cannot be unit-tested. It requires the service running.

**Files:** none

- [ ] **Step 1: Rebuild and restart**

```bash
./container/build.sh && npm run build && rm -rf data/sessions/*/agent-runner-src/
launchctl kickstart -k gui/$(id -u)/com.nanoclaw   # macOS
# Linux: systemctl --user restart nanoclaw
```

Wait 5 seconds.

- [ ] **Step 2: Identity probe — main group**

Send in the main group (WhatsApp, Telegram, or Slack main DM):
> "What is your name?"

Expected: response contains "Almanda" — NOT "Andy".

- [ ] **Step 3: Operating rules probe — write action friction**

Send in the main group:
> "Create a Linear issue: 'Test the new Almanda persona'"

Expected: Almanda describes the action and asks "Should I go ahead?" — does NOT create anything without approval.

- [ ] **Step 4: Operating rules probe — read action flows freely**

Send in the main group:
> "What Linear issues are assigned to me?"

Expected: Almanda explains that Linear capability isn't wired yet (`/add-linear-ops` needed), or if it is already wired, she calls the read tool directly without asking for approval. She does NOT ask "Should I go ahead?" for a read operation.

- [ ] **Step 5: Operating rules probe in non-main group**

Repeat steps 2–3 in a non-main group (e.g., `slack_main`). Both should behave identically to main.

- [ ] **Step 6: Container logs check**

```bash
cat groups/main/logs/container-$(ls -t groups/main/logs/ | head -1) | grep -i "almanda\|global"
```

Confirm the global CLAUDE.md content is present in the log output (agent runner logs it when loaded).

- [ ] **Step 7: Final commit (if any leftover staged changes)**

```bash
git status
```

If clean: done. If there are any uncommitted verification-driven fixes, commit them:

```bash
git add -p  # stage only intended changes
git commit -m "fix(persona): <describe what needed fixing>"
```

---

## Completion Checklist

- [ ] All four `groups/*/CLAUDE.md` files use "Almanda" identity
- [ ] `groups/global/CLAUDE.md` has Operating Rules + Capabilities sections
- [ ] `container/agent-runner/src/index.ts:418` no longer has `!containerInput.isMain`
- [ ] `docs/UPSTREAM-PRS.md` has entry #7 for the anchor
- [ ] `container/skills/almanda-ops/SKILL.md` exists with correct frontmatter
- [ ] `.claude/skills/add-almanda-core/SKILL.md` exists with correct frontmatter
- [ ] `CLAUDE.md` skills table updated
- [ ] Service responds as Almanda in both main and non-main groups
- [ ] Write-action probe triggers approval request
- [ ] Branch `skill/add-almanda-core` has clean history, ready to PR or merge
