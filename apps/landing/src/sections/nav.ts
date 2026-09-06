import { playgroundHref, playgroundLabel, repositoryUrl } from '../landing-config';
import './nav.css';

// Document order: the label list doubles as the primary + drawer navigation.
const LINKS: ReadonlyArray<readonly [label: string, href: string]> = [
  ['OVERVIEW', '#what'],
  ['DEMOS', '#demos'],
  ['ARCH', '#arch'],
  ['PACKAGES', '#packages'],
  ['START', '#start'],
];

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

function makePlaygroundLink(className: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = className;
  link.href = playgroundHref;
  link.textContent = playgroundLabel;
  link.setAttribute('aria-label', `Open the playground — ${playgroundLabel}`);
  return link;
}

function makeGithubLink(className: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = className;
  link.href = repositoryUrl;
  link.setAttribute('aria-label', 'GitHub repository');
  link.append(document.createTextNode('GITHUB '));
  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '↗';
  link.append(arrow);
  return link;
}

/** Rule-grid navigation bar with an accessible drawer below 880 px. */
export function renderNav(): HTMLElement {
  const header = document.createElement('header');
  header.className = 'nav';

  const inner = document.createElement('div');
  inner.className = 'nav-inner';

  const brand = document.createElement('a');
  brand.className = 'nav-brand';
  brand.href = '#';
  brand.textContent = 'RIFTY';
  brand.setAttribute('aria-label', 'rifty — back to top');

  const desktopLinks = makeLinks('nav-links');

  const right = document.createElement('div');
  right.className = 'nav-right';
  right.append(makePlaygroundLink('nav-play'), makeGithubLink('nav-github'));

  const mobilePlay = makePlaygroundLink('nav-mobile-play');
  mobilePlay.textContent = 'PLAY ↗';
  mobilePlay.setAttribute('aria-label', 'Open the playground — PLAY');

  const menuButton = document.createElement('button');
  menuButton.type = 'button';
  menuButton.className = 'nav-menu-button';
  menuButton.setAttribute('aria-controls', 'nav-mobile-panel');
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', 'Open navigation');
  menuButton.innerHTML =
    '<span class="nav-menu-line"></span><span class="nav-menu-line"></span><span class="nav-menu-line"></span>';

  inner.append(brand, desktopLinks, right, mobilePlay, menuButton);

  const panel = document.createElement('div');
  panel.id = 'nav-mobile-panel';
  panel.className = 'nav-mobile-panel';
  panel.hidden = true;
  const mobileActions = document.createElement('div');
  mobileActions.className = 'nav-mobile-actions';
  mobileActions.append(
    makePlaygroundLink('nav-mobile-action'),
    makeGithubLink('nav-mobile-action'),
  );
  panel.append(makeLinks('nav-mobile-links'), mobileActions);

  const setOpen = (open: boolean): void => {
    panel.hidden = !open;
    header.classList.toggle('nav-open', open);
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  };
  menuButton.addEventListener('click', () => setOpen(panel.hidden));
  header.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>('a');
    if (link?.getAttribute('href')?.startsWith('#')) setOpen(false);
  });
  // Escape closes the drawer wherever focus sits (it may have tabbed past the drawer).
  const onEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !panel.hidden) {
      setOpen(false);
      menuButton.focus();
    }
  };
  document.addEventListener('keydown', onEscape);

  const mobileViewport = window.matchMedia('(max-width: 880px)');
  mobileViewport.addEventListener('change', (event) => {
    if (!event.matches) setOpen(false);
  });

  header.append(inner, panel);
  return header;
}
