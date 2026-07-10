import { buildPresetHref } from '../playground-url';
import './demos.css';

interface Demo {
  readonly id: string;
  readonly kicker: string;
  readonly glyph: string;
  readonly title: string;
  readonly body: string;
  readonly meta: string;
}

const DEMOS: readonly Demo[] = [
  {
    id: 'real-vite',
    kicker: 'TOOLING',
    glyph: 'V7',
    title: 'Vite 7 + npm',
    body: 'Run a visible npm install, then start the real Vite 7 dev server with module transforms and HMR.',
    meta: 'npm install · live preview',
  },
  {
    id: 'express-sqlite',
    kicker: 'FULL STACK',
    glyph: 'EX',
    title: 'Express + SQLite',
    body: 'Install Express, run an HTTP server in a Worker, and query SQLite compiled to WebAssembly.',
    meta: 'npm install · live preview',
  },
  {
    id: 'cli-report',
    kicker: 'NODE CLI',
    glyph: 'CLI',
    title: 'CLI report',
    body: 'Install a real npm dependency, read VFS input through node:fs, stream stdout, and exit cleanly.',
    meta: 'npm install · run to completion',
  },
  {
    id: 'markdown-ssg',
    kicker: 'FILESYSTEM BUILD',
    glyph: 'MD',
    title: 'Markdown SSG',
    body: 'Run a filesystem-heavy static-site build: Markdown in, generated HTML out, then serve the result.',
    meta: 'npm install · generated preview',
  },
];

function makeCard(demo: Demo): HTMLAnchorElement {
  const card = document.createElement('a');
  card.className = 'demo-card';
  card.href = buildPresetHref(demo.id, import.meta.env.VITE_RIFTY_PLAYGROUND_URL);
  card.setAttribute('data-preset-card', demo.id);

  const top = document.createElement('div');
  top.className = 'demo-card-top';
  const glyph = document.createElement('span');
  glyph.className = 'demo-glyph';
  glyph.textContent = demo.glyph;
  const kicker = document.createElement('span');
  kicker.className = 'demo-kicker';
  kicker.textContent = demo.kicker;
  top.append(glyph, kicker);

  const title = document.createElement('h3');
  title.className = 'demo-title';
  title.textContent = demo.title;

  const body = document.createElement('p');
  body.className = 'demo-body';
  body.textContent = demo.body;

  const footer = document.createElement('div');
  footer.className = 'demo-footer';
  const divider = document.createElement('span');
  divider.className = 'demo-divider';
  divider.setAttribute('aria-hidden', 'true');
  const meta = document.createElement('span');
  meta.className = 'demo-meta';
  meta.textContent = demo.meta;
  const action = document.createElement('span');
  action.className = 'demo-action';
  action.textContent = 'Open preset ↗';
  footer.append(divider, meta, action);

  card.append(top, title, body, footer);
  return card;
}

/** Proven playground outcomes, each linked to a cold-booting preset deeplink. */
export function renderDemos(): HTMLElement {
  const section = document.createElement('section');
  section.id = 'demos';
  section.className = 'demos';

  const head = document.createElement('div');
  head.className = 'demos-head';
  const eyebrow = document.createElement('div');
  eyebrow.className = 'demos-eyebrow';
  const index = document.createElement('span');
  index.className = 'demos-index';
  index.textContent = '01';
  const label = document.createElement('span');
  label.className = 'demos-label';
  label.textContent = 'Run something real';
  eyebrow.append(index, label);

  const title = document.createElement('h2');
  title.className = 'demos-title';
  title.textContent = 'Start with a working project, not a toy snippet.';

  const intro = document.createElement('p');
  intro.className = 'demos-intro';
  intro.textContent =
    'Each link opens the Chromium playground, selects the preset, and starts its real boot flow inside the browser.';
  head.append(eyebrow, title, intro);

  const grid = document.createElement('div');
  grid.className = 'demos-grid';
  grid.append(...DEMOS.map(makeCard));

  section.append(head, grid);
  return section;
}
