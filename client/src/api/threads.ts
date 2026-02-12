import { apiRequest } from './client';
import type { PaginatedResponse } from '@mailhub/shared';

export interface ThreadItem {
    id: string;
    subjectNormalized: string;
    participantEmails: string[];
    lastMessageDate: string;
    messageCount: number;
    unreadCount: number;
    hasAttachments: boolean;
    primaryCategory: string | null;
    messages: Array<{
        id: string;
        fromName: string;
        fromAddress: string;
        bodyPreview: string;
        account: {
            emailAddress: string;
        };
    }>;
}

interface ThreadFilters {
    accountId?: string;
    folderId?: string;
    category?: string;
    isInbox?: boolean;
    isUnread?: boolean;
    isStarred?: boolean;
    page?: number;
    pageSize?: number;
}

export const threadsApi = {
    list: (filters: ThreadFilters = {}) => {
        const params = new URLSearchParams();
        if (filters.accountId) params.set('accountId', filters.accountId);
        if (filters.folderId) params.set('folderId', filters.folderId);
        if (filters.category) params.set('category', filters.category);
        if (filters.isInbox) params.set('isInbox', 'true');
        if (filters.isUnread) params.set('isUnread', 'true');
        if (filters.isStarred) params.set('isStarred', 'true');
        if (filters.page) params.set('page', String(filters.page));
        if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

        return apiRequest<PaginatedResponse<ThreadItem>>('GET', `/threads?${params}`);
    },

    get: (id: string) =>
        apiRequest<ThreadItem>('GET', `/threads/${id}`),

    batch: (threadIds: string[], action: 'delete' | 'markRead' | 'markUnread') =>
        apiRequest<{ updated: number }>('POST', '/threads/batch', { threadIds, action }),
};
