// Load environment FIRST before any other imports
import dotenv from 'dotenv';
import path from 'path';

const envFile = process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.dev';
// Go up from workspace (server/) to project root
dotenv.config({ path: path.join(process.cwd(), '..', envFile) });

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import passport from 'passport';

import { errorHandler } from './middleware/errorHandler';
import { requireAuth } from './middleware/auth.middleware';
import { configurePassport } from './lib/passport';

// Routes
import authRoutes from './routes/auth.routes';
import accountRoutes from './routes/accounts.routes';
import messagesRoutes from './routes/messages.routes';
import threadsRoutes from './routes/threads.routes';
import foldersRoutes from './routes/folders.routes';
import classificationRoutes from './routes/classification.routes';
import searchRoutes from './routes/search.routes';
import oauthRoutes from './routes/oauth.routes';

export const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 2000, // Limit each IP to 2000 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
}

// Passport authentication
configurePassport();
app.use(passport.initialize());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public API routes (no auth required)
app.use('/api/auth', authRoutes);
app.use('/api/oauth', oauthRoutes);

// All remaining /api routes require authentication
app.use('/api', requireAuth);

// Protected API routes
app.use('/api/accounts', accountRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/threads', threadsRoutes);
app.use('/api/folders', foldersRoutes);
app.use('/api/classification', classificationRoutes);
app.use('/api/search', searchRoutes);

// Error handling
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
});
