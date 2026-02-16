import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { requireAuth, AuthRequest } from '../middleware/auth.middleware';
import { errors } from '../middleware/errorHandler';
import rateLimit from 'express-rate-limit';
const router = Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' }
});


// Validation schemas
const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    displayName: z.string().optional(),
});

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string(),
});

// Generate JWT token
function generateToken(userId: string, email: string): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET not configured');

    return jwt.sign({ userId, email }, secret, { expiresIn: '7d' });
}

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { email, password, displayName } = registerSchema.parse(req.body);

        // Check if user exists
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            throw errors.conflict('Email already registered');
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 12);

        // Create user
        const user = await prisma.user.create({
            data: {
                email,
                passwordHash,
                displayName,
                settings: {
                    aiProvider: 'gemini',
                    bodyPreviewChars: 500,
                    aggressiveness: 'medium',
                },
            },
            select: {
                id: true,
                email: true,
                displayName: true,
            },
        });

        // Generate token
        const token = generateToken(user.id, user.email);

        res.status(201).json({
            success: true,
            data: {
                user,
                token,
            },
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(errors.badRequest(error.errors[0].message));
        }
        next(error);
    }
});

// POST /api/auth/logi
router.post('/login', loginLimiter, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { email, password } = loginSchema.parse(req.body);

        // Find user
        const user = await prisma.user.findUnique({
            where: { email },
            select: {
                id: true,
                email: true,
                displayName: true,
                passwordHash: true,
                isActive: true,
            },
        });

        if (!user || !user.passwordHash) {
            throw errors.unauthorized('Invalid email or password');
        }

        if (!user.isActive) {
            throw errors.forbidden('Account is disabled');
        }

        // Verify password
        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
            throw errors.unauthorized('Invalid email or password');
        }

        // Generate token
        const token = generateToken(user.id, user.email);

        res.json({
            success: true,
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    displayName: user.displayName,
                },
                token,
            },
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(errors.badRequest(error.errors[0].message));
        }
        next(error);
    }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;

        const user = await prisma.user.findUnique({
            where: { id: authReq.user!.id },
            select: {
                id: true,
                email: true,
                displayName: true,
                settings: true,
                createdAt: true,
                _count: {
                    select: { accounts: true },
                },
            },
        });

        if (!user) {
            throw errors.notFound('User');
        }

        res.json({
            success: true,
            data: user,
        });
    } catch (error) {
        next(error);
    }
});

// PUT /api/auth/settings
router.put('/settings', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const { settings } = req.body;

        const user = await prisma.user.update({
            where: { id: authReq.user!.id },
            data: { settings },
            select: {
                id: true,
                email: true,
                displayName: true,
                settings: true,
            },
        });

        res.json({
            success: true,
            data: user,
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/auth/change-password
const changePasswordSchema = z.object({
    currentPassword: z.string(),
    newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

router.post('/change-password', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

        const user = await prisma.user.findUnique({
            where: { id: authReq.user!.id },
            select: { passwordHash: true },
        });

        if (!user || !user.passwordHash) {
            throw errors.badRequest('Cannot change password for this account');
        }

        const valid = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!valid) {
            throw errors.unauthorized('Current password is incorrect');
        }

        const newHash = await bcrypt.hash(newPassword, 12);
        await prisma.user.update({
            where: { id: authReq.user!.id },
            data: { passwordHash: newHash },
        });

        res.json({ success: true, data: { message: 'Password changed successfully' } });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return next(errors.badRequest(error.errors[0].message));
        }
        next(error);
    }
});

export default router;
