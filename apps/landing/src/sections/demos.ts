import { buildPresetHref } from '../playground-url';
import './demos.css';

interface Demo {
  readonly id: string;
  readonly glyph: string;
  readonly tag: string;
  readonly title: string;
  readonly body: string;
  readonly meta: string;
  readonly ariaLabel: string;
}

const DEMOS: readonly Demo[] = [
  {
    id: 'real-vite',
    glyph: 'DEV',
    tag: 'TOOLING',
    title: 'Dev server + HMR',
    body: 'Install packages and run a live development server with module transforms and HMR.',
    meta: 'npm install · live preview',
    ariaLabel: 'Open Vite preset: Dev server + HMR',
  },
  {
    id: 'express-sqlite',
    glyph: 'HTTP',
    tag: 'SERVER APP',
    title: 'HTTP server + database',
    body: 'Run a Node-compatible HTTP app with a WebAssembly-backed SQLite database.',
    meta: 'npm install · live preview',
    ariaLabel: 'Open Express preset: HTTP server + database',
  },
  {
    id: 'cli-report',
    glyph: 'CLI',
    tag: 'COMMAND LINE',
    title: 'CLI + project files',
    body: 'Run a Node-compatible CLI against the virtual filesystem and stream its output.',
    meta: 'npm install · run to completion',
    ariaLabel: 'Open CLI preset: CLI + project files',
  },
];

function makeCard(demo: Demo): HTMLAnchorElement {
  const card = document.createElement('a');
  card.className = 'demo';
  card.href = buildPresetHref(demo.id, import.meta.env.VITE_RIFTY_PLAYGROUND_URL);
  card.setAttribute('data-preset-card', demo.id);
  card.setAttribute('aria-label', demo.ariaLabel);

  const top = document.createElement('div');
  top.className = 'demo-top';
  const glyph = document.createElement('span');
  glyph.className = 'demo-glyph';
  glyph.textContent = demo.glyph;
  const tag = document.createElement('span');
  tag.className = 'demo-tag';
  tag.textContent = demo.tag;
  top.append(glyph, tag);

  const title = document.createElement('h3');
  title.className = 'demo-title';
  title.textContent = demo.title;

  const body = document.createElement('p');
  body.className = 'demo-body';
  body.textContent = demo.body;

  const foot = document.createElement('div');
  foot.className = 'demo-foot';
  const meta = document.createElement('span');
  meta.className = 'demo-meta';
  meta.textContent = demo.meta;
  const action = document.createElement('span');
  action.className = 'demo-action';
  action.textContent = 'OPEN ↗';
  foot.append(meta, action);

  card.append(top, title, body, foot);
  return card;
}

/** 01 — three representative playground presets, each a cold-booting deeplink. */
export function renderDemos(): HTMLElement {
  const section = document.createElement('section');
  section.id = 'demos';
  section.className = 'sec demos';

  const index = document.createElement('p');
  index.className = 'sec-index';
  index.textContent = '01 — RUN SOMETHING REAL';
  const title = document.createElement('h2');
  title.className = 'sec-title';
  title.textContent = 'Three representative workflows.';
  const intro = document.createElement('p');
  intro.className = 'sec-intro';
  intro.textContent =
    'Dev tooling, server apps, and command-line programs. More presets live in the playground.';

  const grid = document.createElement('div');
  grid.className = 'demos-grid';
  grid.append(...DEMOS.map(makeCard));

  section.append(index, title, intro, grid);
  return section;
}
