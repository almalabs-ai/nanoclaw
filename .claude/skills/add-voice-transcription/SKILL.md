---
name: add-voice-transcription
description: Wire WhatsApp's voice handler to the core transcription module (src/transcription.ts, on main since ALM-551). Core transcription already works on Telegram and Slack — this skill only adds the WhatsApp-specific audio download wiring.
---

# Add Voice Transcription (WhatsApp)

**Core transcription (`src/transcription.ts`) ships on `main` since ALM-551.** Telegram and Slack voice messages are transcribed automatically. This skill wires the same module into the WhatsApp channel.

When a voice note arrives in WhatsApp, it is downloaded, transcribed via OpenAI Whisper, and delivered to the agent as `[Voice: <transcript>] (<file-path>)`.

## Phase 1: Pre-flight

### Check prerequisites

1. **WhatsApp must be installed first** — confirm `src/channels/whatsapp.ts` exists. If not, run `/add-whatsapp` first.

2. **Core transcription** — confirm `src/transcription.ts` exists (it ships on main since ALM-551). If missing, something is wrong with the base installation; check git history.

3. **OpenAI API key** — you need `OPENAI_API_KEY` set in `.env`:

```bash
grep OPENAI_API_KEY .env
```

If missing, use `AskUserQuestion` to collect the key:

> I need an OpenAI API key for Whisper transcription.
> Go to https://platform.openai.com/api-keys → "Create new secret key" → copy it.
> Cost: ~$0.006/min (~$0.003 per typical 30-second voice note).

## Phase 2: Apply WhatsApp Voice Wiring

### Ensure WhatsApp fork remote

```bash
git remote -v
```

If `whatsapp` is missing:

```bash
git remote add whatsapp https://github.com/qwibitai/nanoclaw-whatsapp.git
```

### Merge the WhatsApp voice skill branch

```bash
git fetch whatsapp skill/voice-transcription
git merge whatsapp/skill/voice-transcription || {
  git checkout --theirs package-lock.json
  git add package-lock.json
  git merge --continue
}
```

**Important:** If there is a conflict on `src/transcription.ts`, prefer the `main` version — it is the canonical implementation. Resolve by running:

```bash
git checkout --ours src/transcription.ts
git add src/transcription.ts
git merge --continue
```

This branch adds:
- Voice handling in `src/channels/whatsapp.ts` (isVoiceMessage check, call into core `transcribeAudioFile`)
- Transcription tests in `src/channels/whatsapp.test.ts`

It does **not** add `src/transcription.ts` (already on main) or `OPENAI_API_KEY` to `.env.example` (already there).

### Validate

```bash
npm install --legacy-peer-deps
npm run build
npx vitest run src/channels/whatsapp.test.ts
```

All tests must pass before proceeding.

## Phase 3: Configure

### Add key to environment

Add to `.env`:

```
OPENAI_API_KEY=<their-key>
```

Sync to container environment:

```bash
mkdir -p data/env && cp .env data/env/env
```

### Build and restart

```bash
npm run build
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # macOS
# Linux: systemctl --user restart nanoclaw
```

## Phase 4: Verify

### Test with a voice note

> Send a voice note in any registered WhatsApp chat. The agent should receive it as `[Voice: <transcript>] (<file-path>)` and respond to the content.

### Check logs

```bash
tail -f logs/nanoclaw.log | grep -i "voice\|transcri"
```

Look for:
- `Audio transcribed successfully` — Whisper success
- `OPENAI_API_KEY not set` — key missing from `.env`
- `Whisper API returned error` — API error (check key validity, billing)
- `Failed to read audio file` — download issue

## Troubleshooting

### Voice notes show "[Voice message — transcription unavailable]"

1. Check `OPENAI_API_KEY` is set in `.env` AND synced to `data/env/env`
2. Verify key: `curl -s https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY" | head -c 200`
3. Check OpenAI billing — Whisper requires a funded account

### Merge conflict on src/transcription.ts

Run `git checkout --ours src/transcription.ts && git add src/transcription.ts && git merge --continue`. The main branch version is authoritative.

### Agent doesn't respond to voice notes

Verify the chat is registered and the agent is running. Transcription only runs for registered groups.
