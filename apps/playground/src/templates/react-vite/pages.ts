/**
 * Route components seeded as `src/pages/*.tsx`.
 * Planted rough edges: the dashboard sorts `createdAt` as TEXT (#1), the issue
 * list has no search box (#2) and keeps its filters in component state only,
 * never in the URL (#3).
 */

export const DASHBOARD_TSX = `import { Link } from 'react-router-dom';
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

export const ISSUE_LIST_TSX = `import { useState } from 'react';
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

export const ISSUE_DETAIL_TSX = `import { Link, useParams } from 'react-router-dom';
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

export const SETTINGS_TSX = `import { useState } from 'react';

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
