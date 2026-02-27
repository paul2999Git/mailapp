import { ImapFlow } from 'imapflow';
import { simpleParser, ParsedMail, AddressObject } from 'mailparser';
import type { ProviderType, EmailAddress } from '@mailhub/shared';
import type {
    IProviderAdapter,
    ImapConfig,
    NormalizedMessage,
    NormalizedFolder,
    SyncResult,
    Attachment,
} from './types';

/**
 * Base IMAP adapter for providers using standard IMAP
 * Used by: Proton (via Bridge), Hover, Zoho (fallback)
 */
export class ImapAdapter implements IProviderAdapter {
    readonly provider: ProviderType;
    private client: ImapFlow | null = null;
    private config: ImapConfig;
    private accountId: string;

    constructor(provider: ProviderType, accountId: string, config: ImapConfig) {
        this.provider = provider;
        this.accountId = accountId;
        this.config = config;
    }

    private async getClient(): Promise<ImapFlow> {
        // If we have an existing client, verify it's still alive
        if (this.client) {
            try {
                await this.client.noop();
                return this.client;
            } catch {
                // Connection is dead, clean up and reconnect
                console.log(`♻️ IMAP connection stale for ${this.provider}, reconnecting...`);
                this.client = null;
            }
        }

        // Connect with retry logic (handles Proton Bridge restarts, network blips, etc.)
        const maxRetries = 3;
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`Connecting to ${this.provider} at ${this.config.host}:${this.config.port} (TLS: ${this.config.tls}) [attempt ${attempt}/${maxRetries}]`);

                const client = new ImapFlow({
                    host: this.config.host,
                    port: this.config.port,
                    secure: this.config.tls,
                    tls: this.provider === 'proton' ? { rejectUnauthorized: false } : undefined,
                    auth: {
                        user: this.config.username,
                        pass: this.config.password,
                    },
                    logger: false,
                    emitLogs: false,
                });

                // Clear cached client on connection errors so next call reconnects
                client.on('error', (err: Error) => {
                    console.error(`IMAP Client Error (${this.provider} at ${this.config.host}):`, err.message);
                    this.client = null;
                });

                client.on('close', () => {
                    console.log(`IMAP connection closed for ${this.provider}`);
                    this.client = null;
                });

                // Connect with a timeout to avoid hanging on unresponsive servers
                await Promise.race([
                    client.connect(),
                    new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error(`IMAP connect timeout after 30s for ${this.provider}`)), 30000)
                    ),
                ]);

                this.client = client;
                return this.client;
            } catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));
                console.warn(`IMAP connect attempt ${attempt}/${maxRetries} failed for ${this.provider}: ${lastError.message}`);

                if (attempt < maxRetries) {
                    const delay = attempt * 2000; // 2s, 4s backoff
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw lastError || new Error(`Failed to connect to ${this.provider} IMAP after ${maxRetries} attempts`);
    }

    async testConnection(): Promise<{ success: boolean; error?: string }> {
        try {
            const client = await this.getClient();
            await client.noop();
            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Connection failed',
            };
        }
    }

    async fetchFolders(): Promise<NormalizedFolder[]> {
        const client = await this.getClient();
        const folders: NormalizedFolder[] = [];

        const mailboxes = await client.list();

        for (const mailbox of mailboxes) {
            const status = await client.status(mailbox.path, {
                messages: true,
                unseen: true,
            });

            folders.push({
                providerFolderId: mailbox.path,
                name: mailbox.name,
                fullPath: mailbox.path,
                folderType: this.mapFolderType(mailbox),
                isSystem: mailbox.specialUse !== undefined,
                messageCount: status.messages || 0,
                unreadCount: status.unseen || 0,
            });
        }

        return folders;
    }

    private mapFolderType(mailbox: any): NormalizedFolder['folderType'] {
        if (mailbox.specialUse === '\\Inbox') return 'inbox';
        if (mailbox.specialUse === '\\Sent') return 'sent';
        if (mailbox.specialUse === '\\Drafts') return 'drafts';
        if (mailbox.specialUse === '\\Trash') return 'trash';
        if (mailbox.specialUse === '\\Junk') return 'spam';
        if (mailbox.specialUse === '\\Archive') return 'archive';
        return 'custom';
    }

    async syncMessages(cursor?: string | null, folderId?: string | null, since?: Date): Promise<SyncResult> {
        const client = await this.getClient();
        const messages: NormalizedMessage[] = [];
        const targetFolder = folderId || 'INBOX';

        // Check mailbox status BEFORE locking to detect UIDVALIDITY changes
        const status = await client.status(targetFolder, {
            uidNext: true,
            uidValidity: true,
            messages: true,
        });

        const lock = await client.getMailboxLock(targetFolder);

        try {
            // Parse cursor - format is "uidvalidity:uid" or legacy plain UID
            let savedValidity: number | null = null;
            let sinceUid = 1;

            if (cursor) {
                const parts = cursor.split(':');
                if (parts.length === 2) {
                    savedValidity = parseInt(parts[0], 10);
                    sinceUid = parseInt(parts[1], 10);
                } else {
                    sinceUid = parseInt(cursor, 10);
                }
            }

            // Reset cursor if UIDVALIDITY changed or cursor is ahead of uidNext
            const currentValidity = Number(status.uidValidity);
            const uidNext = Number(status.uidNext) || 1;

            if (savedValidity && currentValidity && savedValidity !== currentValidity) {
                console.log(`⚠️ UIDVALIDITY changed for ${targetFolder}: ${savedValidity} → ${currentValidity}. Resetting cursor.`);
                sinceUid = 1;
            } else if (sinceUid > uidNext) {
                console.log(`⚠️ Cursor (${sinceUid}) ahead of uidNext (${uidNext}) for ${targetFolder}. Resetting cursor.`);
                sinceUid = 1;
            }

            // Build search criteria
            const searchCriteria: any = {};
            if (sinceUid > 1) {
                searchCriteria.uid = `${sinceUid}:*`;
            } else if (!since) {
                searchCriteria.all = true;
            }

            if (since) {
                searchCriteria.since = since;
            }

            let count = 0;
            const maxMessages = 200;
            let lastUid = sinceUid > 1 ? sinceUid : 0;

            for await (const msg of client.fetch(searchCriteria, {
                uid: true,
                flags: true,
                envelope: true,
                bodyStructure: true,
                source: true,
            })) {
                if (count >= maxMessages) break;
                if (!msg.source) continue;

                const parsed = await simpleParser(msg.source);
                const normalized = this.normalizeMessage(msg, parsed);
                normalized.folderId = targetFolder;

                messages.push(normalized);
                lastUid = Math.max(lastUid, msg.uid);
                count++;
            }

            // Build new cursor with UIDVALIDITY prefix
            const newCursorUid = lastUid > 0 ? lastUid + 1 : 1;
            const newCursor = currentValidity
                ? `${currentValidity}:${newCursorUid}`
                : String(newCursorUid);

            return {
                messages,
                folders: [],
                newCursor,
                hasMore: count === maxMessages,
                stats: {
                    messagesProcessed: count,
                    messagesNew: count,
                    messagesUpdated: 0,
                },
            };
        } finally {
            lock.release();
        }
    }

    private normalizeMessage(imapMsg: any, parsed: ParsedMail): NormalizedMessage {
        const refs = parsed.references;
        const referencesStr = Array.isArray(refs) ? refs.join(' ') : (refs || null);

        return {
            providerMessageId: String(imapMsg.uid),
            messageIdHeader: parsed.messageId || null,
            inReplyTo: parsed.inReplyTo || null,
            referencesHeader: referencesStr,

            subject: parsed.subject || null,
            from: this.parseAddress(parsed.from),
            to: this.parseAddressField(parsed.to),
            cc: this.parseAddressField(parsed.cc),
            bcc: this.parseAddressField(parsed.bcc),
            replyTo: parsed.replyTo?.text || null,

            dateSent: parsed.date || null,
            dateReceived: parsed.date || new Date(),

            bodyText: parsed.text || null,
            bodyHtml: parsed.html || null,
            bodyPreview: parsed.text?.substring(0, 500) || null,

            hasAttachments: (parsed.attachments?.length || 0) > 0,
            attachments: parsed.attachments?.map(a => ({
                name: a.filename || 'attachment',
                size: a.size || 0,
                mimeType: a.contentType || 'application/octet-stream',
            })) || [],
            fullAttachments: parsed.attachments?.map(a => ({
                name: a.filename || 'attachment',
                size: a.size || 0,
                mimeType: a.contentType || 'application/octet-stream',
                content: a.content
            })),
            sizeBytes: parsed.text?.length || null,

            isRead: imapMsg.flags?.has('\\Seen') || false,
            isStarred: imapMsg.flags?.has('\\Flagged') || false,
            isDraft: imapMsg.flags?.has('\\Draft') || false,

            providerLabels: Array.from(imapMsg.flags || []),
            folderId: null,
        };
    }

    private parseAddress(addr: AddressObject | undefined): EmailAddress {
        if (!addr?.value?.[0]) {
            return { email: 'unknown@unknown.com' };
        }
        return {
            email: addr.value[0].address || 'unknown@unknown.com',
            name: addr.value[0].name,
        };
    }

    private parseAddresses(addr: AddressObject | undefined): EmailAddress[] {
        if (!addr?.value) return [];
        return addr.value.map(a => ({
            email: a.address || 'unknown@unknown.com',
            name: a.name,
        }));
    }

    private parseAddressField(addr: AddressObject | AddressObject[] | undefined): EmailAddress[] {
        if (!addr) return [];
        if (Array.isArray(addr)) {
            return addr.flatMap(a => this.parseAddresses(a));
        }
        return this.parseAddresses(addr);
    }

    async fetchMessage(providerMessageId: string): Promise<NormalizedMessage | null> {
        const client = await this.getClient();
        const lock = await client.getMailboxLock('INBOX');

        try {
            const msg = await client.fetchOne(providerMessageId, {
                uid: true,
                flags: true,
                envelope: true,
                source: true,
            }, { uid: true });

            if (!msg || !msg.source) return null;

            const parsed = await simpleParser(msg.source);
            return this.normalizeMessage(msg, parsed);
        } finally {
            lock.release();
        }
    }

    async markRead(providerMessageId: string, isRead: boolean): Promise<void> {
        const client = await this.getClient();
        // Use a more generic way to get mailbox lock - currently hardcoded to INBOX
        // but normalizeMessage has folderId now.
        const lock = await client.getMailboxLock('INBOX');

        try {
            if (isRead) {
                await client.messageFlagsAdd(providerMessageId, ['\\Seen'], { uid: true });
            } else {
                await client.messageFlagsRemove(providerMessageId, ['\\Seen'], { uid: true });
            }
        } finally {
            lock.release();
        }
    }

    async fetchAttachment(providerMessageId: string, attachmentName: string): Promise<{ content: Buffer, contentType: string }> {
        const client = await this.getClient();
        const lock = await client.getMailboxLock('INBOX');
        try {
            // For IMAP, the easiest way with mailparser is to fetch the full message
            // and extract the specific attachment by name.
            const msg = await client.fetchOne(providerMessageId, { source: true }, { uid: true });
            if (!msg || !msg.source) throw new Error('Message not found');

            const parsed = await simpleParser(msg.source);
            const attachment = parsed.attachments.find(a => a.filename === attachmentName);

            if (!attachment) throw new Error('Attachment not found');

            return {
                content: attachment.content,
                contentType: attachment.contentType
            };
        } finally {
            lock.release();
        }
    }

    async markStarred(providerMessageId: string, isStarred: boolean): Promise<void> {
        const client = await this.getClient();
        const lock = await client.getMailboxLock('INBOX');

        try {
            if (isStarred) {
                await client.messageFlagsAdd(providerMessageId, ['\\Flagged'], { uid: true });
            } else {
                await client.messageFlagsRemove(providerMessageId, ['\\Flagged'], { uid: true });
            }
        } finally {
            lock.release();
        }
    }

    async moveToFolder(providerMessageId: string, folderId: string): Promise<void> {
        const client = await this.getClient();
        const lock = await client.getMailboxLock('INBOX');

        try {
            await client.messageMove(providerMessageId, folderId, { uid: true });
        } finally {
            lock.release();
        }
    }

    async moveToTrash(providerMessageId: string): Promise<void> {
        await this.moveToFolder(providerMessageId, 'Trash');
    }

    async archive(providerMessageId: string): Promise<void> {
        await this.moveToFolder(providerMessageId, 'Archive');
    }

    async createFolder(name: string): Promise<NormalizedFolder> {
        const client = await this.getClient();
        await client.mailboxCreate(name);

        return {
            providerFolderId: name,
            name: name.split('/').pop() || name,
            fullPath: name,
            folderType: 'custom',
            isSystem: false,
            messageCount: 0,
            unreadCount: 0,
        };
    }

    async saveDraft(to: EmailAddress[], subject: string, body: string, inReplyTo?: string): Promise<string> {
        const client = await this.getClient();

        const message = [
            `From: ${this.config.username}`,
            `To: ${to.map(a => a.name ? `${a.name} <${a.email}>` : a.email).join(', ')}`,
            `Subject: ${subject}`,
            inReplyTo ? `In-Reply-To: ${inReplyTo}` : '',
            `Date: ${new Date().toUTCString()}`,
            `Content-Type: text/plain; charset=utf-8`,
            '',
            body,
        ].filter(Boolean).join('\r\n');

        const result = await client.append('Drafts', Buffer.from(message), ['\\Draft']);
        if (result && typeof result === 'object' && 'uid' in result) {
            return String(result.uid) || 'draft';
        }
        return 'draft';
    }

    async sendMail(
        to: EmailAddress[],
        subject: string,
        body: string,
        options?: {
            cc?: EmailAddress[],
            bcc?: EmailAddress[],
            inReplyTo?: string,
            attachments?: Attachment[]
        }
    ): Promise<void> {
        const nodemailer = require('nodemailer');

        // Build SMTP config from IMAP config (usually same host/auth for mail services)
        // For Proton, SMTP is on port 1025 by default with Bridge
        let smtpHost = this.config.host;
        let smtpPort = 587; // Standard submission port
        let secure = false; // STARTTLS

        if (this.provider === 'proton') {
            smtpHost = '127.0.0.1';
            smtpPort = 1025;
            secure = false;
        } else if (this.provider === 'zoho') {
            smtpHost = 'smtp.zoho.com';
            smtpPort = 465;
            secure = true;
        } else if (this.provider === 'hover') {
            smtpHost = 'mail.hover.com';
            smtpPort = 465;
            secure = true;
        }

        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: secure,
            auth: {
                user: this.config.username,
                pass: this.config.password,
            },
        });

        await transporter.sendMail({
            from: this.config.username,
            to: to.map(a => a.name ? `${a.name} <${a.email}>` : a.email).join(', '),
            cc: options?.cc?.map(a => a.name ? `${a.name} <${a.email}>` : a.email).join(', '),
            bcc: options?.bcc?.map(a => a.name ? `${a.name} <${a.email}>` : a.email).join(', '),
            subject: subject,
            text: body,
            inReplyTo: options?.inReplyTo,
            references: options?.inReplyTo,
            attachments: options?.attachments?.map(a => ({
                filename: a.name,
                content: a.content,
                contentType: a.mimeType
            }))
        });
    }
    async disconnect(): Promise<void> {
        if (this.client) {
            try {
                await this.client.logout();
            } catch (err) {
                // Ignore disconnect errors if connection was already lost
            } finally {
                this.client = null;
            }
        }
    }
}

/**
 * Proton Mail adapter - uses IMAP via Proton Bridge
 * Privacy: Body content stays local, never sent to AI
 */
export class ProtonAdapter extends ImapAdapter {
    constructor(accountId: string, config: ImapConfig) {
        // Proton Bridge defaults: 127.0.0.1:1143, no TLS (STARTTLS via imapflow)
        // Legacy: if port 993 was stored (old default), correct to 1143
        const port = config.port === 993 ? 1143 : (config.port || 1143);
        const protonConfig: ImapConfig = {
            ...config,
            host: config.host || '127.0.0.1',
            port,
            tls: false,
        };
        super('proton', accountId, protonConfig);
    }
}

/**
 * Hover Mail adapter - standard IMAP
 */
export class HoverAdapter extends ImapAdapter {
    constructor(accountId: string, config: ImapConfig) {
        const hoverConfig: ImapConfig = {
            ...config,
            host: config.host || 'mail.hover.com',
            port: config.port || 993,
            tls: true,
        };
        super('hover', accountId, hoverConfig);
    }
}
