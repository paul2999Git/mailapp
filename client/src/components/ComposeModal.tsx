import { useState, useEffect } from 'react';
import { X, Send, Paperclip } from 'lucide-react';
import { messagesApi } from '../api/messages';

interface Account {
    id: string;
    emailAddress: string;
    provider: string;
}

interface ComposeModalProps {
    isOpen: boolean;
    onClose: () => void;
    accounts: Account[];
    defaultAccountId?: string;
    replyTo?: {
        accountId: string;
        to: string;
        subject: string;
        cc?: string;
        bcc?: string;
        messageId?: string;
        forwardFromId?: string;
    };
}

export function ComposeModal({ isOpen, onClose, accounts, defaultAccountId, replyTo }: ComposeModalProps) {
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [details, setDetails] = useState({
        accountId: defaultAccountId || (accounts.length > 0 ? accounts[0].id : ''),
        to: '',
        subject: '',
        body: '',
        cc: '',
        bcc: '',
        forwardFromId: ''
    });

    useEffect(() => {
        if (!isOpen) return;

        console.log('📝 ComposeModal - initializing:', { replyTo, defaultAccountId, accountsCount: accounts.length });

        if (replyTo) {
            setDetails({
                accountId: replyTo.accountId,
                to: replyTo.to,
                cc: replyTo.cc || '',
                bcc: replyTo.bcc || '',
                subject: replyTo.subject.startsWith('Re:') ? replyTo.subject : `Re: ${replyTo.subject}`,
                body: '',
                forwardFromId: replyTo.forwardFromId || ''
            });
        } else {
            setDetails({
                accountId: defaultAccountId || (accounts.length > 0 ? accounts[0].id : ''),
                to: '',
                subject: '',
                body: '',
                cc: '',
                bcc: '',
                forwardFromId: ''
            });
        }
    }, [isOpen, replyTo, defaultAccountId, accounts]);

    if (!isOpen) return null;

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        setSending(true);
        setError(null);

        const payload = {
            ...details,
            inReplyTo: replyTo?.messageId,
            forwardFromId: details.forwardFromId || undefined
        };
        console.log('📤 ComposeModal - Sending payload:', payload);

        try {
            await messagesApi.send(payload);
            onClose();
        } catch (err: any) {
            setError(err.response?.data?.message || err.message || 'Failed to send email');
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <div className="modal-header">
                    <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>
                        {details.forwardFromId ? 'Forward' : (replyTo ? 'Reply' : 'New Message')}
                    </h2>
                    <button onClick={onClose} className="btn-icon">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSend} className="modal-body">
                    {details.forwardFromId && (
                        <div style={{ padding: 'var(--space-3)', background: 'var(--color-accent-muted)', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)', color: 'var(--color-accent)', fontSize: 'var(--font-size-sm)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Paperclip size={16} />
                            Forwarding original message with all attachments
                        </div>
                    )}

                    {error && (
                        <div style={{ padding: 'var(--space-3)', background: 'var(--color-accent-muted)', border: '1px solid var(--color-danger)', borderRadius: 'var(--radius-md)', color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)' }}>
                            {error}
                        </div>
                    )}

                    <div className="form-group">
                        <label className="form-label">From</label>
                        <select
                            className="form-select"
                            value={details.accountId}
                            onChange={e => setDetails({ ...details, accountId: e.target.value })}
                            disabled={!!replyTo}
                        >
                            {accounts.map(acc => (
                                <option key={acc.id} value={acc.id}>
                                    {acc.emailAddress} ({acc.provider})
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="form-group">
                        <label className="form-label">To</label>
                        <input
                            type="text"
                            className="form-input"
                            placeholder="recipients (comma separated)"
                            value={details.to}
                            onChange={e => setDetails({ ...details, to: e.target.value })}
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label">Subject</label>
                        <input
                            type="text"
                            className="form-input"
                            placeholder="Subject"
                            value={details.subject}
                            onChange={e => setDetails({ ...details, subject: e.target.value })}
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label">CC</label>
                        <input
                            type="text"
                            className="form-input"
                            placeholder="cc"
                            value={details.cc}
                            onChange={e => setDetails({ ...details, cc: e.target.value })}
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label">BCC</label>
                        <input
                            type="text"
                            className="form-input"
                            placeholder="bcc"
                            value={details.bcc}
                            onChange={e => setDetails({ ...details, bcc: e.target.value })}
                        />
                    </div>

                    <textarea
                        className="form-textarea"
                        placeholder="Write your message..."
                        value={details.body}
                        onChange={e => setDetails({ ...details, body: e.target.value })}
                        required
                    />

                    <div className="modal-footer" style={{ borderTop: 'none', padding: 0 }}>
                        <button
                            type="button"
                            className="btn-icon"
                            title="Attach files (Coming soon)"
                        >
                            <Paperclip size={20} />
                        </button>

                        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                            <button
                                type="button"
                                onClick={onClose}
                                className="btn btn-secondary"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={sending}
                                className="btn btn-primary"
                                style={{ gap: '8px' }}
                            >
                                {sending ? 'Sending...' : (
                                    <>
                                        <Send size={16} />
                                        Send
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}
