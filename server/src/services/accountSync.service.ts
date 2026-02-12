import { prisma } from '../lib/db';
import { decrypt, encrypt } from '../lib/encryption';
import { createProviderAdapter, type IProviderAdapter, type ConnectionConfig } from '../providers';
import type { ProviderType } from '@mailhub/shared';
import { findOrCreateThread } from './threadHelper';
import { classificationQueue } from '../lib/queues';

/**
 * Service for syncing email accounts with their providers
 */
export class AccountSyncService {
    /**
     * Get the provider adapter for an account
     */
    public async getAdapterForAccount(accountId: string): Promise<IProviderAdapter> {
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            include: { user: true },
        });

        if (!account) {
            throw new Error(`Account not found: ${accountId}`);
        }

        const config = await this.getConnectionConfig(account);
        return createProviderAdapter(account.provider as ProviderType, accountId, config);
    }

    /**
     * Build connection config from account credentials
     */
    private async getConnectionConfig(account: any): Promise<ConnectionConfig> {
        if (account.provider === 'gmail' || account.provider === 'zoho') {
            if (!account.accessTokenEncrypted || !account.refreshTokenEncrypted) {
                throw new Error(`${account.provider} account ${account.id} missing OAuth tokens`);
            }

            return {
                type: 'oauth',
                accessToken: decrypt(account.accessTokenEncrypted),
                refreshToken: decrypt(account.refreshTokenEncrypted),
                expiresAt: account.tokenExpiresAt || new Date(),
            };
        }

        // IMAP providers
        if (!account.imapHost || !account.imapPort || !account.imapUsername || !account.imapPasswordEncrypted) {
            throw new Error(`IMAP account ${account.id} missing connection details`);
        }

        return {
            type: 'imap',
            host: account.imapHost,
            port: account.imapPort,
            username: account.imapUsername, // Username usually isn't encrypted in schema
            password: decrypt(account.imapPasswordEncrypted),
            tls: account.provider !== 'proton', // Proton Bridge uses STARTTLS, not implicit TLS
        };
    }

    /**
     * Sync an account - fetch folders and messages
     */
    async syncAccount(accountId: string): Promise<{
        messagesNew: number;
        messagesUpdated: number;
        foldersUpdated: number;
    }> {
        // Refresh tokens if needed before starting sync
        await this.refreshTokensIfNeeded(accountId);

        const adapter = await this.getAdapterForAccount(accountId);

        try {
            return await this.performSync(accountId, adapter);
        } catch (error: any) {
            // If it's an auth error, try refreshing once
            const isAuthError = error.message.includes('401') ||
                error.message.includes('unauthorized') ||
                error.message.includes('Auth') ||
                error.message.includes('token');

            if (isAuthError) {
                console.log(`Auth error detected during sync for ${accountId}, attempting forced refresh...`);
                await this.refreshTokensIfNeeded(accountId, true); // true = force

                // Get fresh adapter with new tokens
                await adapter.disconnect();
                const newAdapter = await this.getAdapterForAccount(accountId);
                try {
                    return await this.performSync(accountId, newAdapter);
                } finally {
                    await newAdapter.disconnect();
                }
            }
            throw error;
        } finally {
            await adapter.disconnect();
        }
    }

    /**
     * Internal sync logic to allow retries
     */
    private async performSync(accountId: string, adapter: IProviderAdapter) {
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            include: { user: true },
        });

        if (!account) {
            throw new Error(`Account ${accountId} not found`);
        }

        let messagesNew = 0;
        let messagesUpdated = 0;
        let foldersUpdated = 0;

        // Test connection
        const test = await adapter.testConnection();
        if (!test.success) {
            throw new Error(`Connection test failed: ${test.error}`);
        }

        // Sync folders
        const folders = await adapter.fetchFolders();
        for (const folder of folders) {
            const existing = await prisma.folder.findFirst({
                where: {
                    accountId,
                    providerFolderId: folder.providerFolderId,
                },
            });

            if (existing) {
                await prisma.folder.update({
                    where: { id: existing.id },
                    data: {
                        messageCount: folder.messageCount,
                        unreadCount: folder.unreadCount,
                    },
                });
            } else {
                await prisma.folder.create({
                    data: {
                        accountId,
                        providerFolderId: folder.providerFolderId,
                        name: folder.name,
                        fullPath: folder.fullPath,
                        folderType: folder.folderType,
                        isSystem: folder.isSystem,
                        messageCount: folder.messageCount,
                        unreadCount: folder.unreadCount,
                    },
                });
                foldersUpdated++;
            }
        }

        // Fetch all folders for this account to resolve local folder IDs
        const accountFolders = await prisma.folder.findMany({
            where: { accountId },
        });

        const folderMap = new Map(accountFolders.map(f => [f.providerFolderId, f.id]));

        // Sync messages - only past 14 days
        const fourteenDaysAgo = new Date();
        fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

        const syncResult = await adapter.syncMessages(account.syncCursor, null, fourteenDaysAgo);

        for (const msg of syncResult.messages) {
            const currentFolderId = msg.folderId ? folderMap.get(msg.folderId) : null;

            const existing = await prisma.message.findUnique({
                where: {
                    accountId_providerMessageId: {
                        accountId,
                        providerMessageId: msg.providerMessageId,
                    },
                },
            });

            if (existing) {
                // If the message was updated very recently (e.g. within last 2 minutes),
                // it might be because of a local action that hasn't synced to provider yet.
                // We should avoid overwriting isRead, isStarred, and currentFolderId if the local updated timestamp is recent.
                const recentThreshold = 2 * 60 * 1000; // 2 minutes
                const isRecent = (Date.now() - existing.updatedAt.getTime()) < recentThreshold;

                if (!isRecent || !existing.currentFolderId) {
                    await prisma.message.update({
                        where: { id: existing.id },
                        data: {
                            isRead: msg.isRead,
                            isStarred: msg.isStarred,
                            providerLabels: msg.providerLabels,
                            currentFolderId: currentFolderId || undefined,
                            // Backfill body if missing
                            bodyText: existing.bodyText ? undefined : msg.bodyText,
                            bodyHtml: existing.bodyHtml ? undefined : msg.bodyHtml,
                        },
                    });

                    // Dynamic import to avoid circular dependency if needed, or just import at top if it's safe
                    const { updateThreadStats } = await import('./threadHelper.js');
                    if (existing.threadId) {
                        await updateThreadStats(existing.threadId);
                    }

                    messagesUpdated++;
                } else {
                    console.log(`⏳ Skipping status overwrite for recently updated message: ${existing.providerMessageId}`);
                    // Still update labels or non-volatile info if needed
                    await prisma.message.update({
                        where: { id: existing.id },
                        data: {
                            providerLabels: msg.providerLabels,
                            // Backfill body if missing even if recent
                            bodyText: existing.bodyText ? undefined : msg.bodyText,
                            bodyHtml: existing.bodyHtml ? undefined : msg.bodyHtml,
                        },
                    });
                }
            } else {
                if (msg.dateReceived < fourteenDaysAgo) continue;

                const thread = await findOrCreateThread(accountId, account.userId, msg);

                const newMessage = await prisma.message.create({
                    data: {
                        accountId,
                        threadId: thread.id,
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
                        currentFolderId: currentFolderId,
                    },
                });

                // Trigger AI classification
                await classificationQueue.add('classify-message', {
                    messageId: newMessage.id
                }, {
                    removeOnComplete: true,
                    removeOnFail: 1000,
                });

                messagesNew++;
            }
        }

        // Cleanup local messages
        const cleanup = await prisma.message.deleteMany({
            where: {
                accountId,
                dateReceived: { lt: fourteenDaysAgo },
                isStarred: false,
                isDraft: false,
            }
        });
        console.log(`Cleaned up ${cleanup.count} old messages for account ${accountId}`);

        // Update cursor
        await prisma.account.update({
            where: { id: accountId },
            data: {
                syncCursor: syncResult.newCursor,
                lastSyncAt: new Date(),
            },
        });

        return { messagesNew, messagesUpdated, foldersUpdated };
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
     * Refresh OAuth tokens if needed
     */
    async refreshTokensIfNeeded(accountId: string, force = false): Promise<boolean> {
        const account = await prisma.account.findUnique({
            where: { id: accountId },
        });

        if (!account || !account.tokenExpiresAt) {
            return false;
        }

        const expiresIn = account.tokenExpiresAt.getTime() - Date.now();
        if (!force && expiresIn > 5 * 60 * 1000) {
            return false;
        }

        try {
            const adapter = await this.getAdapterForAccount(accountId);

            if (adapter.refreshTokens) {
                const newConfig = await adapter.refreshTokens();
                if (newConfig && newConfig.type === 'oauth') {
                    await prisma.account.update({
                        where: { id: accountId },
                        data: {
                            accessTokenEncrypted: encrypt(newConfig.accessToken),
                            refreshTokenEncrypted: encrypt(newConfig.refreshToken),
                            tokenExpiresAt: newConfig.expiresAt,
                        },
                    });
                    await adapter.disconnect();
                    return true;
                }
            }
            await adapter.disconnect();
            return false;
        } catch (error) {
            console.error(`Token refresh failed for account ${accountId}:`, error);
            return false;
        }
    }
}

export const accountSyncService = new AccountSyncService();
