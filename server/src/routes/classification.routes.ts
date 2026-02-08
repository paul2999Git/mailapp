import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/db';
import { requireAuth, AuthRequest } from '../middleware/auth.middleware';
import { errors } from '../middleware/errorHandler';

const router = Router();

router.use(requireAuth);

// GET /api/classification/categories - List all categories
router.get('/categories', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;

        const categories = await prisma.category.findMany({
            where: {
                OR: [
                    { userId: null, isSystem: true },
                    { userId: authReq.user!.id },
                ],
            },
            orderBy: { priority: 'asc' },
        });

        res.json({
            success: true,
            data: categories,
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/classification/message/:id - Get classification for a message
router.get('/message/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;

        // Verify message ownership
        const message = await prisma.message.findFirst({
            where: {
                id: req.params.id,
                account: { userId: authReq.user!.id },
            },
            select: { id: true },
        });

        if (!message) {
            throw errors.notFound('Message');
        }

        const classifications = await prisma.aiClassification.findMany({
            where: { messageId: req.params.id },
            include: {
                category: true,
                subcategory: true,
            },
            orderBy: { createdAt: 'desc' },
        });

        res.json({
            success: true,
            data: classifications,
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/classification/override - User overrides AI classification
router.post('/override', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const { messageId, newCategoryId, actionType, makePermanent, applyToSender, applyToDomain } = req.body;

        // Verify message ownership
        const message = await prisma.message.findFirst({
            where: {
                id: messageId,
                account: { userId: authReq.user!.id },
            },
            include: {
                classifications: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                },
            },
        });

        if (!message) {
            throw errors.notFound('Message');
        }

        // Create override record
        const override = await prisma.userOverride.create({
            data: {
                userId: authReq.user!.id,
                messageId,
                originalCategoryId: message.classifications[0]?.categoryId,
                originalConfidence: message.classifications[0]?.confidence,
                actionType: actionType || 'categorize',
                newCategoryId,
                makePermanent: makePermanent || false,
                applyToSender: applyToSender || false,
                applyToDomain: applyToDomain || false,
            },
        });

        // Update message category
        const category = await prisma.category.findUnique({
            where: { id: newCategoryId },
        });

        if (category) {
            await prisma.message.update({
                where: { id: messageId },
                data: {
                    aiCategory: category.name,
                    aiConfidence: 1.0, // User override = 100% confidence
                },
            });
        }

        // Create learned rule if permanent
        if (makePermanent && message.fromAddress) {
            const matchType = applyToDomain ? 'sender_domain' : 'sender_email';
            const matchValue = applyToDomain
                ? message.fromAddress.split('@')[1]
                : message.fromAddress;

            await prisma.learnedRule.upsert({
                where: {
                    userId_matchType_matchValue: {
                        userId: authReq.user!.id,
                        matchType,
                        matchValue,
                    },
                },
                create: {
                    userId: authReq.user!.id,
                    matchType,
                    matchValue,
                    targetCategoryId: newCategoryId,
                    action: 'categorize',
                    priority: 100,
                },
                update: {
                    targetCategoryId: newCategoryId,
                    timesApplied: { increment: 1 },
                    lastAppliedAt: new Date(),
                },
            });
        }

        res.json({
            success: true,
            data: override,
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/classification/rules - Get learned rules
router.get('/rules', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;

        const rules = await prisma.learnedRule.findMany({
            where: { userId: authReq.user!.id },
            include: {
                targetCategory: true,
            },
            orderBy: { priority: 'desc' },
        });

        res.json({
            success: true,
            data: rules,
        });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/classification/rules/:id
router.delete('/rules/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;

        const deleted = await prisma.learnedRule.deleteMany({
            where: {
                id: req.params.id,
                userId: authReq.user!.id,
            },
        });

        if (deleted.count === 0) {
            throw errors.notFound('Rule');
        }

        res.json({
            success: true,
            data: { deleted: true },
        });
    } catch (error) {
        next(error);
    }
});

export default router;
