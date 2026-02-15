import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import Login from './pages/Login';
import Inbox from './pages/Inbox';
import Thread from './pages/Thread';
import Settings from './pages/Settings';
import Rules from './pages/Rules';
import Layout from './components/Layout';

function App() {
    const { user, isLoading } = useAuth();

    if (isLoading) {
        return (
            <div className="loading-screen">
                <div className="loading-spinner" />
                <p>Loading...</p>
            </div>
        );
    }

    if (!user) {
        return (
            <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
        );
    }

    return (
        <Routes>
            <Route element={<Layout />}>
                <Route path="/" element={<Navigate to="/inbox" replace />} />
                <Route path="/inbox" element={<Inbox />} />
                <Route path="/inbox/:category" element={<Inbox />} />
                <Route path="/inbox/folder/:folderId" element={<Inbox />} />
                <Route path="/account/:accountId" element={<Inbox />} />
                <Route path="/thread/:threadId" element={<Thread />} />
                <Route path="/rules" element={<Rules />} />
                <Route path="/settings" element={<Settings />} />
            </Route>
            <Route path="/login" element={<Navigate to="/inbox" replace />} />
        </Routes>
    );
}

export default App;
