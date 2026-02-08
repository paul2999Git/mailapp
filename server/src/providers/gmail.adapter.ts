import { google, gmail_v1 } from 'googleapis';
import type { EmailAddress } from '@mailhub/shared';
import type {
    IProviderAdapter,
    OAuthConfig,
    NormalizedMessage,
    NormalizedFolder,
    SyncResult,
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

    async syncMessages(cursor?: string | null, folderId?: string | null): Promise<SyncResult> {
        const messages: NormalizedMessage[] = [];
        const labelId = folderId || 'INBOX';

        // List messages with pagination
        const listResponse = await this.gmail.users.messages.list({
            userId: 'me',
            labelIds: [labelId],
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

            return this.normalizeMessage(msg);
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

            bodyText,
            bodyHtml,
            bodyPreview: msg.snippet || bodyText.substring(0, 500),

            hasAttachments: this.hasAttachments(msg.payload!),
            attachments: this.extractAttachments(msg.payload!),
            sizeBytes: msg.sizeEstimate || null,

            isRead,
            isStarred,
            isDraft,

            providerLabels: labels,
            folderId: labels[0] || null,
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

    private extractAttachments(payload: gmail_v1.Schema$MessagePart): Array<{ name: string; size: number; mimeType: string }> {
        const attachments: Array<{ name: string; size: number; mimeType: string }> = [];

        const extractFromPart = (part: gmail_v1.Schema$MessagePart) => {
            if (part.filename && part.filename.length > 0) {
                attachments.push({
                    name: part.filename,
                    size: part.body?.size || 0,
                    mimeType: part.mimeType || 'application/octet-stream',
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

        // Simple email parsing - handles "Name <email>" and plain email formats
        const addresses: EmailAddress[] = [];
        const parts = header.split(',');

        for (const part of parts) {
            const match = part.trim().match(/^(?:"?([^"<]*)"?\s*)?<?([^>]+@[^>]+)>?$/);
            if (match) {
                addresses.push({
                    email: match[2].trim(),
                    name: match[1]?.trim() || undefined,
                });
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
        await this.gmail.users.messages.modify({
            userId: 'me',
            id: providerMessageId,
            requestBody: {
                addLabelIds: [folderId],
                removeLabelIds: ['INBOX'],
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
