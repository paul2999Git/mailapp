import { Router, Request, Response, NextFunction } from 'express';
import { google } from 'googleapis';
import { prisma } from '../lib/db';
import { encrypt } from '../lib/encryption';
import { requireAuth, AuthRequest } from '../middleware/auth.middleware';
import { errors } from '../middleware/errorHandler';
import { signState, verifyState } from '../utils/oauthState';

const router = Router();

// OAuth2 client configuration
function getOAuth2Client() {
    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        `${process.env.FRONTEND_URL}/auth/google/callback`
    );
}

const GMAIL_SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/userinfo.email',
];

// GET /api/oauth/google/url?userId=xxx - Get OAuth authorization URL (public)
router.get('/google/url', (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = req.query.userId as string | undefined;
        if (!userId) {
            throw errors.badRequest('Missing userId query parameter');
        }

        const oauth2Client = getOAuth2Client();
        const state = signState(userId);

        const url = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: GMAIL_SCOPES,
            prompt: 'consent',
            state,
        });

        res.json({
            success: true,
            data: { url },
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/oauth/google/callback - Handle OAuth callback (public)
router.get('/google/callback', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { code, state } = req.query;

        if (!code || !state) {
            throw errors.badRequest('Missing code or state parameter');
        }

        const verified = verifyState(state as string);
        if (!verified) {
            throw errors.badRequest('Invalid or expired OAuth state');
        }

        const { userId } = verified;

        const oauth2Client = getOAuth2Client();

        // Exchange code for tokens
        const { tokens } = await oauth2Client.getToken(code as string);

        if (!tokens.access_token || !tokens.refresh_token) {
            throw errors.badRequest('Failed to obtain OAuth tokens');
        }

        // Get user email from Google
        oauth2Client.setCredentials(tokens);
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const userInfo = await oauth2.userinfo.get();
        const email = userInfo.data.email;

        if (!email) {
            throw errors.badRequest('Could not retrieve email from Google');
        }

        // Check if account already exists
        const existingAccount = await prisma.account.findFirst({
            where: {
                userId,
                emailAddress: email,
            },
        });

        if (existingAccount) {
            // Update existing account with new tokens
            await prisma.account.update({
                where: { id: existingAccount.id },
                data: {
                    accessTokenEncrypted: encrypt(tokens.access_token),
                    refreshTokenEncrypted: encrypt(tokens.refresh_token),
                    tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
                },
            });
        } else {
            // Create new account
            await prisma.account.create({
                data: {
                    userId,
                    provider: 'gmail',
                    emailAddress: email,
                    displayName: userInfo.data.name || email,
                    accessTokenEncrypted: encrypt(tokens.access_token),
                    refreshTokenEncrypted: encrypt(tokens.refresh_token),
                    tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
                },
            });
        }

        // Redirect back to app
        res.redirect(`${process.env.FRONTEND_URL}/settings?connected=gmail`);
    } catch (error) {
        next(error);
    }
});

// POST /api/oauth/google/disconnect - Disconnect Gmail account
router.post('/google/disconnect', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest;
        const { accountId } = req.body;

        const account = await prisma.account.findFirst({
            where: {
                id: accountId,
                userId: authReq.user!.id,
                provider: 'gmail',
            },
        });

        if (!account) {
            throw errors.notFound('Gmail account');
        }

        // Delete the account (cascade will clean up messages, etc.)
        await prisma.account.delete({
            where: { id: accountId },
        });

        res.json({
            success: true,
            data: { disconnected: true },
        });
    } catch (error) {
        next(error);
    }
});

export default router;
