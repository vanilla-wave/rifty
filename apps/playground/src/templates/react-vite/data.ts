/**
 * Mock issue dataset seeded as `src/data/issues.ts` — 25 issues, 4 statuses,
 * 5 assignees. Planted rough edge #1 lives here: several `createdAt` months are
 * NOT zero-padded (`2025-9-14`), so the dashboard's string sort misorders them.
 */
export const ISSUES_DATA_TS = `export type Status = 'open' | 'in-progress' | 'resolved' | 'closed';

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
