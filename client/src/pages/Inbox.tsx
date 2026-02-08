import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, isToday, isYesterday, isThisYear } from 'date-fns';
import { messagesApi, MessageItem } from '../api/messages';

function formatDate(dateString: string) {
    const date = new Date(dateString);
    if (isToday(date)) return format(date, 'h:mm a');
    if (isYesterday(date)) return 'Yesterday';
    if (isThisYear(date)) return format(date, 'MMM d');
    return format(date, 'MMM d, yyyy');
}

export default function Inbox() {
    const { category } = useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const { data, isLoading, error } = useQuery({
        queryKey: ['messages', category],
        queryFn: () => messagesApi.list({ category: category || undefined }),
    });

    const markReadMutation = useMutation({
        mutationFn: ({ id, isRead }: { id: string; isRead: boolean }) =>
            messagesApi.update(id, { isRead }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['messages'] });
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

    const messages = data?.items || [];

    return (
        <div>
            <header className="header">
                <div className="search-box">
                    <span className="search-icon">🔍</span>
                    <input
                        type="search"
                        className="search-input"
                        placeholder="Search messages..."
                    />
                </div>
                <button className="btn btn-ghost">🔄 Refresh</button>
            </header>

            {messages.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-state-icon">📭</div>
                    <h3>No messages</h3>
                    <p className="text-muted">
                        {category ? `No messages in ${category}` : 'Your inbox is empty'}
                    </p>
                </div>
            ) : (
                <div className="message-list">
                    {messages.map((message) => (
                        <div
                            key={message.id}
                            className={`message-item ${!message.isRead ? 'unread' : ''}`}
                            onClick={() => handleMessageClick(message)}
                        >
                            <div className="message-checkbox">
                                <input
                                    type="checkbox"
                                    onClick={(e) => e.stopPropagation()}
                                />
                            </div>

                            <div className="message-main">
                                <div className="message-header">
                                    <span className="message-from">
                                        {message.fromName || message.fromAddress}
                                    </span>
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
                    ))}
                </div>
            )}

            {data && data.hasMore && (
                <div style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
                    <button className="btn btn-secondary">Load more</button>
                </div>
            )}
        </div>
    );
}
