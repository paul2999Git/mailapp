import { Request, Response, NextFunction } from 'express';

export interface AppError extends Error {
    statusCode?: number;
    code?: string;
}

export function errorHandler(
    err: AppError,
    req: Request,
    res: Response,
    _next: NextFunction
): void {
    console.error('Error:', err);

    const statusCode = err.statusCode || 500;
    const code = err.code || 'INTERNAL_ERROR';
    const message = err.message || 'An unexpected error occurred';

    res.status(statusCode).json({
        success: false,
        error: {
            code,
            message: process.env.NODE_ENV === 'production' && statusCode === 500
                ? 'An unexpected error occurred'
                : message,
        },
    });
}

// Helper to create typed errors
export function createError(message: string, statusCode: number, code: string): AppError {
    const error = new Error(message) as AppError;
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

// Common error factories
export const errors = {
    notFound: (resource: string) => createError(`${resource} not found`, 404, 'NOT_FOUND'),
    unauthorized: (message = 'Unauthorized') => createError(message, 401, 'UNAUTHORIZED'),
    forbidden: (message = 'Forbidden') => createError(message, 403, 'FORBIDDEN'),
    badRequest: (message: string) => createError(message, 400, 'BAD_REQUEST'),
    conflict: (message: string) => createError(message, 409, 'CONFLICT'),
    internal: (message = 'Internal server error') => createError(message, 500, 'INTERNAL_ERROR'),
};
