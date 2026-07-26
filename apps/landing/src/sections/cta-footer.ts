import { logoMark } from '../icons';
import { repositoryUrl, sdkDocsUrl } from '../landing-config';
import './cta-footer.css';

function buildPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'cta-panel';

  const h2 = document.createElement('h2');
  h2.className = 'cta-h2';
  h2.textContent = 'Run Node in the tab.';

  const sub = document.createElement('p');
  sub.className = 'cta-sub';
  sub.textContent =
    'MIT-licensed, self-hostable runtime infrastructure. Audit it, deploy it, keep execution in the browser.';

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
  primary.href = sdkDocsUrl;
  primary.textContent = 'Read SDK docs';
  const secondary = document.createElement('a');
  secondary.className = 'cta-btn cta-btn-secondary';
  secondary.href = repositoryUrl;
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
  stamp.textContent = 'v0.2 · M11 active';

  footer.append(mark, name, stamp);
  return footer;
}

/** Accent CTA panel + footer row. */
export function renderCtaFooter(): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'cta';
  footer.append(buildPanel(), buildFooter());
  return footer;
}
