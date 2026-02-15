import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Pencil, Plus, X, ArrowRight, Folder } from 'lucide-react';
import { rulesApi, type CreateRuleData, type UpdateRuleData, type RoutingRule } from '../api/rules';
import { apiRequest } from '../api/client';
import { Toast } from '../components/Toast';

export default function Rules() {
    const queryClient = useQueryClient();

    const { data: rules } = useQuery({
        queryKey: ['rules'],
        queryFn: rulesApi.getAll,
    });

    const { data: categories } = useQuery({
        queryKey: ['categories'],
        queryFn: () => apiRequest<any[]>('GET', '/classification/categories'),
    });

    const { data: folders } = useQuery({
        queryKey: ['folders'],
        queryFn: () => apiRequest<any[]>('GET', '/folders'),
    });

    const [showCreateRule, setShowCreateRule] = useState(false);
    const [newRule, setNewRule] = useState<CreateRuleData>({
        matchType: 'sender_email',
        matchValue: '',
        action: 'route',
        priority: 50
    });

    const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
    const [editingRule, setEditingRule] = useState<UpdateRuleData>({});

    const [toast, setToast] = useState({ open: false, title: '', description: '', variant: 'default' as 'default' | 'danger' | 'success' });

    const createRuleMutation = useMutation({
        mutationFn: rulesApi.create,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['rules'] });
            setShowCreateRule(false);
            setNewRule({ matchType: 'sender_email', matchValue: '', action: 'route', priority: 50 });
            setToast({ open: true, title: 'Success', description: 'Rule created successfully', variant: 'success' });
        },
        onError: () => {
            setToast({ open: true, title: 'Error', description: 'Failed to create rule', variant: 'danger' });
        }
    });

    const updateRuleMutation = useMutation({
        mutationFn: ({ id, data }: { id: string; data: UpdateRuleData }) => rulesApi.update(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['rules'] });
            setEditingRuleId(null);
            setToast({ open: true, title: 'Success', description: 'Rule updated successfully', variant: 'success' });
        },
        onError: () => {
            setToast({ open: true, title: 'Error', description: 'Failed to update rule', variant: 'danger' });
        }
    });

    const deleteRuleMutation = useMutation({
        mutationFn: rulesApi.delete,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['rules'] });
            setToast({ open: true, title: 'Success', description: 'Rule deleted successfully', variant: 'success' });
        },
        onError: () => {
            setToast({ open: true, title: 'Error', description: 'Failed to delete rule', variant: 'danger' });
        }
    });

    const getFolderName = (folderId?: string) => {
        if (!folderId) return null;
        const folder = folders?.find(f => f.id === folderId);
        return folder ? folder.name : 'Unknown Folder';
    };

    const getCategoryName = (categoryId?: string) => {
        if (!categoryId) return null;
        const category = categories?.find(c => c.id === categoryId);
        return category ? category.name : 'Unknown Category';
    };

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <header className="header">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>Routing Rules</h2>
                        <p className="text-sm text-muted" style={{ marginTop: 'var(--space-1)' }}>
                            Automatically route emails from specific senders to folders or categories.
                        </p>
                    </div>
                    <button
                        className="btn btn-primary btn-sm"
                        onClick={() => setShowCreateRule(!showCreateRule)}
                    >
                        {showCreateRule ? <><X size={14} /> Cancel</> : <><Plus size={14} /> Add Rule</>}
                    </button>
                </div>
            </header>

            <div style={{ padding: 'var(--space-6)', overflowY: 'auto', flex: 1 }}>
                <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

                    {showCreateRule && (
                        <div className="card" style={{ padding: 'var(--space-5)', border: '1px solid var(--color-primary)', background: 'var(--color-bg-tertiary)' }}>
                            <h3 style={{ marginTop: 0, marginBottom: 'var(--space-4)', fontSize: 'var(--font-size-md)' }}>New Routing Rule</h3>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                                <div className="form-group">
                                    <label className="form-label">When an email is from...</label>
                                    <div className="flex gap-2" style={{ marginBottom: 'var(--space-2)' }}>
                                        <select
                                            className="form-input"
                                            style={{ width: '140px' }}
                                            value={newRule.matchType}
                                            onChange={e => setNewRule({ ...newRule, matchType: e.target.value as any })}
                                        >
                                            <option value="sender_email">Email Address</option>
                                            <option value="sender_domain">Domain (@...)</option>
                                        </select>
                                        <input
                                            type="text"
                                            className="form-input"
                                            placeholder={newRule.matchType === 'sender_domain' ? 'examplesite.com' : 'sender@example.com'}
                                            value={newRule.matchValue}
                                            onChange={e => setNewRule({ ...newRule, matchValue: e.target.value })}
                                            style={{ flex: 1 }}
                                        />
                                    </div>
                                    <p className="text-xs text-muted">
                                        {newRule.matchType === 'sender_domain'
                                            ? 'Matches any email from this domain.'
                                            : 'Matches this specific email address exactly.'}
                                    </p>
                                </div>

                                <div className="form-group">
                                    <label className="form-label">Then move it to...</label>

                                    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
                                        <div>
                                            <label className="text-xs text-muted" style={{ display: 'block', marginBottom: '4px' }}>AI Category</label>
                                            <select
                                                className="form-input"
                                                value={newRule.targetCategoryId || ''}
                                                onChange={e => setNewRule({ ...newRule, targetCategoryId: e.target.value || undefined })}
                                            >
                                                <option value="">-- No Category Change --</option>
                                                {categories?.map(cat => (
                                                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div>
                                            <label className="text-xs text-muted" style={{ display: 'block', marginBottom: '4px' }}>Acccount Folder</label>
                                            <select
                                                className="form-input"
                                                value={newRule.targetFolderId || ''}
                                                onChange={e => setNewRule({ ...newRule, targetFolderId: e.target.value || undefined })}
                                            >
                                                <option value="">-- No Folder Move --</option>
                                                {folders?.map((f: any) => (
                                                    <option key={f.id} value={f.id}>
                                                        {f.account?.emailAddress ? `${f.name} (${f.account.emailAddress})` : f.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-end gap-2" style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--color-border)' }}>
                                <button className="btn btn-secondary" onClick={() => setShowCreateRule(false)}>Cancel</button>
                                <button
                                    className="btn btn-primary"
                                    disabled={!newRule.matchValue || (!newRule.targetCategoryId && !newRule.targetFolderId) || createRuleMutation.isPending}
                                    onClick={() => createRuleMutation.mutate(newRule)}
                                >
                                    {createRuleMutation.isPending ? 'Creating...' : 'Create Rule'}
                                </button>
                            </div>
                        </div>
                    )}

                    {rules?.length === 0 && !showCreateRule && (
                        <div className="card" style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                            <p>No routing rules defined yet.</p>
                            <button className="btn btn-secondary btn-sm" onClick={() => setShowCreateRule(true)} style={{ marginTop: 'var(--space-2)' }}>
                                Create your first rule
                            </button>
                        </div>
                    )}

                    {rules?.map((rule: RoutingRule) => (
                        <div key={rule.id} className="card" style={{ padding: 'var(--space-4)', transition: 'border-color 0.2s', border: editingRuleId === rule.id ? '1px solid var(--color-primary)' : undefined }}>
                            {editingRuleId === rule.id ? (
                                // Editing Mode
                                <div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
                                        <h4 style={{ margin: 0 }}>Edit Rule</h4>
                                        <button className="btn btn-ghost btn-sm" onClick={() => setEditingRuleId(null)}>
                                            <X size={16} />
                                        </button>
                                    </div>

                                    <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                                        <div className="flex items-center gap-2 text-sm">
                                            <span className="text-muted">If sender matches:</span>
                                            <span className="badge badge-neutral">
                                                {rule.matchType === 'sender_domain' ? '@' : ''}{rule.matchValue}
                                            </span>
                                        </div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
                                        <div>
                                            <label className="form-label">Set Category</label>
                                            <select
                                                className="form-input"
                                                value={editingRule.targetCategoryId || rule.targetCategoryId || ''}
                                                onChange={e => setEditingRule({ ...editingRule, targetCategoryId: e.target.value || null })}
                                            >
                                                <option value="">-- None --</option>
                                                {categories?.map(cat => (
                                                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="form-label">Move to Folder</label>
                                            <select
                                                className="form-input"
                                                value={editingRule.targetFolderId || rule.targetFolderId || ''}
                                                onChange={e => setEditingRule({ ...editingRule, targetFolderId: e.target.value || null })}
                                            >
                                                <option value="">-- None --</option>
                                                {folders?.map((f: any) => (
                                                    <option key={f.id} value={f.id}>
                                                        {f.account?.emailAddress ? `${f.name} (${f.account.emailAddress})` : f.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    <div className="flex justify-end gap-2">
                                        <button
                                            className="btn btn-primary btn-sm"
                                            onClick={() => updateRuleMutation.mutate({ id: rule.id, data: editingRule })}
                                            disabled={updateRuleMutation.isPending}
                                        >
                                            Save Changes
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                // View Mode
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
                                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                                        <div style={{ width: '280px' }}>
                                            <div className="text-xs text-muted uppercase tracking-wider" style={{ marginBottom: 2 }}>
                                                {rule.matchType === 'sender_domain' ? 'Domain Match' : 'Email Match'}
                                            </div>
                                            <div style={{ fontWeight: 500, fontSize: 'var(--font-size-md)' }}>
                                                {rule.matchValue}
                                            </div>
                                        </div>

                                        <ArrowRight size={16} className="text-muted" />

                                        <div style={{ flex: 1 }}>
                                            <div className="flex gap-2 flex-wrap">
                                                {rule.targetCategoryId ? (
                                                    <span className="badge badge-primary">
                                                        Category: {getCategoryName(rule.targetCategoryId)}
                                                    </span>
                                                ) : (
                                                    <span className="badge badge-neutral text-muted">No Category</span>
                                                )}

                                                {rule.targetFolderId ? (
                                                    <span className="badge badge-secondary flex items-center gap-1">
                                                        <Folder size={12} />
                                                        {getFolderName(rule.targetFolderId)}
                                                    </span>
                                                ) : (
                                                    <span className="badge badge-neutral text-muted">No Folder</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4">
                                        {rule.timesApplied > 0 && (
                                            <div className="text-xs text-muted text-right">
                                                Used {rule.timesApplied} times
                                                <br />
                                                <span style={{ opacity: 0.7 }}>Last: {rule.lastAppliedAt ? new Date(rule.lastAppliedAt).toLocaleDateString() : 'Never'}</span>
                                            </div>
                                        )}

                                        <div className="flex gap-1">
                                            <button
                                                className="btn btn-ghost btn-sm"
                                                onClick={() => {
                                                    setEditingRuleId(rule.id);
                                                    setEditingRule({});
                                                }}
                                            >
                                                <Pencil size={16} />
                                            </button>
                                            <button
                                                className="btn btn-ghost btn-sm text-danger"
                                                onClick={() => {
                                                    if (confirm('Delete this rule?')) {
                                                        deleteRuleMutation.mutate(rule.id);
                                                    }
                                                }}
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            <Toast
                open={toast.open}
                onOpenChange={(open) => setToast(prev => ({ ...prev, open }))}
                title={toast.title}
                description={toast.description}
                variant={toast.variant}
            />
        </div>
    );
}
