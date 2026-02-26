// Default categories with priorities
export const DEFAULT_CATEGORIES = [
    { name: 'Taxes', description: 'Tax-related documents and correspondence', priority: 10 },
    { name: 'Banking - Critical', description: 'Account alerts, transaction notifications, statements, balance updates, fraud alerts, security notices, and important account information from banks or credit card companies. Must be informational about an existing account — NOT promotional or selling a product.', priority: 15 },
    { name: 'Banking - Marketing', description: 'Promotional offers, product advertisements, credit card offers, loan offers, rate change announcements, and any marketing or upsell content from banks, credit card companies, or financial institutions.', priority: 80 },
    { name: 'Bills Due', description: 'Bills, invoices, payment reminders, account balance due notices, utility bills, subscription renewals, and any email indicating money is owed or a payment is required or upcoming.', priority: 18 },
    { name: 'Legal', description: 'Legal documents and correspondence', priority: 12 },
    { name: 'Personal', description: 'Personal emails from contacts', priority: 20 },
    { name: 'Social', description: 'Social media notifications and updates', priority: 30 },
    { name: 'Promotions', description: 'Marketing and promotional emails', priority: 35 },
    { name: 'Vendors', description: 'Vendor communications and invoices', priority: 40 },
    { name: 'Newsletters', description: 'Subscribed newsletters, digest emails, and informational subscription content that does not fit a more specific category such as Banking, Receipts, or Bills Due.', priority: 70 },
    { name: 'Receipts', description: 'Purchase receipts, order confirmations, shipping notifications, and payment confirmations from merchants and retailers.', priority: 50 },
    { name: 'AI-Spam', description: 'Obvious spam', priority: 95 },
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
