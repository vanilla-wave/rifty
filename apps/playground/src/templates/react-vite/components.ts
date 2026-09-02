/** Presentational components seeded as `src/components/*.tsx`. */

export const ISSUE_CARD_TSX = `import { Link } from 'react-router-dom';
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

export const FILTER_BAR_TSX = `import { assignees, statuses } from '../data/issues';

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

export const STATUS_BADGE_TSX = `import type { Status } from '../data/issues';

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
