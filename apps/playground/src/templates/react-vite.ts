/**
 * React + Vite issue-tracker template (backlog: playground/react-vite-preset).
 * Ordinary mid-size client SPA — React 19 + TS + React Router 7 +
 * @vitejs/plugin-react — NOT a minimal toy: the agent-bench needs a normal app.
 * Template source is fully portable (npm install && npm run dev on local Node
 * serves the identical app); zero rifty-specific code/config, enforced by
 * react-vite.test.ts.
 */
import type { ViteProjectSpec } from './project-spec.ts';

const MAIN_TSX = `import { StrictMode } from 'react';
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

const APP_TSX = `import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
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

const DASHBOARD_TSX = `import { Link } from 'react-router-dom';
import StatusBadge from '../components/StatusBadge';
import { issues, statuses } from '../data/issues';

export default function Dashboard() {
  const counts = statuses.map((status) => ({
    status,
    count: issues.filter((issue) => issue.status === status).length,
  }));

  const recent = [...issues].sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1)).slice(0, 5);

  return (
    <section>
      <h1>Dashboard</h1>
      <div className="stat-grid">
        {counts.map((entry) => (
          <div className="stat-card" key={entry.status}>
            <span className="stat-card__value">{entry.count}</span>
            <StatusBadge status={entry.status} />
          </div>
        ))}
        <div className="stat-card stat-card--total">
          <span className="stat-card__value">{issues.length}</span>
          <span className="stat-card__label">total</span>
        </div>
      </div>

      <h2>Recently filed</h2>
      <ul className="recent-list">
        {recent.map((issue) => (
          <li key={issue.id}>
            <Link to={'/issues/' + issue.id}>{issue.title}</Link>
            <span className="recent-list__meta">
              {issue.createdAt} · {issue.assignee}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
`;

const ISSUE_LIST_TSX = `import { useState } from 'react';
import FilterBar from '../components/FilterBar';
import IssueCard from '../components/IssueCard';
import { issues } from '../data/issues';

export default function IssueList() {
  const [status, setStatus] = useState('all');
  const [assignee, setAssignee] = useState('all');

  const visible = issues.filter((issue) => {
    if (status !== 'all' && issue.status !== status) return false;
    if (assignee !== 'all' && issue.assignee !== assignee) return false;
    return true;
  });

  return (
    <section>
      <h1>Issues</h1>
      <FilterBar
        status={status}
        assignee={assignee}
        onStatusChange={setStatus}
        onAssigneeChange={setAssignee}
      />
      <p className="result-count">
        {visible.length} of {issues.length} issues
      </p>
      <div className="issue-grid">
        {visible.map((issue) => (
          <IssueCard key={issue.id} issue={issue} />
        ))}
      </div>
    </section>
  );
}
`;

const ISSUE_DETAIL_TSX = `import { Link, useParams } from 'react-router-dom';
import StatusBadge from '../components/StatusBadge';
import { issues } from '../data/issues';

export default function IssueDetail() {
  const { id } = useParams();
  const issue = issues.find((candidate) => String(candidate.id) === id);

  if (!issue) {
    return (
      <section>
        <h1>Issue not found</h1>
        <p>No issue with id "{id}".</p>
        <Link to="/issues">Back to issues</Link>
      </section>
    );
  }

  return (
    <section className="issue-detail">
      <Link to="/issues" className="back-link">
        ← All issues
      </Link>
      <div className="issue-detail__head">
        <h1>
          <span className="issue-detail__id">#{issue.id}</span> {issue.title}
        </h1>
        <StatusBadge status={issue.status} />
      </div>
      <dl className="issue-detail__meta">
        <dt>Assignee</dt>
        <dd>{issue.assignee}</dd>
        <dt>Created</dt>
        <dd>{issue.createdAt}</dd>
        <dt>Tags</dt>
        <dd>
          {issue.tags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </dd>
      </dl>
      <p className="issue-detail__body">{issue.description}</p>
    </section>
  );
}
`;

const SETTINGS_TSX = `import { useState } from 'react';

export default function Settings() {
  const [displayName, setDisplayName] = useState('Team Lead');
  const [density, setDensity] = useState('comfortable');
  const [notifications, setNotifications] = useState(true);

  return (
    <section className="settings">
      <h1>Settings</h1>
      <form onSubmit={(event) => event.preventDefault()}>
        <label>
          Display name
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </label>
        <label>
          List density
          <select value={density} onChange={(event) => setDensity(event.target.value)}>
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </label>
        <label className="settings__toggle">
          <input
            type="checkbox"
            checked={notifications}
            onChange={(event) => setNotifications(event.target.checked)}
          />
          Email me when an issue is assigned to me
        </label>
      </form>
      <p className="settings__note">Settings apply to this browser tab only.</p>
    </section>
  );
}
`;

const ISSUE_CARD_TSX = `import { Link } from 'react-router-dom';
import type { Issue } from '../data/issues';
import StatusBadge from './StatusBadge';

export default function IssueCard({ issue }: { issue: Issue }) {
  return (
    <Link to={'/issues/' + issue.id} className="issue-card">
      <div className="issue-card__row">
        <span className="issue-card__id">#{issue.id}</span>
        <StatusBadge status={issue.status} />
      </div>
      <h3>{issue.title}</h3>
      <div className="issue-card__row issue-card__foot">
        <span>{issue.assignee}</span>
        <span>{issue.createdAt}</span>
      </div>
      <div className="issue-card__tags">
        {issue.tags.map((tag) => (
          <span className="tag" key={tag}>
            {tag}
          </span>
        ))}
      </div>
    </Link>
  );
}
`;

const FILTER_BAR_TSX = `import { assignees, statuses } from '../data/issues';

interface FilterBarProps {
  status: string;
  assignee: string;
  onStatusChange: (status: string) => void;
  onAssigneeChange: (assignee: string) => void;
}

export default function FilterBar({
  status,
  assignee,
  onStatusChange,
  onAssigneeChange,
}: FilterBarProps) {
  return (
    <div className="filter-bar">
      <label>
        Status
        <select value={status} onChange={(event) => onStatusChange(event.target.value)}>
          <option value="all">All</option>
          {statuses.map((value) => (
            <option value={value} key={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <label>
        Assignee
        <select value={assignee} onChange={(event) => onAssigneeChange(event.target.value)}>
          <option value="all">All</option>
          {assignees.map((value) => (
            <option value={value} key={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => {
          onStatusChange('all');
          onAssigneeChange('all');
        }}
      >
        Clear
      </button>
    </div>
  );
}
`;

const STATUS_BADGE_TSX = `import type { Status } from '../data/issues';

const labels: Record<Status, string> = {
  open: 'Open',
  'in-progress': 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

export default function StatusBadge({ status }: { status: Status }) {
  return <span className={'badge badge--' + status}>{labels[status]}</span>;
}
`;

const ISSUES_DATA_TS = `export type Status = 'open' | 'in-progress' | 'resolved' | 'closed';

export interface Issue {
  id: number;
  title: string;
  description: string;
  status: Status;
  assignee: string;
  tags: string[];
  createdAt: string;
}

export const statuses: Status[] = ['open', 'in-progress', 'resolved', 'closed'];

export const assignees = ['Mara', 'Deniz', 'Kofi', 'Priya', 'Tomas'];

export const issues: Issue[] = [
  {
    id: 1,
    title: 'Login form clears itself on validation error',
    description:
      'Submitting the login form with a bad password wipes both fields, so you retype the email every time. Keep the email value and only clear the password.',
    status: 'open',
    assignee: 'Mara',
    tags: ['bug', 'auth'],
    createdAt: '2025-11-03',
  },
  {
    id: 2,
    title: 'Dashboard chart tooltip overflows on narrow screens',
    description:
      'On viewports under 400px the tooltip renders off-canvas. Probably needs a boundary check before positioning.',
    status: 'open',
    assignee: 'Deniz',
    tags: ['bug', 'ui'],
    createdAt: '2025-11-18',
  },
  {
    id: 3,
    title: 'Export to CSV drops rows with commas in the title',
    description:
      'The exporter joins fields with a comma without quoting. Any title containing a comma shifts every following column.',
    status: 'in-progress',
    assignee: 'Kofi',
    tags: ['bug', 'export'],
    createdAt: '2025-11-27',
  },
  {
    id: 4,
    title: 'Add keyboard shortcut for quick-assign',
    description:
      'Support pressing "a" on a focused row to open the assignee picker, like the triage tools people are used to.',
    status: 'open',
    assignee: 'Priya',
    tags: ['feature', 'ux'],
    createdAt: '2025-12-08',
  },
  {
    id: 5,
    title: 'API returns 500 when the page size is zero',
    description:
      'GET /api/items?pageSize=0 blows up with a divide-by-zero in the pagination helper. Should clamp to the default page size instead.',
    status: 'resolved',
    assignee: 'Tomas',
    tags: ['bug', 'api'],
    createdAt: '2025-12-15',
  },
  {
    id: 6,
    title: 'Dark mode: table stripes are unreadable',
    description:
      'The zebra stripe color was picked for the light palette; in dark mode the contrast ratio drops below 2:1.',
    status: 'closed',
    assignee: 'Mara',
    tags: ['bug', 'ui', 'a11y'],
    createdAt: '2025-9-14',
  },
  {
    id: 7,
    title: 'Slow cold start on the reports page',
    description:
      'First paint takes ~4s because the reports bundle pulls in the whole charting library. Split the chunk or lazy-load below the fold.',
    status: 'in-progress',
    assignee: 'Deniz',
    tags: ['perf'],
    createdAt: '2025-12-19',
  },
  {
    id: 8,
    title: 'Webhook retries hammer the endpoint without backoff',
    description:
      'Failed webhook deliveries retry every second, forever. Add exponential backoff with a cap and a dead-letter state.',
    status: 'open',
    assignee: 'Tomas',
    tags: ['bug', 'api', 'infra'],
    createdAt: '2026-01-06',
  },
  {
    id: 9,
    title: 'Empty state for the archive tab shows a spinner forever',
    description:
      'When the archive is empty the loading flag never flips back, so users think the page is broken.',
    status: 'resolved',
    assignee: 'Priya',
    tags: ['bug', 'ui'],
    createdAt: '2026-01-12',
  },
  {
    id: 10,
    title: 'Rename "Client" to "Workspace" across the app',
    description:
      'Product renamed the concept; strings, routes and docs still say Client in about thirty places.',
    status: 'in-progress',
    assignee: 'Mara',
    tags: ['chore', 'docs'],
    createdAt: '2026-01-21',
  },
  {
    id: 11,
    title: 'Session expires silently while editing',
    description:
      'If the token expires mid-edit, the save button fails with a console error and no user-visible message. Show a re-login prompt and keep the draft.',
    status: 'open',
    assignee: 'Kofi',
    tags: ['bug', 'auth', 'ux'],
    createdAt: '2026-02-02',
  },
  {
    id: 12,
    title: 'Add bulk close from the list view',
    description:
      'Support selecting multiple issues and closing them in one action. Needs a confirmation step and an undo toast.',
    status: 'open',
    assignee: 'Deniz',
    tags: ['feature'],
    createdAt: '2026-02-10',
  },
  {
    id: 13,
    title: 'Timezone mixup in the activity feed',
    description:
      'Events created around midnight show up under the wrong day header — the feed groups by local date but the API returns UTC.',
    status: 'resolved',
    assignee: 'Tomas',
    tags: ['bug', 'api'],
    createdAt: '2026-02-17',
  },
  {
    id: 14,
    title: 'Attachment upload fails for files over 8MB',
    description:
      'The proxy rejects the request body before it reaches the app server. Raise the limit or chunk the upload.',
    status: 'closed',
    assignee: 'Priya',
    tags: ['bug', 'infra'],
    createdAt: '2026-02-24',
  },
  {
    id: 15,
    title: 'Search index misses issues created in the last hour',
    description:
      'The indexer runs hourly; freshly created issues are invisible to search until the next run. Consider indexing on write.',
    status: 'open',
    assignee: 'Kofi',
    tags: ['bug', 'search'],
    createdAt: '2026-03-05',
  },
  {
    id: 16,
    title: 'Print stylesheet for issue detail',
    description:
      'Support wants to print issues for offline review meetings. Hide the nav, expand the description, show the id prominently.',
    status: 'open',
    assignee: 'Mara',
    tags: ['feature', 'ui'],
    createdAt: '2026-3-18',
  },
  {
    id: 17,
    title: 'Duplicate notifications when two tabs are open',
    description:
      'Each open tab registers its own listener, so every mention pings twice. Dedupe by notification id or share a worker.',
    status: 'in-progress',
    assignee: 'Deniz',
    tags: ['bug', 'notifications'],
    createdAt: '2026-03-26',
  },
  {
    id: 18,
    title: 'Assignee avatar 404s for deactivated accounts',
    description:
      'Deactivated users have their avatar purged but issues still point at the old URL. Fall back to initials.',
    status: 'resolved',
    assignee: 'Priya',
    tags: ['bug', 'ui'],
    createdAt: '2026-4-2',
  },
  {
    id: 19,
    title: 'Keyboard trap in the tag picker',
    description:
      'Tab focus cycles inside the tag dropdown and never returns to the form. Escape should close it and restore focus.',
    status: 'open',
    assignee: 'Tomas',
    tags: ['bug', 'a11y'],
    createdAt: '2026-04-14',
  },
  {
    id: 20,
    title: 'Migrate the billing job off the legacy queue',
    description:
      'The legacy queue is being decommissioned at the end of the quarter. Port the nightly billing job to the new scheduler.',
    status: 'in-progress',
    assignee: 'Kofi',
    tags: ['chore', 'infra'],
    createdAt: '2026-04-23',
  },
  {
    id: 21,
    title: 'Issue links in Slack unfurl with the wrong title',
    description:
      'The OG tags are rendered from a stale cache, so renamed issues unfurl with their old title for days.',
    status: 'open',
    assignee: 'Mara',
    tags: ['bug', 'integrations'],
    createdAt: '2026-05-07',
  },
  {
    id: 22,
    title: 'Add per-project issue templates',
    description:
      'Teams keep pasting the same checklist into new issues. Let a project define a default description template.',
    status: 'open',
    assignee: 'Deniz',
    tags: ['feature'],
    createdAt: '2026-05-16',
  },
  {
    id: 23,
    title: 'Flaky test: issue reorder drag-and-drop',
    description:
      'The drag simulation races the list re-render about once in twenty runs. Wait for the drop zone to settle before asserting.',
    status: 'closed',
    assignee: 'Priya',
    tags: ['chore', 'tests'],
    createdAt: '2026-05-29',
  },
  {
    id: 24,
    title: 'Rate limit header parsing breaks on lowercase keys',
    description:
      'The client reads X-RateLimit-Remaining case-sensitively; some proxies lowercase headers and the limiter falls back to zero.',
    status: 'resolved',
    assignee: 'Tomas',
    tags: ['bug', 'api'],
    createdAt: '2026-06-09',
  },
  {
    id: 25,
    title: 'Board view loses scroll position after closing a dialog',
    description:
      'Opening an issue dialog from deep in the board and closing it snaps the board back to the top. Restore the scroll offset.',
    status: 'open',
    assignee: 'Kofi',
    tags: ['bug', 'ux'],
    createdAt: '2026-06-25',
  },
];
`;

const GLOBAL_CSS = `* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #f6f7f9;
  color: #1c2330;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 15px;
  line-height: 1.45;
}

a {
  color: #2456c4;
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

.topbar {
  align-items: center;
  background: #1c2330;
  color: #fff;
  display: flex;
  gap: 28px;
  padding: 12px 24px;
}

.brand {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.topbar nav {
  display: flex;
  gap: 16px;
}

.topbar nav a {
  color: rgba(255, 255, 255, 0.72);
  padding: 4px 2px;
}

.topbar nav a.active {
  border-bottom: 2px solid #6ea8ff;
  color: #fff;
}

.page {
  margin: 0 auto;
  max-width: 960px;
  padding: 24px;
}

h1 {
  font-size: 24px;
  margin: 0 0 18px;
}

h2 {
  font-size: 18px;
  margin: 28px 0 10px;
}

.stat-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
}

.stat-card {
  background: #fff;
  border: 1px solid #e2e5ea;
  border-radius: 8px;
  display: grid;
  gap: 6px;
  justify-items: start;
  padding: 14px 16px;
}

.stat-card__value {
  font-size: 26px;
  font-weight: 700;
}

.stat-card--total .stat-card__label {
  color: #6b7280;
  font-size: 12px;
  text-transform: uppercase;
}

.recent-list {
  display: grid;
  gap: 8px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.recent-list li {
  background: #fff;
  border: 1px solid #e2e5ea;
  border-radius: 8px;
  display: flex;
  justify-content: space-between;
  padding: 10px 14px;
}

.recent-list__meta {
  color: #6b7280;
  font-size: 13px;
}
`;

const ISSUES_CSS = `.filter-bar {
  align-items: end;
  display: flex;
  gap: 14px;
  margin-bottom: 12px;
}

.filter-bar label {
  display: grid;
  font-size: 13px;
  gap: 4px;
}

.filter-bar select {
  min-width: 140px;
  padding: 5px 6px;
}

.filter-bar button {
  background: #fff;
  border: 1px solid #c9ced6;
  border-radius: 6px;
  cursor: pointer;
  padding: 6px 12px;
}

.result-count {
  color: #6b7280;
  font-size: 13px;
  margin: 0 0 12px;
}

.issue-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
}

.issue-card {
  background: #fff;
  border: 1px solid #e2e5ea;
  border-radius: 8px;
  color: inherit;
  display: grid;
  gap: 8px;
  padding: 14px;
}

.issue-card:hover {
  border-color: #9db4dd;
  text-decoration: none;
}

.issue-card h3 {
  font-size: 15px;
  margin: 0;
}

.issue-card__row {
  align-items: center;
  display: flex;
  justify-content: space-between;
}

.issue-card__id {
  color: #6b7280;
  font-size: 13px;
}

.issue-card__foot {
  color: #6b7280;
  font-size: 13px;
}

.issue-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag {
  background: #eef1f6;
  border-radius: 10px;
  color: #45506b;
  font-size: 12px;
  padding: 2px 8px;
}

.badge {
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
  padding: 2px 10px;
}

.badge--open {
  background: #e8f0fe;
  color: #1b4dad;
}

.badge--in-progress {
  background: #fef3dd;
  color: #92600a;
}

.badge--resolved {
  background: #e3f6e8;
  color: #1e7a37;
}

.badge--closed {
  background: #ececf0;
  color: #5b6472;
}

.issue-detail .back-link {
  display: inline-block;
  margin-bottom: 14px;
}

.issue-detail__head {
  align-items: center;
  display: flex;
  gap: 12px;
}

.issue-detail__head h1 {
  margin: 0;
}

.issue-detail__id {
  color: #6b7280;
  font-weight: 400;
}

.issue-detail__meta {
  display: grid;
  gap: 4px 18px;
  grid-template-columns: max-content 1fr;
  margin: 18px 0;
}

.issue-detail__meta dt {
  color: #6b7280;
}

.issue-detail__meta dd {
  display: flex;
  gap: 6px;
  margin: 0;
}

.issue-detail__body {
  background: #fff;
  border: 1px solid #e2e5ea;
  border-radius: 8px;
  max-width: 640px;
  padding: 16px;
}

.settings form {
  display: grid;
  gap: 14px;
  max-width: 380px;
}

.settings label {
  display: grid;
  font-size: 14px;
  gap: 4px;
}

.settings input[type='text'],
.settings input:not([type]),
.settings select {
  padding: 6px 8px;
}

.settings__toggle {
  align-items: center;
  display: flex;
  gap: 8px;
}

.settings__note {
  color: #6b7280;
  font-size: 13px;
  margin-top: 18px;
}
`;

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Trackline</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

const VITE_CONFIG_TS = `import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
});
`;

const TSCONFIG_JSON = `{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noEmit": true,
    "isolatedModules": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
`;

export const REACT_VITE_TEMPLATE = {
  id: 'react-vite',
  displayName: 'React issue tracker',
  runtime: 'vite',
  install: {
    react: '^19.0.0',
    'react-dom': '^19.0.0',
    'react-router-dom': '^7.0.0',
  },
  devDependencies: {
    // Lockstep-pinned to vite's resolved rollup (same as the vite template):
    // in-browser dev boots rollup through its official WASM build; locally it
    // is an inert extra devDependency (real rollup never requires it).
    '@rollup/wasm-node': '4.62.2',
    '@types/react': '^19.0.0',
    '@types/react-dom': '^19.0.0',
    '@vitejs/plugin-react': '^5.0.0',
    typescript: '^5.0.0',
    vite: '^7.0.0',
  },
  // Standard portable scripts on top of the lifecycle-owned dev aliases.
  scripts: {
    build: 'vite build',
    preview: 'vite preview',
  },
  // Regenerate with `pnpm snapshots:bake` after changing dependencies (ADR-0135).
  bakedNodeModulesUrl: '/snapshots/react-vite-node-modules.json.gz',
  runtimeSpecifier: 'vite',
  entry: { relativePath: '/src/main.tsx', content: MAIN_TSX },
  defaultPort: 5174,
  estimatedBootSeconds: 20,
  htmlTitle: 'Trackline',
  extraFiles: {
    // Overrides the generated index.html: same file locally and in the worker.
    '/index.html': INDEX_HTML,
    '/vite.config.ts': VITE_CONFIG_TS,
    '/tsconfig.json': TSCONFIG_JSON,
    '/src/App.tsx': APP_TSX,
    '/src/pages/Dashboard.tsx': DASHBOARD_TSX,
    '/src/pages/IssueList.tsx': ISSUE_LIST_TSX,
    '/src/pages/IssueDetail.tsx': ISSUE_DETAIL_TSX,
    '/src/pages/Settings.tsx': SETTINGS_TSX,
    '/src/components/IssueCard.tsx': ISSUE_CARD_TSX,
    '/src/components/FilterBar.tsx': FILTER_BAR_TSX,
    '/src/components/StatusBadge.tsx': STATUS_BADGE_TSX,
    '/src/data/issues.ts': ISSUES_DATA_TS,
    '/src/styles/global.css': GLOBAL_CSS,
    '/src/styles/issues.css': ISSUES_CSS,
  },
  server: {
    appType: 'spa',
    strictPort: true,
    // Real dep pre-bundling REQUIRED: react/react-dom are CJS-only and
    // @vitejs/plugin-react injects optimizeDeps.include — the optimizer runs
    // on the host esbuild-wasm bridge (ADR-0192).
    optimizeDepsDisabled: false,
    host: true,
    allowedHosts: true,
  },
  hmr: { enabled: true },
} satisfies ViteProjectSpec;
