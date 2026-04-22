# Design: Auto-register WhatsApp group on @mention with main-group trust

**Date:** 2026-04-22
**Change type:** core-fix
**Branch:** fix/whatsapp-auto-register-on-main-overlap

## Problem

When Almanda is added to a fresh WhatsApp group and a user @mentions her, she does not respond. The failure is silent — no log output — because `messages.upsert` in `src/channels/whatsapp.ts:281-282` gates all delivery on `registeredGroups[chatJid]` existing. Brand-new groups are never in that map until an operator manually runs the `/add-whatsapp` register step.

Secondary failure: mention detection only rewrites `@<lid-digits>` → `@Almanda` via a text substring match against `this.botLidUser`. If `sock.user.lid` is absent at connect-time or differs from the LID in the message text, the trigger regex never matches. The authoritative `contextInfo.mentionedJid` array from Baileys is unused.

## Solution

**Trust anchor:** existing `group.isMain === true` flag. If any participant of the new group is also a participant of the main group, the new group is trusted for auto-registration.

**Mention detection:** consult `contextInfo.mentionedJid` first (authoritative), fall back to LID-text match, fall back to trigger-pattern match on content.

**Auto-register flow:**
1. `messages.upsert` detects bot-mention in unregistered `@g.us` group.
2. Fetches group metadata + main-group participant lists.
3. Normalizes JIDs (strip device suffix, resolve LID→phone where cached).
4. Overlap found → calls `opts.onAutoRegister(chatJid, subject)` → `registerGroup()` with slugified folder name.
5. Message delivery continues normally; trigger check proceeds per usual.

**Observability:** silent drop becomes a rate-limited WARN log visible in journalctl, includes group JID + subject for operator action.

## Acceptance criteria

- A main-group user can @-mention Almanda in a brand-new group and receive a reply without any manual registration step.
- A non-main-group user mentioning Almanda in a new group produces a WARN log but no response.
- Existing registered-group behavior is unchanged.
- All unit tests pass; drop log is rate-limited (once per JID per 60 s).

## Files changed

- `src/channels/whatsapp.ts`
- `src/index.ts`
- `src/channels/whatsapp.test.ts`
