import { icon } from '../icons';
import { QUICKSTART_SNIPPET, type SnippetToken } from '../public-snippets';
import './quickstart.css';

function codeLine(toks: readonly SnippetToken[]): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'qs-code-line';
  if (toks.length === 0) {
    div.textContent = ' ';
    return div;
  }
  for (const [text, cls] of toks) {
    const span = document.createElement('span');
    if (cls) {
      span.className = cls;
    }
    span.textContent = text;
    div.append(span);
  }
  return div;
}

function buildCodeCard(): HTMLElement {
  const card = document.createElement('div');
  card.className = 'qs-code-card';

  const tab = document.createElement('div');
  tab.className = 'qs-code-tab';
  const fileIcon = document.createElement('span');
  fileIcon.className = 'qs-code-tab-icon';
  fileIcon.innerHTML = icon('terminal-dot', 13);
  tab.append(fileIcon, document.createTextNode('boot.vite.ts'));

  const body = document.createElement('div');
  body.className = 'qs-code-body';
  for (const line of QUICKSTART_SNIPPET) body.append(codeLine(line));

  card.append(tab, body);
  return card;
}

function buildCallout(): HTMLElement {
  const callout = document.createElement('div');
  callout.className = 'qs-callout';

  const titleRow = document.createElement('h3');
  titleRow.className = 'qs-callout-title';
  const warnIcon = document.createElement('span');
  warnIcon.className = 'qs-callout-icon';
  warnIcon.innerHTML = icon('warning-triangle', 15);
  const title = document.createElement('span');
  title.className = 'qs-callout-heading';
  title.textContent = 'Cross-origin isolation + ESM Workers';
  titleRow.append(warnIcon, title);

  const body = document.createElement('p');
  body.className = 'qs-callout-body';
  body.append(document.createTextNode('The runtime needs '));
  const sab = document.createElement('code');
  sab.className = 'qs-code-inline';
  sab.textContent = 'SharedArrayBuffer';
  body.append(sab, document.createTextNode('. Serve with '));
  const coop = document.createElement('code');
  coop.className = 'qs-code-inline qs-code-warn';
  coop.textContent = 'COOP';
  body.append(coop, document.createTextNode(' + '));
  const coep = document.createElement('code');
  coep.className = 'qs-code-inline qs-code-warn';
  coep.textContent = 'COEP';
  body.append(coep, document.createTextNode(' headers so '));
  const coi = document.createElement('code');
  coi.className = 'qs-code-inline';
  coi.textContent = 'crossOriginIsolated === true';
  body.append(coi, document.createTextNode('. In Vite also set '));
  const workerFormat = document.createElement('code');
  workerFormat.className = 'qs-code-inline';
  workerFormat.textContent = "worker: { format: 'es' }";
  body.append(
    workerFormat,
    document.createTextNode('. Header-less static hosts and IIFE Worker builds won’t boot it.'),
  );

  callout.append(titleRow, body);
  return callout;
}

function buildLeafCard(): HTMLElement {
  const card = document.createElement('div');
  card.className = 'qs-leaf-card';

  const heading = document.createElement('h3');
  heading.className = 'qs-leaf-heading';
  heading.textContent = 'Vite host wiring';

  const list = document.createElement('div');
  list.className = 'qs-leaf-list';
  const installs = ['npm i @riftydev/sdk @riftydev/runtime-js'];
  for (const cmd of installs) {
    const row = document.createElement('div');
    row.className = 'qs-leaf-row';
    const dollar = document.createElement('span');
    dollar.className = 'qs-leaf-dollar';
    dollar.textContent = '$';
    row.append(dollar, document.createTextNode(` ${cmd}`));
    list.append(row);
  }

  const note = document.createElement('p');
  note.className = 'qs-leaf-note';
  note.textContent =
    'Declare runtime-js because host code imports its Worker entry. This example is eval/files only; preview also needs a separately bundled same-origin Service Worker.';

  card.append(heading, list, note);
  return card;
}

/** Quick start — production-buildable Vite host code and its deployment requirements. */
export function renderQuickStart(): HTMLElement {
  const section = document.createElement('section');
  section.id = 'start';
  section.className = 'qs';

  const head = document.createElement('div');
  head.className = 'qs-head';
  const index = document.createElement('span');
  index.className = 'qs-index';
  index.textContent = '04';
  const label = document.createElement('h2');
  label.className = 'qs-label';
  label.textContent = 'Quick start';
  head.append(index, label);

  const grid = document.createElement('div');
  grid.className = 'qs-grid';

  const rightCol = document.createElement('div');
  rightCol.className = 'qs-right';
  rightCol.append(buildCallout(), buildLeafCard());

  grid.append(buildCodeCard(), rightCol);

  section.append(head, grid);
  return section;
}
