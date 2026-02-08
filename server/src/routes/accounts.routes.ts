import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { encrypt } from '../lib/encryption';
import { requireAuth, AuthRequest } from '../middleware/auth.middleware';
import { errors } from '../middleware/errorHandler';
import { accountSyncService } from '../services/accountSync.service';
import type { ProviderType } from '@mailhub/shared';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// Validation schemas
const createAccountSchema = z.object({
    provider: z.enum(['gmail', 'proton', 'hover', 'zoho']),
    emailAddress: z.string().email(),
    displayName: z.string().optional(),
    // For IMAP providers
    imapHost: z.string().optional(),
    imapPort: z.number().optional(),
    smtpHost: z.string().optional(),
    smtpPort: z.number().optional(),
    imapUsername: z.string().optional(),
    imapPassword: z.string().optional(),
});

// GET /api/accounts - List all accounts for user
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;

        const accounts = await prisma.account.findMany({
            where: { userId: authReq.user!.id },
            select: {
                id: true,
                provider: true,
                emailAddress: true,
                displayName: true,
                lastSyncAt: true,
                isEnabled: true,
                createdAt: true,
                _count: {
                    select: { messages: true, folders: true },
                },
            },
            orderBy: { createdAt: 'asc' },
        });

        res.json({
            success: true,
            data: accounts,
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/accounts - Create a new account (IMAP-based)
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const data = createAccountSchema.parse(req.body);

        // Check for duplicate
        const existing = await prisma.account.findFirst({
            where: {
                userId: authReq.user!.id,
                emailAddress: data.emailAddress,
            },
        });

        if (existing) {
            throw errors.conflict('Account already exists');
        }

        // Prepare account data
        const accountData: any = {
            userId: authReq.user!.id,
            provider: data.provider as ProviderType,
            emailAddress: data.emailAddress,
            displayName: data.displayName,
        };

        // Handle IMAP credentials
        if (data.provider === 'proton' || data.provider === 'hover') {
            if (!data.imapHost || !data.imapUsername || !data.imapPassword) {
                throw errors.badRequest('IMAP credentials required for this provider');
            }

            accountData.imapHost = data.imapHost;
            accountData.imapPort = data.imapPort || 993;
            accountData.smtpHost = data.smtpHost;
            accountData.smtpPort = data.smtpPort || 587;
            accountData.imapUsername = data.imapUsername;
            accountData.imapPasswordEncrypted = encrypt(data.imapPassword);
        }

        const account = await prisma.account.create({
            data: accountData,
            select: {
                id: true,
                provider: true,
                emailAddress: true,
                displayName: true,
                isEnabled: true,
                createdAt: true,
            },
        });

        res.status(201).json({
            success: true,
            data: account,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(errors.badRequest(error.errors[0].message));
        }
        next(error);
    }
});

// GET /api/accounts/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;

        const account = await prisma.account.findFirst({
            where: {
                id: req.params.id,
                userId: authReq.user!.id,
            },
            select: {
                id: true,
                provider: true,
                emailAddress: true,
                displayName: true,
                lastSyncAt: true,
                backfillTargetDate: true,
                isEnabled: true,
                createdAt: true,
                folders: {
                    select: {
                        id: true,
                        name: true,
                        folderType: true,
                        messageCount: true,
                        unreadCount: true,
                    },
                },
            },
        });

        if (!account) {
            throw errors.notFound('Account');
        }

        res.json({
            success: true,
            data: account,
        });
    } catch (error) {
        next(error);
    }
});

// PATCH /api/accounts/:id
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const { displayName, isEnabled, backfillTargetDate } = req.body;

        const account = await prisma.account.updateMany({
            where: {
                id: req.params.id,
                userId: authReq.user!.id,
            },
            data: {
                ...(displayName !== undefined && { displayName }),
                ...(isEnabled !== undefined && { isEnabled }),
                ...(backfillTargetDate !== undefined && { backfillTargetDate: new Date(backfillTargetDate) }),
            },
        });

        if (account.count === 0) {
            throw errors.notFound('Account');
        }

        res.json({
            success: true,
            data: { updated: true },
        });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/accounts/:id
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;

        const deleted = await prisma.account.deleteMany({
            where: {
                id: req.params.id,
                userId: authReq.user!.id,
            },
        });

        if (deleted.count === 0) {
            throw errors.notFound('Account');
        }

        res.json({
            success: true,
            data: { deleted: true },
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/accounts/:id/sync - Trigger manual sync for an account
router.post('/:id/sync', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;

        // Verify ownership
        const account = await prisma.account.findFirst({
            where: {
                id: req.params.id,
                userId: authReq.user!.id,
            },
        });

        if (!account) {
            throw errors.notFound('Account');
        }

        // Import sync service dynamically to avoid circular deps
        const result = await accountSyncService.syncAccount(req.params.id);

        res.json({
            success: true,
            data: result,
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/accounts/:id/test - Test account connection
router.post('/:id/test', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;

        // Verify ownership
        const account = await prisma.account.findFirst({
            where: {
                id: req.params.id,
                userId: authReq.user!.id,
            },
        });

        if (!account) {
            throw errors.notFound('Account');
        }

        const result = await accountSyncService.testConnection(req.params.id);

        res.json({
            success: true,
            data: result,
        });
    } catch (error) {
        next(error);
    }
});

export default router;
