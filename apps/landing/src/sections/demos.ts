import { buildPresetHref } from '../playground-url';
import './demos.css';

interface Demo {
  readonly id: string;
  readonly glyph: string;
  readonly title: string;
  readonly body: string;
  readonly action: string;
  readonly ariaLabel: string;
}

const DEMOS: readonly Demo[] = [
  {
    id: 'real-vite',
    glyph: 'DEV',
    title: 'Dev server + HMR',
    body: 'Install packages and run a live development server with module transforms and HMR.',
    action: 'Open Vite example ↗',
    ariaLabel: 'Open Vite preset: Dev server + HMR',
  },
  {
    id: 'express-sqlite',
    glyph: 'HTTP',
    title: 'HTTP server + database',
    body: 'Run a Node-compatible HTTP app with a WebAssembly-backed SQLite database.',
    action: 'Open Express example ↗',
    ariaLabel: 'Open Express preset: HTTP server + database',
  },
  {
    id: 'cli-report',
    glyph: 'CLI',
    title: 'CLI + project files',
    body: 'Run a Node-compatible CLI against the virtual filesystem and stream its output.',
    action: 'Open CLI example ↗',
    ariaLabel: 'Open CLI preset: CLI + project files',
  },
];

function makeCard(demo: Demo): HTMLAnchorElement {
  const card = document.createElement('a');
  card.className = 'demo-card';
  card.href = buildPresetHref(demo.id, import.meta.env.VITE_RIFTY_PLAYGROUND_URL);
  card.setAttribute('data-preset-card', demo.id);
  card.setAttribute('aria-label', demo.ariaLabel);

  const glyph = document.createElement('span');
  glyph.className = 'demo-glyph';
  glyph.textContent = demo.glyph;
  glyph.setAttribute('aria-hidden', 'true');

  const title = document.createElement('h3');
  title.className = 'demo-title';
  title.textContent = demo.title;

  const body = document.createElement('p');
  body.className = 'demo-body';
  body.textContent = demo.body;

  const action = document.createElement('span');
  action.className = 'demo-action';
  action.textContent = demo.action;

  card.append(glyph, title, body, action);
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
  title.textContent = 'Three representative workflows.';

  const intro = document.createElement('p');
  intro.className = 'demos-intro';
  intro.textContent =
    'Dev tooling, server apps, and command-line programs. More presets live in the playground.';
  head.append(eyebrow, title, intro);

  const grid = document.createElement('div');
  grid.className = 'demos-grid';
  grid.append(...DEMOS.map(makeCard));

  section.append(head, grid);
  return section;
}
