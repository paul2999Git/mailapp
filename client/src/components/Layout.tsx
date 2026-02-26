import { useState } from 'react';
import { apiRequest } from '../api/client';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ComposeModal } from './ComposeModal';
import type { ICategory } from '@mailhub/shared';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ContextMenu } from './ContextMenu';
import { createContext, useContext } from 'react';
import { CheckCircle, ChevronDown, ChevronRight } from 'lucide-react';

interface ComposeContextType {
    openCompose: (config?: {
        accountId?: string;
        to?: string;
        subject?: string;
        body?: string;
        cc?: string;
        bcc?: string;
        replyToId?: string;
        forwardFromId?: string;
    }) => void;
}

export const ComposeContext = createContext<ComposeContextType | undefined>(undefined);

export const useCompose = () => {
    const context = useContext(ComposeContext);
    if (!context) throw new Error('useCompose must be used within Layout');
    return context;
};

export default function Layout() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const queryClient = useQueryClient();

    const [isComposeOpen, setIsComposeOpen] = useState(false);
    const [composeConfig, setComposeConfig] = useState<any>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, item: any, type: 'category' | 'folder' } | null>(null);
    const [expandedAccountIds, setExpandedAccountIds] = useState<Set<string>>(new Set());

    const { data: categories = [], isLoading: loadingCats } = useQuery({
        queryKey: ['categories'],
        queryFn: () => apiRequest<ICategory[]>('GET', '/classification/categories'),
        refetchInterval: 10000, // Refresh counts every 10s so unread badges stay current
    });

    const { data: accounts = [], isLoading: loadingAccs } = useQuery({
        queryKey: ['accounts'],
        queryFn: () => apiRequest<any[]>('GET', '/accounts'),
    });

    const { data: folders = [], isLoading: loadingFolders } = useQuery({
        queryKey: ['folders'],
        queryFn: () => apiRequest<any[]>('GET', '/folders'),
    });

    const loading = loadingCats || loadingAccs || loadingFolders;

    const markAllReadMutation = useMutation({
        mutationFn: (categoryId: string) => apiRequest('POST', `/classification/categories/${categoryId}/mark-read`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['categories'] });
            queryClient.invalidateQueries({ queryKey: ['messages'] });
            queryClient.invalidateQueries({ queryKey: ['threads'] });
        }
    });

    const markAllFoldersReadMutation = useMutation({
        mutationFn: (folderId: string) => apiRequest('POST', `/folders/${folderId}/mark-read`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['folders'] });
            queryClient.invalidateQueries({ queryKey: ['messages'] });
            queryClient.invalidateQueries({ queryKey: ['threads'] });
        }
    });

    // Extract current accountId from URL if any
    const currentAccountId = location.pathname.startsWith('/account/')
        ? location.pathname.split('/')[2]
        : undefined;

    const handleCategoryContextMenu = (e: React.MouseEvent, cat: ICategory) => {
        e.preventDefault();
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            item: cat,
            type: 'category'
        });
    };

    const handleFolderContextMenu = (e: React.MouseEvent, folder: any) => {
        e.preventDefault();
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            item: folder,
            type: 'folder'
        });
    };

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const toggleAccountFolders = (accountId: string) => {
        setExpandedAccountIds(prev => {
            const next = new Set(prev);
            if (next.has(accountId)) next.delete(accountId);
            else next.add(accountId);
            return next;
        });
    };

    const openCompose: ComposeContextType['openCompose'] = (config) => {
        console.log('📬 Layout - openCompose called with:', config);
        setComposeConfig(config);
        setIsComposeOpen(true);
    };

    return (
        <ComposeContext.Provider value={{ openCompose }}>
            <div className="app-layout">
                <aside className="sidebar">
                    <div className="sidebar-header">
                        <h1 className="sidebar-logo">📧 MailHub</h1>
                    </div>

                    <div style={{ padding: 'var(--space-4) var(--space-4) 0' }}>
                        <button
                            className="btn btn-primary"
                            style={{ width: '100%', justifyContent: 'center', gap: '8px' }}
                            onClick={() => openCompose()}
                        >
                            <span>➕</span>
                            <span>Compose</span>
                        </button>
                    </div>

                    <nav className="sidebar-nav">
                        <div className="nav-section">
                            <span className="nav-section-title">BOXES</span>
                            <NavLink
                                to="/inbox"
                                end
                                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                            >
                                <span>📬</span>
                                <span>All Inboxes</span>
                            </NavLink>
                        </div>

                        <div className="nav-section">
                            <span className="nav-section-title">AI CATEGORIES</span>
                            {!loading && [...categories].sort((a, b) => a.name.localeCompare(b.name)).map((cat) => (
                                <NavLink
                                    key={cat.id}
                                    to={`/inbox/${cat.name}`}
                                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                                    onContextMenu={(e) => handleCategoryContextMenu(e, cat)}
                                >
                                    <span>{cat.icon || '📁'}</span>
                                    <span style={{ flex: 1 }}>{cat.name}</span>
                                    {cat.unreadCount ? cat.unreadCount > 0 && (
                                        <span className="count-badge">{cat.unreadCount}</span>
                                    ) : null}
                                </NavLink>
                            ))}
                            {loading && <div className="nav-item text-sm text-muted">Loading categories...</div>}
                        </div>

                        <div className="nav-section">
                            <span className="nav-section-title">FOLDERS</span>
                            {!loading && accounts.map((account: any) => {
                                const isExpanded = expandedAccountIds.has(account.id);
                                const accountFolders = folders.filter((f: any) => {
                                    if (f.accountId !== account.id) return false;
                                    const name = f.name.toUpperCase();
                                    // Filter out redundant Gmail system labels
                                    const hiddenLabels = [
                                        'INBOX', 'SENT', 'DRAFTS', 'DRAFT', 'TRASH', 'SPAM', 'JUNK',
                                        'ARCHIVE', 'UNREAD', 'STARRED', 'IMPORTANT', 'CHAT',
                                        'YELLOW_STAR', '10X', 'NOTIFICATIONS',
                                        'CATEGORY_UPDATES', 'CATEGORY_SOCIAL', 'CATEGORY_PROMOTIONS',
                                        'CATEGORY_FORUMS', 'CATEGORY_PERSONAL'
                                    ];
                                    return !hiddenLabels.includes(name);
                                });

                                return (
                                    <div key={account.id} className="sidebar-group" style={{ marginTop: 'var(--space-2)' }}>
                                        <div
                                            className="sidebar-group-title"
                                            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                            onClick={() => toggleAccountFolders(account.id)}
                                        >
                                            {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                                            <span className="text-truncate" style={{ fontSize: '11px', opacity: 0.8 }}>
                                                {account.emailAddress}
                                            </span>
                                        </div>
                                        {isExpanded && accountFolders.map((folder: any) => (
                                            <NavLink
                                                key={folder.id}
                                                to={`/inbox/folder/${folder.id}`}
                                                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                                                onContextMenu={(e) => handleFolderContextMenu(e, folder)}
                                                style={{ paddingLeft: 'calc(var(--space-3) + 14px)' }}
                                            >
                                                <span>📁</span>
                                                <span className="text-truncate" style={{ flex: 1, fontSize: '12px' }}>
                                                    {folder.name}
                                                </span>
                                                {folder.unreadCount > 0 && (
                                                    <span className="count-badge">{folder.unreadCount}</span>
                                                )}
                                            </NavLink>
                                        ))}
                                    </div>
                                );
                            })}
                            {loading && <div className="nav-item text-sm text-muted">Loading folders...</div>}
                            {!loading && folders.length === 0 && <div className="nav-item text-sm text-muted">No folders</div>}
                        </div>

                        <div className="nav-section">
                            <span className="nav-section-title">Accounts</span>
                            {accounts.map((acc) => (
                                <NavLink
                                    key={acc.id}
                                    to={`/account/${acc.id}`}
                                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                                >
                                    <span title={acc.provider}>
                                        {acc.provider === 'gmail' ? '🇬' :
                                            acc.provider === 'zoho' ? '🇿' :
                                                acc.provider === 'proton' ? '🇵' :
                                                    acc.provider === 'hover' ? '🇭' : '📧'}
                                    </span>
                                    <span className="text-truncate" style={{ fontSize: '13px' }}>
                                        {acc.emailAddress}
                                    </span>
                                </NavLink>
                            ))}
                            {loading && <div className="nav-item text-sm text-muted">Loading accounts...</div>}
                        </div>

                        <div className="nav-section">
                            <span className="nav-section-title">Manage</span>
                            <NavLink to="/rules" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                                <span>📋</span>
                                <span>Rules</span>
                            </NavLink>
                            <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                                <span>⚙️</span>
                                <span>Settings</span>
                            </NavLink>
                        </div>
                    </nav>

                    <div style={{ padding: 'var(--space-4)', borderTop: '1px solid var(--color-border)' }}>
                        <div style={{ marginBottom: 'var(--space-3)' }}>
                            <div style={{ fontWeight: 500 }}>{user?.displayName || user?.email}</div>
                            <div className="text-sm text-muted">{user?.email}</div>
                        </div>
                        <button className="btn btn-secondary" onClick={handleLogout} style={{ width: '100%' }}>
                            Sign out
                        </button>
                    </div>
                </aside>

                <main className="main-content">
                    <Outlet />
                </main>

                <ComposeModal
                    isOpen={isComposeOpen}
                    onClose={() => {
                        setIsComposeOpen(false);
                        setComposeConfig(null);
                    }}
                    accounts={accounts}
                    defaultAccountId={composeConfig?.accountId || currentAccountId}
                    replyTo={composeConfig ? {
                        accountId: composeConfig.accountId,
                        to: composeConfig.to,
                        subject: composeConfig.subject,
                        cc: composeConfig.cc,
                        bcc: composeConfig.bcc,
                        messageId: composeConfig.replyToId,
                        forwardFromId: composeConfig.forwardFromId,
                        body: composeConfig.body
                    } : undefined}
                />

                {contextMenu && (
                    <ContextMenu
                        x={contextMenu.x}
                        y={contextMenu.y}
                        onClose={() => setContextMenu(null)}
                        items={[
                            {
                                label: `Mark all in ${contextMenu.item.name} as read`,
                                icon: <CheckCircle size={16} />,
                                onClick: () => {
                                    if (contextMenu.type === 'category') {
                                        markAllReadMutation.mutate(contextMenu.item.id);
                                    } else {
                                        markAllFoldersReadMutation.mutate(contextMenu.item.id);
                                    }
                                }
                            }
                        ]}
                    />
                )}
            </div>
        </ComposeContext.Provider>
    );
}
