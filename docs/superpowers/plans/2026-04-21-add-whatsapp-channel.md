# WhatsApp Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WhatsApp as a first-class Almanda channel — text DM + groups, voice transcription, image vision, PDF reading, and cross-channel outbound send — via four upstream skill-branch merges plus one greenfield IPC tool.

**Architecture:** Four branches from `qwibitai/nanoclaw-whatsapp` are merged in sequence into the ALM-568 worktree branch (`whatsapp/main` → `skill/voice-transcription` → `skill/pdf-reader` → `skill/image-vision`). On top of the merges a new `send_whatsapp_message` MCP tool is added to the container agent-runner and wired back through `src/ipc.ts` to the WhatsApp channel instance, allowing agents to send outbound messages from any channel.

**Tech Stack:** `@whiskeysockets/baileys` (WhatsApp WebSocket), `qrcode-terminal`, `sharp` (image resize), `poppler-utils` / `pdftotext` (container-side PDF extraction), OpenAI Whisper (`src/transcription.ts`, already on main), `@modelcontextprotocol/sdk`, `zod`.

---

### Task 1: Create worktree, add upstream remote, verify baseline

**Files:**
- Creates: `.worktrees/ALM-568-add-whatsapp-channel/` (git worktree)

- [ ] **Step 1: Create the worktree**

```bash
git worktree add .worktrees/ALM-568-add-whatsapp-channel -b ALM-568-add-whatsapp-channel
```

Expected: `Preparing worktree (new branch 'ALM-568-add-whatsapp-channel')` followed by the path.

- [ ] **Step 2: Enter the worktree for all subsequent steps**

All remaining tasks run from this directory:

```bash
cd .worktrees/ALM-568-add-whatsapp-channel
```

- [ ] **Step 3: Add the qwibitai WhatsApp remote**

```bash
git remote add whatsapp https://github.com/qwibitai/nanoclaw-whatsapp.git
git remote -v | grep whatsapp
```

Expected:
```
whatsapp  https://github.com/qwibitai/nanoclaw-whatsapp.git (fetch)
whatsapp  https://github.com/qwibitai/nanoclaw-whatsapp.git (push)
```

- [ ] **Step 4: Verify baseline is green**

```bash
npm run format:check && npm run typecheck && npm run lint && npm test
```

Expected: all pass, exit code 0. If any fail, stop and surface to maintainer — do not proceed with a red baseline.

---

### Task 2: Merge `whatsapp/main` — base WhatsApp channel

**Files:**
- Creates: `src/channels/whatsapp.ts`, `src/channels/whatsapp.test.ts`, `src/whatsapp-auth.ts`, `setup/whatsapp-auth.ts`
- Modifies: `src/channels/index.ts` (adds `import './whatsapp.js'`), `setup/index.ts` (adds `'whatsapp-auth'` step), `package.json`, `.env.example`

- [ ] **Step 1: Fetch and merge**

```bash
git fetch whatsapp main
git merge whatsapp/main
```

If the merge halts on `package-lock.json` conflicts:

```bash
git checkout --theirs package-lock.json
git add package-lock.json
git merge --continue
```

For any other conflict: read both sides, understand intent, and resolve manually before continuing.

- [ ] **Step 2: Install and build**

```bash
npm install
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 3: Run the new WhatsApp tests**

```bash
npx vitest run src/channels/whatsapp.test.ts
```

Expected: all 41 tests pass.

- [ ] **Step 4: Confirm the channel barrel received its import**

```bash
grep "whatsapp" src/channels/index.ts
```

Expected: `import './whatsapp.js';` is present (not just the comment).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(whatsapp): merge base WhatsApp channel from qwibitai/nanoclaw-whatsapp"
```

---

### Task 3: Merge `whatsapp/skill/voice-transcription` and fix `downloadFile` shape

**Files:**
- Modifies: `src/channels/whatsapp.ts` (voice handler), `src/channels/whatsapp.test.ts` (voice tests)
- Keeps: `src/transcription.ts` at `--ours` (ALM-551 canonical)

- [ ] **Step 1: Fetch and merge**

```bash
git fetch whatsapp skill/voice-transcription
git merge whatsapp/skill/voice-transcription
```

If the merge halts:

```bash
# package-lock.json: always take theirs
git checkout --theirs package-lock.json
git add package-lock.json

# src/transcription.ts: ALWAYS keep ours (ALM-551 canonical)
git checkout --ours src/transcription.ts
git add src/transcription.ts

git merge --continue
```

For other conflicts: read both sides, resolve manually.

- [ ] **Step 2: Check `downloadFile` return shape in the voice handler**

Open `src/channels/whatsapp.ts` and find the voice-message handler. Verify it destructures the result:

```bash
grep -n "downloadFile" src/channels/whatsapp.ts
```

Expected pattern (ALM-551+):
```ts
const { containerPath, hostPath } = await downloadFile(...);
```

If you see the old pattern instead:
```ts
const filePath = await downloadFile(...);   // ❌ wrong — returns an object, not a string
```

Fix it:
```ts
const { containerPath, hostPath } = await downloadFile(...);
```

Then update all uses of `filePath` in that handler to `containerPath` (for the agent) and `hostPath` (for local file ops). The `transcribeAudioFile` call takes `hostPath`.

- [ ] **Step 3: Build and run tests**

```bash
npm install
npm run build
npx vitest run src/channels/whatsapp.test.ts
```

Expected: all tests pass (includes new voice tests). Zero TypeScript errors.

- [ ] **Step 4: Verify Telegram and Slack voice regressions stay green**

```bash
npx vitest run src/channels/telegram.test.ts src/channels/slack.test.ts
```

Expected: all pass. If any fail, the `--ours` resolution of `src/transcription.ts` was wrong — recheck.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(whatsapp): add voice transcription via Whisper (skill/voice-transcription)"
```

---

### Task 4: Merge `whatsapp/skill/pdf-reader`

**Files:**
- Creates: `container/skills/pdf-reader/SKILL.md`, `container/skills/pdf-reader/pdf-reader` (CLI)
- Modifies: `container/Dockerfile` (adds `poppler-utils`), `src/channels/whatsapp.ts` (PDF handler), `src/channels/whatsapp.test.ts` (PDF tests)

- [ ] **Step 1: Fetch and merge**

```bash
git fetch whatsapp skill/pdf-reader
git merge whatsapp/skill/pdf-reader
```

If the merge halts on `package-lock.json`:

```bash
git checkout --theirs package-lock.json
git add package-lock.json
git merge --continue
```

If it halts on `src/channels/whatsapp.ts` (because Task 3 already modified it):

```bash
# Open the conflicted file, read BOTH sides carefully.
# The pdf-reader adds a PDF attachment download block — keep it alongside the voice handler.
# After resolving:
git add src/channels/whatsapp.ts
git merge --continue
```

- [ ] **Step 2: Build and test**

```bash
npm run build
npx vitest run src/channels/whatsapp.test.ts
```

Expected: all tests pass (voice + pdf tests together).

- [ ] **Step 3: Verify poppler-utils is in Dockerfile**

```bash
grep "poppler-utils" container/Dockerfile
```

Expected: a line like `RUN apt-get install -y poppler-utils` or similar.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(whatsapp): add PDF reading via poppler-utils (skill/pdf-reader)"
```

---

### Task 5: Merge `whatsapp/skill/image-vision`

**Files:**
- Creates: `src/image.ts`, `src/image.test.ts`
- Modifies: `src/channels/whatsapp.ts` (image handler), `src/index.ts` (image plumbing), `src/container-runner.ts` (image mount), `container/agent-runner/src/index.ts` (image content block), `package.json` (`sharp` dep)

- [ ] **Step 1: Fetch and merge**

```bash
git fetch whatsapp skill/image-vision
git merge whatsapp/skill/image-vision
```

If the merge halts on conflicts — this is the widest-blast-radius merge. Resolve carefully:

```bash
# package-lock.json: theirs
git checkout --theirs package-lock.json
git add package-lock.json

# src/channels/whatsapp.ts: read both sides, keep all handlers (voice + pdf + image)
# src/index.ts: read both sides, keep the image plumbing additions
# src/container-runner.ts: read both sides
# container/agent-runner/src/index.ts: read both sides
# After resolving all:
git merge --continue
```

- [ ] **Step 2: Install (sharp requires native bindings) and build**

```bash
npm install
npm run build
```

Expected: clean. `sharp` binds to pre-built native binaries — if `npm install` fails on it, run `npm install --ignore-scripts` then `npm rebuild sharp`.

- [ ] **Step 3: Run all WhatsApp-related tests**

```bash
npx vitest run src/channels/whatsapp.test.ts src/image.test.ts
```

Expected: all pass (8 image tests + all whatsapp tests).

- [ ] **Step 4: Full regression**

```bash
npx vitest run src/channels/telegram.test.ts src/channels/slack.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(whatsapp): add image vision via sharp + multimodal content blocks (skill/image-vision)"
```

---

### Task 6: Write failing test for `send_whatsapp_message` IPC handler

**Files:**
- Modify: `src/ipc-auth.test.ts`

- [ ] **Step 1: Add the failing tests to `src/ipc-auth.test.ts`**

Find the `beforeEach` block in `src/ipc-auth.test.ts` (around line 40). The `deps` object does not yet have `sendWhatsAppMessage`. Add these two tests at the end of the file, before the final closing:

```ts
describe('send_whatsapp_message', () => {
  it('calls sendWhatsAppMessage with the phone number and text', async () => {
    const calls: Array<{ phone: string; text: string }> = [];
    deps.sendWhatsAppMessage = async (phone, text) => {
      calls.push({ phone, text });
    };

    await processTaskIpc(
      { type: 'send_whatsapp_message', phone: '+447700900123', text: 'Hello from Almanda' },
      'whatsapp_main',
      true,
      deps,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ phone: '+447700900123', text: 'Hello from Almanda' });
  });

  it('does not throw when sendWhatsAppMessage is not configured', async () => {
    // deps has no sendWhatsAppMessage property
    await expect(
      processTaskIpc(
        { type: 'send_whatsapp_message', phone: '+14155551234', text: 'Test' },
        'whatsapp_main',
        true,
        deps,
      ),
    ).resolves.toBeUndefined();
  });

  it('does nothing when phone or text is missing', async () => {
    const calls: string[] = [];
    deps.sendWhatsAppMessage = async (phone) => { calls.push(phone); };

    await processTaskIpc(
      { type: 'send_whatsapp_message' }, // missing phone and text
      'whatsapp_main',
      true,
      deps,
    );

    expect(calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run and confirm the tests FAIL**

```bash
npx vitest run src/ipc-auth.test.ts
```

Expected: the three new `send_whatsapp_message` tests fail with errors like `deps.sendWhatsAppMessage is not a function` or TypeScript type errors (because `sendWhatsAppMessage` doesn't exist on `IpcDeps` yet). That is correct — the test is ahead of the implementation.

---

### Task 7: Implement `send_whatsapp_message` in `src/ipc.ts`

**Files:**
- Modify: `src/ipc.ts`

- [ ] **Step 1: Add `sendWhatsAppMessage` to the `IpcDeps` interface**

In `src/ipc.ts`, find the `IpcDeps` interface (line 16). Add the new optional dep:

```ts
export interface IpcDeps {
  sendMessage: (jid: string, text: string) => Promise<void>;
  sendWhatsAppMessage?: (phone: string, text: string) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  registerGroup: (jid: string, group: RegisteredGroup) => void;
  syncGroups: (force: boolean) => Promise<void>;
  getAvailableGroups: () => AvailableGroup[];
  writeGroupsSnapshot: (
    groupFolder: string,
    isMain: boolean,
    availableGroups: AvailableGroup[],
    registeredJids: Set<string>,
  ) => void;
  onTasksChanged: () => void;
}
```

- [ ] **Step 2: Add `phone` and `text` to the data parameter type in `processTaskIpc`**

Find the `data` parameter type in `processTaskIpc` (starts around line 161). Add two new optional fields:

```ts
export async function processTaskIpc(
  data: {
    type: string;
    taskId?: string;
    prompt?: string;
    schedule_type?: string;
    schedule_value?: string;
    context_mode?: string;
    script?: string;
    groupFolder?: string;
    chatJid?: string;
    targetJid?: string;
    phone?: string;   // ← add this
    text?: string;    // ← add this
    // For register_group
    jid?: string;
    name?: string;
    folder?: string;
    trigger?: string;
    requiresTrigger?: boolean;
    containerConfig?: RegisteredGroup['containerConfig'];
    callerId?: string;
    callerRoles?: string[];
  },
  sourceGroup: string,
  isMain: boolean,
  deps: IpcDeps,
): Promise<void> {
```

- [ ] **Step 3: Add the `send_whatsapp_message` case to the switch statement**

Find the `switch (data.type)` in `processTaskIpc`. Add the new case immediately before `default:`:

```ts
    case 'send_whatsapp_message':
      if (data.phone && data.text) {
        if (deps.sendWhatsAppMessage) {
          await deps.sendWhatsAppMessage(data.phone, data.text);
          logger.info(
            { phone: data.phone, sourceGroup },
            'WhatsApp outbound message sent via IPC',
          );
        } else {
          logger.warn(
            { phone: data.phone, sourceGroup },
            'send_whatsapp_message: WhatsApp channel not available',
          );
        }
      }
      break;

    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
```

- [ ] **Step 4: Run the tests — they should now pass**

```bash
npx vitest run src/ipc-auth.test.ts
```

Expected: all tests in the file pass, including the three new `send_whatsapp_message` tests.

- [ ] **Step 5: Commit**

```bash
git add src/ipc.ts src/ipc-auth.test.ts
git commit -m "feat(ipc): add send_whatsapp_message task type and IpcDeps.sendWhatsAppMessage"
```

---

### Task 8: Wire `sendWhatsAppMessage` into `src/index.ts`

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add the `sendWhatsAppMessage` dep to the `startIpcWatcher` call**

Find the `startIpcWatcher({...})` call in `src/index.ts` (around line 741). Add `sendWhatsAppMessage` alongside the existing deps:

```ts
  startIpcWatcher({
    sendMessage: (jid, text) => {
      const channel = findChannel(channels, jid);
      if (!channel) throw new Error(`No channel for JID: ${jid}`);
      return channel.sendMessage(jid, text);
    },
    sendWhatsAppMessage: async (phone, text) => {
      const whatsappCh = channels.find((ch) => ch.name === 'whatsapp');
      if (!whatsappCh) {
        logger.warn({ phone }, 'send_whatsapp_message: WhatsApp channel not connected');
        return;
      }
      const jid = phone.replace(/\D/g, '') + '@s.whatsapp.net';
      await whatsappCh.sendMessage(jid, text);
    },
    registeredGroups: () => registeredGroups,
    // ... rest unchanged
```

- [ ] **Step 2: Build to confirm no TypeScript errors**

```bash
npm run build
```

Expected: clean build, zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(index): wire sendWhatsAppMessage dep into IPC watcher — routes to WhatsApp channel"
```

---

### Task 9: Add `send_whatsapp_message` MCP tool to the container agent-runner

**Files:**
- Modify: `container/agent-runner/src/ipc-mcp-stdio.ts`

- [ ] **Step 1: Add the tool before the stdio transport start line**

Find the line `const transport = new StdioServerTransport();` at the end of `container/agent-runner/src/ipc-mcp-stdio.ts`. Insert the new tool immediately before it:

```ts
server.tool(
  'send_whatsapp_message',
  `Send a WhatsApp message to any recipient by phone number. The agent is responsible for resolving a recipient's name to a phone number before calling this tool — use Slack lookup, Linear, or ask the user.

Phone must be in international format, digits only (no + prefix, no spaces, no dashes):
- UK: "447700900123"  (44 = country code, then 10 digits)
- US: "14155551234"   (1 = country code, then 10 digits)
- IL: "972501234567"  (972 = country code, then 9 digits)

The WhatsApp channel must be running on the host for this to work. Works from any channel (Telegram, Slack, WhatsApp itself).`,
  {
    phone: z
      .string()
      .describe(
        'Recipient phone number in international format, digits only (e.g. "447700900123"). No + prefix, no spaces, no dashes.',
      ),
    text: z.string().describe('Message text to send'),
  },
  async (args) => {
    const normalised = args.phone.replace(/\D/g, '');
    if (!normalised) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Invalid phone number: must contain digits.',
          },
        ],
        isError: true,
      };
    }

    const data = {
      type: 'send_whatsapp_message',
      phone: normalised,
      text: args.text,
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [
        {
          type: 'text' as const,
          text: `WhatsApp message send requested to +${normalised}.`,
        },
      ],
    };
  },
);

// Start the stdio transport
```

- [ ] **Step 2: Build (TypeScript is the guard for the container code)**

```bash
npm run build
```

Expected: clean.

- [ ] **Step 3: Confirm the tool appears in the compiled output**

```bash
grep "send_whatsapp_message" dist/container/agent-runner/src/ipc-mcp-stdio.js
```

Expected: the string `send_whatsapp_message` appears at least twice (tool name + type field).

- [ ] **Step 4: Commit**

```bash
git add container/agent-runner/src/ipc-mcp-stdio.ts
git commit -m "feat(container): add send_whatsapp_message MCP tool for cross-channel outbound WhatsApp"
```

---

### Task 10: Full suite verification and container build

**Files:** none modified — verification only.

- [ ] **Step 1: Run the full test suite**

```bash
npm run format:check && npm run typecheck && npm run lint && npm test
```

Expected: all exit 0. Pay special attention to:
- `src/channels/whatsapp.test.ts` (voice, pdf, base channel tests)
- `src/image.test.ts` (8 image tests)
- `src/ipc-auth.test.ts` (includes the 3 new `send_whatsapp_message` tests)
- `src/channels/telegram.test.ts` and `src/channels/slack.test.ts` (voice regression)
- `src/docs-freshness.test.ts` (6 doc-freshness tests — will catch drift)

If `docs-freshness.test.ts` fails, the skill table or channel barrel is out of sync. Fix the docs, do NOT skip this test.

- [ ] **Step 2: Build the agent container**

```bash
./container/build.sh
```

Expected: clean build. `poppler-utils` installs in the container layer (from the pdf-reader merge). The updated `ipc-mcp-stdio.ts` with `send_whatsapp_message` is compiled into the container.

- [ ] **Step 3: Verify the compiled container agent-runner contains the tool**

```bash
grep -c "send_whatsapp_message" dist/container/agent-runner/src/ipc-mcp-stdio.js
```

Expected: `3` or more (tool name, IPC type field, description mention).

- [ ] **Step 4: Update inflight manifest phase**

```bash
# In the worktree root:
node -e "
const fs = require('fs');
const p = 'docs/superpowers/specs/.inflight-2026-04-21-add-whatsapp-channel.json';
const m = JSON.parse(fs.readFileSync(p, 'utf-8'));
m.currentPhase = 4;
m.touchedAreas = [
  'src/channels/whatsapp.ts',
  'src/channels/whatsapp.test.ts',
  'src/channels/index.ts',
  'src/whatsapp-auth.ts',
  'setup/whatsapp-auth.ts',
  'src/transcription.ts',
  'src/image.ts',
  'src/image.test.ts',
  'src/ipc.ts',
  'src/ipc-auth.test.ts',
  'src/index.ts',
  'container/agent-runner/src/ipc-mcp-stdio.ts',
  'container/Dockerfile',
  'container/skills/pdf-reader/',
  'package.json',
  '.env.example'
];
fs.writeFileSync(p, JSON.stringify(m, null, 2));
console.log('Phase updated to 4');
"
```

- [ ] **Step 5: Commit everything and push**

```bash
git add -A
git commit -m "chore: mark implementation complete (phase 4), all tests green"
git push origin ALM-568-add-whatsapp-channel
```

Expected: branch pushed to `almalabs-ai/nanoclaw`.

---

## Post-implementation checklist

Before calling implementation complete, verify:
- [ ] `npm run format:check && npm run typecheck && npm run lint && npm test` — all pass
- [ ] `./container/build.sh` — clean
- [ ] `src/docs-freshness.test.ts` — 6 tests pass (no doc drift)
- [ ] `send_whatsapp_message` appears in container MCP tool list
- [ ] `.inflight-2026-04-21-add-whatsapp-channel.json` has `currentPhase: 4`

The next phase is **Phase [5] Self-verify** (`superpowers:verification-before-completion` + `nanoclaw-channel-smoke-matrix`), followed by code review, PR, docs sync, release, deploy, and post-deploy verify.
