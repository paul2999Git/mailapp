import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/db';
import { requireAuth, AuthRequest } from '../middleware/auth.middleware';
import { errors } from '../middleware/errorHandler';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@mailhub/shared';
import { accountSyncService } from '../services/accountSync.service';
import { updateThreadStats } from '../services/threadHelper';

const router = Router();

router.use(requireAuth);

// GET /api/threads - List threads
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const {
            category,
            accountId,
            folderId,
            isInbox,
            isUnread,
            isStarred,
            page = '1',
            pageSize = String(DEFAULT_PAGE_SIZE),
        } = req.query;

        console.log('🔍 Thread Request Query:', { category, accountId, folderId, isInbox, isUnread, isStarred });

        const take = Math.min(parseInt(pageSize as string) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
        const skip = (parseInt(page as string) - 1) * take;

        const where: any = {
            userId: authReq.user!.id,
        };
        if (accountId) where.accountIds = { has: accountId as string };
        if (isUnread === 'true') where.unreadCount = { gt: 0 };

        // Complex message-based filters
        const messageFilters: any = {};
        // Always filter out hidden/deleted messages unless specified
        messageFilters.isHidden = false;
        messageFilters.neverShow = false;

        if (category) messageFilters.aiCategory = category as string;
        if (isUnread === 'true') messageFilters.isRead = false;
        if (isStarred === 'true') messageFilters.isStarred = true;
        if (folderId) messageFilters.currentFolderId = folderId as string;
        if (isInbox === 'true') {
            messageFilters.aiCategory = null;
            messageFilters.currentFolder = { folderType: 'inbox' };
        }

        if (Object.keys(messageFilters).length > 0) {
            where.messages = { some: messageFilters };
        }

        console.log('🏗️ Thread Final Where:', JSON.stringify(where, null, 2));

        const [threads, total] = await Promise.all([
            prisma.thread.findMany({
                where,
                select: {
                    id: true,
                    subjectNormalized: true,
                    participantEmails: true,
                    lastMessageDate: true,
                    messageCount: true,
                    unreadCount: true,
                    hasAttachments: true,
                    primaryCategory: true,
                    messages: {
                        select: {
                            id: true,
                            fromName: true,
                            fromAddress: true,
                            bodyPreview: true,
                            account: {
                                select: { emailAddress: true },
                            },
                        },
                        orderBy: { dateReceived: 'desc' },
                        take: 1,
                    },
                },
                orderBy: { lastMessageDate: 'desc' },
                take,
                skip,
            }),
            prisma.thread.count({ where }),
        ]);

        res.json({
            success: true,
            data: {
                items: threads,
                total,
                page: parseInt(page as string),
                pageSize: take,
                hasMore: skip + threads.length < total,
            },
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/threads/:id - Get thread with all messages
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;

        const { id } = req.params;
        console.log(`🔍 Fetching thread detail for ID: ${id}`);

        if (!/^[0-9a-f-]{36}$/i.test(id)) {
            console.warn(`❌ Invalid UUID format for thread ID: ${id}`);
            throw errors.badRequest('Invalid thread ID');
        }

        const thread = await prisma.thread.findFirst({
            where: {
                id,
                userId: authReq.user!.id,
            },
            include: {
                messages: {
                    orderBy: { dateReceived: 'asc' },
                    include: {
                        account: {
                            select: { emailAddress: true, provider: true },
                        },
                    },
                },
            },
        });

        if (!thread) {
            throw errors.notFound('Thread');
        }

        // Mark all messages in thread as read
        await prisma.message.updateMany({
            where: { threadId: req.params.id, isRead: false },
            data: { isRead: true },
        });

        // Recalculate stats immediately so unreadCount in database is correct
        await updateThreadStats(id);

        res.json({
            success: true,
            data: thread,
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/threads/batch - Batch operations for threads
router.post('/batch', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const { threadIds, action, data } = req.body;
        console.log(`📦 Thread Batch Request:`, { threadIds, action, data });

        if (!Array.isArray(threadIds) || threadIds.length === 0) {
            throw errors.badRequest('threadIds must be a non-empty array');
        }

        // Verify ownership and get messages for these threads
        const threads = await prisma.thread.findMany({
            where: {
                id: { in: threadIds },
                userId: authReq.user!.id,
            },
            include: {
                messages: {
                    select: {
                        id: true,
                        accountId: true,
                        providerMessageId: true,
                    }
                }
            }
        });

        console.log(`🧵 Found ${threads.length} threads for batch operation`);

        if (threads.length === 0) {
            throw errors.notFound('Threads not found');
        }

        const messageIds = threads.flatMap(t => t.messages.map(m => m.id));
        const messagesWithAccounts = threads.flatMap(t => t.messages);

        // Group by account for provider sync
        const byAccount = messagesWithAccounts.reduce((acc, msg) => {
            if (!acc[msg.accountId]) acc[msg.accountId] = [];
            acc[msg.accountId].push(msg);
            return acc;
        }, {} as Record<string, any[]>);

        let totalUpdated = 0;

        switch (action) {
            case 'delete':
                // Move messages to trash on provider
                for (const [accountId, msgs] of Object.entries(byAccount)) {
                    const adapter = await accountSyncService.getAdapterForAccount(accountId);
                    try {
                        for (const msg of msgs) {
                            await adapter.moveToTrash(msg.providerMessageId);
                        }
                    } catch (err) {
                        console.error(`Failed to move messages to trash for account ${accountId}:`, err);
                    } finally {
                        await adapter.disconnect();
                    }
                }
                // Mark messages as hidden locally
                const deleteResult = await prisma.message.updateMany({
                    where: { id: { in: messageIds } },
                    data: { isHidden: true },
                });
                totalUpdated = deleteResult.count;
                break;

            case 'markRead':
            case 'markUnread':
                const isRead = action === 'markRead';
                for (const [accountId, msgs] of Object.entries(byAccount)) {
                    const adapter = await accountSyncService.getAdapterForAccount(accountId);
                    try {
                        for (const msg of msgs) {
                            await adapter.markRead(msg.providerMessageId, isRead);
                        }
                    } catch (err) {
                        console.error(`Failed to update read status for account ${accountId}:`, err);
                    } finally {
                        await adapter.disconnect();
                    }
                }
                const readResult = await prisma.message.updateMany({
                    where: { id: { in: messageIds } },
                    data: { isRead },
                });
                totalUpdated = readResult.count;
                break;

            case 'archive':
                for (const [accountId, msgs] of Object.entries(byAccount)) {
                    const adapter = await accountSyncService.getAdapterForAccount(accountId);
                    try {
                        for (const msg of msgs) {
                            await adapter.archive(msg.providerMessageId);
                        }
                    } catch (err) {
                        console.error(`Failed to archive messages for account ${accountId}:`, err);
                    } finally {
                        await adapter.disconnect();
                    }
                }
                // Mark messages as hidden locally (Archive = hide from inbox/categories)
                const archiveResult = await prisma.message.updateMany({
                    where: { id: { in: messageIds } },
                    data: { isHidden: true },
                });
                totalUpdated = archiveResult.count;
                break;

            default:
                throw errors.badRequest('Invalid action');
        }

        // Recalculate thread stats for all affected threads
        for (const threadId of threadIds) {
            await updateThreadStats(threadId);
        }

        res.json({
            success: true,
            data: { updated: totalUpdated },
        });
    } catch (error) {
        next(error);
    }
});

export default router;
