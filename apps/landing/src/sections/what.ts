import type { IconName } from '../icons';
import { icon } from '../icons';
import './what.css';

interface Feature {
  readonly title: string;
  readonly body: string;
  readonly icon: IconName;
}

const FEATURES: readonly Feature[] = [
  {
    title: 'A Node-compatible runtime',
    body: 'CJS + ESM loader and tested Node 24 builtin subsets. Real require/import; gaps stay loud.',
    icon: 'feature-runtime',
  },
  {
    title: 'npm install, in-browser',
    body: 'Install registry packages and run project npm scripts, Prettier, ESLint and type-aware linting in-browser.',
    icon: 'feature-npm',
  },
  {
    title: 'WASI preview1 runner',
    body: 'Run WASI preview1 .wasm guests with VFS-backed preopens and process-shaped stdio/exit.',
    icon: 'feature-wasi',
  },
  {
    title: 'Virtual FS + OPFS',
    body: 'Memory and OPFS backends with sync mirrors; the Workbench owner holds the editable-tree authority.',
    icon: 'feature-vfs',
  },
  {
    title: 'Embeddable Workbench',
    body: 'Framework-free project, run, file, terminal and preview APIs backed by one owner Worker.',
    icon: 'feature-runtime',
  },
  {
    title: 'TypeScript + Git over VFS',
    body: 'Project-aware diagnostics and navigation plus a tested Git porcelain subset against the workspace tree.',
    icon: 'feature-vfs',
  },
];

function makeHeader(): HTMLElement {
  const head = document.createElement('div');
  head.className = 'what-head';
  const index = document.createElement('span');
  index.className = 'what-index';
  index.textContent = '02';
  const label = document.createElement('h2');
  label.className = 'what-label';
  label.textContent = 'What you get';
  head.append(index, label);
  return head;
}

function makeCell(feature: Feature): HTMLElement {
  const cell = document.createElement('div');
  cell.className = 'what-cell';
  const tile = document.createElement('div');
  tile.className = 'what-tile';
  tile.innerHTML = icon(feature.icon, 17);
  const title = document.createElement('h3');
  title.className = 'what-title';
  title.textContent = feature.title;
  const body = document.createElement('div');
  body.className = 'what-body';
  body.textContent = feature.body;
  cell.append(tile, title, body);
  return cell;
}

/** "What you get" — compact hairline-gap feature grid. */
export function renderWhat(): HTMLElement {
  const section = document.createElement('section');
  section.id = 'what';
  section.className = 'what';

  const grid = document.createElement('div');
  grid.className = 'what-grid';
  for (const feature of FEATURES) {
    grid.append(makeCell(feature));
  }

  section.append(makeHeader(), grid);
  return section;
}
