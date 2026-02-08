import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/db';
import { requireAuth, AuthRequest } from '../middleware/auth.middleware';
import { errors } from '../middleware/errorHandler';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@mailhub/shared';

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
                isRead: true,
                isStarred: true,
                isHidden: true,
                currentFolderId: true,
            },
        });

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

        let result;
        switch (action) {
            case 'markRead':
                result = await prisma.message.updateMany({
                    where: { id: { in: messageIds } },
                    data: { isRead: true },
                });
                break;
            case 'markUnread':
                result = await prisma.message.updateMany({
                    where: { id: { in: messageIds } },
                    data: { isRead: false },
                });
                break;
            case 'archive':
                result = await prisma.message.updateMany({
                    where: { id: { in: messageIds } },
                    data: { isHidden: true },
                });
                break;
            case 'move':
                if (!data?.folderId) {
                    throw errors.badRequest('folderId required for move action');
                }
                result = await prisma.message.updateMany({
                    where: { id: { in: messageIds } },
                    data: { currentFolderId: data.folderId },
                });
                break;
            default:
                throw errors.badRequest('Invalid action');
        }

        res.json({
            success: true,
            data: { updated: result.count },
        });
    } catch (error) {
        next(error);
    }
});

export default router;
