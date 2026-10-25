/** Entry + router shell seeded as `src/main.tsx` / `src/App.tsx`. */

export const MAIN_TSX = `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';
import './styles/issues.css';

const container = document.getElementById('root');
if (!container) throw new Error('missing #root container');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`;

export const APP_TSX = `import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import IssueDetail from './pages/IssueDetail';
import IssueList from './pages/IssueList';
import Settings from './pages/Settings';

export default function App() {
  return (
    <BrowserRouter>
      <header className="topbar">
        <span className="brand">Trackline</span>
        <nav>
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/issues">Issues</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/issues" element={<IssueList />} />
          <Route path="/issues/:id" element={<IssueDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
`;
