import { icon } from '../icons';
import './quickstart.css';

// One token in a code line: [text, syntax-class | ''].
type Tok = readonly [text: string, cls: string];

function codeLine(toks: readonly Tok[]): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'qs-code-line';
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

function blankLine(): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'qs-code-line';
  div.textContent = ' ';
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
  tab.append(fileIcon, document.createTextNode('boot.ts'));

  const body = document.createElement('div');
  body.className = 'qs-code-body';

  body.append(
    codeLine([
      ['import', 'syn-kw'],
      [' { ', 'syn-punc'],
      ['checkCapabilities', ''],
      [', ', 'syn-punc'],
      ['createSandbox', ''],
      [' } ', 'syn-punc'],
      ['from', 'syn-kw'],
      [' ', ''],
      ["'@riftydev/sdk'", 'syn-str'],
    ]),
  );
  body.append(blankLine());
  body.append(
    codeLine([
      ['const', 'syn-kw'],
      [' caps ', ''],
      ['= ', 'syn-punc'],
      ['checkCapabilities', 'syn-fn'],
      ['()', 'syn-punc'],
    ]),
  );
  body.append(
    codeLine([
      ['if', 'syn-kw'],
      [' (!caps.sufficient || !caps.capabilities.crossOriginIsolated)', 'syn-punc'],
    ]),
  );
  body.append(
    codeLine([
      ['  throw', 'syn-kw'],
      [' new ', 'syn-punc'],
      ['Error', 'syn-fn'],
      ['(caps.summary)', 'syn-punc'],
    ]),
  );
  body.append(blankLine());
  body.append(
    codeLine([
      ['const', 'syn-kw'],
      [' sandbox ', ''],
      ['=', 'syn-punc'],
      [' ', ''],
      ['await', 'syn-kw'],
      [' ', ''],
      ['createSandbox', 'syn-fn'],
      ['({', 'syn-punc'],
    ]),
  );
  body.append(
    codeLine([
      ['  workerUrl', ''],
      [': ', 'syn-punc'],
      ['new', 'syn-kw'],
      [' ', ''],
      ['URL', 'syn-fn'],
      ['(', 'syn-punc'],
      ["'@riftydev/runtime-js/worker'", 'syn-str'],
      [', import.meta.url),', 'syn-punc'],
    ]),
  );
  body.append(
    codeLine([
      ['  serviceWorkerUrl', ''],
      [': ', 'syn-punc'],
      ["'/sw.js'", 'syn-str'],
      [',', 'syn-punc'],
    ]),
  );
  body.append(codeLine([['})', 'syn-punc']]));
  body.append(blankLine());
  body.append(
    codeLine([
      ['await', 'syn-kw'],
      [' sandbox.runtime.', 'syn-punc'],
      ['eval', 'syn-fn'],
      ['(', 'syn-punc'],
      ['\'console.log("hello from a Worker")\'', 'syn-str'],
      [')', 'syn-punc'],
    ]),
  );

  card.append(tab, body);
  return card;
}

function buildCallout(): HTMLElement {
  const callout = document.createElement('div');
  callout.className = 'qs-callout';

  const titleRow = document.createElement('div');
  titleRow.className = 'qs-callout-title';
  const warnIcon = document.createElement('span');
  warnIcon.className = 'qs-callout-icon';
  warnIcon.innerHTML = icon('warning-triangle', 15);
  const title = document.createElement('span');
  title.className = 'qs-callout-heading';
  title.textContent = 'Cross-origin isolation required';
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
  body.append(coi, document.createTextNode('. Header-less static hosts won’t boot it.'));

  callout.append(titleRow, body);
  return callout;
}

function buildLeafCard(): HTMLElement {
  const card = document.createElement('div');
  card.className = 'qs-leaf-card';

  const heading = document.createElement('div');
  heading.className = 'qs-leaf-heading';
  heading.textContent = 'also fine on its own:';

  const list = document.createElement('div');
  list.className = 'qs-leaf-list';
  const installs = ['npm i @riftydev/vfs', 'npm i @riftydev/npm-client', 'npm i @riftydev/shell'];
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
    'The leaf packages are plain isomorphic JS — no headers, no worker, runs anywhere.';

  card.append(heading, list, note);
  return card;
}

/** Quick start — boot.ts code card + COI callout + leaf-installs card. */
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
