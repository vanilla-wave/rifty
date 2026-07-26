import { icon } from '../icons';
import { buildPlaygroundHref } from '../playground-url';
import { HERO_SNIPPET, type SnippetToken } from '../public-snippets';
import { startTerminalLog } from '../terminal-log';
import './hero.css';

function codeLine(toks: readonly SnippetToken[]): HTMLDivElement {
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
  eyebrow.append(dot, document.createTextNode('Open runtime · Self-hostable'));

  const h1 = document.createElement('h1');
  h1.className = 'hero-h1';
  h1.append(document.createTextNode('Node, npm, and a dev server — '));
  const accentClause = document.createElement('span');
  accentClause.className = 'hero-h1-ac';
  accentClause.textContent = 'inside a browser tab.';
  h1.append(accentClause);

  const sub = document.createElement('p');
  sub.className = 'hero-sub';
  const subLead = document.createElement('span');
  subLead.className = 'hero-sub-lead';
  subLead.textContent =
    'rifty is an open, self-hostable Node-compatible runtime and WASI runner for Chromium.';
  sub.append(subLead);
  sub.append(document.createElement('br'));
  sub.append(
    document.createTextNode(
      'Install packages, run Node-compatible apps and CLIs, or execute WASI guests. Execution and files stay in the tab.',
    ),
  );

  const cta = document.createElement('div');
  cta.className = 'hero-cta';
  const primary = document.createElement('a');
  primary.className = 'hero-btn hero-btn-primary';
  primary.href = buildPlaygroundHref(import.meta.env.VITE_RIFTY_PLAYGROUND_URL);
  primary.append(document.createTextNode('Run something real'));
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
  const metaItems = ['MIT licensed', 'Self-hostable', 'Chromium-first', 'Node 24 parity target'];
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
  host.textContent = '@riftydev/sdk · v0.2';
  const live = document.createElement('span');
  live.className = 'hero-live';
  const liveDot = document.createElement('span');
  liveDot.className = 'hero-live-dot';
  live.append(liveDot, document.createTextNode('PUBLIC API'));
  titlebar.append(host, live);

  // Code block: only methods on the current public Sandbox contract.
  const code = document.createElement('div');
  code.className = 'hero-code';
  for (const line of HERO_SNIPPET) code.append(codeLine(line));

  // terminal panel
  const term = document.createElement('div');
  term.className = 'hero-term';
  const termLabel = document.createElement('div');
  termLabel.className = 'hero-term-label';
  const apiSpan = document.createElement('span');
  apiSpan.className = 'hero-term-vite';
  apiSpan.textContent = '● public SDK';
  termLabel.append(apiSpan, document.createTextNode(' API TRACE'));
  const termLog = document.createElement('div');
  termLog.className = 'hero-term-log';
  term.append(termLabel, termLog);

  const apiNote = document.createElement('p');
  apiNote.className = 'hero-api-note';
  apiNote.textContent =
    'The host supplies a bundled module-Worker URL. This eval-only example uses the public Sandbox façade: runtime.eval/on + fs. Command execution and preview routing are separate APIs.';

  win.append(titlebar, code, term, apiNote);

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
