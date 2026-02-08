import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/db';
import { requireAuth, AuthRequest } from '../middleware/auth.middleware';
import { errors } from '../middleware/errorHandler';

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
                messageCount: true,
                unreadCount: true,
                account: {
                    select: { emailAddress: true, provider: true },
                },
            },
            orderBy: [
                { isSystem: 'desc' },
                { name: 'asc' },
            ],
        });

        res.json({
            success: true,
            data: folders,
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

export default router;
