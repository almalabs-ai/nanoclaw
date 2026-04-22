# ADR: Auto-register WhatsApp group on @mention using main-group overlap as trust anchor

**Date:** 2026-04-22
**Mission:** whatsapp-auto-register
**Status:** accepted

## Decision

When the bot is @mentioned in an unregistered WhatsApp group and the sender is a participant of any `isMain` group, the group is automatically registered and message delivery proceeds — no operator step required.

## Context

Group registration was previously 100% manual (operator runs `setup/index.ts --step register …` after discovering the JID from the chats DB). This meant that adding the bot to a new group and immediately @mentioning her produced no response and no log — a confusing UX. The only existing trust concept was `group.isMain`, already used to gate elevated privileges and skip trigger requirements. A new env-var allowlist would have added config surface; open auto-registration would let any WhatsApp user onboard the bot.

## Consequences

**What this enables:** Operators in the main group can add the bot to new groups and start using her without a manual registration step. The first @mention triggers registration lazily (no `group-participants.update` subscriber needed, avoiding join-race complexity).

**What it rules out:** Users not in the main group cannot onboard the bot via @mention alone. Groups added by non-main-group users still require manual registration and produce a WARN log naming the group JID.

**LID nuance:** `senderJid` from `msg.key.participant` is translated via `translateJid` before the main-group participant comparison so multi-device LID senders match phone-JID participant records correctly (same issue as documented in `2026-04-21-whatsapp-lid-jid-discovery.md`).

**Idempotency:** `onAutoRegister` in `index.ts` returns the existing `RegisteredGroup` if the JID is already registered, handling concurrent-message races without a separate in-flight Set.
