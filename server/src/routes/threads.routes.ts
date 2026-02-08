import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/db';
import { requireAuth, AuthRequest } from '../middleware/auth.middleware';
import { errors } from '../middleware/errorHandler';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@mailhub/shared';

const router = Router();

router.use(requireAuth);

// GET /api/threads - List threads
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const {
            category,
            page = '1',
            pageSize = String(DEFAULT_PAGE_SIZE),
        } = req.query;

        const take = Math.min(parseInt(pageSize as string) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
        const skip = (parseInt(page as string) - 1) * take;

        const where: any = {
            userId: authReq.user!.id,
        };

        if (category) where.primaryCategory = category;

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

        const thread = await prisma.thread.findFirst({
            where: {
                id: req.params.id,
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

        res.json({
            success: true,
            data: thread,
        });
    } catch (error) {
        next(error);
    }
});

export default router;
