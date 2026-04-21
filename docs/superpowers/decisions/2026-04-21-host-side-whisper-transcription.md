# ADR: Host-side Whisper transcription for voice messages

**Date:** 2026-04-21
**Mission:** voice-messages (ALM-551)
**Status:** accepted

## Decision

Transcribe audio files in the host Node.js process (NanoClaw core), not inside the agent container.

## Context

Agent containers run in sandboxed Linux VMs with no direct network access and no visibility into host secrets. Transcription requires both: a network call to the OpenAI Whisper API and the `OPENAI_API_KEY` secret. Wiring transcription into the container would require either forwarding the API key via `-e` (weakens the isolation model) or adding multimodal audio blocks to the agent-runner (significant scope, no SDK support today). The host already handles analogous pre-processing — downloading Telegram/Slack files, resizing images for vision — so placing transcription there is consistent with the existing pattern.

## Consequences

Enables: voice-to-text on Telegram and Slack without any container changes; natural multilingual support via Whisper's auto-detection; clean fallback (agent still sees the file path when the key is absent).

Rules out: agent-initiated transcription of arbitrary audio files at runtime (the agent cannot call the Whisper API directly in the sandboxed environment). Also means transcription latency (1-3 s) adds to the fire-and-forget delivery path, creating a small window where subsequent text messages may arrive before the transcript.
