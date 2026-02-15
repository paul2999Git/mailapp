import { apiRequest } from './client';
import type { ICategory as Category } from '@mailhub/shared';

export interface RoutingRule {
    id: string;
    userId: string;
    accountId?: string;
    matchType: 'sender_email' | 'sender_domain';
    matchValue: string;
    targetCategoryId?: string;
    targetFolderId?: string;
    action: 'route';
    priority: number;
    confidenceBoost: number; // Decimal in DB, number in JS
    timesApplied: number;
    lastAppliedAt?: string;
    createdAt: string;

    // Relations included in response
    targetCategory?: Category;
    targetFolder?: { id: string; name: string; accountId: string };
    account?: { id: string; emailAddress: string };
}

export interface CreateRuleData {
    matchType: 'sender_email' | 'sender_domain';
    matchValue: string;
    targetCategoryId?: string;
    targetFolderId?: string;
    accountId?: string;
    action?: 'route';
    priority?: number;
}

export interface UpdateRuleData {
    targetCategoryId?: string | null;
    targetFolderId?: string | null;
    accountId?: string | null;
    action?: 'route';
    priority?: number;
}

export const rulesApi = {
    getAll: () =>
        apiRequest<RoutingRule[]>('GET', '/classification/rules'),

    create: (data: CreateRuleData) =>
        apiRequest<RoutingRule>('POST', '/classification/rules', data),

    update: (id: string, data: UpdateRuleData) =>
        apiRequest<RoutingRule>('PUT', `/classification/rules/${id}`, data),

    delete: (id: string) =>
        apiRequest<{ deleted: boolean }>('DELETE', `/classification/rules/${id}`),
};
