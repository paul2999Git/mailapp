// Default categories with priorities
export const DEFAULT_CATEGORIES = [
    { name: 'Taxes', description: 'Tax-related documents and correspondence', priority: 10 },
    { name: 'Banking - Critical', description: 'Important banking alerts and transactions', priority: 15 },
    { name: 'Banking - Marketing', description: 'Bank promotions and marketing', priority: 80 },
    { name: 'Legal', description: 'Legal documents and correspondence', priority: 12 },
    { name: 'Personal', description: 'Personal emails from contacts', priority: 20 },
    { name: 'Sales', description: 'Sales pitches and cold outreach', priority: 85 },
    { name: 'Vendors', description: 'Vendor communications and invoices', priority: 40 },
    { name: 'Newsletters', description: 'Subscribed newsletters', priority: 70 },
    { name: 'Receipts', description: 'Purchase receipts and confirmations', priority: 50 },
    { name: 'Spam', description: 'Obvious spam', priority: 95 },
    { name: 'AI-Trash', description: 'AI-detected low-value messages', priority: 90 },
    { name: 'Quarantine', description: 'Uncertain classifications', priority: 100 },
] as const;

// Provider rate limits
export const RATE_LIMITS = {
    gmail: { maxPerMinute: 250, maxPerDay: 10000 },
    proton: { maxPerMinute: 30, maxPerDay: 5000 },
    hover: { maxPerMinute: 30, maxPerDay: 5000 },
    zoho: { maxPerMinute: 60, maxPerDay: 5000 },
} as const;

// Default provider configurations
export const PROVIDER_CONFIGS = {
    gmail: {
        authType: 'oauth' as const,
        scopes: [
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.modify',
            'https://www.googleapis.com/auth/gmail.compose',
        ],
    },
    proton: {
        authType: 'imap' as const,
        defaultHost: '127.0.0.1',
        defaultImapPort: 1143,
        defaultSmtpPort: 1025,
        privacyLevel: 'BODY_LOCAL_ONLY' as const,
    },
    hover: {
        authType: 'imap' as const,
        defaultHost: 'mail.hover.com',
        defaultImapPort: 993,
        defaultSmtpPort: 587,
    },
    zoho: {
        authType: 'oauth' as const,
        imapHost: 'imap.zoho.com',
        imapPort: 993,
    },
} as const;

// Job queue names
export const QUEUE_NAMES = {
    EMAIL_SYNC: 'email-sync',
    CLASSIFICATION: 'classification',
    SEARCH_INDEXING: 'search-indexing',
} as const;

// Sync interval in milliseconds (1 hour)
export const SYNC_INTERVAL_MS = 60 * 60 * 1000;

// Default pagination
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
