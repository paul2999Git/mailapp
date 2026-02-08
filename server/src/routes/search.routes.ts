import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/db';
import { requireAuth, AuthRequest } from '../middleware/auth.middleware';
import { errors } from '../middleware/errorHandler';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@mailhub/shared';

const router = Router();

router.use(requireAuth);

// GET /api/search - Full-text search across messages
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const {
            q,
            accountId,
            category,
            page = '1',
            pageSize = String(DEFAULT_PAGE_SIZE),
        } = req.query;

        if (!q || typeof q !== 'string' || q.trim().length === 0) {
            throw errors.badRequest('Search query is required');
        }

        const take = Math.min(parseInt(pageSize as string) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
        const skip = (parseInt(page as string) - 1) * take;

        // Build search filter
        const where: any = {
            account: { userId: authReq.user!.id },
            isHidden: false,
            neverShow: false,
            OR: [
                { subject: { contains: q, mode: 'insensitive' } },
                { bodyText: { contains: q, mode: 'insensitive' } },
                { fromAddress: { contains: q, mode: 'insensitive' } },
                { fromName: { contains: q, mode: 'insensitive' } },
            ],
        };

        if (accountId) where.accountId = accountId;
        if (category) where.aiCategory = category;

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
                    aiCategory: true,
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
                query: q,
            },
        });
    } catch (error) {
        next(error);
    }
});

export default router;
