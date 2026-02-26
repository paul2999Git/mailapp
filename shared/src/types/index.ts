// Email provider types
export type ProviderType = 'gmail' | 'proton' | 'hover' | 'zoho' | 'imap';

// AI provider types
export type AIProviderType = 'gemini' | 'claude' | 'openai';

// Privacy levels for messages
export type PrivacyLevel = 'FULL_ACCESS' | 'HEADERS_ONLY' | 'BODY_LOCAL_ONLY';

// Email address with optional display name
export interface EmailAddress {
    email: string;
    name?: string;
}

// Attachment metadata
export interface AttachmentMeta {
    name: string;
    size: number;
    mimeType: string;
    providerPartId?: string; // ID used by provider to fetch the actual content
}

// User settings stored in JSONB
export interface UserSettings {
    aiProvider: AIProviderType;
    aiModel?: string;
    bodyPreviewChars: number;
    aggressiveness: 'low' | 'medium' | 'high';
    theme?: 'light' | 'dark' | 'system';
    classificationPrompt?: string;
}

// AI classification result
export interface ClassificationResult {
    categoryId: string;
    subcategoryId?: string;
    confidence: number;
    explanation: string;
    factors: ClassificationFactor[];
    suggestedAction: 'inbox' | 'archive' | 'trash' | 'quarantine';
    needsHumanReview: boolean;
}

export interface ClassificationFactor {
    factor: string;
    signal: 'positive' | 'negative' | 'neutral';
    weight: number;
}

// Classification input (what gets sent to AI)
export interface ClassificationInput {
    messageId: string;
    accountId: string;
    provider: ProviderType;
    headers: {
        subject: string;
        from: EmailAddress;
        to: EmailAddress[];
        cc?: EmailAddress[];
        date: Date;
        replyTo?: string;
    };
    bodyPreview?: string;
    bodyPreviewCharCount: number;
    existingLabels: string[];
    isReply: boolean;
    hasAttachments: boolean;
    attachmentTypes?: string[];
    senderHistory?: {
        previousEmails: number;
        previousCategories: string[];
        userOverrides: string[];
    };
}

// API response wrapper
export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: {
        code: string;
        message: string;
    };
}

// Pagination
export interface PaginatedResponse<T> {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
}

// Auth types
export interface AuthUser {
    id: string;
    email: string;
    displayName?: string;
}

export interface TokenPayload {
    userId: string;
    email: string;
    iat: number;
    exp: number;
}

export interface ICategory {
    id: string;
    userId?: string | null;
    name: string;
    description?: string | null;
    color?: string | null;
    icon?: string | null;
    priority: number;
    isSystem: boolean;
    unreadCount?: number;
    createdAt: Date;
}
