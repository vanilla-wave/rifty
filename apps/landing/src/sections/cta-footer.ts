import {
  MILESTONE_STAMP,
  RELEASE_STAMP,
  playgroundHref,
  playgroundLabel,
  repositoryUrl,
  sdkDocsUrl,
  siteLabel,
} from '../landing-config';
import './cta-footer.css';

const NPM_CMD = 'npm i @riftydev/sdk @riftydev/runtime-js';

function wireCopy(chip: HTMLButtonElement, feedback: HTMLElement): void {
  let reverting: number | undefined;
  let attempt = 0;
  const defaultLabel = `Copy install command: ${NPM_CMD}`;

  const reset = (): void => {
    chip.classList.remove('cta-copy-done', 'cta-copy-error');
    chip.setAttribute('aria-label', defaultLabel);
  };
  reset();

  chip.addEventListener('click', async () => {
    const currentAttempt = ++attempt;
    if (reverting !== undefined) {
      clearTimeout(reverting);
      reverting = undefined;
    }
    reset();
    feedback.textContent = '';

    try {
      await navigator.clipboard.writeText(NPM_CMD);
    } catch {
      if (currentAttempt !== attempt) return;
      chip.classList.add('cta-copy-error');
      chip.setAttribute('aria-label', `Copy failed. Select: ${NPM_CMD}`);
      feedback.textContent = 'Copy failed. Select the install command manually.';
      return;
    }
    if (currentAttempt !== attempt) return;

    chip.classList.add('cta-copy-done');
    chip.setAttribute('aria-label', 'Install command copied');
    feedback.textContent = 'Install command copied.';
    reverting = window.setTimeout(() => {
      reverting = undefined;
      reset();
      feedback.textContent = '';
    }, 1400);
  });
}

function makeButton(className: string, href: string, label: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = className;
  link.href = href;
  link.append(document.createTextNode(`${label} `));
  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '↗';
  link.append(arrow);
  return link;
}

function appendPanel(footer: HTMLElement): void {
  const h2 = document.createElement('h2');
  h2.className = 'cta-h2';
  h2.append(document.createTextNode('Run Node'), document.createElement('br'));
  h2.append(document.createTextNode('in the tab.'));

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'cta-copy';
  const dollar = document.createElement('span');
  dollar.className = 'cta-copy-dollar';
  dollar.setAttribute('aria-hidden', 'true');
  dollar.textContent = '$';
  copy.append(dollar, document.createTextNode(` ${NPM_CMD}`));
  const feedback = document.createElement('span');
  feedback.className = 'visually-hidden';
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');
  feedback.setAttribute('aria-atomic', 'true');
  wireCopy(copy, feedback);

  const row = document.createElement('div');
  row.className = 'cta-buttons';
  const play = makeButton('btn btn-primary', playgroundHref, playgroundLabel);
  play.setAttribute('aria-label', `Open the playground — ${playgroundLabel}`);
  const docs = makeButton('btn btn-outline', sdkDocsUrl, 'SDK DOCS');
  docs.setAttribute('aria-label', 'Read SDK docs');
  const github = makeButton('btn btn-outline', repositoryUrl, 'GITHUB');
  github.setAttribute('aria-label', 'GitHub repository');
  row.append(play, docs, github);

  footer.append(h2, copy, feedback, row);
}

function buildFooter(): HTMLElement {
  const footer = document.createElement('p');
  footer.className = 'cta-footer';
  footer.textContent = `${siteLabel} — OPEN, SELF-HOSTABLE, BROWSER-LOCAL RUNTIME INFRASTRUCTURE · ${RELEASE_STAMP} · ${MILESTONE_STAMP} · MIT`;
  return footer;
}

/** Closing poster CTA + the one-line footer. */
export function renderCtaFooter(): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'cta';
  appendPanel(footer);
  footer.append(buildFooter());
  return footer;
}
