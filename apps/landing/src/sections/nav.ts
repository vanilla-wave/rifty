import { icon, logoMark } from '../icons';
import './nav.css';

const NPM_CMD = 'npm i @riftydev/sdk';
const GITHUB_URL = 'https://github.com/vanilla-wave/rifty';

const LINKS: ReadonlyArray<readonly [label: string, href: string]> = [
  ['Overview', '#what'],
  ['Demos', '#demos'],
  ['Architecture', '#arch'],
  ['Embed', '#start'],
];

function wireCopy(chip: HTMLButtonElement, iconHost: HTMLElement): void {
  let reverting: number | undefined;
  chip.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(NPM_CMD);
    } catch {
      chip.classList.add('nav-copy-error');
      chip.setAttribute('aria-label', 'Copy failed. Select: npm i @riftydev/sdk');
      return;
    }
    iconHost.innerHTML = icon('check', 13);
    chip.classList.add('nav-copy-done');
    chip.setAttribute('aria-label', 'Install command copied');
    if (reverting !== undefined) clearTimeout(reverting);
    reverting = window.setTimeout(() => {
      iconHost.innerHTML = icon('copy', 13);
      chip.classList.remove('nav-copy-done');
      chip.setAttribute('aria-label', `Copy install command: ${NPM_CMD}`);
    }, 1400);
  });
}

function makeLinks(className: string): HTMLElement {
  const links = document.createElement('nav');
  links.className = className;
  links.setAttribute('aria-label', className.includes('mobile') ? 'Mobile navigation' : 'Primary');
  for (const [label, href] of LINKS) {
    const link = document.createElement('a');
    link.className = 'nav-link';
    link.href = href;
    link.textContent = label;
    links.append(link);
  }
  return links;
}

function makeCopyChip(): HTMLButtonElement {
  const copyChip = document.createElement('button');
  copyChip.type = 'button';
  copyChip.className = 'nav-copy';
  copyChip.setAttribute('aria-label', `Copy install command: ${NPM_CMD}`);

  const dollar = document.createElement('span');
  dollar.className = 'nav-copy-dollar';
  dollar.textContent = '$';
  const cmd = document.createElement('span');
  cmd.className = 'nav-copy-cmd';
  cmd.textContent = NPM_CMD;
  const copyIcon = document.createElement('span');
  copyIcon.className = 'nav-copy-icon';
  copyIcon.innerHTML = icon('copy', 13);
  copyChip.append(dollar, cmd, copyIcon);
  wireCopy(copyChip, copyIcon);
  return copyChip;
}

function makeGithubLink(labelled: boolean): HTMLAnchorElement {
  const github = document.createElement('a');
  github.className = labelled ? 'nav-star nav-star-labelled' : 'nav-star nav-star-icononly';
  github.href = GITHUB_URL;
  github.setAttribute('aria-label', 'GitHub repository');
  const githubIcon = document.createElement('span');
  githubIcon.className = 'nav-star-icon';
  githubIcon.innerHTML = icon('github', 16);
  github.append(githubIcon);
  if (labelled) github.append(document.createTextNode('GitHub'));
  return github;
}

/** Sticky navigation with a compact, accessible drawer below 880 px. */
export function renderNav(): HTMLElement {
  const header = document.createElement('header');
  header.className = 'nav';

  const inner = document.createElement('div');
  inner.className = 'nav-inner';

  const brand = document.createElement('a');
  brand.className = 'nav-brand';
  brand.href = '#';
  const mark = document.createElement('span');
  mark.className = 'nav-mark';
  mark.innerHTML = logoMark;
  const wordmark = document.createElement('span');
  wordmark.className = 'nav-wordmark';
  wordmark.textContent = 'rifty';
  brand.append(mark, wordmark);

  const version = document.createElement('span');
  version.className = 'nav-version';
  version.textContent = 'v0.1 · M11';

  const desktopLinks = makeLinks('nav-links');
  const desktopRight = document.createElement('div');
  desktopRight.className = 'nav-right';
  desktopRight.append(makeCopyChip(), makeGithubLink(false));

  const mobileCta = document.createElement('a');
  mobileCta.className = 'nav-mobile-cta';
  mobileCta.href = '#demos';
  mobileCta.textContent = 'Try demos';

  const menuButton = document.createElement('button');
  menuButton.type = 'button';
  menuButton.className = 'nav-menu-button';
  menuButton.setAttribute('aria-controls', 'nav-mobile-panel');
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', 'Open navigation');
  menuButton.innerHTML =
    '<span class="nav-menu-line"></span><span class="nav-menu-line"></span><span class="nav-menu-line"></span>';

  inner.append(brand, version, desktopLinks, desktopRight, mobileCta, menuButton);

  const panel = document.createElement('div');
  panel.id = 'nav-mobile-panel';
  panel.className = 'nav-mobile-panel';
  panel.hidden = true;
  const panelInner = document.createElement('div');
  panelInner.className = 'nav-mobile-panel-inner';
  const mobileLinks = makeLinks('nav-mobile-links');
  const mobileActions = document.createElement('div');
  mobileActions.className = 'nav-mobile-actions';
  mobileActions.append(makeCopyChip(), makeGithubLink(true));
  panelInner.append(mobileLinks, mobileActions);
  panel.append(panelInner);

  const setOpen = (open: boolean): void => {
    panel.hidden = !open;
    header.classList.toggle('nav-open', open);
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  };
  menuButton.addEventListener('click', () => setOpen(panel.hidden));
  mobileLinks.addEventListener('click', (event) => {
    if ((event.target as Element).closest('a')) setOpen(false);
  });
  header.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setOpen(false);
      menuButton.focus();
    }
  });

  header.append(inner, panel);
  return header;
}
