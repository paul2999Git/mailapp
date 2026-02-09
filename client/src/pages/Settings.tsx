import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { apiRequest } from '../api/client';
import type { AIProviderType } from '@mailhub/shared';

export default function Settings() {
    const { user, updateSettings } = useAuth();
    const settings = user?.settings;

    const handleAiProviderChange = async (provider: AIProviderType) => {
        await updateSettings({ aiProvider: provider });
    };

    const handleAggressivenessChange = async (level: 'low' | 'medium' | 'high') => {
        await updateSettings({ aggressiveness: level });
    };

    const handleBodyPreviewChange = async (chars: number) => {
        await updateSettings({ bodyPreviewChars: chars });
    };

    const [addingAccount, setAddingAccount] = useState(false);

    const handleAddAccount = async () => {
        if (!user) return;
        setAddingAccount(true);
        try {
            const { url } = await apiRequest<{ url: string }>('GET', `/oauth/google/url?userId=${user.id}`);
            window.location.href = url;
        } catch {
            setAddingAccount(false);
        }
    };

    return (
        <div>
            <header className="header">
                <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>Settings</h2>
            </header>

            <div style={{ padding: 'var(--space-6)', maxWidth: 800 }}>
                <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
                    <h3 style={{ marginBottom: 'var(--space-5)' }}>AI Classification</h3>

                    <div className="form-group">
                        <label className="form-label">AI Provider</label>
                        <div className="flex gap-2">
                            {(['gemini', 'claude', 'openai'] as AIProviderType[]).map((provider) => (
                                <button
                                    key={provider}
                                    className={`btn ${settings?.aiProvider === provider ? 'btn-primary' : 'btn-secondary'}`}
                                    onClick={() => handleAiProviderChange(provider)}
                                >
                                    {provider.charAt(0).toUpperCase() + provider.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="form-label">Classification Aggressiveness</label>
                        <p className="text-sm text-muted" style={{ marginBottom: 'var(--space-3)' }}>
                            Higher aggressiveness means more emails will be auto-categorized
                        </p>
                        <div className="flex gap-2">
                            {(['low', 'medium', 'high'] as const).map((level) => (
                                <button
                                    key={level}
                                    className={`btn ${settings?.aggressiveness === level ? 'btn-primary' : 'btn-secondary'}`}
                                    onClick={() => handleAggressivenessChange(level)}
                                >
                                    {level.charAt(0).toUpperCase() + level.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Body Preview Characters</label>
                        <p className="text-sm text-muted" style={{ marginBottom: 'var(--space-3)' }}>
                            Number of email body characters sent to AI for classification (not used for Proton Mail)
                        </p>
                        <select
                            className="form-input"
                            value={settings?.bodyPreviewChars || 500}
                            onChange={(e) => handleBodyPreviewChange(parseInt(e.target.value))}
                            style={{ maxWidth: 200 }}
                        >
                            <option value={100}>100 characters</option>
                            <option value={250}>250 characters</option>
                            <option value={500}>500 characters</option>
                            <option value={750}>750 characters</option>
                            <option value={1000}>1000 characters</option>
                        </select>
                    </div>
                </div>

                <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
                    <h3 style={{ marginBottom: 'var(--space-5)' }}>Email Accounts</h3>
                    <button
                        className="btn btn-primary"
                        onClick={handleAddAccount}
                        disabled={addingAccount}
                    >
                        {addingAccount ? 'Redirecting...' : '+ Add Account'}
                    </button>
                </div>

                <div className="card">
                    <h3 style={{ marginBottom: 'var(--space-5)' }}>Learned Rules</h3>
                    <p className="text-muted">View and manage your classification rules...</p>
                </div>
            </div>
        </div>
    );
}
