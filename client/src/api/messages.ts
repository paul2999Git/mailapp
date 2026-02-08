import { apiRequest } from './client';
import type { PaginatedResponse } from '@mailhub/shared';

export interface MessageItem {
    id: string;
    accountId: string;
    threadId: string | null;
    subject: string;
    fromAddress: string;
    fromName: string;
    dateReceived: string;
    bodyPreview: string;
    hasAttachments: boolean;
    isRead: boolean;
    isStarred: boolean;
    aiCategory: string | null;
    aiConfidence: number | null;
    account: {
        emailAddress: string;
        provider: string;
    };
}

export interface MessageDetail extends MessageItem {
    bodyText: string;
    bodyHtml: string;
    toAddresses: { email: string; name?: string }[];
    ccAddresses: { email: string; name?: string }[] | null;
    dateSent: string;
    currentFolder: { id: string; name: string } | null;
    classifications: Array<{
        id: string;
        confidence: number;
        explanation: string;
        aiModel: string;
        createdAt: string;
    }>;
}

interface MessageFilters {
    accountId?: string;
    folderId?: string;
    category?: string;
    isUnread?: boolean;
    isStarred?: boolean;
    page?: number;
    pageSize?: number;
}

export const messagesApi = {
    list: (filters: MessageFilters = {}) => {
        const params = new URLSearchParams();
        if (filters.accountId) params.set('accountId', filters.accountId);
        if (filters.folderId) params.set('folderId', filters.folderId);
        if (filters.category) params.set('category', filters.category);
        if (filters.isUnread) params.set('isUnread', 'true');
        if (filters.isStarred) params.set('isStarred', 'true');
        if (filters.page) params.set('page', String(filters.page));
        if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

        return apiRequest<PaginatedResponse<MessageItem>>('GET', `/messages?${params}`);
    },

    get: (id: string) =>
        apiRequest<MessageDetail>('GET', `/messages/${id}`),

    update: (id: string, data: { isRead?: boolean; isStarred?: boolean; isHidden?: boolean }) =>
        apiRequest<{ id: string }>('PATCH', `/messages/${id}`, data),

    neverShow: (id: string) =>
        apiRequest<{ hidden: boolean }>('POST', `/messages/${id}/never-show`),

    batch: (messageIds: string[], action: string, data?: { folderId?: string }) =>
        apiRequest<{ updated: number }>('POST', '/messages/batch', { messageIds, action, data }),
};
