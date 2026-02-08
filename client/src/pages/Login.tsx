import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function Login() {
    const [isRegister, setIsRegister] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const { login, register } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            if (isRegister) {
                await register(email, password, displayName || undefined);
            } else {
                await login(email, password);
            }
            navigate('/inbox');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="login-page">
            <div className="card login-card">
                <div className="login-header">
                    <h1 className="login-title">📧 MailHub</h1>
                    <p className="login-subtitle">
                        {isRegister ? 'Create your account' : 'Sign in to your inbox'}
                    </p>
                </div>

                {error && (
                    <div style={{
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        borderRadius: 'var(--radius-md)',
                        padding: 'var(--space-3)',
                        marginBottom: 'var(--space-5)',
                        color: 'var(--color-danger)',
                        fontSize: 'var(--font-size-sm)'
                    }}>
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit}>
                    {isRegister && (
                        <div className="form-group">
                            <label className="form-label" htmlFor="displayName">
                                Display Name
                            </label>
                            <input
                                id="displayName"
                                type="text"
                                className="form-input"
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                                placeholder="Your name"
                            />
                        </div>
                    )}

                    <div className="form-group">
                        <label className="form-label" htmlFor="email">
                            Email
                        </label>
                        <input
                            id="email"
                            type="email"
                            className="form-input"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@example.com"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label" htmlFor="password">
                            Password
                        </label>
                        <input
                            id="password"
                            type="password"
                            className="form-input"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            required
                            minLength={8}
                        />
                    </div>

                    <button
                        type="submit"
                        className="btn btn-primary"
                        style={{ width: '100%', marginBottom: 'var(--space-4)' }}
                        disabled={isLoading}
                    >
                        {isLoading ? 'Please wait...' : isRegister ? 'Create Account' : 'Sign In'}
                    </button>
                </form>

                <div style={{ textAlign: 'center' }}>
                    <button
                        className="btn btn-ghost"
                        onClick={() => {
                            setIsRegister(!isRegister);
                            setError('');
                        }}
                    >
                        {isRegister ? 'Already have an account? Sign in' : "Don't have an account? Register"}
                    </button>
                </div>
            </div>
        </div>
    );
}
