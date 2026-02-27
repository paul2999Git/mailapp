import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, RefreshCw, Loader2, Pencil, Plus, X, Check } from 'lucide-react';
import { apiRequest } from '../api/client';
import { authApi } from '../api/auth';
import { useAuth } from '../hooks/useAuth';
import { Toast } from '../components/Toast';
import type { ICategory, AIProviderType } from '@mailhub/shared';

function ChangePasswordSection() {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async () => {
        setStatus(null);
        if (newPassword.length < 8) {
            setStatus({ type: 'error', message: 'New password must be at least 8 characters' });
            return;
        }
        if (newPassword !== confirmPassword) {
            setStatus({ type: 'error', message: 'New passwords do not match' });
            return;
        }
        setIsSubmitting(true);
        try {
            await authApi.changePassword(currentPassword, newPassword);
            setStatus({ type: 'success', message: 'Password changed successfully' });
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } catch (err) {
            setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Failed to change password' });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="card" style={{ marginTop: 'var(--space-5)' }}>
            <h3 style={{ margin: '0 0 var(--space-4) 0', fontSize: 'var(--font-size-md)' }}>Change Password</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', maxWidth: '400px' }}>
                <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" htmlFor="currentPassword">Current Password</label>
                    <input
                        id="currentPassword"
                        type="password"
                        className="form-input"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="Enter current password"
                    />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" htmlFor="newPassword">New Password</label>
                    <input
                        id="newPassword"
                        type="password"
                        className="form-input"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Min 8 characters"
                    />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" htmlFor="confirmPassword">Confirm New Password</label>
                    <input
                        id="confirmPassword"
                        type="password"
                        className="form-input"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter new password"
                    />
                </div>
                {status && (
                    <div style={{
                        padding: 'var(--space-2) var(--space-3)',
                        borderRadius: 'var(--radius-md)',
                        fontSize: 'var(--font-size-sm)',
                        background: status.type === 'success' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                        color: status.type === 'success' ? 'var(--color-success, #22c55e)' : 'var(--color-danger)',
                        border: `1px solid ${status.type === 'success' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                    }}>
                        {status.message}
                    </div>
                )}
                <button
                    className="btn btn-primary"
                    onClick={handleSubmit}
                    disabled={isSubmitting || !currentPassword || !newPassword || !confirmPassword}
                    style={{ alignSelf: 'flex-start' }}
                >
                    {isSubmitting ? 'Changing...' : 'Change Password'}
                </button>
            </div>
        </div>
    );
}

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

    const [prompt, setPrompt] = useState(settings?.classificationPrompt || '');
    const [newCatName, setNewCatName] = useState('');
    const [isCreatingCat, setIsCreatingCat] = useState(false);

    const queryClient = useQueryClient();

    const { data: categories, refetch: refetchCategories } = useQuery({
        queryKey: ['categories'],
        queryFn: () => apiRequest<ICategory[]>('GET', '/classification/categories'),
    });

    const deleteCategoryMutation = useMutation({
        mutationFn: (id: string) => apiRequest('DELETE', `/classification/categories/${id}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['categories'] });
        },
    });

    const [confirmToast, setConfirmToast] = useState<{
        open: boolean;
        title: string;
        description: string;
        actionLabel: string;
        onConfirm: () => void;
    }>({
        open: false,
        title: '',
        description: '',
        actionLabel: '',
        onConfirm: () => { },
    });

    const handleDeleteCategory = (cat: ICategory) => {
        setConfirmToast({
            open: true,
            title: 'Delete Category',
            description: `Are you sure you want to delete the "${cat.name}" category? The AI will no longer use it for classification.`,
            actionLabel: 'Delete',
            onConfirm: () => {
                deleteCategoryMutation.mutate(cat.id);
                setConfirmToast(prev => ({ ...prev, open: false }));
            }
        });
    };

    const bulkClassifyMutation = useMutation({
        mutationFn: () => apiRequest('POST', '/classification/bulk-classify'),
        onSuccess: (data: any) => {
            setConfirmToast({
                open: true,
                title: 'Classification Started',
                description: `Successfully queued ${data.queued} messages for AI classification. This may take a few minutes.`,
                actionLabel: 'OK',
                onConfirm: () => setConfirmToast(prev => ({ ...prev, open: false }))
            });
        }
    });

    const syncProviderMovesMutation = useMutation({
        mutationFn: () => apiRequest<any>('POST', '/classification/sync-provider-moves'),
        onSuccess: (data: any) => {
            setConfirmToast({
                open: true,
                title: 'Provider Sync Started',
                description: `Syncing ${data.queued} categorized messages to their provider folders. This runs in the background.`,
                actionLabel: 'OK',
                onConfirm: () => setConfirmToast(prev => ({ ...prev, open: false }))
            });
        }
    });

    const { data: rules, refetch: refetchRules } = useQuery({
        queryKey: ['rules'],
        queryFn: () => apiRequest<any[]>('GET', '/classification/rules'),
    });

    const deleteRuleMutation = useMutation({
        mutationFn: (id: string) => apiRequest('DELETE', `/classification/rules/${id}`),
        onSuccess: () => {
            refetchRules();
        }
    });

    const createRuleMutation = useMutation({
        mutationFn: (data: any) => apiRequest('POST', '/classification/rules', data),
        onSuccess: () => {
            refetchRules();
            setShowCreateRule(false);
            setNewRule({ matchType: 'sender_email', matchValue: '', targetCategoryId: '', targetFolderId: '', accountId: '' });
        }
    });

    const updateRuleMutation = useMutation({
        mutationFn: ({ id, ...data }: any) => apiRequest('PUT', `/classification/rules/${id}`, data),
        onSuccess: () => {
            refetchRules();
            setEditingRuleId(null);
        }
    });

    const [showCreateRule, setShowCreateRule] = useState(false);
    const [newRule, setNewRule] = useState({ matchType: 'sender_email', matchValue: '', targetCategoryId: '', targetFolderId: '', accountId: '' });
    const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
    const [editingRule, setEditingRule] = useState<any>({});

    const { data: stats, refetch: refetchStats } = useQuery({
        queryKey: ['classification-stats'],
        queryFn: () => apiRequest<any>('GET', '/classification/stats'),
        refetchInterval: (query) => {
            const data = query.state.data;
            if (data?.queue && (data.queue.waiting > 0 || data.queue.active > 0)) {
                return 1500; // Poll every 1.5s while active
            }
            return 10000; // Poll every 10s otherwise to check for background tasks
        }
    });

    // Track when classification finishes to show a "Done" signal
    const [justFinished, setJustFinished] = useState(false);
    const [prevQueueCount, setPrevQueueCount] = useState(0);

    useEffect(() => {
        if (stats?.queue) {
            const currentCount = stats.queue.waiting + stats.queue.active;
            if (prevQueueCount > 0 && currentCount === 0) {
                setJustFinished(true);
                queryClient.invalidateQueries({ queryKey: ['messages'] });
                setTimeout(() => setJustFinished(false), 5000);
            }
            setPrevQueueCount(currentCount);
        }
    }, [stats, prevQueueCount, queryClient]);

    const resetQueueMutation = useMutation({
        mutationFn: () => apiRequest('POST', '/classification/reset-queue'),
        onSuccess: () => {
            refetchStats();
        }
    });

    const handleCreateCategory = async () => {
        if (!newCatName.trim()) return;
        setIsCreatingCat(true);
        try {
            await apiRequest('POST', '/classification/categories', { name: newCatName });
            setNewCatName('');
            await refetchCategories();
        } finally {
            setIsCreatingCat(false);
        }
    };

    const handlePromptSave = async () => {
        await updateSettings({ classificationPrompt: prompt });
    };

    const handlePromptReset = async () => {
        const defaultPrompt = `
You are an expert email triage assistant. Your task is to classify an incoming email into exactly one of the provided categories.

AVAILABLE CATEGORIES:
{{categories}}

EMAIL DATA:
From: {{from}}
Subject: {{subject}}
Date: {{date}}
Body Preview: {{body}}
Attachment Types: {{attachments}}
Is Reply: {{isReply}}

ANALYSIS INSTRUCTIONS:
1. Carefully analyze the sender, subject, and body.
2. Consider the tone and purpose of the email.
3. Choose the most appropriate category ID from the list above.
4. If you are uncertain (confidence < 0.7), flag it for human review.

RESPONSE FORMAT:
Respond exactly in this JSON format:
{
  "categoryId": "the-id-of-the-category",
  "confidence": 0.95,
  "explanation": "Brief explanation of why this category was chosen",
  "factors": ["list of key words or patterns identified"],
  "suggestedAction": "inbox"
}
`.trim();
        setPrompt(defaultPrompt);
        await updateSettings({ classificationPrompt: defaultPrompt });
    };

    const [addingAccount, setAddingAccount] = useState(false);
    const [addAccountError, setAddAccountError] = useState<string | null>(null);
    const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
    const [expiredAuthAccounts, setExpiredAuthAccounts] = useState<Set<string>>(new Set());
    const [imapDetails, setImapDetails] = useState({
        emailAddress: '',
        imapHost: '',
        imapPort: 993,
        imapUsername: '',
        imapPassword: '',
        provider: 'imap'
    });
    const [editingAccount, setEditingAccount] = useState<{ id: string; provider: string; emailAddress: string } | null>(null);
    const [editCredentials, setEditCredentials] = useState({ imapHost: '', imapPort: 1143, imapUsername: '', imapPassword: '' });
    const [savingCredentials, setSavingCredentials] = useState(false);

    const { data: accounts, refetch: refetchAccounts } = useQuery({
        queryKey: ['accounts'],
        queryFn: () => apiRequest<any[]>('GET', '/accounts'),
    });

    const { data: folders } = useQuery({
        queryKey: ['folders'],
        queryFn: () => apiRequest<any[]>('GET', '/folders'),
    });

    const handleAddAccountGoogle = async () => {
        if (!user) return;
        setAddingAccount(true);
        try {
            const { url } = await apiRequest<{ url: string }>('GET', `/oauth/google/url?userId=${user.id}`);
            window.location.href = url;
        } catch {
            setAddingAccount(true); // Keep state or show error
        }
    };

    const handleAddAccountZoho = async () => {
        if (!user) return;
        setAddingAccount(true);
        try {
            const { url } = await apiRequest<{ url: string }>('GET', `/oauth/zoho/url?userId=${user.id}`);
            window.location.href = url;
        } catch {
            setAddingAccount(true);
        }
    };

    const handleAddAccountImap = async () => {
        setAddingAccount(true);
        setAddAccountError(null);
        try {
            await apiRequest('POST', '/accounts', imapDetails);
            setSelectedProvider(null);
            await refetchAccounts();
        } catch (err: any) {
            const msg = err?.response?.data?.error?.message || err?.message || 'Failed to add account';
            setAddAccountError(msg);
        } finally {
            setAddingAccount(false);
        }
    };

    const handleEditCredentials = (acc: any) => {
        setEditingAccount({ id: acc.id, provider: acc.provider, emailAddress: acc.emailAddress });
        setEditCredentials({
            imapHost: '127.0.0.1',
            imapPort: acc.provider === 'proton' ? 1144 : 993,
            imapUsername: acc.emailAddress,
            imapPassword: '',
        });
    };

    const handleSaveCredentials = async () => {
        if (!editingAccount) return;
        setSavingCredentials(true);
        try {
            await apiRequest('PATCH', `/accounts/${editingAccount.id}`, {
                imapHost: editCredentials.imapHost,
                imapPort: editCredentials.imapPort,
                imapUsername: editCredentials.imapUsername,
                imapPassword: editCredentials.imapPassword || undefined,
            });
            setEditingAccount(null);
            await refetchAccounts();
            // Trigger sync to immediately validate new credentials
            handleSyncNow(editingAccount.id);
        } catch (err: any) {
            alert(err?.response?.data?.error?.message || err?.message || 'Failed to save credentials');
        } finally {
            setSavingCredentials(false);
        }
    };

    const handleDisconnect = async (id: string) => {
        if (!confirm('Are you sure you want to disconnect this account? All messages will be localy deleted.')) return;
        await apiRequest('DELETE', `/accounts/${id}`);
        await refetchAccounts();
    };

    const handleSyncNow = async (id: string) => {
        try {
            await apiRequest('POST', `/accounts/${id}/sync`);
            setExpiredAuthAccounts(prev => { const next = new Set(prev); next.delete(id); return next; });
            await refetchAccounts();
        } catch (error: any) {
            const code = error.response?.data?.error?.code || '';
            const message = error.response?.data?.error?.message || error.message || 'Sync failed';
            if (code === 'AUTH_EXPIRED' || message.includes('authentication has expired')) {
                setExpiredAuthAccounts(prev => new Set([...prev, id]));
            } else {
                alert(`Sync Failed: ${message}`);
            }
        }
    };

    const handleReconnectOAuth = async (provider: 'gmail' | 'zoho') => {
        if (!user) return;
        const endpoint = provider === 'gmail' ? 'google' : 'zoho';
        const { url } = await apiRequest<{ url: string }>('GET', `/oauth/${endpoint}/url?userId=${user.id}`);
        window.location.href = url;
    };


    const handleAiModelChange = async (model: string) => {
        await updateSettings({ aiModel: model });
    };

    return (
        <div>
            <header className="header">
                <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>Settings</h2>
            </header>

            <div style={{ padding: 'var(--space-6)', width: '100%', maxWidth: '1400px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
                <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
                    <h3 style={{ marginBottom: 'var(--space-5)' }}>AI Classification</h3>

                    <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
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

                    {settings?.aiProvider === 'gemini' && (
                        <div className="form-group" style={{ marginBottom: '--space-4' }}>
                            <label className="form-label">Gemini Model</label>
                            <div className="flex gap-2 flex-wrap">
                                {[
                                    { id: 'gemini-flash-latest', name: 'Flash (Fastest)' },
                                ].map((model) => (
                                    <button
                                        key={model.id}
                                        className={`btn btn-sm ${settings?.aiModel === model.id ? 'btn-primary' : 'btn-secondary'}`}
                                        onClick={() => handleAiModelChange(model.id)}
                                    >
                                        {model.name}
                                    </button>
                                ))}
                            </div>
                            <p className="text-xs text-muted" style={{ marginTop: 'var(--space-1)' }}>
                                Note: Restricted to Flash Latest for stability.
                            </p>
                        </div>
                    )}

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

                    <div className="form-group" style={{ marginBottom: 'var(--space-6)' }}>
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

                    <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-5)' }}>
                        <h4 style={{ marginBottom: 'var(--space-3)' }}>Maintenance</h4>

                        {((stats && (stats.queue.waiting > 0 || stats.queue.active > 0)) || justFinished) && (
                            <div style={{ marginBottom: 'var(--space-5)', background: 'var(--color-bg-tertiary)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                                <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-2)' }}>
                                    <span style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)', display: 'flex', alignItems: 'center' }}>
                                        {justFinished ? (
                                            <span style={{ color: 'var(--color-success)' }}>✅ Classification Complete!</span>
                                        ) : (
                                            <>
                                                <Loader2 size={14} className="animate-spin" style={{ marginRight: 8 }} />
                                                Classification Progress
                                            </>
                                        )}
                                    </span>
                                    <span className="text-sm text-muted">{stats.classified} / {stats.total} messages categorized</span>
                                </div>
                                <div style={{ height: 8, background: 'var(--color-bg-primary)', borderRadius: 4, overflow: 'hidden' }}>
                                    <div style={{
                                        height: '100%',
                                        background: justFinished ? 'var(--color-success)' : 'var(--color-primary)',
                                        width: `${(stats.classified / stats.total) * 100}%`,
                                        transition: 'width 0.5s ease-out'
                                    }} />
                                </div>
                                {!justFinished && (
                                    <div className="text-xs text-muted" style={{ marginTop: 'var(--space-2)' }}>
                                        {stats.unclassified} messages still need a category
                                        {stats.queue.waiting > 0 && ` · ${stats.queue.waiting} AI jobs queued`}
                                        {stats.queue.active > 0 && ` · ${stats.queue.active} running now`}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-4)' }}>
                            <div>
                                <div style={{ fontWeight: 500 }}>Bulk Classify</div>
                                <div className="text-sm text-muted">Process all existing unclassified messages through the AI.</div>
                            </div>
                            <div className="flex gap-2">
                                {stats?.queue.failed > 0 && (
                                    <button
                                        className="btn btn-ghost btn-sm"
                                        style={{ color: 'var(--color-danger)' }}
                                        onClick={() => resetQueueMutation.mutate()}
                                        title="Clear failed jobs"
                                    >
                                        <RefreshCw size={14} style={{ marginRight: 4 }} />
                                        Retry Failed ({stats.queue.failed})
                                    </button>
                                )}
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => bulkClassifyMutation.mutate()}
                                    disabled={bulkClassifyMutation.isPending || (stats?.queue.waiting > 0 || stats?.queue.active > 0)}
                                >
                                    {bulkClassifyMutation.isPending ? 'Queuing...' : 'Run Now'}
                                </button>
                            </div>
                        </div>

                        <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-4)' }}>
                            <div>
                                <div style={{ fontWeight: 500 }}>Sync Provider Folders</div>
                                <div className="text-sm text-muted">Move all categorized messages to their matching folders on Gmail/IMAP. Use this if emails are categorized in MailHub but still appear in your provider's inbox.</div>
                            </div>
                            <button
                                className="btn btn-secondary"
                                onClick={() => syncProviderMovesMutation.mutate()}
                                disabled={syncProviderMovesMutation.isPending}
                            >
                                {syncProviderMovesMutation.isPending ? 'Starting...' : 'Sync Now'}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="card">
                    <h3 style={{ marginBottom: 'var(--space-5)' }}>Email Training (Prompt)</h3>
                    <p className="text-sm text-muted" style={{ marginBottom: 'var(--space-3)' }}>
                        Customize instructions given to Gemini for email classification.
                    </p>
                    <textarea
                        className="form-input"
                        rows={8}
                        style={{ fontFamily: 'monospace', fontSize: '13px', marginBottom: 'var(--space-4)' }}
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                    />
                    <div className="flex gap-2">
                        <button className="btn btn-primary btn-sm" onClick={handlePromptSave}>
                            Save Prompt
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={handlePromptReset}>
                            Reset to Default
                        </button>
                    </div>
                </div>


                <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
                    <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-5)' }}>
                        <h3 style={{ margin: 0 }}>Email Accounts</h3>
                        <button
                            className="btn btn-primary btn-sm"
                            onClick={() => setSelectedProvider('select')}
                        >
                            + Add Account
                        </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 'var(--space-3)' }}>
                        {accounts?.map(acc => {
                            const isExpired = expiredAuthAccounts.has(acc.id);
                            const isOAuth = acc.provider === 'gmail' || acc.provider === 'zoho';
                            return (
                            <div key={acc.id} className="card flex justify-between items-center hover-trigger" style={{ padding: 'var(--space-2) var(--space-4)', background: 'var(--color-bg-tertiary)', minHeight: '64px', border: `1px solid ${isExpired ? 'var(--color-danger)' : 'var(--color-border)'}` }}>
                                <div className="flex items-center gap-3 overflow-hidden" style={{ flex: 1 }}>
                                    <span style={{ fontSize: '18px', flexShrink: 0 }}>
                                        {acc.provider === 'gmail' ? '🇬' : acc.provider === 'zoho' ? '🇿' : acc.provider === 'proton' ? '🇵' : acc.provider === 'hover' ? '🇭' : '📧'}
                                    </span>
                                    <div className="overflow-hidden">
                                        <div style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{acc.emailAddress}</div>
                                        <div className="text-sm text-muted" style={{ fontSize: '11px' }}>
                                            {isExpired
                                                ? <span style={{ color: 'var(--color-danger)' }}>Auth expired — reconnect required</span>
                                                : acc.lastSyncAt ? `Last sync: ${new Date(acc.lastSyncAt).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })} ET` : 'Never synced'}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex gap-1 flex-shrink-0">
                                    {isExpired && isOAuth && (
                                        <button
                                            className="btn btn-sm"
                                            style={{ background: 'var(--color-danger)', color: '#fff', fontSize: '11px' }}
                                            onClick={() => handleReconnectOAuth(acc.provider as 'gmail' | 'zoho')}
                                            title="Reconnect account"
                                        >
                                            Reconnect
                                        </button>
                                    )}
                                    {!isOAuth && (
                                        <button className="btn btn-ghost btn-sm" title="Edit credentials" onClick={() => handleEditCredentials(acc)}>✏️</button>
                                    )}
                                    <button className="btn btn-ghost btn-sm" title="Sync Now" onClick={() => handleSyncNow(acc.id)}>🔄</button>
                                    <button className="btn btn-ghost btn-sm" title="Disconnect" style={{ color: 'var(--color-danger)' }} onClick={() => handleDisconnect(acc.id)}>🗑️</button>
                                </div>
                            </div>
                            );
                        })}
                    </div>

                    {/* Provider Selection Modal */}
                    {selectedProvider === 'select' && (
                        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                            <div className="card" style={{ width: '800px', maxWidth: '95vw', padding: 'var(--space-6)' }}>
                                <h3 style={{ marginBottom: 'var(--space-5)' }}>Choose Provider</h3>
                                <div className="flex flex-col gap-2">
                                    <button className="btn btn-secondary w-full text-left justify-start" onClick={handleAddAccountGoogle}>🇬 Google / Gmail</button>
                                    <button className="btn btn-secondary w-full text-left justify-start" onClick={handleAddAccountZoho}>🇿 Zoho Mail</button>
                                    <button className="btn btn-secondary w-full text-left justify-start" onClick={() => { setImapDetails({ emailAddress: '', imapHost: '127.0.0.1', imapPort: 1144, imapUsername: '', imapPassword: '', provider: 'proton' }); setAddAccountError(null); setSelectedProvider('imap-proton'); }}>📧 Proton Mail (via Bridge)</button>
                                    <button className="btn btn-secondary w-full text-left justify-start" onClick={() => { setImapDetails({ emailAddress: '', imapHost: 'mail.hover.com', imapPort: 993, imapUsername: '', imapPassword: '', provider: 'hover' }); setAddAccountError(null); setSelectedProvider('imap-hover'); }}>📧 Hover</button>
                                    <button className="btn btn-secondary w-full text-left justify-start" onClick={() => { setImapDetails({ emailAddress: '', imapHost: '', imapPort: 993, imapUsername: '', imapPassword: '', provider: 'imap' }); setAddAccountError(null); setSelectedProvider('imap-custom'); }}>🌐 Custom IMAP/SMTP</button>
                                    <button className="btn btn-ghost w-full mt-4" onClick={() => setSelectedProvider(null)}>Cancel</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* IMAP Form Modal */}
                    {selectedProvider?.startsWith('imap-') && (
                        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                            <div className="card" style={{ width: '900px', maxWidth: '98vw', padding: 'var(--space-5)' }}>
                                {/* Title row with action buttons */}
                                <div className="flex items-center gap-3" style={{ marginBottom: 'var(--space-4)' }}>
                                    <h3 style={{ margin: 0, flex: 1, fontSize: 'var(--font-size-md)' }}>
                                        {selectedProvider === 'imap-proton' ? 'Connect Proton Mail (via Bridge)' : 'Connect via IMAP'}
                                    </h3>
                                    <button
                                        className="btn btn-primary"
                                        style={{ fontSize: '11px', padding: '4px 10px', height: 'auto' }}
                                        onClick={handleAddAccountImap}
                                        disabled={addingAccount}
                                    >
                                        {addingAccount ? 'Connecting...' : 'Connect Account'}
                                    </button>
                                    <button
                                        className="btn btn-secondary"
                                        style={{ fontSize: '11px', padding: '4px 10px', height: 'auto' }}
                                        onClick={() => setSelectedProvider('select')}
                                    >
                                        Back
                                    </button>
                                </div>

                                {selectedProvider === 'imap-proton' && (
                                    <div style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', marginBottom: 'var(--space-4)', fontSize: '12px', lineHeight: 1.5 }}>
                                        <strong>Proton Bridge must be running on this server.</strong> Use the <strong>IMAP password from Bridge</strong> (not your Proton account password).
                                        Find it in Bridge → "Mailbox configuration" after logging in.
                                        Defaults: host <code>127.0.0.1</code>, IMAP port <code>1144</code>, SMTP port <code>1025</code>.
                                    </div>
                                )}

                                {/* Labels row */}
                                <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr 100px 2fr 2fr', gap: '8px', marginBottom: '4px' }}>
                                    {['Email Address', 'IMAP Host', 'Port', 'Username', selectedProvider === 'imap-proton' ? 'Bridge IMAP Password' : 'Password'].map(lbl => (
                                        <span key={lbl} style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{lbl}</span>
                                    ))}
                                </div>

                                {/* Inputs row */}
                                <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr 100px 2fr 2fr', gap: '8px' }}>
                                    <input type="email" className="form-input" value={imapDetails.emailAddress} onChange={e => setImapDetails({ ...imapDetails, emailAddress: e.target.value })} placeholder="you@example.com" />
                                    <input type="text" className="form-input" value={imapDetails.imapHost} onChange={e => setImapDetails({ ...imapDetails, imapHost: e.target.value })} placeholder="127.0.0.1" />
                                    <input type="number" className="form-input" value={imapDetails.imapPort} onChange={e => setImapDetails({ ...imapDetails, imapPort: parseInt(e.target.value) || 993 })} />
                                    <input type="text" className="form-input" value={imapDetails.imapUsername} onChange={e => setImapDetails({ ...imapDetails, imapUsername: e.target.value })} placeholder="your@email.com" />
                                    <input type="password" className="form-input" value={imapDetails.imapPassword} onChange={e => setImapDetails({ ...imapDetails, imapPassword: e.target.value })} placeholder="Bridge password" />
                                </div>

                                {addAccountError && (
                                    <div style={{ color: 'var(--color-danger)', fontSize: '12px', marginTop: '8px', padding: '6px 10px', background: 'rgba(220,38,38,0.1)', borderRadius: 'var(--radius-sm)' }}>
                                        {addAccountError}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Edit IMAP Credentials Modal */}
                    {editingAccount && (
                        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                            <div className="card" style={{ width: '480px', maxWidth: '95vw', padding: 'var(--space-6)' }}>
                                <h3 style={{ marginBottom: 'var(--space-2)' }}>Edit Credentials</h3>
                                <p className="text-sm text-muted" style={{ marginBottom: 'var(--space-4)' }}>{editingAccount.emailAddress}</p>
                                {editingAccount.provider === 'proton' && (
                                    <div style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', marginBottom: 'var(--space-4)', fontSize: '13px' }}>
                                        Use the <strong>IMAP password from Proton Bridge</strong> — not your Proton account password. If Bridge was reinstalled, the password will have changed.
                                    </div>
                                )}
                                <div className="flex flex-col gap-3">
                                    <div className="flex gap-3">
                                        <div className="form-group" style={{ flex: 1 }}>
                                            <label className="form-label">IMAP Host</label>
                                            <input type="text" className="form-input" value={editCredentials.imapHost} onChange={e => setEditCredentials({ ...editCredentials, imapHost: e.target.value })} />
                                        </div>
                                        <div className="form-group" style={{ width: '100px' }}>
                                            <label className="form-label">Port</label>
                                            <input type="number" className="form-input" value={editCredentials.imapPort} onChange={e => setEditCredentials({ ...editCredentials, imapPort: parseInt(e.target.value) || 993 })} />
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Username</label>
                                        <input type="text" className="form-input" value={editCredentials.imapUsername} onChange={e => setEditCredentials({ ...editCredentials, imapUsername: e.target.value })} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">{editingAccount.provider === 'proton' ? 'Bridge IMAP Password' : 'Password'} <span className="text-muted">(leave blank to keep existing)</span></label>
                                        <input type="password" className="form-input" value={editCredentials.imapPassword} onChange={e => setEditCredentials({ ...editCredentials, imapPassword: e.target.value })} placeholder="New password..." />
                                    </div>
                                    <div className="flex gap-2 mt-2">
                                        <button className="btn btn-primary flex-1" onClick={handleSaveCredentials} disabled={savingCredentials}>
                                            {savingCredentials ? 'Saving...' : 'Save & Reconnect'}
                                        </button>
                                        <button className="btn btn-secondary" onClick={() => setEditingAccount(null)}>Cancel</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="card">
                    <h3 style={{ marginBottom: 'var(--space-5)' }}>Categories (Folders)</h3>
                    <p className="text-sm text-muted" style={{ marginBottom: 'var(--space-4)' }}>
                        Manage your custom classification categories.
                    </p>

                    <div className="flex gap-2" style={{ marginBottom: 'var(--space-4)', maxWidth: 400 }}>
                        <input
                            type="text"
                            className="form-input"
                            placeholder="New category name..."
                            value={newCatName}
                            onChange={(e) => setNewCatName(e.target.value)}
                        />
                        <button
                            className="btn btn-primary"
                            onClick={handleCreateCategory}
                            disabled={isCreatingCat || !newCatName.trim()}
                        >
                            Add
                        </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--space-2)' }}>
                        {categories?.map(cat => (
                            <div key={cat.id} className="card hover-trigger" style={{ padding: 'var(--space-2) var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--font-size-sm)', background: 'var(--color-bg-tertiary)', position: 'relative' }}>
                                <span>{cat.icon || '📁'}</span>
                                <span style={{ fontWeight: 400, flex: 1 }}>{cat.name}</span>
                                <button
                                    className="btn btn-ghost btn-sm hover-visible"
                                    style={{ color: 'var(--color-danger)', padding: '2px' }}
                                    onClick={() => handleDeleteCategory(cat)}
                                    title="Delete category"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="card">
                    <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-5)' }}>
                        <div>
                            <h3 style={{ margin: 0 }}>Routing Rules</h3>
                            <p className="text-sm text-muted" style={{ marginTop: 'var(--space-1)' }}>
                                Route emails by sender or domain to categories and folders.
                            </p>
                        </div>
                        <button
                            className="btn btn-primary btn-sm"
                            onClick={() => setShowCreateRule(!showCreateRule)}
                        >
                            {showCreateRule ? <><X size={14} /> Cancel</> : <><Plus size={14} /> Add Rule</>}
                        </button>
                    </div>

                    {showCreateRule && (
                        <div className="card" style={{ padding: 'var(--space-4)', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-primary-light)', marginBottom: 'var(--space-4)' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                                <div className="form-group">
                                    <label className="form-label">Match Type</label>
                                    <select
                                        className="form-input"
                                        value={newRule.matchType}
                                        onChange={e => setNewRule({ ...newRule, matchType: e.target.value })}
                                    >
                                        <option value="sender_email">Sender Email</option>
                                        <option value="sender_domain">Sender Domain</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">
                                        {newRule.matchType === 'sender_domain' ? 'Domain' : 'Email Address'}
                                    </label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        placeholder={newRule.matchType === 'sender_domain' ? 'example.com' : 'user@example.com'}
                                        value={newRule.matchValue}
                                        onChange={e => setNewRule({ ...newRule, matchValue: e.target.value })}
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Category (Optional)</label>
                                    <select
                                        className="form-input"
                                        value={newRule.targetCategoryId}
                                        onChange={e => setNewRule({ ...newRule, targetCategoryId: e.target.value })}
                                    >
                                        <option value="">-- No Category --</option>
                                        {categories?.map(cat => (
                                            <option key={cat.id} value={cat.id}>{cat.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Folder (Optional)</label>
                                    <select
                                        className="form-input"
                                        value={newRule.targetFolderId}
                                        onChange={e => setNewRule({ ...newRule, targetFolderId: e.target.value })}
                                    >
                                        <option value="">-- No Folder --</option>
                                        {folders
                                            ?.filter((f: any) => !newRule.accountId || f.accountId === newRule.accountId)
                                            .map((f: any) => (
                                                <option key={f.id} value={f.id}>
                                                    {newRule.accountId ? f.name : (f.account?.emailAddress ? `${f.name} (${f.account.emailAddress})` : f.name)}
                                                </option>
                                            ))}
                                    </select>
                                </div>
                                <div className="form-group" style={{ gridColumn: 'span 2' }}>
                                    <label className="form-label">Apply Only to Inbox (Optional)</label>
                                    <select
                                        className="form-input"
                                        value={newRule.accountId}
                                        onChange={e => setNewRule({ ...newRule, accountId: e.target.value })}
                                    >
                                        <option value="">-- All Inboxes --</option>
                                        {accounts?.map(acc => (
                                            <option key={acc.id} value={acc.id}>{acc.emailAddress} ({acc.provider})</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div className="flex gap-2" style={{ marginTop: 'var(--space-4)', justifyContent: 'flex-end' }}>
                                <button
                                    className="btn btn-primary"
                                    disabled={!newRule.matchValue.trim() || (!newRule.targetCategoryId && !newRule.targetFolderId) || createRuleMutation.isPending}
                                    onClick={() => createRuleMutation.mutate({
                                        matchType: newRule.matchType,
                                        matchValue: newRule.matchValue,
                                        targetCategoryId: newRule.targetCategoryId || undefined,
                                        targetFolderId: newRule.targetFolderId || undefined,
                                        accountId: newRule.accountId || undefined,
                                    })}
                                >
                                    {createRuleMutation.isPending ? 'Creating...' : 'Create Rule'}
                                </button>
                            </div>
                            {createRuleMutation.isError && (
                                <div className="text-sm" style={{ color: 'var(--color-danger)', marginTop: 'var(--space-2)' }}>
                                    Failed to create rule. Check that the values are valid.
                                </div>
                            )}
                        </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                        {rules?.length === 0 && !showCreateRule && (
                            <div className="text-muted text-sm">No routing rules yet. Click "Add Rule" or categorize emails to create rules automatically.</div>
                        )}
                        {rules?.map(rule => (
                            editingRuleId === rule.id ? (
                                <div key={rule.id} style={{ padding: 'var(--space-3) var(--space-4)', background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-primary)', borderRadius: 'var(--radius-md)' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 100px 1fr', gap: 'var(--space-2)', alignItems: 'center', fontSize: 'var(--font-size-sm)' }}>
                                        <span className="text-muted">{rule.matchType === 'sender_domain' ? 'Domain' : 'Sender'}:</span>
                                        <span style={{ fontWeight: 500 }}>{rule.matchValue}</span>

                                        <span className="text-muted">Inbox:</span>
                                        <span style={{ fontWeight: 500, color: 'var(--color-primary)' }}>
                                            {rule.account?.emailAddress || <span className="text-muted" style={{ fontWeight: 400, fontStyle: 'italic' }}>All Inboxes</span>}
                                        </span>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
                                        <div>
                                            <label className="text-muted" style={{ fontSize: 'var(--font-size-xs)', display: 'block', marginBottom: 4 }}>Category</label>
                                            <select
                                                className="form-input"
                                                style={{ padding: '4px 8px', fontSize: 'var(--font-size-sm)' }}
                                                value={editingRule.targetCategoryId || ''}
                                                onChange={e => setEditingRule({ ...editingRule, targetCategoryId: e.target.value })}
                                            >
                                                <option value="">-- None --</option>
                                                {categories?.map(cat => (
                                                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div>
                                            <label className="text-muted" style={{ fontSize: 'var(--font-size-xs)', display: 'block', marginBottom: 4 }}>Folder</label>
                                            <select
                                                className="form-input"
                                                style={{ padding: '4px 8px', fontSize: 'var(--font-size-sm)' }}
                                                value={editingRule.targetFolderId || ''}
                                                onChange={e => setEditingRule({ ...editingRule, targetFolderId: e.target.value })}
                                            >
                                                <option value="">-- None --</option>
                                                {folders
                                                    ?.filter((f: any) => !rule.accountId || f.accountId === rule.accountId)
                                                    .map((f: any) => (
                                                        <option key={f.id} value={f.id}>
                                                            {rule.accountId ? f.name : (f.account?.emailAddress ? `${f.name} (${f.account.emailAddress})` : f.name)}
                                                        </option>
                                                    ))}
                                            </select>
                                        </div>
                                    </div>

                                    <div className="flex gap-2" style={{ marginTop: 'var(--space-3)', justifyContent: 'flex-end' }}>
                                        <button className="btn btn-ghost btn-sm" onClick={() => setEditingRuleId(null)}>
                                            <X size={14} /> Cancel
                                        </button>
                                        <button
                                            className="btn btn-primary btn-sm"
                                            disabled={updateRuleMutation.isPending}
                                            onClick={() => updateRuleMutation.mutate({
                                                id: rule.id,
                                                targetCategoryId: editingRule.targetCategoryId || undefined,
                                                targetFolderId: editingRule.targetFolderId || undefined,
                                            })}
                                        >
                                            <Check size={14} /> {updateRuleMutation.isPending ? 'Saving...' : 'Save'}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div key={rule.id} className="card flex justify-between items-center" style={{ padding: 'var(--space-2) var(--space-4)', background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)' }}>
                                    <div style={{ fontSize: 'var(--font-size-sm)' }}>
                                        <span className="text-muted">{rule.matchType === 'sender_domain' ? 'Domain' : 'Sender'}: </span>
                                        <span style={{ fontWeight: 500 }}>{rule.matchValue}</span>
                                        {rule.account && (
                                            <span className="text-muted" style={{ marginLeft: 8, fontSize: '11px' }}>
                                                (inbox: {rule.account.emailAddress})
                                            </span>
                                        )}
                                        <span className="text-muted"> → </span>
                                        {rule.targetCategory && (
                                            <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>{rule.targetCategory.name}</span>
                                        )}
                                        {rule.targetCategory && rule.targetFolder && (
                                            <span className="text-muted"> + </span>
                                        )}
                                        {rule.targetFolder && (
                                            <span style={{ fontWeight: 500 }}>{rule.targetFolder.name}</span>
                                        )}
                                        {!rule.targetCategory && !rule.targetFolder && (
                                            <span className="text-muted">No target set</span>
                                        )}
                                        {rule.timesApplied > 0 && (
                                            <span className="text-muted" style={{ marginLeft: 8, fontSize: '11px' }}>
                                                ({rule.timesApplied}x applied)
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex gap-1">
                                        <button
                                            className="btn btn-ghost btn-sm"
                                            onClick={() => {
                                                setEditingRuleId(rule.id);
                                                setEditingRule({
                                                    targetCategoryId: rule.targetCategoryId || '',
                                                    targetFolderId: rule.targetFolderId || '',
                                                });
                                            }}
                                            title="Edit rule"
                                        >
                                            <Pencil size={14} />
                                        </button>
                                        <button
                                            className="btn btn-ghost btn-sm"
                                            style={{ color: 'var(--color-danger)' }}
                                            onClick={() => deleteRuleMutation.mutate(rule.id)}
                                            title="Delete rule"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            )
                        ))}
                    </div>
                </div>
            </div>

            {/* Change Password */}
            <ChangePasswordSection />

            <Toast
                open={confirmToast.open}
                onOpenChange={(open) => setConfirmToast(prev => ({ ...prev, open }))}
                title={confirmToast.title}
                description={confirmToast.description}
                variant="danger"
                action={{
                    label: confirmToast.actionLabel,
                    onClick: confirmToast.onConfirm
                }}
            />
        </div>
    );
}
