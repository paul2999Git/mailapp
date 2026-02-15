import axios from 'axios';
import type { EmailAddress } from '@mailhub/shared';
import type {
    IProviderAdapter,
    OAuthConfig,
    NormalizedMessage,
    NormalizedFolder,
    SyncResult,
} from './types';

/**
 * Zoho adapter using Zoho Mail API with OAuth 2.0
 */
export class ZohoAdapter implements IProviderAdapter {
    readonly provider = 'zoho' as const;
    private config: OAuthConfig;
    private accountId: string;
    private baseUrl = 'https://mail.zoho.com/api/v1';

    constructor(accountId: string, config: OAuthConfig) {
        this.accountId = accountId;
        this.config = config;
    }

    private async apiRequest(method: string, endpoint: string, data?: any) {
        const response = await axios({
            method,
            url: `${this.baseUrl}${endpoint}`,
            data,
            headers: {
                Authorization: `Bearer ${this.config.accessToken}`,
                'Content-Type': 'application/json',
            },
        });
        return response.data;
    }

    async testConnection(): Promise<{ success: boolean; error?: string }> {
        try {
            await this.apiRequest('GET', '/accounts');
            return { success: true };
        } catch (error: any) {
            return {
                success: false,
                error: error.response?.data?.message || error.message,
            };
        }
    }

    async fetchFolders(): Promise<NormalizedFolder[]> {
        const accounts = await this.apiRequest('GET', '/accounts');
        const accountId = accounts.data[0].accountId;
        const response = await this.apiRequest('GET', `/accounts/${accountId}/folders`);

        return response.data.map((folder: any) => ({
            providerFolderId: folder.folderId,
            name: folder.folderName,
            fullPath: folder.folderPath,
            folderType: this.mapFolderType(folder.folderName),
            isSystem: folder.isSystemFolder,
            messageCount: folder.totalCount,
            unreadCount: folder.unreadCount,
        }));
    }

    private mapFolderType(name: string): NormalizedFolder['folderType'] {
        const n = name.toLowerCase();
        if (n === 'inbox') return 'inbox';
        if (n === 'sent') return 'sent';
        if (n === 'drafts') return 'drafts';
        if (n === 'trash') return 'trash';
        if (n === 'spam') return 'spam';
        return 'custom';
    }

    async syncMessages(cursor?: string | null, folderId?: string | null, since?: Date): Promise<SyncResult> {
        const accounts = await this.apiRequest('GET', '/accounts');
        const zohoAccountId = accounts.data[0].accountId;

        let fid = folderId;
        if (!fid) {
            const folders = await this.fetchFolders();
            const inbox = folders.find(f => f.name.toLowerCase() === 'inbox');
            fid = inbox ? inbox.providerFolderId : 'inbox'; // Fallback but inbox should exist
        }

        const response = await this.apiRequest('GET', `/accounts/${zohoAccountId}/messages/view?folderId=${fid}`);
        let listMessages: any[] = response.data || [];

        if (since) {
            listMessages = listMessages.filter((msg: any) => {
                const receivedTime = Number(msg.receivedTime || msg.sentDateInGMT);
                return new Date(receivedTime) >= since;
            });
        }

        // The list endpoint doesn't include body content - fetch each message's content individually
        // Content endpoint requires folderId in the path: /folders/{folderId}/messages/{messageId}/content
        const messages: NormalizedMessage[] = [];
        for (const msg of listMessages) {
            const msgFolderId = msg.folderId || fid;
            try {
                const contentResponse = await this.apiRequest(
                    'GET',
                    `/accounts/${zohoAccountId}/folders/${msgFolderId}/messages/${msg.messageId}/content`
                );
                const content = contentResponse.data?.content || null;
                messages.push(this.normalizeMessage({ ...msg, content }));
            } catch (err: any) {
                console.error(`Failed to fetch Zoho message content for ${msg.messageId}:`, err.response?.status, err.response?.data || err.message);
                // Still include the message but without body content
                messages.push(this.normalizeMessage(msg));
            }
        }

        return {
            messages,
            folders: [],
            newCursor: null,
            hasMore: false,
            stats: {
                messagesProcessed: messages.length,
                messagesNew: messages.length,
                messagesUpdated: 0,
            },
        };
    }

    async fetchMessage(providerMessageId: string): Promise<NormalizedMessage | null> {
        const accounts = await this.apiRequest('GET', '/accounts');
        const zohoAccountId = accounts.data[0].accountId;

        // Find the inbox folderId (content endpoint requires it)
        const folders = await this.fetchFolders();
        const inbox = folders.find(f => f.name.toLowerCase() === 'inbox');
        const fid = inbox?.providerFolderId || 'inbox';

        // Get message body content using the folder-based endpoint
        try {
            const contentResponse = await this.apiRequest(
                'GET',
                `/accounts/${zohoAccountId}/folders/${fid}/messages/${providerMessageId}/content`
            );
            const content = contentResponse.data?.content || null;
            return this.normalizeMessage({
                messageId: providerMessageId,
                content,
            });
        } catch (err: any) {
            console.error(`Failed to fetch Zoho message content for ${providerMessageId}:`, err.response?.status, err.response?.data || err.message);
            return null;
        }
    }

    private normalizeMessage(msg: any): NormalizedMessage {
        const sentTime = Number(msg.sentDateInGMT || msg.receivedTime);
        const receivedTime = Number(msg.receivedTime || msg.sentDateInGMT);
        const content = msg.content || null;

        // Zoho content is HTML - extract plain text fallback by stripping tags
        const bodyText = content ? content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : null;

        return {
            providerMessageId: msg.messageId,
            messageIdHeader: msg.messageId,
            inReplyTo: null,
            referencesHeader: null,
            subject: msg.subject,
            from: { email: msg.sender, name: msg.fromName },
            to: (msg.toList || []).map((t: any) => ({ email: t.address, name: t.name })),
            cc: (msg.ccList || []).map((t: any) => ({ email: t.address, name: t.name })),
            bcc: (msg.bccList || []).map((t: any) => ({ email: t.address, name: t.name })),
            replyTo: null,
            dateSent: new Date(sentTime),
            dateReceived: new Date(receivedTime),
            bodyText: bodyText,
            bodyHtml: content,
            bodyPreview: msg.summary || (bodyText ? bodyText.substring(0, 500) : null),
            hasAttachments: msg.hasAttachment === '1',
            attachments: [],
            sizeBytes: msg.size ? parseInt(msg.size) : null,
            isRead: msg.status === '1',
            isStarred: msg.flagid === '1',
            isDraft: false,
            providerLabels: [],
            folderId: msg.folderId,
        };
    }

    async markRead(providerMessageId: string, isRead: boolean): Promise<void> {
        const accounts = await this.apiRequest('GET', '/accounts');
        const accountId = accounts.data[0].accountId;
        await this.apiRequest('PUT', `/accounts/${accountId}/messages/${providerMessageId}`, {
            status: isRead ? '1' : '0',
        });
    }

    async markStarred(providerMessageId: string, isStarred: boolean): Promise<void> {
        const accounts = await this.apiRequest('GET', '/accounts');
        const accountId = accounts.data[0].accountId;
        await this.apiRequest('PUT', `/accounts/${accountId}/messages/${providerMessageId}`, {
            flagged: isStarred ? '1' : '0',
        });
    }

    async moveToFolder(providerMessageId: string, folderId: string): Promise<void> {
        const accounts = await this.apiRequest('GET', '/accounts');
        const accountId = accounts.data[0].accountId;
        await this.apiRequest('PATCH', `/accounts/${accountId}/messages`, {
            messageIds: [providerMessageId],
            folderId,
            action: 'move',
        });
    }

    async moveToTrash(providerMessageId: string): Promise<void> {
        await this.moveToFolder(providerMessageId, 'trash');
    }

    async archive(providerMessageId: string): Promise<void> {
        await this.moveToFolder(providerMessageId, 'archive');
    }

    async createFolder(name: string): Promise<NormalizedFolder> {
        const accounts = await this.apiRequest('GET', '/accounts');
        const accountId = accounts.data[0].accountId;
        const response = await this.apiRequest('POST', `/accounts/${accountId}/folders`, {
            folderName: name,
        });

        const folder = response.data;
        return {
            providerFolderId: folder.folderId,
            name: folder.folderName,
            fullPath: folder.folderPath,
            folderType: this.mapFolderType(folder.folderName),
            isSystem: folder.isSystemFolder,
            messageCount: 0,
            unreadCount: 0,
        };
    }

    async saveDraft(to: EmailAddress[], subject: string, body: string, inReplyTo?: string): Promise<string> {
        const accounts = await this.apiRequest('GET', '/accounts');
        const accountId = accounts.data[0].accountId;
        const response = await this.apiRequest('POST', `/accounts/${accountId}/drafts`, {
            toList: to.map(a => a.email).join(','),
            subject,
            content: body,
        });
        return response.data.messageId;
    }

    async sendMail(to: EmailAddress[], subject: string, body: string, options?: { cc?: EmailAddress[], bcc?: EmailAddress[], inReplyTo?: string }): Promise<void> {
        const accounts = await this.apiRequest('GET', '/accounts');
        const accountId = accounts.data[0].accountId;
        await this.apiRequest('POST', `/accounts/${accountId}/messages`, {
            fromAddress: accounts.data[0].mailboxAddress,
            toAddress: to.map(a => a.email).join(','),
            ccAddress: options?.cc?.map(a => a.email).join(','),
            bccAddress: options?.bcc?.map(a => a.email).join(','),
            subject,
            content: body,
        });
    }

    async refreshTokens(): Promise<OAuthConfig | null> {
        try {
            const params = new URLSearchParams();
            params.append('refresh_token', this.config.refreshToken);
            params.append('client_id', process.env.ZOHO_CLIENT_ID || '');
            params.append('client_secret', process.env.ZOHO_CLIENT_SECRET || '');
            params.append('grant_type', 'refresh_token');

            const response = await axios.post('https://accounts.zoho.com/oauth/v2/token', params, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            });

            if (response.data.access_token) {
                return {
                    type: 'oauth',
                    accessToken: response.data.access_token,
                    refreshToken: this.config.refreshToken, // Zoho usually doesn't return a new refresh token
                    expiresAt: new Date(Date.now() + (response.data.expires_in || 3600) * 1000),
                };
            }
            throw new Error('Failed to refresh Zoho token');
        } catch (error: any) {
            console.error('Zoho token refresh failed:', error.response?.data || error.message);
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        // No persistent connection
    }
}
