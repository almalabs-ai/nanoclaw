import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  makeWASocket,
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  normalizeMessageContent,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import type {
  GroupMetadata,
  WAMessage,
  WAMessageKey,
  WASocket,
  proto as ProtoTypes,
} from '@whiskeysockets/baileys';
// proto is not statically analyzable as a named ESM export from this CJS module
import { createRequire } from 'module';
const { proto } = createRequire(import.meta.url)('@whiskeysockets/baileys') as {
  proto: typeof ProtoTypes;
};

import {
  ASSISTANT_HAS_OWN_NUMBER,
  ASSISTANT_NAME,
  DEFAULT_TRIGGER,
  getTriggerPattern,
  GROUPS_DIR,
  STORE_DIR,
} from '../config.js';
import {
  getLastGroupSync,
  getMessageContentById,
  setLastGroupSync,
  updateChatName,
} from '../db.js';
import { resolveGroupFolderPath } from '../group-folder.js';
import { isImageMessage, processImage } from '../image.js';
import { logger } from '../logger.js';
import { transcribeAudioFile } from '../transcription.js';
import {
  Channel,
  OnInboundMessage,
  OnChatMetadata,
  RegisteredGroup,
} from '../types.js';
import { registerChannel, ChannelOpts } from './registry.js';
import pino from 'pino';

// Baileys requires a pino-compatible logger instance
const baileysLogger = pino({ level: 'silent' });

const GROUP_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface WhatsAppChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
  /**
   * Called when the bot is mentioned in an unregistered group whose participants
   * overlap with the main group. Implementations should register the group and
   * return the RegisteredGroup record so message delivery can proceed immediately.
   * Returning undefined means "decline to register" (message is dropped).
   */
  onAutoRegister?: (
    chatJid: string,
    subject: string,
  ) => RegisteredGroup | undefined;
}

export class WhatsAppChannel implements Channel {
  name = 'whatsapp';

  private sock!: WASocket;
  private connected = false;
  private lidToPhoneMap: Record<string, string> = {};
  private outgoingQueue: Array<{ jid: string; text: string }> = [];
  private flushing = false;
  private groupSyncTimerStarted = false;
  /** Cache of recently sent messages for retry requests (max 256 entries). */
  private sentMessageCache = new Map<string, ProtoTypes.IMessage>();
  /** Short-lived cache of phone-normalized group metadata for outbound sends. */
  private groupMetadataCache = new Map<
    string,
    { metadata: GroupMetadata; expiresAt: number }
  >();
  /** Bot's LID user ID (e.g. "80355281346633") for normalizing group mentions. */
  private botLidUser?: string;
  /** Resolve the initial connect() once the first successful open happens. */
  private pendingFirstOpen?: () => void;
  /** Rate-limit map for unregistered-group drop WARNs: JID → last-logged epoch ms. */
  private unregisteredDropLog = new Map<string, number>();

  private opts: WhatsAppChannelOpts;

  constructor(opts: WhatsAppChannelOpts) {
    this.opts = opts;
  }

  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.pendingFirstOpen = resolve;
      this.connectInternal().catch(reject);
    });
  }

  private async connectInternal(): Promise<void> {
    const authDir = path.join(STORE_DIR, 'auth');
    fs.mkdirSync(authDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const { version } = await fetchLatestWaWebVersion({}).catch((err) => {
      logger.warn(
        { err },
        'Failed to fetch latest WA Web version, using default',
      );
      return { version: undefined };
    });
    this.sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
      },
      printQRInTerminal: false,
      logger: baileysLogger,
      browser: Browsers.macOS('Chrome'),
      markOnlineOnConnect: false,
      cachedGroupMetadata: async (jid: string) =>
        this.getNormalizedGroupMetadata(jid),
      getMessage: async (key: WAMessageKey) => {
        const cached = this.sentMessageCache.get(key.id || '');
        if (cached) {
          logger.debug(
            { id: key.id },
            'getMessage: returning cached message for retry',
          );
          return cached;
        }
        // Fall back to DB lookup so WhatsApp can re-encrypt on retry.
        // Without this, self-chat messages show "waiting for this message".
        const content =
          key.id && key.remoteJid
            ? getMessageContentById(key.id, key.remoteJid)
            : undefined;
        if (content) {
          logger.debug(
            { id: key.id },
            'getMessage: returning DB message for retry',
          );
          return proto.Message.fromObject({ conversation: content });
        }
        // Return empty message rather than undefined — prevents indefinite
        // "waiting for this message" when we genuinely don't have the content.
        return proto.Message.fromObject({});
      },
    });

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        const msg =
          'WhatsApp authentication required. Run /setup in Claude Code.';
        logger.error(msg);
        exec(
          `osascript -e 'display notification "${msg}" with title "NanoClaw" sound name "Basso"'`,
        );
        setTimeout(() => process.exit(1), 1000);
      }

      if (connection === 'close') {
        this.connected = false;
        const reason = (
          lastDisconnect?.error as { output?: { statusCode?: number } }
        )?.output?.statusCode;
        const shouldReconnect = reason !== DisconnectReason.loggedOut;
        logger.info(
          {
            reason,
            shouldReconnect,
            queuedMessages: this.outgoingQueue.length,
          },
          'Connection closed',
        );

        if (shouldReconnect) {
          this.scheduleReconnect(1);
        } else {
          logger.info('Logged out. Run /setup to re-authenticate.');
          process.exit(0);
        }
      } else if (connection === 'open') {
        this.connected = true;
        logger.info('Connected to WhatsApp');

        // Build LID to phone mapping from auth state for self-chat translation
        if (this.sock.user) {
          const phoneUser = this.sock.user.id.split(':')[0];
          const lidUser = this.sock.user.lid?.split(':')[0];
          if (lidUser && phoneUser) {
            this.setLidPhoneMapping(lidUser, `${phoneUser}@s.whatsapp.net`);
            this.botLidUser = lidUser;
            logger.debug({ lidUser, phoneUser }, 'LID to phone mapping set');
          }
        }

        // Flush any messages queued while disconnected
        this.flushOutgoingQueue().catch((err) =>
          logger.error({ err }, 'Failed to flush outgoing queue'),
        );

        // Sync group metadata on startup (respects 24h cache)
        this.syncGroupMetadata().catch((err) =>
          logger.error({ err }, 'Initial group sync failed'),
        );
        // Set up daily sync timer (only once)
        if (!this.groupSyncTimerStarted) {
          this.groupSyncTimerStarted = true;
          setInterval(() => {
            this.syncGroupMetadata().catch((err) =>
              logger.error({ err }, 'Periodic group sync failed'),
            );
          }, GROUP_SYNC_INTERVAL_MS);
        }

        // Signal first connection to caller
        if (this.pendingFirstOpen) {
          this.pendingFirstOpen();
          this.pendingFirstOpen = undefined;
        }
      }
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('chats.phoneNumberShare', ({ lid, jid }) => {
      const lidUser = lid?.split('@')[0].split(':')[0];
      if (lidUser && jid) {
        this.setLidPhoneMapping(lidUser, jid);
      }
    });

    this.sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const msg of messages) {
        try {
          if (!msg.message) continue;
          // Unwrap container types (viewOnceMessageV2, ephemeralMessage,
          // editedMessage, etc.) so that conversation, extendedTextMessage,
          // imageMessage, etc. are accessible at the top level.
          const normalized = normalizeMessageContent(msg.message);
          if (!normalized) continue;
          const rawJid = msg.key.remoteJid;
          if (!rawJid || rawJid === 'status@broadcast') continue;

          // Translate LID JID to phone JID if applicable.
          // Prefer senderPn from the message key (available in newer WA protocol)
          // since translateJid may fail to resolve LID→phone via signalRepository.
          let chatJid = await this.translateJid(rawJid);
          if (chatJid.endsWith('@lid') && (msg.key as any).senderPn) {
            const pn = (msg.key as any).senderPn as string;
            const phoneJid = pn.includes('@') ? pn : `${pn}@s.whatsapp.net`;
            this.setLidPhoneMapping(
              rawJid.split('@')[0].split(':')[0],
              phoneJid,
            );
            chatJid = phoneJid;
            logger.info(
              { lidJid: rawJid, phoneJid },
              'Translated LID via senderPn',
            );
          }

          const timestamp = new Date(
            Number(msg.messageTimestamp) * 1000,
          ).toISOString();

          // Always notify about chat metadata for group discovery
          const isGroup = chatJid.endsWith('@g.us');
          this.opts.onChatMetadata(
            chatJid,
            timestamp,
            undefined,
            'whatsapp',
            isGroup,
          );

          const fromMe = msg.key.fromMe || false;
          const sender = msg.key.participant || msg.key.remoteJid || '';
          const senderName = msg.pushName || sender.split('@')[0];

          // Get registered group — try auto-register if unregistered group and bot is mentioned
          const groups = this.opts.registeredGroups();
          let group: RegisteredGroup | undefined = groups[chatJid];

          if (!group && isGroup && !fromMe) {
            const prelimContent =
              normalized.conversation ||
              normalized.extendedTextMessage?.text ||
              normalized.imageMessage?.caption ||
              normalized.videoMessage?.caption ||
              normalized.documentMessage?.caption ||
              '';
            if (this.isBotMentioned(normalized, prelimContent)) {
              group = await this.tryAutoRegister(chatJid, sender, groups);
              // tryAutoRegister logs its own WARN on no-overlap; no drop log needed here
            } else {
              this.logUnregisteredDrop(chatJid);
            }
          }

          if (group) {
            let content =
              normalized.conversation ||
              normalized.extendedTextMessage?.text ||
              normalized.imageMessage?.caption ||
              normalized.videoMessage?.caption ||
              '';

            // WhatsApp group mentions use the LID in raw text (e.g. "@80355281346633")
            // instead of the display name. Normalize to @AssistantName for trigger matching.
            if (this.botLidUser && content.includes(`@${this.botLidUser}`)) {
              content = content.replace(
                `@${this.botLidUser}`,
                `@${ASSISTANT_NAME}`,
              );
            }

            // Image attachment handling
            if (isImageMessage(msg)) {
              try {
                const buffer = await downloadMediaMessage(msg, 'buffer', {});
                const groupDir = path.join(GROUPS_DIR, group.folder);
                const caption = normalized?.imageMessage?.caption ?? '';
                const result = await processImage(
                  buffer as Buffer,
                  groupDir,
                  caption,
                );
                if (result) {
                  content = result.content;
                }
              } catch (err) {
                logger.warn({ err, jid: chatJid }, 'Image - download failed');
              }
            }

            // PDF attachment handling
            if (normalized?.documentMessage?.mimetype === 'application/pdf') {
              try {
                const buffer = await downloadMediaMessage(msg, 'buffer', {});
                const groupDir = path.join(GROUPS_DIR, group.folder);
                const attachDir = path.join(groupDir, 'attachments');
                fs.mkdirSync(attachDir, { recursive: true });
                const filename = path.basename(
                  normalized.documentMessage.fileName ||
                    `doc-${Date.now()}.pdf`,
                );
                const filePath = path.join(attachDir, filename);
                fs.writeFileSync(filePath, buffer as Buffer);
                const sizeKB = Math.round((buffer as Buffer).length / 1024);
                const pdfRef = `[PDF: attachments/${filename} (${sizeKB}KB)]\nUse: pdf-reader extract attachments/${filename}`;
                const caption = normalized.documentMessage.caption || '';
                content = caption ? `${caption}\n\n${pdfRef}` : pdfRef;
                logger.info(
                  { jid: chatJid, filename },
                  'Downloaded PDF attachment',
                );
              } catch (err) {
                logger.warn(
                  { err, jid: chatJid },
                  'Failed to download PDF attachment',
                );
              }
            }

            // Check if this is a voice (PTT) message
            const isVoice = normalized.audioMessage?.ptt === true;

            // Skip protocol messages with no text content (encryption keys, read receipts, etc.)
            // but allow voice messages through for transcription
            if (!content && !isVoice) continue;

            // Detect bot messages: with own number, fromMe is reliable
            // since only the bot sends from that number.
            // With shared number, bot messages carry the assistant name prefix
            // (even in DMs/self-chat) so we check for that.
            const isBotMessage = ASSISTANT_HAS_OWN_NUMBER
              ? fromMe
              : content.startsWith(`${ASSISTANT_NAME}:`);

            // Transcribe voice messages before delivering
            if (isVoice) {
              try {
                const msgId = msg.key.id || Date.now().toString();
                const paths = await this.downloadVoiceMessage(
                  msg,
                  group.folder,
                  msgId,
                );
                if (paths) {
                  const result = await transcribeAudioFile(paths.hostPath);
                  content = result.transcript
                    ? `[Voice: ${result.transcript}] (${paths.containerPath})`
                    : `[Voice message — transcription unavailable] (${paths.containerPath})`;
                } else {
                  content = '[Voice message — download failed]';
                }
              } catch (err) {
                // Catch here rather than propagating: ensures a failed voice message
                // delivers a readable fallback instead of silently dropping the message.
                logger.error({ err, chatJid }, 'Voice transcription error');
                content = '[Voice message — transcription failed]';
              }
            }

            this.opts.onMessage(chatJid, {
              id: msg.key.id || '',
              chat_jid: chatJid,
              sender,
              sender_name: senderName,
              content,
              timestamp,
              is_from_me: fromMe,
              is_bot_message: isBotMessage,
            });
          }
        } catch (err) {
          logger.error(
            { err, remoteJid: msg.key?.remoteJid },
            'Error processing incoming message',
          );
        }
      }
    });
  }

  /** Returns true if the bot is mentioned in this message content or contextInfo. */
  private isBotMentioned(
    msg: ReturnType<typeof normalizeMessageContent>,
    content: string,
  ): boolean {
    if (!msg) return false;

    // Authoritative: check contextInfo.mentionedJid (strips device suffix before comparing)
    const mentionedJids: string[] =
      (msg as any).extendedTextMessage?.contextInfo?.mentionedJid ?? [];
    if (this.sock?.user) {
      const botPhone = this.sock.user.id.replace(/:(\d+)@/, '@');
      const botLid = this.sock.user.lid?.replace(/:(\d+)@/, '@');
      for (const jid of mentionedJids) {
        const normJid = jid.replace(/:(\d+)@/, '@');
        if (normJid === botPhone || (botLid && normJid === botLid)) {
          return true;
        }
      }
    }

    // Fallback: raw LID text match (e.g. "@9876543210" in message body)
    if (this.botLidUser && content.includes(`@${this.botLidUser}`)) return true;

    // Fallback: display-name trigger pattern (e.g. "@Andy")
    return getTriggerPattern(DEFAULT_TRIGGER).test(content);
  }

  /**
   * Rate-limited WARN for messages dropped from unregistered groups.
   * Logs at most once per JID per 60 seconds.
   */
  private logUnregisteredDrop(chatJid: string): void {
    const now = Date.now();
    if (now - (this.unregisteredDropLog.get(chatJid) ?? 0) < 60_000) return;
    this.unregisteredDropLog.set(chatJid, now);
    logger.warn(
      { chatJid },
      'Message in unregistered group, dropping. Register via /add-whatsapp.',
    );
  }

  /**
   * Checks whether the sender is a participant of any main group.
   * If yes and onAutoRegister is available, calls it and returns the new group.
   */
  private async tryAutoRegister(
    chatJid: string,
    senderJid: string,
    registeredGroups: Record<string, RegisteredGroup>,
  ): Promise<RegisteredGroup | undefined> {
    if (!this.opts.onAutoRegister) return undefined;

    const mainGroups = Object.entries(registeredGroups).filter(
      ([, g]) => g.isMain === true,
    );
    if (mainGroups.length === 0) return undefined;

    try {
      const resolvedSender = await this.translateJid(senderJid);
      const normSender = resolvedSender.replace(/:(\d+)@/, '@');

      for (const [mainJid] of mainGroups) {
        let mainMeta: GroupMetadata | undefined;
        try {
          mainMeta = await this.sock.groupMetadata(mainJid);
        } catch (err) {
          logger.debug(
            { mainJid, err },
            'Could not fetch main-group metadata for overlap check',
          );
          continue;
        }

        for (const p of mainMeta.participants) {
          const resolved = await this.translateJid(p.id);
          if (resolved.replace(/:(\d+)@/, '@') === normSender) {
            // Sender is a main-group member — auto-register
            let subject = chatJid;
            try {
              const newMeta = await this.sock.groupMetadata(chatJid);
              subject = newMeta.subject || chatJid;
            } catch {
              /* fallback to chatJid */
            }

            const group = this.opts.onAutoRegister(chatJid, subject);
            if (group) {
              logger.info(
                { chatJid, subject, mainJid },
                'Auto-registered group on mention from main-group member',
              );
            }
            return group;
          }
        }
      }

      logger.warn(
        { chatJid, mainGroupCount: mainGroups.length },
        'Mention in unregistered group — no main-group overlap, dropping. Register manually via /add-whatsapp.',
      );
      return undefined;
    } catch (err) {
      logger.warn({ chatJid, err }, 'Auto-register overlap check failed');
      return undefined;
    }
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    // Prefix bot messages with assistant name so users know who's speaking.
    // On a shared number, prefix is also needed in DMs (including self-chat)
    // to distinguish bot output from user messages.
    // Skip only when the assistant has its own dedicated phone number.
    const prefixed = ASSISTANT_HAS_OWN_NUMBER
      ? text
      : `${ASSISTANT_NAME}: ${text}`;

    if (!this.connected) {
      this.outgoingQueue.push({ jid, text: prefixed });
      logger.info(
        { jid, length: prefixed.length, queueSize: this.outgoingQueue.length },
        'WA disconnected, message queued',
      );
      return;
    }
    try {
      // Baileys sendMessage to a group can hang indefinitely (no built-in timeout)
      // if the sender-key distribution ACK never arrives from WA servers.
      // Race against a 30s timeout so failures surface as WARN + queue entry.
      const SEND_TIMEOUT_MS = 30_000;
      const sent = await Promise.race([
        this.sock.sendMessage(jid, { text: prefixed }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(`sendMessage timeout after ${SEND_TIMEOUT_MS}ms`),
              ),
            SEND_TIMEOUT_MS,
          ),
        ),
      ]);
      // Cache for retry requests (recipient may ask us to re-encrypt)
      if (sent?.key?.id && sent.message) {
        this.sentMessageCache.set(sent.key.id, sent.message);
        if (this.sentMessageCache.size > 256) {
          const oldest = this.sentMessageCache.keys().next().value!;
          this.sentMessageCache.delete(oldest);
        }
      }
      logger.info({ jid, length: prefixed.length }, 'Message sent');
    } catch (err) {
      // If send fails, queue it for retry on reconnect
      this.outgoingQueue.push({ jid, text: prefixed });
      logger.warn(
        { jid, err, queueSize: this.outgoingQueue.length },
        'Failed to send, message queued',
      );
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return (
      jid.endsWith('@g.us') ||
      jid.endsWith('@s.whatsapp.net') ||
      jid.endsWith('@lid')
    );
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.sock?.end(undefined);
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    try {
      const status = isTyping ? 'composing' : 'paused';
      logger.debug({ jid, status }, 'Sending presence update');
      await this.sock.sendPresenceUpdate(status, jid);
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to update typing status');
    }
  }

  async syncGroups(force: boolean): Promise<void> {
    return this.syncGroupMetadata(force);
  }

  /**
   * Sync group metadata from WhatsApp.
   * Fetches all participating groups and stores their names in the database.
   * Called on startup, daily, and on-demand via IPC.
   */
  async syncGroupMetadata(force = false): Promise<void> {
    if (!force) {
      const lastSync = getLastGroupSync();
      if (lastSync) {
        const lastSyncTime = new Date(lastSync).getTime();
        if (Date.now() - lastSyncTime < GROUP_SYNC_INTERVAL_MS) {
          logger.debug({ lastSync }, 'Skipping group sync - synced recently');
          return;
        }
      }
    }

    try {
      logger.info('Syncing group metadata from WhatsApp...');
      const groups = await this.sock.groupFetchAllParticipating();

      let count = 0;
      for (const [jid, metadata] of Object.entries(groups)) {
        if (metadata.subject) {
          updateChatName(jid, metadata.subject);
          count++;
        }
      }

      setLastGroupSync();
      logger.info({ count }, 'Group metadata synced');
    } catch (err) {
      logger.error({ err }, 'Failed to sync group metadata');
    }
  }

  private scheduleReconnect(attempt: number): void {
    const delayMs = Math.min(5000 * Math.pow(2, attempt - 1), 300000);
    logger.info({ attempt, delayMs }, 'Reconnecting...');
    setTimeout(() => {
      this.connectInternal().catch((err) => {
        logger.error({ err, attempt }, 'Reconnection attempt failed');
        this.scheduleReconnect(attempt + 1);
      });
    }, delayMs);
  }

  private async translateJid(jid: string): Promise<string> {
    if (!jid.endsWith('@lid')) return jid;
    const lidUser = jid.split('@')[0].split(':')[0];

    // Check local cache first
    const cached = this.lidToPhoneMap[lidUser];
    if (cached) {
      logger.debug(
        { lidJid: jid, phoneJid: cached },
        'Translated LID to phone JID (cached)',
      );
      return cached;
    }

    // Query Baileys' signal repository for the mapping
    try {
      const pn = await (
        this.sock.signalRepository as any
      )?.lidMapping?.getPNForLID(jid);
      if (pn) {
        const phoneJid = `${pn.split('@')[0].split(':')[0]}@s.whatsapp.net`;
        this.setLidPhoneMapping(lidUser, phoneJid);
        logger.info(
          { lidJid: jid, phoneJid },
          'Translated LID to phone JID (signalRepository)',
        );
        return phoneJid;
      }
    } catch (err) {
      logger.debug({ err, jid }, 'Failed to resolve LID via signalRepository');
    }

    return jid;
  }

  private setLidPhoneMapping(lidUser: string, phoneJid: string): void {
    if (this.lidToPhoneMap[lidUser] === phoneJid) return;
    this.lidToPhoneMap[lidUser] = phoneJid;
    // Participant IDs in cached group metadata depend on this mapping.
    this.groupMetadataCache.clear();
  }

  private async getNormalizedGroupMetadata(
    jid: string,
    forceRefresh = false,
  ): Promise<GroupMetadata | undefined> {
    if (!jid.endsWith('@g.us')) return undefined;

    const cached = this.groupMetadataCache.get(jid);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
      return cached.metadata;
    }

    const metadata = await this.sock.groupMetadata(jid);
    const participants = await Promise.all(
      metadata.participants.map(async (participant) => ({
        ...participant,
        id: await this.translateJid(participant.id),
      })),
    );
    const normalized = { ...metadata, participants };
    const mappedCount = participants.filter(
      (participant, index) =>
        participant.id !== metadata.participants[index]?.id,
    ).length;

    logger.info(
      { jid, participantCount: participants.length, mappedCount },
      'Prepared normalized group metadata for send',
    );

    this.groupMetadataCache.set(jid, {
      metadata: normalized,
      expiresAt: Date.now() + 60_000,
    });
    return normalized;
  }

  /**
   * Download a WhatsApp voice message to the group's attachments directory.
   * Returns both the container-relative path and the host absolute path,
   * or null if the download fails.
   */
  private async downloadVoiceMessage(
    msg: WAMessage,
    groupFolder: string,
    msgId: string,
  ): Promise<{ containerPath: string; hostPath: string } | null> {
    try {
      const buffer = (await downloadMediaMessage(
        msg,
        'buffer',
        {},
        {
          logger: baileysLogger,
          reuploadRequest: this.sock.updateMediaMessage,
        },
      )) as Buffer;

      if (!buffer || buffer.length === 0) {
        logger.warn({ msgId }, 'Voice message download returned empty buffer');
        return null;
      }

      const groupDir = resolveGroupFolderPath(groupFolder);
      const attachDir = path.join(groupDir, 'attachments');
      fs.mkdirSync(attachDir, { recursive: true });

      // WhatsApp PTT is always OGG/Opus per the Baileys media spec
      const filename = `wa_voice_${msgId.replace(/[^a-zA-Z0-9]/g, '_')}.ogg`;
      const hostPath = path.join(attachDir, filename);
      fs.writeFileSync(hostPath, buffer);

      const containerPath = `/workspace/group/attachments/${filename}`;
      logger.info(
        { msgId, dest: hostPath, bytes: buffer.length },
        'WhatsApp voice downloaded',
      );
      return { containerPath, hostPath };
    } catch (err) {
      logger.error({ msgId, err }, 'Failed to download WhatsApp voice message');
      return null;
    }
  }

  private async flushOutgoingQueue(): Promise<void> {
    if (this.flushing || this.outgoingQueue.length === 0) return;
    this.flushing = true;
    try {
      logger.info(
        { count: this.outgoingQueue.length },
        'Flushing outgoing message queue',
      );
      while (this.outgoingQueue.length > 0) {
        const item = this.outgoingQueue.shift()!;
        // Send directly — queued items are already prefixed by sendMessage
        const sent = await this.sock.sendMessage(item.jid, { text: item.text });
        if (sent?.key?.id && sent.message) {
          this.sentMessageCache.set(sent.key.id, sent.message);
        }
        logger.info(
          { jid: item.jid, length: item.text.length },
          'Queued message sent',
        );
      }
    } finally {
      this.flushing = false;
    }
  }
}

registerChannel('whatsapp', (opts: ChannelOpts) => new WhatsAppChannel(opts));
