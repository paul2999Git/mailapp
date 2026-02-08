import { apiRequest } from './client';
import type { AuthUser, UserSettings } from '@mailhub/shared';

interface LoginResponse {
    user: AuthUser;
    token: string;
}

interface UserWithSettings extends AuthUser {
    settings: UserSettings;
    createdAt: string;
    _count: { accounts: number };
}

export const authApi = {
    register: (email: string, password: string, displayName?: string) =>
        apiRequest<LoginResponse>('POST', '/auth/register', { email, password, displayName }),

    login: (email: string, password: string) =>
        apiRequest<LoginResponse>('POST', '/auth/login', { email, password }),

    getMe: () =>
        apiRequest<UserWithSettings>('GET', '/auth/me'),

    updateSettings: (settings: Partial<UserSettings>) =>
        apiRequest<UserWithSettings>('PUT', '/auth/settings', { settings }),
};
