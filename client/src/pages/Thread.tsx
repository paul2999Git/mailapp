import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { apiRequest } from '../api/client';
import type { ICategory } from '@mailhub/shared';
import { useState } from 'react';
import { useCompose } from '../components/Layout';

interface ThreadData {
    id: string;
    subjectNormalized: string;
    messageCount: number;
    messages: Array<{
        id: string;
        accountId: string;
        subject: string;
        fromAddress: string;
        fromName: string;
        dateReceived: string;
        bodyHtml: string;
        bodyText: string;
        account: {
            emailAddress: string;
            provider: string;
        };
    }>;
}

function processEmailHtml(html: string) {
    if (!html) return html;
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        doc.querySelectorAll('a').forEach(link => {
            link.setAttribute('target', '_blank');
            link.setAttribute('rel', 'noopener noreferrer');
        });
        return doc.body.innerHTML;
    } catch (e) {
        console.error('Error processing email HTML:', e);
        return html;
    }
}

export default function Thread() {
    const { threadId } = useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { openCompose } = useCompose();
    const [isMoveMenuOpen, setIsMoveMenuOpen] = useState(false);
    const [makePermanent, setMakePermanent] = useState(false);
    const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);

    console.log('🧵 Thread Detail View - threadId:', threadId);

    const { data: thread, isLoading, error } = useQuery({
        queryKey: ['thread', threadId],
        queryFn: async () => {
            console.log('📡 Fetching thread detail for:', threadId);
            const data = await apiRequest<ThreadData>('GET', `/threads/${threadId}`);
            console.log('✅ Thread detail loaded:', data);
            return data;
        },
        enabled: !!threadId,
    });

    if (error) {
        console.error('❌ Error loading thread:', error);
    }

    const { data: categories } = useQuery({
        queryKey: ['categories'],
        queryFn: () => apiRequest<ICategory[]>('GET', '/classification/categories'),
    });

    const { data: folders } = useQuery({
        queryKey: ['folders'],
        queryFn: () => apiRequest<any[]>('GET', '/folders'),
    });

    const overrideMutation = useMutation({
        mutationFn: (data: { messageId: string; newCategoryId: string; makePermanent: boolean }) =>
            apiRequest('POST', '/classification/override', {
                ...data,
                applyToSender: data.makePermanent,
                actionType: 'categorize',
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['thread', threadId] });
            queryClient.invalidateQueries({ queryKey: ['threads'] });
            queryClient.invalidateQueries({ queryKey: ['messages'] });
            queryClient.invalidateQueries({ queryKey: ['categories'] });
            setIsMoveMenuOpen(false);
            setSelectedMessageId(null);
        },
    });

    const moveFolderMutation = useMutation({
        mutationFn: (data: { messageId: string; folderId: string }) =>
            apiRequest('POST', '/messages/batch', {
                messageIds: [data.messageId],
                action: 'move',
                data: { folderId: data.folderId }
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['thread', threadId] });
            queryClient.invalidateQueries({ queryKey: ['threads'] });
            queryClient.invalidateQueries({ queryKey: ['messages'] });
            queryClient.invalidateQueries({ queryKey: ['folders'] });
            setIsMoveMenuOpen(false);
            setSelectedMessageId(null);
        },
    });

    const handleMove = (messageId: string, categoryId: string) => {
        overrideMutation.mutate({
            messageId,
            newCategoryId: categoryId,
            makePermanent,
        });
    };

    const handleReply = (message: any) => {
        console.log('↩️ Replying to message:', message);
        if (!message) {
            console.error('❌ Cannot reply: message is null');
            return;
        }

        const subject = thread?.subjectNormalized || message.subject || 'No Subject';
        const replySubject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;

        openCompose({
            accountId: message.accountId,
            to: message.fromAddress,
            subject: replySubject,
            replyToId: message.id
        });
    };

    const handleReplyAll = (message: any) => {
        console.log('↩️ Replying All to message:', message);
        if (!message) {
            console.error('❌ Cannot reply all: message is null');
            return;
        }

        const subject = thread?.subjectNormalized || message.subject || 'No Subject';
        const replySubject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;

        // Filter out the current account email from the recipients
        const myEmail = message.account?.emailAddress?.toLowerCase();

        const allRecipientEmails = new Set<string>();
        if (message.fromAddress && message.fromAddress.toLowerCase() !== myEmail) {
            allRecipientEmails.add(message.fromAddress);
        }

        if (Array.isArray(message.toAddresses)) {
            message.toAddresses.forEach((addr: any) => {
                const email = (typeof addr === 'string' ? addr : addr.email)?.toLowerCase();
                if (email && email !== myEmail) allRecipientEmails.add(email);
            });
        }

        const ccRecipientEmails = new Set<string>();
        if (Array.isArray(message.ccAddresses)) {
            message.ccAddresses.forEach((addr: any) => {
                const email = (typeof addr === 'string' ? addr : addr.email)?.toLowerCase();
                if (email && email !== myEmail) ccRecipientEmails.add(email);
            });
        }

        openCompose({
            accountId: message.accountId,
            to: Array.from(allRecipientEmails).join(', '),
            cc: Array.from(ccRecipientEmails).join(', '),
            subject: replySubject,
            replyToId: message.id
        });
    };

    const handleForward = (message: any) => {
        console.log('➡️ Forwarding message:', message);
        if (!message) {
            console.error('❌ Cannot forward: message is null');
            return;
        }

        const subject = thread?.subjectNormalized || message.subject || 'No Subject';
        const forwardSubject = subject.toLowerCase().startsWith('fwd:') ? subject : `Fwd: ${subject}`;

        openCompose({
            accountId: message.accountId,
            subject: forwardSubject,
            forwardFromId: message.id
        });
    };

    if (isLoading) {
        return (
            <div className="loading-screen">
                <div className="loading-spinner" />
                <p>Loading thread...</p>
            </div>
        );
    }

    if (error || !thread) {
        return (
            <div className="empty-state">
                <div className="empty-state-icon">⚠️</div>
                <h3>Thread not found</h3>
                <button className="btn btn-primary" onClick={() => navigate('/inbox')}>
                    Back to Inbox
                </button>
            </div>
        );
    }

    return (
        <div>
            <header className="header">
                <button className="btn btn-ghost" onClick={() => navigate(-1)}>
                    ← Back
                </button>
                <h2 style={{ flex: 1, margin: 0, fontSize: 'var(--font-size-lg)' }}>
                    {thread.subjectNormalized || '(no subject)'}
                </h2>
                <div className="flex gap-2">
                    <button
                        className="btn btn-primary btn-sm"
                        onClick={() => handleReply(thread.messages[thread.messages.length - 1])}
                    >
                        Reply
                    </button>
                    <span className="text-muted text-sm self-center">
                        {thread.messageCount} message{thread.messageCount !== 1 ? 's' : ''}
                    </span>
                </div>
            </header>

            <div className="thread-container" style={{ padding: 'var(--space-6)' }}>
                {thread.messages.map((message, index) => (
                    <div
                        key={message.id}
                        className="card"
                        style={{ marginBottom: index < thread.messages.length - 1 ? 'var(--space-4)' : 0 }}
                    >
                        <div className="flex items-center gap-4" style={{ marginBottom: 'var(--space-4)' }}>
                            <div style={{
                                width: 40,
                                height: 40,
                                borderRadius: 'var(--radius-full)',
                                background: 'var(--color-accent-muted)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 600,
                                color: 'var(--color-accent)',
                            }}>
                                {(message.fromName || message.fromAddress || '?').charAt(0).toUpperCase()}
                            </div>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 500 }}>
                                    {message.fromName || message.fromAddress}
                                </div>
                                <div className="text-sm text-muted">
                                    to {message.account?.emailAddress || 'unknown'} • {message.dateReceived ? format(new Date(message.dateReceived), 'MMM d, yyyy h:mm a') : 'unknown date'}
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => handleForward(message)}
                                >
                                    Forward
                                </button>
                                <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => handleReplyAll(message)}
                                >
                                    Reply All
                                </button>
                                <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => handleReply(message)}
                                >
                                    Reply
                                </button>
                                <div style={{ position: 'relative' }}>
                                    <button
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => {
                                            setSelectedMessageId(message.id);
                                            setIsMoveMenuOpen(!isMoveMenuOpen || selectedMessageId !== message.id);
                                        }}
                                    >
                                        Move
                                    </button>

                                    {isMoveMenuOpen && selectedMessageId === message.id && (
                                        <div className="card" style={{
                                            position: 'absolute',
                                            right: 0,
                                            top: '100%',
                                            zIndex: 100,
                                            minWidth: 200,
                                            padding: 'var(--space-2)',
                                            marginTop: 'var(--space-1)',
                                            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                                            border: '1px solid var(--color-border)'
                                        }}>
                                            <div style={{ padding: 'var(--space-2)', borderBottom: '1px solid var(--color-border)', marginBottom: 'var(--space-1)' }}>
                                                <label className="flex items-center gap-2 text-sm" style={{ cursor: 'pointer', userSelect: 'none' }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={makePermanent}
                                                        onChange={(e) => setMakePermanent(e.target.checked)}
                                                    />
                                                    Always for this sender
                                                </label>
                                            </div>
                                            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                                                <div className="text-muted text-xs uppercase" style={{ padding: 'var(--space-2) var(--space-3)', fontWeight: 600 }}>Categories</div>
                                                {categories?.map(cat => (
                                                    <button
                                                        key={cat.id}
                                                        className="nav-item"
                                                        style={{ width: '100%', border: 'none', background: 'none', padding: 'var(--space-2) var(--space-3)', cursor: 'pointer', borderRadius: 'var(--radius-md)', textAlign: 'left' }}
                                                        onClick={() => handleMove(message.id, cat.id)}
                                                        disabled={overrideMutation.isPending}
                                                    >
                                                        <span style={{ marginRight: 'var(--space-2)' }}>{cat.icon || '🏷️'}</span>
                                                        <span>{cat.name}</span>
                                                    </button>
                                                ))}

                                                <div className="text-muted text-xs uppercase" style={{ padding: 'var(--space-2) var(--space-3)', fontWeight: 600, borderTop: '1px solid var(--color-border)', marginTop: 'var(--space-2)' }}>Folders</div>
                                                {folders?.filter(f => f.accountId === message.accountId && !f.isSystem).map(folder => (
                                                    <button
                                                        key={folder.id}
                                                        className="nav-item"
                                                        style={{ width: '100%', border: 'none', background: 'none', padding: 'var(--space-2) var(--space-3)', cursor: 'pointer', borderRadius: 'var(--radius-md)', textAlign: 'left' }}
                                                        onClick={() => moveFolderMutation.mutate({ messageId: message.id, folderId: folder.id })}
                                                        disabled={moveFolderMutation.isPending}
                                                    >
                                                        <span style={{ marginRight: 'var(--space-2)' }}>📁</span>
                                                        <span>{folder.name}</span>
                                                    </button>
                                                ))}
                                                {folders?.filter(f => f.accountId === message.accountId && !f.isSystem).length === 0 && (
                                                    <div style={{ padding: 'var(--space-2) var(--space-3)', fontSize: '12px', color: 'var(--color-text-muted)' }}>No custom folders</div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div
                            className="email-body html-content"
                            style={{
                                lineHeight: 1.7,
                                padding: 'var(--space-6)',
                                background: '#ffffff',
                                color: '#1a1a1a',
                                borderRadius: 'var(--radius-lg)',
                                marginTop: 'var(--space-4)',
                                border: '1px solid var(--color-border)',
                                minHeight: '60px',
                                colorScheme: 'light',
                                overflow: 'hidden'
                            }}
                            dangerouslySetInnerHTML={{
                                __html: processEmailHtml(message.bodyHtml) ||
                                    (message.bodyText ? `<div style="white-space: pre-wrap; font-family: inherit;">${message.bodyText}</div>` :
                                        `<div class="text-muted" style="font-style: italic; opacity: 0.5;">(No message content)</div>`)
                            }}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}
