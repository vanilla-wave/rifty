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
    title: 'A real Node runtime',
    body: 'CJS + ESM loader and node: builtins. Real require, real import.',
    icon: 'feature-runtime',
  },
  {
    title: 'npm install, in-browser',
    body: 'semver resolve, registry fetch, unpack and link — no backend.',
    icon: 'feature-npm',
  },
  {
    title: 'WASI preview1 runner',
    body: 'Run .wasm guests next to your JS, on the same virtual FS.',
    icon: 'feature-wasi',
  },
  {
    title: 'Virtual FS + OPFS',
    body: 'In-memory and persistent backends with a synchronous mirror.',
    icon: 'feature-vfs',
  },
];

function makeHeader(): HTMLElement {
  const head = document.createElement('div');
  head.className = 'what-head';
  const index = document.createElement('span');
  index.className = 'what-index';
  index.textContent = '01';
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
  const title = document.createElement('div');
  title.className = 'what-title';
  title.textContent = feature.title;
  const body = document.createElement('div');
  body.className = 'what-body';
  body.textContent = feature.body;
  cell.append(tile, title, body);
  return cell;
}

/** "What you get" — 4-col hairline-gap feature grid. */
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
