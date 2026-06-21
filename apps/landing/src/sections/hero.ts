import { icon } from '../icons';
import { startTerminalLog } from '../terminal-log';
import './hero.css';

// Build a syntax-colored code line from [text, class] pairs.
type Tok = readonly [text: string, cls: string];

function codeLine(toks: readonly Tok[]): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'hero-code-line';
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

function buildLeft(): HTMLElement {
  const left = document.createElement('div');
  left.className = 'hero-left';

  const eyebrow = document.createElement('div');
  eyebrow.className = 'hero-eyebrow';
  const dot = document.createElement('span');
  dot.className = 'hero-eyebrow-dot';
  eyebrow.append(dot, document.createTextNode('Browser-based Node runtime'));

  const h1 = document.createElement('h1');
  h1.className = 'hero-h1';
  h1.append(document.createTextNode('Node, npm, and a dev server — '));
  const accentClause = document.createElement('span');
  accentClause.className = 'hero-h1-ac';
  accentClause.textContent = 'inside a browser tab.';
  h1.append(accentClause);

  const sub = document.createElement('p');
  sub.className = 'hero-sub';
  sub.append(
    document.createTextNode(
      'rifty is a Node-compatible runtime and WASI runner built from scratch for the browser.',
    ),
  );
  sub.append(document.createElement('br'));
  sub.append(document.createTextNode('Run Express, '));
  const npmChip = document.createElement('code');
  npmChip.className = 'hero-chip hero-chip-ac';
  npmChip.textContent = 'npm install';
  sub.append(npmChip);
  sub.append(document.createTextNode(', even '));
  const wasmChip = document.createElement('code');
  wasmChip.className = 'hero-chip';
  wasmChip.textContent = '.wasm';
  sub.append(wasmChip);
  sub.append(document.createTextNode(' guests — with no server.'));

  const cta = document.createElement('div');
  cta.className = 'hero-cta';
  const primary = document.createElement('a');
  primary.className = 'hero-btn hero-btn-primary';
  primary.href = 'https://play.rifty.dev/';
  primary.append(document.createTextNode('Open playground'));
  const arrow = document.createElement('span');
  arrow.className = 'hero-btn-icon';
  arrow.innerHTML = icon('arrow-right', 15);
  primary.append(arrow);
  const secondary = document.createElement('a');
  secondary.className = 'hero-btn hero-btn-secondary';
  secondary.href = '#arch';
  secondary.textContent = 'How it works';
  cta.append(primary, secondary);

  const meta = document.createElement('div');
  meta.className = 'hero-meta';
  const metaItems = ['MIT licensed', 'ESM + .d.ts', 'Chromium-first', 'WASI preview1'];
  metaItems.forEach((item, i) => {
    if (i > 0) {
      const slash = document.createElement('span');
      slash.className = 'hero-meta-slash';
      slash.textContent = '/';
      meta.append(slash);
    }
    const span = document.createElement('span');
    span.textContent = item;
    meta.append(span);
  });

  left.append(eyebrow, h1, sub, cta, meta);
  return left;
}

function buildWindow(): HTMLElement {
  const win = document.createElement('div');
  win.className = 'hero-window';

  // titlebar
  const titlebar = document.createElement('div');
  titlebar.className = 'hero-titlebar';
  for (let i = 0; i < 3; i++) {
    const tdot = document.createElement('span');
    tdot.className = 'hero-traffic';
    titlebar.append(tdot);
  }
  const host = document.createElement('span');
  host.className = 'hero-host';
  host.textContent = 'localhost:3000';
  const live = document.createElement('span');
  live.className = 'hero-live';
  const liveDot = document.createElement('span');
  liveDot.className = 'hero-live-dot';
  live.append(liveDot, document.createTextNode('LIVE'));
  titlebar.append(host, live);

  // code block: createSandbox snippet
  const code = document.createElement('div');
  code.className = 'hero-code';
  code.append(codeLine([['// boot a Node runtime in the page', 'syn-com']]));
  code.append(
    codeLine([
      ['import', 'syn-kw'],
      [' { ', 'syn-punc'],
      ['createSandbox', ''],
      [' } ', 'syn-punc'],
      ['from', 'syn-kw'],
      [' ', ''],
      ["'@riftydev/sdk'", 'syn-str'],
    ]),
  );
  const gap = document.createElement('div');
  gap.className = 'hero-code-gap';
  code.append(gap);
  code.append(
    codeLine([
      ['const', 'syn-kw'],
      [' box ', ''],
      ['=', 'syn-punc'],
      [' ', ''],
      ['await', 'syn-kw'],
      [' ', ''],
      ['createSandbox', 'syn-fn'],
      ['({ … })', 'syn-punc'],
    ]),
  );
  code.append(
    codeLine([
      ['await', 'syn-kw'],
      [' box', ''],
      ['.', 'syn-punc'],
      ['spawn', 'syn-fn'],
      ['(', 'syn-punc'],
      ["'node'", 'syn-str'],
      [', [', 'syn-punc'],
      ["'server.js'", 'syn-str'],
      ['])', 'syn-punc'],
    ]),
  );

  // terminal panel
  const term = document.createElement('div');
  term.className = 'hero-term';
  const termLabel = document.createElement('div');
  termLabel.className = 'hero-term-label';
  const viteSpan = document.createElement('span');
  viteSpan.className = 'hero-term-vite';
  viteSpan.textContent = '● vite';
  termLabel.append(viteSpan, document.createTextNode(' TERMINAL'));
  const termLog = document.createElement('div');
  termLog.className = 'hero-term-log';
  term.append(termLabel, termLog);

  win.append(titlebar, code, term);

  // start the looping boot log on the terminal log element
  startTerminalLog(termLog);

  return win;
}

/** Hero: 2-col grid — copy/CTA on the left, sandbox window mock on the right. */
export function renderHero(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'hero';
  section.append(buildLeft(), buildWindow());
  return section;
}
