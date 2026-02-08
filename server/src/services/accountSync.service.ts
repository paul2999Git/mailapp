import { prisma } from '../lib/db';
import { decrypt, encrypt } from '../lib/encryption';
import { createProviderAdapter, type IProviderAdapter, type ConnectionConfig } from '../providers';
import type { ProviderType } from '@mailhub/shared';

/**
 * Service for syncing email accounts with their providers
 */
export class AccountSyncService {
    /**
     * Create a provider adapter from a database account record
     */
    async getAdapterForAccount(accountId: string): Promise<IProviderAdapter> {
        const account = await prisma.account.findUnique({
            where: { id: accountId },
        });

        if (!account) {
            throw new Error(`Account ${accountId} not found`);
        }

        const config = this.buildConnectionConfig(account);
        return createProviderAdapter(account.provider, accountId, config);
    }

    /**
     * Build connection config from encrypted account data
     */
    private buildConnectionConfig(account: {
        provider: ProviderType;
        accessTokenEncrypted: Buffer | null;
        refreshTokenEncrypted: Buffer | null;
        tokenExpiresAt: Date | null;
        imapHost: string | null;
        imapPort: number | null;
        imapUsername: string | null;
        imapPasswordEncrypted: Buffer | null;
    }): ConnectionConfig {
        if (account.provider === 'gmail') {
            if (!account.accessTokenEncrypted || !account.refreshTokenEncrypted) {
                throw new Error('Gmail account missing OAuth tokens');
            }

            return {
                type: 'oauth',
                accessToken: decrypt(account.accessTokenEncrypted),
                refreshToken: decrypt(account.refreshTokenEncrypted),
                expiresAt: account.tokenExpiresAt || new Date(),
            };
        }

        // IMAP providers (Proton, Hover, Zoho)
        if (!account.imapHost || !account.imapUsername || !account.imapPasswordEncrypted) {
            throw new Error(`${account.provider} account missing IMAP credentials`);
        }

        return {
            type: 'imap',
            host: account.imapHost,
            port: account.imapPort || 993,
            username: account.imapUsername,
            password: decrypt(account.imapPasswordEncrypted),
            tls: account.provider !== 'proton',
        };
    }

    /**
     * Sync messages from a provider account
     */
    async syncAccount(accountId: string): Promise<{
        messagesNew: number;
        messagesUpdated: number;
        foldersUpdated: number;
    }> {
        const account = await prisma.account.findUnique({
            where: { id: accountId },
        });

        if (!account) {
            throw new Error(`Account ${accountId} not found`);
        }

        const adapter = await this.getAdapterForAccount(accountId);

        try {
            // Test connection first
            const connectionTest = await adapter.testConnection();
            if (!connectionTest.success) {
                throw new Error(`Connection failed: ${connectionTest.error}`);
            }

            // Sync folders first
            const folders = await adapter.fetchFolders();
            let foldersUpdated = 0;

            for (const folder of folders) {
                await prisma.folder.upsert({
                    where: {
                        accountId_providerFolderId: {
                            accountId,
                            providerFolderId: folder.providerFolderId,
                        },
                    },
                    create: {
                        accountId,
                        providerFolderId: folder.providerFolderId,
                        name: folder.name,
                        fullPath: folder.fullPath,
                        folderType: folder.folderType,
                        isSystem: folder.isSystem,
                        messageCount: folder.messageCount,
                        unreadCount: folder.unreadCount,
                    },
                    update: {
                        name: folder.name,
                        messageCount: folder.messageCount,
                        unreadCount: folder.unreadCount,
                    },
                });
                foldersUpdated++;
            }

            // Sync messages
            const syncResult = await adapter.syncMessages(account.syncCursor);
            let messagesNew = 0;
            let messagesUpdated = 0;

            for (const msg of syncResult.messages) {
                const existing = await prisma.message.findUnique({
                    where: {
                        accountId_providerMessageId: {
                            accountId,
                            providerMessageId: msg.providerMessageId,
                        },
                    },
                });

                if (existing) {
                    await prisma.message.update({
                        where: { id: existing.id },
                        data: {
                            isRead: msg.isRead,
                            isStarred: msg.isStarred,
                            providerLabels: msg.providerLabels,
                        },
                    });
                    messagesUpdated++;
                } else {
                    await prisma.message.create({
                        data: {
                            accountId,
                            providerMessageId: msg.providerMessageId,
                            messageIdHeader: msg.messageIdHeader,
                            inReplyTo: msg.inReplyTo,
                            referencesHeader: msg.referencesHeader,
                            subject: msg.subject,
                            fromAddress: msg.from.email,
                            fromName: msg.from.name,
                            toAddresses: JSON.parse(JSON.stringify(msg.to)),
                            ccAddresses: JSON.parse(JSON.stringify(msg.cc)),
                            bccAddresses: JSON.parse(JSON.stringify(msg.bcc)),
                            dateSent: msg.dateSent,
                            dateReceived: msg.dateReceived,
                            bodyText: msg.bodyText,
                            bodyHtml: msg.bodyHtml,
                            bodyPreview: msg.bodyPreview,
                            hasAttachments: msg.hasAttachments,
                            attachmentMetadata: JSON.parse(JSON.stringify(msg.attachments)),
                            sizeBytes: msg.sizeBytes,
                            isRead: msg.isRead,
                            isStarred: msg.isStarred,
                            isDraft: msg.isDraft,
                            providerLabels: msg.providerLabels,
                        },
                    });
                    messagesNew++;
                }
            }

            // Update sync cursor
            await prisma.account.update({
                where: { id: accountId },
                data: {
                    syncCursor: syncResult.newCursor,
                    lastSyncAt: new Date(),
                },
            });

            return { messagesNew, messagesUpdated, foldersUpdated };
        } finally {
            await adapter.disconnect();
        }
    }

    /**
     * Test connection for an account
     */
    async testConnection(accountId: string): Promise<{ success: boolean; error?: string }> {
        try {
            const adapter = await this.getAdapterForAccount(accountId);
            const result = await adapter.testConnection();
            await adapter.disconnect();
            return result;
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    /**
     * Refresh OAuth tokens for an account
     */
    async refreshTokens(accountId: string): Promise<boolean> {
        const account = await prisma.account.findUnique({
            where: { id: accountId },
        });

        if (!account || account.provider !== 'gmail') {
            return false;
        }

        const adapter = await this.getAdapterForAccount(accountId);

        try {
            if (adapter.refreshTokens) {
                const newConfig = await adapter.refreshTokens();

                if (newConfig) {
                    await prisma.account.update({
                        where: { id: accountId },
                        data: {
                            accessTokenEncrypted: encrypt(newConfig.accessToken),
                            refreshTokenEncrypted: encrypt(newConfig.refreshToken),
                            tokenExpiresAt: newConfig.expiresAt,
                        },
                    });
                    return true;
                }
            }
            return false;
        } finally {
            await adapter.disconnect();
        }
    }
}

// Singleton instance
export const accountSyncService = new AccountSyncService();
