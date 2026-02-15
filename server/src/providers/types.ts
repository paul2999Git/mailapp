import type { ProviderType, EmailAddress, AttachmentMeta } from '@mailhub/shared';

/**
 * Normalized email message structure returned by all providers
 */
export interface NormalizedMessage {
    providerMessageId: string;
    messageIdHeader: string | null;
    inReplyTo: string | null;
    referencesHeader: string | null;

    subject: string | null;
    from: EmailAddress;
    to: EmailAddress[];
    cc: EmailAddress[];
    bcc: EmailAddress[];
    replyTo: string | null;

    dateSent: Date | null;
    dateReceived: Date;

    bodyText: string | null;
    bodyHtml: string | null;
    bodyPreview: string | null;

    hasAttachments: boolean;
    attachments: AttachmentMeta[];
    fullAttachments?: Attachment[]; // Used for forwarding/downloading, contains actual buffers
    sizeBytes: number | null;

    isRead: boolean;
    isStarred: boolean;
    isDraft: boolean;

    providerLabels: string[];
    folderId: string | null;
}

/**
 * Folder structure from provider
 */
export interface NormalizedFolder {
    providerFolderId: string;
    name: string;
    fullPath: string | null;
    folderType: 'inbox' | 'sent' | 'drafts' | 'trash' | 'spam' | 'archive' | 'custom';
    isSystem: boolean;
    messageCount: number;
    unreadCount: number;
}

/**
 * Full attachment with content
 */
export interface Attachment extends AttachmentMeta {
    content: Buffer;
}

/**
 * Sync result from provider
 */
export interface SyncResult {
    messages: NormalizedMessage[];
    folders: NormalizedFolder[];
    newCursor: string | null;
    hasMore: boolean;
    stats: {
        messagesProcessed: number;
        messagesNew: number;
        messagesUpdated: number;
    };
}

/**
 * Connection config for each provider type
 */
export interface OAuthConfig {
    type: 'oauth';
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
}

export interface ImapConfig {
    type: 'imap';
    host: string;
    port: number;
    username: string;
    password: string;
    tls: boolean;
}

export type ConnectionConfig = OAuthConfig | ImapConfig;

/**
 * Provider adapter interface - all email providers must implement this
 */
export interface IProviderAdapter {
    readonly provider: ProviderType;

    /**
     * Test connection to the provider
     */
    testConnection(): Promise<{ success: boolean; error?: string }>;

    /**
     * Fetch list of folders/labels from provider
     */
    fetchFolders(): Promise<NormalizedFolder[]>;

    /**
     * Sync messages from provider
     * @param cursor Optional cursor from previous sync for incremental updates
     * @param folderId Optional folder to sync (if null, syncs all)
     * @param since Optional date to sync from (e.g. last 14 days)
     */
    syncMessages(cursor?: string | null, folderId?: string | null, since?: Date): Promise<SyncResult>;

    /**
     * Fetch a single message by ID with full content
     */
    fetchMessage(providerMessageId: string): Promise<NormalizedMessage | null>;

    /**
     * Mark message as read/unread
     */
    markRead(providerMessageId: string, isRead: boolean): Promise<void>;

    /**
     * Star/unstar a message
     */
    markStarred(providerMessageId: string, isStarred: boolean): Promise<void>;

    /**
     * Move message to a folder
     */
    moveToFolder(providerMessageId: string, folderId: string): Promise<void>;

    /**
     * Move message to trash
     */
    moveToTrash(providerMessageId: string): Promise<void>;

    /**
     * Archive a message (provider-specific behavior)
     */
    archive(providerMessageId: string): Promise<void>;

    /**
     * Create a new folder/label
     */
    createFolder(name: string): Promise<NormalizedFolder>;

    /**
     * Create a draft (NOT send - we only save drafts)
     */
    saveDraft(to: EmailAddress[], subject: string, body: string, inReplyTo?: string): Promise<string>;

    /**
     * Send an email message
     */
    sendMail(
        to: EmailAddress[],
        subject: string,
        body: string,
        options?: {
            cc?: EmailAddress[],
            bcc?: EmailAddress[],
            inReplyTo?: string,
            attachments?: Attachment[]
        }
    ): Promise<void>;

    /**
     * Fetch attachment content
     */
    fetchAttachment(providerMessageId: string, attachmentName: string): Promise<{ content: Buffer, contentType: string }>;

    /**
     * Refresh OAuth tokens if needed
     * @returns New connection config with refreshed tokens, or null if not applicable
     */
    refreshTokens?(): Promise<OAuthConfig | null>;

    /**
     * Disconnect and cleanup
     */
    disconnect(): Promise<void>;
}

/**
 * Factory function type for creating provider adapters
 */
export type ProviderAdapterFactory = (
    accountId: string,
    config: ConnectionConfig
) => IProviderAdapter;
