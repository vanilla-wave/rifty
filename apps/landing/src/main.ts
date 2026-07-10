// Landing entry. Replaces the static fallback once every client-rendered
// landmark is ready, then loads the below-fold explorer near the viewport.

import { renderArch } from './sections/arch';
import { renderCtaFooter } from './sections/cta-footer';
import { renderDemos } from './sections/demos';
import { renderHero } from './sections/hero';
import { renderNav } from './sections/nav';
import { renderQuickStart } from './sections/quickstart';
import { renderWhat } from './sections/what';
import './styles/tokens.css';
import './styles/base.css';

const app = document.getElementById('app');
if (!app) {
  throw new Error('landing: #app container missing from index.html');
}

const skipLink = document.createElement('a');
skipLink.className = 'skip-link';
skipLink.href = '#main-content';
skipLink.textContent = 'Skip to main content';

const main = document.createElement('main');
main.id = 'main-content';
main.append(renderHero(), renderDemos(), renderWhat(), renderArch(), renderQuickStart());

const page = document.createDocumentFragment();
page.append(skipLink, renderNav(), main, renderCtaFooter());
app.replaceChildren(page);

const explorerRootCandidate = document.getElementById('explorer-root');
if (!explorerRootCandidate) {
  throw new Error('landing: #explorer-root missing from architecture section');
}
const explorerRoot = explorerRootCandidate;

let explorerLoad: Promise<void> | undefined;

function mountExplorerOnce(): void {
  if (explorerLoad) return;

  explorerLoad = import('./explorer/explorer').then(({ mountExplorer }) => {
    const disposeExplorer = mountExplorer(explorerRoot);
    (window as Window & { __riftyDisposeExplorer?: () => void }).__riftyDisposeExplorer =
      disposeExplorer;
  });

  explorerLoad.catch((cause: unknown) => {
    queueMicrotask(() => {
      throw new Error('landing: architecture explorer failed to load', { cause });
    });
  });
}

const observer = new IntersectionObserver(
  (entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    mountExplorerOnce();
  },
  { rootMargin: '600px 0px' },
);
observer.observe(explorerRoot);

if (window.location.hash === '#arch') {
  document.getElementById('arch')?.scrollIntoView();
  observer.disconnect();
  mountExplorerOnce();
}
