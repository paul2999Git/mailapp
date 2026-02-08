import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { apiRequest } from '../api/client';

interface ThreadData {
    id: string;
    subjectNormalized: string;
    messageCount: number;
    messages: Array<{
        id: string;
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

export default function Thread() {
    const { threadId } = useParams();
    const navigate = useNavigate();

    const { data: thread, isLoading, error } = useQuery({
        queryKey: ['thread', threadId],
        queryFn: () => apiRequest<ThreadData>('GET', `/threads/${threadId}`),
        enabled: !!threadId,
    });

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
                <span className="text-muted text-sm">
                    {thread.messageCount} message{thread.messageCount !== 1 ? 's' : ''}
                </span>
            </header>

            <div style={{ padding: 'var(--space-6)' }}>
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
                                {(message.fromName || message.fromAddress).charAt(0).toUpperCase()}
                            </div>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 500 }}>
                                    {message.fromName || message.fromAddress}
                                </div>
                                <div className="text-sm text-muted">
                                    to {message.account.emailAddress} • {format(new Date(message.dateReceived), 'MMM d, yyyy h:mm a')}
                                </div>
                            </div>
                        </div>

                        <div
                            style={{
                                lineHeight: 1.7,
                                color: 'var(--color-text-secondary)',
                            }}
                            dangerouslySetInnerHTML={{ __html: message.bodyHtml || message.bodyText.replace(/\n/g, '<br/>') }}
                        />
                    </div>
                ))}

                <div className="card" style={{ marginTop: 'var(--space-6)' }}>
                    <div style={{ marginBottom: 'var(--space-4)', fontWeight: 500 }}>Reply</div>
                    <textarea
                        className="form-input"
                        rows={6}
                        placeholder="Write your reply..."
                        style={{ marginBottom: 'var(--space-4)', resize: 'vertical' }}
                    />
                    <div className="flex gap-2">
                        <button className="btn btn-primary">Save as Draft</button>
                        <button className="btn btn-secondary">Discard</button>
                    </div>
                    <p className="text-sm text-muted" style={{ marginTop: 'var(--space-3)' }}>
                        Note: Automatic sending is disabled. All replies are saved as drafts.
                    </p>
                </div>
            </div>
        </div>
    );
}
