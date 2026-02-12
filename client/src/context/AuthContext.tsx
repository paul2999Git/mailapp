import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authApi } from '../api/auth';
import type { AuthUser, UserSettings } from '@mailhub/shared';

interface UserWithSettings extends AuthUser {
    settings: UserSettings;
}

interface AuthContextType {
    user: UserWithSettings | null;
    isLoading: boolean;
    login: (email: string, password: string) => Promise<void>;
    register: (email: string, password: string, displayName?: string) => Promise<void>;
    logout: () => void;
    updateSettings: (settings: Partial<UserSettings>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<UserWithSettings | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Check for existing token on mount
    useEffect(() => {
        const token = localStorage.getItem('token');
        if (token) {
            authApi.getMe()
                .then((userData) => {
                    setUser(userData as UserWithSettings);
                })
                .catch(() => {
                    localStorage.removeItem('token');
                })
                .finally(() => {
                    setIsLoading(false);
                });
        } else {
            setIsLoading(false);
        }
    }, []);

    const login = async (email: string, password: string) => {
        const response = await authApi.login(email, password);
        localStorage.setItem('token', response.token);
        const userData = await authApi.getMe();
        setUser(userData as UserWithSettings);
    };

    const register = async (email: string, password: string, displayName?: string) => {
        const response = await authApi.register(email, password, displayName);
        localStorage.setItem('token', response.token);
        const userData = await authApi.getMe();
        setUser(userData as UserWithSettings);
    };

    const logout = () => {
        localStorage.removeItem('token');
        setUser(null);
    };

    const updateSettings = async (settingsChange: Partial<UserSettings>) => {
        if (!user) return;
        const newSettings = { ...user.settings, ...settingsChange };
        const userData = await authApi.updateSettings(newSettings);
        setUser(userData as UserWithSettings);
    };

    return (
        <AuthContext.Provider value={{ user, isLoading, login, register, logout, updateSettings }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuthContext() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuthContext must be used within an AuthProvider');
    }
    return context;
}
