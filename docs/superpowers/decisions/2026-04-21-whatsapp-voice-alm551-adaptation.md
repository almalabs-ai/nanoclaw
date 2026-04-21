# ADR: Rewrite WhatsApp voice handler to use ALM-551 transcription pattern

**Date:** 2026-04-21  
**Mission:** add-whatsapp-channel (ALM-568)  
**Status:** accepted

## Decision

Discarded the upstream `qwibitai/nanoclaw-whatsapp` voice handler and rewrote it to use the ALM-551 `downloadFile → { containerPath, hostPath }` / `transcribeAudioFile(hostPath)` pattern, keeping `src/transcription.ts` at `--ours` on merge conflict.

## Context

The `whatsapp/skill/voice-transcription` branch in `qwibitai/nanoclaw-whatsapp` predates ALM-551. Its `transcription.ts` uses a buffer-based API (`transcribeAudioMessage(msg, sock)`) rather than the file-path-based API (`transcribeAudioFile(hostPath)`) that ALM-551 introduced. ALM-551 also changed `downloadFile` to return `{ containerPath, hostPath }` instead of a plain `string`. Taking the upstream code as-is would have caused a silent runtime bug (the host path would be an object, not a string) and reverted Telegram/Slack transcription to the pre-ALM-551 buffer approach.

## Consequences

WhatsApp voice transcription is consistent with Telegram and Slack (same Whisper call, same container-path / host-path duality). The upstream `whatsapp/skill/voice-transcription` branch can never be cleanly re-merged without repeating this rewrite — any future re-merge must keep `src/transcription.ts` at `--ours` and manually port the voice handler to the current `transcribeAudioFile` signature.
