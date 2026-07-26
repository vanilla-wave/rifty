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
    body: 'Run CommonJS and ESM projects against the supported Node API surface. Missing behavior fails loudly.',
    icon: 'feature-runtime',
  },
  {
    title: 'npm install, in-browser',
    body: 'Install packages and run project scripts and JavaScript tooling in the browser.',
    icon: 'feature-npm',
  },
  {
    title: 'WASI preview1 runner',
    body: 'Run compatible WebAssembly programs against project files with standard input and output.',
    icon: 'feature-wasi',
  },
  {
    title: 'Virtual FS + OPFS',
    body: 'Keep project files in memory or persist them in browser storage.',
    icon: 'feature-vfs',
  },
  {
    title: 'Embeddable Workbench',
    body: 'Embed project, terminal, run and preview workflows through public APIs.',
    icon: 'feature-runtime',
  },
  {
    title: 'TypeScript + Git over VFS',
    body: 'Use TypeScript language features and Git workflows against the same workspace.',
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
