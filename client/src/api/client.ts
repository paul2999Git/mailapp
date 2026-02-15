import axios from 'axios';

const API_BASE_URL = '/api';

// Create axios instance
export const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Handle auth and rate limit errors
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('token');
            window.location.href = '/login';
        }
        if (error.response?.status === 429) {
            console.warn('Rate limited by server. Retrying after delay...');
            const retryAfter = parseInt(error.response.headers['retry-after'] || '5', 10) * 1000;
            return new Promise(resolve => setTimeout(resolve, Math.min(retryAfter, 10000)))
                .then(() => api.request(error.config));
        }
        return Promise.reject(error);
    }
);

// Type-safe API response handler
export async function apiRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    data?: unknown
): Promise<T> {
    const response = await api.request<{ success: boolean; data: T; error?: { message: string } }>({
        method,
        url,
        data,
    });

    if (!response.data.success && response.data.error) {
        throw new Error(response.data.error.message);
    }

    return response.data.data;
}
