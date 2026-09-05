import './what.css';

interface Feature {
  readonly title: string;
  readonly body: string;
}

const FEATURES: readonly Feature[] = [
  {
    title: 'NODE RUNTIME',
    body: 'CJS + ESM loader and tested node: builtin subsets. Real require, real import. Missing behavior fails loudly.',
  },
  {
    title: 'NPM IN-BROWSER',
    body: 'Resolve, fetch, verify, unpack, link — execution stays browser-local.',
  },
  {
    title: 'WASI RUNNER',
    body: '.wasm guests next to your JS, same virtual FS.',
  },
  {
    title: 'VFS + OPFS',
    body: 'In-memory and persistent backends, sync mirror.',
  },
  {
    title: 'EMBEDDABLE WORKBENCH',
    body: 'Project, terminal, run and preview workflows through public APIs.',
  },
  {
    title: 'TYPESCRIPT + GIT OVER VFS',
    body: 'Language service diagnostics and Git workflows against the same workspace.',
  },
];

interface TermLine {
  readonly kind: 'comment' | 'cmd' | 'dim' | 'ok' | 'lime' | 'plain';
  readonly text: string;
}

const TERMINAL: readonly TermLine[] = [
  { kind: 'comment', text: '// LIVE — /preview/3000/' },
  { kind: 'cmd', text: 'npm install express' },
  { kind: 'dim', text: 'resolve · fetch · verify · unpack · link' },
  { kind: 'ok', text: '+ express@4 — runs end-to-end' },
  { kind: 'cmd', text: 'node server.js' },
  { kind: 'lime', text: 'express listening on :3000' },
  { kind: 'plain', text: 'GET /preview/3000/ 200' },
];

function buildTerminal(): HTMLElement {
  const term = document.createElement('div');
  term.className = 'term';
  term.setAttribute('role', 'img');
  term.setAttribute(
    'aria-label',
    'Terminal: npm install express, then node server.js; Express listens on port 3000 and the live preview answers GET /preview/3000/ with 200.',
  );
  for (const line of TERMINAL) {
    const row = document.createElement('div');
    row.className = `term-line term-${line.kind}`;
    if (line.kind === 'cmd') {
      const prompt = document.createElement('span');
      prompt.className = 'term-prompt';
      prompt.textContent = '$ ';
      row.append(prompt);
    }
    row.append(document.createTextNode(line.text));
    term.append(row);
  }
  const cursor = document.createElement('span');
  cursor.className = 'term-cursor';
  term.lastElementChild?.append(cursor);
  return term;
}

function buildFeatures(): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'feat-grid';
  for (const feature of FEATURES) {
    const cell = document.createElement('div');
    cell.className = 'feat';
    const title = document.createElement('h3');
    title.className = 'feat-title';
    title.textContent = feature.title;
    const body = document.createElement('p');
    body.className = 'feat-body';
    body.textContent = feature.body;
    cell.append(title, body);
    grid.append(cell);
  }
  return grid;
}

/** Overview: the live terminal mock beside the capability grid. */
export function renderWhat(): HTMLElement {
  const section = document.createElement('section');
  section.id = 'what';
  section.className = 'sec what';
  const heading = document.createElement('h2');
  heading.className = 'visually-hidden';
  heading.textContent = 'What you get';
  const grid = document.createElement('div');
  grid.className = 'what-grid';
  grid.append(buildTerminal(), buildFeatures());
  section.append(heading, grid);
  return section;
}
