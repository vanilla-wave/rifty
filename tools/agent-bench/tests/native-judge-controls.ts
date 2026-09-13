import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { run } from '../src/runner.ts';
import { type Task, loadTasks } from '../src/tasks.ts';
import { observedSmokeModel } from './observed-smoke-model.ts';

/** Ordinary functioning Node/React programs: independent positive controls for common judges. */
function repaired(task: Task): Task {
  const files = { ...task.files };
  if (task.id === 'fix-date-sort')
    files['src/pages/Dashboard.tsx'] = files['src/pages/Dashboard.tsx']!.replace(
      '(a.createdAt > b.createdAt ? -1 : 1)',
      '(new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())',
    );
  if (task.id === 'add-search')
    files['src/pages/IssueList.tsx'] = files['src/pages/IssueList.tsx']!.replace(
      '  const [status',
      "  const [query, setQuery] = useState('');\n  const [status",
    )
      .replace(
        '    if (status',
        '    if (!issue.title.toLowerCase().includes(query.toLowerCase())) return false;\n    if (status',
      )
      .replace(
        '      <FilterBar',
        '      <label>Search<input value={query} onChange={event => setQuery(event.target.value)} /></label>\n      <FilterBar',
      );
  if (task.id === 'url-filters')
    files['src/pages/IssueList.tsx'] = files['src/pages/IssueList.tsx']!.replace(
      "import { useState } from 'react';",
      "import { useSearchParams } from 'react-router-dom';",
    ).replace(
      "  const [status, setStatus] = useState('all');\n  const [assignee, setAssignee] = useState('all');",
      `  const [params, setParams] = useSearchParams();
  const status = params.get('status') || 'all';
  const assignee = params.get('assignee') || 'all';
  const update = (key: string, value: string) => setParams(previous => { const next = new URLSearchParams(previous); next.set(key, value); return next; });
  const setStatus = (value: string) => update('status', value);
  const setAssignee = (value: string) => update('assignee', value);`,
    );
  if (task.id === 'new-issue-form')
    files['src/pages/IssueList.tsx'] = files['src/pages/IssueList.tsx']!.replace(
      '  const [status',
      "  const [records, setRecords] = useState(() => [...issues]);\n  const [creating, setCreating] = useState(false);\n  const [title, setTitle] = useState('');\n  const [status",
    )
      .replace('const visible = issues.filter', 'const visible = records.filter')
      .replace('{issues.length} issues', '{records.length} issues')
      .replace(
        '      <FilterBar',
        `      <button onClick={() => setCreating(true)}>New issue</button>
      {creating && <form onSubmit={event => {event.preventDefault(); if (!title.trim()) return; setRecords(current => [...current, {id: 26, title: title.trim(), description: '', status: 'open', assignee: 'Mara', tags: [], createdAt: '2026-09-13'}]); setCreating(false); }}>
        <label>Title<input required value={title} onChange={event => setTitle(event.target.value)} /></label><button type="submit">Create issue</button>
      </form>}
      <FilterBar`,
      );
  if (task.id === 'node-endpoint')
    files['src/main.js'] = files['src/main.js']!.replace(
      "app.get('/api/messages'",
      `app.get('/api/stats', ctx => { const byAuthor = {}; for (const message of messages) byAuthor[message.author] = (byAuthor[message.author] || 0) + 1; return ctx.json({total: messages.length, byAuthor}); });
app.get('/api/messages'`,
    );
  return { ...task, files };
}

const model = await observedSmokeModel();
const config = await loadConfig();
config.endpoint = { baseUrl: model.baseUrl, model: 'scripted' };
config.runsPerTask = 1;
const selected = (await loadTasks()).filter(
  (task) => !process.argv[2] || task.id === process.argv[2],
);
assert.ok(selected.length);
const controls = selected.flatMap((task) => {
  const fixed = repaired(task);
  if (task.id === 'url-filters') {
    fixed.judge = async (ctx) => {
      const page = 'context' in ctx.view ? ctx.view : ctx.view.page();
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
      await ctx.view.goto(new URL('issues?status=open&assignee=Deniz', ctx.previewUrl).href);
      await page.getByRole('heading', { name: 'Issues', exact: true }).waitFor();
      return task.judge(ctx);
    };
  }
  if (task.id !== 'new-issue-form') return [fixed];
  const source = fixed.files['src/pages/IssueList.tsx']!;
  return [
    fixed,
    {
      ...fixed,
      id: `${task.id}-textarea`,
      files: {
        ...fixed.files,
        'src/pages/IssueList.tsx': source.replace('<input required', '<textarea required'),
      },
    },
    {
      ...fixed,
      id: `${task.id}-link`,
      files: {
        ...fixed.files,
        'src/App.tsx': fixed.files['src/App.tsx']!.replace(
          '<Route path="/issues/:id"',
          '<Route path="/issues/new" element={<IssueList />} /><Route path="/issues/:id"',
        ),
        'src/pages/IssueList.tsx': source
          .replace(
            "import { useState } from 'react';",
            "import { useState } from 'react';\nimport { Link, useLocation, useNavigate } from 'react-router-dom';",
          )
          .replace(
            'const [creating, setCreating] = useState(false);',
            "const creating = useLocation().pathname === '/issues/new'; const navigate = useNavigate();",
          )
          .replace(
            '<button onClick={() => setCreating(true)}>New issue</button>',
            '<Link to="/issues/new">New issue</Link>',
          )
          .replace('setCreating(false)', "navigate('/issues')"),
      },
    },
  ];
});
const out = await mkdtemp(join(tmpdir(), 'rifty-bench-native-judges-'));
try {
  const report = await run(config, controls, ['local-reference'], out);
  console.log(
    JSON.stringify(
      {
        out,
        runs: report.runs.map(({ task, outcome, stage, error, judge }) => ({
          task,
          outcome,
          stage,
          error,
          judge,
        })),
      },
      null,
      2,
    ),
  );
  assert.deepEqual(
    report.runs.map(({ task, outcome }) => ({ task, outcome })),
    controls.map((task) => ({ task: task.id, outcome: 'pass' })),
  );
  assert.equal(model.requests.length, controls.length * 2);
} finally {
  await model.close();
}
