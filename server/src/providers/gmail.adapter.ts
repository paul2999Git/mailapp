import { google, gmail_v1 } from 'googleapis';
import type { EmailAddress } from '@mailhub/shared';
import type {
    IProviderAdapter,
    OAuthConfig,
    NormalizedMessage,
    NormalizedFolder,
    SyncResult,
    Attachment,
} from './types';

/**
 * Gmail adapter using Google API with OAuth 2.0
 */
export class GmailAdapter implements IProviderAdapter {
    readonly provider = 'gmail' as const;
    private gmail: gmail_v1.Gmail;
    private oauth2Client: any;
    private config: OAuthConfig;
    private accountId: string;

    constructor(accountId: string, config: OAuthConfig) {
        this.accountId = accountId;
        this.config = config;

        this.oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            `${process.env.FRONTEND_URL}/auth/google/callback`
        );

        this.oauth2Client.setCredentials({
            access_token: config.accessToken,
            refresh_token: config.refreshToken,
            expiry_date: config.expiresAt.getTime(),
        });

        this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
    }

    async testConnection(): Promise<{ success: boolean; error?: string }> {
        try {
            await this.gmail.users.getProfile({ userId: 'me' });
            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Connection failed',
            };
        }
    }

    async fetchFolders(): Promise<NormalizedFolder[]> {
        const response = await this.gmail.users.labels.list({ userId: 'me' });
        const labels = response.data.labels || [];

        const folders: NormalizedFolder[] = [];

        for (const label of labels) {
            if (!label.id) continue;

            // Get label details for counts
            const details = await this.gmail.users.labels.get({
                userId: 'me',
                id: label.id,
            });

            folders.push({
                providerFolderId: label.id,
                name: label.name || label.id,
                fullPath: label.name || label.id,
                folderType: this.mapLabelType(label.id),
                isSystem: label.type === 'system',
                messageCount: details.data.messagesTotal || 0,
                unreadCount: details.data.messagesUnread || 0,
            });
        }

        // Add virtual "Notifications" folder
        folders.push({
            providerFolderId: 'NOTIFICATIONS',
            name: 'Notifications',
            fullPath: 'Notifications',
            folderType: 'custom',
            isSystem: true,
            messageCount: 0,
            unreadCount: 0,
        });

        return folders;
    }

    private mapLabelType(labelId: string): NormalizedFolder['folderType'] {
        switch (labelId) {
            case 'INBOX': return 'inbox';
            case 'SENT': return 'sent';
            case 'DRAFT': return 'drafts';
            case 'TRASH': return 'trash';
            case 'SPAM': return 'spam';
            default: return 'custom';
        }
    }

    async syncMessages(cursor?: string | null, folderId?: string | null, since?: Date): Promise<SyncResult> {
        const messages: NormalizedMessage[] = [];
        const labelId = folderId || 'INBOX';

        let query = '';
        if (since) {
            const formattedDate = since.toISOString().split('T')[0].replace(/-/g, '/');
            query = `after:${formattedDate}`;
        }

        // Ensure we only fetch Primary and Updates categories if syncing INBOX
        let fullQuery = query;
        if (labelId === 'INBOX') {
            const categoryQuery = '{category:primary category:updates}';
            fullQuery = query ? `${query} ${categoryQuery}` : categoryQuery;
        }

        // List messages with pagination
        const listResponse = await this.gmail.users.messages.list({
            userId: 'me',
            labelIds: [labelId],
            q: fullQuery || undefined,
            maxResults: 100,
            pageToken: cursor || undefined,
        });

        const messageIds = listResponse.data.messages || [];

        // Fetch each message
        for (const msgRef of messageIds) {
            if (!msgRef.id) continue;

            const msg = await this.fetchMessage(msgRef.id);
            if (msg) messages.push(msg);
        }

        return {
            messages,
            folders: [],
            newCursor: listResponse.data.nextPageToken || null,
            hasMore: !!listResponse.data.nextPageToken,
            stats: {
                messagesProcessed: messages.length,
                messagesNew: messages.length,
                messagesUpdated: 0,
            },
        };
    }

    async fetchMessage(providerMessageId: string): Promise<NormalizedMessage | null> {
        try {
            const response = await this.gmail.users.messages.get({
                userId: 'me',
                id: providerMessageId,
                format: 'full',
            });

            const msg = response.data;
            if (!msg.payload) return null;

            const normalized = this.normalizeMessage(msg);

            // Fetch attachment contents for single message fetch
            if (normalized.hasAttachments) {
                normalized.fullAttachments = [];
                for (const att of normalized.attachments) {
                    if (att.providerPartId) {
                        try {
                            const { content } = await this.fetchAttachment(providerMessageId, att.providerPartId);
                            normalized.fullAttachments.push({
                                ...att,
                                content
                            });
                        } catch (err) {
                            console.error(`Failed to fetch attachment ${att.name} for message ${providerMessageId}:`, err);
                        }
                    }
                }
            }

            return normalized;
        } catch (error) {
            console.error(`Failed to fetch message ${providerMessageId}:`, error);
            return null;
        }
    }

    private normalizeMessage(msg: gmail_v1.Schema$Message): NormalizedMessage {
        const headers = msg.payload?.headers || [];
        const getHeader = (name: string) =>
            headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || null;

        // Extract body
        let bodyText = '';
        let bodyHtml = '';
        this.extractBody(msg.payload!, (text, html) => {
            bodyText = text;
            bodyHtml = html;
        });

        // Parse addresses
        const from = this.parseAddressHeader(getHeader('From'))[0] || { email: 'unknown@unknown.com' };
        const to = this.parseAddressHeader(getHeader('To'));
        const cc = this.parseAddressHeader(getHeader('Cc'));
        const bcc = this.parseAddressHeader(getHeader('Bcc'));

        // Check flags
        const labels = msg.labelIds || [];
        const isRead = !labels.includes('UNREAD');
        const isStarred = labels.includes('STARRED');
        const isDraft = labels.includes('DRAFT');

        return {
            providerMessageId: msg.id!,
            messageIdHeader: getHeader('Message-ID'),
            inReplyTo: getHeader('In-Reply-To'),
            referencesHeader: getHeader('References'),

            subject: getHeader('Subject'),
            from,
            to,
            cc,
            bcc,
            replyTo: getHeader('Reply-To'),

            dateSent: getHeader('Date') ? new Date(getHeader('Date')!) : null,
            dateReceived: new Date(parseInt(msg.internalDate || '0', 10)),

            bodyText: bodyText || null,
            bodyHtml: bodyHtml || null,
            bodyPreview: msg.snippet || bodyText.substring(0, 500) || null,

            hasAttachments: this.hasAttachments(msg.payload!),
            attachments: this.extractAttachments(msg.payload!),
            sizeBytes: msg.sizeEstimate || null,

            isRead,
            isStarred,
            isDraft,

            providerLabels: labels,
            folderId: labels.includes('CATEGORY_UPDATES') ? 'NOTIFICATIONS' : (labels.includes('INBOX') ? 'INBOX' : (labels[0] || null)),
        };
    }

    private extractBody(payload: gmail_v1.Schema$MessagePart, callback: (text: string, html: string) => void) {
        let text = '';
        let html = '';

        const extractFromPart = (part: gmail_v1.Schema$MessagePart) => {
            if (part.body?.data) {
                const decoded = Buffer.from(part.body.data, 'base64url').toString('utf8');
                if (part.mimeType === 'text/plain') text = decoded;
                if (part.mimeType === 'text/html') html = decoded;
            }

            if (part.parts) {
                for (const subPart of part.parts) {
                    extractFromPart(subPart);
                }
            }
        };

        extractFromPart(payload);
        callback(text, html);
    }

    private hasAttachments(payload: gmail_v1.Schema$MessagePart): boolean {
        const checkPart = (part: gmail_v1.Schema$MessagePart): boolean => {
            if (part.filename && part.filename.length > 0) return true;
            if (part.parts) {
                return part.parts.some(checkPart);
            }
            return false;
        };
        return checkPart(payload);
    }

    private extractAttachments(payload: gmail_v1.Schema$MessagePart): Array<{ name: string; size: number; mimeType: string; providerPartId?: string }> {
        const attachments: Array<{ name: string; size: number; mimeType: string; providerPartId?: string }> = [];

        const extractFromPart = (part: gmail_v1.Schema$MessagePart) => {
            if (part.filename && part.filename.length > 0) {
                attachments.push({
                    name: part.filename,
                    size: part.body?.size || 0,
                    mimeType: part.mimeType || 'application/octet-stream',
                    providerPartId: part.body?.attachmentId || undefined,
                });
            }

            if (part.parts) {
                for (const subPart of part.parts) {
                    extractFromPart(subPart);
                }
            }
        };

        extractFromPart(payload);
        return attachments;
    }

    private parseAddressHeader(header: string | null): EmailAddress[] {
        if (!header) return [];

        const addresses: EmailAddress[] = [];
        // Note: Simple split by comma. This may fail if names contain commas,
        // but matches the previous implementation's behavior.
        const parts = header.split(',');

        for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed) continue;

            // 1. Try formatted "Name <email@domain.com>"
            const bracketMatch = trimmed.match(/^(?:"?([^"]*)"?\s*)?<([^>]+@[^>]+)>$/);
            if (bracketMatch) {
                addresses.push({
                    email: bracketMatch[2].trim(),
                    name: bracketMatch[1]?.trim() || undefined,
                });
            } else {
                // 2. Try plain "email@domain.com"
                const emailMatch = trimmed.match(/^([^> \t]+@[^> \t]+)$/);
                if (emailMatch) {
                    addresses.push({
                        email: emailMatch[1].trim(),
                    });
                } else if (trimmed.includes('@')) {
                    // Fallback for anything that looks like an email but doesn't fit the strict regex
                    addresses.push({ email: trimmed });
                }
            }
        }

        return addresses;
    }

    async markRead(providerMessageId: string, isRead: boolean): Promise<void> {
        if (isRead) {
            await this.gmail.users.messages.modify({
                userId: 'me',
                id: providerMessageId,
                requestBody: {
                    removeLabelIds: ['UNREAD'],
                },
            });
        } else {
            await this.gmail.users.messages.modify({
                userId: 'me',
                id: providerMessageId,
                requestBody: {
                    addLabelIds: ['UNREAD'],
                },
            });
        }
    }

    async fetchAttachment(providerMessageId: string, attachmentId: string): Promise<{ content: Buffer, contentType: string }> {
        const response = await this.gmail.users.messages.attachments.get({
            userId: 'me',
            messageId: providerMessageId,
            id: attachmentId,
        });

        const data = response.data.data;
        if (!data) throw new Error('Attachment data not found');

        return {
            content: Buffer.from(data, 'base64url'),
            contentType: 'application/octet-stream', // Fallback, usually get from part metadata
        };
    }

    async markStarred(providerMessageId: string, isStarred: boolean): Promise<void> {
        if (isStarred) {
            await this.gmail.users.messages.modify({
                userId: 'me',
                id: providerMessageId,
                requestBody: {
                    addLabelIds: ['STARRED'],
                },
            });
        } else {
            await this.gmail.users.messages.modify({
                userId: 'me',
                id: providerMessageId,
                requestBody: {
                    removeLabelIds: ['STARRED'],
                },
            });
        }
    }

    async moveToFolder(providerMessageId: string, folderId: string): Promise<void> {
        // For Gmail, moving means changing labels
        // Map our virtual folder ID back to Gmail's system label
        const gmailLabelId = folderId === 'NOTIFICATIONS' ? 'CATEGORY_UPDATES' : folderId;

        // When moving to a custom label, remove INBOX and all category labels
        // so the message doesn't linger in inbox tabs on the provider
        const removeLabels = ['INBOX', 'CATEGORY_UPDATES', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS'];

        await this.gmail.users.messages.modify({
            userId: 'me',
            id: providerMessageId,
            requestBody: {
                addLabelIds: [gmailLabelId],
                removeLabelIds: removeLabels.filter(l => l !== gmailLabelId),
            },
        });
    }

    async moveToTrash(providerMessageId: string): Promise<void> {
        await this.gmail.users.messages.trash({
            userId: 'me',
            id: providerMessageId,
        });
    }

    async archive(providerMessageId: string): Promise<void> {
        await this.gmail.users.messages.modify({
            userId: 'me',
            id: providerMessageId,
            requestBody: {
                removeLabelIds: ['INBOX'],
            },
        });
    }

    async createFolder(name: string): Promise<NormalizedFolder> {
        const response = await this.gmail.users.labels.create({
            userId: 'me',
            requestBody: {
                name,
                labelListVisibility: 'labelShow',
                messageListVisibility: 'show',
            },
        });

        const label = response.data;
        return {
            providerFolderId: label.id!,
            name: label.name!,
            fullPath: label.name!,
            folderType: this.mapLabelType(label.id!),
            isSystem: label.type === 'system',
            messageCount: 0,
            unreadCount: 0,
        };
    }

    async saveDraft(to: EmailAddress[], subject: string, body: string, inReplyTo?: string): Promise<string> {
        const rawMessage = [
            `To: ${to.map(a => a.name ? `${a.name} <${a.email}>` : a.email).join(', ')}`,
            `Subject: ${subject}`,
            inReplyTo ? `In-Reply-To: ${inReplyTo}` : '',
            'Content-Type: text/plain; charset=utf-8',
            '',
            body,
        ].filter(Boolean).join('\r\n');

        const encodedMessage = Buffer.from(rawMessage).toString('base64url');

        const response = await this.gmail.users.drafts.create({
            userId: 'me',
            requestBody: {
                message: {
                    raw: encodedMessage,
                },
            },
        });

        return response.data.id || 'draft';
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
        const mail = require('nodemailer/lib/mailer');

        const mailOptions = {
            from: 'me', // Gmail ignores this and uses the authenticated user
            to: to.map(a => a.name ? `${a.name} <${a.email}>` : a.email).join(', '),
            cc: options?.cc?.map(a => a.name ? `${a.name} <${a.email}>` : a.email).join(', '),
            bcc: options?.bcc?.map(a => a.name ? `${a.name} <${a.email}>` : a.email).join(', '),
            subject: subject,
            text: body,
            inReplyTo: options?.inReplyTo,
            references: options?.inReplyTo ? [options.inReplyTo] : undefined,
            attachments: options?.attachments?.map(a => ({
                filename: a.name,
                content: a.content,
                contentType: a.mimeType
            }))
        };

        // Generating RFC822 message
        const MailComposer = require('nodemailer/lib/mail-composer');
        const composer = new MailComposer(mailOptions);
        const message = await composer.compile().build();
        const encodedMessage = Buffer.from(message).toString('base64url');

        await this.gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedMessage,
            },
        });
    }
    async refreshTokens(): Promise<OAuthConfig | null> {
        try {
            const { credentials } = await this.oauth2Client.refreshAccessToken();

            return {
                type: 'oauth',
                accessToken: credentials.access_token!,
                refreshToken: credentials.refresh_token || this.config.refreshToken,
                expiresAt: new Date(credentials.expiry_date!),
            };
        } catch (error) {
            console.error('Failed to refresh Gmail tokens:', error);
            return null;
        }
    }

    async disconnect(): Promise<void> {
        // No persistent connection for Gmail API
    }
}
