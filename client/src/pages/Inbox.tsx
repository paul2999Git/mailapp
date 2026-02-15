import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, isToday, isYesterday, isThisYear } from 'date-fns';
import { Mail, Inbox as InboxIcon, Archive, Trash2, Tag, Loader2, Sparkles, MessageSquare, List } from 'lucide-react';
import { apiRequest } from '../api/client';
import { messagesApi, MessageItem } from '../api/messages';
import { threadsApi, ThreadItem } from '../api/threads';
import { ContextMenu } from '../components/ContextMenu';
import { Toast } from '../components/Toast';

function formatDate(dateString: string) {
    const date = new Date(dateString);
    if (isToday(date)) return format(date, 'h:mm a');
    if (isYesterday(date)) return 'Yesterday';
    if (isThisYear(date)) return format(date, 'MMM d');
    return format(date, 'MMM d, yyyy');
}

export default function Inbox() {
    const { category, accountId, folderId } = useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const [isConversationView, setIsConversationView] = useState(() => {
        const saved = localStorage.getItem('isConversationView') === 'true';
        console.log('📦 Loading Conversation View from localStorage:', saved);
        return saved;
    });

    const toggleConversationView = () => {
        setIsConversationView(prev => {
            const newValue = !prev;
            console.log('💾 Saving Conversation View to localStorage:', newValue);
            localStorage.setItem('isConversationView', newValue.toString());
            return newValue;
        });
    };

    const { data: stats } = useQuery({
        queryKey: ['classification-stats'],
        queryFn: () => apiRequest<any>('GET', '/classification/stats'),
        refetchInterval: (query) => {
            const data = query.state.data;
            if (data?.queue && (data.queue.waiting > 0 || data.queue.active > 0)) {
                return 5000; // Poll every 5s when classification is active
            }
            return 30000; // Check less frequently if nothing is happening
        }
    });

    const isClassificationRunning = stats?.queue && (stats.queue.waiting > 0 || stats.queue.active > 0);

    const isInbox = !category && !folderId;

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const { data: messagesData, isLoading: messagesLoading, error: messagesError } = useQuery({
        queryKey: ['messages', category, accountId, folderId, isInbox],
        queryFn: () => messagesApi.list({
            category: category || undefined,
            accountId: accountId || undefined,
            folderId: folderId || undefined,
            isInbox
        }),
        enabled: !isConversationView,
    });

    const { data: threadsData, isLoading: threadsLoading, error: threadsError } = useQuery({
        queryKey: ['threads', category, accountId, folderId, isInbox],
        queryFn: () => threadsApi.list({
            category: category || undefined,
            accountId: accountId || undefined,
            folderId: folderId || undefined,
            isInbox
        }),
        enabled: isConversationView,
    });

    const isLoading = isConversationView ? threadsLoading : messagesLoading;
    const error = isConversationView ? threadsError : messagesError;
    const itemsData = isConversationView ? threadsData : messagesData;

    const messages: MessageItem[] = messagesData?.items || [];
    const threads: ThreadItem[] = threadsData?.items || [];
    const currentItems = isConversationView ? threads : messages;

    const selectedAccountIds = new Set(
        currentItems
            .filter(item => selectedIds.has(item.id))
            .flatMap(item => {
                if (isConversationView) {
                    // For threads, we need the accountId of the latest message or the thread's accountIds
                    return (item as ThreadItem).messages.map(m => m.account.emailAddress); // Actually, let's just use the first one for simplicity or logic check
                }
                return [(item as MessageItem).accountId];
            })
    );

    const handleSelectAll = () => {
        const items = isConversationView ? threads : messages;
        if (selectedIds.size === items.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(items.map(m => m.id)));
        }
    };

    const toggleSelection = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedIds(next);
    };

    const markReadMutation = useMutation({
        mutationFn: ({ id, isRead }: { id: string; isRead: boolean }) =>
            (isConversationView
                ? threadsApi.batch([id], isRead ? 'markRead' : 'markUnread')
                : messagesApi.update(id, { isRead })) as Promise<any>,
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['messages'] });
            queryClient.invalidateQueries({ queryKey: ['threads'] });
        },
    });

    const handleMessageClick = (message: MessageItem) => {
        if (!message.isRead) {
            markReadMutation.mutate({ id: message.id, isRead: true });
        }
        if (message.threadId) {
            navigate(`/thread/${message.threadId}`);
        } else {
            navigate(`/thread/${message.id}`);
        }
    };

    const handleThreadClick = (thread: ThreadItem) => {
        if (thread.unreadCount > 0) {
            markReadMutation.mutate({ id: thread.id, isRead: true });
        }
        navigate(`/thread/${thread.id}`);
    };

    const { data: accounts = [] } = useQuery({
        queryKey: ['accounts'],
        queryFn: () => apiRequest<any[]>('GET', '/accounts'),
    });

    const syncMutation = useMutation({
        mutationFn: (aid?: string) =>
            aid ? apiRequest('POST', `/accounts/${aid}/sync`) : Promise.all(accounts.map((a: any) => apiRequest('POST', `/accounts/${a.id}/sync`))),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['messages'] });
        },
    });

    const batchMutation = useMutation({
        mutationFn: ({ ids, action, data }: { ids: string[], action: string, data?: any }) =>
            isConversationView
                ? threadsApi.batch(ids, action as any)
                : messagesApi.batch(ids, action, data),
        onMutate: async ({ ids, action }) => {
            await queryClient.cancelQueries({ queryKey: ['messages'] });
            const previousMessages = queryClient.getQueryData(['messages', category, accountId, folderId, isInbox]);

            if (action === 'delete' || action === 'move' || action === 'archive') {
                queryClient.setQueryData(['messages', category, accountId, folderId, isInbox], (old: any) => {
                    if (!old) return old;
                    return {
                        ...old,
                        items: old.items.filter((m: any) => !ids.includes(m.id))
                    };
                });
            } else if (action === 'markRead' || action === 'markUnread') {
                const isRead = action === 'markRead';
                queryClient.setQueryData(['messages', category, accountId, folderId, isInbox], (old: any) => {
                    if (!old) return old;
                    return {
                        ...old,
                        items: old.items.map((m: any) => ids.includes(m.id) ? { ...m, isRead } : m)
                    };
                });
            }

            if (isConversationView) {
                await queryClient.cancelQueries({ queryKey: ['threads'] });
                const previousThreads = queryClient.getQueryData(['threads', category, accountId, folderId, isInbox]);

                if (action === 'delete') {
                    queryClient.setQueryData(['threads', category, accountId, folderId, isInbox], (old: any) => {
                        if (!old) return old;
                        return {
                            ...old,
                            items: old.items.filter((t: any) => !ids.includes(t.id))
                        };
                    });
                } else if (action === 'markRead' || action === 'markUnread') {
                    const isRead = action === 'markRead';
                    queryClient.setQueryData(['threads', category, accountId, folderId, isInbox], (old: any) => {
                        if (!old) return old;
                        return {
                            ...old,
                            items: old.items.map((t: any) => ids.includes(t.id) ? { ...t, unreadCount: isRead ? 0 : 1 } : t)
                        };
                    });
                }
                return { previousMessages, previousThreads };
            }

            return { previousMessages };
        },
        onError: (_err, _variables, context: any) => {
            if (context?.previousMessages) {
                queryClient.setQueryData(['messages', category, accountId, folderId, isInbox], context.previousMessages);
            }
            if (context?.previousThreads) {
                queryClient.setQueryData(['threads', category, accountId, folderId, isInbox], context.previousThreads);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['messages'] });
            queryClient.invalidateQueries({ queryKey: ['threads'] });
            setSelectedIds(new Set());
        },
    });

    const [confirmToast, setConfirmToast] = useState<{
        open: boolean;
        title: string;
        description: string;
        actionLabel: string;
        onConfirm: () => void;
        variant?: 'default' | 'danger';
    }>({
        open: false,
        title: '',
        description: '',
        actionLabel: '',
        onConfirm: () => { },
    });

    const emptyTrashMutation = useMutation({
        mutationFn: () => apiRequest('POST', '/classification/empty-trash'),
        onSuccess: (data: any) => {
            queryClient.invalidateQueries({ queryKey: ['messages'] });
            setConfirmToast({
                open: true,
                title: 'Trash Emptied',
                description: `Successfully moved ${data.moved} messages to provider trash.`,
                actionLabel: 'OK',
                onConfirm: () => setConfirmToast(prev => ({ ...prev, open: false }))
            });
        }
    });

    const overrideMutation = useMutation({
        mutationFn: (data: { messageId: string, newCategoryId: string, makePermanent: boolean, applyToSender: boolean }) =>
            apiRequest('POST', '/classification/override', data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['messages'] });
            queryClient.invalidateQueries({ queryKey: ['rules'] });
        }
    });

    const { data: categories = [] } = useQuery({
        queryKey: ['categories'],
        queryFn: () => apiRequest<any[]>('GET', '/classification/categories'),
    });

    const handleBatchDelete = () => {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;
        if (ids.length > 1) {
            setConfirmToast({
                open: true,
                title: 'Delete Emails',
                description: `Are you sure you want to delete ${ids.length} emails?`,
                actionLabel: 'Delete',
                variant: 'danger',
                onConfirm: () => {
                    batchMutation.mutate({ ids, action: 'delete' });
                    setConfirmToast(prev => ({ ...prev, open: false }));
                }
            });
            return;
        }
        batchMutation.mutate({ ids, action: 'delete' });
    };

    const handleBatchMove = (folderId: string) => {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;
        if (ids.length > 1) {
            const folder = allFolders.find((f: any) => f.id === folderId);
            setConfirmToast({
                open: true,
                title: 'Move Emails',
                description: `Move ${ids.length} emails to ${folder?.name || 'selected folder'}?`,
                actionLabel: 'Move',
                onConfirm: () => {
                    batchMutation.mutate({ ids, action: 'move', data: { folderId } });
                    setConfirmToast(prev => ({ ...prev, open: false }));
                }
            });
            return;
        }
        batchMutation.mutate({ ids, action: 'move', data: { folderId } });
    };

    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; message?: MessageItem; thread?: ThreadItem } | null>(null);
    const [showBatchMoveMenu, setShowBatchMoveMenu] = useState(false);

    const createFolderMutation = useMutation({
        mutationFn: ({ accountId, name }: { accountId: string, name: string }) =>
            apiRequest<any>('POST', '/folders', { accountId, name }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['folders'] });
        },
    });

    const { data: allFolders = [] } = useQuery({
        queryKey: ['folders'],
        queryFn: () => apiRequest<any[]>('GET', '/folders'),
    });

    const handleRefresh = () => {
        syncMutation.mutate(accountId);
    };

    if (isLoading) {
        return (
            <div className="loading-screen">
                <div className="loading-spinner" />
                <p>Loading messages...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="empty-state">
                <div className="empty-state-icon">⚠️</div>
                <h3>Failed to load messages</h3>
                <p className="text-muted">Please try again later</p>
            </div>
        );
    }

    const getIconForCategory = (cat?: string) => {
        switch (cat) {
            case 'Inbox': return <InboxIcon size={20} />;
            case 'AI-Archive': return <Archive size={20} />;
            case 'AI-Trash': return <Trash2 size={20} />;
            case 'AI-Spam': return <Tag size={20} />;
            default: return <Mail size={20} />;
        }
    };

    return (
        <div>
            <header className="header">
                <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    {getIconForCategory(category)}
                    {category || 'Inbox'}
                    {isClassificationRunning && (
                        <span className="badge badge-primary" style={{ fontSize: 'var(--font-size-xs)', padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Loader2 size={12} className="animate-spin" />
                            <Sparkles size={12} />
                            AI Organizing...
                        </span>
                    )}
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                    <button
                        className={`btn btn-sm ${isConversationView ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={toggleConversationView}
                        title={isConversationView ? "Switch to Individual View" : "Switch to Conversation View"}
                        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
                    >
                        {isConversationView ? <MessageSquare size={16} /> : <List size={16} />}
                        {isConversationView ? 'Groups On' : 'Groups Off'}
                    </button>
                    <input
                        type="checkbox"
                        checked={currentItems.length > 0 && selectedIds.size === currentItems.length}
                        ref={el => {
                            if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < currentItems.length;
                        }}
                        onChange={handleSelectAll}
                        title="Select All"
                    />
                </div>
                <div className="search-box">
                    <span className="search-icon">🔍</span>
                    <input
                        type="search"
                        className="search-input"
                        placeholder="Search messages..."
                    />
                </div>
                <div className="flex gap-2">
                    {selectedIds.size > 0 && (
                        <>
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={handleBatchDelete}
                                style={{ color: 'var(--color-danger)' }}
                            >
                                🗑️ Delete
                            </button>
                            <div style={{ position: 'relative' }}>
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => setShowBatchMoveMenu(!showBatchMoveMenu)}
                                    disabled={selectedAccountIds.size > 1}
                                    title={selectedAccountIds.size > 1 ? "Cannot move messages from multiple accounts at once" : ""}
                                >
                                    📁 Move
                                </button>
                                {showBatchMoveMenu && selectedAccountIds.size === 1 && (
                                    <div className="card" style={{
                                        position: 'absolute',
                                        right: 0,
                                        top: '100%',
                                        zIndex: 100,
                                        minWidth: 200,
                                        padding: 'var(--space-2)',
                                        marginTop: 'var(--space-1)',
                                        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                                        border: '1px solid var(--color-border)',
                                        maxHeight: 300,
                                        overflowY: 'auto'
                                    }}>
                                        {allFolders
                                            .filter((f: any) => f.accountId === Array.from(selectedAccountIds)[0])
                                            .map((f: any) => (
                                                <button
                                                    key={f.id}
                                                    className="nav-item"
                                                    style={{ width: '100%', border: 'none', background: 'none', padding: 'var(--space-2) var(--space-3)', cursor: 'pointer', borderRadius: 'var(--radius-md)', textAlign: 'left' }}
                                                    onClick={() => {
                                                        handleBatchMove(f.id);
                                                        setShowBatchMoveMenu(false);
                                                    }}
                                                >
                                                    <span>📁 {f.name}</span>
                                                </button>
                                            ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                    {category === 'AI-Trash' && messages.length > 0 && (
                        <button
                            className="btn btn-secondary btn-sm"
                            style={{ color: 'var(--color-danger)' }}
                            onClick={() => {
                                setConfirmToast({
                                    open: true,
                                    title: 'Empty AI Trash',
                                    description: `This will move all ${messages.length} messages in AI-Trash to the actual provider trash folders. Proceed?`,
                                    actionLabel: 'Empty Trash',
                                    variant: 'danger',
                                    onConfirm: () => {
                                        emptyTrashMutation.mutate();
                                        setConfirmToast(prev => ({ ...prev, open: false }));
                                    }
                                });
                            }}
                            disabled={emptyTrashMutation.isPending}
                        >
                            🗑️ Empty Trash
                        </button>
                    )}
                    <button
                        className="btn btn-ghost"
                        onClick={handleRefresh}
                        disabled={syncMutation.isPending}
                    >
                        {syncMutation.isPending ? '⌛ Syncing...' : '🔄 Refresh'}
                    </button>
                </div>
            </header>

            {currentItems.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-state-icon">📭</div>
                    <h3>No {isConversationView ? 'conversations' : 'messages'}</h3>
                    <p className="text-muted">
                        {category ? `No items in ${category}` : 'Your inbox is empty'}
                    </p>
                </div>
            ) : (
                <div className="message-list">
                    {isConversationView ? (
                        threads.map((thread) => (
                            <div
                                key={thread.id}
                                className={`message-item thread-item ${thread.unreadCount > 0 ? 'unread' : ''} ${selectedIds.has(thread.id) ? 'selected' : ''}`}
                                onClick={() => handleThreadClick(thread)}
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    setContextMenu({ x: e.clientX, y: e.clientY, thread });
                                }}
                            >
                                <div className="message-selection-col">
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.has(thread.id)}
                                        onClick={(e) => toggleSelection(e, thread.id)}
                                        onChange={() => { }}
                                    />
                                    <button
                                        className="message-quick-trash"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            batchMutation.mutate({ ids: [thread.id], action: 'delete' });
                                        }}
                                        title="Delete Thread"
                                    >
                                        🗑️
                                    </button>
                                </div>

                                <div className="message-main">
                                    <div className="message-header">
                                        <div className="message-from-row">
                                            <span className="message-from">
                                                {thread.participantEmails.slice(0, 2).join(', ')}
                                                {thread.participantEmails.length > 2 && ` (+${thread.participantEmails.length - 2})`}
                                            </span>
                                            {thread.messageCount > 1 && (
                                                <span className="badge badge-secondary" style={{ fontSize: '10px' }}>
                                                    {thread.messageCount}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="message-subject">
                                        {thread.unreadCount > 0 && <span className="unread-dot" />}
                                        {thread.subjectNormalized || '(no subject)'}
                                    </div>
                                    <div className="message-preview">
                                        {thread.messages[0]?.fromName || thread.messages[0]?.fromAddress}: {thread.messages[0]?.bodyPreview}
                                    </div>
                                </div>

                                <div className="message-meta">
                                    <span className="message-date">
                                        {formatDate(thread.lastMessageDate)}
                                    </span>
                                    {thread.hasAttachments && (
                                        <span className="message-attachments">📎</span>
                                    )}
                                </div>
                            </div>
                        ))
                    ) : (
                        messages.map((message) => (
                            <div
                                key={message.id}
                                className={`message-item ${!message.isRead ? 'unread' : ''} ${selectedIds.has(message.id) ? 'selected' : ''}`}
                                onClick={() => handleMessageClick(message)}
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    setContextMenu({ x: e.clientX, y: e.clientY, message });
                                }}
                            >
                                <div className="message-selection-col">
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.has(message.id)}
                                        onClick={(e) => toggleSelection(e, message.id)}
                                        onChange={() => { }}
                                    />
                                    <button
                                        className="message-quick-trash"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            batchMutation.mutate({ ids: [message.id], action: 'delete' });
                                        }}
                                        title="Delete"
                                    >
                                        🗑️
                                    </button>
                                </div>

                                <div className="message-main">
                                    <div className="message-header">
                                        <div className="message-from-row">
                                            <span className="message-account" title={message.account?.emailAddress}>
                                                {message.account?.provider === 'gmail' ? '🇬' :
                                                    message.account?.provider === 'proton' ? '🇵' :
                                                        message.account?.provider === 'zoho' ? '🇿' :
                                                            message.account?.provider === 'hover' ? '🇭' : '📧'}
                                            </span>
                                            <span className="message-from">
                                                {message.fromName || message.fromAddress}
                                            </span>
                                        </div>
                                        {message.aiCategory && (
                                            <span className="message-category">
                                                {message.aiCategory}
                                            </span>
                                        )}
                                    </div>
                                    <div className="message-subject">{message.subject || '(no subject)'}</div>
                                    <div className="message-preview">{message.bodyPreview}</div>
                                </div>

                                <div className="message-meta">
                                    <span className="message-date">
                                        {formatDate(message.dateReceived)}
                                    </span>
                                    {message.hasAttachments && (
                                        <span className="message-attachments">📎</span>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}

            {itemsData && itemsData.hasMore && (
                <div style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
                    <button className="btn btn-secondary">Load more</button>
                </div>
            )}

            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onClose={() => setContextMenu(null)}
                    items={isConversationView && contextMenu.thread ? [
                        {
                            label: contextMenu.thread.unreadCount === 0 ? 'Mark as unread' : 'Mark as read',
                            icon: contextMenu.thread.unreadCount === 0 ? '📧' : '📖',
                            onClick: () => markReadMutation.mutate({ id: contextMenu.thread!.id, isRead: contextMenu.thread!.unreadCount > 0 })
                        },
                        { divider: true },
                        {
                            label: 'Delete Thread',
                            icon: '🗑️',
                            danger: true,
                            onClick: () => batchMutation.mutate({
                                ids: [contextMenu.thread!.id],
                                action: 'delete'
                            })
                        },
                    ] : contextMenu.message ? [
                        {
                            label: contextMenu.message.isRead ? 'Mark as unread' : 'Mark as read',
                            icon: contextMenu.message.isRead ? '📧' : '📖',
                            onClick: () => markReadMutation.mutate({ id: contextMenu.message!.id, isRead: !contextMenu.message!.isRead })
                        },
                        {
                            label: 'Correct Category',
                            icon: '🎯',
                            items: [
                                ...[...categories]
                                    .filter((c: any) => c.name !== contextMenu.message!.aiCategory)
                                    .sort((a, b) => a.name.localeCompare(b.name))
                                    .map((c: any) => ({
                                        label: c.name,
                                        onClick: () => overrideMutation.mutate({
                                            messageId: contextMenu.message!.id,
                                            newCategoryId: c.id,
                                            makePermanent: true,
                                            applyToSender: true
                                        })
                                    }))
                            ]
                        },
                        {
                            label: 'Move to',
                            icon: '📁',
                            items: [
                                ...allFolders
                                    .filter((f: any) => f.accountId === contextMenu.message!.accountId)
                                    .map((f: any) => ({
                                        label: f.name,
                                        onClick: () => batchMutation.mutate({
                                            ids: [contextMenu.message!.id],
                                            action: 'move',
                                            data: { folderId: f.id }
                                        })
                                    })),
                                { divider: true },
                                {
                                    label: '➕ New Folder...',
                                    onClick: async () => {
                                        const name = window.prompt('Enter new folder name:');
                                        if (name) {
                                            const newFolder = await createFolderMutation.mutateAsync({
                                                accountId: contextMenu.message!.accountId,
                                                name
                                            });
                                            batchMutation.mutate({
                                                ids: [contextMenu.message!.id],
                                                action: 'move',
                                                data: { folderId: newFolder.data.id }
                                            });
                                        }
                                    }
                                }
                            ]
                        },
                        { divider: true },
                        {
                            label: 'Delete',
                            icon: '🗑️',
                            danger: true,
                            onClick: () => batchMutation.mutate({
                                ids: [contextMenu.message!.id],
                                action: 'delete'
                            })
                        },
                    ] : []}
                />
            )}

            <Toast
                open={confirmToast.open}
                onOpenChange={(open) => setConfirmToast(prev => ({ ...prev, open }))}
                title={confirmToast.title}
                description={confirmToast.description}
                variant={confirmToast.variant}
                action={{
                    label: confirmToast.actionLabel,
                    onClick: confirmToast.onConfirm
                }}
            />
        </div>
    );
}
