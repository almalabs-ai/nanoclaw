# Design: ALM-568 — Add WhatsApp Channel

**Date:** 2026-04-21  
**Linear:** [ALM-568](https://linear.app/alma-labs-ai/issue/ALM-568/add-whatsapp-channel)  
**Change type:** container-or-channel  
**Branch:** `ALM-568-add-whatsapp-channel`

---

## Context

Almanda needs WhatsApp as a first-class channel alongside Telegram, Slack, Discord, and Gmail. The channel must support text DM + groups, voice transcription, image vision, PDF reading, and outbound send-to-any-recipient. Almanda operates from her own dedicated number (eSIM), not the user's personal account.

The implementation merges four upstream skill branches from `qwibitai/nanoclaw-whatsapp` in sequence, then adds one greenfield IPC tool for cross-channel outbound send.

---

## Architecture

WhatsApp follows the same channel pattern as Telegram and Slack: `src/channels/whatsapp.ts` self-registers at startup, connects to a Baileys WebSocket, and feeds normalised messages into the shared orchestrator loop (`src/index.ts`). All outbound replies flow through `src/router.ts`.

**Merge sequence into the ALM-568 worktree branch:**
1. `whatsapp/main` — base channel: text DM + groups, pairing-code auth, dedicated-number mode (`ASSISTANT_HAS_OWN_NUMBER=true`)
2. `whatsapp/skill/voice-transcription` — WhatsApp voice handler wired to existing `src/transcription.ts` (ALM-551 canonical; resolve conflict with `--ours`)
3. `whatsapp/skill/pdf-reader` — container PDF extraction via `poppler-utils`
4. `whatsapp/skill/image-vision` — `src/image.ts` + image content blocks passed to the agent

**Greenfield addition on top:** `send_whatsapp_message` IPC tool for cross-channel outbound send (see Components below).

---

## Components

| Module | Source | Role |
|---|---|---|
| `src/channels/whatsapp.ts` | merge + greenfield | Channel core: Baileys connection, all message handlers, `sendWhatsApp(phone, text)` export |
| `src/whatsapp-auth.ts` | merge | Pairing-code / QR auth; writes `store/pairing-code.txt`; persists session to `store/auth/creds.json` |
| `setup/whatsapp-auth.ts` | merge | Registration step in the setup wizard |
| `src/transcription.ts` | already on `main` (ALM-551) | Whisper API call — WhatsApp voice handler uses it unchanged |
| `src/image.ts` + `src/image.test.ts` | image-vision merge | Converts image attachment to agent content block |
| `container/skills/pdf-reader/` | pdf-reader merge | `pdftotext` wrapper the agent calls inside the container |
| `container/Dockerfile` | pdf-reader merge | Adds `poppler-utils` system package |
| `container/agent-runner/src/ipc-mcp-stdio.ts` | greenfield | New `send_whatsapp_message({ phone, text })` MCP tool |
| `src/ipc.ts` | modified | Dispatches `send_whatsapp_message` IPC type to whatsapp.ts |
| `src/index.ts`, `src/container-runner.ts` | image-vision merge | Image content block plumbing |
| `container/agent-runner/src/index.ts` | image-vision merge | Agent-side image content block support |

---

## Data Flow

### Incoming messages (text / voice / image / PDF)
```
Baileys event → whatsapp.ts handler → normalise
  voice  → transcription.ts (Whisper via OneCLI) → text
  image  → image.ts → content block
  PDF    → file path forwarded to container → pdftotext → text
          → orchestrator (src/index.ts) → container agent → reply
          → router.ts → whatsapp.ts send → Baileys → user
```

### Outbound send-to-anyone (cross-channel)
```
User (any channel) → agent resolves phone number
  → send_whatsapp_message({ phone: "+447...", text: "..." }) MCP tool
  → IPC message {type: "send_whatsapp_message", phone, text}
  → src/ipc.ts dispatcher
  → whatsapp.ts.sendMessage(phone.replace(/\D/g,'') + '@s.whatsapp.net', text)
  → Baileys → recipient
  → IPC reply: {success: true} | {error: "WhatsApp not connected"}
```

**Recipient resolution is the agent's responsibility.** The tool accepts a phone number only (international format). The agent uses its available tools (Slack lookup, Linear, context, or asks the user) to resolve a name to a number before calling the tool. This avoids per-user contact-name ambiguity — the same person may appear under different names in different phones.

### Auth on headless droplet (first boot)
```
whatsapp-auth.ts → request pairing code for eSIM number
  → write to store/pairing-code.txt
  → Andrey: ssh droplet → cat store/pairing-code.txt → enter code in WhatsApp on phone
  → session saved to store/auth/creds.json → auto-reconnect on restart
```

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| WhatsApp not connected when `send_whatsapp_message` is called | `src/ipc.ts` returns `{ error: "WhatsApp channel not connected" }` — agent surfaces as readable message, no crash |
| Auth session expiry | `connection.update` with `loggedOut: true` → log warning → Baileys auto-reconnects; if full re-auth is needed the user will notice Almanda stopped responding and re-run the pairing-code flow via SSH |
| Voice download failure | Handler logs, replies "Sorry, I couldn't process that voice message" — matches Telegram voice error pattern |
| `src/transcription.ts` merge conflict | Resolve `--ours` — ALM-551 version is authoritative; verify `downloadFile` returns `{ containerPath, hostPath }` in merged voice handler |
| Pairing code timeout (~60 s) | `whatsapp-auth.ts` detects disconnect, re-requests code automatically |

---

## Testing

### Unit tests (CI-gated)
- `src/channels/whatsapp.test.ts` — base tests from merge; extended by voice + pdf merges; greenfield additions:
  - `send_whatsapp_message` IPC handler: mock `sock.sendMessage`, assert JID conversion (`+447...` → `447...@s.whatsapp.net`), assert error when socket is null
- `src/image.test.ts` — 8 unit tests from image-vision merge
- Regression: `src/channels/telegram.test.ts` and `src/channels/slack.test.ts` voice paths remain green after `--ours` transcription.ts resolution

### Per-merge build gate
After each of the four merges: `npm install && npm run build && npm test` must pass before the next merge is applied.

### Container smoke
After image-vision merge (which modifies `container/agent-runner`): `./container/build.sh` verifies `poppler-utils` installs and the updated agent-runner compiles.

### Full suite gate before PR
`npm run format:check && npm run typecheck && npm run lint && npm test` — all exit 0.

### Post-deploy probes (Phase [10] on the droplet)
1. DM Almanda: text → text reply
2. DM Almanda: voice note → transcribed text reply
3. DM Almanda: image → vision reply
4. DM Almanda: PDF → extracted-text reply
5. Ask Almanda from Telegram: "send 'hi' to +\<eSIM test number\>" → confirm WhatsApp delivery
6. Add Almanda to a test group → group reply

---

## Key Decisions

| Decision | Choice | Reason |
|---|---|---|
| Code source | Merge from `qwibitai/nanoclaw-whatsapp` | Avoids re-implementing 1000+ lines of Baileys integration |
| Outbound send recipient | Phone number only | Names are ambiguous across users and phones; agent is responsible for resolution |
| Outbound send architecture | Dedicated IPC tool (not extending `schedule_task`) | Clear semantics, isolated test surface, matches existing tool pattern |
| Auth mode on droplet | Pairing code (headless) | No browser available; eSIM number ready |
| `src/transcription.ts` on merge conflict | `--ours` (ALM-551 version) | ALM-551 already ships the canonical Whisper runtime with correct `downloadFile` shape |
| Merge order | whatsapp → voice → pdf → image | image has widest blast radius; each subsequent merge prereqs the previous |
