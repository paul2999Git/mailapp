import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/db';
import { requireAuth, AuthRequest } from '../middleware/auth.middleware';
import { errors } from '../middleware/errorHandler';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@mailhub/shared';

import { accountSyncService } from '../services/accountSync.service';
import { updateThreadStats } from '../services/threadHelper';

const router = Router();

router.use(requireAuth);

// GET /api/messages - List messages with filters
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const {
            accountId,
            folderId,
            category,
            isInbox,
            isUnread,
            isStarred,
            page = '1',
            pageSize = String(DEFAULT_PAGE_SIZE),
        } = req.query;

        const take = Math.min(parseInt(pageSize as string) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
        const skip = (parseInt(page as string) - 1) * take;

        const where: any = {
            account: { userId: authReq.user!.id },
            isHidden: false,
            neverShow: false,
        };

        if (accountId) where.accountId = accountId;
        if (folderId) where.currentFolderId = folderId;
        if (category) where.aiCategory = category;
        if (isUnread === 'true') where.isRead = false;
        if (isStarred === 'true') where.isStarred = true;

        if (isInbox === 'true') {
            // "Inbox" view shows messages that:
            // 1. Are in an inbox-type folder
            // 2. Haven't been manually or AI categorized (which acts as a move)
            where.aiCategory = null;
            // Filter by folderType 'inbox' which is set by all adapters
            where.currentFolder = {
                folderType: 'inbox'
            };
        }

        const [messages, total] = await Promise.all([
            prisma.message.findMany({
                where,
                select: {
                    id: true,
                    accountId: true,
                    threadId: true,
                    subject: true,
                    fromAddress: true,
                    fromName: true,
                    dateReceived: true,
                    bodyPreview: true,
                    hasAttachments: true,
                    isRead: true,
                    isStarred: true,
                    aiCategory: true,
                    aiConfidence: true,
                    account: {
                        select: { emailAddress: true, provider: true },
                    },
                },
                orderBy: { dateReceived: 'desc' },
                take,
                skip,
            }),
            prisma.message.count({ where }),
        ]);

        res.json({
            success: true,
            data: {
                items: messages,
                total,
                page: parseInt(page as string),
                pageSize: take,
                hasMore: skip + messages.length < total,
            },
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/messages/:id - Get single message with full content
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;

        const message = await prisma.message.findFirst({
            where: {
                id: req.params.id,
                account: { userId: authReq.user!.id },
            },
            include: {
                account: {
                    select: { emailAddress: true, provider: true },
                },
                classifications: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                },
                currentFolder: {
                    select: { id: true, name: true },
                },
            },
        });

        if (!message) {
            throw errors.notFound('Message');
        }

        res.json({
            success: true,
            data: message,
        });
    } catch (error) {
        next(error);
    }
});

// PATCH /api/messages/:id - Update message (read, starred, etc.)
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const { isRead, isStarred, isHidden, currentFolderId } = req.body;

        // First verify ownership
        const existing = await prisma.message.findFirst({
            where: {
                id: req.params.id,
                account: { userId: authReq.user!.id },
            },
        });

        if (!existing) {
            throw errors.notFound('Message');
        }

        const message = await prisma.message.update({
            where: { id: req.params.id },
            data: {
                ...(isRead !== undefined && { isRead }),
                ...(isStarred !== undefined && { isStarred }),
                ...(isHidden !== undefined && { isHidden }),
                ...(currentFolderId !== undefined && { currentFolderId }),
            },
            select: {
                id: true,
                accountId: true,
                providerMessageId: true,
                isRead: true,
                isStarred: true,
                isHidden: true,
                currentFolderId: true,
            },
        });

        // Sync with provider in background
        if (isRead !== undefined || isStarred !== undefined) {
            (async () => {
                const adapter = await accountSyncService.getAdapterForAccount(message.accountId);
                try {
                    if (isRead !== undefined) {
                        await adapter.markRead(message.providerMessageId, isRead);
                    }
                    if (isStarred !== undefined) {
                        await adapter.markStarred(message.providerMessageId, isStarred);
                    }
                } catch (err) {
                    console.error(`Failed to sync message ${message.id} update to provider:`, err);
                } finally {
                    await adapter.disconnect();
                }
            })();
        }

        res.json({
            success: true,
            data: message,
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/messages/:id/never-show - "Never show this again"
router.post('/:id/never-show', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;

        const existing = await prisma.message.findFirst({
            where: {
                id: req.params.id,
                account: { userId: authReq.user!.id },
            },
        });

        if (!existing) {
            throw errors.notFound('Message');
        }

        await prisma.message.update({
            where: { id: req.params.id },
            data: { neverShow: true },
        });

        res.json({
            success: true,
            data: { hidden: true },
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/messages/batch - Batch operations
router.post('/batch', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const { messageIds, action, data } = req.body;

        if (!Array.isArray(messageIds) || messageIds.length === 0) {
            throw errors.badRequest('messageIds must be a non-empty array');
        }

        // Verify ownership of all messages
        const count = await prisma.message.count({
            where: {
                id: { in: messageIds },
                account: { userId: authReq.user!.id },
            },
        });

        if (count !== messageIds.length) {
            throw errors.forbidden('Some messages not found or not owned');
        }

        // Fetch messages with account info for provider sync
        const targetedMessages = await prisma.message.findMany({
            where: { id: { in: messageIds } },
            include: { account: true }
        });

        // Group by account to reuse adapters
        const byAccount = targetedMessages.reduce((acc, msg) => {
            if (!acc[msg.accountId]) acc[msg.accountId] = [];
            acc[msg.accountId].push(msg);
            return acc;
        }, {} as Record<string, typeof targetedMessages>);

        let totalUpdated = 0;

        switch (action) {
            case 'markRead':
            case 'markUnread':
                const isRead = action === 'markRead';
                for (const [accountId, messages] of Object.entries(byAccount)) {
                    const adapter = await accountSyncService.getAdapterForAccount(accountId);
                    try {
                        for (const msg of messages) {
                            await adapter.markRead(msg.providerMessageId, isRead);
                        }
                    } finally {
                        await adapter.disconnect();
                    }
                }
                const readResult = await prisma.message.updateMany({
                    where: { id: { in: messageIds } },
                    data: { isRead },
                });
                totalUpdated = readResult.count;

                // Recalculate thread stats
                const threadIds = [...new Set(targetedMessages.map(m => m.threadId).filter(Boolean))] as string[];
                for (const tid of threadIds) {
                    await updateThreadStats(tid);
                }
                break;

            case 'delete':
                for (const [accountId, messages] of Object.entries(byAccount)) {
                    const adapter = await accountSyncService.getAdapterForAccount(accountId);
                    try {
                        for (const msg of messages) {
                            await adapter.moveToTrash(msg.providerMessageId);
                        }
                    } finally {
                        await adapter.disconnect();
                    }
                }
                const deleteResult = await prisma.message.updateMany({
                    where: { id: { in: messageIds } },
                    data: { isHidden: true },
                });
                totalUpdated = deleteResult.count;

                // Recalculate thread stats
                const deleteThreadIds = [...new Set(targetedMessages.map(m => m.threadId).filter(Boolean))] as string[];
                for (const tid of deleteThreadIds) {
                    await updateThreadStats(tid);
                }
                break;

            case 'move':
                if (!data?.folderId) {
                    throw errors.badRequest('folderId required for move action');
                }
                const targetFolder = await prisma.folder.findUnique({
                    where: { id: data.folderId },
                });
                if (!targetFolder) {
                    throw errors.notFound('Destination folder');
                }

                // Verify same account
                const accountIds = Object.keys(byAccount);
                if (accountIds.length > 1 || (accountIds.length === 1 && accountIds[0] !== targetFolder.accountId)) {
                    throw errors.badRequest('Cross-account moves are not supported');
                }

                for (const [accountId, messages] of Object.entries(byAccount)) {
                    const adapter = await accountSyncService.getAdapterForAccount(accountId);
                    try {
                        for (const msg of messages) {
                            await adapter.moveToFolder(msg.providerMessageId, targetFolder.providerFolderId);
                        }
                    } finally {
                        await adapter.disconnect();
                    }
                }
                const moveResult = await prisma.message.updateMany({
                    where: { id: { in: messageIds } },
                    data: { currentFolderId: data.folderId },
                });
                totalUpdated = moveResult.count;

                // Recalculate thread stats
                const moveThreadIds = [...new Set(targetedMessages.map(m => m.threadId).filter(Boolean))] as string[];
                for (const tid of moveThreadIds) {
                    await updateThreadStats(tid);
                }
                break;

            case 'archive':
                for (const [accountId, messages] of Object.entries(byAccount)) {
                    const adapter = await accountSyncService.getAdapterForAccount(accountId);
                    try {
                        for (const msg of messages) {
                            await adapter.archive(msg.providerMessageId);
                        }
                    } finally {
                        await adapter.disconnect();
                    }
                }
                const archiveResult = await prisma.message.updateMany({
                    where: { id: { in: messageIds } },
                    data: { isHidden: true },
                });
                totalUpdated = archiveResult.count;
                break;

            default:
                throw errors.badRequest('Invalid action');
        }

        res.json({
            success: true,
            data: { updated: totalUpdated },
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/messages/send - Send a new message or reply
router.post('/send', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const { accountId, to, cc, bcc, subject, body, inReplyTo } = req.body;

        if (!accountId || !to || !subject || !body) {
            throw errors.badRequest('accountId, to, subject, and body are required');
        }

        const account = await prisma.account.findFirst({
            where: {
                id: accountId,
                userId: authReq.user!.id,
            },
        });

        if (!account) {
            throw errors.notFound('Account');
        }

        // Get adapter and send
        const { decrypt } = await import('../lib/encryption.js');
        const { createProviderAdapter } = await import('../providers/index.js');

        let config: any;
        if (account.provider === 'gmail' || account.provider === 'zoho') {
            config = {
                type: 'oauth',
                accessToken: decrypt(account.accessTokenEncrypted!),
                refreshToken: decrypt(account.refreshTokenEncrypted!),
                expiresAt: account.tokenExpiresAt || new Date(),
            };
        } else {
            config = {
                type: 'imap',
                host: account.imapHost!,
                port: account.imapPort || 993,
                username: account.imapUsername!,
                password: decrypt(account.imapPasswordEncrypted!),
                tls: true,
            };
        }

        const adapter = createProviderAdapter(account.provider as any, account.id, config);

        await adapter.sendMail(
            to.split(',').map((email: string) => ({ email: email.trim() })),
            subject,
            body,
            {
                cc: cc ? cc.split(',').map((email: string) => ({ email: email.trim() })) : undefined,
                bcc: bcc ? bcc.split(',').map((email: string) => ({ email: email.trim() })) : undefined,
                inReplyTo,
            }
        );

        res.json({
            success: true,
            data: { sent: true },
        });
    } catch (error) {
        next(error);
    }
});

export default router;
