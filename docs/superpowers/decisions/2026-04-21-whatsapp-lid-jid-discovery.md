# ADR: WhatsApp multi-device delivers messages via @lid JIDs

**Date:** 2026-04-21
**Mission:** add-whatsapp-channel (ALM-568)
**Status:** accepted

## Decision

`ownsJid` in `src/channels/whatsapp.ts` accepts the `@lid` suffix in addition to `@g.us` and `@s.whatsapp.net`. WhatsApp main group registration must use the actual JID discovered from the chats DB after a first incoming message — for multi-device senders this is a LID JID, not a phone JID.

## Context

When Andrey (a WhatsApp multi-device user) DMs Almanda, Baileys delivers `msg.key.remoteJid = 109882493673590@lid` — not the expected `972536241167@s.whatsapp.net`. The `senderPn` field needed for automatic LID-to-phone translation was absent from the message key. `ownsJid` previously only accepted `@g.us` and `@s.whatsapp.net`, so LID JIDs fell through to "no channel owns JID, skipping messages" — silently dropping all incoming messages with no log output.

The bug was discovered by querying the chats DB (`SELECT jid FROM chats WHERE channel = 'whatsapp'`) after failed delivery: the `onChatMetadata` callback is called for every message regardless of registration, so the LID JID appeared in `chats` even though messages were dropped.

## Consequences

**What this enables:** Any `@lid` JID can now be registered and routed to a WhatsApp group folder. Operators must discover the actual JID from the chats DB after a first incoming message and use that for registration rather than assuming the phone JID will arrive.

**What it rules out:** Phone JID registration alone is not sufficient for multi-device senders. Both the phone JID (`972536241167@s.whatsapp.net`) and the LID JID (`109882493673590@lid`) are registered for the same folder as a belt-and-suspenders approach.

**LID stability:** LID may change if the sender reinstalls WhatsApp or revokes all linked devices; re-registration against the new LID is required if messages stop arriving.

**Discovery procedure:**
```bash
npx tsx -e "
import { initDatabase, getAllChats } from './dist/db.js';
initDatabase();
getAllChats()
  .filter(c => c.channel === 'whatsapp')
  .forEach(c => console.log(c.jid, c.last_message_time));
"
```
Use the JID with the most recent `last_message_time` for registration.
