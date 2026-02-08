import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const categories = [
    { name: 'All Mail', path: '/inbox', icon: '📬' },
    { name: 'Personal', path: '/inbox/Personal', icon: '👤' },
    { name: 'Banking', path: '/inbox/Banking - Critical', icon: '🏦' },
    { name: 'Taxes', path: '/inbox/Taxes', icon: '📊' },
    { name: 'Legal', path: '/inbox/Legal', icon: '⚖️' },
    { name: 'Vendors', path: '/inbox/Vendors', icon: '🏢' },
    { name: 'Receipts', path: '/inbox/Receipts', icon: '🧾' },
    { name: 'Newsletters', path: '/inbox/Newsletters', icon: '📰' },
    { name: 'Sales', path: '/inbox/Sales', icon: '💼' },
    { name: 'Quarantine', path: '/inbox/Quarantine', icon: '❓' },
];

export default function Layout() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    return (
        <div className="app-layout">
            <aside className="sidebar">
                <div className="sidebar-header">
                    <h1 className="sidebar-logo">📧 MailHub</h1>
                </div>

                <nav className="sidebar-nav">
                    <div className="nav-section">
                        <span className="nav-section-title">Inbox</span>
                        {categories.map((cat) => (
                            <NavLink
                                key={cat.path}
                                to={cat.path}
                                end={cat.path === '/inbox'}
                                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                            >
                                <span>{cat.icon}</span>
                                <span>{cat.name}</span>
                            </NavLink>
                        ))}
                    </div>

                    <div className="nav-section">
                        <span className="nav-section-title">Manage</span>
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
        </div>
    );
}
