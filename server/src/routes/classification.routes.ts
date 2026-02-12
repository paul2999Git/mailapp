import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/db';
import { requireAuth, AuthRequest } from '../middleware/auth.middleware';
import { errors } from '../middleware/errorHandler';
import { classificationService } from '../services/classification.service';
import { classificationQueue } from '../lib/queues';

const router = Router();

router.use(requireAuth);

// GET /api/classification/categories - List all categories
router.get('/categories', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const categories = await classificationService.listCategories(authReq.user!.id);

        res.json({
            success: true,
            data: categories,
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/classification/categories - Create a new category
router.post('/categories', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const category = await classificationService.createCategory(authReq.user!.id, req.body);

        res.status(201).json({
            success: true,
            data: category,
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

        // Create or update override record
        const override = await prisma.userOverride.upsert({
            where: {
                messageId_actionType: {
                    messageId,
                    actionType: actionType || 'categorize',
                }
            },
            create: {
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
            update: {
                newCategoryId,
                makePermanent: makePermanent || false,
                applyToSender: applyToSender || false,
                applyToDomain: applyToDomain || false,
            }
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
                    isHidden: false,  // Unhide if it was hidden (e.g. from AI-Trash)
                    neverShow: false, // Ensure it shows up
                },
            });

            // Sync with provider in background
            classificationService.moveMessageOnProvider(messageId, category.name).catch(err => {
                console.error('Failed to sync message move with provider:', err);
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
                    action: 'route',
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
                targetFolder: { select: { id: true, name: true, accountId: true } },
                account: { select: { id: true, emailAddress: true } },
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

// POST /api/classification/rules - Create a manual routing rule
router.post('/rules', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const userId = authReq.user!.id;
        const { matchType, matchValue, targetCategoryId, targetFolderId, accountId, action, priority } = req.body;

        if (!matchType || !matchValue) {
            throw errors.badRequest('matchType and matchValue are required');
        }
        if (!targetCategoryId && !targetFolderId) {
            throw errors.badRequest('At least one of targetCategoryId or targetFolderId is required');
        }

        // Validate category ownership if provided
        if (targetCategoryId) {
            const cat = await prisma.category.findFirst({ where: { id: targetCategoryId, userId } });
            if (!cat) throw errors.notFound('Category');
        }

        // Validate folder ownership if provided
        if (targetFolderId) {
            const folder = await prisma.folder.findFirst({ where: { id: targetFolderId, account: { userId } } });
            if (!folder) throw errors.notFound('Folder');
        }

        // Validate account ownership if provided
        if (accountId) {
            const acc = await prisma.account.findFirst({ where: { id: accountId, userId } });
            if (!acc) throw errors.notFound('Account');
        }

        const rule = await prisma.learnedRule.upsert({
            where: {
                userId_matchType_matchValue: { userId, matchType, matchValue },
            },
            create: {
                userId,
                matchType,
                matchValue: matchValue.toLowerCase().trim(),
                targetCategoryId: targetCategoryId || null,
                targetFolderId: targetFolderId || null,
                accountId: accountId || null,
                action: action || 'route',
                priority: priority || 50,
            },
            update: {
                targetCategoryId: targetCategoryId || null,
                targetFolderId: targetFolderId || null,
                accountId: accountId || null,
                action: action || 'route',
                priority: priority ?? 50,
            },
            include: {
                targetCategory: true,
                targetFolder: { select: { id: true, name: true, accountId: true } },
                account: { select: { id: true, emailAddress: true } },
            },
        });

        res.status(201).json({ success: true, data: rule });
    } catch (error) {
        next(error);
    }
});

// PUT /api/classification/rules/:id - Update a routing rule
router.put('/rules/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const userId = authReq.user!.id;
        const { targetCategoryId, targetFolderId, accountId, action, priority } = req.body;

        // Verify rule ownership
        const existing = await prisma.learnedRule.findFirst({
            where: { id: req.params.id, userId },
        });
        if (!existing) throw errors.notFound('Rule');

        // Validate category if provided
        if (targetCategoryId) {
            const cat = await prisma.category.findFirst({ where: { id: targetCategoryId, userId } });
            if (!cat) throw errors.notFound('Category');
        }

        // Validate folder if provided
        if (targetFolderId) {
            const folder = await prisma.folder.findFirst({ where: { id: targetFolderId, account: { userId } } });
            if (!folder) throw errors.notFound('Folder');
        }

        const rule = await prisma.learnedRule.update({
            where: { id: req.params.id },
            data: {
                targetCategoryId: targetCategoryId !== undefined ? (targetCategoryId || null) : undefined,
                targetFolderId: targetFolderId !== undefined ? (targetFolderId || null) : undefined,
                accountId: accountId !== undefined ? (accountId || null) : undefined,
                action: action || undefined,
                priority: priority !== undefined ? priority : undefined,
            },
            include: {
                targetCategory: true,
                targetFolder: { select: { id: true, name: true, accountId: true } },
                account: { select: { id: true, emailAddress: true } },
            },
        });

        res.json({ success: true, data: rule });
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

// DELETE /api/classification/categories/:id - Delete a category
router.delete('/categories/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        await classificationService.deleteCategory(authReq.user!.id, req.params.id);

        res.json({
            success: true,
            data: { deleted: true },
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/classification/bulk-classify - Queue all unclassified messages
router.post('/bulk-classify', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const userId = authReq.user!.id;

        // Find all unclassified messages for this user
        const unclassifiedMessages = await prisma.message.findMany({
            where: {
                account: { userId },
                aiCategory: null,
                isHidden: false,
                neverShow: false,
            },
            select: { id: true },
        });

        console.log(`Queuing ${unclassifiedMessages.length} messages for classification (User: ${userId})`);

        // Add to queue
        for (const msg of unclassifiedMessages) {
            await classificationQueue.add('classify-message', {
                messageId: msg.id
            }, {
                removeOnComplete: true,
                removeOnFail: 1000,
            });
        }

        res.json({
            success: true,
            data: { queued: unclassifiedMessages.length },
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/classification/stats - Get classification progress stats
router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const userId = authReq.user!.id;

        const [unclassifiedCount, classifiedCount, queueCounts] = await Promise.all([
            prisma.message.count({
                where: { account: { userId }, aiCategory: null, isHidden: false }
            }),
            prisma.message.count({
                where: { account: { userId }, aiCategory: { not: null }, isHidden: false }
            }),
            classificationQueue.getJobCounts('waiting', 'active', 'completed', 'failed')
        ]);

        res.json({
            success: true,
            data: {
                unclassified: unclassifiedCount,
                classified: classifiedCount,
                total: unclassifiedCount + classifiedCount,
                queue: queueCounts
            },
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/classification/reset-queue - Clear failed jobs
router.post('/reset-queue', async (req: Request, res: Response, next: NextFunction) => {
    try {
        // Clear failed jobs
        await classificationQueue.clean(0, 1000, 'failed');

        res.json({
            success: true,
            data: { reset: true },
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/classification/empty-trash - Move all AI-Trash messages to actual Trash
router.post('/empty-trash', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const userId = authReq.user!.id;

        // 1. Find the "AI-Trash" category ID for this user
        const category = await prisma.category.findFirst({
            where: { userId, name: 'AI-Trash' },
            select: { id: true, name: true }
        });

        if (!category) {
            return res.json({ success: true, data: { moved: 0 } });
        }

        // 2. Find all messages in this category
        const messages = await prisma.message.findMany({
            where: {
                account: { userId },
                aiCategory: category.name,
                isHidden: false,
            },
            include: { account: true }
        });

        if (messages.length === 0) {
            return res.json({ success: true, data: { moved: 0 } });
        }

        // 3. Group by account to reuse adapters
        const byAccount = messages.reduce((acc, msg) => {
            if (!acc[msg.accountId]) acc[msg.accountId] = [];
            acc[msg.accountId].push(msg);
            return acc;
        }, {} as Record<string, typeof messages>);

        const { accountSyncService } = await import('../services/accountSync.service.js');

        let totalMoved = 0;

        // 4. Move each account's messages to provider trash
        for (const [accountId, accountMessages] of Object.entries(byAccount)) {
            const adapter = await accountSyncService.getAdapterForAccount(accountId);
            try {
                for (const msg of accountMessages) {
                    await adapter.moveToTrash(msg.providerMessageId);
                }
            } finally {
                await adapter.disconnect();
            }
        }

        // 5. Update database status
        const result = await prisma.message.updateMany({
            where: {
                id: { in: messages.map(m => m.id) }
            },
            data: {
                isHidden: true,
                aiCategory: 'Trash (Actual)', // Mark to avoid confusion
            }
        });

        totalMoved = result.count;

        res.json({
            success: true,
            data: { moved: totalMoved },
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/classification/categories/:id/mark-read - Mark all messages in category as read
router.post('/categories/:id/mark-read', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const userId = authReq.user!.id;
        const categoryId = req.params.id;

        // 1. Find the category and ensure it belongs to the user
        const category = await prisma.category.findFirst({
            where: { id: categoryId, userId },
            select: { name: true }
        });

        if (!category) {
            throw errors.notFound('Category');
        }

        // 2. Find all unread messages in this category
        const messages = await prisma.message.findMany({
            where: {
                account: { userId },
                aiCategory: category.name,
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

        // 4. Group by account to update provider
        const byAccount = messages.reduce((acc, msg) => {
            if (!acc[msg.accountId]) acc[msg.accountId] = [];
            acc[msg.accountId].push(msg);
            return acc;
        }, {} as Record<string, typeof messages>);

        const { accountSyncService } = await import('../services/accountSync.service.js');

        // 5. Update each account on provider
        for (const [accountId, accountMessages] of Object.entries(byAccount)) {
            try {
                const adapter = await accountSyncService.getAdapterForAccount(accountId);
                try {
                    for (const msg of accountMessages) {
                        try {
                            await adapter.markRead(msg.providerMessageId, true);
                        } catch (err) {
                            console.error(`Failed to mark message ${msg.providerMessageId} as read on provider:`, err);
                        }
                    }
                } finally {
                    await adapter.disconnect();
                }
            } catch (err) {
                console.error(`Failed to get adapter for account ${accountId}:`, err);
            }
        }

        // 6. Recalculate thread stats
        const { updateThreadStats } = await import('../services/threadHelper.js');
        const uniqueThreadIds = [...new Set(messages.map(m => (m as any).threadId).filter(Boolean))] as string[];

        // Call updateThreadStats for each unique threadId
        for (const threadId of uniqueThreadIds) {
            await updateThreadStats(threadId);
        }

        res.json({
            success: true,
            count: messages.length,
        });
    } catch (error) {
        next(error);
    }
});

export default router;
