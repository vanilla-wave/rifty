import { MILESTONE_LONG, RELEASE_STAMP, playgroundHref } from '../landing-config';
import './hero.css';

const MARQUEE = [
  'MIT LICENSED',
  'SELF-HOSTABLE',
  'CHROMIUM-FIRST',
  'NODE 24 PARITY TARGET',
  'WASI PREVIEW1',
];

// Sonar ping — decorative Rifters nod behind the hero copy.
function buildSonar(): HTMLElement {
  const sonar = document.createElement('div');
  sonar.className = 'sonar';
  sonar.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) {
    const ring = document.createElement('span');
    ring.className = 'sonar-ring';
    sonar.append(ring);
  }
  const dot = document.createElement('span');
  dot.className = 'sonar-dot';
  sonar.append(dot);
  return sonar;
}

function buildBody(): HTMLElement {
  const body = document.createElement('div');
  body.className = 'hero-body';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'hero-eyebrow';
  // NBSP around separators: a line break never lands next to a lone dot.
  eyebrow.textContent = `OPEN RUNTIME · SELF-HOSTABLE — ${RELEASE_STAMP} · ${MILESTONE_LONG}`;

  const h1 = document.createElement('h1');
  h1.className = 'hero-h1';
  h1.append(
    document.createTextNode('Node, npm &'),
    document.createElement('br'),
    document.createTextNode('a dev server —'),
    document.createElement('br'),
  );
  const mark = document.createElement('span');
  mark.className = 'hero-h1-mark';
  mark.textContent = 'in a tab.';
  h1.append(mark);

  const row = document.createElement('div');
  row.className = 'hero-row';

  const lead = document.createElement('p');
  lead.className = 'hero-lead';
  lead.textContent =
    'rifty is an open, self-hostable Node-compatible runtime and WASI runner for Chromium. Run tested Express 4, Vite 7, npm tooling and .wasm workflows — execution and files stay in the tab.';

  const cta = document.createElement('div');
  cta.className = 'hero-cta';
  const primary = document.createElement('a');
  primary.className = 'btn btn-primary';
  primary.href = playgroundHref;
  primary.textContent = 'RUN SOMETHING REAL';
  const secondary = document.createElement('a');
  secondary.className = 'btn btn-outline';
  secondary.href = '#arch';
  secondary.textContent = 'HOW IT WORKS';
  cta.append(primary, secondary);

  row.append(lead, cta);
  body.append(buildSonar(), eyebrow, h1, row);
  return body;
}

function buildMarquee(): HTMLElement {
  const marquee = document.createElement('div');
  marquee.className = 'marquee';

  const list = document.createElement('ul');
  list.className = 'marquee-track';
  list.setAttribute('aria-label', 'Project facts');
  const copies = 2;
  for (let copy = 0; copy < copies; copy++) {
    for (const item of MARQUEE) {
      const li = document.createElement('li');
      li.className = 'marquee-item';
      if (copy > 0) li.setAttribute('aria-hidden', 'true');
      li.textContent = item;
      const star = document.createElement('span');
      star.className = 'marquee-star';
      star.setAttribute('aria-hidden', 'true');
      star.textContent = '*';
      li.append(star);
      list.append(li);
    }
  }
  marquee.append(list);
  return marquee;
}

/** Hero poster + the fact marquee that closes it. */
export function renderHero(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'hero';
  section.append(buildBody(), buildMarquee());
  return section;
}
