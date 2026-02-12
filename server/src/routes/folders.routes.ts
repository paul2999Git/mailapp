import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { requireAuth, AuthRequest } from '../middleware/auth.middleware';
import { errors } from '../middleware/errorHandler';
import { accountSyncService } from '../services/accountSync.service';

const router = Router();

router.use(requireAuth);

// GET /api/folders - List all folders for user (across all accounts)
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const { accountId } = req.query;

        const where: any = {
            account: { userId: authReq.user!.id },
        };

        if (accountId) {
            where.accountId = accountId;
        }

        const folders = await prisma.folder.findMany({
            where,
            select: {
                id: true,
                accountId: true,
                name: true,
                fullPath: true,
                folderType: true,
                isSystem: true,
                isAiManaged: true,
                account: {
                    select: { emailAddress: true, provider: true },
                },
            },
            orderBy: [
                { isSystem: 'desc' },
                { name: 'asc' },
            ],
        });

        // Calculate unread counts locally based on 14-day history in DB
        const foldersWithCounts = await Promise.all(folders.map(async (folder) => {
            const localUnreadCount = await prisma.message.count({
                where: {
                    currentFolderId: folder.id,
                    isRead: false,
                    isHidden: false,
                    neverShow: false,
                }
            });

            return {
                ...folder,
                unreadCount: localUnreadCount,
                messageCount: 0, // We don't really use this in the UI anymore
            };
        }));

        res.json({
            success: true,
            data: foldersWithCounts,
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/folders/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;

        const folder = await prisma.folder.findFirst({
            where: {
                id: req.params.id,
                account: { userId: authReq.user!.id },
            },
            include: {
                account: {
                    select: { emailAddress: true, provider: true },
                },
            },
        });

        if (!folder) {
            throw errors.notFound('Folder');
        }

        res.json({
            success: true,
            data: folder,
        });
    } catch (error) {
        next(error);
    }
});

const createFolderSchema = z.object({
    accountId: z.string().uuid(),
    name: z.string().min(1).max(100),
});

// POST /api/folders - Create a new folder
// POST /api/folders/:id/mark-read - Mark all messages in folder as read
router.post('/:id/mark-read', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const userId = authReq.user!.id;
        const folderId = req.params.id;

        // 1. Find the folder and ensure it belongs to the user
        const folder = await prisma.folder.findFirst({
            where: { id: folderId, account: { userId } },
            select: { id: true, accountId: true, providerFolderId: true }
        });

        if (!folder) {
            throw errors.notFound('Folder');
        }

        // 2. Find all unread messages in this folder
        const messages = await prisma.message.findMany({
            where: {
                currentFolderId: folder.id,
                isRead: false,
                isHidden: false,
            },
            select: { id: true, providerMessageId: true, accountId: true, threadId: true }
        });

        if (messages.length === 0) {
            return res.json({ success: true, count: 0 });
        }

        // 3. Mark all messages as read locally
        await prisma.message.updateMany({
            where: {
                id: { in: messages.map(m => m.id) }
            },
            data: { isRead: true }
        });

        // 4. Update on provider
        const adapter = await accountSyncService.getAdapterForAccount(folder.accountId);
        try {
            for (const msg of messages) {
                try {
                    await adapter.markRead(msg.providerMessageId, true);
                } catch (err) {
                    console.error(`Failed to mark message ${msg.providerMessageId} as read on provider:`, err);
                }
            }
        } finally {
            await adapter.disconnect();
        }

        // 5. Recalculate thread stats
        const { updateThreadStats } = await import('../services/threadHelper.js');
        const uniqueThreadIds = [...new Set(messages.map(m => m.threadId).filter(Boolean))] as string[];
        for (const threadId of uniqueThreadIds) {
            await updateThreadStats(threadId!);
        }

        // 6. Update folder unread count
        await prisma.folder.update({
            where: { id: folder.id },
            data: { unreadCount: 0 }
        });

        res.json({
            success: true,
            count: messages.length,
        });
    } catch (error) {
        next(error);
    }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const { accountId, name } = createFolderSchema.parse(req.body);

        // Verify account ownership
        const account = await prisma.account.findFirst({
            where: {
                id: accountId,
                userId: authReq.user!.id,
            },
        });

        if (!account) {
            throw errors.notFound('Account');
        }

        const adapter = await accountSyncService.getAdapterForAccount(accountId);
        const normalized = await adapter.createFolder(name);

        const folder = await prisma.folder.create({
            data: {
                accountId,
                providerFolderId: normalized.providerFolderId,
                name: normalized.name,
                fullPath: normalized.fullPath,
                folderType: normalized.folderType,
                isSystem: normalized.isSystem,
                messageCount: 0,
                unreadCount: 0,
            },
        });

        res.status(201).json({
            success: true,
            data: folder,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(errors.badRequest(error.errors[0].message));
        }
        next(error);
    }
});

export default router;
