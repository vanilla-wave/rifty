import { logoMark } from '../icons';
import './cta-footer.css';

const GITHUB_URL = 'https://github.com/vanilla-wave/rifty';

function buildPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'cta-panel';

  const h2 = document.createElement('h2');
  h2.className = 'cta-h2';
  h2.textContent = 'Run Node in the tab.';

  const sub = document.createElement('p');
  sub.className = 'cta-sub';
  sub.textContent =
    'Open, self-hostable, browser-local runtime infrastructure. Built from scratch — MIT.';

  const chip = document.createElement('div');
  chip.className = 'cta-chip';
  const dollar = document.createElement('span');
  dollar.className = 'cta-chip-dollar';
  dollar.textContent = '$';
  chip.append(dollar, document.createTextNode(' npm install @riftydev/sdk'));

  const row = document.createElement('div');
  row.className = 'cta-buttons';
  const primary = document.createElement('a');
  primary.className = 'cta-btn cta-btn-primary';
  primary.href = GITHUB_URL;
  primary.textContent = 'Read the docs';
  const secondary = document.createElement('a');
  secondary.className = 'cta-btn cta-btn-secondary';
  secondary.href = GITHUB_URL;
  secondary.textContent = 'View on GitHub';
  row.append(primary, secondary);

  panel.append(h2, sub, chip, row);
  return panel;
}

function buildFooter(): HTMLElement {
  const footer = document.createElement('div');
  footer.className = 'cta-footer';

  const mark = document.createElement('span');
  mark.className = 'cta-footer-mark';
  mark.innerHTML = logoMark;

  const name = document.createElement('span');
  name.className = 'cta-footer-name';
  name.textContent = 'rifty';

  const stamp = document.createElement('span');
  stamp.className = 'cta-footer-stamp';
  stamp.textContent = 'M11 · Consumer Ready';

  footer.append(mark, name, stamp);
  return footer;
}

/** Accent CTA panel + footer row. */
export function renderCtaFooter(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'cta';
  section.append(buildPanel(), buildFooter());
  return section;
}
