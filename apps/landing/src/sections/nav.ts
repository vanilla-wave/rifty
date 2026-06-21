import { icon, logoMark } from '../icons';
import './nav.css';

const NPM_CMD = 'npm i @riftydev/sdk';
const GITHUB_URL = 'https://github.com/vanilla-wave/rifty';
const PLAYGROUND_URL = 'https://play.rifty.dev/';

// Wire the npm copy chip: copy command, flip to a check icon briefly.
function wireCopy(chip: HTMLButtonElement, iconHost: HTMLElement): void {
  let reverting: number | undefined;
  chip.addEventListener('click', () => {
    void navigator.clipboard?.writeText(NPM_CMD);
    iconHost.innerHTML = icon('check', 13);
    chip.classList.add('nav-copy-done');
    if (reverting !== undefined) {
      clearTimeout(reverting);
    }
    reverting = window.setTimeout(() => {
      iconHost.innerHTML = icon('copy', 13);
      chip.classList.remove('nav-copy-done');
    }, 1400);
  });
}

/** Sticky top nav: logo + wordmark + version chip, center links, npm chip + Star. */
export function renderNav(): HTMLElement {
  const header = document.createElement('header');
  header.className = 'nav';

  const inner = document.createElement('div');
  inner.className = 'nav-inner';

  // left: logo + wordmark + version chip
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
  version.textContent = 'v0.x · M11';

  // center links
  const links = document.createElement('nav');
  links.className = 'nav-links';
  const linkData: ReadonlyArray<readonly [string, string]> = [
    ['Overview', '#what'],
    ['Architecture', '#arch'],
    ['Quick start', '#start'],
  ];
  for (const [label, href] of linkData) {
    const a = document.createElement('a');
    a.className = 'nav-link';
    a.href = href;
    a.textContent = label;
    links.append(a);
  }

  // right: npm copy chip + Star
  const right = document.createElement('div');
  right.className = 'nav-right';

  const copyChip = document.createElement('button');
  copyChip.type = 'button';
  copyChip.className = 'nav-copy';
  copyChip.title = 'Copy install command';
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

  // primary exit to the live playground (play.rifty.dev — its own origin)
  const play = document.createElement('a');
  play.className = 'nav-play';
  play.href = PLAYGROUND_URL;
  play.append(document.createTextNode('Open playground'));
  const playIcon = document.createElement('span');
  playIcon.className = 'nav-play-icon';
  playIcon.innerHTML = icon('arrow-right', 14);
  play.append(playIcon);

  const star = document.createElement('a');
  star.className = 'nav-star';
  star.href = GITHUB_URL;
  const starIcon = document.createElement('span');
  starIcon.className = 'nav-star-icon';
  starIcon.innerHTML = icon('github', 15);
  star.append(starIcon, document.createTextNode('Star'));

  right.append(copyChip, play, star);

  inner.append(brand, version, links, right);
  header.append(inner);
  return header;
}
