import { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { errors } from './errorHandler';

// Extended request with user
export interface AuthRequest extends Request {
    user?: {
        id: string;
        email: string;
        displayName: string | null;
        isActive: boolean;
    };
}

/**
 * Middleware to require authentication
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
    passport.authenticate('jwt', { session: false }, (err: Error | null, user: AuthRequest['user']) => {
        if (err) {
            return next(err);
        }
        if (!user) {
            return next(errors.unauthorized());
        }
        (req as AuthRequest).user = user;
        next();
    })(req, res, next);
}

/**
 * Optional authentication - populates user if token is valid
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
    passport.authenticate('jwt', { session: false }, (err: Error | null, user: AuthRequest['user']) => {
        if (user) {
            (req as AuthRequest).user = user;
        }
        next();
    })(req, res, next);
}
